# Lyne 普通播放响应链路延迟分析

日期: 2026-06-01

## 结论摘要

本轮分析的对象是普通播放响应链路，尤其是 `load-to-progress`、`pause/play resume`、`next-track`。

现有证据显示，HTTP/server route 层不是主要瓶颈。`/load`、`/play`、`/domain/queue/play_next` 的请求返回通常在 1-7 ms 内完成；慢的是请求返回后，到 `/state.current_time` 真正推进并被 benchmark 观察到的阶段。

根因排序:

1. `load-to-progress` 的主因是 Lyne 在可播放前先完成整首歌 decode、可选整首 preemptive resample、整首 loudness 分析，并把完整 `Vec<f64>` 发布给 audio callback。它不是流式 first-buffer 播放模型。
2. `next-track` 的主因是手动 `/domain/queue/play_next` 没有使用 `/queue_next` 预加载好的 `pending_buffer`，反而走普通 `load_with_credentials_and_autoplay`，该路径会先取消预加载再重新整首加载。
3. `load` / `next` 还叠加了每次显式 load 都 `StopForLoad`，CPAL stream 被置空，之后 `Play` 需要重新 negotiate/build/start output stream。
4. `resume` 的延迟有一部分来自 benchmark 等待条件和 polling，但 10 ms polling 复测后仍有 233 ms，因此还存在真实的 CPAL stream resume 到 audio callback 更新 `position_frames` 的延迟。

## 关键实测

基准文件:

- `apps/desktop/output/lyne-evidence/playback-latency/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/playback-latency-poll10/playback-latency-benchmark.json`

原 50 ms polling:

- `/load` request latency: 3.483 ms
- `load-to-progress`: 2532.902 ms, 42 polls
- `/play` request latency: 1.462 ms
- `play-resume-to-progress`: 370.677 ms, 7 polls
- `/domain/queue/play_next` request latency: 1.819 ms
- `next-to-progress`: 1643.251 ms, 28 polls
- seek convergence p50: 1.704 ms
- underrun delta: 0
- decode after-run: 633 ms, 9,630,720 input frames, 20,963,432 output samples, 9405 chunks

10 ms polling 复测:

- `/load` request latency: 6.958 ms
- `load-to-progress`: 1635.918 ms
- `/play` request latency: 0.779 ms
- `play-resume-to-progress`: 232.762 ms
- `/domain/queue/play_next` request latency: 3.130 ms
- `next-to-progress`: 1332.260 ms
- seek convergence p50: 0.861 ms
- decode after-run: 462 ms, 9,630,720 input frames, 20,963,432 output samples, 9405 chunks

解释:

- `resume` 确实被 50 ms polling 和 `current_time > baseline + 0.02s` 放大，但不是纯测量误差；10 ms polling 下仍然有 233 ms。
- `load` 和 `next` 在 10 ms polling 下仍是 1.3-1.6 s 级，说明主要不是 polling。
- `decode.last_duration_ms` 只覆盖 decode/resample 计时，不覆盖 loaded-track loudness 分析、`LoadComplete` 应用状态、DSP chain rebuild、CPAL stream build/start、以及 `/state` 观测延迟。

## load-to-progress 链路

benchmark 等待条件:

- `is_playing === true`
- `is_loading === false`
- `current_time > baseline + 0.02`

代码链路:

1. `/load` / queue load 进入 `AudioPlayer::load_with_credentials_inner`。
2. 该函数先执行 `stop_for_track_load()`，再 `GaplessManager::cancel_preload()`，再 `begin_loading_track(path, autoplay)`。
3. `begin_loading_track(... autoplay=true)` 会把 state 先置为 `Playing`，但此时 `total_frames=0`，`audio_buffer` 还没有新曲完整数据。
4. 后台线程调用 `decode_file_internal`。
5. `decode_file_internal` 循环 `decoder.decode_next_into()` 直到 EOF，期间把所有样本累积到 `Vec<f64>`；如果目标采样率不同且 `preemptive_resample=true`，还会整首重采样。
6. decode 完成后发送 `AudioCommand::LoadComplete`。
7. `LoadComplete` 中 `apply_loaded_track_result` 会 `Arc::new(samples)`、rebuild DSP chain、发布完整 audio buffer，并调用 `apply_loaded_track_loudness`。
8. 如果没有 ReplayGain tag 或 fresh loudness cache，`apply_loaded_track_loudness` 会对完整 samples 再跑一次 EBU R128 loudness scan。
9. autoplay 再发送 `AudioCommand::Play`。
10. audio thread `start_playback()` negotiate/build/start CPAL output stream。
11. audio callback 第一次推进 `position_frames` 后，`/state.current_time` 才会变大。

主因:

- 当前架构是 full-buffer-before-playback，不是 streaming-first-buffer。
- 默认配置会加重这个路径: `use_cache=false`、`preemptive_resample=true`、`loudness.enabled=true`、`loudness.mode=Track`。
- 真实配置文件显示测试运行时 output target 是设备默认 48 kHz，输入 FLAC 最终输出 samples 为 20,963,432，符合整首 44.1 kHz -> 48 kHz 后再播放的路径。

## pause/play resume 链路

benchmark 不是只测 `/play` 请求返回，而是等当前时间从 pause 前位置再推进 20 ms 以上。

代码链路:

1. `AudioPlayer::pause()` 先把 shared state 置为 `Paused`，发送 `AudioCommand::Pause`。
2. `CpalCommandBackend::pause()` 调用 `stream.pause()`，stream 保留。
3. `AudioPlayer::play()` 如果之前是 `Paused`，先把 state 置为 `Playing`，发送 `AudioCommand::Play`。
4. `CpalCommandBackend::play()` 如果 stream 存在，调用 `stream.play()`，不重新 build stream。
5. audio callback 只有在 `shared.state == Playing` 时才写音频并更新 `position_frames`。
6. `/state.current_time` 由 `position_frames / sample_rate` 计算。

已确认:

- resume 不走整首 decode。
- resume 不应该重建 stream，除非之前 stream 已被 stop/load 清空。
- 50 ms polling 结果 370 ms，10 ms polling 结果 233 ms，说明测量条件放大了一部分延迟。

仍需进一步打点:

- `stream.play()` 返回到第一次 callback 执行的间隔。
- 第一次 callback 执行到 `position_frames` 增加超过 20 ms 的间隔。
- Windows/CPAL 默认 shared-mode buffer wakeup 是否带来 100-200 ms 级恢复延迟。

## next-track 链路

benchmark 的 next 流程:

1. `/domain/queue` 设置两首歌。
2. `/domain/queue/play` 播放第一首。
3. `/queue_next` 指定下一首预加载。
4. 等待 350 ms。
5. `/domain/queue/play_next`。
6. 等待 state 切到下一首并 `current_time > 0.02`。

关键代码事实:

- `/queue_next` 调用 `player.queue_next_with_credentials()`，它进入 `GaplessManager::queue_next()`，后台 decode 并写入 `pending_buffer`，完成后 `pending_ready=true`。
- audio callback 的 `try_activate_pending_gapless()` 只在自然 EOF / gapless 边界激活 `pending_buffer`。
- `/domain/queue/play_next` 当前调用 `load_queue_entry_for_playback(&data, entry, true)`。
- `load_queue_entry_for_playback` 进入 `player.load_with_credentials_and_autoplay()`。
- `load_with_credentials_inner` 第一件事之一就是 `GaplessManager::cancel_preload()`。

所以手动 next 的实际行为是:

`queue_next` 预加载 -> `play_next` 普通显式 load -> cancel pending preload -> 重新整首 decode/resample/loudness -> rebuild/start stream -> state progress。

这解释了为什么 `next-to-progress` 仍然是 1.3-1.6 s 级，而不是预加载命中后的几十毫秒级。

## 为什么 Electron 基线更快

Electron baseline 使用 HTMLMediaElement / Chromium media stack。对普通播放响应而言，它更接近 streaming-first-buffer: 只要媒体栈拿到足够数据就能推进 playback position。

Lyne 当前普通 load/next 路径则选择了播放前完成整首高精度处理:

- 解码成完整 `f64` buffer
- 可选预重采样
- loudness track mode 可能整首扫描
- 完整 DSP chain / output stream 准备

这带来可控 DSP 和离线处理一致性，但普通响应速度天然弱于 Chromium streaming media path。

## 优化方向

短期低风险:

1. 修 `/domain/queue/play_next`：如果 `pending_ready=true` 且 `pending_file_path` 与目标 entry 匹配，提供非 EOF 的 pending promote/swap 路径，而不是普通 load。
2. 给 benchmark 增加 phase timeline: request returned, `load_progress` 首次变化, 100%, `is_loading=false`, `last_decode_duration_ms` 更新, `position_frames` 首次 >0。
3. resume 增加 runtime diagnostic: `play_command_received`, `stream_play_returned`, `first_callback_after_play`, `first_position_after_play`。

中期:

1. load 路径支持 first-buffer playback，后台继续 decode/resample。
2. loudness 默认优先 ReplayGain/cache；没有 cache 时不要阻塞首次播放，可以先 0 dB 或短窗口估算，后台补全 EBU R128。
3. 显式 load 时复用同格式/同设备 CPAL stream，只替换 buffer/DSP state。

长期:

1. 统一 current buffer 和 pending buffer 的 promote API，让 queue/manual next/natural gapless 复用同一条低延迟切歌路径。
2. 将 preemptive resample 做成可按用户目标切换的质量/响应模式，而不是普通播放默认都走整首预处理。

## 当前判定

`load-to-progress`: 原因明确。核心是 full-track decode/resample/loudness-before-playback + stream start。

`next-track`: 原因明确。手动 next 没用 pending preload，而且会取消 pending preload 后重新 load。

`resume`: 原因部分明确。不是 route 慢，也不是 decode 慢；是 CPAL pause/play 后到 callback 推进 `position_frames` 的链路慢，并被 benchmark 等待 20 ms progress 与 polling 放大。需要更细 runtime timestamp 才能把 233 ms 拆到 stream resume、callback wakeup、state observe 三段。

## 2026-06-01 修复验证

本轮先落地两个最小修复:

1. shared-mode pause 改为 soft pause: `/pause` 只把 state 设为 `Paused`，不再暂停 CPAL stream；callback 在 Paused 时输出静音且不推进 `position_frames`。WASAPI/exclusive path 保持真实 pause。
2. 手动 `/domain/queue/play_next` 优先复用 `/queue_next` 的 pending preload。预加载开始时即发布 `pending_file_path`；如果 pending path 匹配但尚未 ready，手动 next 最多等待 4 秒，ready 后 promote pending buffer，不再取消预加载并重新 load。

验证文件:

- `apps/desktop/output/lyne-evidence/playback-latency-after-pending-wait-promote/playback-latency-benchmark.json`

10 ms polling 单轮结果:

- `play_resume_to_progress`: 28.549 ms。修复前 10 ms polling 是 232.762 ms，50 ms polling 是 370.677 ms。
- `queue_play_next_to_progress`: command returned 后 29.541 ms。修复前 10 ms polling 是 1332.260 ms，50 ms polling 是 1643.251 ms。
- `play_next` command latency: 1269.631 ms。这里不是重新 load，而是在 handler 内等待 in-flight pending preload 变 ready。报告中的 `command_message` 是 `Next queue entry started from preload`。
- `queue_status_before_play_next`: `pending_ready=false`，但 `pending_track_path` 已经是目标下一首。
- `queue_status_after_command`: current path 已切到下一首，pending 已清空。

解释:

- 从用户体感的“点击下一首到声音/进度推进”看，如果 pending 已 ready，则应接近几十毫秒；如果 pending 正在加载，则当前实现会等待 pending 完成，避免取消后重解码。
- 从 HTTP 口径看，`play_next` request latency 可能从 1-3 ms 变成等待 pending 的 1 秒级。这是有意取舍: 把原来 request 返回后偷偷重解码的等待，改成显式等待正在进行的预加载并直接 promote。
- 后续 benchmark 应同时看 `request_latency_ms` 和 `switch_to_progress_ms`，不能只看其中一个。

### 锁边界二次修正

第一次 quick fix 里，`/domain/queue/play_next` 会在持有 `data.player.lock()` 时等待 pending preload 变 ready。这个版本能证明 pending promote 有效，但会在最多 4 秒等待窗口内阻塞依赖同一 player mutex 的 `/state`、pause、seek、volume 等请求。

已修正为:

1. 先短暂锁 player 取 `Arc<SharedState>`。
2. 释放 player lock 后，用 `actix_web::rt::time::sleep(10ms)` 异步等待 `pending_promotion_readiness`。
3. pending ready 后再次短暂锁 player，只执行 `promote_pending_if_matching` 和状态快照。

验证文件:

- `apps/desktop/output/lyne-evidence/playback-latency-after-unlocked-promote/playback-latency-benchmark.json`

10 ms polling 单轮结果:

- `play_resume_to_progress`: 28.310 ms。
- `queue_play_next_to_progress`: command returned 后 27.872 ms。
- `play_next` command latency: 1487.804 ms。`queue_status_before_play_next.pending_ready=false`，所以本轮仍是在等待 in-flight preload 完成后 promote。
- `command_message`: `Next queue entry started from preload`。
- `load-to-progress`: 2304.565 ms，仍未修复。
- `seek_convergence` p50: 0.696 ms。
- `diagnostics_delta.underrun_count`: 0。

解释:

- 相比修复前 10 ms polling，resume 从 232.762 ms 降到约 28 ms。
- manual next 的 state switch/progress 从 1332.260 ms 降到约 28-30 ms。
- 本轮二次修正没有改变“等待 pending preload”的用户语义，但移除了持有 `AudioPlayer` mutex 跨等待窗口的问题；这保护了控制面响应链路。
- 还没有专门的并发 benchmark 去量化“play_next pending 等待期间 `/state` 或 `/pause` 的延迟”，后续若要把这点写进 README，应补一个并发探针。

## 2026-06-01 phase timestamp 证据

为避免后续优化时说不清收益来源，本轮补了轻量 phase timestamp:

- `/diagnostics/runtime.snapshot.playback_phases.timestamps_ms`
- `/diagnostics/runtime.snapshot.playback_phases.durations_ms`
- benchmark 的 `load_to_progress` measurement 会记录 `phase_diagnostics_after_command` 和 `phase_diagnostics_at_success`

验证文件:

- `apps/desktop/output/lyne-evidence/playback-latency-phase-timestamps/playback-latency-benchmark.json`

10 ms polling 单轮结果:

- `load_to_progress`: 2240.282 ms，`/load` request latency 3.279 ms。
- `play_resume_to_progress`: 30.613 ms。
- `queue_play_next_to_progress`: command returned 后 19.307 ms。
- `play_next` command latency: 1173.648 ms，仍是等待 in-flight pending preload 后 promote；`command_message` 为 `Next queue entry started from preload`。
- `seek_convergence` p50: 1.402 ms。
- `diagnostics_delta.underrun_count`: 0。

`load_to_progress` 阶段拆分:

- `load_request_ms`: 1 ms。
- `request_returned_to_decode_start_ms`: 0 ms。
- `decode_ms`: 1009 ms。
- `decode_finished_to_loudness_start_ms`: 10 ms。
- `loudness_ms`: 967 ms。
- `loudness_finished_to_load_complete_applied_ms`: 0 ms。
- `load_complete_applied_to_stream_build_start_ms`: 231 ms。
- `stream_build_ms`: 23 ms。
- `stream_play_to_first_callback_ms`: 9 ms。
- `stream_play_to_first_position_advanced_ms`: 9 ms。
- `request_returned_to_first_position_advanced_ms`: 2249 ms。

结论:

- 本轮证据把 `load-to-progress` 的 2.24 s 拆开了: 最大头是 full-track decode/resample 约 1.01 s 和 loaded-track loudness 约 0.97 s。
- stream build/start 与 callback wakeup 合计约 32 ms，不是当前冷 load 的主要瓶颈。
- `LoadComplete` applied 到 stream build start 还有 231 ms，可能包含 command queue 调度、autoplay `Play` 命令排队、以及 benchmark/server 侧观测窗口；但即使完全消掉这段，冷 load 仍会被 decode + loudness 控在约 2 s。
- 下一轮若追求最小收益，应先做 loudness 后台化/非阻塞首播；若追求接近 Electron 的冷 load 响应，最终仍需要 streaming-first-buffer 播放内核。

## 2026-06-01 loudness 非阻塞首播修复

本轮根据 phase timestamp 证据，先修 `load-to-progress` 中最大的低风险阻塞项: loaded-track EBU R128 loudness 分析。

实现策略:

- ReplayGain tag 和 fresh loudness cache 仍同步应用，首播前可以得到准确初始 gain。
- 如果没有 ReplayGain/cache，首播先使用 0 dB target gain，不再同步跑整首 EBU R128。
- 完整 EBU R128 分析改到后台线程，完成后用现有 loudness smoothing 平滑更新 `target_gain_db`。
- 后台写回使用 `load_generation` guard；旧曲后台分析完成后不会污染新曲。
- diagnostics 增加 `background_loudness_started/finished/applied` 和 `background_loudness_ms`。

验证文件:

- `apps/desktop/output/lyne-evidence/playback-latency-background-loudness/playback-latency-benchmark.json`

10 ms polling 单轮结果:

- `load_to_progress`: 891.427 ms，修复前 phase timestamp 口径为 2240.282 ms，减少 1348.855 ms，约 60.2%。
- `/load` request latency: 3.393 ms。
- `play_resume_to_progress`: 35.209 ms。
- `queue_play_next_to_progress`: command returned 后 20.653 ms。
- `seek_convergence` p50: 1.311 ms。
- `diagnostics_delta.underrun_count`: 0。

阶段拆分:

- `decode_ms`: 659 ms。
- 同步 `loudness_ms`: 0 ms，修复前为 967 ms。
- `background_loudness_ms`: 最终 diagnostics 中为 801 ms。
- `background_loudness_finish_to_apply_ms`: 0 ms。
- `load_complete_applied_to_stream_build_start_ms`: 约 196-212 ms。
- `stream_build_ms`: 20 ms。
- `stream_play_to_first_position_advanced_ms`: 1-5 ms。

结论:

- “loudness 后台化/非阻塞首播”已经达成，并且是当前 cold load 响应的高收益修复。
- 冷 `load-to-progress` 现在主要剩余瓶颈是 full-track decode/resample 约 0.66-0.69 s，以及 `LoadComplete` 到 stream build start 的约 0.2 s。
- 若继续追求 Electron 级冷 load 响应，下一步应做 streaming-first-buffer 或至少快速播放模式禁用整首 preemptive resample；仅继续优化 stream build/callback 的收益已经很有限。

## 2026-06-02 output prepare 拆分与 shared-mode 快速路径

为确认 `LoadComplete` 到 stream build start 的约 0.2 s 空档，本轮增加了更细的 phase timestamp:

- `output_prepare_started`
- `output_prepare_finished`
- `load_complete_applied_to_output_prepare_start_ms`
- `output_prepare_ms`
- `output_prepare_finished_to_stream_build_start_ms`

结论:

- 空档不是 `LoadComplete` 应用慢，也不是 `Play` 命令排队慢。
- debug phase 验证中，`load_complete_applied_to_output_prepare_start_ms = 0`，`output_prepare_ms = 236 ms`，`output_prepare_finished_to_stream_build_start_ms = 0`。
- 这说明原来的 `load_complete_applied_to_stream_build_start_ms` 主要是 `prepare_playback_output()` 里的设备选择/输出配置协商，尤其是 shared-mode 下仍调用 `supported_output_configs()` 枚举。

修复:

- shared-mode 且请求采样率/声道数与 `device.default_output_config()` 完全一致时，直接使用设备默认输出配置。
- 不改 DSP、不改重采样、不改音质策略；只是跳过昂贵且重复的 supported config 枚举。
- exclusive-mode 保持原逻辑，因为独占模式仍需要更严格的支持格式协商。

验证文件:

- 定位用 debug 基准: `apps/desktop/output/lyne-evidence/playback-latency-output-prepare-debug-long/playback-latency-benchmark.json`
- 修复后 debug 轻量复测: `apps/desktop/output/lyne-evidence/playback-latency-output-prepare-fastpath-debug-load-only/playback-latency-benchmark.json`

debug phase 对比:

- 修复前 `output_prepare_ms`: 236 ms。
- 修复后 `output_prepare_ms`: 3 ms。
- 修复前 `load_complete_applied_to_stream_build_start_ms`: 236 ms。
- 修复后 `load_complete_applied_to_stream_build_start_ms`: 4 ms。
- 修复后 `stream_build_ms`: 34 ms。
- 修复后 `stream_play_to_first_position_advanced_ms`: 5 ms。

限制:

- 这次 release build 两次超时，`target/release/audio_server.exe` 仍是旧二进制，所以没有生成 release 口径的新增字段/fast-path 实测。
- debug 的 `load_to_progress` 绝对值不可与 release 对比；本轮只使用 debug phase 字段证明空档归因和 fast-path 是否生效。
- release 口径预期收益应接近把上一轮 196-212 ms 的 output prepare 成本压到个位数 ms，但需要下一次 release build 成功后再正式补证据。

## 2026-06-02 release 快速播放模式复测与 callback resampler 优化

本轮 release build 成功:

- 命令: `cargo build --release --bin audio_server`
- 结果: 通过，用时约 5m43s。

本轮先修快速播放模式的安全性和热路径成本:

1. `AUDIO_PREEMPTIVE_RESAMPLE=false` 时，源文件保留原采样率，播放时由 callback streaming resampler 转到设备输出采样率。
2. 旧实现会在 callback 中用固定 4096 源帧块重采样；对高倍率上采样会产生不必要 CPU 峰值和 leftover buffer 压力。
3. 新实现增加 `StreamingResampler::input_frames_for_output_frames()`，CPAL callback 和 WASAPI 输出循环按当前输出缓冲需求估算源帧数，并保留 64 帧余量和 256 帧下限。
4. 回归测试覆盖 96k -> 48k startup panic 场景，以及 44.1k -> 384k 高倍率上采样不再固定推进 4096 源帧。

验证命令:

- `cargo test processor::resampler --lib`: 13 passed。
- `cargo test player::callback --lib`: 15 passed。
- `cargo test player::state --lib`: 4 passed。
- `cargo test server::diagnostics --lib`: 2 passed。
- `cargo check --bin audio_server`: passed。

### 48 kHz FLAC 同轨 release 对照

文件:

- 快速模式: `apps/desktop/output/lyne-evidence/playback-latency-preemptive-off-release-demand-resampler/playback-latency-benchmark.json`
- 预重采样对照: `apps/desktop/output/lyne-evidence/playback-latency-preemptive-on-release-demand-resampler-control/playback-latency-benchmark.json`

结果:

- 快速模式 `load_to_progress` p50: 565.086 ms，max: 667.557 ms。
- 预重采样对照 `load_to_progress` p50: 501.509 ms，max: 572.592 ms。
- 两者 `output_prepare_ms`: 4 ms。
- 两者 `underrun_count`: 0。
- 两者最终播放采样率都是 48000 Hz。

解释:

- 这首 FLAC 本身就是 48 kHz，和设备默认配置一致，快速模式不会节省整首预重采样。
- 这类曲目上快速模式不应强行默认启用；它主要是安全可用，但不一定更快。

### 44.1 kHz MP3 同轨 release 对照

文件:

- 快速模式: `apps/desktop/output/lyne-evidence/playback-latency-preemptive-off-release-demand-resampler-mp3/playback-latency-benchmark.json`
- 预重采样对照: `apps/desktop/output/lyne-evidence/playback-latency-preemptive-on-release-demand-resampler-mp3-control/playback-latency-benchmark.json`

结果:

- 快速模式 `load_to_progress` p50: 940.823 ms，max: 993.651 ms。
- 预重采样对照 `load_to_progress` p50: 1511.788 ms，max: 1580.104 ms。
- 快速模式 `decode_ms`: 691 ms，输出样本数 32,382,814，播放采样率 44100 Hz。
- 预重采样对照 `decode_ms`: 1315 ms，输出样本数 35,245,490，播放采样率 48000 Hz。
- 快速模式峰值 CPU: 12.029%，峰值 working set: 532.3 MiB。
- 预重采样对照峰值 CPU: 14.079%，峰值 working set: 544.0 MiB。
- 两者 `underrun_count`: 0，server `exit_code`: 0。
- resume p50 基本一致: 快速模式 29.331 ms，对照 29.511 ms。
- seek p50 基本一致: 快速模式 1.464 ms，对照 1.730 ms。

解释:

- 对 44.1 kHz -> 48 kHz 这类需要重采样的曲目，快速模式把整首预重采样从 load 阶段移到 callback streaming resampler，冷 load p50 从 1511.788 ms 降到 940.823 ms，减少约 37.8%。
- 本轮按需源帧估算避免了固定 4096 帧重采样块的过度处理，验证中未出现 underrun。
- 但快速模式仍是 full-track decode-before-playback，因此 MP3 冷 load 仍接近 1 秒；真正接近 Electron/Chromium streaming media 的 50-300 ms 首播响应，仍需要 streaming-first-buffer 播放内核。

当前判定:

- 快速播放模式可以作为可选响应优先模式保留，并对需要重采样的曲目有 release 级正收益。
- 不建议全局默认替换 `preemptive_resample=true`；更合理的是按曲目/设备条件自适应，或在 UI 中明确区分“响应优先”和“预处理质量/缓存优先”。
- 下一轮若继续压冷 load，收益最大的方向不是 stream build/callback，而是 streaming-first-buffer: 边解码边填充播放队列，首批 buffer 满足后立即开播，完整 decode、loudness 和缓存写入全部后台化。

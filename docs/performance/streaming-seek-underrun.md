# Streaming Seek Underrun: Root-Cause Analysis

Date: 2026-06-04

本文记录 streaming memory-mode seek 在 RT-safety 改造（v40/v41）后出现的
underrun 根因分析与修复方案。结论针对当时的代码路径，引用的 `file:line`
为分析时的快照，后续重构可能已失效，引用前请对照当前代码核实。

## 结论速览

- 产生点：`render_streaming_audio_output` 里，仅当 `streaming_active && frames_read==0 && !streaming_decode_finished && !is_loading` 四个条件同时成立时记一次 underrun（`callback.rs:1017-1026`）。这是 seek 之后、播放已恢复（`is_loading` 已清零）但解码 worker 还没把下一块 chunk 推进队列的窗口。
- 根因：seek 恢复点的预缓冲是固定的 8192 帧（≈186ms@44.1k，2 个 chunk）（`loading.rs:29`），而且恢复后没有任何连续的低水位/重缓冲保护。warm 流的 callback 以实时速率消费这 186ms，解码 worker 在 ready 握手期间（`loading.rs:617`）空转不生产，且每次 seek 都从头重开解码器（`mod.rs:620`）。偶发的调度抖动让 worker 在恢复瞬间晚了"一个回调周期"，cushion 被抽干一拍 → 老实输出静音 → 记为 underrun。
- 为什么 v40/v41 才冒出来：RT-safety 把"取不到数据就 spin 音频线程"改成了"立刻返回静音"，又加了 callback 心跳抑制 watchdog 重建流。同一个 seek 缺料窗口，以前被"卡住→watchdog 重建流"掩盖成 recovery，现在如实显形成 underrun。underrun 计数代码本身是旧的、没改。
- 能否清零：度量上很可能能压到 0，且几乎不付出性能代价——因为每次缺口只有 ~5ms（一拍），属于"晚了一点"而非"结构性缺料"。但工程上无法证明恒为 0：任何实时音频在足够的 CPU 饥饿/OS 抖动下都会 underrun，这正是当初要 recovery 的原因。务实目标是"罕见到可忽略"，而不是"数学上为零"。

---

## 1. underrun 到底在哪里被记

两条渲染路径各有一处计数器：

- streaming 路径（本问题所在）`callback.rs:1017-1026`：

```rust
if frames_read == 0 {
    if streaming_decode_finished { streaming_active = false; }       // 正常 EOF，不记
    else if !is_loading {
        audio_underrun_count += 1;                                   // ← 这里
        audio_underrun_silence_frames += (output_len - written)/ch;
    }
    break;
}
```

- full-buffer 路径 `callback.rs:873-878`（本问题用不到，memory 模式不发布全缓冲）。

关键闸门是 `is_loading`：只要它为 true，空队列就只静音、不计数（这是 seek 刷新期间的正常保护）。underrun 只发生在 `is_loading` 已经清零之后的空队列。

## 2. memory-mode seek 的真实时序

seek 不走 `AudioCommand::Seek`（那条只服务全缓冲路径）。`AudioPlayer::seek()`（`mod.rs:719`）在 `streaming_memory_mode && streaming_active` 时改调 `restart_memory_streaming_at`（`mod.rs:726`）——推倒旧 worker、从新位置重开一个。

服务器线程（持播放器锁）在 `prepare_memory_streaming_seek` 里顺序执行（`mod.rs:560-598`）：

1. `cancel_current_load()`（`mod.rs:560`）：`is_loading=false`、取消旧 worker、`reset_streaming_state()` 排空 `streaming_chunks` 并置 `streaming_active=false`。
2. `streaming_generation` 自增到新代（`mod.rs:570`）、`streaming_decode_finished=false`、`streaming_memory_mode=true`。
3. `streaming_active=true`（`mod.rs:584`）、`audio_buffer=空`、`position=target`、`state=Playing`（`mod.rs:592`）、`is_loading=true`（`mod.rs:593`）。
4. `thread::spawn` 新解码 worker（`mod.rs:620`）。输出流原封不动、保持热运行。

解码 worker（`decode_file_streaming_first_buffer`）：

5. seek 解码器到目标位置，按 4096 帧/块往队列推，ready 前封顶 8192 帧（`loading.rs:601-602`）。
6. `queued_frames >= 8192` 时发 `StreamingLoadReady`（`loading.rs:613-614`），memory 模式下随即阻塞在 `wait_for_streaming_ready_applied`（`loading.rs:617`）——握手期间不生产。
7. 握手返回后才继续推后续 chunk（`loading.rs:619`）。

音频命令循环处理 `StreamingLoadReady`：`mark_streaming_ready`（唤醒 worker，`command_handlers.rs:570`）→ `is_loading=false`（`command_handlers.rs:572`）→ 返回后 `backend.play()`（`command_handlers.rs:474`）。

`streaming_decode_finished` 全程为 false，只有整轨解码完时在 `StreamingLoadFinished` 里才置 true（`command_handlers.rs:601`）。

## 3. 为什么会 underrun（精确机理）

恢复瞬间（`is_loading` 翻到 false）队列里恰好只有预缓冲的 8192 帧 ≈ 186ms，因为 ready 前被封顶、握手期间 worker 又空转没补。之后：

- warm 流的 callback 以实时速率消费这 186ms；
- worker 在 `mark_streaming_ready` 被唤醒（就在 `is_loading=false` 前一拍），开始补 chunk。解码远快于实时，正常情况下队列会越喂越深；
- 但恢复后没有任何"低水位重缓冲"保护（唯一的流控是队列满 128 块时 2ms 背压，`loading.rs:30/968`）。一旦 worker 因为下面任一原因在恢复后的头几拍里晚了一个回调周期，队列被抽空一拍，就命中 `callback.rs:1020` 记一次 underrun：
  - a. 握手空转：`loading.rs:617` 阻塞期间 worker 不生产，cushion 在恢复点就是"刚好 186ms"没有余量；
  - b. 每次 seek 从头重开解码器 + 重建 resampler（`mod.rs:620` → `StreamingDecoder::open...`），seek 压力下反复重开吃掉 CPU，恢复后补料的第一拍容易迟到；
  - c. 线程切换抖动：worker 被唤醒到真正被调度、推出第 3 块 chunk 之间的延迟。

量化佐证：v40/v41 每次 underrun 仅 ~207/239 帧 ≈ 一个 ~5ms 输出回调周期的静音。这说明不是"长时间缺料"，而是恢复瞬间 worker 晚到一拍——cushion 余量为零时的擦边球。

## 4. 为什么是 RT-safety 之后才显形（recovery → underrun 的转化）

- 以前：取不到数据时音频线程 `continue` 空转（旧 `callback.rs` full-buffer 路径，total 没夹到真实缓冲），callback 不干净返回 → streaming watchdog 发现无进度 → 发 `EnsurePlaybackProgress` 重建流，记为 `playback_recovery_count`。缺料被"卡住+重建"掩盖了。
- 现在（`c148b7c`）：① total 夹到真实缓冲、`continue` 改 `break`，callback 立刻返回静音；② callback 顶部新增 `mark_output_callback_activity()` 心跳（`callback.rs:1162`），watchdog 一旦观测到 callback 还活着就 Stop、不再重建流（`state.rs:947` + loading watchdog）。于是同一个 seek 缺料窗口不再被重建掩盖，而是如实落到旧的 underrun 分支。
- underrun 计数代码本身两版逐字节相同，是预先存在的；变的只是"到达这条分支的频率"。回归测试 `callback_streaming_empty_queue_records_underrun_before_decode_finishes`（`callback.rs:1758`）已把这个新行为钉死。

所以这是一个真实权衡，不是新 bug：以前的 recovery 是在用"重建流"掩盖真实缓冲缺口；现在缺口诚实地显示成 underrun。

## 5. 能否清零？三方张力与务实判断

存在一个三角张力，三个量不能同时最优：

| 杠杆 | underrun | seek 延迟 | recovery |
| --- | --- | --- | --- |
| 预缓冲 ↑ | 降 | 升 | 不变（心跳压着） |
| 预缓冲 ↓ | 升 | 降 | 历史上会升 |
| spin/重建掩盖（旧行为） | 表面 0 | — | 升 + 违反 RT 安全 |

- 度量层面：因为每次缺口只有 ~5ms（一拍），把恢复点的余量从"刚好 186ms"抬高一点点，就足以让 worker 的迟到被吸收 → 基准里很可能直接归零。
- 不会重新引入 recovery：只要 callback 还在跑（warm 流一直在跑），心跳就压着 watchdog，加大 cushion 不会触发重建。
- 工程层面无法保证恒为 0：实时音频在极端 CPU 饥饿下仍可能 underrun——这本就是 recovery 机制存在的理由。所以正确目标是"罕见到可忽略 + 真发生时能快速恢复"，而非"证明为 0"。

## 6. 推荐方案（按性价比排序）

零延迟代价、应优先做：

- **R1 — 握手期间不要停产**（`loading.rs:616-618`）。memory 模式发完 ready 后让 worker 继续解码推 chunk（chunk 按 generation 打标，callback 会忽略非当代，安全），而不是阻塞空转。这样恢复点的 cushion 会 >186ms，直接吸收那"一拍"的迟到。几乎零成本，最对症。
- **R3 — seek 不要每次从头重开解码器**。复用现有 decoder 的 `format_reader.seek` 而非 `restart_memory_streaming_at` 重 spawn + 重 open（`mod.rs:620`/`loading.rs:456`）。减少 seek 压力下的重开开销 → 恢复后补料更快。延迟反而更低，但改动较大、涉及 worker 生命周期。
- **防御性 reorder**：把 `is_loading=true`（`mod.rs:593`）移到 `streaming_active=true`（`mod.rs:584`）/`state=Playing`（`mod.rs:592`）之前，关掉服务器线程改状态那一拍纳秒级窗口。免费的 belt-and-suspenders。

可靠但有界延迟代价：

- **R2 — 适度增大恢复预缓冲** `STREAMING_START_BUFFER_FRAMES`（`loading.rs:29`，8192→如 12288/16384）。最直接保命，但会按比例抬高 seek 收敛延迟（p50 ~19ms 可能升到 ~30–40ms）。建议与 R1 合用：有了 R1 在握手期间持续补料，cushion 自然变大，就不必把这个常数硬调很高。

仅作度量卫生（不建议单独用）：

- **R4 — 消费侧重缓冲/宽限**：mid-stream 首次空队列时给一个 grace 不计数。这只是"不数"，静音仍可闻，不解决听感。用户要的是真清零，不是藏指标，故只作辅助。

建议：先上 R1 + 防御性 reorder（零成本），大概率就把基准的 6–7 次打到 0；若仍有零星残留，再叠加 R2 的小幅上调。R3 作为后续性能正向的结构性改进单独立项。

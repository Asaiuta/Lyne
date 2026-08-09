# Design — Streaming v2 默认化 + gapless 预取桥接

## 背景事实（代码考古确认）

- v2 会话（`PersistentStreamingSession`）解码窗口满后 producer **自动 park 退避**（`SlotBusy/NotReclaimable → park_timeout`，session.rs:558-570）——无需为 preload 改 producer。
- v2 当前**无换轨预取**：callback 只在 `!streaming_active` 时跑 `request_gapless_preload_if_needed` / `try_activate_pending_gapless`（legacy pending buffer）；v2 EOF 直接 `Stopped + playback_end_count++`（callback.rs:1385-1393）。design.md §18 明确"future pending PCM-window session"未实现。
- legacy 换轨原子性：callback 内 `shared.audio_buffer.swap(next)` + `request_seek_to_frame(0)`，无锁。
- `StreamingRtView` 经 `ArcSwapOption` 发布；retire 队列（`RetiredAudioResource::StreamingRtView / Window`）已有，callback 侧退役安全。
- 预取触发器已存在：server supervisor 每 ~250ms 见 `needs_preload && !pending_ready` → `queue_next_from_persistent_queue` → `Player::queue_next_with_credentials` → `GaplessManager::queue_next`（legacy decode）。

## 设计

### 1) SharedState 新增字段（state.rs）
- `streaming_pending_v2_rt: ArcSwapOption<StreamingRtView>` —— preload 会话 RT 发布槽（RT 侧可消费）。
- `streaming_pending_ready: AtomicBool` —— preload 已可用（语义同 legacy `pending_ready`，用于触发与 supervisor 判据）。
- `streaming_swap_requested: AtomicBool` —— callback 已换轨，audio thread 需同步 `self.streaming_session`。

### 2) AudioCommand
- `InstallPendingStreamingV2Session { generation: u64, session: Box<PersistentStreamingSession> }`
- `CancelPendingStreamingV2Session`
处理（audio_thread）：
- Install: generation 与 `load_generation` 不匹配 → retire；否则 `pending_streaming_session = Some(session)` + 发布 `pending_v2_rt`（clone rt）+ `pending_ready=true`。
- Cancel：清槽 + retire（若 `swap_requested` 已置位则不 retire，交给换轨流程）；发布槽清空。
- **install_streaming_session（新 active）入口先 cancel pending**（防止新旧会话叠存）。
- 主循环每迭代先消费 `swap_requested` → `self.streaming_session = pending.take()`（旧的回 retire）+ `pending_ready=false`。seek/install 命令均在其后处理。

### 3) preload 触发（PlaybackConfig / Player）
`queue_next_with_credentials` 内：若 `shared.streaming_v2_enabled` 且 config `streaming_first_buffer` → 走 v2 预取：
- 打开 source（Local / RemoteHttp，policy 同 load 路径），`PersistentStreamingSession::start_local_with_capacity`（capacity = `streaming_pcm_window_limit_mib`，target sr/ch = 当前 active 会话值），
- `cmd_tx.send(InstallPendingStreamingV2Session)`。
- legacy 分支不变。
- 重复/已就绪判据沿用现有（queue_next 开头 `pending_ready` 早退；v2 加 `streaming_pending_ready` 一致判据）。

### 4) callback 换轨（callback.rs）
`v2_at_eof` 分支，先试 `try_activate_pending_v2(shared, dsp_chain, ..)`：
1. `shared.streaming_pending_v2_rt.load()` → None → false；
2. rt ready 检查：`decode_state == Ready`（或 EndOfStream 尾部亦可换：全曲 < 窗口）；
3. 独占消费：`streaming_pending_v2_rt.store(None)`；
4. `let old = streaming_v2_rt.swap(Arc::clone(&pending))`；`retire_audio_resource(StreamingRtView(old))`；
5. 原子重置（仿 legacy swap）：`request_seek_to_frame(0)`、`dsp_reset_pending`、`total_frames/sample_rate/channels` 从 pending rt 读（geometry/channels/sr via session 原值——callback 通过 rt 内 ProducerPublished 读? total_frames 需要 session 侧总帧数 —— rt 不含 total_frames；解决：pending 槽同时把 `total_frames` 放 shared 原子 `streaming_pending_total_frames`（audio thread 发布时写）。
6. `streaming_swap_requested=true`；`event_flags |= EVENT_TRACK_CHANGED | EVENT_NEEDS_PRELOAD_RESET`；`pending_ready=false`；`needs_preload=false`。
7. 返回 true（填 0 调用帧，下一帧起新轨）。
8. 失败（未就绪）→ 原逻辑（STOP/end_count）。

**触发点**：`request_gapless_preload_if_needed` 条件从 `!streaming_active` 放宽（v2 下同工作），剩 ~5s → `needs_preload=true`；supervisor 到 queue_next → v2 preload 链。**再触发节流**：已有条件 `needs_preload && !pending_ready`；v2 加 `!streaming_pending_ready`。

### 5) 取消路径
- `GaplessManager::cancel_preload` 同时发 `CancelPendingStreamingV2Session`（清 pending rt/ready、retire 会话）。
- 新 load（generation++）：`install_streaming_session` 前 cancel pending（已含在 3）。
- 会话 zombie：pending 保留到换轨或取消；无泄漏路径（audio thread 拥有）。

### 6) 内存账
preload 窗口=1 个窗口容量（≤ `streaming_pcm_window_limit_mib`），owner `PendingPlayback`（memory.rs 已有 optional 记账位）。整机峰值 = 双窗口（active + pending）→ 预算可选位已允许失败 → 无峰值风险。

### 7) 默认化（config）
- `EngineSettings::default().streaming_first_buffer = true`
- `env_flag("AUDIO_STREAMING_FIRST_BUFFER", true)`（允许 false 回滚）
- 窗口默认保持 `streaming_pcm_window_limit_mib: 128`（trim 已落）
- UI/设置端无字段（JSON settings 缺失字段 → 引擎默认生效）→ 检查 audio_settings.rs persist 不强制覆写。

### 8) 风险与回滚
- 行为差异回归面：seek/gapless/preload/流媒体 URL/频谱/暂停恢复/EQ；
- 回滚 = `AUDIO_STREAMING_FIRST_BUFFER=false` 或 config 一行。

## 验收数据流
剧本（现有 scene-images 基建）：本地库列表连播 2 曲 → 断言 ledger 出现 `pending playback` owner 且播放无 gap（计时/underrun 计数）；随后 seek/暂停/音量回归；WMI 内存对照（v2 默认 vs legacy env 关）。
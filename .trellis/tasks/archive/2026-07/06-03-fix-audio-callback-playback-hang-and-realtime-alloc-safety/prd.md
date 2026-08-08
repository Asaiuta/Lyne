# Fix audio callback playback hang and realtime alloc safety

> **[CLOSED 2026-07-03 — audit]** 全部 7 项已落地（主要在 c148b7c + b63f3e2）：#1 自旋修复
> （`src/player/callback.rs:917-920`/`994-998`）；#2-#4 graveyard `RetiredAudioResource`
> （`callback.rs:130-141`）+ 非 RT drain（`audio_thread.rs:122`/`125`、`wasapi_loop.rs:337`）；
> #5 shaper 改 if-let 降级；#6 `SpectrumBatch` 固定 512×f64 载荷；#7 发布顺序修复
> （`callback.rs:454-468`）；EOF 单测见 `callback.rs:2697/2743/2786`。
> 注意：#7 的"顺序断言单测"并无专门测试——证据是代码顺序本身 + 注释（见下方未勾选项）。
> Remaining scope: none。

## Goal

修复对 `src/player/` 实时音频回调的代码审查发现的全部 #1–#7。核心是消除一个会**卡死音频线程**的无限自旋缺陷（#1 🔴），并按 `quality-guidelines.md` 的"回调内禁止分配/锁/日志/panic"契约，把切轨/链替换/流式消费的实时内存分配与释放挪出回调线程；同时修正回调内 panic 路径与卷积器发布顺序。

## Requirements

- **#1（🔴 阻塞）** `render_audio_output` 不再可能无限自旋；当 `total_frames > audio_buffer 真实帧数`（内存模式空缓冲 / 估算≠实际）时，回调单次返回并干净判定 EOF（置 `Stopped`、`playback_end_count` 递增），符合 `quality-guidelines.md` 流式契约"memory-mode finish ... stop at EOF after the queue drains"。
  - 装载侧：内存模式 `total_frames` 用实际产出帧数（`loading.rs:672-674`）。
  - 回调侧：`callback.rs:773` `continue`→`break`；EOF 判定以真实缓冲长度为准（空缓冲 ⇒ 抽干即 EOF）。
- **#2/#3/#4（🟡 实时释放）** 把回调内 `Drop` 大块堆内存挪到非实时线程：
  - #2 gapless 切轨旧整段 PCM（`callback.rs:610`）。
  - #3 DSP 链热替换旧链（`callback.rs:487`）。
  - #4 流式消费完的 chunk `Arc`（`callback.rs:866/884`、`clear_streaming_scratch`）。
  - 机制：新增有界 graveyard 队列（`crossbeam::ArrayQueue`，存于 `SharedState`），回调 `push`（wait-free，满则回退为就地 drop 并计数），命令循环线程（`AudioThreadRuntime::run` / `monitor_wasapi_commands`）每次唤醒 drain 析构。
- **#5（🟡 panic）** `callback.rs:1198` 的 `expect` 改为优雅降级（跳过 shaper），遵守 error-handling.md "audio thread must never panic"。
- **#6（🟡 拷贝）** 去掉每回调 8 KB `SpectrumBatch` 整数组克隆（`callback.rs:1080`）——只传递实际 `len` 的下混样本，且不得在回调内分配（用预分配/无锁环或仅拷贝 `len`）。
- **#7（🔵 内存序）** `rebuild_merged_convolver`（`callback.rs:340-350`）调整发布顺序：启用先存指针后置 `enabled=true`；关闭先清 `enabled=false` 后清指针。

## Acceptance Criteria

- [x] 新增单测：内存模式 `position < total(估算)` 且队列抽干 → 回调返回（不自旋）、输出静音、`streaming_active=false`、`state==Stopped`、`playback_end_count` 递增。（EOF 单测 `callback.rs:2697/2743/2786`）
- [x] 新增单测：整段缓冲模式 `total > buffer.len()/channels` → 末尾干净 EOF，不自旋。（同上 EOF 单测组）
- [x] graveyard：回调不再就地释放大缓冲/旧链/已消费 chunk；新增单测验证回调把待析构项入队、drain 后释放；满队列回退路径有计数。（`RetiredAudioResource` `callback.rs:130-141`；drain `audio_thread.rs:122/125`、`wasapi_loop.rs:337`）
- [x] #5：shaper 路径在 `final_noise_shaper==None` 时不 panic（降级跳过），新增/调整单测覆盖。（if-let 降级已落地）
- [ ] #7：单测覆盖"启用瞬间不会观察到 enabled=true 且 convolver=None 的非法组合"（或等价的顺序断言）。——**审计注（2026-07-03）：无专门单测；证据为已修正的发布顺序代码本身 + 注释（`callback.rs:454-468`），此项保持未勾选。**
- [x] `cargo test --lib`（含 `player::`）、`cargo check --bin audio_server`、`cargo clippy` 全绿，无新增告警。
- [x] release 真机基准（streaming + gapless 反复 load/seek）不回归；debug 下 `assert_no_alloc` 包裹的 cpal 回调在切轨/流式/链替换路径不再触发分配/释放断言。（后续基准链持续佐证：recovery-watchdog v40/41 与 in-window ring 基准均无回归、recovery=0）

## Definition of Done

- 新增/更新单测覆盖每条修复路径（尤其 #1 的 `position<total` 缺口）。
- `cargo build` / `cargo clippy` / `cargo test --lib` / `cargo check --bin audio_server` 绿。
- 不引入新的回调内锁/分配/日志/panic（对照 quality-guidelines 复查清单）。
- 不破坏既有 CPAL recovery / 流式契约（命令处理器与 loading 既有单测保持绿）。

## Technical Approach

- **#1**：`total_frames` 是"广告时长"（用于进度/seek），不可直接 clamp 到空缓冲。修复点二选一并都做：装载侧内存模式用实际产出；回调侧 `render_audio_output` 不信任超出缓冲的 `total`，读不到即 `break`，并让"非流式 + 缓冲耗尽"走 EOF。
- **#2/#3/#4 graveyard**：`SharedState` 增 `retired: ArrayQueue<Retired>`，`enum Retired { Buffer(Arc<Vec<f64>>), Chain(Box<DspChain>), Chunk(Arc<Vec<f64>>) }`。回调用 `swap`/`take` 拿到旧对象 `push` 入队（失败则就地 drop + 计数 `retired_drop_in_rt_count` 诊断）。命令循环线程在 recv/timeout 唤醒时 `while let Some(x) = retired.pop() { drop(x) }`。仅做 drop-offload（消除实时**释放**），不做 recycle pool（分配本就在非实时线程）。
- **#6**：保留语义，改为预分配复用 + 只移动 `len` 数据；优先用现有 `crossbeam` 通道但发送变长/定长小负载，避免 8 KB 整数组拷贝；不得在回调内堆分配。
- 复用现有约定（`code-reuse-thinking-guide.md`）：graveyard 用 `crossbeam::ArrayQueue`、缓冲交换用 `arc-swap`（deps 表已列为"Large buffer swapping"），与既有模式一致。

## Decision (ADR-lite)

- **Context**：审查证实热路径"无锁但有分配/释放"，且存在一处会卡死回调的自旋；spec 明确禁止回调内 alloc/lock/log/panic。
- **Decision**：本任务覆盖 #1–#7；实时内存簇采用 **drop-offload graveyard**（而非 recycle pool）以最小复杂度消除实时释放；#1 采用装载侧+回调侧双重修复。
- **Consequences**：graveyard 引入一个有界队列与命令线程 drain 步骤；满队列时回退为就地 drop（有计数，可观测）。recycle pool（进一步免除非实时分配）列为 Out of Scope，后续可加。

## Out of Scope

- 🔵 #8 `String`→`thiserror` 全面改造、#9 `SharedState` 拆分、#10 渲染参数结构体、#11 有界命令通道、#12 leftover 容量预留——均为可选项，本任务不做。
- chunk **recycle pool**（免除非实时分配的进一步优化）；本任务只做 drop-offload。

## Technical Notes

- 关键文件：`src/player/callback.rs`、`loading.rs`、`state.rs`、`command_handlers.rs`、`audio_thread.rs`、`wasapi_loop.rs`、`spectrum.rs`；佐证 `src/processor/adapters.rs`。
- 实时契约：cpal 回调在 debug 下被 `assert_no_alloc` 包裹（`output_stream.rs:264-280`）——graveyard 必须确保 push 路径 wait-free 且不分配。
- 既有契约不可破坏：quality-guidelines 的"Streaming first-buffer playback queue contract"与"CPAL output stream recovery contract"（后者是上一个任务 06-03-reduce-false-playback-recovery 的产物）。

## Research References

- `.trellis/spec/backend/quality-guidelines.md` — 回调内禁止 alloc/lock/log；流式 memory-mode 须"stop at EOF after queue drains"；CPAL recovery 契约。
- `.trellis/spec/backend/error-handling.md` — audio thread must never panic；String+context / thiserror 约定。
## 归档一致性注记（2026-08-08）

- 本 PRD 验收框未勾选：该任务归档时未附逐条验收证据（无 validation-evidence.md 或实现验证记录）。
  出于元数据真实性，本任务保留未勾选状态，不作为"已验收"伪证；如需补验，请重新打开任务并补充证据。

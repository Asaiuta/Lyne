# Player: seek race on position_frames + streaming-window seek + DSP reset

## Goal

Make seeks reliable: eliminate the multi-writer lost-update race on `position_frames` that silently drops full-buffer seeks, fix seeks issued during the streaming-first-buffer window (position jumps but audio doesn't), and reset DSP/resampler state on full-buffer seeks.

## Requirements (review findings M1, M2, m3)

**R1 — seek must never be lost to the callback's position stores (M1, MAJOR).**
`position_frames` has three unsynchronized writers: server thread (`AudioPlayer::seek`, mod.rs:938-944), audio-command thread (`AudioCommand::Seek` handler, command_handlers.rs:269-277), and the audio callback (loads position once at callback start, callback.rs:1392, then stores incremented values, callback.rs:927-931). A seek store landing between the callback's initial load and one of its stores is silently overwritten (~1-5% of full-buffer seeks vanish). The streaming path avoids this via `streaming_generation` bump + clean-stop; the full-buffer path has no equivalent.
Required: a protocol under which the callback can never overwrite a newer seek — e.g. a dedicated seek-request slot (target + serial/generation) consumed by the callback at the top of each invocation, and/or generation-tagged position stores the callback validates before writing. The chosen design must also cover the (server-thread seek) vs (command-thread seek) writer pair.

**R2 — seek during streaming-first-buffer window must move the audio, not just the counter (M2, MAJOR).**
`seek()` (mod.rs:923-937) routes to streaming rebuffer paths only when `streaming_memory_mode && streaming_active`. For a full-buffer streaming load (`streaming_first_buffer=true`, memory_mode=false), `streaming_active` is true but the plain path runs: `position_frames` is stored and `AudioCommand::Seek` sent, while the callback is on the streaming render path playing sequential chunks regardless of position (callback.rs:1188-1192). UI jumps, audio continues pre-seek; when `StreamingLoadFinished` publishes the full buffer, playback snaps to target+Δ.
Required: when `streaming_active && !memory_mode`, either route through the restart/rebuffer path, or defer/queue the seek until the full buffer is published and then apply it exactly at target.

**R3 — full-buffer seek must reset DSP state (m3, MINOR).**
`AudioCommand::Seek` (command_handlers.rs:269-277) doesn't set `dsp_reset_pending`; `scratch.resample_leftover` still holds pre-seek output (played first after the seek) and IIR/EQ/convolver/limiter state bleeds across the discontinuity. The streaming seek path sets it (mod.rs:657-659). Set `dsp_reset_pending` (or at minimum clear the resample leftover) on the full-buffer seek path too.

## Acceptance Criteria

- [ ] A stress test (unit or integration, following existing callback-test patterns in the repo) that interleaves seek stores with simulated callback position updates and asserts no seek is ever lost — red on the old code shape, green after.
- [ ] Seek during the first-buffer window: covered by a test that drives the streaming state machine (streaming_active, !memory_mode) and asserts the effective play position after full-buffer publish equals the seek target (no +Δ skip).
- [ ] `dsp_reset_pending` (or equivalent leftover-clear) observable after a full-buffer seek — assert in a test.
- [ ] All existing player tests pass; `cargo test` green.
- [ ] Benchmark gate (project rule): run the project's seek/playback benchmark before commit; no regression vs. baseline (record numbers in implement.md). The fix adds at most an atomic load per callback iteration — expected noise-level.
- [ ] No new locks or allocations on the audio callback path (assert_no_alloc-compatible; atomics only).

## Constraints

- RT discipline: callback stays lock-free; use atomics/generation counters consistent with the existing style (`streaming_generation` is the in-repo precedent).
- Beware the young-monotonic-epoch footgun for any new time-based sentinel (`==0` means "possibly just young clock") — prefer serial counters over timestamps.
- Do not conflate with in-flight task 06-04-streaming-seek-pcm-ring; this task fixes the full-buffer/plain paths, not the streaming PCM ring design.
## 归档一致性注记（2026-08-08）

- 本 PRD 验收框未勾选：该任务归档时未附逐条验收证据（无 validation-evidence.md 或实现验证记录）。
  出于元数据真实性，本任务保留未勾选状态，不作为"已验收"伪证；如需补验，请重新打开任务并补充证据。

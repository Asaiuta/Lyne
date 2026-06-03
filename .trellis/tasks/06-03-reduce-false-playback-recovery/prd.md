# Reduce False Playback Recovery Triggers

## Goal

Reduce false `EnsurePlaybackProgress` recovery triggers in the streaming first-buffer playback path, while preserving the stable CPAL recovery policy introduced by the previous task.

## What I Already Know

- The previous task made recovery stable by parking old CPAL streams instead of synchronously dropping them during active playback.
- Real FLAC stress v22 passed with zero underruns, but still reported `playback_recovery_count=8`.
- False recovery is now the main remaining weakness: it is stable but may rebuild output streams unnecessarily during load/seek stress.
- Recovery must not be optimized by releasing/dropping parked streams during active playback; v21 proved that can reintroduce seek convergence timeouts.
- Relevant backend contract lives in `.trellis/spec/backend/quality-guidelines.md` under the CPAL output stream recovery section.

## Requirements

- Identify why `EnsurePlaybackProgress` fires when playback is healthy or still legitimately waiting for first callback/progress.
- Make the watchdog generation-aware and phase-aware enough to avoid false recovery during normal streaming ready/play/load transitions.
- Preserve real recovery when the active stream is actually stuck after playback has been requested.
- Keep all audio callback changes lock-free and allocation-free.
- Expose or preserve diagnostics needed to explain recovery decisions.
- Do not change the parked stream release policy during active playback.

## Acceptance Criteria

- [x] Unit tests cover stale, already-progressed, waiting, and real-stuck watchdog decisions.
- [x] `cargo check --bin audio_server` passes.
- [x] Targeted player command/callback/state/loading tests pass.
- [x] `cargo test --lib` passes.
- [x] A real-file stress benchmark records that recovery count did not reduce below the prior v22 baseline; the remaining 8 recoveries happen after `stream.play()` returned and no first callback/progress arrived beyond the grace window, so they are not the early false-trigger class fixed here.

## Definition of Done

- Tests added/updated for watchdog decision behavior.
- Backend quality guidelines updated if the recovery contract changes.
- Research/benchmark notes updated with before/after evidence.
- Dirty worktree boundaries preserved; unrelated frontend/NCM/Trellis setup changes are not staged.

## Out of Scope

- Changing CPAL parked-stream active playback release policy.
- Rewriting the full streaming playback kernel.
- Network/WebDAV streaming.
- UI settings for watchdog tuning.

## Technical Notes

- Primary files expected: `src/player/loading.rs`, `src/player/command_handlers.rs`, `src/player/state.rs`, `src/player/callback.rs`, `src/server/diagnostics.rs`.
- Key prior evidence: archived task `.trellis/tasks/archive/2026-06/06-02-streaming-first-buffer-playback-kernel/research/release-benchmark-results.md`.
- Relevant specs: `.trellis/spec/backend/quality-guidelines.md`, `.trellis/spec/backend/logging-guidelines.md`, `.trellis/spec/backend/error-handling.md`, `.trellis/spec/guides/cross-layer-thinking-guide.md`.

# Streaming First-Buffer Playback Kernel

## Goal

Reduce cold `load-to-progress` latency by introducing a guarded streaming-first-buffer playback path. The first stage should prove that local file autoplay can begin after the first buffered chunks are ready, while the decoder continues filling the rest of the track in the background.

## What I Already Know

- Current cold load waits for full-track decode before `LoadComplete`, then starts playback.
- Previous optimizations already moved loudness analysis off the blocking path, reduced output prepare to single-digit milliseconds, promoted pending next-track buffers, and made quick playback safe.
- Release evidence still shows full-track decode as the largest remaining cold-load cost.
- The existing callback reads from `SharedState.audio_buffer: ArcSwap<Vec<f64>>`, so it cannot progress until a full buffer is published.
- Existing async load generation guards must remain the authority for stale decode cancellation.
- The audio callback may use atomics and lock-free queues, but must not allocate, lock, log, or do I/O.

## Requirements

- Add a guarded streaming-first-buffer path behind `AUDIO_STREAMING_FIRST_BUFFER=true`; default behavior remains the current full-buffer load path.
- Support local-file autoplay as the first MVP target.
- Decode in a producer thread by chunks and push bounded chunks to a lock-free playback queue.
- Publish playback metadata and start playback after an initial buffer threshold is available, without waiting for full-track decode.
- Continue collecting the full decoded buffer in the background; once complete, publish it to `audio_buffer` without resetting current playback position.
- Stage 2: add a memory-bounded streaming mode for large decoded outputs. Small tracks continue to publish a full `audio_buffer`; tracks whose estimated decoded PCM exceeds `AUDIO_STREAMING_FULL_BUFFER_LIMIT_MIB` must avoid accumulating and publishing the full buffer.
- Stage 2: in memory-bounded streaming mode, producer chunks must use backpressure instead of being dropped, because the queue becomes the playback source of truth until EOF.
- Preserve generation/cancel guards so stale producer chunks or finished buffers cannot replace newer user actions.
- Keep loudness non-blocking: ReplayGain/cache may apply immediately; missing loudness uses 0 dB until full buffer/background analysis is available.
- Record diagnostics sufficient to separate first-buffer readiness from full decode completion.

## Acceptance Criteria

- [x] Default `AUDIO_STREAMING_FIRST_BUFFER=false` retains existing tests and behavior.
- [x] With streaming enabled, autoplay can advance `position_frames` before full-track decode completes.
- [x] Callback streaming consumption uses only lock-free state and preallocated scratch state.
- [x] Stale generations are discarded.
- [x] `cargo check --bin audio_server` passes.
- [x] Targeted unit tests cover queue consumption, underrun behavior, generation reset, and default-path compatibility.
- [x] Real-file benchmark evidence compares streaming enabled vs disabled on at least one 44.1 kHz local file. See `research/release-benchmark-results.md`.
- [x] Stage 2 keeps small-track full-buffer behavior and avoids full-buffer publication for large decoded outputs above the configured threshold.
- [x] Stage 2 keeps no-full-buffer playback underrun-free in a real-file benchmark and records the selected streaming memory mode in diagnostics.

## Definition of Done

- Tests added/updated for the new state and callback path.
- Backend guidelines followed: no callback allocation/locks/logging/I/O.
- Diagnostics/research note updated with actual benchmark results.
- Default behavior remains safe if the streaming prototype is disabled.

## Out of Scope

- Full gapless pipeline unification.
- Manual next-track streaming promote.
- Network/WebDAV streaming.
- Perfect seek during active no-full-buffer streaming decode. Stage 2 may keep seek conservative until decoder-seek replay is implemented.
- UI settings surface for the new flag.
- Removing the existing full-buffer load path.

## Technical Approach

Stage 1 uses a bounded chunk queue as a narrow compatibility bridge:

1. `load_with_credentials_inner()` chooses the streaming path only when `config.streaming_first_buffer` and autoplay are both true.
2. The producer opens `StreamingDecoder`, chooses the effective playback sample rate using the same preemptive-resample policy as existing load, and pushes decoded chunks to `SharedState.streaming_chunks`.
3. After a small initial threshold, the producer sends a new audio command that applies metadata/sample rate/channels/total frames, rebuilds DSP, sets non-blocking loudness, marks initial load complete, and sends `Play`.
4. The callback prefers streaming chunks while `streaming_active=true`; if chunks are temporarily unavailable before decode finishes, it writes silence and increments underrun diagnostics.
5. The producer keeps collecting the full buffer without blocking on a full playback queue; once the first-buffer queue is full, later streaming chunks may be dropped because the full buffer remains the source of truth.
6. On completion, the finish command stores the full buffer without resetting `position_frames`, clears the streaming queue, and switches playback back to `audio_buffer` reads at the current position.

## Decision (ADR-lite)

Context: Full streaming kernel is high risk because it touches decode, output callback, seek, next-track, loudness, and state contracts.

Decision: Build a guarded local-file autoplay MVP first, preserving the current full-buffer path and using existing generation semantics.

Consequences: The first stage can prove cold-load responsiveness without solving every final architecture concern. Some behaviors remain intentionally conservative until later stages, especially active streaming seek and gapless promotion.

## Technical Notes

- Primary files inspected: `src/player/loading.rs`, `src/player/mod.rs`, `src/player/command_handlers.rs`, `src/player/callback.rs`, `src/player/state.rs`, `src/player/audio_thread.rs`, `src/decoder/streaming.rs`, `src/player/track_loudness.rs`.
- Relevant specs: `.trellis/spec/backend/quality-guidelines.md`, `.trellis/spec/backend/error-handling.md`, `.trellis/spec/backend/logging-guidelines.md`, `.trellis/spec/guides/cross-layer-thinking-guide.md`.
- Existing benchmark evidence lives under `apps/desktop/output/lyne-evidence/`.

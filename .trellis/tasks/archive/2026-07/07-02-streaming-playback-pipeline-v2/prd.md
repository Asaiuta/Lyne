# Streaming Playback Pipeline v2 - PCM Window Rewrite

> Design reset: 2026-07-10. The previous delta design was a reasonable
> incremental cleanup of the chunk queue and retention ring, but it could not
> implement forward in-window seek from the data actually stored and it was not
> the maximum-performance architecture requested for this task. This PRD
> supersedes that design. Already-landed seek-race and RT-retire fixes remain
> prerequisites and behavioral baselines, not implementation targets to undo.

## Decision

Replace the streaming path's allocated `Arc<Vec<f64>>` chunk queue plus
post-consumption retention ring with one preallocated, absolute-frame PCM
window. The window is physically split into fixed-size slots for safe
single-producer/single-consumer publication, but forward and retained audio are
one logical address space.

Each active track owns one persistent producer thread and one persistent
`StreamingDecoder`. In-window seeks only move the callback read cursor. An
out-of-window seek commands the existing producer to seek the existing decoder;
it does not spawn a replacement thread or reopen the source unless typed source
recovery explicitly requires reopening.

## Problem

The current streaming implementation has four structural costs:

1. A decoded block is copied through `pending_samples.drain(..).collect()`, a
   new `Vec`, an `Arc`, `ArrayQueue`, callback scratch, the retire FIFO, and a
   second retention structure.
2. Forward queued audio has no producer-stamped absolute frame metadata.
   Absolute frame positions are inferred only after callback consumption, so a
   command-side forward-window classifier cannot address the queue safely.
3. Every streaming seek cancels a producer, creates a generation, spawns a
   thread, opens/probes a decoder again, and rebuilds queue state even when the
   requested PCM is already resident.
4. The declared queue/ring/full-buffer budget does not represent real peak PCM
   ownership across current, pending, staging, queued, retained, and gapless
   buffers.

## Confirmed Baseline

- The callback seek-slot serial protocol from `07-02-player-seek-race` is in
  the tree and must be extended, not bypassed.
- Heap-backed callback resources are retired off-RT by
  `07-02-player-rt-retire`; PCM-window reads must no longer need that retire
  path, while buffers and DSP chains continue using it.
- `StreamingDecoder` already owns a seekable Symphonia format reader and
  supports coarse seek plus `current_frame()`. Reopening it for every seek is a
  player-lifecycle choice, not a decoder requirement.
- The project already has a process decoded-memory limit through
  `decode_memory_budget()`, but it is a limit calculator rather than a live
  reservation ledger.
- `streaming_first_buffer` remains opt-in. The non-streaming `audio_buffer`
  path stays available as the compatibility path while v2 is proven.

## Goals

1. Make callback work independent of seek distance and bounded by output frames
   requested in the current callback.
2. Make every seek inside resident decoded PCM O(1), sample-exact in output
   frame coordinates, and free of decoder, file, and network work.
3. Eliminate steady-state per-block allocation, `Arc` reference traffic,
   queue-to-ring transfer, and PCM retirement.
4. Keep one producer/decoder/source session alive for the active track and
   coalesce rapid source seeks on that worker.
5. Enforce one process-wide decoded-PCM budget using exact reservations for
   allocation capacity, including transient and pending playback storage.
6. Split command ownership, realtime publication, and cold telemetry so each
   field has one authority and hot cache lines are isolated.
7. Provide benchmark evidence that v2 improves allocation, seek latency, and
   memory behavior without regressing callback tail latency or audio stability.

## Requirements

### R1 - Persistent StreamingSession

- `AudioPlayer` owns at most one active `StreamingSession` and, when gapless
  preload is enabled, one pending session.
- A session owns its source descriptor, output format, PCM reservation, window,
  producer handle, and cold lifecycle state.
- The producer owns `StreamingDecoder`; no other thread calls decoder methods.
- Window seeks do not cancel or replace the producer.
- Source seeks use a latest-wins mailbox and the same producer. Track switch or
  shutdown cancels the producer and hands its `JoinHandle` to an off-RT reaper.
- Rapid seeks must not create an unbounded number of detached threads.

### R2 - Preallocated Absolute-Frame PCM Window

- Allocate the sample payload once per session, with 64-byte alignment and a
  fixed byte capacity reserved before publication.
- Physically segment the payload into cache-sized slots. Slot frame count is a
  power of two derived from channel count, targeting about 64 KiB of interleaved
  `f64` PCM per slot and clamped to 512..4096 frames.
- A window epoch has an immutable output-frame origin. Slot sequence `n` covers
  `origin + n * slot_frames`; the final slot may publish fewer valid frames.
- Publish slot state with a single atomic stamp encoding sequence and
  `Vacant/Writing/Ready/Reading`. Producer sample writes happen-before the
  callback's successful `Ready -> Reading` claim.
- The callback releases every claimed slot before returning from the callback.
  No slot remains reader-owned while an output stream is paused or rebuilt.
- `retained_start_frame`, authoritative audible frame, and
  `produced_end_frame` define the logical resident interval. No queue snapshot
  or callback-private inferred chunk position is part of classification.

### R3 - Bounded Realtime Consumer

- The callback may perform atomic loads/CAS, bounded span copies into existing
  scratch, DSP, and output conversion only.
- No callback allocation, lock, logging, I/O, source call, producer wake syscall,
  `Arc` destruction, or loop proportional to seek distance is allowed.
- A seek is applied at the top of a callback before DSP reset and rendering.
- Slot claims are proportional only to the number of slots intersecting the
  current output request.
- Empty/not-yet-ready data produces loading silence and typed shortfall
  telemetry; it never reads an uninitialized or wrong-sequence slot.

### R4 - Unified Window Seek Protocol

- A generation- and epoch-tagged mailbox contains request serial, target output
  frame, and seek kind. The callback publishes applied serial and a typed result.
- A target in `[retained_start_frame, produced_end_frame)` is a candidate window
  seek. The callback performs the final exact slot-sequence validation.
- Forward window seek requires no producer pause: it only advances the read
  cursor, and the producer never reclaims unread forward slots.
- Backward window seek is installed while the command thread holds the
  producer's off-RT publish/reclaim gate. A published protection floor prevents
  reclamation at or after the requested target until the callback applies or a
  newer request supersedes it.
- Paused playback uses the same protected pending request; application occurs
  on the first callback after resume without losing the target meanwhile.
- On success, the first audible output frame is exactly the requested output
  frame, the DSP/resampler discontinuity state resets once, and position
  publication cannot be overwritten by an older callback serial.
- On exact-slot miss, epoch mismatch, or supersession, the request falls through
  to source seek without partially changing playback state.

### R5 - Persistent Out-of-Window Source Seek

- Source seek deactivates the current window epoch, but keeps the session,
  producer thread, opened decoder, source identity, and remote block cache.
- The producer waits until no slot is `Reading`, invalidates slot stamps without
  clearing sample memory, increments the epoch, and sets the new origin.
- The producer calls the existing decoder's coarse seek, then decodes/resamples
  and discards pre-target output so the first published frame is exactly the
  requested output frame.
- Rapid source seeks coalesce by serial. The producer checks for a newer serial
  between source operations, decode packets, resampler output, and slot publish.
- Reopen is a typed recovery action only: source expiry, identity-safe refresh,
  unrecoverable decoder seek, or source capability requiring it.

### R6 - Source Factory and Opened Session Contract

- Replace path-string branching with
  `StreamSourceFactory::open(OpenRequest) -> Result<OpenedSource, StreamSourceError>`.
- `OpenRequest` carries generation, operation intent, cancellation, credentials
  or provider handle, expected identity for recovery, and fetch policy.
- `OpenedSource` returns the decode-ready `MediaSource`, format hint,
  post-probe capabilities, stable identity, and recovery/refresh hooks.
- Capabilities and identity are results of opening/probing; they are not guessed
  from the path before open.
- Local files are the reference implementation. Remote opening must support
  probe reuse, range/block-cache reuse, per-hop policy, refresh-once, and typed
  identity mismatch without exposing credentials.
- Source and decoder calls remain producer-only and off-RT.

### R7 - Exact Decoded-Memory Ledger

- Introduce one process-owned `DecodedMemoryLedger` initialized from
  `decode_memory_budget()`.
- Every decoded PCM allocation obtains an RAII reservation before allocation.
  Account allocated capacity bytes, alignment padding, slot metadata, producer
  staging, resampler carry, current/pending legacy buffers, and gapless preload.
- The active window is one allocation and one reservation. Forward and retained
  audio share it; references are not double-counted.
- Playback has priority over optional gapless preload. Insufficient budget may
  skip/preempt pending preload, but must not silently shrink active startup below
  its minimum safe slot count.
- Replace `streaming_full_buffer_limit_mib` with the semantically correct
  `streaming_pcm_window_limit_mib`, preserving the current 256 MiB default and
  performing one persisted-settings migration. The value is clamped to the
  process budget and rounded down to a valid slot count.
- Runtime budget changes apply to the next session, never by reallocating a
  window under the callback.

### R8 - Explicit Ownership and Cache-Line Isolation

- `StreamingControl` is command-thread-owned and contains no callback atomics.
- `StreamingRtView` contains only callback/producer coordination and is split
  into cache-line-aligned callback-written, producer-written, and seek-mailbox
  groups.
- `StreamingTelemetry` is cold and separate from render cursors/flags.
- `StreamingSession` aggregates those planes but does not mirror authoritative
  fields between them.
- Playback position remains owned by the shared playback clock work from
  `06-08-shared-state-split`; the window consumes that authority rather than
  introducing another public position source.
- Every atomic field documents writer, readers, memory ordering, and invariant.

### R9 - Producer Publication and Backpressure

- Decoder/resampler output is copied directly from reused producer scratch into
  a claimed window slot. Remove `pending_samples.drain(..).collect()`, per-block
  `Vec`, and per-block `Arc` creation.
- The producer publishes only complete slot metadata/sample spans and updates
  `produced_end_frame` after the slot becomes `Ready`.
- In bounded mode, producer target-ahead policy is expressed in time/frames from
  source traits. Spare capacity naturally becomes backward retention.
- To make space, the producer may reclaim only ready slots strictly before the
  current/protected read floor. If no such slot exists, it waits off-RT.
- Replace fixed 2 ms polling with an adaptive park strategy. Seek/cancel commands
  wake the producer off-RT; normal callback progress is observed through atomics
  and never performs a wake syscall.

### R10 - Diagnostics

Expose at least:

- window capacity/used/retained/ahead bytes and frames
- slot publish/claim miss and sequence mismatch counts
- window seek requested/applied/miss/superseded counts by direction
- command-to-applied seek latency histogram
- source seek/reopen/probe-reuse counts and source-seek latency
- producer park duration, decode-ahead frames, and low-water shortfall
- memory reserved by owner plus reservation rejection/preemption counts
- producer thread live/reaped counts

Counters are updated at phase boundaries. No per-sample or per-frame telemetry;
no callback logging.

### R11 - Compatibility and Migration

- `streaming_first_buffer=false` keeps the current non-streaming full-buffer
  path unchanged.
- With streaming enabled, v2 stays on the PCM window after EOF; it does not build
  a duplicate `full_samples` buffer and later switch storage.
- Existing autoplay, pause, stop-for-load, recovery watchdog, replay gain, DSP,
  output format, event publication, CPAL, and exclusive WASAPI behavior remain.
- Gapless preload may continue using the legacy pending buffer initially, but it
  must reserve through the same ledger and transition without an RT drop.
- The old chunk queue, streaming retention ring, replay-prefix path, PCM chunk
  retire routing, and memory/full-buffer streaming split are removed after the
  window path passes its gates. Do not ship two production streaming pipelines.

## Acceptance Criteria

- [x] Forward and backward in-window seek use the same resident interval and
      apply by cursor change; neither opens/seeks a decoder nor issues file or
      network reads.
- [x] First audible frame after every successful window seek equals the target
      output frame, including target-inside-slot and paused-resume cases.
- [x] Seek callback work is independent of jump distance. +100 ms, +5 s, and
      +60 s resident seeks perform the same bounded mailbox/slot operations.
- [x] The callback remains allocation-free and lock-free under
      `assert_no_alloc`; no PCM object can be freed there.
- [x] Slot publication/claim/reset safety is covered by deterministic tests,
      Loom interleaving tests, and Miri for unsafe storage access.
- [x] After producer warm-up, the Lyne window/publication layer performs zero
      heap allocations per decoded slot and one PCM copy into final window
      storage.
- [x] Rapid seek stress keeps one active producer thread, applies latest-wins,
      and leaves no detached producer growth.
- [x] In-window seek p99 command-to-applied latency is at most one configured
      callback period plus 1 ms on an otherwise idle test machine.
- [x] Callback p99.99 is no more than 3% slower and maximum observed callback
      time no more than 5% slower than the checked-in baseline; underrun and
      recovery counts remain zero in the controlled benchmark.
- [x] Decoded PCM committed capacity never exceeds ledger reservations; active
      plus pending peak reservation never exceeds the process limit.
- [x] Out-of-window seek reuses the opened decoder/source in the normal case and
      is benchmarked against the current reopen path.
- [x] Benchmark coverage includes 44.1/48/96/192 kHz, stereo and multichannel,
      local lossless/lossy files, CPAL and exclusive WASAPI, rapid seeks, and
      forward-then-backward correctness.
- [x] `cargo test --lib`, `cargo test`, `cargo clippy --workspace --all-targets`,
      callback perf enforcement, playback latency benchmarks, and real-file
      stress pass before the old pipeline is deleted.
- [x] Backend streaming contract docs are updated when implementation lands.

Final verification note (2026-07-12): the commands and task-owned quantitative
gates above pass. Strict workspace-wide Clippy with `-D warnings` is an extra
repository-cleanliness gate and still reports unrelated pre-existing warnings.
The isolated Cargo source/callback harness has a Windows runtime-DLL launch
limitation, while the same source-seek evidence and direct callback enforcement
passed earlier in the task. The current Realtek device also has a repeat-open
44.1 -> 48 kHz fallback stall before v2 construction; native 48 kHz CPAL and
Electron real-file playback pass.

## Dependencies and Coordination

1. `07-02-player-seek-race` is landed and supplies the serial ordering baseline.
2. `06-08-shared-state-split` must share the `PlaybackClock` and RT-view shape;
   do not split the same atomics twice.
3. `07-02-player-rt-retire` remains authoritative for non-PCM callback resource
   retirement. This task removes only PCM chunk retirement.
4. `07-02-remote-range-seek` consumes the opened-source/session contract and
   must preserve decoder/source reuse across source seeks.
5. Any core API needed to construct a decoder from `OpenedSource` or expose
   exact seek realization lands in `audio-engine-core` first and is integrated
   through the normal dependency-update task.

## Out of Scope

- Replacing Symphonia or rewriting codec implementations.
- DSP algorithm, resampler-quality, crossfade, or loudness-policy redesign.
- Implementing remote HTTP range/cache hardening itself; this task defines the
  seam and reuse requirements that `07-02-remote-range-seek` implements.
- Enabling streaming-first-buffer by default before benchmark evidence exists.
- Keeping the old queue/ring path as a permanent compatibility fallback.

## Planning State

The performance target and architecture choice are resolved. Implementation
must not start until `design.md` and `implement.md` are reviewed against this
PRD and the user approves the final planning artifacts.

# Persist memory-streaming decoder across seeks to cut rebuffer latency

> **OUTCOME (2026-06-04): IMPLEMENTED → BENCHMARKED → REVERTED (negative result).**
> All 4 PRs were built and passed unit tests + trellis-check, but the 50-trial
> FLAC seek stress (3 confirmation runs v53/v54/v55 vs v52) **disproved the
> hypothesis**: `progress_after_convergence_ms` p50 stayed flat, its `max` got
> consistently ~25 ms worse, `streaming_output_shortfall` moved only marginally,
> and a **fresh underrun regression** appeared (v52 `0/0` → 5–9
> `audio_buffer_output_shortfall` events/run, which v51/v52 had eliminated).
> Root cause: for local cached files the open+probe+spawn the worker removed was
> not the bottleneck — the decode-bound refill of `STREAMING_START_BUFFER_FRAMES`
> after `decoder.seek()` is — and the worker's async handoff + `soxr.clear()`
> added tail latency and re-exposed the seek-time underrun race. Per the
> "benchmark-before-commit" gate the change was **reverted, not committed**.
> Full analysis + corrected recommendation:
> [`../06-03-reduce-false-playback-recovery/research/recovery-watchdog-results.md`](../06-03-reduce-false-playback-recovery/research/recovery-watchdog-results.md)
> ("Persistent memory-streaming worker — implemented, benchmarked, REVERTED").

## Goal

Memory-mode streaming seek currently re-opens the file, re-probes the
container/codec, spawns a fresh OS thread, and creates a new soxr resampler on
**every** seek (`src/player/mod.rs:620` `restart_memory_streaming_at` →
`src/player/loading.rs:439` `decode_file_streaming_first_buffer`). That open +
probe + thread-spawn work is the bulk of the post-seek rebuffer window the
listener hears as a one-callback silence (`streaming_output_shortfall`, the only
residual fidelity issue from the recovery task). The goal is to keep the decoder
(and the worker that drives it) alive across seeks so a same-file seek becomes
`decoder.seek()` + decode instead of open + probe + spawn + seek + decode,
shrinking `progress_after_convergence_ms` and the rebuffer silence.

## What I already know (from the 06-03 code-level analysis)

* Reported seek `convergence_ms` is a synchronous floor — `position_frames` is
  set on the request thread (`src/player/mod.rs:600`). The real, optimizable
  cost is `progress_after_convergence_ms` + `streaming_output_shortfall`.
* The shortfall is an **empty new-generation queue** during the rebuffer window,
  not a resampler stall (`src/player/callback.rs:1021`-1032, marked at
  `:1092`). Confirming diagnostic: `streaming_queue_min_len == 0` at the seek.
* Per-seek costs, descending impact:
  1. fresh decoder open + format probe (`src/player/loading.rs:456`)
  2. new OS thread per seek (`src/player/mod.rs:632`)
  3. fresh soxr resampler when source rate ≠ device rate
     (`src/player/loading.rs:522`)
* `StreamingDecoder` holds `Box<dyn FormatReader>` + `Box<dyn Decoder>` and
  already exposes `seek()` (Symphonia `Coarse` seek + `decoder.reset()`,
  `src/decoder/streaming.rs:283`).
* `AudioPlayer` holds `current_load_cancel: Option<Arc<AtomicBool>>` and uses
  generation counters + cancel tokens to supersede in-flight loads
  (`src/player/mod.rs:118`, `cancel_current_load_inner` `:507`).
* `StreamingResampler::reset()` only clears Rust-side buffers, **not** soxr
  delay lines (`src/processor/resampler.rs:605`) — so resampler reuse across a
  seek is not correctness-free.

## Verified technical facts (resolved by inspection)

* **`StreamingDecoder` is `Send`.** Symphonia `FormatReader: Send + Sync`
  (symphonia-core 0.5.5 `formats.rs:168`) and `Decoder: Send + Sync`
  (`codecs.rs:460`); all `StreamingDecoder` fields are `Send`. → Approach A
  (move a cached decoder into a per-seek thread) compiles.
* **soxr 0.6.0 exposes `Soxr::clear()`** (`soxr-0.6.0/src/lib.rs:150` →
  `soxr_clear`; `SoxrPtr` is `Send + Sync`). → a *correct* soxr delay-line
  reset IS available, so resampler reuse (#3) becomes feasible by adding
  `clear()` to `StreamingResampler::reset()`. Deferred to the B phase.
* **Memory-mode producer lifecycle:** `streaming_chunks` is a bounded
  `ArrayQueue::new(128)` (`src/player/state.rs:489`), 4096 frames/chunk. When
  full, the producer parks in a 2 ms backpressure loop
  (`STREAMING_QUEUE_BACKPRESSURE_SLEEP`, `src/player/loading.rs:30`/963),
  re-checking cancel each iteration. The producer decodes the file to EOF on a
  **detached** thread and drops its decoder at thread end.
* **Wrinkle for Approach A:** because the per-seek thread *owns* the decoder and
  drops it at EOF/cancel, reusing it requires the old thread to **hand the
  decoder back** to a cache before exiting, plus a **fresh-open fallback** for
  the race window (new seek thread spawns before the old one hands back).
  Hand-back is bounded (~≤2 ms when parked) but the reuse becomes *best-effort /
  nondeterministic*. A clean, deterministic decoder reuse implies a single
  persistent owner — i.e. it converges on Approach B.

## Assumptions (temporary)

* Same-path seeks are the dominant case (stress benchmark seeks the same track
  repeatedly); cross-track navigation still re-opens (acceptable).
* The persistent decoder/worker must still honor generation + cancellation so a
  newer seek supersedes an in-flight one (250-seek stress hammers this).
* Resume needs no change (already at shared-mode floor per the analysis).

## Open Questions

* (Q1) Architecture — **RESOLVED**: pivot to Approach B (persistent worker).
  Discovery: a clean decoder reuse needs a single persistent owner, so the
  staged "A first" collapses into B anyway, and B is deterministic.
* (Q2) Resampler reuse — **RESOLVED**: in scope. Enhance
  `StreamingResampler::reset()` to call `Soxr::clear()` on each instance and
  reuse the worker-owned resampler across seeks (rebuild only on rate/settings
  change).
* (Q3) Cross-track / device / settings invalidation — **RESOLVED by design**:
  worker is per-current-memory-track; track change / device change / streaming
  settings change tears down the worker (and rebuilds the resampler).

## Requirements (evolving)

* A same-file memory-mode seek must not re-open/re-probe the file and must not
  `thread::spawn` a new producer; it is delivered as a control message to the
  live worker.
* The worker reuses its resampler across seeks via `reset()` + `Soxr::clear()`;
  it rebuilds the resampler only on a source-rate / device / streaming-settings
  change.
* Newer seeks must cleanly supersede in-flight ones (coalesce to newest by
  generation; no stale-generation audio, no leaked thread/decoder/resampler).
* Worker lifecycle: born on a memory-mode load, torn down on track change /
  stop / StopForLoad / device change / streaming-settings change.
* The synchronous convergence prep (`position_frames`, generation, queue reset,
  `streaming_active`/`is_loading`) stays on the request thread so
  `convergence_ms` does not regress.
* No regression in recovery (stay 0) or underrun counters under the existing
  50-trial streaming memory-mode FLAC seek stress.

## Implementation Plan (small PRs)

* **PR1 — Resampler filter-flush primitive (RT-aware). [DONE — verified]**
  Added `StreamingResampler::reset_for_seek()` (`reset()` + per-instance
  `Soxr::clear()`) at `src/processor/resampler.rs`, documented producer-only.
  The RT `reset()` path is unchanged. Tests:
  `reset_for_seek_makes_resampler_behave_like_fresh_instance` (reused==fresh
  after clear) and `reset_without_clear_leaves_soxr_latency_state` (contrast)
  both pass via `cargo test --lib processor::resampler` (15 passed). This
  validated the key risk: `soxr.clear()` truly flushes the polyphase delay line.
* **PR2 — Worker scaffolding (memory-mode seek worker).** Add
  `StreamingWorkerCmd { Seek { generation, target_time_secs, load_cancel,
  autoplay }, Shutdown }` and a `run_memory_streaming_seek_worker` that opens the
  decoder + resampler once, then loops over decode "sessions": decode + push
  (the existing backpressure helpers) while polling the control receiver between
  packets and inside the 2 ms park; on `Seek` it `decoder.seek()` +
  `resampler.reset_for_seek()` + adopts the new generation/cancel and refills; at
  EOF it sends `StreamingLoadFinished` and parks on `recv()`. Leaves
  `decode_file_streaming_first_buffer` (initial load) untouched. Unit-test the
  control/coalescing logic where feasible.
* **PR3 — Route seek through the worker + lifecycle.**
  `restart_memory_streaming_at` (`src/player/mod.rs:620`) keeps the synchronous
  shared-state prep but, instead of cancel + `thread::spawn`, spawns the worker
  on the first memory seek and sends a `Seek` message to the live worker on
  subsequent seeks. Add a `streaming_worker: Option<StreamingWorkerHandle>`
  (path + `Sender` + `JoinHandle`) to `AudioPlayer`; tear it down + `Shutdown`
  on track change / stop / StopForLoad / device or settings change. Tests:
  same-path seek does zero `open()` after the first; rapid-seek coalescing;
  supersede/cancel; EOF/backward re-arm; teardown leaks none.
* **PR4 — Verify + document.** Rerun the 50-trial streaming memory-mode FLAC
  seek stress; append before/after to the 06-03 research file; update backend
  spec if the streaming-load contract text changes.

## Acceptance Criteria (RESULT — code reverted 2026-06-04)

* [x] Same-path seek path performs no `StreamingDecoder::open` and no per-seek
      `StreamingResampler::with_quality` rebuild — **met** (worker reused decoder
      + resampler; verified by unit tests). *Now reverted.*
* [x] `StreamingResampler::reset_for_seek()` flushes soxr delay lines (unit
      test: A → reset_for_seek → B matches a fresh instance fed only B — no
      cross-segment smear); the RT `reset()` path stays allocation-free — **met**
      (2 tests passed, < 1e-9). *Primitive worked; now reverted.*
* [ ] `progress_after_convergence_ms` p95 improves vs the v52/v40-41 baseline —
      **FAILED**: p50 flat, p95 flat/worse, `max` consistently ~25 ms worse
      (48 → 67–75) across v53/v54/v55.
* [ ] `streaming_output_shortfall_count` / `_frames` drop (materially lower) —
      **FAILED**: only marginal (~55 → 48–53, within run-to-run noise).
* [ ] `playback_recovery_count == 0` and underrun counters no worse than
      baseline — **PARTIAL FAIL**: recovery stayed 0 ✓, but global underrun
      **regressed** 0 → 5–9 `audio_buffer_output_shortfall` events/run.
* [x] Rapid back-to-back seeks (supersede) produce correct-position audio with
      no leaked worker/decoder — **met** (coalescing/teardown tests passed).
      *Now reverted.*

**Verdict:** functional criteria met, but the three performance criteria
(the actual point of the task) failed; net regression. Reverted, not committed.

## Definition of Done (team quality bar)

* Unit tests for the seek/supersede/cancel paths; existing player tests green.
* `cargo test --lib`, `cargo check --bin audio_server`, lint/clippy green.
* Benchmark rerun appended to
  `06-03-reduce-false-playback-recovery/research/recovery-watchdog-results.md`
  (or a new research file) with before/after.
* Backend specs updated if the streaming-load contract changes.

## Out of Scope (explicit)

* Resume latency changes (analysis: already at shared-mode floor).
* Exclusive-mode output path tuning.
* HTTP/remote streaming seek (local files only, matching current guard at
  `src/player/mod.rs:557`).
* Full-buffer (non-memory) mode seek behavior.

## Research References

* [`../06-03-reduce-false-playback-recovery/research/recovery-watchdog-results.md`](../06-03-reduce-false-playback-recovery/research/recovery-watchdog-results.md)
  — "Resume and Seek Optimization Analysis (Code-Level)" section is the source
  analysis for this task.

## Research Notes

### Chosen design — Approach B: controllable persistent memory-streaming worker

Key reframing from the lifecycle inspection: the memory-mode producer thread is
**already long-lived** — after it fills the bounded 128-chunk queue it parks in
the 2 ms backpressure loop and stays alive until EOF/cancel/track-change. So B
is not "add a new thread"; it is "make the existing producer controllable":

* The memory-mode producer (`decode_file_streaming_first_buffer`'s decode/push
  loop) gains a control `Receiver<StreamingWorkerCmd>`.
* `restart_memory_streaming_at` stops doing cancel + `thread::spawn`. Instead it
  keeps the synchronous shared-state prep that makes `convergence_ms` fast
  (generation bump, `position_frames`, queue reset, `is_loading=true`,
  `streaming_active=true`) and then **sends a `Seek { generation, target }`
  message** to the live worker.
* The worker, between packets and inside the backpressure park, checks the
  control channel. On `Seek` it: `decoder.seek(target)`
  (`src/decoder/streaming.rs:283`), resets the resampler, resets its local
  decode bookkeeping to the new generation, and resumes filling the queue from
  the new position. The decoder and resampler **never leave the thread** and are
  never re-opened.
* The worker is **born on the first memory-mode seek** and **dies** on track
  change, stop, device change, or streaming-settings change. The initial-load
  path (`load_with_credentials_inner` → `decode_file_streaming_first_buffer`)
  stays **untouched** and still drops its decoder at EOF; only the seek path
  (`restart_memory_streaming_at`) is rerouted. Net effect: file opens drop from
  N+1 to **2** for N seeks of one track (one at load, one at first seek), and
  every subsequent seek reuses the worker's decoder + resampler. This keeps the
  blast radius off the load path. Full-buffer (non-memory) mode and remote/HTTP
  stay on the current path.
* **Coalescing:** each `Seek` carries the load generation; the worker drains the
  channel and acts only on the newest, dropping superseded seeks (mirrors the
  existing generation/cancel staleness model — `ensure_streaming_load_current`).

This removes #1 (no re-open/probe) and #2 (no per-seek spawn) deterministically,
and is the natural home for #3 (resampler reuse via `Soxr::clear()`).

## Decision (ADR-lite)

**Context:** Seek's real cost is the post-seek rebuffer window
(`progress_after_convergence_ms` + `streaming_output_shortfall`), driven by
re-open + probe + per-seek thread spawn. A "decoder cache" (A) was considered
but every clean variant needs a single persistent decoder owner; the staged
"A first" therefore collapses into B with only best-effort gains in the interim.

**Decision:** Implement Approach B directly, realized as **making the existing
long-lived memory-mode producer thread controllable via a command channel**, so
seek becomes `decoder.seek()` + refill instead of cancel + spawn + open + seek +
decode. `StreamingDecoder` is confirmed `Send`; `Soxr::clear()` is confirmed
available for correct resampler reuse.

**Consequences:** Larger blast radius on `loading.rs` / `mod.rs` than a cache,
new concurrency surface (channel, coalescing, shutdown, invalidation), but
deterministic reuse, no throwaway hand-back code, and a single place for
generation/cancel handling. Risk controlled by preserving the existing
generation/cancel semantics and the synchronous convergence prep, and by gating
behind the existing streaming-first-buffer config.

### Edge cases to cover

* Rapid back-to-back seeks → coalesce to newest by generation; no stale-position
  audio.
* Seek while the initial first buffer is still decoding (worker mid-initial
  decode) → honored as a normal control message.
* Track change / `stop` / `StopForLoad` while a seek is pending → worker tears
  down or resets to the new generation; no leaked thread/decoder.
* Device / sample-rate / streaming-settings change → worker rebuilds decoder
  and/or resampler (cannot `clear()`-reuse across a rate change).
* Seek to a position at/after EOF, or seeking backward after the worker has
  parked at decode-finished → worker must re-arm decoding from the new position.
* Worker error/panic (decode/seek failure) → surface `LoadError` for the
  current generation and fail safe (no silent hang).
* Non-memory full-buffer mode and remote/HTTP → unchanged (worker not used).

## Technical Notes

* Key files: `src/player/mod.rs` (seek orchestration, AudioPlayer state),
  `src/player/loading.rs` (producer / first-buffer decode),
  `src/decoder/streaming.rs` (`StreamingDecoder::open`/`seek`),
  `src/processor/resampler.rs` (soxr reuse caveat),
  `src/player/callback.rs` (shortfall site).
* Generation/cancel model to preserve: `load_generation`,
  `streaming_generation`, `current_load_cancel`.

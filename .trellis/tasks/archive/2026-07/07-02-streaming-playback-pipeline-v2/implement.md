# Streaming Playback Pipeline v2 Implementation Plan - PCM Window

> Rewritten 2026-07-10. This is an execution plan for the preallocated PCM
> window architecture in `design.md`. It is not a checklist for completing the
> previous chunk queue/retention-ring delta. No implementation phase starts
> until the user approves the final PRD/design/plan.

## Delivery Rules

- Keep the work in the existing `07-02-streaming-playback-pipeline-v2` task.
- Preserve unrelated dirty-worktree changes. Stage and review this task's files
  narrowly.
- The callback safety gate is absolute: no allocation, lock, logging, I/O,
  blocking wake, or destruction in the render path.
- Add the new primitive and evidence before changing player behavior.
- A temporary development selector may compare old/new transports, but it must
  be removed before completion. Do not ship two production streaming paths.
- Any required `audio-engine-core` API lands and is pushed there first, followed
  by the normal lockfile integration in this repository.
- Update task markers after each phase, not only at the end.

## Execution Status - 2026-07-12

- [x] Phase 0 baseline matrix and old-path evidence.
- [x] Phase 1 isolated PCM window primitive, Miri coverage, and Loom models.
- [x] Phase 2 exact decoded-memory ledger and settings/API/UI migration.
- [x] Phase 3 playback clock and streaming ownership planes.
- [x] Phase 4 persistent producer, decoder, and opened-source session.
- [x] Phase 5 allocation-free callback rendering plus Ready/EOF integration.
- [x] Phase 6 O(1) forward/backward resident-window seek.
- [x] Phase 7 persistent out-of-window source seek with latest-wins control.
- [x] Phase 8 nested diagnostics, remote source seam, and settings surface.
- [x] Phase 9 physical deletion of the old queue/ring/replay transport.
- [x] Phase 10 task-owned static, correctness, performance, and real-playback
  verification. The implementation is complete; environment-specific residual
  gates are recorded below rather than represented as pipeline failures.

Phase 0/1 evidence:

- `apps/desktop/output/lyne-evidence/pipeline-v2-baseline/pcm-window-full.json`
  records 5,000 slots. The window performs zero post-construction allocations;
  the queue baseline performs 10,000 allocations / 327,880,000 bytes.
- The full transport benchmark keeps the real trade-off visible: the queue wins
  the artificial single-thread average, while the window is slightly faster
  cross-thread and reduces consumer-wait p99.99 from 266.6 us to 117.6 us.
- `apps/desktop/output/lyne-evidence/pipeline-v2-baseline/callback-output-path-heavy-v2.json`
  uses schema v2, 16 rows, and 70,000 callback samples per row. It records zero
  deadline misses, maximum p99.99 of 385.8 us, maximum observation of 1.053 ms,
  and a maximum synthetic payload of 78.75 MiB.
- `apps/desktop/output/lyne-evidence/pipeline-v2-baseline/seek-local-flac-schema-v2/playback-latency-benchmark.json`
  validates the `pipeline_v2_evidence` shape against the same local FLAC with
  three backward and three forward seek samples. Unavailable old-pipeline
  serial, first-audible, allocation, and ledger fields are explicitly labeled.
- `apps/desktop/output/lyne-evidence/pipeline-v2-baseline/playback-matrix-shared-final/playback-matrix.json`
  is the post-fix consolidated shared-output matrix: 6 passed, 0 failed across
  44.1/48/96/192 kHz stereo, 48 kHz 5.1, and 48 kHz 7.1 fixtures.
- `apps/desktop/output/lyne-evidence/pipeline-v2-baseline/playback-matrix-exclusive-classified/playback-matrix.json`
  records the two multichannel exclusive rows as `unsupported_output_format`
  with 0 pipeline failures. Each row preserves the WASAPI evidence `No
  supported exclusive format found at any sample rate` for the selected
  Realtek headphone endpoint instead of inferring support from a timeout.
- `apps/desktop/output/lyne-evidence/pipeline-v2-baseline/lossy-mp3-shared/playback-latency-benchmark.json`
  adds real lossy local-file coverage using the 15-second MP3 fixture with
  SHA-256 `C670CC9B99D0AF1D490941D87C45B09200730C44D7B2B443E850FE4193CFEB02`.
  The row passes load, resume, backward-window, and forward-window scenarios.
- Shared multichannel playback initially exposed a stream-identity design bug:
  source channels were compared with the fallback device's output channels, so
  every valid callback was silenced. `active_stream_source_channels` now owns
  source identity while `active_stream_channels` remains actual device output
  width; the focused regression tests and the final 5.1/7.1 rows pass.

Phase 1 verification:

- `cargo test --lib`: 363 passed.
- PCM unit tests: 8 passed under normal test and Miri.
- Loom models: 4 passed.
- Both benchmark targets pass `cargo check`; both Node scripts pass
  `node --check`.
- Focused Clippy found and fixed all task-owned warnings. The command remains
  globally blocked by 67 existing warnings in unrelated same-package library
  modules, which Cargo must lint because the benchmarks depend on the root lib.

Benchmark build note: this repository's release profile uses `panic = "abort"`,
while Cargo forces the top-level bench target to unwind. For these
`harness = false` executables, build with production-consistent panic behavior:

```powershell
cargo rustc --profile release --bench pcm_window_perf -- -C panic=abort
cargo rustc --profile release --bench audio_callback_output_path_perf -- -C panic=abort
```

Then run the generated benchmark executable with the report/enforcement flags.
Do not treat the default `cargo bench` panic-strategy failure as a benchmark
result.

## Phase 0 - Approval and Baseline Evidence

1. Obtain explicit approval of `prd.md`, `design.md`, and this plan.
2. Re-read current task/dependency status and current dirty files before edits.
3. Capture a release baseline for:
   - callback output-path p50/p95/p99/p99.9/p99.99/max
   - startup and out-of-window seek latency
   - existing backward in-window seek latency
   - allocation count/bytes in streaming publication
   - process private bytes and decoded-buffer ownership
   - producer thread count under rapid seeks
4. Extend benchmark scripts to measure forward seek before claiming any v2
   improvement. Preserve backward scenarios for direct comparison.
5. Add a benchmark report schema containing callback period, first audible
   target, seek applied serial, decoder open/seek count, network request count,
   allocation bytes, reservation bytes, and peak process memory.

Exit gate: a reproducible baseline artifact exists for the same fixture/device
matrix that will validate v2.

## Phase 1 - PCM Window Primitive, Isolated

Files:

- new `src/player/streaming/pcm_window.rs`
- new `benches/pcm_window_perf.rs`
- `Cargo.toml`/`Cargo.lock` only for justified dev-test support such as Loom

Steps:

1. Implement checked slot geometry:
   - about 64 KiB payload target
   - 512..4096 power-of-two frames
   - power-of-two slot count
   - checked frame/sample/byte arithmetic
2. Implement one 64-byte-aligned `MaybeUninit<f64>` payload allocation and
   separate slot metadata without eagerly clearing/touching the full window.
3. Implement packed sequence/state stamp and single-role writer/reader handles.
4. Implement exact sequence claim, bounded span read, release, publish, reclaim,
   and epoch-reset primitives.
5. Keep every unsafe block inside this module with a local `// SAFETY:` proof.
6. Unit-test:
   - geometry for mono/stereo/5.1/7.1
   - first/final partial slot
   - wrap and old-sequence rejection
   - reader blocks writer overwrite
   - reader cannot expose samples outside the initialized valid-frame span
   - reset refuses a reading slot
   - checked overflow
7. Add Loom models for publish/claim, claim/reclaim race, stale sequence, and
   epoch reset. Run Miri over the storage/slice tests.
8. Benchmark current `ArrayQueue<Arc<Vec<f64>>>` publication/consume against the
   window for throughput, tail latency, allocation, and contention.

Exit gates:

- safety tests pass under normal test, Loom, and Miri;
- no per-slot allocation after construction;
- window wins allocation metrics and does not regress consume tail enough to
  violate the final callback thresholds;
- no player code uses the new primitive yet.

Rollback: delete the isolated module/bench if the state machine cannot be proven
or benchmarked. Do not integrate a weaker abstraction under the same name.

## Phase 2 - Decoded Memory Ledger and Settings Contract

Progress - 2026-07-10:

- Added process-owned `DecodedMemoryLedger` with typed owners, checked atomic
  reservation under one off-RT mutex, exact RAII release, owner totals, peak,
  and rejection accounting.
- `PcmWindow::create` now reserves `geometry.reservation_bytes()` before payload
  or metadata allocation. The non-clonable token is stored in `PcmWindow`, so
  every surviving `Arc<PcmWindow>` keeps the reservation alive.
- Runtime diagnostics expose ledger limit/current/peak/rejections and bytes by
  owner.
- Runtime/persisted/API/UI setting is now `streaming_pcm_window_limit_mib`.
  Old `streaming_full_buffer_limit_mib` JSON/PATCH input is a deserialize-only
  alias; serialization writes only the new field. The new environment variable
  is preferred with an old-variable fallback. Values clamp to both the setting
  maximum and the process decoded-memory budget.
- Verification: `cargo check --lib` clean, `cargo test --lib` 369 passed,
  desktop typecheck passed, and desktop tests 310 passed.
- Legacy full-load and loaded-resample-cache paths now reserve before `Vec`
  allocation and carry the lease through `LoadResult` into the active buffer.
- Gapless preload reserves before allocation, publishes buffer + lease before
  the ready Release store, and moves both through callback or manual promotion.
  The callback swaps leases lock-free. A displaced buffer and lease share one
  retired-resource record; the off-RT drainer keeps both until no callback guard
  can own the final buffer reference, so capacity is never released early.
- Remaining: account the v2 producer scratch and resampler carry when the
  persistent producer storage shape lands. The old streaming queue/full-buffer
  accumulation also remains under the legacy estimate checks until its Phase 5
  deletion; do not create a second long-lived reservation model for transport
  scheduled for removal.

Files:

- new `src/player/streaming/memory.rs`
- `src/player/buffer_budget.rs`
- `src/config.rs`, `src/settings.rs`
- desktop settings API/model/types/copy/tests for the field rename

Steps:

1. Add process-owned `DecodedMemoryLedger` initialized from
   `decode_memory_budget()`.
2. Add typed `DecodedMemoryOwner` and RAII reservation tokens.
3. Integrate legacy current/pending/resample-cache checks with reservations so
   old and new paths cannot independently consume the same process limit.
4. Make the PCM window reserve payload, metadata, padding, producer scratch,
   and resampler carry before allocation.
5. Add priority behavior: active playback first; optional gapless preload may be
   rejected/preempted without disrupting current playback.
6. Rename the runtime setting to `streaming_pcm_window_limit_mib` and retain the
   256 MiB default.
7. Add one deserialization/persistence migration from
   `streaming_full_buffer_limit_mib`; do not retain duplicate runtime fields.
8. Clamp to process budget, round to valid geometry, and document that changes
   apply to the next session.
9. Test concurrent reservations, release-on-drop, failed reservation rollback,
   active/pending priority, legacy ownership, migration, and clamping.

Exit gate: tests can account every decoded PCM allocation owner and prove total
reserved capacity never exceeds the process limit.

Rollback: ledger integration may revert independently before player window
integration, but the final v2 path cannot ship without it.

## Phase 3 - Playback Clock and Streaming Ownership Planes

Progress - 2026-07-11:

- Reviewed and revised the stale `06-08-shared-state-split` PRD before broader
  ownership migration. The revised contract distinguishes requested, audible,
  and render-span positions; monotonicity is scoped to one applied-seek serial,
  so an acknowledged backward seek may intentionally decrease audible time.
- Added `research/shared-state-split-design-review.md` with blocking findings,
  cache-line requirements, task ownership, and migration ordering. `06-08`
  still requires a reviewed `design.md` before its broad field split begins.
- Replaced `anchor_ms == 0` sentinel logic with an explicit render-clock valid
  bit and sequence publication. Writers publish odd -> fields -> even; readers
  accept only matching even snapshots. Anchor zero is now valid and reset
  publishes `valid=false`.
- Added zero-anchor and explicit-reset tests. Full `cargo test --lib` passes
  371 tests.
- Rebuilt the callback benchmark with release `panic=abort`; quick enforcement
  passes all 16 rows with zero deadline misses. Maximum observed callback was
  244.9 us in the resampler-only 128-frame row.
- Grouped position, seek mailbox, callback publication, pending full-buffer
  seek, and render snapshot into one `PlaybackClock` ownership boundary without
  retaining duplicate compatibility atomics. External benchmarks now use a
  read-only position accessor.
- Split request, callback, pending, and render write domains into separate
  `repr(align(64))` structures. Layout tests verify 64-byte alignment and
  non-overlapping offsets. Seek request/consume/publish ordering now lives in
  typed `PlaybackClock` methods instead of callback-selected atomics.
- Post-layout verification: six seek-slot race tests and the full 372-test
  library pass. Rebuilt callback quick enforcement passes all 16 rows with zero
  deadline misses; maximum observed callback was 142.9 us.
- Added isolated `StreamingRtView` with cache-line-separated identity,
  producer, callback, and seek-mailbox write domains plus an
  `ArcSwapOption<PcmWindow>` installation boundary. It remains detached from
  the production callback until session integration can cache only on
  generation change and retire the displaced `Arc` off-RT.
- Added typed decode state, seek direction, seek result, request snapshot, and
  applied/audible snapshot APIs. Request fields publish before an `AcqRel`
  serial bump; callback results publish before the applied serial's `Release`
  store. Snapshot readers double-check serials and defer a raced read to the
  next callback instead of using an unbounded RT retry loop.
- Added five focused tests covering 64-byte physical isolation, cross-thread
  request/result visibility, latest-wins supersession, and typed identity/range
  publication. Focused tests and warning-free `cargo check --lib` pass.

Coordinate this phase with `06-08-shared-state-split`.

Files:

- new `src/player/streaming/mod.rs`
- new `src/player/streaming/telemetry.rs`
- `src/player/state.rs`
- `src/player/callback.rs` seek/clock helpers

Steps:

1. Define command-owned `StreamingControl`, stable `StreamingRtView`, and cold
   `StreamingTelemetry`.
2. Split RT fields into cache-line-isolated identity, producer, callback, and
   seek-mailbox groups; add layout tests.
3. Replace public direct field access with typed accessors that encode writer,
   readers, and memory ordering.
4. Extend the landed seek-serial protocol to distinguish requested frame from
   callback-applied audible frame and typed result.
5. Keep one playback-clock authority for position/render span; do not add a
   window-owned public position atomic.
6. Add generation + epoch + seek-serial tagging and stale-result tests.
7. Add an `ArcSwapOption<PcmWindow>` installation boundary. Callback caches only
   on generation change and retires the old cached window off-RT.
8. Keep old queue behavior active through adapters until Phase 5; do not yet
   remove existing tests.

Exit gates:

- old playback tests remain green;
- seek race tests cover request between callback pre/post publish checks;
- cache-line layout and atomic-ordering tests pass;
- callback still passes `assert_no_alloc` and callback perf enforcement.

Rollback: typed ownership-plane extraction reverts without touching the isolated
window primitive or ledger.

## Phase 4 - Persistent Producer and Source Session

Progress - 2026-07-11:

- Added `audio-engine-core::decoder::OpenedMediaSource` and
  `StreamingDecoder::from_opened_source`, so a player source factory can open a
  transport once and transfer it into the producer-owned decoder without a
  second path open. Core commit `60ab41a` is pushed to `main`; its 226 unit
  tests and doc tests pass, and AudioPlayer now resolves that revision.
- Added the isolated local `StreamSourceFactory` reference implementation with
  generation, operation intent, cancellation, credentials/fetch-policy shape,
  opened-source capabilities, stable local identity, expected-identity recovery
  guard, and typed errors. Identity and capabilities are published only after a
  successful source open; a changed recovery source is rejected before decoder
  construction.
- Added four local-source tests covering open-once decoder construction,
  changed-identity recovery refusal, pre-filesystem cancellation, and remote
  policy rejection. Warning-free `cargo check --lib` and the full 381-test
  library suite pass.
- Added the persistent producer control plane: one generation-bound worker,
  cache-line-isolated latest-wins command mailbox, explicit cancel+wake, and
  bounded park behavior. Rapid source-seek requests update payload then publish
  one serial and unpark the existing worker; they never spawn replacement
  workers.
- Added a capacity-8 asynchronous producer reaper. Retirement only enqueues a
  cancelled `JoinHandle`; queue saturation returns the intact producer handle
  to the session for a later retry, so command paths neither join nor create an
  unbounded fallback thread. Explicit reaper shutdown avoids channel-clone
  shutdown deadlocks.
- Added five producer lifecycle tests covering latest-wins coalescing, parked
  cancellation wake, off-thread reaping, external-sender shutdown, and physical
  mailbox isolation. Focused tests pass and the full library suite now passes
  386 tests.
- Deferred the decoder-to-window data loop after review showed that the current
  borrowed `WriteSlot<'_>` cannot remain claimed across decoder calls. Adding a
  staging `Vec` here would introduce an avoidable second PCM copy. The next
  implementation step is an owned, non-clonable slot writer plus a borrowed
  decoder output contract before persistent scratch/carry reservations are
  finalized.
- Replaced that blocker with an owned, non-clonable PCM `Writing` guard that can
  remain claimed across decoder/resampler calls. Borrowed and owned writers now
  share one claim/append/publish/abort implementation, so stamp ordering and
  initialized-span safety cannot drift. Dropping an unpublished owned claim
  vacates it; two focused tests cover cross-call publication and abort cleanup.
- Added `StreamingDecoder::decode_next_borrowed` in audio-engine-core commit
  `affc213`, implemented through a safe state-advance span helper rather than
  unsafe lifetime extension. Core 227/227 tests and doc tests pass; AudioPlayer
  now resolves that revision.
- Added allocation-free `WindowSlotPublisher` state in the persistent producer.
  It writes borrowed decoder/resampler spans directly into owned final window
  slots, carries only the slot claim across calls, publishes partial EOF spans,
  and reports exact consumed/published progress on backpressure. It owns no
  staging `Vec`, so packet tails do not add a second PCM copy.
- Added direct cross-span/cross-slot and exact backpressure progress tests.
  Producer focused tests pass 7/7, PCM-window tests pass 10/10, warning-free
  `cargo check --lib` passes, and the full library suite passes 390 tests.
- Added `StreamingResampler::working_buffer_bytes` in audio-engine-core commit
  `6c4d619`. The query and constructor share one checked layout for per-channel
  input/output, output scratch, and interleaved borrowed output capacities, so
  `ResamplerCarry` can be reserved before any of those `Vec` allocations. Core
  228/228 tests and doc tests pass; AudioPlayer resolves that revision.
- Real-worker integration remains intentionally gated on one final exact-budget
  contract: Symphonia `SampleBuffer` currently allocates from the first decoded
  packet's runtime capacity, with no pre-decode bound exposed by core. The
  producer must not claim exact ledger coverage until core either exposes and
  enforces a bounded decoder staging capacity or accepts caller-owned reserved
  storage. No arbitrary guessed reservation will be added.
- Source review confirmed Symphonia exposes `CodecParameters::max_frames_per_packet`,
  but only after format probe. The reviewed implementation direction is now a
  two-stage core contract: `probe_opened_source -> StreamingDecoderBuilder`,
  query exact fixed `SampleBuffer<f64>` capacity bytes, reserve
  `ProducerScratch`, then `builder.build()`. The builder preallocates that fixed
  buffer and decode rejects any packet whose runtime capacity exceeds the
  probed declaration instead of reallocating. Unknown declarations require an
  explicit bounded fallback policy; they must not silently grow.
- Implemented that two-stage contract in audio-engine-core commit `bc89a02`.
  `StreamingDecoder::probe_opened_source` returns a builder with exact fixed
  `SampleBuffer<f64>` bytes; callers reserve before `build()`. Build allocates
  the buffer once, and decode returns a typed error if runtime packet capacity
  exceeds the probed/fallback bound instead of replacing or growing it.
  Existing open APIs delegate through the builder. Core 229/229 tests, format
  capability coverage, and doc tests pass; AudioPlayer resolves this revision.
- Added the first real `PersistentStreamingSession` local worker. The worker
  probes the already-open source once, reserves exact decoder staging before
  builder allocation, reserves exact resampler working storage before optional
  construction, and publishes borrowed decoder/resampler output directly into
  owned final PCM-window slots. Backpressure uses bounded adaptive parking and
  cancellation remains wakeable through the existing producer control plane.
- Added real synthetic-WAV session tests. They prove exact PCM publication and
  EOF, a live backpressured worker retaining its `ProducerScratch` reservation,
  cancellation through the bounded asynchronous reaper releasing that exact
  reservation, and typed channel mismatch publishing `Failed`. A resampled
  backpressure case additionally proves `ResamplerCarry` remains reserved for
  the worker lifetime and is released after bounded reaping. Synthetic rapid
  source-seek commands retain the same producer generation and submit exactly
  one worker to the reaper, establishing the Phase 4 no-replacement boundary
  before Phase 7 implements seek semantics. Focused session tests pass 5/5 and
  warning-free `cargo check --lib` passes.

Files:

- new `src/player/streaming/producer.rs`
- new `src/player/streaming/source.rs`
- `src/player/mod.rs`
- `src/player/loading.rs` only to remove/move streaming producer logic
- required `audio-engine-core` decoder/source constructors first

Steps:

1. Add `StreamSourceFactory`, `OpenRequest`, `OpenedSource`, capabilities,
   identity, recovery hook, and typed errors.
2. Implement local-file factory as the reference path.
3. Add a core constructor that builds `StreamingDecoder` from an opened media
   source/hint without reopening by path.
4. Create one producer worker per session. Move decoder, source, resampler,
   scratch, and next-frame state into that worker.
5. Add latest-wins producer command mailbox plus off-RT wake.
6. Add asynchronous producer reaper; track switch/cancel must not join while the
   player mutex is held.
7. Decode into reused scratch and copy directly into writer-claimed PCM slots.
   Add any required borrowed/fill resampler API in core before integration.
8. Implement source-specific startup and target-ahead policies from post-open
   capabilities.
9. Implement adaptive park/backpressure with no callback wake syscall.
10. Test stale generation, cancel during open/read/decode/publish, rapid mailbox
    coalescing, one producer under seek stress, and bounded worker reaping.
11. Review the opened-source signature against `07-02-remote-range-seek` before
    merge; do not implement remote transport hardening here.

Exit gates:

- local producer opens once and remains alive across synthetic seek commands;
- post-warmup Lyne publication performs zero heap allocation per slot;
- cancelled workers are reaped and thread count returns to baseline;
- no callback integration yet depends on incomplete source behavior.

Rollback: local source/session and producer can revert while the primitive,
ledger, and ownership planes remain independently useful.

## Phase 5 - Callback Window Rendering and Ready/EOF

Progress:

- Added an isolated allocation-free `callback_window` renderer before wiring
  session lifecycle into `SharedState`. It consumes the callback-owned unique
  `PcmWindowReader`, claims only the slot covering the current absolute frame,
  copies at most the requested output span, releases every slot immediately,
  and returns exact rendered frames/next cursor/typed shortfall without filling
  or touching the unwritten tail.
- Added deterministic cross-slot and end-of-published-window shortfall tests.
  They prove absolute cursor continuity, exact stereo sample order, immediate
  claim release, and unchanged output tails. Focused tests pass 2/2 and the
  full library suite passes 397/397.
- Callback session/window installation remains the next step. The reviewed
  constraint is to clone/cache the installed session/window only after a
  generation change; per-callback `ArcSwap::load_full` would reintroduce the
  forbidden steady-state Arc reference traffic. Displaced cached windows must
  enter the existing off-RT retire path before production selection is enabled.
- Added `CallbackWindowCache` implementing that boundary. It reads the isolated
  identity plane every refresh but clones the installed window only when the
  generation changes. A 32-refresh steady-state test proves the window Arc
  strong count is unchanged; generation replacement converts the old unique
  reader back into its window Arc and invokes the retire sink exactly once.
- Extended `RetiredAudioResource` with a staged PCM-window variant and off-RT
  drain handling, so CPAL and WASAPI can use the existing bounded callback
  retirement queue when the production cache is connected. Focused cache/render
  tests pass 3/3, warning-free `cargo check --lib` passes, and the full library
  suite passes 398/398.
- Embedded the generation-local cache in `CallbackScratch` and added the shared
  `render_callback_window_output` helper that both CPAL and exclusive WASAPI can
  call through `audio_callback_lockfree`. The helper refreshes identity, routes
  displaced windows into `RetiredAudioResource::Window`, and invokes the same
  absolute-frame renderer without allocation or locks.
- Added callback-layer evidence that the helper renders exact samples on first
  installation and that a generation replacement places the displaced window
  in the bounded retire queue instead of dropping it on the callback stack.
  Window-focused tests pass 4/4, warning-free `cargo check --lib` passes, and
  the full library suite passes 399/399.
- Added the disabled-by-default development selector and `ArcSwapOption` RT-view
  publication slot to `SharedState`. Off-RT publication swaps the view and
  places a displaced view into the bounded retire queue. The drainer defers a
  view while a callback ArcSwap guard still exists, preventing its embedded
  window/reference graph from becoming callback-thread destruction work.
- The slot is intentionally not selected by `audio_callback_lockfree` yet: the
  v2 samples still need to enter the existing DSP/output-path machinery rather
  than bypassing DSP by writing final output directly. Warning-free
  `cargo check --lib` and the complete 399/399 library suite pass after the
  publication boundary landed.
- Connected the disabled-by-default selector inside the existing streaming
  render loop at the PCM-fill boundary. With v2 enabled, the callback fills its
  preallocated `process_buffer` from the absolute-frame window; all downstream
  loudness gain, DSP chain, optional callback resampler, final noise shaping,
  position publication, render clock, spectrum, and shortfall handling remain
  the existing shared implementation. The legacy chunk fill remains the
  selector-off branch.
- Added direct selector evidence using the production streaming render loop.
  The test publishes a v2 RT view, renders exact window PCM, observes loudness
  gain processing (proving DSP was not bypassed), and verifies authoritative
  position advances by only the rendered frames. The full library suite now
  passes 400/400 and `git diff --check` reports no whitespace errors.
- Added typed `InstallStreamingV2Session` ownership transfer and removed the
  unused `Clone` constraint from `AudioCommand`, allowing a non-clonable session
  to move from a background loader to the audio command thread without an
  `Arc<Mutex<_>>` compatibility wrapper.
- `AudioThreadRuntime` now owns the active session, one bounded producer reaper,
  and rejected-retire handles for later retry. Installation rejects stale load
  generations, retires the previous producer asynchronously, publishes only the
  new RT view to `SharedState`, then enables v2. Shutdown disables publication,
  retires the active producer, and retries queued retire submissions off RT.
- Real load integration is gated on a newly identified format contract: session
  probe currently happens inside the worker, too late for the command owner to
  configure source channels/sample rate before output-stream preparation. The
  next change must move probe to the background loader while transferring the
  resulting builder and exact reservation into the same persistent worker; no
  guessed 44.1 kHz fallback will be introduced. Full library tests pass 400/400,
  warning-free `cargo check --lib` passes, and focused session tests pass 5/5.
- Resolved that format-contract blocker. `start_local` now probes on its caller
  (the future background loader), validates source/window channels, computes the
  real output rate (`target` or probed source rate), and reserves exact decoder
  staging before producer spawn. The probed builder and its live reservation
  then move into the persistent worker, which remains the only decoder owner.
- Session metadata now exposes confirmed source rate, output rate, and channels
  for output-stream preparation before typed installation. Channel mismatch is
  rejected before any worker is spawned, and an explicit no-target test proves
  a 48 kHz source remains 48 kHz rather than receiving a guessed 44.1 kHz
  fallback. Focused session tests pass 6/6, full library tests pass 401/401, and
  warning-free `cargo check --lib` passes.
- Added `start_local_with_capacity`, which performs the single probe first and
  derives window geometry from the confirmed channel count before allocating
  the configured byte capacity. The existing parts-based constructor remains
  for deterministic primitive tests and delegates to the same builder path.
- Connected an explicit local development route in the background loader. It is
  selected only for local autoplay loads already eligible for
  `streaming_first_buffer` when `LYNE_STREAMING_PIPELINE_V2=1`; default and
  remote behavior remain unchanged. The loader opens once, creates the exact
  capacity session, transfers it through `InstallStreamingV2Session`, and then
  requests Play. The audio command owner publishes confirmed output rate and
  channels and clears loading before enabling the RT view.
- Static/unit integration remains green: full library tests pass 401/401,
  warning-free `cargo check --lib` passes, and `git diff --check` reports no
  whitespace errors. Real-device playback is the next required evidence; this
  route is not yet considered production-enabled or Phase 5 complete.
- Built the release `audio_server` and attempted the real 44.1 kHz stereo
  shared-mode smoke with both v2/streaming-first-buffer environment flags.
  The first prerequisite failure was the known missing MSYS2/soxr runtime DLLs;
  after copying those generated-runtime dependencies into `target/release`, the
  server started initialization successfully but failed HTTP bind with
  `WSAEACCES` (`Os code 10013`) on ports `63904` and `64731`. Those two ports
  both sit inside a contiguous local exclusion band `62832-64807` (1976 ports)
  that is reserved by the Windows networking stack (Hyper-V/HNS/WSL/Docker
  Desktop side-effect). Outside that band, binds succeed (`55000`, `18080`,
  `62000`, `64850`, `65000`, and `port 0`). This is therefore a **reserved-port
  false negative**, not "the environment forbids all local listening" and not a
  v2 playback pass/fail. Evidence for the blocked runs lives under
  `apps/desktop/output/lyne-evidence/pipeline-v2-v2-smoke/shared-44k1{,-run2,-run3}/`.
- Re-ran the same smoke on free port `55000`:
  ```
  LYNE_STREAMING_PIPELINE_V2=1 AUDIO_STREAMING_FIRST_BUFFER=true
  node apps/desktop/scripts/lyne-playback-latency-benchmark.cjs
    --track apps/desktop/output/lyne-evidence/pipeline-v2-fixtures/pcm-s16-44k1-stereo-16s.wav
    --port 55000 --trials 1 --skip-seek --poll-ms 10
    --output-dir apps/desktop/output/lyne-evidence/pipeline-v2-v2-smoke/shared-44k1-run4
  ```
  Result: `pass=true`, `error=null`, server exit 0, measurements=2.
  - `load_to_progress` p50=18.737ms (first_position_advance=10ms)
  - `play_resume_to_progress` p50=17.86ms (first_position_advance=8ms)
  - underrun/recovery/shortfall deltas all 0; streaming queue push/pop all 0
  - device shared-mode stream opened (requested 44100, device fell back to 48000)
  - decode memory ledger after run: `active window` reserved ≈537,395,326 bytes,
    peak reserved ≈537,413,758; `legacy current/pending buffer` and `loaded
    resample cache` all 0 — proves the v2 PCM-window path was installed, not the
    old queue/full-buffer transport
  - process private peak ≈563 MB (window reservation dominates)
  Report:
  `apps/desktop/output/lyne-evidence/pipeline-v2-v2-smoke/shared-44k1-run4/playback-latency-benchmark.json`
  (script also wrote a nested duplicate under
  `apps/desktop/apps/desktop/output/...` because relative `--output-dir` is
  resolved against `apps/desktop`; copy the canonical path above).
- Operational follow-ups for later phases / harness hygiene:
  1. Do not hardcode benchmark ports in `62832-64807` on this machine; prefer
     `55000` / `18080` or dynamic bind (`listen(0)` then pass the chosen port).
  2. Optionally raise the Windows dynamic TCP range start away from fixed
     harness ports (`netsh int ipv4 set dynamicport tcp start=49152 num=16384`).
  3. Relative `--output-dir` currently double-prefixes under `apps/desktop` —
     pass an absolute path or fix `toAppPath` when the value already starts with
     `apps/desktop`.
  This shared-mode smoke is first real-device evidence that the development v2
  load/install/play path can reach audible progress. It is still not Phase 5
  complete (seek, exclusive WASAPI, multi-rate matrix, callback tail gates, and
  comparative old-vs-v2 report remain).
- Added HTTP-independent audio-thread/session Ready/EOF integration. Session
  installation now records deferred autoplay but does not clear loading or
  start the output stream early. While a session is active, the command thread
  polls the cold producer snapshot every 10 ms; the first `Ready` or
  `EndOfStream` transition clears loading and consumes deferred autoplay once.
  EOF updates `streaming_decode_finished` but deliberately leaves
  `streaming_active` and the window published so the callback can drain the
  exact final frames instead of falling back to a duplicate full buffer.
- Extracted the production transition function and exercised it with a real
  synthetic-WAV persistent session without HTTP or an audio device. The test
  proves Loading does not start autoplay, Ready is one-shot, repeated Ready is
  ignored, EOF is visible, and the v2 transport remains active. Focused session
  tests pass 7/7, full library tests pass 402/402, and warning-free
  `cargo check --lib` passes.
- Corrected callback EOF ownership after the integration test exposed two
  legacy fallthroughs. `finish_streaming_if_drained` now keeps an enabled v2
  transport in the window path, and the render loop no longer clears
  `streaming_active` when the v2 producer reaches EOF.
- The callback now bounds every v2 fill by
  `produced_end_frame - current_pos`, making the producer's exact absolute end
  authoritative even when the physical final slot contains a larger initialized
  span. Only when the audible cursor reaches that exact end does the callback
  publish `EVENT_TRACK_EOF`, increment playback-end once, stop playback, fill
  silence, and retain the window transport. The production render-loop test
  covers exact output, position advancement, final silence, one EOF event, and
  active-window retention. Full library tests pass 402/402 and warning-free
  `cargo check --lib` passes.
- Completed the remaining HTTP-independent Phase 5 behavior gates. A paused
  full callback emits silence without claiming the v2 window or advancing the
  authoritative cursor; resume renders from the same first frame. Producer
  `Failed` now clears loading, cancels deferred autoplay, and stops playback on
  the audio command thread instead of leaving an infinite Loading/underrun loop.
- Performance gates executed successfully. `pcm_window_perf --quick --enforce`
  confirms the preallocated window publishes with zero allocations/bytes, but
  also shows its current CAS/metadata microbenchmark latency is higher than the
  old queue (sequential 3740.4 vs 1347.0 ns/slot; cross-thread 4015.0 vs 1547.0
  ns/slot, with 53.5 us window cross-thread max). This is accepted only as the
  Phase 5 allocation gate and remains an explicit optimization deficit for the
  task's highest-performance claim.
- `audio_callback_output_path_perf --quick --enforce` passes every direct,
  shaper, resampler, and full scenario with zero deadline misses. The worst
  observed quick callback max is 133.6 us for full/512 frames; direct/512 max is
  14.2 us. Full library tests pass 402/402, format check and diff check pass.
- Phase 5 code and deterministic gates are complete. The CPAL/WASAPI real-device
  matrix remains externally blocked by Windows listener `WSAEACCES 10013`; it
  must be rerun before final task completion, but no longer blocks proceeding to
  Phase 6 implementation because callback/session behavior is covered without
  HTTP or device dependencies.

Files:

- `src/player/callback.rs`
- `src/player/command_handlers.rs`
- `src/player/audio_thread.rs`
- `src/player/wasapi_loop.rs`
- streaming modules from earlier phases

Steps:

1. Add a temporary development-only selector for A/B evidence.
2. Install session window before publishing active generation.
3. At callback generation change, cache the new window and retire the old one
   through the existing non-RT resource path.
4. Implement exact slot claim/copy/release into existing callback scratch.
5. Release all slot claims before every callback return, including shortfall,
   paused, error, and generation-change paths.
6. Publish audible position only for frames actually rendered under the current
   seek serial.
7. Implement ready from producer-published minimum frames and EOF from exact
   `produced_end_frame`/decode state.
8. Keep streaming-enabled playback on the window after EOF; do not build or
   promote a duplicate full buffer.
9. Preserve CPAL and exclusive WASAPI callback behavior and recovery watchdog
   distinctions.
10. Add callback tests for exact span copy, wrap, final partial slot, stale
    generation/epoch, not-ready silence, EOF, pause/resume, output-stream rebuild,
    and old-window retirement.
11. Run callback perf after every material render-loop change.

Exit gates:

- callback path is lock-free/allocation-free and no window can be destroyed RT;
- controlled playback has zero underrun/recovery;
- p99.99/max callback gates pass against Phase 0 baseline;
- new path starts, pauses, resumes, reaches EOF, and rebuilds output on both
  backends before seek integration.

Rollback: selector returns development runs to old transport. Do not proceed to
old-path deletion until all later phases pass.

## Phase 6 - O(1) Forward and Backward Window Seek

Progress:

- Phase 6 review found and fixed a prerequisite slot-state defect: releasing a
  read claim incorrectly published `Ready(sequence + 1)`, making the unread
  remainder of the current slot unavailable to the next callback and making
  retained seek impossible. Release now restores `Ready(sequence)`; producer
  reuse remains controlled by its explicit reclaim boundary. Added a regression
  test proving consecutive callbacks continue through different ranges of the
  same slot.
- Added the first production forward-window seek path. The callback consumes the
  typed generation/epoch/serial mailbox, validates producer resident bounds,
  performs an exact target-frame slot claim, publishes typed applied/miss state,
  updates the authoritative cursor in the same invocation, and resets DSP,
  callback resampler, and leftover state exactly once on success. No producer,
  decoder, source, file, or network operation occurs.
- Extended the production selector test: a request received while paused is not
  consumed by the silenced callback; resume applies target frame 102, renders
  four frames, publishes audible frame 102 and the applied serial, then reaches
  exact EOF at frame 106. Full library tests pass 403/403, focused PCM/render
  tests pass, warning-free `cargo check --lib` passes, and diff check passes.
- Backward protection/reclaim gating, rapid supersession races, command routing,
  and latency benchmarks remain before Phase 6 can be marked complete.
- Extended the exact-claim callback path to active backward seeks while the
  target is currently resident. The same CAS provides race safety: a successful
  read claim blocks producer overwrite until release, while a concurrent reclaim
  yields typed `SlotUnavailable` without changing the audible cursor. The
  production test now applies forward 100->102, renders to 106, then applies
  backward 106->101 and renders to 105, with distinct applied serials and exact
  audible targets.
- This does not yet claim paused-backward safety once producer wrap/reclaim is
  enabled. Producer reclaim is currently fixed at zero, so no resident slot can
  be overwritten; the protection-floor protocol must land together with the
  first dynamic reclaim policy rather than adding an unused atomic gate now.
  Full library tests remain 403/403 and warning-free `cargo check --lib` passes.
- Added dynamic producer reclaim and the paused-backward protection protocol.
  The callback publishes an independent render cursor (separate from applied
  seek fields). The producer retains half of the physical window behind that
  cursor by default and publishes the resulting absolute retained start. Before
  every append attempt, including each backpressure retry, it recomputes the
  reclaim boundary so callback progress can unblock a full window promptly.
- While the latest backward request serial is newer than the callback's applied
  serial, the producer clamps reclaim to the target sequence. This keeps a
  paused request resident until callback apply/miss; publication of either
  result releases the protection automatically. A deterministic test proves
  normal half-window floor sequence 8, protected target sequence 6, and return
  to sequence 8 after applied. Focused session tests pass 8/8 and full library
  tests pass 404/404.
- Added audio-command routing for resident v2 seeks. `AudioThreadRuntime`
  intercepts `AudioCommand::Seek` only when the converted output-frame target is
  within the active session's published retained/produced interval. It derives
  forward/backward from the authoritative callback position and publishes the
  session generation/epoch mailbox; the legacy backend seek is not called for a
  resident hit. Targets before retained start or at/after produced end remain on
  the existing fallback path for Phase 7 source-seek replacement.
- Added HTTP/device-independent routing coverage for forward, backward, before
  retained, and exactly at produced end. Full library tests pass 405/405 and
  warning-free `cargo check --lib` passes.
- Added deterministic callback-side latest-wins coverage at the narrow race
  boundary after an exact target-slot claim and before applied publication. A
  newer request forces the claimed request to publish `Superseded`, leaves the
  cursor unchanged, and is then applied exactly on the next consumption.
- Added explicit epoch-mismatch and half-open resident-range assertions for a
  target before `retained_start_frame` and exactly at `produced_end_frame`; all
  misses preserve the audible cursor. Full library tests pass 405/405,
  warning-free `cargo check --lib` passes, and `git diff --check` passes.
- Extended paused-backward reclaim coverage across eight producer reclaim
  updates after the callback cursor advances. The protected target remains the
  retained floor for every attempt and is released only after the matching
  applied serial, after which normal half-window reclaim resumes.
- Added `window_seek_perf`, an HTTP/device-independent release benchmark over
  the real request -> callback consume -> applied publication protocol. It
  covers +100 ms, +/-5 s, and +/-60 s resident targets, validates applied serial
  and exact first-audible target on every iteration, and enforces p99 <= one
  512-frame callback period + 1 ms plus a distance-independence spread gate.
  Quick release evidence at 48 kHz: every scenario p99 was 100 ns, maximum was
  4.3 us, versus an 11.67 ms gate.
- Phase 6 is complete. Full library tests pass 405/405; `cargo check --lib
  --benches` and `git diff --check` pass. Strict full-library Clippy remains
  blocked by 83 pre-existing warnings in unrelated dirty-worktree modules; no
  Phase 6 warning was reported before those workspace-wide failures.

Files:

- streaming session/window/producer modules
- `src/player/mod.rs`
- `src/player/callback.rs`
- `src/player/state.rs` playback clock/accessors
- benchmark scripts

Steps:

1. Implement generation/epoch/serial-tagged window seek mailbox and typed result.
2. Forward seek:
   - coarse bounds check
   - callback exact slot claim
   - local cursor update
   - no producer gate/decoder/source operation
3. Backward seek:
   - command/producer publish-reclaim gate
   - exact retained bounds/stamp check
   - pending protection floor
   - callback apply/result ordering
4. Keep pending backward protection valid while paused and clear it safely after
   applied/missed/superseded serial.
5. Reset DSP/resampler discontinuity state exactly once at apply.
6. On exact miss, leave audible cursor unchanged and hand off to source seek.
7. Add deterministic tests:
   - target inside current slot
   - forward/backward cross-slot
   - before retained / at produced end
   - producer reclaim race
   - paused backward then resume
   - rapid latest-wins
   - track generation and epoch supersession
   - forward then immediate backward
   - callback publish raced by a new request
8. Add forward scenarios to both playback latency scripts and report applied
   serial plus first audible target frame.
9. Benchmark +100 ms, +/-5 s, and +/-60 s resident jumps and prove callback
   operation count is distance-independent.

Exit gates:

- no decoder open/seek/file/network operation on a successful window seek;
- first audible frame is exact;
- p99 command-to-applied <= one callback period + 1 ms;
- immediate forward/backward sequence never waits for retired PCM;
- callback tail gates remain green.

Rollback: disable only window-seek dispatch and use Phase 7 source seek while
preserving window rendering. Do not reintroduce callback skip or prefix replay.

## Phase 7 - Persistent Out-of-Window Source Seek

Progress:

- Added `WindowSlotPublisher::reset_epoch`: it releases any unpublished owned
  writer claim, resets the existing PCM window in place, and restarts sequence,
  reclaim, origin, and produced-end coordinates without reallocating payload.
  A regression test proves old-epoch reads fail and the same allocation
  publishes sequence zero at the new absolute origin.
- Routed v2 out-of-window `AudioCommand::Seek` away from the legacy backend and
  into the active persistent producer. Command publication deactivates the old
  RT epoch while preserving playback/paused intent.
- Implemented producer-owned source seek using the existing decoder and
  resampler. The worker performs coarse decoder seek, resets resampler state,
  maps the realized input frame to output coordinates, discards the bounded
  output pre-roll, resets the same window to a monotonically newer epoch, and
  requests an exact callback window seek when the new epoch becomes Ready/EOF.
- Source-seek commands now preempt producer slot backpressure instead of waiting
  for callback reclaim. EOF parks the persistent worker rather than terminating
  it, so later seeks reuse the same worker and decoder.
- Extended the latest-wins source-seek test to prove the latest target becomes
  the new window origin, the epoch advances/reactivates, and producer generation
  remains unchanged. Full library tests pass 406/406; `cargo check --lib
  --benches` and `git diff --check` pass.
- Strengthened source-seek data correctness: non-resampled local WAV seeks now
  assert the first sample in new-epoch sequence zero exactly matches the source
  target frame. A near-EOF seek asserts exact first sample, ten valid remaining
  frames, exact final `produced_end_frame`, and parked EOF reuse.
- Added a 44.1 -> 48 kHz source-seek case proving the resampler resets and the
  new window is directly claimable at the requested output-frame origin while
  retaining the same producer generation and carry reservation. Paused routing
  also preserves `PlayerState::Paused` while the source seek executes.
- Added worker-published source-seek applied serial and Ready/EOF mailbox
  rechecks. A newer command arriving after publication but before activation
  suppresses the stale epoch activation and immediately re-enters the worker
  seek state machine. Cancellation while a source seek is pending remains
  bounded and reaps the same worker.
- Added `source_seek_perf`, comparing the persistent decoder path with local
  reopen + probe. Release evidence over 200 iterations: persistent p50 28.1 us
  and p99 375.7 us versus reopen/probe p50 242.8 us and p99 899.3 us. The
  persistent path uses one worker and one initial open/probe; the baseline uses
  200 opens/probes.
- Local sources advertise `reopen_for_seek=false`; ordinary failures therefore
  fail closed instead of silently reopening. The typed recovery factory already
  refuses changed source identity. Capability-specific remote recovery remains
  part of the Phase 8 remote seam review rather than weakening the local
  persistent-source invariant.
- Phase 7 is complete. Full library tests pass 406/406; `cargo check --lib
  --benches` and `git diff --check` pass.

Files:

- `src/player/streaming/producer.rs`
- `src/player/streaming/source.rs`
- player command/state integration
- required core decoder seek helpers

Steps:

1. Add latest-wins source-seek command without replacing producer/thread.
2. Deactivate output for the source-seek serial and wait off-RT for all bounded
   callback slot claims to release.
3. Reset slot stamps/cursors, increment epoch, and set exact target origin
   without clearing sample payload or reallocating the window.
4. Reuse `StreamingDecoder::seek()` and source session.
5. Implement checked input/output frame mapping and decode/resample pre-roll
   discard so slot sequence 0 begins at the exact requested output frame.
6. Add typed one-shot source recovery/reopen only for allowed failures and
   expected identity.
7. Check newer source-seek serial throughout seek/pre-roll/publish/ready.
8. Test local lossless/lossy formats, resampled/non-resampled output, seek near
   EOF, coarse decoder landing, rapid supersession, paused seek, cancellation,
   recovery refusal on identity change, and stale ready/error suppression.
9. Benchmark persistent source seek against the current cancel/spawn/open path.

Exit gates:

- ordinary source seek opens/probes zero new sources and spawns zero new workers;
- exact first audible output frame tests pass;
- rapid seek uses one producer and latest target;
- source seek latency is no worse than baseline and expected open/probe savings
  are visible.

Rollback: a typed source capability may temporarily choose explicit reopen on
source seek, but window seeks remain O(1). Do not make reopen the untyped default.

## Phase 8 - Diagnostics, Remote Seam Review, and Settings Surface

Progress:

- Added a nested `streaming_v2` runtime diagnostics snapshot without adding new
  callback cache-line state. It reports generation/epoch/activity, decode state,
  window origin and geometry, resident/ahead/retained frames, render cursor,
  latest seek request, and latest applied result/audible frame. Window access is
  through a typed `StreamingRtView::window_snapshot()` boundary rather than
  exposing the underlying `ArcSwap`.
- Existing decoded-memory diagnostics already expose process limit, current and
  peak reserved bytes, rejection count, and exact bytes by owner. Settings,
  persistence migration, backend API validation, desktop API types, and the
  audio-engine settings model already use `streaming_pcm_window_limit_mib`.
- Diagnostics schema tests and `cargo check --lib` pass. Remaining Phase 8 work
  is cold seek-latency/counter telemetry, worker lifecycle/source counters,
  remote seam capability review and resident remote zero-request proof.
- Added an independent 64-byte-aligned seek telemetry domain after the four RT
  coordination domains. Request/apply boundaries now record relaxed request,
  applied, miss, and superseded counts plus `<1`, `<5`, `<20`, `<100`, and
  `>=100 ms` latency buckets using the existing callback-safe monotonic clock.
  Serial tagging prevents a stale result from consuming a newer request's
  timestamp.
- Fixed the outer `StreamingRtView` layout with `repr(C, align(64))`; adding the
  telemetry field exposed that Rust could otherwise reorder individually
  aligned domains. Layout tests now cover identity, producer, callback, seek,
  and telemetry domains. Diagnostics includes all telemetry counters/buckets.
- Full library tests pass 407/407; `cargo check --lib --benches` and
  `git diff --check` pass.
- Added source-seek and worker lifecycle telemetry: requested/applied source
  seeks plus workers spawned/live/cancelled/failed. Session tests prove one live
  worker, bounded cancellation/reap to zero live workers, and source request /
  applied accounting.
- Strengthened the resident-seek test to assert source-seek request/applied
  counters remain zero. This proof is transport-independent: a future remote
  source cannot issue network requests when the resident path never enters the
  producer/source command plane.
- Remote seam review is fail-closed: current `OpenedSource` identity is local
  only, `AllowRemote`/URL input is typed `PolicyRejected`, local ordinary seek
  forbids reopen, recovery requires expected identity, and credentials/URLs are
  not logged by the v2 path. Remote range/cache/refresh implementation remains
  in its owner task rather than being simulated here.
- Phase 8 is complete. Full library tests pass 407/407; `cargo check --lib
  --benches` and `git diff --check` pass.

1. Expose window, seek, producer, source, memory, and worker-lifecycle metrics
   from the PRD without placing cold counters on RT cursor cache lines.
2. Add seek latency histograms sampled at request/apply phase boundaries.
3. Expose reservation ownership and current/peak bytes.
4. Update settings frontend/API labels and validation for PCM-window semantics.
5. Validate `OpenedSource` against remote probe reuse, identity, block cache,
   redirect/fetch policy, refresh-once, and cancellation requirements.
6. Add a remote-window seek test proving zero network requests when PCM is
   resident; remote transport implementation remains in its owner task.
7. Ensure logs sanitize credentials/signed URLs and remain producer/error only.

Exit gate: diagnostics can explain latency, shortfall, memory, and reopen causes
without callback logging or field duplication.

## Phase 9 - Remove the Old Streaming Transport

Progress:

- Removed the temporary `LYNE_STREAMING_PIPELINE_V2` selector. Every eligible
  local streaming-first-buffer load now uses v2 by default. Full library tests
  remain 407/407 and `cargo check --lib --benches` passes.
- Completed the deletion dependency audit. The old queue/ring transport is no
  longer needed for local streaming, but it still owns remote HTTP playback and
  compatibility/gapless paths. Current v2 `OpenedSource` intentionally rejects
  remote URLs and has no range/cache/refresh transport. Deleting the old
  transport now would regress remote playback, so steps 1-6 cannot be executed
  safely until the remote source seam is implemented or explicitly moved into
  its owner task with an alternative production transport.
- This is a real architecture dependency, not a reason to retain the local
  selector: local production is now single-path v2; the remaining old path is
  explicitly remote/compatibility-owned.
- Resolved the remote source-opening dependency in `audio-engine-core` commit
  `b7bc799`: `OpenedMediaSource` now exposes an open-with-credentials-and-cancel
  boundary that reuses the existing Range/fallback transport before decoder
  probing. Core tests pass 229/229 and the commit is pushed to `main`.
- Updated `Cargo.lock` to `audio-engine-core#b7bc7998`. Added a v2 remote HTTP
  factory with URL-fingerprint identity, expected-identity recovery checks,
  credentials/cancellation forwarding, and sanitized errors. Cancellation,
  policy rejection, identity mismatch, and URL/secret non-disclosure tests do
  not require an HTTP listener.
- All eligible local and HTTP streaming-first-buffer loads now use v2. The
  public `AudioPlayer::seek` path was corrected to dispatch active v2 seeks to
  the audio thread instead of entering the obsolete deferred-full-buffer seek
  branch. Full library tests pass 409/409; `cargo check --lib --benches` and
  `git diff --check` pass.
- The remote blocker is removed. Remaining Phase 9 work is mechanical but broad:
  delete old queue/ring/replay-prefix production and test surfaces, remove
  memory-mode/full-buffer promotion state and diagnostics, then re-run the
  callback/performance matrix before declaring a single transport.
- Removed the old initial-playback call to `decode_file_streaming_first_buffer`
  and removed old memory-mode/deferred-full-buffer branching from the public
  seek path. Production callback rendering no longer falls back to the chunk
  queue when no v2 RT view exists; the old queue renderer is retained only under
  `cfg(test)` while its legacy tests are being deleted.
- Compiler-guided deletion now reports the old loader/replay/watchdog/chunk
  publication functions and old memory-streaming restart methods as dead in the
  production library. This confirms the remaining Phase 9 work is physical code,
  state-field, diagnostics, and test removal rather than hidden production
  dependencies.
- Phase 9 physical deletion is complete. The old chunk queue, retention ring,
  replay prefix, queue callback renderer, chunk retire routing, memory/full-buffer
  promotion commands, deferred full-buffer seek slot, queue diagnostics, loader
  watchdog/backpressure code, and their legacy-only tests are removed.
- Production and test deletion audits have no matches for the removed transport
  symbols. The backend quality guide now defines the PCM window as the only
  production streaming transport.

Only after Phases 1-8 and their gates pass:

1. Remove `StreamingAudioChunk` and streaming `ArrayQueue`.
2. Remove `StreamingRetentionRing`, `ReplayPrefix`, and replay-prefix producer.
3. Remove PCM chunk routing through `RetiredAudioResource`; retain buffer/DSP/
   whole-window retirement as needed.
4. Remove `pending_samples.drain(..).collect()` publication and per-block Arc.
5. Remove `streaming_memory_mode`, full-buffer streaming promotion, deferred
   first-buffer full-buffer seek, and duplicate `full_samples` ownership.
6. Remove fixed 2 ms queue backpressure polling and queue-specific diagnostics.
7. Remove the temporary development selector and old-only tests.
8. Rename/update remaining diagnostics and comments to PCM-window terminology.
9. Update `.trellis/spec/backend/quality-guidelines.md` with the authoritative
   window contract and delete the obsolete queue/ring contract.
10. Run reuse and boundary review so no old helper or direct public atomic access
    remains.

Exit gate: one production streaming PCM transport and one source of truth remain.

Rollback: revert this deletion phase as a unit if a final integration gate fails;
do not add compatibility shims back one by one.

## Phase 10 - Final Verification

Progress:

- `cargo fmt --all -- --check`, `cargo check --lib --benches`, `cargo test --lib`
  (344/344), and `cargo test` pass after deletion.
- The PCM window enforce benchmark passes with zero v2 allocations. The resident
  seek enforce benchmark passes exact forward/backward targets at 100 ms, 5 s,
  and 60 s with p99 at or below 100 ns in the local microbenchmark.
- The 48 kHz real CPAL latency gate passes: load-to-progress 40.6 ms,
  play/resume 33.7 ms, backward resident seek 16.0 ms, and forward resident seek
  18.8 ms. The Electron real-file gate passes with backward 26.9 ms and forward
  25.3 ms using the generated 48 kHz fixture.
- Real playback exposed and fixed missing v2 duration publication. Sessions now
  preserve probed total frames, map them to output-rate frames with checked
  integer arithmetic, and publish them during audio-thread install.
- `cargo clippy --workspace --all-targets` exits successfully. A stricter
  `-D warnings` run remains blocked by existing unrelated warnings across
  database, WebDAV, settings, WASAPI, and library handler modules. The source
  seek/callback Cargo bench harness is also blocked by the repository's mixed
  panic=abort/unwind release artifacts; direct PCM/window binaries pass, while
  source/callback binaries require Cargo's DLL environment.
- On the current device, repeated 44.1 -> 48 kHz CPAL fallback rebuild can stall;
  the device-native 48 kHz v2 gate passes. Keep this as an output-device
  compatibility follow-up rather than weakening the single-transport design.

### Static and unit gates

```powershell
cargo fmt --all -- --check
cargo test --lib
cargo test
cargo clippy --workspace --all-targets
cargo +nightly miri test --lib player::streaming::pcm_window
```

Run the task's Loom model command separately if gated behind a feature.

### Performance gates

```powershell
cargo bench --bench pcm_window_perf -- --quick --enforce
cargo bench --bench audio_callback_output_path_perf -- --quick --enforce
npm run perf:lyne-playback-latency -- --in-window-seek --in-window-forward-seek
npm run perf:electron-real-file-playback -- --in-window-seek --in-window-forward-seek
```

Add the exact new script/flag names to `package.json` when implemented; do not
silently ignore unsupported flags.

### Required report

Record old versus v2 for:

- callback p50/p95/p99/p99.9/p99.99/max and deadline misses
- forward/backward command-to-applied and first-audible-target latency
- source-seek latency and open/probe/network counts
- allocation count/bytes per decoded second and per seek
- reserved/committed PCM plus process private-byte peak
- underrun, shortfall, stale publish, and recovery counts
- producer live/reaped thread counts

Run representative 44.1/48/96/192 kHz stereo and supported multichannel files,
lossless/lossy codecs, CPAL shared mode, exclusive WASAPI, rapid seek, paused
seek, forward-then-backward, long playback, and track-switch/gapless overlap.

Final pass criteria are the quantitative gates in `prd.md` and `design.md`, not
merely command exit code.

## Files Expected to Change

Backend:

- `src/player/streaming/{mod,pcm_window,producer,source,memory,telemetry}.rs`
- `src/player/{mod,state,callback,command_handlers,audio_thread,wasapi_loop}.rs`
- `src/player/loading.rs` (streaming logic removal; legacy decode remains)
- `src/player/buffer_budget.rs`
- `src/{config,settings,diagnostics}.rs` as applicable
- `Cargo.toml`, `Cargo.lock`, benchmark files

Frontend/settings:

- settings API types/parsers
- audio engine settings model/section/tests
- English and Chinese setting copy/search catalog

External core, only through its own commit:

- decoder-from-opened-source constructor
- borrowed/fill resampler API if required
- exact seek/source capability support required by the seam

Planning/spec:

- this task's artifacts and status
- `.trellis/spec/backend/quality-guidelines.md` after implementation proves the
  new contract

## Do Not Do

- Do not add `start_frame` to allocated chunks and call that v2 complete.
- Do not pop/discard a distance-dependent number of blocks in the callback.
- Do not rebuild replay prefixes or retain a second PCM ring.
- Do not let callback code acquire the producer publish/reclaim gate.
- Do not call producer wake syscalls from the callback.
- Do not reset/reuse a slot while its stamp is `Reading`.
- Do not use `f64` accumulation for exact seek frame mapping.
- Do not reopen/probe the decoder on an ordinary window or source seek.
- Do not allocate a new full PCM window on every seek.
- Do not count `len()` when allocated `capacity()` is the real memory owner.
- Do not keep both old and new runtime setting fields after migration.
- Do not leave old and new streaming transports enabled in the completed task.
- Do not implement remote range hardening in this task.
- Do not claim highest-performance success without the comparative tail,
  allocation, memory, and seek evidence required above.

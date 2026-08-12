# Migration Progress

## Status

`cargo check --lib` is clean: 0 errors, 0 warnings. The library source migration
to `audio-engine-core` 1.0.1 is complete. Remaining work is test/bench targets
and the dependency pin.

Error count trajectory: 93 -> 34 -> 13 -> 0.

## Completed Areas

### Shared resampler driver

`src/player/resample_stream.rs` is the single place that drives the core's
`StreamingProcessor` resampler contract. It exposes
`max_output_samples_for_input`, `input_frames_for_output_frames`,
`resample_into`, `drain_into`, `resample_append`, and `flush_append`. Every
consumer (offline decode, gapless preload, streaming session, realtime
callback, WASAPI loop) routes through it, so frame accounting is derived from
`ProcessProgress` in exactly one implementation.

### Realtime callback resampling

`resample_chunk_into_leftover()` in `src/player/callback.rs` reuses the
preallocated `scratch.resample_leftover` buffer as the core's caller-owned
output storage. The render loop already drains and clears that buffer before
each chunk, and its capacity is reserved off the realtime thread by
`CallbackScratch::reserve_resample_leftover`, so growing back to the existing
capacity and truncating afterwards neither allocates nor frees in the callback.
The consumed prefix is copied to the output and the remainder stays parked via
`resample_leftover_pos`.

### Convolver lifecycle

The old `Arc<ArcSwapOption<FFTConvolver>>` publish plus per-processor disposal
slot is replaced by the core's `ConvolverControl`:

- `build_dsp_chain` creates one `ConvolverControl` per chain and returns it.
- `LockfreeDspContext` keeps `Vec<(ConvolverControl, u32)>` so each chain's
  kernel is published in that chain's own sample-rate domain.
- `register_convolver_control(control, sample_rate_hz)` prunes quiescent
  controls, mirrors the enabled state, and seeds the currently merged kernel so
  a chain built after an IR load still convolves.
- `rebuild_merged_convolver()` stores the merged interleaved IR, publishes a
  fresh `FFTConvolver` per live control, then flips enabled. Removal disables
  first, so a consumer never observes `enabled == true` with no kernel.
- `reclaim_retired_convolver_kernels()` drains `reclaim_retired()` on the
  control thread before and after publication, so retired kernels are never
  freed on the audio thread and adoption never stalls on retirement
  backpressure.

### Noise shaper

`refresh_is_enabled()` and `process_cached()` were removed; the adapter now
syncs its snapshot inside `process`. `FinalNoiseShaper` in
`src/player/callback.rs` pairs the `NoiseShaperProcessor` with its
`Arc<AtomicNoiseShaperParams>` so the callback can pick an output path before
processing by reading the same lock-free snapshot the adapter will observe.
Shaping itself goes through `process_checked` with an in-place `AudioBlockMut`.
The WASAPI loop reuses the same type via `FinalNoiseShaper::process_in_place`.

### Fallible DSP construction

`DspChain::with_capacity`/`add`/`reset`/`set_sample_rate`/`process` and the
limiter, dynamic-loudness, and noise-shaper constructors are now fallible with
`u32` rates. `build_dsp_chain` and `LockfreeDspContext::new` return
`Result<_, String>`; every call site propagates:

- `audio_thread_main` logs the error, publishes it to `load_error`, sets
  `EVENT_LOAD_ERROR`, and returns instead of panicking.
- `rebuild_pending_dsp_chain` keeps the audio thread on its current chain.
- `build_wasapi_callback` returns `Result` and the caller stops playback.
- `build_requested_output_stream` / `build_fallback_output_stream` propagate.

### Realtime error reporting

The audio callback cannot log, allocate, or propagate. `SharedState` gained
`dsp_stage_error_count` plus `mark_dsp_stage_error()`; every fallible
reset/rate-change/process call inside the callback counts a failure there and
continues (emitting silence for the remainder of the callback when a resample
call fails).

### Loudness / EQ setter validation

`LoudnessNormalizer::set_target_lufs/set_album_gain/set_preamp_gain` and
`Equalizer::set_all_bands` now reject non-finite or unrepresentable values.
`effects_api.rs` logs the rejection and preserves the previous state rather
than persisting a value the engine refused.

## Remaining Work

1. `cargo check --all-targets` — test and bench glue was previously about 152
   errors and has not been re-measured since the library became clean.
2. `implement.md` step 8: remove the temporary
   `[patch."https://github.com/Asaiuta/audio-engine-core"]` from `Cargo.toml`,
   set `rev = "af5899886939add755217cc72865ed8426e3d9cc"`, refresh `Cargo.lock`,
   verify `cargo metadata --locked --no-deps`.
3. `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets
   --locked`, `cargo test --workspace --locked`.
4. Benchmark gates: callback output path, callback chain, resampler streaming.
5. Independent Tauri crate check/test.

## Files Changed In This Phase

- `src/player/callback.rs` (convolver control, noise shaper wrapper, resample
  driver use, realtime error counting)
- `src/player/state.rs` (`dsp_stage_error_count`, `mark_dsp_stage_error`)
- `src/player/audio_thread.rs` (fallible DSP context construction)
- `src/player/command_handlers.rs` (fallible chain rebuild)
- `src/player/output_stream.rs` (fallible chain build, `FinalNoiseShaper`)
- `src/player/wasapi_loop.rs` (fallible callback build)
- `src/player/effects_api.rs` (validated loudness/EQ setters)
- `src/player/mod.rs` (`callback` and `resample_stream` visibility)
- `src/wasapi_output.rs` (resample driver, `FinalNoiseShaper`)

---

# Final Verification (all gates run in the main session)

Every item under "Remaining Work" above is now complete. Recorded verbatim
results:

## Compilation

| Command | Result |
| --- | --- |
| `cargo check --lib --message-format short` | 0 errors, 0 warnings |
| `cargo check --all-targets --message-format short` | 0 errors |

Library error trajectory was 93 -> 34 -> 13 -> 0; test/bench glue was 121 -> 0.

## Dependency Pin

The temporary `[patch."https://github.com/Asaiuta/audio-engine-core"]` block is
removed. `Cargo.toml` now pins:

```toml
audio-engine-core = { git = "https://github.com/Asaiuta/audio-engine-core", rev = "af5899886939add755217cc72865ed8426e3d9cc" }
```

`cargo metadata --locked --no-deps` succeeds, and `Cargo.lock` resolves the
exact target revision:

```
name = "audio-engine-core"
version = "1.0.1"
source = "git+https://github.com/Asaiuta/audio-engine-core?rev=af5899886939add755217cc72865ed8426e3d9cc#af5899886939add755217cc72865ed8426e3d9cc"
```

The final `Cargo.toml` diff is exactly one line (the revision). An intermediate
sub-agent edit had also deleted the unused `pyo3` / `numpy` optional
dependencies and the `python` feature; those are unrelated to this task and were
restored, so the change belongs to `07-02-build-ci-hygiene` instead.

## Root Workspace Gates

| Gate | Result |
| --- | --- |
| `cargo fmt --all -- --check` | pass (exit 0, no diff) |
| `cargo clippy --workspace --all-targets --locked` | 0 errors (pre-existing `needless_range_loop` style warnings in benches remain) |
| `cargo test --workspace --locked` | 442 passed, 0 failed, 1 ignored (437 lib + 5 integration) |

## Benchmark Gates

All three required audio gates pass integrity checks. `--enforce` is a
deprecated alias of `--check`, and the harness says so explicitly.

| Bench | Verdict |
| --- | --- |
| `audio_callback_output_path_perf --quick --enforce` | `bench_gate verdict=passed ... mode=check` |
| `audio_callback_chain_perf --quick --enforce` | `bench_gate verdict=passed ... mode=check` |
| `audio_resampler_streaming_perf --quick --enforce` | `bench_gate verdict=passed ... mode=check` |

`audio_callback_output_path_perf` reported `deadline_misses=0` and
`deadline_miss_rate=0.000000000` across every scenario (`direct`, `shaper_only`,
`resampler_only`, `full`) at 64/128/256/512 frames, so the migrated realtime
resample and shaping path shows no callback deadline regression.

These are Check-mode integrity verdicts, not budget gates: they prove the
benchmarks run and their measurements are structurally valid. They are not
device, driver, DAC, or end-to-end latency evidence.

### Transient benchmark build failure (not a regression)

The first `audio_resampler_streaming_perf` invocation failed with 253 errors of
the form:

```
error: the crate `once_cell_polyfill` requires panic strategy `abort` which is incompatible with this crate's strategy of `unwind`
```

This was reproduced against the OLD pinned revision as well (89 errors there),
so it is a pre-existing incremental-cache interaction with `panic = "abort"` in
`[profile.release]`, not something this migration introduced. A clean rebuild
compiled and the gate then passed.

## Independent Tauri Crate

| Command | Result |
| --- | --- |
| `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets` | finished, 0 errors |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | 19 passed, 0 failed |

`cargo fmt --check` on that crate reports a diff in
`apps/desktop/src-tauri/src/main.rs` around line 248. That file is NOT modified
by this task (`git diff --stat` shows only `tauri.conf.json` dirty under
`src-tauri/`), so the formatting drift is pre-existing and out of scope here.

---

# Post-Check Remediation

`trellis-check` verified the migration and found one reachable audio bug plus
two smaller issues. All three are now addressed.

## HIGH — Convolver registry pruned the live chain (fixed)

### Defect

`register_convolver_control` pruned the registry with:

```rust
controls.retain(|(existing, _)| !existing.is_quiescent());
```

`ConvolverControl::is_quiescent()` is core's *"authoritative teardown check for a
stopped publisher set"*. It also returns `true` for a control whose consumer is
alive but merely **idle** — not enabled, no published or retired kernel,
generations equal. That is exactly the state of a chain that has been built and
installed but has not loaded an IR yet. Core exposes no public liveness signal:
`consumer_active` is private and its `ConsumerLease` clears only inside
`ConvolverProcessor::drop`. So probing core state cannot distinguish "consumer
gone" from "consumer idle".

Reachable path: `LockfreeDspContext::new` registers the initial chain's control;
that chain becomes `owned_dsp_chain` and `build_requested_output_stream` moves it
into the live cpal callback. Then `rebuild_pending_dsp_chain` (fires on **every
track load** via `dsp_needs_rebuild`), `build_wasapi_callback`, or the fallback
`build_dsp_chain` registers a second control and prunes the first. Because
`retain` runs before `push`, the list could stay at length 1 indefinitely.
`rebuild_merged_convolver` then published into a list that no longer contained
the playing chain, so a later external-IR/FIR load reached nothing and
convolution was **silently inaudible**.

This was a regression versus the pre-migration `Arc<ArcSwapOption<FFTConvolver>>`
design, where one shared slot was read by every chain, so no chain could be
forgotten.

### Fix

Registration lifetime now follows the owning chain's actual lifetime instead of
core state:

- New `TrackedConvolverProcessor` wraps the real `ConvolverProcessor` and holds
  an `Arc<AtomicBool>` liveness flag. It delegates every `StreamingProcessor`
  method unchanged and still reports `name() == "Convolver"`, so chain stage
  identity and the canonical order test are unaffected. Its `Drop` clears the
  flag, so the flag falls exactly when the chain is freed — including when the
  audio thread swaps a chain out and `RetiredAudioResource::Chain` drops it on
  the control thread.
- `convolver_controls` became `Vec<RegisteredConvolver>` (control, rate,
  `chain_alive`), and pruning tests `chain_is_alive()` only. A pruned entry is
  drained with `reclaim_retired()` first so its last parked kernel is freed on
  the control thread rather than leaking with the registration.
- `build_dsp_chain` now returns `(DspChain, ConvolverChainRegistration)`; the
  registration carries the control plus its liveness flag, so a caller cannot
  register a control without its liveness signal.

Invariants preserved: publish-then-enable and disable-then-drop ordering is
untouched; each live chain still receives its own kernel instance in its own rate
domain; kernels are still reclaimed only on the control thread.

### Regression tests

- `registering_another_chain_keeps_idle_live_chain_convolving` — builds the
  initial chain, registers a second chain, asserts **both** remain registered,
  then loads an IR and asserts the initial still-playing chain actually
  convolves. Verified to fail against the old `is_quiescent()` prune
  (`left: 1, right: 2`) and pass after the fix.
- `dropping_a_chain_releases_its_convolver_registration` — a genuinely dropped
  chain's registration is pruned rather than retained forever.
- `publishing_kernel_drains_parked_retired_convolvers` extended to assert the
  registered count is 2, so it no longer only observes the survivor.

## MEDIUM — `dsp_stage_error_count` was write-only (fixed)

`mark_dsp_stage_error()` was called from ~10 callback sites but nothing read the
counter, while two doc comments in `src/player/state.rs` claimed it was
*"surfaced through the diagnostics plane"*. Every realtime DSP failure — rejected
rate change, failed reset, failed resample producing silence — was invisible in
production.

`dsp_stage_error_count` is now a field on `PlaybackDiagnostics` in
`src/server/diagnostics.rs`, populated next to the existing
`underrun_count` / `underrun_silence_frames` counters. The doc comments are now
true.

## LOW — Stale spec locations (recorded for the spec-update step)

`.trellis/spec/backend/remote-fetch-boundaries.md` needs three corrections. Not
edited here; spec updates belong to the separate spec-update step.

| Line | Stale content | Correction |
| --- | --- | --- |
| ~21 | `MediaSourceAccess` signature block lists `address_policy: HttpAddressPolicy` | This task removed that field |
| ~60 | Requires `HttpAddressPolicy::trusted_origin` and states *"The configured origin may intentionally be a LAN/private address"* | Now FALSE per decision D1: core 1.0.1 unconditionally rejects private/loopback/link-local/CGNAT addresses with no opt-in, so a LAN WebDAV source can no longer be opened |
| ~74 | Names revision `5389c32f66c52c2d0b870acdeae4b20cf9c9de47` as destination-policy owner | Should name `af5899886939add755217cc72865ed8426e3d9cc` |

The resample-driver contract, the convolver control/registration lifecycle, and
the realtime fallible-DSP error policy are also currently undocumented in
`.trellis/spec/backend/`. The HIGH bug above was precisely a violation of the
lifecycle invariant, so that gap has demonstrated cost.

## Re-run Gates

| Gate | Result |
| --- | --- |
| `cargo check --lib --message-format short` | 0 errors |
| `cargo check --all-targets --message-format short` | 0 errors |
| `cargo fmt --all -- --check` | pass (after one `cargo fmt --all`) |
| `cargo clippy --workspace --all-targets --locked` | 0 errors, no new warnings |
| `cargo test --workspace --locked` | 444 passed, 0 failed, 1 ignored (439 lib + 5 integration; +2 new convolver regression tests) |
| `cargo bench --bench audio_callback_chain_perf -- --quick --enforce` | `bench_gate verdict=passed bench=audio_callback_chain_perf mode=check reason=` |
| `cargo bench --bench audio_convolver_perf` | report-only (no gate spec); `process_into` 10.161 ns/sample at 2ch and 11.002 ns/sample at 6ch, both faster than their legacy counterparts |

`audio_convolver_perf` again hit the pre-existing
`panic strategy abort ... incompatible with ... unwind` incremental-cache
interaction on first invocation and compiled cleanly on retry, matching the
behavior already recorded for `audio_resampler_streaming_perf`.

---

# Second Check Round (focused re-check of the remediation)

The remediation's convolver-lifetime fix is correct, but its liveness test was
tautological, and hiding behind it was a second, larger migration defect.

## HIGH — `build_dsp_chain` never published the chain rate to its stages (fixed)

### Defect

`DspChain::add` validates that a stage is 1:1 at the chain rate, but it does
**not** push that rate into the stage. `ConvolverProcessor::new` hardcodes
`sample_rate_hz: 44_100` and `ConvolverProcessor::process` passes audio through
untouched whenever `owned.sample_rate_hz != self.sample_rate_hz`.

`LockfreeDspContext::build_dsp_chain` created the chain with
`DspChain::with_capacity(7, sample_rate)`, added the stages, and returned — so
every convolver stage stayed in the 44_100 Hz domain regardless of the real rate,
while the publisher correctly published kernels at the chain's actual rate. Every
rate mismatch meant external IR and FIR convolution were **silently inaudible**.

Core's own `OutputChainBuilder::build_callback_chain` closes this gap with
`chain.set_sample_rate(sample_rate_hz)?` after adding its stages; the app's
builder omitted the equivalent call.

Blast radius: all four `build_dsp_chain` callers — `LockfreeDspContext::new`,
`rebuild_pending_dsp_chain` (every track load), `output_stream.rs`, and
`wasapi_loop.rs`. Anything not at exactly 44.1 kHz lost convolution, so 48 kHz —
the common Windows shared-mode default — was broken.

Measured with a 0.25 single-frame impulse and 0.5-valued input:

| Chain rate | No kernel | Kernel published | Verdict |
| --- | --- | --- | --- |
| 44_100 Hz | 0.35397289 | 0.08849322 | applied |
| 48_000 Hz | 0.35397289 | 0.35397289 | **never applied** |

This was masked because the pre-migration `ConvolverProcessor` took its enabled
state and kernel slot directly and had no per-stage rate gate to desynchronize.

### Fix

`build_dsp_chain` now calls `chain.set_sample_rate(sample_rate)` after adding
every stage and propagates the error as a build failure, mirroring core.

## HIGH — The liveness regression test was tautological (fixed)

`registering_another_chain_keeps_idle_live_chain_convolving` asserted only
`buffer.iter().any(|s| s.abs() > 1e-9)` after publishing a **unit** impulse
`[1.0, 1.0]`. Two independent reasons that assertion could not detect a missing
kernel:

1. A chain with no kernel is a **passthrough**, not silence
   (`process_fixed_1_to_1("Convolver", false, None, ...)`), so non-silence holds
   whether or not the kernel arrived. The test comment claimed the opposite
   ("a chain that never received the kernel outputs silence instead").
2. A single-frame unit impulse is the identity filter, so even a correctly
   adopted kernel is bit-identical to passthrough.

Verified: `no_kernel`, `unit_ir`, and `quarter_ir` all produced exactly
`0.35397289219206896`. The assertion passed while the convolver was doing
nothing at all.

The test now captures the no-kernel passthrough output as an explicit baseline,
publishes an attenuating `[0.25, 0.25]` impulse, and asserts the output both
differs from that baseline and is attenuated.

### New test

`built_chain_convolves_at_every_supported_sample_rate` pins the rate-propagation
invariant directly across 44_100 / 48_000 / 96_000 Hz using the same
baseline-versus-attenuation comparison.

Both tests were verified to fail with the `set_sample_rate` call removed
(`48000 Hz never applied its kernel: 0.35397289 vs 0.35397289`) and to pass with
it restored.

## Verified clean in this round

- `TrackedConvolverProcessor` delegation is complete: core's
  `impl StreamingProcessor for ConvolverProcessor` overrides exactly `name`,
  `process`, `finish`, `reset`, `tail`, and `set_sample_rate`; the wrapper
  forwards all eight trait methods, so no core override can fall back to a trait
  default. `FixedInPlaceProcessor` is correctly re-claimed, and `name()` still
  resolves to core's `"Convolver"`.
- The wrapper adds no realtime cost: `process` is a single unconditional
  delegation with no allocation, lock, or shared-state branch. The
  `Arc<AtomicBool>` is touched only in `Drop`.
- Pruning cannot lose a kernel. `ConvolverProcessor::drop` releases `owned`,
  `incoming`, and `pending_retire` before `acknowledge_drained()`, and only the
  audio consumer can `try_retire`. Once the consumer is dropped nothing can
  retire again, so the `while existing.control.reclaim_retired() {}` drain on a
  dead entry is sufficient.
- Drop ordering is safe **by current call sites, not by construction**:
  `TrackedConvolverProcessor::drop` clears the flag before the inner
  `ConvolverProcessor::drop` finishes, so a concurrent
  `register_convolver_control` could observe a dead flag while the inner consumer
  is mid-teardown. That is harmless today because the drained slot only becomes
  non-empty through the consumer, and both paths are control-thread
  (`drain_retired_audio_resources` on the audio command loop; registration on
  load/output-build). It is not enforced by a type or lock — a future audio-thread
  or worker-thread chain drop would need a re-check.
- `dsp_stage_error_count` diagnostics placement, `Ordering::Relaxed` (matching
  the surrounding counters), and snake_case serialization all match convention;
  the `src/player/state.rs` doc comments are now accurate.

## Re-run Gates

| Gate | Result |
| --- | --- |
| `cargo fmt --all -- --check` | pass |
| `cargo clippy --workspace --all-targets --locked` | 0 errors; only pre-existing `map_or`/style warnings in bench targets |
| `cargo test --workspace --locked` | 445 passed, 0 failed, 1 ignored (440 lib + 5 integration; +1 new rate regression test) |

Release benches were not re-run in this round. The change adds one control-thread
`set_sample_rate` call at chain construction and no realtime work, so the
recorded `audio_callback_chain_perf` and `audio_convolver_perf` verdicts still
apply.

## Spec gap (for the spec-update step)

Add to `.trellis/spec/backend/`, alongside the convolver lifecycle contract
already noted: **a `DspChain` built by the app must publish its rate to its
stages before use**, because `add()` validates rate compatibility without
setting it, and stages that carry private rate state default to 44_100 Hz.
Realtime DSP tests must compare against the **no-kernel passthrough** baseline,
never against silence, and must use a non-identity kernel.

---

# Second Remediation Round

The focused re-check of the first remediation found two further HIGH defects.
Both are fixed and independently verified by the main session.

## HIGH — `build_dsp_chain` never published the chain rate to its stages (fixed)

### Defect

`DspChain::add` validates that a stage is 1:1 at the chain rate but does **not**
push that rate into the stage. `ConvolverProcessor::new` hardcodes
`sample_rate_hz: 44_100`, and its `process` passes audio through untouched
whenever `owned.sample_rate_hz != self.sample_rate_hz`.

The app's `build_dsp_chain` created the chain at the real rate, added stages, and
returned. Every convolver stage therefore stayed in the 44.1 kHz domain while the
publisher correctly published kernels at the chain's actual rate, so the two
never matched. External IR and FIR convolution was **silently inaudible at any
rate other than 44.1 kHz**, including 48 kHz — the common Windows shared-mode
default. All four callers were affected, including `rebuild_pending_dsp_chain` on
every track load.

Core's own `OutputChainBuilder::build_callback_chain` closes exactly this gap with
a `chain.set_sample_rate(...)?` call after adding its stages; the app's builder
omitted it. This was a migration defect, not a consequence of the first
remediation.

### Fix

`build_dsp_chain` now mirrors core and calls `chain.set_sample_rate(sample_rate)`
after adding all stages, propagating the error.

### Independent verification

Removing only that call and re-running the new test reproduces the defect
exactly, and the failure is rate-specific as predicted:

```
a chain built at 48000 Hz never applied its kernel:
  0.35397289219206896 vs no-kernel passthrough 0.35397289219206896
```

44.1 kHz passed in the same run (it happened to match the hardcoded default),
which is precisely why the bug was invisible before. Restoring the call makes the
test pass.

## HIGH — The first round's liveness regression test was tautological (fixed)

`registering_another_chain_keeps_idle_live_chain_convolving` asserted only
non-silence after publishing a **unit** impulse. That cannot detect a missing
kernel, for two independent reasons:

1. A convolver with no kernel is a **passthrough**, not silence
   (`process_fixed_1_to_1("Convolver", false, None, ...)`). The original test
   comment asserted the opposite.
2. A single-frame unit impulse is the identity filter, so even a correctly
   applied kernel is bit-identical to passthrough.

`no_kernel`, `unit_ir`, and `quarter_ir` all produced exactly
`0.35397289219206896`. The test passed while the convolver did nothing. Only its
registered-count assertion (`left: 1, right: 2`) was real.

The test now baselines the no-kernel passthrough output, publishes an
attenuating `[0.25, 0.25]` kernel, and asserts both difference from and
attenuation relative to that baseline. A new
`built_chain_convolves_at_every_supported_sample_rate` covers 44.1/48/96 kHz.

## Convolver wrapper audit (clean)

- Core overrides exactly `name`, `process`, `finish`, `reset`, `tail`, and
  `set_sample_rate`. `TrackedConvolverProcessor` forwards all eight trait
  methods, so no override can silently degrade to a trait default.
  `FixedInPlaceProcessor` is correctly re-claimed and `name()` still resolves to
  `"Convolver"`.
- `process` is one unconditional delegation: no allocation, lock, or shared-state
  branch. The `Arc<AtomicBool>` is touched only in `Drop`, a control-thread
  operation.
- Pruning cannot lose a kernel: `ConvolverProcessor::drop` releases
  `owned`/`incoming`/`pending_retire` before `acknowledge_drained()`, and only
  the audio consumer can `try_retire`. Nothing can be retired after the consumer
  drops, so the dead-entry drain is sufficient.

### Accepted residual risk

Drop ordering is safe by current call sites, not by construction. The liveness
flag clears before the inner processor's drop completes, so a concurrent
registration could in principle observe a dead flag mid-teardown. This is
harmless today because the retired slot fills only via the audio consumer and
both paths are control-thread, but no type or lock enforces it. A future chain
drop from the audio thread or a worker would need to re-check this.

## Re-run Gates (second round)

| Gate | Result |
| --- | --- |
| `cargo fmt --all -- --check` | pass |
| `cargo clippy --workspace --all-targets --locked` | 0 errors (only pre-existing bench `map_or` style warnings) |
| `cargo test --workspace --locked` | 445 passed, 0 failed, 1 ignored (440 lib + 5 integration) |

Release benches were not re-run: the change adds one control-thread call at chain
construction and no realtime work, so the recorded `audio_callback_chain_perf`
and `audio_callback_output_path_perf` verdicts still apply.

## Worktree scope confirmation

Task-owned changes are limited to `Cargo.toml`, `Cargo.lock`, `src/**`,
`benches/**`, and this task's `.trellis/tasks/08-12-.../` files. The untracked
`rust-toolchain.toml` was reviewed and is **not** part of this task: its mtime is
2026-08-11, predating task creation on 2026-08-12.

## Spec-update inputs

Beyond the three `remote-fetch-boundaries.md` corrections recorded above, the
spec-update step should add durable contracts for:

1. An app-built `DspChain` must publish its rate to its stages after adding
   them; `DspChain::add` validates the rate but does not propagate it, and a
   stage carrying its own rate state will otherwise sit in core's internal
   default domain and silently pass audio through.
2. Realtime DSP tests must baseline against the no-kernel **passthrough** output,
   never against silence, and must use a non-identity kernel. A unit impulse
   cannot distinguish "applied" from "not applied".
3. The convolver control/registration lifecycle: registration lifetime follows
   the owning chain's actual lifetime, not `ConvolverControl::is_quiescent()`.
4. The realtime fallible-DSP error policy and the shared resample-driver
   contract, both still undocumented.

# Prove Lyne core playback and library value

## Goal

Produce an evidence-backed verdict for Lyne's two core value claims, then turn the gaps into concrete follow-up work instead of relying on README wording or intuition:

1. Local library scanning is fast and stable, with accurate cover art and lyrics.
2. Playback quality and DSP are controllable, and the experience is meaningfully stronger than an ordinary Electron music player.

## What I Already Know

- The user asked whether these claims are actually achieved; the honest current answer is likely "partly, not proven end to end."
- Current task: `.trellis/tasks/05-31-prove-lyne-core-playback-library-value`.
- Existing unrelated dirty state must be preserved: `README.md` and `apps/desktop/output/`.
- Local scan code lives mainly in `src/server/playback/library_scan.rs` and `src/app_database/media_items.rs`.
- Scan persistence already has a project spec contract in `.trellis/spec/backend/database-guidelines.md` for local batch writes, source identity, cover art cache rows, fallback behavior, and required benchmark coverage.
- Existing benchmark evidence exists under `.trellis/tasks/05-30-backend-performance-benchmark-gates/research/benchmark-results.md`.
- Current scan benchmarks are strong for synthetic local scan and DB-write shapes, but they explicitly do not prove real user library behavior, real audio decode/tag corpus accuracy, WebDAV behavior, or actual WebSocket I/O.
- A deterministic one-track local scan fixture now proves the running HTTP scan task can index a 31s WAV and sidecar cover through the real local scan path. It still does not prove real user-library breadth, lyrics, malformed tags, WebDAV, or memory behavior.
- Cover art handling has a real implementation path: sidecar cover detection, embedded cover storage, file-backed cover references for large covers, lazy cover fallback, and stale file-backed cover self-heal hooks.
- Lyrics have multiple implemented paths: sidecar/embedded local lyrics, SPlayer-style local override lookup by song id for `ttml` and `lrc`, NCM title/artist online fallback for local tracks, and NCM supplement lyrics for online tracks.
- Current lyric capability is not yet fully proven against SPlayer-like expectations. Known risk areas include QQ Music fallback, selectable lyric source priority, filters/cleanup, and Chinese variant conversion.
- Playback/DSP has a real backend path: Symphonia/local decode, SoXR resampling, CPAL/WASAPI output, lock-free DSP parameter snapshots, EQ/FIR, crossfeed, saturation, loudness/true-peak, dither/noise shaping, output bit depth, and UI/settings controls.
- Existing DSP and callback tests/benchmarks prove pieces of the engine, but not yet an end-user A/B claim that the app is clearly better than ordinary Electron playback.
- A runtime control probe now proves active playback can start from a local WAV fixture and nine DSP/output controls can round-trip through HTTP routes and `/state` readback during playback.

## Assumptions

- This is first a proof task, not a marketing copy task.
- If a claim cannot be reproduced locally or measured with a durable harness, the task should mark it as unproven even if the source code looks sophisticated.
- "Better than ordinary Electron player" should be translated into measurable evidence: output control, latency/underrun resilience, DSP feature coverage, callback safety, CPU/memory overhead, and user-visible control surface.

## Open Questions

- None currently. Requirements are ready for final confirmation.

## Requirements (Evolving)

- Build a current evidence map for both claims: source, tests, benches, runtime behavior, and missing proof.
- Separate "implemented", "tested", "benchmarked", "real-world proven", and "product-visible" states.
- Produce a clear verdict for each sub-claim: pass, partial, missing, or unproven.
- Define acceptance thresholds for any chosen harness before implementing it.
- MVP scope selected by user: evidence report plus playback/DSP A/B harness.
- The playback/DSP harness should prove both capability and control, not merely list implemented DSP modules.
- A/B baseline strategy selected by user: external Electron/WebAudio mini baseline rather than only internal Rust bench comparison.
- External baseline must be a real Electron/WebAudio fixture, not a Chromium-only proxy.
- Electron fixture may add an `apps/desktop` dev dependency and update `apps/desktop/package-lock.json`.
- Baseline output should label itself as `electron-webaudio-fixture` and write generated measurement output under ignored `apps/desktop/output/`.
- Lyne-side evidence should reuse the existing Rust bench commands instead of inventing an unrelated benchmark surface.
- Convert confirmed gaps into concrete follow-up Trellis tasks or a remediation plan.
- Keep existing README work and generated output untouched unless the user explicitly includes them.
- Generated probe outputs belong under ignored `apps/desktop/output/`; task research records summaries, commands, and limitations instead of committing JSON artifacts.
- Scope update on 2026-06-01: the user supplied a real local music library at `D:\移动云盘挂载\15869685321\Music` and asked to compare performance against SPlayer if feasible.
- Real-library evidence should record aggregate counts, elapsed scan time, indexed item count, metadata/cover presence, and process-level CPU/memory samples without listing private song names.
- SPlayer comparison should first determine whether a runnable installed SPlayer exists and whether its library import/scan can be automated. If automation is not available, record the exact blocker rather than pretending an A/B was completed.

## Acceptance Criteria (Evolving)

- [x] PRD records the two value claims and current evidence sources.
- [x] `research/current-evidence.md` summarizes existing proof and limitations.
- [x] `research/proof-standard.md` defines what evidence would make each claim credible.
- [x] A scope decision is recorded before Phase 2 starts.
- [x] Final output includes an evidence table and direct verdict for both claims.
- [x] External Electron/WebAudio baseline strategy is recorded before Phase 2 starts.
- [x] Playback/DSP A/B harness is repeatable from documented commands and records results under this task.
- [x] Playback/DSP proof covers the existing callback/DSP benchmarks and one user-visible control-surface check.
- [x] Real Electron fixture command exists in `apps/desktop/package.json`.
- [x] Electron fixture writes a JSON result with baseline identity, scenario timings, feature matrix, and limitations.
- [x] Follow-up gaps are linked to existing tasks or proposed as new Trellis tasks.
- [x] Real-library scan benchmark runs against the user-supplied local library and records aggregate result metrics under task research.
- [x] SPlayer comparison feasibility is recorded with either runnable A/B data or an explicit blocker.

## Definition of Done

- Tests or benchmark commands are run for any changed code.
- Any new harness has a documented command, expected output shape, and limitations.
- Existing backend real-time audio constraints are preserved: no allocations, locks, logging, or I/O in callback hot paths.
- Existing local scan database contracts are preserved.
- The final answer is honest about what is proven, what is plausible, and what is not achieved.

## Out of Scope

- Rewriting README claims before evidence is collected.
- Broad SPlayer UI parity work.
- Implementing desktop/taskbar lyrics.
- Shipping new DSP algorithms unless the chosen proof path requires a minimal measurement hook.
- WebDAV scan proof unless explicitly pulled into the MVP.
- Broad WebDAV or destructive corpus mutation remains out of scope.
- Full SPlayer UI automation is out of scope unless the installed app exposes a practical import/scan path during evidence collection.

## Research References

- [`research/current-evidence.md`](research/current-evidence.md) - current repo evidence, benchmarks, and limitations.
- [`research/proof-standard.md`](research/proof-standard.md) - proposed standard for proving the two value claims.
- [`research/playback-dsp-harness-options.md`](research/playback-dsp-harness-options.md) - feasible A/B harness strategies after inspecting current bench surfaces.
- [`research/electron-webaudio-baseline-results.md`](research/electron-webaudio-baseline-results.md) - implemented Electron fixture results, Lyne-side tests, and blocked bench notes.
- [`research/runtime-probe-results.md`](research/runtime-probe-results.md) - isolated audio-server runtime probe results for active playback controls and one-track fixture scanning.
- [`research/real-library-scan-results.md`](research/real-library-scan-results.md) - real local library scan result and SPlayer native scanner comparison.
- [`research/final-verdict.md`](research/final-verdict.md) - evidence table, verdict, and follow-up work.
- Existing benchmark baseline: `.trellis/tasks/05-30-backend-performance-benchmark-gates/research/benchmark-results.md`.

## Technical Notes

- Relevant specs inspected:
  - `.trellis/spec/backend/index.md`
  - `.trellis/spec/backend/database-guidelines.md`
  - `.trellis/spec/backend/quality-guidelines.md`
  - `.trellis/spec/frontend/index.md`
- Likely backend files:
  - `src/server/playback/library_scan.rs`
  - `src/app_database/media_items.rs`
  - `src/server/playback/media_assets.rs`
  - `src/server/playback/library_domain_handlers.rs`
  - `src/server/lyrics.rs`
  - `src/server/netease.rs`
  - `src/server/netease/playback_actions.rs`
  - `src/player/callback.rs`
  - `src/player/audio_thread.rs`
  - `src/processor/**`
  - `src/server/effects.rs`
  - `src/config.rs`
- Likely frontend files:
  - `apps/desktop/src/shared/api/lyrics.ts`
  - `apps/desktop/src/shared/api/effects.ts`
  - `apps/desktop/src/features/settings/sections/AudioEngineSection.tsx`
- Existing benchmark entrypoints:
  - `cargo bench --bench backend_library_scan_perf -- --quick --enforce`
  - `cargo bench --bench audio_callback_chain_perf -- --quick`
  - `cargo bench --bench audio_callback_output_path_perf -- --quick`
  - `cargo bench --bench audio_resampler_streaming_perf -- --quick`
  - `cargo bench --bench playback_load_budget_perf -- --quick --enforce`

## Decision (ADR-lite)

**Context**: The first brainstorm choice was whether this task should only report evidence, add a real-library scan harness, or add playback/DSP A/B proof.

**Decision**: User selected option 3: evidence report plus playback/DSP A/B harness.

**Consequences**: Phase 2 should focus on proving the audio-engine value claim first. The local library scan claim still receives an evidence verdict, but any real-library scan harness becomes a follow-up unless the user changes scope.

**Scope update**: On 2026-06-01 the user supplied a real library path and asked
for SPlayer comparison, so a narrow real-library benchmark and SPlayer native
scanner baseline were pulled into this task.

### External Baseline Decision

**Context**: After the user selected playback/DSP A/B proof, there were three possible baseline strategies: internal Rust bench baseline, runtime control probe, or external Electron/WebAudio mini baseline.

**Decision**: User selected the external Electron/WebAudio mini baseline.

**Consequences**: Planning must account for dependency/tooling cost. The current repo has no root `package.json`; `apps/desktop/package.json` is Vite/Tauri and does not include Electron. A literal Electron fixture likely requires adding a dev dependency and install step, while a Chromium/WebAudio harness can approximate ordinary Electron playback without adding Electron itself.

### Literal Electron Fixture Decision

**Context**: The user was offered a choice between a literal Electron fixture, a Chromium/WebAudio proxy, or a two-stage proxy-then-Electron path.

**Decision**: User selected the literal Electron fixture.

**Consequences**: Phase 2 may add `electron` as a dev dependency in `apps/desktop`, update `package-lock.json`, and create a source-controlled script under `apps/desktop/scripts/`. Any generated result JSON/screenshots should stay under ignored `apps/desktop/output/`.

## Technical Approach

- Add a repeatable Electron/WebAudio baseline command under `apps/desktop`, for example `npm run perf:electron-webaudio`.
- The Electron fixture should run headlessly/hidden, create a minimal WebAudio playback-style graph, and measure deterministic scenarios such as pass-through, gain/filter nodes, analyser-like sampling, and optional offline rendering where supported.
- Pair Electron fixture results with existing Lyne native evidence from:
  - `cargo bench --bench audio_callback_chain_perf -- --quick`
  - `cargo bench --bench audio_callback_output_path_perf -- --quick`
  - `cargo bench --bench audio_resampler_streaming_perf -- --quick`
  - `cargo bench --bench playback_load_budget_perf -- --quick --enforce`
  - `cargo test player::callback --lib`
  - `cargo test processor:: --lib`
- Add a small product-facing matrix that compares controls available in the Electron/WebAudio fixture against Lyne controls: output device/exclusive mode, output bit depth, SoXR resampling, lock-free native DSP, EQ/FIR, loudness/true-peak, dither/noise shaping, crossfeed, saturation, and runtime control persistence.
- Record limitations honestly: WebAudio measurements are not a bit-perfect audio quality judgement and may not include actual device output, but they provide a literal ordinary Electron/WebAudio baseline for capability and overhead comparison.

## Implementation Plan

- PR1: Add Electron fixture script and npm command, with generated JSON output under `apps/desktop/output/electron-webaudio-baseline/`.
- PR2: Add evidence collector or documentation that pairs Electron baseline output with existing Rust bench commands.
- PR3: Run/record results, update this task's research notes, and produce the final verdict/remediation plan.

## Final Confirmation Snapshot

**Goal**: Prove or disprove Lyne's core value claims, with MVP emphasis on the playback/DSP claim against a literal Electron/WebAudio baseline.

**Requirements**:

- Keep local scan/cover/lyrics in the evidence verdict, and include the user-supplied real-library scan benchmark plus SPlayer native scanner comparison.
- Implement a real Electron/WebAudio mini baseline.
- Reuse existing Lyne Rust audio benches as the native-path evidence.
- Produce a direct pass/partial/missing/unproven verdict and follow-up plan.

**Out of Scope**:

- README rewrite.
- Broad UI parity.
- Desktop/taskbar lyrics.
- New DSP algorithms.
- Broad real-library scan harness beyond the supplied corpus.

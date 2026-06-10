# Playback/DSP Harness Options

Date: 2026-05-31

## Current Bench Surfaces

Existing relevant commands and coverage:

- `cargo bench --bench audio_callback_chain_perf -- --quick`
  - Exercises `DspChain` scenarios: bypass, active DSP without convolver, active DSP with convolver.
  - Prints current results and comparisons against an embedded `original_baseline()`.
  - Excludes CPAL device write, decoder, resampler, spectrum, loudness pre-gain, and gapless state machine.
- `cargo bench --bench audio_callback_output_path_perf -- --quick`
  - Exercises `audio_callback_lockfree` final output path scenarios: direct, shaper-only, resampler-only, full.
  - Reports best, median, and worst timing per output sample/buffer.
  - Excludes decoder and CPAL device write.
- `cargo bench --bench audio_resampler_streaming_perf -- --quick`
  - Covers SoXR streaming resampler behavior.
- `cargo bench --bench playback_load_budget_perf -- --quick --enforce`
  - Covers decoded playback memory budget decisions.
- `cargo test player::callback --lib` and `cargo test processor:: --lib`
  - Cover callback capacity and DSP module behavior.

## Feasible A/B Strategies

### Approach A: Bench-Level Internal A/B

Compare Lyne's current native callback/DSP path against a minimal pass-through or historical baseline inside Rust benches.

How:

- Extend or add a benchmark that reports `lyne_native` vs `ordinary_electron_like_baseline`.
- Define the baseline as pass-through float buffer processing with no native exclusive output, no lock-free DSP, no SoXR resampling, and no loudness/true-peak/noise-shaping controls.
- Keep the comparison deterministic and CI/developer-machine friendly.

Pros:

- Fastest to implement.
- Reuses existing bench architecture.
- Good for proving technical capability and overhead budget.

Cons:

- It is a model of "ordinary Electron player," not an actual Electron/WebAudio app.
- Does not prove user-visible control changes during playback.

### Approach B: Runtime Control Probe

Run Lyne's backend/app path and programmatically exercise DSP controls while playback state exists, then record whether settings persist and endpoints change backend state without deadlocks.

How:

- Use existing HTTP APIs and settings storage.
- Probe EQ, output bits, noise shaper, dither, loudness mode, saturation, crossfeed, dynamic loudness, and resample quality.
- Pair the runtime probe with the existing cargo benches.

Pros:

- Stronger product proof than bench-only evidence.
- Directly tests "DSP 可控" rather than only "DSP exists."
- Can catch no-op controls, parser drift, and handler deadlocks.

Cons:

- Needs a reliable local server/app start path.
- Actual audio device output and subjective sound quality still remain out of scope unless more instrumentation is added.

### Approach C: External Electron/WebAudio Mini Baseline

Build a tiny Electron/WebAudio baseline or use an existing minimal player to compare output/control capabilities.

How:

- Add a separate fixture app or script that runs WebAudio-like processing.
- Compare feature matrix, CPU/memory, and control granularity.

Pros:

- Closest to the phrase "ordinary Electron player."
- Easier to explain in product language.

Cons:

- Adds toolchain and maintenance cost.
- Risks spending time proving the baseline rather than improving Lyne.
- WebAudio timing/output measurements may be noisy and not directly comparable to native callback benches.

## Recommendation

Use Approach B as the product-facing MVP and keep Approach A as the deterministic performance evidence:

- Existing benches become the measured audio-engine proof.
- A new runtime control probe or documented control matrix proves that the product actually exposes and wires the controls.
- External Electron/WebAudio comparison remains optional follow-up if product messaging needs a literal third-party baseline.

## User Decision

The user selected Approach C: external Electron/WebAudio mini baseline.

Repo feasibility notes after inspection:

- There is no root `package.json`.
- `apps/desktop/package.json` is a Vite/Tauri package with no Electron dependency.
- Existing scripts include `perf:routes`, which dynamically imports Playwright when installed, but Playwright is not listed in package dev dependencies.
- Existing generated browser probes live under `apps/desktop/output/playwright/`, which is currently untracked/generated and should not be treated as source.

Implications:

- A literal Electron mini baseline will likely require adding an Electron dev dependency or a separate fixture package.
- A Chromium/WebAudio baseline can use the same browser engine class that Electron embeds and may avoid a heavy dependency, but it is not literally an Electron shell.
- The final evidence should label the baseline honestly:
  - `electron-webaudio-fixture` only if Electron is actually used.
  - `chromium-webaudio-proxy` if Playwright/Chromium is used as a dependency-light proxy.

## User Follow-Up Decision

The user selected the literal Electron fixture path.

Planned implementation shape:

- Add `electron` as a dev dependency in `apps/desktop` if it is not already available.
- Add a script command such as `perf:electron-webaudio`.
- Keep generated results under `apps/desktop/output/electron-webaudio-baseline/`.
- Keep the fixture intentionally small: it should represent an ordinary Electron/WebAudio player, not a second full app.
- Compare against Lyne using existing Rust audio benches plus a product control matrix.

# Proof Standard

This task should avoid binary "valuable / not valuable" claims until the evidence distinguishes implementation, tests, benchmarks, and real-world behavior.

## Claim 1: Local Scan Fast, Stable, Accurate

Minimum credible proof:

- A repeatable benchmark command for cold and warm local scans.
- A real-library or corpus harness that reports:
  - track count, file extensions, total size, and elapsed time;
  - scan throughput and peak memory where practical;
  - skipped/failed files with reason counts;
  - stale deletion behavior;
  - cancellation latency;
  - cover source distribution: embedded, sidecar, file-backed cache, missing;
  - lyric source distribution: sidecar, embedded, override, online cache/fallback, missing.
- A small deterministic fixture corpus for regression tests, including malformed tags, missing covers, sidecars, large covers, multiple lyric formats, and non-UTF lyric encodings.
- A result format that can be compared across commits.

Suggested verdict thresholds:

- Pass: real/corpus run completes without hangs, no unbounded memory growth, cancellation remains responsive, common cover/lyric cases match expected sources, and failed files are isolated.
- Partial: synthetic benchmarks pass but real/corpus proof is missing or has accuracy gaps.
- Missing: scanner is slow, blocks, corrupts metadata, or cannot report accuracy.

## Claim 2: Playback Quality And DSP Control

Minimum credible proof:

- A feature-control matrix showing which controls are product-visible, persisted, and connected to the backend audio path.
- A repeatable audio/DSP benchmark suite covering:
  - callback output path;
  - full DSP chain;
  - resampler streaming;
  - true-peak/loudness path;
  - playback load memory budget.
- A runtime stability probe while playback is active:
  - toggle EQ/crossfeed/saturation/loudness/noise shaping;
  - change output bits and resample quality where safe;
  - verify no command deadlock and no callback hot-path violation.
- Either an A/B baseline or a defensible comparison standard for "ordinary Electron player."

Recommended comparison standard:

- Baseline "ordinary Electron player" means a minimal WebAudio/Electron playback path with no WASAPI exclusive mode, no explicit output bit-depth control, no lock-free native DSP chain, no SoXR-quality resampling, no true-peak/loudness pipeline, and no real callback safety budget.
- Lyne can claim stronger technical capability if it shows those controls are wired, measured, and stable.
- Lyne can claim a stronger experience only after a user-visible runtime proof shows the controls behave predictably during playback and do not add obvious glitches or latency.

Suggested verdict thresholds:

- Pass: feature matrix plus benchmarks plus runtime control probe all pass.
- Partial: backend engine and controls exist, but no runtime or A/B proof exists.
- Missing: controls are WIP/no-op, settings do not affect playback, or the callback path violates real-time constraints.

## MVP Options

Option A: Evidence report only

- No production code changes.
- Re-run focused tests/benches where feasible.
- Produce a verdict and remediation plan.
- Best when the immediate goal is product direction.

Option B: Evidence report plus real-library scan benchmark harness

- Add or extend a repeatable harness that scans a real user-selected or fixture library and writes anonymized results.
- Best first implementation because the local library claim is concrete, high-value, and currently under-proven.

Option C: Evidence report plus playback/DSP A/B harness

- Add a runtime or benchmark harness comparing Lyne's native path against a baseline/control path or a feature matrix probe.
- Best if the product direction hinges on proving audio-engine superiority first.

Initial recommendation:

- Option B. The scan claim is easier to make objectively credible, and real-library scan proof will also expose cover/lyric accuracy gaps that are currently hidden by synthetic benchmarks.

User-selected MVP:

- Option C. Prioritize playback/DSP A/B proof first, while keeping the local library claim in the evidence report and follow-up plan.

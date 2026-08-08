# Playback Latency Benchmark

Date: 2026-06-05

Latest seek/resume-phase retest: 2026-06-06

This page records local real-file playback benchmarks used to compare Lyne's
native audio engine with a plain Electron/WebAudio baseline. These numbers are
evidence for the machine, files, and settings below; they are not a universal
claim about every device, driver, cache state, or Electron player.

## Test Material

Primary track:

```text
D:\移动云盘挂载\15869685321\Music\Aimer - Through My Blood AM.flac
```

Next-track probe:

```text
D:\移动云盘挂载\15869685321\Music\八木海莉 - Sing My Pleasure.flac
```

Large-file probe:

```text
D:\移动云盘挂载\15869685321\Music\aethoro - Arielle's Wish.flac
```

Common settings:

| Setting | Value |
| --- | ---: |
| Trials | 20 |
| Poll interval | 10 ms |
| Settle delay | 350 ms |
| In-window preroll | 10000 ms |
| In-window backward seek | 6 s |

## A. Bare Transport

Lyne used the `bare` playback profile: EQ, loudness, ReplayGain, dither,
crossfeed, saturation, and dynamic loudness disabled. The source file is 96 kHz
and the active output was 48 kHz, so Lyne still exercised the native streaming
path and callback resampler.

Electron used `--no-webaudio`, which means plain `HTMLMediaElement` playback.
Chromium's internal decode/resample/output path is not directly configurable or
reported by this benchmark.

| Metric, p50 unless noted | Lyne bare | Electron bare |
| --- | ---: | ---: |
| load-to-progress | 1.3 ms | 96.5 ms |
| resume-to-progress | 34.7 ms | 0.4 ms |
| seek convergence | 19.7 ms | 10.8 ms |
| seek progress-after | 31.6 ms | 84.5 ms |
| seek combined | 51.2 ms | 95.3 ms |
| in-window seek combined | 16.4 ms | 87.0 ms |
| Peak working set | 72.8 MB | 439.1 MB process tree |

Lyne diagnostics in this A run: `recovery=0`, operation-local underruns were
zero, and the full run recorded `underrun=1 / 170 frames` plus
`streaming_output_shortfall=60`. The shortfalls were mostly seek-window
diagnostics, not sustained playback instability.

Result files:

- `apps/desktop/output/lyne-evidence/a-bare-20x/playback-latency-benchmark.json`
- `apps/desktop/output/electron-real-file-playback-baseline-a-bare-20x/real-file-playback-baseline.json`

## B. Light DSP And Control

Lyne used `light-dsp`: native 10-band EQ enabled, volume `0.78`, while loudness,
ReplayGain, dither, crossfeed, saturation, and dynamic loudness remained
disabled for a focused DSP-control comparison.

WebAudio used a 10-filter graph plus gain and analyser. The compressor was
disabled with `--no-compressor`.

| Metric, p50 unless noted | Lyne light-dsp | WebAudio light-dsp |
| --- | ---: | ---: |
| load-to-progress | 1.2 ms | 30.4 ms |
| resume-to-progress | 34.6 ms | 32.6 ms |
| seek convergence | 19.1 ms | 10.7 ms |
| seek progress-after | 31.6 ms | 31.5 ms |
| seek combined | 50.7 ms | 42.2 ms |
| in-window seek combined | 15.7 ms | 32.4 ms |
| next-track to progress | 14.3 ms | 388.1 ms |
| DSP/control p95 | 1.9 ms | 0.1 ms |
| 30 s stability | pass | pass |
| Peak working set | 105.6 MB | 426.7 MB process tree |

The control numbers are intentionally not identical layers: Lyne measures
HTTP/server/native DSP control latency, while WebAudio measures JavaScript
parameter update latency inside the renderer.

Lyne 30-second stability window: `recovery=0`, `underrun=0`,
`streaming_output_shortfall=0`, `load_error=0`, `playback_false_samples=0`.
Across the whole extended latency run, Lyne still recorded one global underrun
outside the stability window (`390` frames) and `61` streaming shortfalls during
stress operations. Keep both facts visible: the steady-state sample was clean,
but stress-path diagnostics still exist.

Result files:

- `apps/desktop/output/lyne-evidence/b-light-dsp-extended-20x/playback-latency-benchmark.json`
- `apps/desktop/output/electron-real-file-playback-baseline-b-light-dsp-extended-20x/real-file-playback-baseline.json`

## Current Takeaway

Lyne has strong evidence for fast first-buffer playback, low-memory native
streaming, fast retained-window backward seek, and very fast queue next-track
promotion. WebAudio still has an edge on resume and regular seek convergence in
the primary 96 kHz FLAC run. The native callback/DSP/resampler microbenchmarks
below also show that Lyne's realtime processing budget is small relative to a
typical audio callback buffer, but those microbenchmarks do not measure final
analog output quality.

## Seek And Resume Phase Retests

On 2026-06-06, a 5-trial release smoke retest was run on the primary 96 kHz
FLAC with streaming first-buffer enabled, preemptive resampling disabled,
`AUDIO_STREAMING_FULL_BUFFER_LIMIT_MIB=256`, and 10 ms polling. The benchmark
now records both the historical `/state current_time > 0.02s` progress proxy
and player-side first-position phase timestamps from `/diagnostics/runtime`.

| Metric, p50 unless noted | Current Lyne release smoke |
| --- | ---: |
| load-to-progress proxy | 1.4 ms |
| load first-position advance | 12 ms |
| resume-to-progress proxy | 35.5 ms |
| resume first-position advance | 13 ms |
| regular seek convergence | 21.4 ms |
| regular seek progress-after | 45.7 ms |
| regular seek first-position advance | 14 ms |
| regular seek first chunk to ready sent | 0 ms |
| regular seek request returned to streaming ready | 8 ms |
| in-window backward seek convergence | 1.3 ms |
| in-window backward seek progress-after | 16.2 ms |
| in-window backward seek first-position advance | 8 ms |
| Global diagnostics | 0 recovery / 0 underrun / 0 shortfall |
| Peak working set | 64.9 MB |

After the warm shared-stream resume cleanup, a second 5-trial release smoke was
run with the same track/settings and the updated benchmark field
`progress_proxy_minus_first_position_ms`. This follow-up did not enable the
optional in-window backward-seek scenario.

| Metric, p50 unless noted | Resume-focused release smoke |
| --- | ---: |
| load-to-progress proxy | 1.4 ms |
| load first-position advance | 16 ms |
| resume-to-progress proxy | 34.3 ms |
| resume first-position advance | 10 ms |
| resume proxy minus first-position | 31.3 ms |
| regular seek convergence | 18.0 ms |
| regular seek progress-after | 31.6 ms |
| regular seek first-position advance | 12 ms |
| regular seek request returned to streaming ready | 8 ms |
| Operation-local resume diagnostics | 0 recovery / 0 underrun / 0 shortfall |
| Operation-local seek diagnostics | 0 recovery / 0 underrun / 0 shortfall |
| Full-run diagnostics | 0 recovery / 1 underrun / 170 audio-buffer shortfall frames / 0 streaming shortfall |
| Peak working set | 49.9 MB |

Interpretation:

- The earlier in-window seek convergence regression is no longer reproduced in
  the current release smoke: convergence is back to ~1 ms and first-position
  advance is under one callback-sized interval on this machine.
- The 700-800 ms tail from the earlier recovery/shortfall investigation is not
  present in this run. `playback_recovery_count`, global underrun counters,
  audio-buffer shortfall counters, streaming shortfall counters, and streaming
  queue drops all stayed at zero.
- The historical progress proxy is still useful for end-to-end user-visible
  `/state` behavior, but resume and seek progress-after include the 0.02 s
  threshold plus polling quantization. The new first-position fields better
  isolate player-side audio progress.
- The resume-focused follow-up shows the same measurement split more directly:
  `/state` resume proxy p50 was 34.3 ms, while player-side first-position
  advance was 10 ms. The new proxy-minus-first-position field reports a 31.3 ms
  p50 gap, so the remaining headline resume cost is mostly the 0.02 s progress
  threshold plus 10 ms polling/HTTP observation, not additional player-side
  resume work.

Result file:

- `apps/desktop/output/lyne-evidence/seek-phase-smoke-release-streaming-current-inwindow-5trial/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/resume-phase-current-5trial/playback-latency-benchmark.json`

## Multi-Format Smoke Matrix

To check whether the playback response evidence only held for the original
96 kHz FLAC, two additional real-library files were measured with the same
light-DSP profile. These matrix runs used fewer trials (`8`) and shorter
stability windows (`10 s`) than the primary A/B run, so treat them as format
coverage evidence rather than the headline benchmark.

| Format sample | Engine | load p50 | resume p50 | seek combined p50 | in-window combined p50 | Stability |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 44.1 kHz FLAC, stereo | Lyne | 1.2 ms | 34.5 ms | 30.1 ms | 33.4 ms | 0 recovery / 0 underrun / 0 shortfall |
| 44.1 kHz FLAC, stereo | WebAudio | 30.9 ms | 22.7 ms | 32.9 ms | 33.1 ms | pass |
| 44.1 kHz MP3, stereo | Lyne | 1.5 ms | 33.5 ms | 26.5 ms | 36.4 ms | 0 recovery / 0 underrun / 0 shortfall |
| 44.1 kHz MP3, stereo | WebAudio | 38.4 ms | 21.8 ms | 32.6 ms | 31.4 ms | pass |

Interpretation:

- Lyne's first-buffer load advantage persists across the tested FLAC and MP3
  samples.
- Lyne's regular seek convergence is much faster on these 44.1 kHz samples than
  on the original 96 kHz FLAC, which suggests the 96 kHz to 48 kHz streaming
  path was part of the earlier seek cost.
- WebAudio remains faster on resume.
- The additional Lyne runs used small-file full-buffer mode. Their
  `streaming_queue_dropped_count` counters are expected startup-queue drops
  after the full-buffer fallback is available, not playback underruns; underrun
  and streaming shortfall counters stayed at zero.

Result files:

- `apps/desktop/output/lyne-evidence/matrix-flac-secondary-light-dsp-8x/playback-latency-benchmark.json`
- `apps/desktop/output/electron-real-file-playback-baseline-matrix-flac-secondary-light-dsp-8x/real-file-playback-baseline.json`
- `apps/desktop/output/lyne-evidence/matrix-mp3-yaoxingshendu-light-dsp-8x/playback-latency-benchmark.json`
- `apps/desktop/output/electron-real-file-playback-baseline-matrix-mp3-yaoxingshendu-light-dsp-8x/real-file-playback-baseline.json`

## Large FLAC Memory-Bounded Sample

The large-file probe used a 120,132,699-byte FLAC from the real local library.
Lyne was run with streaming first-buffer enabled, preemptive resampling disabled,
and `AUDIO_STREAMING_FULL_BUFFER_LIMIT_MIB=256` to exercise the bounded
streaming path. WebAudio used the same 10-filter light-DSP graph as section B,
with the compressor disabled.

These runs used `8` trials and a `10 s` stability window, so they are coverage
evidence rather than the headline result.

| Metric, p50 unless noted | Lyne light-dsp | WebAudio light-dsp |
| --- | ---: | ---: |
| load-to-progress | 1.3 ms | 31.4 ms |
| resume-to-progress | 34.1 ms | 31.9 ms |
| seek convergence | 20.7 ms | 10.7 ms |
| seek progress-after | 32.6 ms | 21.6 ms |
| seek combined | 53.3 ms | 32.3 ms |
| in-window seek convergence | 0.9 ms | 10.9 ms |
| in-window seek progress-after | 14.8 ms | 21.6 ms |
| in-window seek combined | 15.7 ms | 32.5 ms |
| 10 s stability | 0 recovery / 0 underrun / 0 shortfall | pass |
| Peak working set | 53.5 MB | 111.1 MB process tree |

Lyne diagnostics across the full large-FLAC stress run recorded
`recovery=0`, `underrun=0`, `streaming_queue_dropped=0`, and
`streaming_output_shortfall=15 / 7200 frames` during seek operations. The
stability window itself stayed clean: `recovery=0`, `underrun=0`,
`streaming_output_shortfall=0`, `load_error=0`, and
`playback_false_samples=0`.

Result files:

- `apps/desktop/output/lyne-evidence/matrix-large-flac-arielle-light-dsp-8x/playback-latency-benchmark.json`
- `apps/desktop/output/electron-real-file-playback-baseline-matrix-large-flac-arielle-light-dsp-8x/real-file-playback-baseline.json`

## Native Processing Budget Evidence

The end-to-end benchmarks above prove user-visible response for real files. The
following checks cover a different question: whether Lyne's native
callback/DSP/resampler building blocks have a realtime-friendly budget and test
coverage.

Current test runs:

| Command | Result | Coverage note |
| --- | ---: | --- |
| `cargo test player::callback --lib` | 29 passed | callback streaming, EOF, scratch reuse, resampler/shaper/direct/full paths, gapless swap, DSP chain swap |
| `cargo test processor:: --lib` | 136 passed | EQ, saturation, crossfeed, convolver, dynamic loudness, loudness, limiter, noise shaping, resampler, spectrum |
| `cargo test processor::resampler --lib` | 13 passed | frame order, equal-rate handling, append/borrowed equivalence, warm-capacity reuse |
| `cargo test processor::loudness --lib` | 27 passed | EBU R128 meter wiring, true peak, limiter queue, ramping, no-alloc steady-state tests |

Quick runtime budget benches:
> Gate contract (2026-08): canonical realtime benches use `--check` for
> deterministic integrity and `--gate --gate-spec benches/gate-specs/<bench>.gate.json`
> for real budget verdicts. `--enforce` is a deprecated alias of `--check`.
> Exit codes: 0 passed, 1 budget failed, 2 unsupported/misconfigured env,
> 3 integrity failed. Report mode (no flag) never fails on timing. Budget
> verdicts are host-sensitive: the spec's `environment.class` must match
> `BENCH_GATE_ENV_CLASS`, otherwise the verdict is `unsupported` (exit 2),
> never passed.
>
> Artifact identity (2026-08, PERF-005): every report JSON embeds a versioned
> `provenance` block (schemaVersion 1) with git HEAD, dirty-tree fingerprint,
> branch, build profile/toolchain, host, and fixture hashes. Two artifacts are
> comparable only when `gitHead` AND `dirtyFingerprint` match — same commit on
> a dirty tree is NOT comparable evidence. Dirty fingerprint is a SHA-256 of
> the normalized `git status --porcelain` output; no paths leak into artifacts.
>
> Source-seek caveat (2026-08, PERF-002): `source_seek_perf` measures LOCAL
> open/seek/probe latency on a deterministic generated WAV. It is NOT remote
> fetch latency, NOT device-audible latency, and does NOT exercise the
> latest-wins seek serialization (owned by the seek-race remediation task).
> Its `--check` mode enforces the relative guard
> `persistent p50 <= reopen p50 + 2 ms` (structural invariant) and `--gate`
> evaluates the absolute budgets in `benches/gate-specs/source_seek_perf.gate.json`.

| Bench | Representative path | 512-frame result | Includes | Excludes |
| --- | --- | ---: | --- | --- |
| `source_seek_perf --quick --check` | persistent session seek | p50 ~8 us, p99 ~60-115 us (quick) | in-process persistent seek spin-wait, local WAV fixture | remote fetch, device output, first-audible-frame, latest-wins serialization |
| `source_seek_perf --quick --check` | reopen + probe | p50 ~150 us, p99 ~190-380 us | fresh local open + decoder probe | remote fetch, device output, first-audible-frame |
| `audio_callback_output_path_perf --quick --check` | full output path | median 18.4 ns/output sample, 18.8 us/buffer | callback state, disabled loudness gain, empty DSP chain, resampler, final shaper, spectrum pack | decoder, CPAL device write |
| `audio_callback_chain_perf --quick --check` | active DSP without convolver | 20.9 ns/sample, 21.4 us/buffer | EQ, saturation, crossfeed, limiter, volume, dynamic loudness, noise shaper | decoder, resampler, spectrum, CPAL device write |
| `audio_callback_chain_perf --quick --check` | active DSP with convolver | 45.1 ns/sample, 46.2 us/buffer | same chain plus convolver | decoder, resampler, spectrum, CPAL device write |
| `audio_resampler_streaming_perf --quick --check` | 44.1 kHz to 48 kHz streaming resampler | 9.4 ns/input sample, 9.6 us/input buffer | streaming resampler only | decoder, callback DSP chain, CPAL device write |

Bench logs:

- `apps/desktop/output/lyne-evidence/audio-runtime-budget-quick-2026-06-05/audio_callback_output_path_perf.log`
- `apps/desktop/output/lyne-evidence/audio-runtime-budget-quick-2026-06-05/audio_callback_chain_perf.log`
- `apps/desktop/output/lyne-evidence/audio-runtime-budget-quick-2026-06-05/audio_resampler_streaming_perf.log`

Interpretation:

- Lyne now has good engineering evidence that its native DSP and resampler paths
  are controllable and realtime-budgeted.
- This still does not prove perceptual sound quality by itself. The next section
  adds offline objective measurements for resampler THD+N, frequency response,
  stopband rejection, limiter ceiling behavior, dither/noise-shaping spectrum,
  and loudness-meter reference parity.

## Objective Offline Audio-Quality Measurements

`audio_quality_measurements` generates synthetic f64 signals, runs them through
Lyne's Rust processor modules, and analyzes the rendered buffers numerically. It
does not use CPAL/WASAPI, OS mixers, DAC/ADC loopback, speakers, or microphones.
Treat these numbers as native-rendered-buffer evidence, not analog output
capture.

Command:

```powershell
cargo bench --profile release --bench audio_quality_measurements -- --enforce --out apps/desktop/output/lyne-evidence/audio-quality-2026-06-05/audio_quality_measurements_full.json
```

The explicit `--profile release` is intentional. The repository's release
profile uses `panic = "abort"`; plain `cargo bench` can build the custom
no-harness benchmark with Cargo's default bench panic strategy and fail before
running the probe.

On this machine the current full run used the equivalent direct bench
executable path after compiling with a one-shot panic-strategy override:

```powershell
cargo build --profile release --config "profile.release.panic='unwind'" --bench audio_quality_measurements
.\target\release\deps\audio_quality_measurements-2b863f7868f74c8b.exe --enforce --out apps/desktop/output/lyne-evidence/audio-quality-2026-06-05/audio_quality_measurements_full.json
```

Conditions:

| Condition | Value |
| --- | --- |
| Measurement path | offline f64 synthetic signal -> Rust processor modules -> numeric analysis |
| Resampler phase / quality | Linear / UltraHigh |
| THD+N method | least-squares sine fit with DC term; residual RMS / fitted sine RMS |
| Frequency response | single-tone amplitude fit after 44.1 kHz -> 48 kHz resampling |
| Stopband | 96 kHz -> 48 kHz, above-output-Nyquist tones folded into output band |
| Limiter | `PeakLimiter` sample-peak ceiling and below-threshold transparency |
| Noise shaping | 16-bit `NoiseShaper` error signal FFT with Hann window; equal-width 2-6/6-10/14-18 kHz RMS bands |
| Loudness reference | Lyne `LoudnessMeter` wrapper compared with direct `ebur128` over deterministic f64 fixtures |
| Public loudness corpus | Direct `ebur128` expected-value checks against the EBU Tech 3341/3342 corpus in `libebur128/test` |
| Full output true peak | source f64 -> `PeakLimiter` -> optional `StreamingResampler` -> 24-bit final `NoiseShaper` -> f32 output -> true-peak meter |

Results:

| Metric | Result |
| --- | ---: |
| Analyzer floor, 997 Hz at -6 dBFS | -269.1 dB |
| Resampler THD+N, 44.1 kHz -> 48 kHz | -187.0 dB |
| Limiter below-threshold THD+N | -238.3 dB |
| Resampler passband max deviation, 20 Hz to 18 kHz | 0.0013 dB |
| 20 kHz resampler gain | -0.0062 dB |
| Limiter stress input peak | +5.11 dBFS |
| Limiter output peak | -1.00 dBFS |
| Limiter margin above threshold | 0.0000 dB |
| Worst fitted alias attenuation, 96 kHz -> 48 kHz | -294.7 dB |
| Worst broad residual attenuation, 96 kHz -> 48 kHz | -217.6 dB |
| TPDF noise, 2-6 kHz / 14-18 kHz bands | -104.16 / -104.17 dBFS |
| Lipshitz5 noise, 2-6 kHz / 14-18 kHz bands | -120.98 / -95.46 dBFS |
| FWeighted9 noise, 2-6 kHz / 14-18 kHz bands | -125.38 / -96.15 dBFS |
| ImprovedE9 noise, 2-6 kHz / 14-18 kHz bands | -127.52 / -92.79 dBFS |
| Strongest shaped high-vs-ear-band advantage over TPDF | +34.75 dB |
| Loudness fixture max integrated delta vs direct ebur128 | 0.000000 LU |
| Loudness fixture max momentary / short-term delta | 0.000000 / 0.000000 LU |
| Loudness fixture max LRA delta | 0.000000 LU |
| Loudness fixture max true-peak delta | 0.000000023 dB |
| Public EBU loudness corpus pass count | 55 / 55 files |
| EBU global loudness max abs error | 0.029032 LU |
| EBU LRA max abs error | 0.000432 LU |
| EBU max momentary / short-term max abs error | 0.006402 / 0.066260 LU |
| EBU true-peak corpus pass count | 9 / 9 files |
| EBU true-peak max abs expected error | 0.181438 dB |
| Full output-chain worst true peak | +1.977 dBTP |
| Full output-chain points above -1 dBTP | 6 / 10 |

Result files:

- `apps/desktop/output/lyne-evidence/audio-quality-2026-06-05/audio_quality_measurements_full.json`

Interpretation:

- The native resampler evidence is now strong on this synthetic set: very low
  fitted THD+N, flat passband through 18 kHz, minor 20 kHz rolloff, and deep
  stopband rejection on 30/36/42 kHz tones downsampled to 48 kHz.
- The limiter evidence shows transparent below-threshold behavior on a -6 dBFS
  sine and exact sample-peak ceiling on a +5.11 dBFS transient stress signal.
- The noise-shaping evidence shows the expected contrast: TPDF-only stays
  essentially flat across equal-width bands, while shaped curves strongly reduce
  the 2-6 kHz error band and push more error energy into 14-18 kHz. Total
  shaped-error RMS can be higher; the point of these curves is spectral
  redistribution, not lower broadband noise.
- The loudness evidence proves wrapper parity against direct `ebur128` for the
  deterministic fixtures, including integrated, momentary, short-term, LRA, and
  true peak. It is not an independent laboratory certification of BS.1770
  compliance.
- The public EBU Tech 3341/3342 corpus now adds expected-value checks for
  integrated loudness, LRA, max momentary, max short-term, and true peak. These
  are direct `ebur128` corpus checks with explicit channel mapping; the Lyne
  wrapper parity evidence remains the deterministic stereo fixture section
  above.
- The full output-chain true-peak probe is intentionally report-only for the
  `-1 dBTP` ceiling. It shows the current sample-peak/lookahead limiter can
  still produce intersample true peaks above `-1 dBTP` after the output chain
  on stressed material, with a worst observed value of `+1.977 dBTP`. That is a
  real limitation, not a benchmark failure.
- This does not yet prove analog-device output, OS mixer behavior, headphone
  perception, or every DSP effect setting. It also does not replace listening
  tests.

## Five-Minute Native Stability Sample

A separate 5-minute Lyne native playback stability run was executed on the
original 96 kHz FLAC with the heavier DSP stress profile from
`lyne-playback-stability-benchmark.cjs`.

| Metric | Value |
| --- | ---: |
| Duration | 300 s |
| Diagnostics samples | 298 |
| Pass | true |
| Underrun delta | 0 |
| Silent frames delta | 0 |
| Load error delta | 0 |
| Playback false samples | 0 |
| Current-time monotonic resets | 0 |
| Peak working set | 47.8 MB |
| Peak CPU | 0.564% |

Result file:

- `apps/desktop/output/lyne-evidence/stability-light-dsp-5min/playback-stability-benchmark.json`

This improved the stability evidence beyond a 30-second smoke run. The
30-minute soak below is the stronger current stability sample.

## Thirty-Minute Native Stability Soak

A 30-minute foreground stability soak was executed on the same 96 kHz FLAC with
the benchmark's DSP stress profile enabled. The script uses `loop_track=true`;
near the end of each pass it seeks back to 0.5 seconds so a shorter test track
can cover the full wall-clock duration. Therefore the reported current-time
monotonic resets are expected loop seeks, not playback stalls.

| Metric | Value |
| --- | ---: |
| Duration | 1800 s |
| Diagnostics samples | 1784 |
| Pass | true |
| Diagnostics latency p50 / p95 | 10.4 ms / 14.5 ms |
| Underrun delta | 0 |
| Silent frames delta | 0 |
| Load error delta | 0 |
| Playback false samples | 0 |
| Loop/monotonic resets | 7 |
| Peak working set | 223.7 MB |
| Peak CPU | 11.391% |

Result file:

- `apps/desktop/output/lyne-evidence/stability-light-dsp-30min-foreground/playback-stability-benchmark.json`

The evidence now covers the major playback-response surfaces, but it is still
not a complete "better audio experience" proof. Remaining evidence gaps:

- Packaged release soak and longer 60-minute runs, preferably with a playlist
  rather than a looped single track.
- More format coverage: AAC/M4A samples, long files, and more high-resolution
  files beyond the single large-FLAC sample above.
- Additional audio-quality measurements: analog/device loopback captures and a
  true-peak-limiting improvement if Lyne wants to guarantee a post-chain
  intersample ceiling such as `-1 dBTP`.
- UI/runtime evidence: renderer FPS, lyrics scrolling, visualizer cost, and
  settings interaction while audio is active.
- SPlayer end-to-end playback comparison with the same response metrics.

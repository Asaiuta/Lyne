# Electron/WebAudio Baseline Results

Date: 2026-05-31

## Fixture

- Source: `apps/desktop/scripts/electron-webaudio-baseline.cjs`
- Command: `npm run perf:electron-webaudio`
- Output: `apps/desktop/output/electron-webaudio-baseline/baseline.json`
- Baseline identity: `electron-webaudio-fixture`
- Electron version used locally: 39.4.0
- Chrome version reported by Electron: 142.0.7444.265

The fixture uses a hidden Electron `BrowserWindow`, runs an `OfflineAudioContext`
WebAudio graph in the renderer, and writes a JSON report with parameters,
scenario timings, a feature matrix, environment data, and limitations.

## Dependency Notes

The first attempt used `electron@42.3.0`, but `node node_modules/electron/install.js`
timed out while trying to fetch the Electron binary. The local machine already had
an Electron 39.4.0 zip cached under the Electron cache for the npmmirror URL. The
fixture dependency was changed to `electron@^39.4.0`, then binary installation
completed after setting:

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
node node_modules/electron/install.js
```

This keeps the fixture literal Electron/WebAudio while avoiding a blocked GitHub
binary fetch in the local environment.

## Validation Commands

Passed:

```powershell
node --check scripts/electron-webaudio-baseline.cjs
npm run perf:electron-webaudio -- --duration 0.75 --trials 2 --warmup 1
npm run perf:electron-webaudio
npm run perf:electron-realtime-playback -- --trials 1 --control-toggles 1 --stability-seconds 0.1 --sample-ms 500 --no-context-advance-wait --user-data-dir output/electron-realtime-playback-baseline/profile-supervisor
npm run perf:electron-real-file-playback -- --track <real-track.flac> --next-track <real-next-track.flac> --trials 1 --stability-seconds 3 --control-toggles 10 --sample-ms 500 --user-data-dir output/electron-real-file-playback-baseline/profile-smoke-final
npm run perf:lyne-control-probe -- --base-url http://127.0.0.1:63892 --token <redacted> --track <fixture.wav> --require-playback
npm run perf:lyne-playback-latency -- --track <real-track.flac> --next-track <real-next-track.flac> --trials 1 --progress-timeout-ms 15000 --seek-timeout-ms 10000 --poll-ms 50 --sample-ms 250
npm run perf:lyne-playback-stability -- --track <real-track.flac> --duration-ms 3000 --warmup-ms 500 --sample-ms 1000
npm run perf:library-scan-evidence -- --base-url http://127.0.0.1:63893 --token <redacted> --root <fixture-library> --expected <fixture-expected.json>
npm run typecheck
npm test
cargo test player::callback --lib
cargo test processor:: --lib
cargo bench --bench audio_callback_chain_perf -- --quick
cargo bench --bench audio_callback_output_path_perf -- --quick
cargo bench --bench audio_resampler_streaming_perf -- --quick
cargo bench --bench playback_load_budget_perf -- --quick --enforce
F:\Python\python.exe .\.trellis\scripts\task.py validate 05-31-prove-lyne-core-playback-library-value
git diff --check
```

The script initially had a lifecycle race: it destroyed the last BrowserWindow
before writing the JSON file, allowing Electron to quit early and truncate
`baseline.json` to 0 bytes. The script now writes via a temporary file, renames it
into place, logs the results, and only then destroys the window.

## Default Electron Baseline Output

Default command parameters:

- Duration: 1.5 seconds
- Sample rate: 48000 Hz
- Channels: 2
- Warmup: 1
- Trials: 3

Scenario results from `baseline.json`:

| Scenario | Median render ms | Realtime factor | Output peak | Output RMS |
| --- | ---: | ---: | ---: | ---: |
| `pass_through_buffer_source` | 1.900 | 789.47x | 0.3495 | 0.1570 |
| `gain_biquad_controls` | 4.000 | 375.00x | 0.3321 | 0.1484 |
| `ten_band_eq_like_chain` | 19.700 | 76.14x | 0.3481 | 0.1551 |
| `compressor_analyser_tap` | 9.200 | 163.04x | 0.4763 | 0.2101 |

Feature matrix recorded by the fixture:

| Capability | Electron/WebAudio fixture |
| --- | --- |
| WebAudio playback graph | Yes |
| WebAudio filter controls | Yes |
| Analyser/visualizer tap | Yes |
| Dynamics compressor node | Yes |
| Output device selection | Browser mediated; `setSinkId` availability varies |
| Exclusive output mode | No |
| Explicit output bit depth | No |
| Native callback budget | No |
| Lock-free native DSP params | No |
| SoXR resampling | No |
| Native loudness/true-peak pipeline | No |
| Dither/noise-shaping policy | No |
| Persistent product control surface | No |

## Lyne-Side Evidence Collected

Current test evidence:

- `npm test`: 220 passed.
- `cargo test player::callback --lib`: 13 passed.
- `cargo test processor:: --lib`: 135 passed.

Current bench evidence:

- `cargo bench --bench audio_callback_chain_perf -- --quick` passed on formal
  retry.
- `cargo bench --bench audio_callback_output_path_perf -- --quick` passed on
  formal retry after the bench switched to the `bench_support` spectrum sender
  facade.
- `cargo bench --bench audio_resampler_streaming_perf -- --quick` passed on
  formal retry.
- `cargo bench --bench playback_load_budget_perf -- --quick --enforce` first
  reproduced a `panic=abort` dependency vs `panic=unwind` bench target mismatch,
  then passed with `--profile release`, with the ignored
  `profile.bench.panic='abort'` config probe, and finally with the original
  command.

Selected formal bench output:

| Scenario | Frames | Current ns/sample | Current ns/buffer | Speedup vs embedded original |
| --- | ---: | ---: | ---: | ---: |
| `bypass_default` | 128 | 0.585 | 149.800 | 2.09x |
| `bypass_default` | 512 | 0.206 | 211.200 | 5.28x |
| `active_dsp_no_convolver` | 64 | 34.295 | 4389.800 | 28.43x |
| `active_dsp_no_convolver` | 512 | 29.529 | 30238.000 | 32.57x |
| `active_dsp_with_convolver` | 64 | 105.172 | 13462.000 | 9.67x |
| `active_dsp_with_convolver` | 512 | 49.300 | 50482.800 | 20.05x |

Additional selected retry output:

| Bench | Scenario | Key result |
| --- | --- | --- |
| `audio_resampler_streaming_perf` | `music_44k1_to_48k`, borrowed, 512 frames | 11.580 ns/input sample; 893 output frames |
| `audio_resampler_streaming_perf` | `upsample_48k_to_96k`, into, 512 frames | 8.018 ns/input sample; 1660 output frames |
| `playback_load_budget_perf --enforce` | `normal_5m_48k_stereo` | 28,800,000 estimated samples; accepted 10,000 checks; 165.120 ns/check |
| `playback_load_budget_perf --enforce` | `oversized_track_guard` | 268,437,506 estimated samples; rejected 10,000 checks; 452.570 ns/check |

Cargo still emits duplicate output filename warnings for `audio_engine.dll`,
`audio_engine.dll.lib`, `audio_engine.dll.exp`, `audio_engine.pdb`, and
`libaudio_engine.rlib` because the library target builds both `cdylib` and
`rlib` artifacts with the same package/lib name. The warnings did not prevent the
bench retries from running, but they remain a build hygiene risk because Cargo
notes this may become a hard error in the future.

The `playback_load_budget_perf` panic-strategy failure did not reproduce after
Cargo rebuilt the relevant bench artifacts. Treat it as a transient mixed-profile
build-cache failure, not as evidence that the resource-budget code failed.

## Runtime Probe Addendum

After the formal bench retries, two isolated-server probes were added:

- Active playback control probe passed: `playback_mode=active_playback`, 9/9
  controls round-tripped through HTTP calls and `/state` readback.
- Fixture library scan probe passed: 1 generated WAV scanned, 1 indexed, 1 media
  item read back, expected `title=Lyne Evidence Tone` and `has_cover_art=true`
  both matched.

Details live in `research/runtime-probe-results.md`.

## Real-Time Playback Baseline Addendum

Date: 2026-06-01

New source:

- `apps/desktop/scripts/electron-realtime-playback-baseline.cjs`
- Command: `npm run perf:electron-realtime-playback`
- Output: `apps/desktop/output/electron-realtime-playback-baseline/realtime-playback-baseline.json`
- Baseline identity: `electron-realtime-webaudio-playback`

The realtime fixture tries to measure a plain hidden Electron/WebAudio
`AudioContext` playback graph:

- graph start to `currentTime` advancement;
- parameter update latency for EQ-like filters and gain;
- short wall-clock playback stability via `AudioContext.currentTime`;
- process-level CPU/RSS samples.

The script now runs through a Node supervisor process, which starts the Electron
worker and captures worker stdout/stderr. This matters because the local
Electron/Chromium runtime can terminate the worker before normal JS error
handling writes a report.

Initial sandbox smoke command:

```powershell
npm run perf:electron-realtime-playback -- --trials 1 --control-toggles 1 --stability-seconds 0.1 --sample-ms 500 --no-context-advance-wait --user-data-dir output/electron-realtime-playback-baseline/profile-supervisor
```

Result: blocked inside the Codex sandbox, but now structured.

- `app_ready`: passed.
- `window_created`: passed.
- `page_loaded`: failed while loading the minimal `data:` fixture page.
- Worker exit code: 1.
- With an isolated `--user-data-dir`, OS crypto/cache errors disappeared, but
  Chromium still emitted `GPU process exited unexpectedly: exit_code=-1073741515`.
- The report records the failing stage, Electron/Chrome versions, worker exit,
  and stderr tail.

Follow-up analysis showed this was a sandbox/runtime-permission blocker, not a
fixture logic failure. The same class of page-load failure can be reproduced by
running the already-passing offline Electron/WebAudio fixture through
`node node_modules/electron/cli.js` inside the sandbox, while the approved
`npm run perf:electron-webaudio` path succeeds. Running the realtime fixture
outside the sandbox with the same script succeeds.

Confirmed non-sandbox realtime command:

```powershell
npm run perf:electron-realtime-playback -- --trials 3 --control-toggles 10 --stability-seconds 2 --sample-ms 500 --user-data-dir output/electron-realtime-playback-baseline/profile-escalated-confirmed
```

Result:

| Measurement | Result |
| --- | ---: |
| Pass | true |
| Page load | 171.018 ms |
| Renderer probe | 6.107 ms |
| Realtime harness | 2600.097 ms |
| AudioContext start time advance | p50 27.5 ms, p95 27.5 ms, max 59.5 ms |
| WebAudio parameter update latency | p50 0 ms, p95 0.1 ms, max 0.1 ms |
| Stability samples | 8 |
| Suspended samples | 0 |
| Context delta | p50 258.667 ms, p95 269.333 ms |
| Base latency | 0.01 s |
| Peak working set | 104,108,032 bytes |
| Peak CPU | 0.23% of 16 logical cores |

Interpretation: the realtime Electron baseline now provides an A/B runtime
fixture for ordinary Electron/WebAudio behavior, with the important caveat that
it must be run outside the sandbox because Chromium renderer/GPU/cache access is
not reliable in the sandboxed Codex command environment.

## Real-File Playback Baseline Addendum

Date: 2026-06-01

New source:

- `apps/desktop/scripts/electron-real-file-playback-baseline.cjs`
- Command: `npm run perf:electron-real-file-playback`
- Output: `apps/desktop/output/electron-real-file-playback-baseline/real-file-playback-baseline.json`
- Baseline identity: `electron-real-file-playback`

This upgrades the Electron comparison from synthetic WebAudio only to a real
local-file playback fixture. It runs a hidden Electron `HTMLAudioElement` against
the same supplied FLAC paths used by the Lyne latency smoke, then optionally
wraps playback in a WebAudio graph with ten peaking filters, gain, compressor,
and analyser nodes.

Measured operations:

- local file load-to-progress;
- pause/play resume-to-progress;
- seek convergence at 25%, 50%, and 75%;
- optional next-track switch-to-progress;
- WebAudio control updates during active playback;
- short stability sampling from `currentTime`, ready state, and media errors;
- coarse CPU/RSS metrics for the Electron main worker and a Node/Electron
  process-tree aggregate.

Smoke command against the supplied real local library:

```powershell
npm run perf:electron-real-file-playback -- --track "D:\移动云盘挂载\15869685321\Music\Aimer - Through My Blood AM.flac" --next-track "D:\移动云盘挂载\15869685321\Music\Aimer - Sign.flac" --trials 1 --stability-seconds 3 --control-toggles 10 --sample-ms 500 --user-data-dir output/electron-real-file-playback-baseline/profile-smoke-final
```

Result:

| Measurement | Smoke result |
| --- | ---: |
| Pass | true |
| Chromium FLAC support | `probably` |
| Page load | 198.438 ms |
| Real-file harness | 4980.299 ms |
| Load to progress | 34.6 ms |
| Play resume to progress | 25.8 ms |
| Seek convergence | p50 26.4 ms, max 26.7 ms |
| Next-track to progress | 402.3 ms |
| WebAudio parameter update latency | p95 0.1 ms |
| Stability samples | 12 |
| Paused samples | 0 |
| Media error samples | 0 |
| Main-process peak working set | 112,386,048 bytes |
| Main-process peak CPU | 0.673% of 16 logical cores |
| Node/Electron process-tree peak working set | 432,037,888 bytes |
| Node/Electron process-tree peak CPU | 0.947% of 16 logical cores |
| Peak Node/Electron process count | 6 |

Interpretation: Electron is now represented by a same-operation, real-file smoke
fixture rather than only by synthetic WebAudio. On this local machine, Chromium
can decode the two FLAC files and the minimal Electron path is very fast for
HTMLMediaElement progress/seek/next operations. This is useful as a baseline, but
it does not erase Lyne's native audio-engine differentiators: the fixture still
lacks exclusive output, explicit output bit depth, native callback budgeting,
lock-free native DSP parameter delivery, SoXR resampling, native loudness/true
peak, and dither/noise-shaping policy.

## Lyne Playback Latency And Stability Addendum

Date: 2026-06-01

New sources:

- `apps/desktop/scripts/perf-utils.cjs`
- `apps/desktop/scripts/lyne-playback-latency-benchmark.cjs`
- `apps/desktop/scripts/lyne-playback-stability-benchmark.cjs`

Both scripts start an isolated `target/release/audio_server.exe` with temporary
runtime directories and write JSON under ignored `apps/desktop/output/`.

Latency smoke command against the supplied real local library:

```powershell
npm run perf:lyne-playback-latency -- --track "D:\移动云盘挂载\15869685321\Music\Aimer - Through My Blood AM.flac" --next-track "D:\移动云盘挂载\15869685321\Music\Aimer - Sign.flac" --trials 1 --progress-timeout-ms 15000 --seek-timeout-ms 10000 --poll-ms 50 --sample-ms 250
```

Result:

| Measurement | Smoke result |
| --- | ---: |
| Pass | true |
| Load to progress | 2532.902 ms |
| Play resume to progress | 370.677 ms |
| Seek convergence | p50 1.704 ms, max 1.918 ms |
| Queue next-track to progress | 1643.251 ms |
| Underrun delta | 0 |
| Underrun silence frames delta | 0 |

Stability smoke command:

```powershell
npm run perf:lyne-playback-stability -- --track "D:\移动云盘挂载\15869685321\Music\Aimer - Through My Blood AM.flac" --duration-ms 3000 --warmup-ms 500 --sample-ms 1000
```

Result:

| Measurement | Smoke result |
| --- | ---: |
| Pass | true |
| Diagnostics samples | 3 |
| Underrun delta | 0 |
| Underrun silence frames delta | 0 |
| Load error delta | 0 |
| Playback false samples | 0 |
| Peak working set | 228,237,312 bytes |
| Peak CPU | 6.544% of 16 logical cores |

These are smoke-sized runs, not release-grade proof. They validate the new
benchmark surfaces and show that Lyne can script playback load/progress, seek
convergence, next-track switching, DSP-on stability, underrun counters, and
coarse process metrics. Release-grade evidence should run the same scripts with
more trials and a 30-60 minute stability window.

## Limits

- `OfflineAudioContext` measures render cost for a WebAudio graph, not device
  latency, WASAPI behavior, or perceptual audio quality.
- The Electron fixture is a minimal ordinary baseline, not a tuned production
  Electron music player.
- The Lyne side now has an HTTP active-playback control probe, but still needs a
  UI-driven and packaged-release proof.
- The current bench suite covers the selected native paths, but it still does not
  prove device latency, OS mixer behavior, subjective quality, or long-session
  stability.
- The realtime Electron/WebAudio baseline is implemented and passes outside the
  sandbox, but Electron/Chromium page-load/GPU-process failures are reproducible
  inside the sandboxed Codex command environment.

# Runtime Probe Results

Date: 2026-05-31

## Commands

Both runtime probes were run against an isolated `target/release/audio_server.exe`
process, with a temporary bearer token and runtime data under `.tmp-lyne-evidence/`.
The server had to be started, probed, and shut down in one PowerShell command so
the sandbox did not reclaim the background process between commands.

Control probe:

```powershell
npm run perf:lyne-control-probe -- --base-url http://127.0.0.1:63892 --token <redacted> --track "D:\AI\AudioPlayer\.tmp-lyne-evidence\fixture-library\Evidence Artist\Evidence Album\Lyne Evidence Tone.wav" --require-playback
```

Library scan probe:

```powershell
npm run perf:library-scan-evidence -- --base-url http://127.0.0.1:63893 --token <redacted> --root "D:\AI\AudioPlayer\.tmp-lyne-evidence\fixture-library" --expected "D:\AI\AudioPlayer\.tmp-lyne-evidence\fixture-expected.json"
```

Generated outputs:

- `apps/desktop/output/lyne-evidence/active-playback-control-probe.json`
- `apps/desktop/output/lyne-evidence/library-scan-evidence.json`

`apps/desktop/output/` is ignored and should not be committed.

## Active Playback Control Probe

Result: passed.

The probe loaded a 31 second WAV fixture with `autoplay=true`, observed
`playback_mode=active_playback`, and then toggled nine user-visible audio controls.
All nine steps returned success and were reflected in `/state`:

| Step | Readback evidence |
| --- | --- |
| EQ call | `eq_type=IIR` |
| Crossfeed | `crossfeed_enabled=true`, `crossfeed_mix=0.35` |
| Saturation | `saturation_enabled=true`, `saturation_drive=0.42`, `saturation_mix=0.27` |
| Dynamic loudness | `dynamic_loudness_enabled=true`, `dynamic_loudness_strength=0.66` |
| Dither / noise shaping enable | `dither_enabled=true` |
| Noise shaper curve | `noise_shaper_curve=FWeighted9` |
| Output bit depth | `output_bits=24` |
| Resampling | `resample_quality=uhq`, `use_cache=true`, `preemptive_resample=true` |
| Loudness normalization | `loudness_enabled=true`, `loudness_mode=track`, `target_lufs=-14`, `preamp_db=-1.5` |

Important limits:

- This proves HTTP control calls and player-state reflection during active playback.
- It does not prove analog output quality, subjective sound quality, or underrun-free
  behavior across a long real listening session.
- `/state` does not expose per-band EQ gains, so the probe can verify that `/set_eq`
  accepted the call and retained `eq_type=IIR`, but not each band value.

## Fixture Library Scan Probe

Result: passed for the deterministic fixture.

The fixture library contains one generated WAV file:

- 31 seconds
- 48 kHz
- 16-bit
- stereo
- sidecar `cover.png`

The scan result reported:

| Metric | Value |
| --- | ---: |
| Supported input files | 1 |
| Scan start latency | 41.775 ms |
| End-to-end scan elapsed | 47.030 ms |
| Task elapsed | 3.608 ms |
| Scanned files | 1 |
| Indexed files | 1 |
| Removed files | 0 |
| Media items found by API readback | 1 |
| Expected tracks found | 1 / 1 |
| Expected tracks passed | 1 / 1 |

Expected fields passed:

- `title = Lyne Evidence Tone`
- `has_cover_art = true`

Important limits:

- This is a deterministic fixture, not a real user music library.
- It proves the running local scan path, DB persistence, Windows extended-path
  readback, sidecar cover detection, and manifest scoring for one simple WAV.
- It does not prove malformed tags, large libraries, WebDAV, lyrics, embedded
  cover precedence, or memory behavior.

## Implementation Note

The first scan run exposed a script bug rather than a backend failure: the server
stored local paths using Windows extended syntax (`\\?\D:\...`), while the probe
filtered `/domain/media_items` with ordinary absolute paths. The probe now strips
Windows extended prefixes before root matching and expected-manifest scoring.

## Real-Library Follow-Up

On 2026-06-01 the runtime probe family was extended with:

- `npm run perf:real-library-benchmark`
- `npm run perf:splayer-library-benchmark`

The detailed result is recorded in `research/real-library-scan-results.md`. In
short, Lyne scanned the supplied 594-file / 23.14 GB real library successfully
and indexed 593 tracks, skipping only one zero-byte FLAC. After the hot-path fix
and rerun, Lyne's default 2-worker scan completed faster and lighter than the
runnable SPlayer native scanner baseline, while indexing more tracks.

## Playback Latency And DSP Stability Follow-Up

On 2026-06-01 the runtime probe family was extended again with:

- `npm run perf:lyne-playback-latency`
- `npm run perf:lyne-playback-stability`
- `npm run perf:electron-realtime-playback`
- `npm run perf:electron-real-file-playback`

The Lyne scripts use isolated `audio_server.exe` processes and real local FLAC
files from the supplied library. They write generated JSON under:

- `apps/desktop/output/lyne-evidence/playback-latency/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/playback-stability/playback-stability-benchmark.json`
- `apps/desktop/output/electron-realtime-playback-baseline/realtime-playback-baseline.json`
- `apps/desktop/output/electron-real-file-playback-baseline/real-file-playback-baseline.json`

Smoke results:

| Probe | Result |
| --- | --- |
| Lyne playback latency | Passed. Load-to-progress 2532.902 ms, play-resume-to-progress 370.677 ms, seek convergence p50 1.704 ms / max 1.918 ms, queue next-track-to-progress 1643.251 ms, underrun delta 0. |
| Lyne DSP-on playback stability | Passed for a 3 s smoke. 3 diagnostics samples, underrun delta 0, silent frames delta 0, load error delta 0, playback false samples 0, peak working set 228,237,312 bytes, peak CPU 6.544% of 16 logical cores. |
| Electron realtime WebAudio baseline | Initially blocked inside the Codex sandbox before `AudioContext`: app ready and BrowserWindow creation pass, but the minimal `data:` fixture page load failed with `ERR_FAILED (-2)` while Chromium logged GPU process exits. The script now records this as structured JSON through a Node supervisor. Running the same command outside the sandbox passed with AudioContext start p50 27.5 ms, control update p95 0.1 ms, 8 stability samples, and 0 suspended samples. |
| Electron real-file playback baseline | Passed outside the sandbox on the same two real FLAC files. Chromium reported FLAC `canPlayType=probably`; load-to-progress 34.6 ms, play-resume-to-progress 25.8 ms, seek convergence p50 26.4 ms / max 26.7 ms, next-track-to-progress 402.3 ms, WebAudio control update p95 0.1 ms, 12 stability samples, 0 paused samples, 0 media errors, main-process peak RSS 112,386,048 bytes / peak CPU 0.673%, Node/Electron process-tree peak RSS 432,037,888 bytes / peak CPU 0.947%. |

These probes improve the scriptable evidence for playback behavior, but they do
not replace subjective listening tests or packaged desktop UI runs. The Lyne
latency and stability numbers above are smoke validation; final proof should use
more trials plus a 30-60 minute stability run.

The real-file Electron baseline closes the earlier "not the same operation" gap
for scripted load/play/seek/next/stability probes. It does not prove ordinary
Electron is equivalent to Lyne's audio engine because its feature matrix still
lacks native output-bit control, native callback budgets, lock-free DSP parameter
delivery, SoXR resampling, native loudness/true-peak, and dither/noise-shaping
policy.

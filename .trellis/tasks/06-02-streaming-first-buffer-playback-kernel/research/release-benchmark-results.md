# Release Benchmark Results

Date: 2026-06-02

Scope: Stage 1 streaming-first-buffer MVP for local-file autoplay, guarded by
`AUDIO_STREAMING_FIRST_BUFFER=true`.

## Test File

- `D:\移动云盘挂载\15869685321\Music\2A,‘N - Home.mp3`
- Format observed by diagnostics: 44.1 kHz, 2 channels
- Duration: about 367 seconds

## Benchmark Command Shape

Both benchmark runs used the release `audio_server.exe`, three trials, 10 ms
state polling, and `AUDIO_PREEMPTIVE_RESAMPLE=false` to compare against the
fastest full-buffer path rather than the slower preemptive-resample path.

Baseline:

```powershell
$env:AUDIO_STREAMING_FIRST_BUFFER='false'
$env:AUDIO_PREEMPTIVE_RESAMPLE='false'
node .\scripts\lyne-playback-latency-benchmark.cjs --track <track> --trials 3 --poll-ms 10 --port 63916 --output-dir output\lyne-evidence\streaming-first-buffer-44k-disabled-v2
```

Streaming:

```powershell
$env:AUDIO_STREAMING_FIRST_BUFFER='true'
$env:AUDIO_PREEMPTIVE_RESAMPLE='false'
node .\scripts\lyne-playback-latency-benchmark.cjs --track <track> --trials 3 --poll-ms 10 --port 63917 --output-dir output\lyne-evidence\streaming-first-buffer-44k-enabled-v2
```

Persisted reports:

- `apps/desktop/output/lyne-evidence/streaming-first-buffer-44k-disabled-v2/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/streaming-first-buffer-44k-enabled-v2/playback-latency-benchmark.json`

## Results

| Mode | load-to-progress p50 | p95 | max | underruns |
| --- | ---: | ---: | ---: | ---: |
| Full-buffer baseline | 816.252 ms | 816.252 ms | 1095.027 ms | 0 |
| Streaming first-buffer | 30.083 ms | 30.083 ms | 35.701 ms | 0 |

Other checks from the same reports:

- Resume p50: baseline 13.936 ms, streaming 13.386 ms.
- Seek convergence p50: baseline 1.815 ms, streaming 1.256 ms. The seek
  metric is a state convergence proxy; perfect active-streaming seek is outside
  this MVP.
- Streaming process sample peak CPU percent was 6.24% in this short run, versus
  12.385% for the full-buffer baseline. These are coarse Windows `Get-Process`
  samples, not profiler data.

## Full Decode Completion Probe

The first streaming benchmark snapshot was taken before the latest load had
finished decoding, so a single-load diagnostics probe was run after changing the
producer queue policy to avoid blocking full decode on a full playback queue.

Probe result:

- `request_returned_to_streaming_ready_ms`: 15 ms
- `request_started_to_first_position_advanced_ms`: 40 ms
- `decode_ms`: 436 ms
- `streaming_ready_to_decode_finished_ms`: 421 ms
- Probe elapsed until `streaming_finished`: 488.144 ms
- Final playback diagnostics: `streaming_active=false`,
  `streaming_decode_finished=true`, `streaming_queue_len=0`,
  `underrun_count=0`, `underrun_silence_frames=0`

This confirms the MVP now starts playback from the initial chunk queue and then
publishes the full decoded buffer shortly after, instead of pacing full decode
by playback speed.

## Interpretation

The Stage 1 path proves the cold local-file autoplay bottleneck can be moved
from full-track decode time to first-buffer readiness. On the tested 44.1 kHz
MP3, the user-visible load-to-progress median dropped from 816.252 ms to
30.083 ms while keeping underruns at zero.

Remaining limitations:

- The feature is still guarded by `AUDIO_STREAMING_FIRST_BUFFER=true`; default
  behavior remains the full-buffer path.
- Network/WebDAV streaming, active streaming seek semantics, and gapless
  pipeline unification remain out of scope for this stage.
- The benchmark uses `/state` progress as a playback proxy, not analog output
  capture.

## Stage 2 Memory-Bounded Streaming Probe

Stage 2 adds `AUDIO_STREAMING_FULL_BUFFER_LIMIT_MIB` so large decoded outputs
can stay in sequential streaming mode instead of publishing a full decoded
`Vec<f64>` after first-buffer playback starts. The default limit is 256 MiB;
`0` forces memory-only streaming for all streaming-first-buffer loads.

Large-file command:

```powershell
$env:AUDIO_STREAMING_FIRST_BUFFER='true'
$env:AUDIO_PREEMPTIVE_RESAMPLE='false'
Remove-Item Env:AUDIO_STREAMING_FULL_BUFFER_LIMIT_MIB -ErrorAction SilentlyContinue
node .\scripts\lyne-playback-latency-benchmark.cjs --track 'D:\移动云盘挂载\15869685321\Music\Aimer - Through My Blood AM.flac' --trials 3 --poll-ms 10 --sample-ms 50 --skip-seek --port 63920 --output-dir output\lyne-evidence\streaming-memory-mode-flac-default-limit-v2
```

Small-file command:

```powershell
$env:AUDIO_STREAMING_FIRST_BUFFER='true'
$env:AUDIO_PREEMPTIVE_RESAMPLE='false'
Remove-Item Env:AUDIO_STREAMING_FULL_BUFFER_LIMIT_MIB -ErrorAction SilentlyContinue
node .\scripts\lyne-playback-latency-benchmark.cjs --track 'D:\移动云盘挂载\15869685321\Music\熊太kuma - カタオモイ（Cover aimer）.mp3' --trials 3 --poll-ms 10 --port 63921 --output-dir output\lyne-evidence\streaming-memory-mode-mp3-small-full-buffer-v1
```

Persisted reports:

- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-default-limit-v2/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/streaming-memory-mode-mp3-small-full-buffer-v1/playback-latency-benchmark.json`
- Comparison baseline from Stage 1 full-buffer publication:
  `apps/desktop/output/lyne-evidence/streaming-first-buffer-electron-track-enabled-v1/playback-latency-benchmark.json`

| Scenario | load-to-progress p50 | resume p50 | seek | underruns | streaming_memory_mode | full buffer published | peak working set |
| --- | ---: | ---: | --- | ---: | --- | --- | ---: |
| Large FLAC, Stage 2 memory mode | 65.815 ms | 43.953 ms | skipped by design | 0 | true | false | 50.291 MiB reported peak |
| Small MP3, Stage 2 full-buffer mode | 40.88 ms | 26.181 ms | p50 1.932 ms | 0 | false | true | 183.366 MiB reported peak |
| Same large FLAC, Stage 1 full-buffer publication | 49.818 ms | 29.15 ms | p50 1.238 ms | 0 | unavailable in older report | published by Stage 1 design | 1,139.663 MiB reported peak |

Diagnostics from the large FLAC Stage 2 report:

- `streaming_memory_mode=true`
- `streaming_full_buffer_published=false`
- `streaming_active=true` after the benchmark snapshot
- `streaming_decode_finished=false` after the benchmark snapshot
- `streaming_queue_len=128`
- `underrun_count=0`
- `underrun_silence_frames=0`

Diagnostics from the small MP3 Stage 2 report:

- `streaming_memory_mode=false`
- `streaming_full_buffer_published=true`
- `streaming_active=false`
- `streaming_decode_finished=true`
- `streaming_queue_len=0`
- `underrun_count=0`
- `underrun_silence_frames=0`

Interpretation:

Stage 2 keeps the fast first-buffer user-visible behavior while avoiding the
large decoded PCM publication that previously pushed the same large FLAC run to
about 1.14 GiB reported peak working set. The measured large-file memory-mode
load p50 is slightly slower than the Stage 1 full-buffer publication probe, but
still within the sub-100 ms range and with zero underruns. The tradeoff is
explicit: active memory-mode seek is rejected until decoder-seek replay exists,
while small files keep the full-buffer path and continue to pass seek
convergence.

## Stage 2 Seek Stress and Recovery Watchdog

Follow-up stress testing used the same large FLAC with active seek enabled:

- `D:\移动云盘挂载\15869685321\Music\Aimer - Through My Blood AM.flac`
- `AUDIO_STREAMING_FIRST_BUFFER=true`
- `AUDIO_PREEMPTIVE_RESAMPLE=false`
- Default `AUDIO_STREAMING_FULL_BUFFER_LIMIT_MIB`
- Release `target/release/audio_server.exe`
- 10 ms state polling, 50 ms process sampling

Final passing command shape:

```powershell
$env:AUDIO_STREAMING_FIRST_BUFFER='true'
$env:AUDIO_PREEMPTIVE_RESAMPLE='false'
Remove-Item Env:AUDIO_STREAMING_FULL_BUFFER_LIMIT_MIB -ErrorAction SilentlyContinue
node .\scripts\lyne-playback-latency-benchmark.cjs --track 'D:\移动云盘挂载\15869685321\Music\Aimer - Through My Blood AM.flac' --trials 50 --poll-ms 10 --sample-ms 50 --port 63943 --output-dir output\lyne-evidence\streaming-memory-mode-flac-seek-stress-v22
```

Persisted reports:

- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v18/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v19/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v20/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v21/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v22/playback-latency-benchmark.json`

| Run | Trials | Measurements | Result | load-to-progress p50 / p95 / max | resume p50 / p95 / max | seek p50 / p95 / max | Underrun delta | Recovery count | Parked streams | Peak reported working set |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v18 | 20 | 100 | pass | 1.958 / 44.616 / 183.328 ms | 28.881 / 43.872 / 44.655 ms | 26.445 / 41.855 / 56.453 ms | 0 | 4 | not yet reported | 54.996 MiB |
| v19 | 50 | 250 | pass | 22.18 / 189.623 / 244.66 ms | 28.135 / 42.249 / 42.991 ms | 28.573 / 74.746 / 108.499 ms | 1 / 40 frames | 9 | not yet reported | 68.609 MiB |
| v20 | 50 | 250 | pass | 1.53 / 167.199 / 237.22 ms | 28.747 / 43.476 / 44.405 ms | 26.874 / 43.706 / 76.562 ms | 0 | 11 | 11 | 66.422 MiB |
| v21 | failed at trial 8 | 37 | fail | timed out during seek after an aggressive parked-stream cleanup experiment | - | - | not final | not final | not final | not final |
| v22 | 50 | 250 | pass | 1.347 / 26.255 / 271.191 ms | 29.322 / 45.303 / 46.422 ms | 26.863 / 29.306 / 57.821 ms | 0 | 8 | 8 | 62.383 MiB |

Recovery watchdog result:

- The earlier v15-v17 failure mode was a seek/load progress timeout after
  `StreamingLoadReady`, with no callback/progress and a stuck rebuild path.
- Parking the old CPAL stream during recovery, instead of synchronously dropping
  it in the command thread before rebuilding, removed the timeout in repeated
  real-file stress runs.
- The final v22 run completed 50 load/resume/seek trials and 150 seek
  convergences with zero underruns. Command counters remained balanced:
  `audio_command_received_count=501`,
  `audio_command_completed_count=501`.

Resource boundary result:

- Recovery can still occur under stress (`playback_recovery_count=8` in v22).
  Because `cpal::Stream` is not sent to a background drop thread, recovered
  streams are parked inside the audio thread.
- An attempted optimization that released parked streams while playback was
  active caused v21 to fail with a seek convergence timeout. This is a concrete
  boundary: CPAL stream drop/pause must not run in the active playback command
  window.
- The stable policy is therefore conservative: park during recovery; release
  parked streams only once playback is not active or when the audio thread
  exits; expose `parked_output_stream_count` and
  `parked_output_stream_release_count` through runtime diagnostics.

Remaining limitation:

- The watchdog is now stable, but recovery still indicates that the normal warm
  stream path sometimes misses the first callback within the current watchdog
  window. Future work should reduce false recovery triggers rather than release
  CPAL streams during active playback.

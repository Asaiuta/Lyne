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

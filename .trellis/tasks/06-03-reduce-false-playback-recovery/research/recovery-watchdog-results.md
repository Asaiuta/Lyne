# Recovery Watchdog Results

Date: 2026-06-03

## Summary

This task reduced false recovery triggers in the streaming first-buffer playback
path, but did not eliminate all recovery events.

Two false-trigger classes were fixed:

- `StreamingLoadReady` no longer depends on the current `PlayerState::Playing`
  value to preserve the load-time autoplay intent. `StopForLoad` can temporarily
  set the state to `Stopped`, so the command now carries `autoplay: bool`.
- The streaming progress watchdog no longer sends `EnsurePlaybackProgress`
  immediately after a fixed ready delay. It now observes generation/progress
  state and waits until `stream_play_returned_ms` exists and the
  post-play callback grace window has elapsed.

The remaining recovery count in release stress is still 8, matching the prior
stable v22 baseline. These remaining events happen after `stream.play()` has
returned and no first callback/progress is observed inside the grace window, so
they should not be classified as the same early false triggers fixed here.

## Commands

Focused verification:

```powershell
cargo test player::command_handlers --lib
cargo test player::loading --lib
cargo test player::state --lib
cargo test player::callback --lib
cargo check --bin audio_server
cargo test --lib
```

Release benchmark smoke:

```powershell
$env:AUDIO_STREAMING_FIRST_BUFFER='true'
$env:AUDIO_PREEMPTIVE_RESAMPLE='false'
Remove-Item Env:AUDIO_STREAMING_FULL_BUFFER_LIMIT_MIB -ErrorAction SilentlyContinue
node .\scripts\lyne-playback-latency-benchmark.cjs --track 'D:\移动云盘挂载\15869685321\Music\Aimer - Through My Blood AM.flac' --trials 1 --poll-ms 10 --sample-ms 50 --skip-seek --port 63947 --output-dir output\lyne-evidence\streaming-memory-mode-flac-autoplay-smoke-v25
```

Release stress:

```powershell
$env:AUDIO_STREAMING_FIRST_BUFFER='true'
$env:AUDIO_PREEMPTIVE_RESAMPLE='false'
Remove-Item Env:AUDIO_STREAMING_FULL_BUFFER_LIMIT_MIB -ErrorAction SilentlyContinue
node .\scripts\lyne-playback-latency-benchmark.cjs --track 'D:\移动云盘挂载\15869685321\Music\Aimer - Through My Blood AM.flac' --trials 50 --poll-ms 10 --sample-ms 50 --port 63948 --output-dir output\lyne-evidence\streaming-memory-mode-flac-seek-stress-v25
```

## Results

Persisted reports:

- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-autoplay-smoke-v25/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v25/playback-latency-benchmark.json`
- Prior comparison: `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v22/playback-latency-benchmark.json`
- Failed intermediate run: `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v23/playback-latency-benchmark.json`
- Intermediate stress after autoplay repair: `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v24/playback-latency-benchmark.json`

| Run | Measurements | Result | load-to-progress p50 / p95 / max | resume p50 / p95 / max | seek p50 / p95 / max | Underrun delta | Recovery count | Parked streams | Audio commands received/completed | Peak reported working set |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v22 prior stable baseline | 250 | pass | 1.347 / 26.255 / 271.191 ms | 29.322 / 45.303 / 46.422 ms | 26.863 / 29.306 / 57.821 ms | 0 | 8 | 8 | 501 / 501 | 62.383 MiB |
| v24 after autoplay repair | 250 | pass | 1.585 / 353.986 / 395.716 ms | 29.759 / 44.063 / 46.593 ms | 27.153 / 44.537 / 75.915 ms | 0 | 11 | 11 | 500 / 500 | 63.996 MiB |
| v25 two-stage watchdog | 250 | pass | 1.437 / 22.724 / 570.552 ms | 29.590 / 44.723 / 45.746 ms | 26.300 / 29.204 / 46.059 ms | 0 | 8 | 8 | 310 / 310 | 63.957 MiB |

Smoke result:

- v25 autoplay smoke passed with 2 measurements.
- load-to-progress p50/max: 2.090 ms.
- play-resume-to-progress p50/max: 28.867 ms.
- recovery count: 0 in the smoke report.

## Interpretation

The original suspected false trigger was real: removing the duplicate trailing
`AudioCommand::Play` alone caused the v23 release benchmark to fail during
initial autoplay warmup. The failure state showed `StreamingLoadReady` had been
applied, `streaming_ready_play_skipped` was set, no `stream_play_returned` was
recorded, and playback never advanced. This proved that `StopForLoad` can erase
the current-state signal while the load still has an autoplay intent.

The final implementation keeps autoplay intent in the `StreamingLoadReady`
command and respects an explicit paused state. That fixes initial autoplay
without restoring the duplicate `Play` command that could reset
`stream_play_returned_ms`, `first_callback_after_play_ms`, and
`first_position_advanced_ms`.

The two-stage watchdog reduced unnecessary command traffic: v25 received and
completed 310 audio commands versus 501 in v22, while completing the same 250
measurements with zero underruns. Recovery count did not fall below v22, so the
remaining events should be investigated as warm-stream callback stalls or CPAL
reuse/start behavior rather than the early false-trigger class addressed here.

## Follow-Up

Further recovery reduction should profile why a warm shared CPAL stream can have
`stream.play()` return but still miss first callback/progress beyond the grace
window. Likely next evidence points:

- active output stream key and running state per recovered generation,
- whether the callback closure is still invoked but outputs silence due to a
format/key mismatch,
- CPAL stream build/reuse path timing for recovered generations,
- device-level behavior under repeated load/resume/seek stress.

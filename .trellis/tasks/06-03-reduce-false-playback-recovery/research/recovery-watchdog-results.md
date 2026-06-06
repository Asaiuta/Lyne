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

## Continued Evidence: Operation-Level Recovery Deltas

After the initial v25 result, the benchmark was extended to capture playback
counter snapshots before and after each measured operation. This makes recovery
attribution explicit for `load_to_progress`, `play_resume_to_progress`, and
`seek_convergence` instead of relying only on the final global counter.

New per-operation fields:

- `playback_diagnostics_delta.playback_recovery_count`
- `playback_diagnostics_delta.parked_output_stream_count`
- `playback_diagnostics_delta.output_callback_activity_count`
- `playback_diagnostics_delta.output_callback_silenced_loading_count`
- `playback_diagnostics_delta.output_callback_silenced_stream_mismatch_count`

Additional watchdog guard:

- `output_callback_after_play_ms` is now treated as current-generation output
  callback heartbeat.
- It does not mark playback progress and does not satisfy the user-visible
  progress condition.
- It does suppress output-stream recovery, because an observed callback means
  the CPAL output stream is alive and any no-progress condition belongs to
  buffering/state/progress diagnostics instead of stream rebuild.

### Later Stress Runs

Same command shape:

```powershell
$env:AUDIO_STREAMING_FIRST_BUFFER='true'
$env:AUDIO_PREEMPTIVE_RESAMPLE='false'
Remove-Item Env:AUDIO_STREAMING_FULL_BUFFER_LIMIT_MIB -ErrorAction SilentlyContinue
node .\apps\desktop\scripts\lyne-playback-latency-benchmark.cjs --track 'D:\移动云盘挂载\15869685321\Music\Aimer - Through My Blood AM.flac' --trials 50 --poll-ms 10 --sample-ms 50 --port <port> --output-dir output\lyne-evidence\<run>
```

Persisted reports:

- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v35/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v36/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v37/playback-latency-benchmark.json`

| Run | Measurements | Result | load-to-progress p50 / p95 / max | resume p50 / p95 / max | seek p50 / p95 / max | Underrun delta | Recovery count | Recovery attribution |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |
| v35 operation-delta evidence | 250 | pass | 14.023 / 73.188 / 827.235 ms | 30.730 / 40.858 / 53.188 ms | 25.925 / 67.726 / 142.558 ms | 1 | 9 | load 3, resume 0, seek 6 |
| v36 heartbeat guard, noisy run | 250 | pass | 36.089 / 700.089 / 883.111 ms | 31.268 / 39.839 / 45.646 ms | 28.192 / 94.682 / 148.918 ms | 0 | 16 | load 4, resume 0, seek 12 |
| v37 heartbeat guard, confirmation | 250 | pass | 25.175 / 67.322 / 783.885 ms | 34.515 / 42.048 / 46.598 ms | 28.149 / 60.863 / 89.680 ms | 0 | 12 | load 3, resume 0, seek 9 |

### Interpretation

The operation-level evidence closes the missing-attribution gap:

- Resume is not contributing to recovery in these runs.
- Remaining recovery is split between streaming load and memory-mode streaming
  seek.
- `output_callback_silenced_stream_mismatch_count` stayed at 0 in v35-v37, so
  the remaining recoveries are not active stream key/format mismatch.
- Recovery rows show `streaming_ready_to_first_position_advanced_ms` around
  700-805 ms, then `stream_play_to_output_callback_ms` usually in the low
  milliseconds after rebuild. This means the warm reused stream did not produce
  callback heartbeat before recovery, and the rebuilt stream did.

The heartbeat guard did not materially lower v36/v37 counts because the current
remaining events had no pre-recovery heartbeat to suppress. It still removes a
real false-positive class: future cases where callbacks are alive but progress
is delayed by buffering/state gates will no longer rebuild CPAL output streams.

The remaining improvement path is no longer "clear false recovery" in the
watchdog logic. It is either:

- reduce warm-stream callback stalls themselves,
- avoid warm reuse for operations where heartbeat health is unknown or recently
  bad,
- or shorten the confirmed-stall rebuild path so real stalls recover faster.

## Tail-Latency Recovery Tightening

The next change targeted the last item above: shorten confirmed recovery stalls
instead of trying to classify them as false triggers.

Implementation:

- Lowered `PLAYBACK_PROGRESS_AFTER_PLAY_GRACE_MS` from 500 ms to 300 ms.
- If `EnsurePlaybackProgress { replay_attempted: false }` fires while the
  active stream is already marked running, the command handler now skips the
  replay step and rebuilds immediately.
- If the active stream is not marked running, the existing replay-first path is
  preserved.

Rationale:

- v35-v37 recovery rows had no pre-recovery output callback heartbeat.
- They recovered within a few milliseconds after rebuilding the stream.
- Replaying an already-running stream is effectively a no-op for this failure
  class and only adds another waiting window.

Persisted reports:

- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v38/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v39/playback-latency-benchmark.json`

| Run | Measurements | Result | load-to-progress p50 / p95 / max | resume p50 / p95 / max | seek p50 / p95 / max | Underrun delta | Recovery count | Recovery attribution |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |
| v38 direct rebuild on running stall | 250 | pass | 1.678 / 28.134 / 339.149 ms | 28.122 / 38.060 / 43.916 ms | 22.708 / 38.791 / 74.795 ms | 0 | 8 | load 1, resume 0, seek 7 |
| v39 direct rebuild confirmation | 250 | pass | 2.313 / 345.123 / 368.995 ms | 32.109 / 39.405 / 46.377 ms | 25.574 / 68.379 / 83.011 ms | 0 | 10 | load 4, resume 0, seek 6 |
| v40 RT-safety fixes rerun | 250 | pass | 1.464 / 2.505 / 39.158 ms | 31.644 / 47.168 / 50.103 ms | 19.033 / 28.279 / 48.177 ms | 6 | 0 | none |
| v41 RT-safety fixes confirmation | 250 | pass | 1.309 / 2.104 / 22.059 ms | 32.354 / 48.643 / 51.236 ms | 19.232 / 28.168 / 31.256 ms | 7 | 0 | none |

### Interpretation

This did not try to eliminate recovery. It shortened the confirmed-stall tail:

- Prior recovery rows were typically around 700-805 ms from streaming ready to
  first position advanced.
- v38 recovery rows were around 342-388 ms.
- v39 recovery rows were mostly around 342-370 ms, with two seek rows around
  438-441 ms when stream rebuild/callback timing was slower.
- Resume stayed at 0 recovery events.
- `output_callback_silenced_stream_mismatch_count` stayed at 0, so this still
  is not a stream-key mismatch class.
- Underrun stayed at 0 in both v38 and v39.

The remaining ceiling is mostly the 300 ms watchdog delay/grace plus stream
rebuild time. Lowering that further would require reducing
`STREAMING_PROGRESS_WATCHDOG_DELAY` and/or the 300 ms grace, which may increase
the risk of rebuilding during merely slow device callback startup. That should
be treated as a separate tuning experiment with multiple repeated runs.

## RT-Safety Fix Reruns

After the audio callback hang and realtime allocation fixes, reran the same
50-trial streaming memory-mode FLAC seek stress benchmark:

- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v40/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v41/playback-latency-benchmark.json`

Observed effect:

- Recovery cleared in both runs: `playback_recovery_count = 0`.
- Load tail improved materially versus v39: p95 dropped from 345.123 ms to
  2.505 ms / 2.104 ms.
- Seek p95 also tightened: 68.379 ms to 28.279 ms / 28.168 ms.
- Resume stayed in the same broad range, with p95 around 47-49 ms.
- A new small underrun signal appeared: v40 final underrun count 6
  (1240 silence frames), v41 final underrun count 7 (1670 silence frames).
  Operation-level deltas attribute the visible underruns to seek convergence
  rows, not load or resume.
- `output_callback_silenced_stream_mismatch_count` remained 0, so the result is
  still not a stream-key mismatch class.

Interpretation:

The RT-safety fixes appear to remove the recovery-triggering stalls seen in
v38/v39 and tighten load/seek tails, but the no-full-buffer streaming path now
shows occasional seek-time underruns. Treat the recovery issue as improved, not
fully closed, until seek underrun attribution is investigated.

## Memory-Mode Seek Underrun Follow-Up

The next pass targeted the seek-time underruns exposed by v40/v41. The working
hypothesis was that the memory-mode producer left the resume point with too
little cushion: after `StreamingLoadReady`, it waited for the audio command loop
to mark ready instead of continuing to fill `streaming_chunks`.

Implemented and tested:

- Keep memory-mode producer decoding/queueing after sending
  `StreamingLoadReady`; do not wait for ready application.
- Move the memory seek `is_loading=true` guard before the hot stream is
  reactivated.
- Increase `STREAMING_START_BUFFER_FRAMES` from 8192 to 12288 (three 4096-frame
  chunks). On the 96 kHz Aimer FLAC stress track this is still only about
  128 ms of source-side cushion.

Rejected experiments:

- Setting `streaming_active=false` until ready application. v44/v45 increased
  underruns versus the retained path.
- Increasing startup cushion to 16384 frames (four chunks). v47 improved seek
  p95 in that run but increased underruns, so it was not retained.

Persisted reports:

- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v42/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v43/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v44/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v45/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v46/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v47/playback-latency-benchmark.json`

| Run | Variant | load p50 / p95 / max | resume p50 / p95 / max | seek p50 / p95 / max | Recovery | Underrun / frames |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| v42 | producer continues after ready, 2 chunks | 1.049 / 25.286 / 26.634 ms | 36.723 / 52.777 / 54.003 ms | 23.657 / 27.122 / 29.661 ms | 0 | 5 / 810 |
| v43 | producer continues after ready, 3 chunks | 1.075 / 22.865 / 39.523 ms | 37.442 / 52.337 / 57.997 ms | 23.944 / 26.766 / 28.445 ms | 0 | 4 / 290 |
| v44 | ready-before-active, 2 chunks | 1.065 / 25.866 / 27.214 ms | 37.002 / 52.998 / 60.837 ms | 24.542 / 27.365 / 27.999 ms | 0 | 9 / 1930 |
| v45 | ready-before-active, 3 chunks | 1.169 / 26.239 / 29.204 ms | 36.664 / 51.419 / 52.030 ms | 24.644 / 27.207 / 28.450 ms | 0 | 8 / 1506 |
| v46 | retained path confirmation, 3 chunks | 1.043 / 19.976 / 24.754 ms | 34.933 / 51.557 / 52.792 ms | 22.921 / 26.761 / 35.614 ms | 0 | 5 / 1070 |
| v47 | producer continues after ready, 4 chunks | 1.242 / 19.658 / 37.036 ms | 35.744 / 49.933 / 50.821 ms | 18.809 / 25.138 / 35.368 ms | 0 | 11 / 2270 |

Interpretation:

- Recovery stayed at 0 throughout the underrun tuning experiments.
- Continuing the producer after ready is worth keeping: it avoids the known
  ready-application idle gap and matches the memory-mode queue contract.
- Three chunks is the best retained compromise from these runs. It does not
  prove underrun-free playback, but it reduced the best observed underrun frame
  total from v40/v41 while keeping seek p95 around 26-27 ms.
- The remaining underruns are still seek-only and one-callback scale. Further
  reduction likely needs structural work such as decoder/worker reuse or
  explicit queue-watermark diagnostics, not more blind cushion tuning.

## Queue Watermark Diagnostics and Seek Loading Gate

The next pass added runtime diagnostics to split the broad underrun signal:

- streaming queue watermark and producer counters:
  `streaming_queue_min_len`, `streaming_queue_max_len`,
  `streaming_queue_empty_during_decode_count`,
  `streaming_queue_producer_backpressure_count`;
- rendering-path counters:
  `audio_buffer_output_shortfall_count` and
  `streaming_output_shortfall_count`;
- benchmark operation deltas for the new counters.

The first diagnostic reruns used `release-fast` because the fat-LTO release
build exceeded the local command timeout in this session. Treat v49-v52 as
optimized diagnostic evidence, while v48 remains the direct release-profile
reference.

Persisted reports:

- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v48/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v49-release-fast/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v50-release-fast/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v51-release-fast/playback-latency-benchmark.json`
- `apps/desktop/output/lyne-evidence/streaming-memory-mode-flac-seek-stress-v52-release-fast/playback-latency-benchmark.json`

| Run | Profile / Variant | load p50 / p95 / max | resume p50 / p95 / max | seek p50 / p95 / max | Recovery | Underrun / frames | Key attribution |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| v48 | release, retained path | 1.088 / 22.590 / 27.774 ms | 35.893 / 50.285 / 52.472 ms | 20.707 / 24.940 / 28.544 ms | 0 | 4 / 1340 | pre-watermark evidence |
| v49 | release-fast, queue watermark | 0.995 / 23.319 / 25.990 ms | 36.348 / 51.988 / 53.487 ms | 23.089 / 27.027 / 27.944 ms | 0 | 8 / 1760 | queue empty 0, source still unknown |
| v50 | release-fast, shortfall split | 1.105 / 23.753 / 24.324 ms | 36.483 / 50.976 / 52.652 ms | 22.399 / 27.028 / 36.734 ms | 0 | 6 / 1110 | all global underruns were `audio_buffer_output_shortfall` |
| v51 | release-fast, seek loading gate | 1.071 / 24.990 / 25.992 ms | 36.050 / 52.125 / 61.007 ms | 23.392 / 26.280 / 31.332 ms | 0 | 1 / 390 | measured seek windows had 0 underrun; one event outside rows |
| v52 | release-fast, confirmation | 1.042 / 25.615 / 32.080 ms | 36.672 / 52.247 / 53.479 ms | 23.394 / 27.112 / 29.021 ms | 0 | 0 / 0 | queue empty 0, audio-buffer shortfall 0 |

Interpretation:

- The remaining v49/v50 underruns were not producer starvation:
  `streaming_queue_empty_during_decode_count = 0`, queue max reached 128, and
  memory-mode chunks were not dropped.
- v50 proved the global underrun signal came from
  `audio_buffer_output_shortfall_count`, not the streaming queue. The likely
  race was memory-mode seek briefly exposing `state=Playing`,
  `is_loading=false`, `streaming_active=false`, and an empty `audio_buffer`
  while cancelling/resetting the old streaming state.
- The retained fix keeps the loading gate active across memory-mode seek
  cancellation via `cancel_current_load_for_pending_load()`. v52 confirmed
  `underrun_count=0`, `audio_buffer_output_shortfall_count=0`, and
  `streaming_queue_empty_during_decode_count=0` over 250 measurements.
- `streaming_output_shortfall_count` remains nonzero on seek rows
  (55 events / 26400 frames in v52). This is not included in the historical
  global underrun counter, and appears to be the streaming resampler producing
  no output for one callback after reset/seek despite a full queue. It is the
  next fidelity issue to investigate if we want every seek callback to emit
  non-silent samples immediately.

## Same-Shape Electron/WebAudio Real-File Baseline

To make the Electron comparison use the same operation shape as Lyne v52, reran
the real-file Electron/WebAudio fixture with the same primary track, 50 trials,
10 ms polling, 50 ms process sampling, and the same seek fractions. This run did
not include `--next-track`, because Lyne v52 also did not include a next-track
measurement.

Command:

```powershell
npm run perf:electron-real-file-playback -- --track "D:\移动云盘挂载\15869685321\Music\Aimer - Through My Blood AM.flac" --trials 50 --poll-ms 10 --sample-ms 50 --control-toggles 1 --stability-seconds 1 --user-data-dir output/electron-real-file-playback-baseline/profile-v52-comparable-50x --out output/electron-real-file-playback-baseline-v52-comparable-50x
```

Persisted report:

- `apps/desktop/output/electron-real-file-playback-baseline-v52-comparable-50x/real-file-playback-baseline.json`

| Baseline | Measurements | Result | load p50 / p95 / max | resume p50 / p95 / max | seek p50 / p95 / max | Recovery / underrun diagnostics | Main peak RSS | Process-tree peak RSS |
| --- | ---: | --- | ---: | ---: | ---: | --- | ---: | ---: |
| Lyne v52 release-fast | 250 | pass | 1.042 / 25.615 / 32.080 ms | 36.672 / 52.247 / 53.479 ms | 23.394 / 27.112 / 29.021 ms | recovery 0, global underrun 0 | 52.5 MB | n/a |
| Electron/WebAudio 50-trial real-file | 250 | pass | 30.700 / 42.900 / 69.300 ms | 32.400 / 33.900 / 34.400 ms | 10.700 / 21.200 / 23.500 ms | no equivalent native diagnostics | 116.1 MB | 450.3 MB |

Interpretation:

- Lyne is materially faster on repeated real-file load-to-progress.
- Electron/WebAudio is faster on this seek-convergence metric and slightly
  faster on resume. This is expected because Chromium owns a browser media
  pipeline and reports `HTMLMediaElement.currentTime` convergence; it does not
  expose native callback, underrun, or recovery diagnostics.
- Lyne's stronger claim should not be "every response metric is faster than
  Electron." The evidence-backed claim is narrower and stronger: Lyne keeps
  native recovery/global-underrun diagnostics at zero under this 250-measurement
  stress, uses much less memory than the Electron process tree, and exposes
  native output/DSP controls that the WebAudio fixture does not.
- SPlayer playback is not yet same-shape measured. The existing SPlayer
  comparison remains the native scanner benchmark; source inspection shows
  product playback goes through `PlayerController` / `AudioManager` plus
  `AudioElementPlayer` or `FFmpegAudioPlayer`, but there is no existing
  script-level SPlayer playback benchmark in this repo. A fair SPlayer playback
  baseline needs a separate UI/app automation harness instead of reusing the
  generic Electron/WebAudio fixture.

## Resume and Seek Optimization Analysis (Code-Level)

Date: 2026-06-04

This section answers "can resume and seek still be optimized?" from the source
itself, not from new benchmark runs. No code was changed and no benchmark was
re-run for this analysis; the conclusions are traced to specific call sites so
the next implementation pass can target real costs instead of headline numbers.

### What the benchmark actually measures (and why resume looks slower than seek)

The two headline metrics are not measuring the same thing, so comparing their
p50s directly is misleading.

- Resume (`measurePausePlayResume`,
  `apps/desktop/scripts/lyne-playback-latency-benchmark.cjs:339`) measures
  `time_to_progress_ms` = time from `/play` until `current_time` actually
  **advances** past the pre-pause position. That requires a real audio callback
  to run and move `position_frames`, so it is inherently bounded below by one
  device callback period.
- Seek's headline `convergence_ms` (`measureSeek`, same file, line 369;
  selected as the reported metric at line 616) measures time until
  `current_time` **reaches** the seek target. But `prepare_memory_streaming_seek`
  stores `position_frames = target_frame` **synchronously** on the request
  thread (`src/player/mod.rs:600`-602) before any audio is produced, so
  `/state` reports convergence almost immediately. The benchmark already
  captures the honest "seek to audible playback" cost separately as
  `progress_after_convergence_ms` (line 389), which is *not* in the headline
  table column.

Consequence: the ~30-37 ms resume p50 and the ~20-26 ms seek p50 in the tables
above are not comparable. Resume's number is real audio-resumption latency;
seek's number is a synchronous state write. The true seek cost is
`progress_after_convergence_ms` plus the residual `streaming_output_shortfall`.

### Resume: at/near floor for shared mode

Traced path for a paused→playing resume in shared (non-exclusive) mode, which is
what the benchmark exercises (`AUDIO_PREEMPTIVE_RESAMPLE='false'`, no exclusive
flag):

1. `/play` → `AudioPlayer::play` (`src/player/mod.rs:685`). On a prior
   `Paused` state it flips `state` to `Playing` **synchronously** (line 691)
   and only then sends a redundant `AudioCommand::Play` (line 696).
2. Pause never stopped the output stream: `CpalCommandBackend::pause` returns
   early in shared mode without touching CPAL
   (`src/player/command_handlers.rs:98`-101). The stream stays warm and keeps
   firing callbacks that fill silence while `state != Playing`
   (`src/player/callback.rs:1177`-1181) — and that silent path deliberately
   does **not** advance `position_frames`.
3. The first callback after the synchronous state flip sees `Playing`, renders
   audio, and advances position (`src/player/callback.rs:1039`).

So the resume critical path to first audible output is: synchronous state flip
(no wait) + up to one device callback period + up to one `--poll-ms 10`
measurement quantum + HTTP/lock overhead. None of that is avoidable player-side
work. The `AudioCommand::Play` round-trip is redundant for a warm shared-mode
resume, but removing it would only cut command traffic, **not** latency, because
the audible callback never waits on it (state is already `Playing`).

Verdict: resume has no meaningful structural headroom. The only remaining levers
are device/measurement level — a smaller WASAPI shared-mode buffer (rejected as
risky: v40/v41 already showed seek-time underruns, so shrinking buffers invites
more) or finer benchmark polling (an artifact, not real latency). Recommend **no
resume code change** for latency; the metric is already at the shared-mode floor.

The one exclusive-mode caveat: there, `pause` really pauses CPAL
(`src/player/command_handlers.rs:102`-105) and resume calls `stream.play()`,
so exclusive-mode resume carries device resume latency. That is a different,
unmeasured path; if exclusive output becomes a target it should get its own
benchmark before any tuning.

### Seek: real headroom exists, but not where the headline metric points

The residual `streaming_output_shortfall` (55 events / 26400 frames in v52) was
previously hypothesized as "the resampler producing no output despite a full
queue." The code does not support that hypothesis. The shortfall is marked at
`src/player/callback.rs:1092`-1100, reached only when the render loop breaks at
`frames_read == 0` with `is_loading == true`
(`src/player/callback.rs:1021`-1032). `frames_read == 0` means the
**new-generation queue was empty**, i.e. the callback ran during the rebuffer
window before the producer delivered the first post-seek chunk — not a full
queue stalled in the resampler. (The resampler is not even reached on that
break.) The confirming diagnostic is `streaming_queue_min_len == 0` across the
seek; that should be checked rather than the "full queue" framing.

Why the window exists — `restart_memory_streaming_at` (`src/player/mod.rs:620`):

1. `prepare_memory_streaming_seek` (`src/player/mod.rs:544`) synchronously
   drains the old queue via `reset_streaming_state` (`src/player/state.rs:698`),
   bumps the generation, sets `position_frames` to target, sets
   `state=Playing`, and **re-activates** `streaming_active=true` with
   `is_loading=true` (lines 600-606) — so the callback is immediately eligible
   to render, but there is nothing in the queue yet.
2. Only then does it `thread::spawn` a fresh producer thread (line 632).
3. That thread calls `decode_file_streaming_first_buffer`
   (`src/player/loading.rs:439`), which **opens the file from scratch and
   re-probes the container/codec** every seek
   (`StreamingDecoder::open_with_credentials_and_cancel`,
   `src/player/loading.rs:456`), **creates a fresh soxr resampler** when the
   source rate differs from the device rate (`src/player/loading.rs:522`-540),
   then `decoder.seek` (line 543 → `src/decoder/streaming.rs:283`, a Symphonia
   `Coarse` seek + `decoder.reset()`), and finally decodes
   `STREAMING_START_BUFFER_FRAMES` before `publish_streaming_ready`
   (`src/player/loading.rs:613`-615).

Everything between steps 1 and the first pushed chunk is the rebuffer window the
listener hears as a one-callback silence, and is the bulk of
`progress_after_convergence_ms`.

Optimization opportunities for seek, in descending impact:

1. **Persistent decoder across seeks.** The fresh file open + format probe on
   every seek (`src/player/loading.rs:456`) is the largest avoidable cost for a
   same-file seek. Keeping the opened `StreamingDecoder` alive and only calling
   `decoder.seek()` (`src/decoder/streaming.rs:283`) removes open+probe latency
   entirely. Biggest single win.
2. **Persistent decode/seek worker thread.** Replacing the per-seek
   `thread::spawn` (`src/player/mod.rs:632`) with a long-lived worker fed by a
   channel removes thread create/teardown jitter and is the natural home for
   (1): the worker owns the open decoder and the resampler. Collapses items
   1-3 into one structural change.
3. **Reuse the resampler instead of recreating soxr per seek**
   (`src/player/loading.rs:522`). Correctness caveat: the existing
   `StreamingResampler::reset` only clears Rust-side buffers and does **not**
   reset the soxr delay lines (`src/processor/resampler.rs:605`-613). Reuse
   across a seek would carry stale filter state from the previous position; a
   true reuse needs an actual soxr reset (or recreating only the soxr
   instances) to avoid a brief cross-position filter smear. This is why a naive
   "keep the resampler" change is not free.
4. **Shrink the rebuffer-window silence directly.** Items 1-3 shorten the
   window. An orthogonal option is to retain a small ring of already-decoded
   samples around the playhead so an in-range seek can serve the first callback
   from cache while the producer catches up, eliminating the shortfall instead
   of just shortening it. Higher complexity; only worth it if the audible gap
   is judged a UX problem.
5. **`STREAMING_START_BUFFER_FRAMES` (= 12288, `src/player/loading.rs:29`)** is
   already tuned (v42-v47: lower raised underruns, higher raised
   underruns/latency). Not a promising standalone lever; better served by
   faster decode (1-3) than by changing the cushion.

### Recommendation

- **Resume:** leave as-is for latency. Optionally drop the redundant warm-path
  `AudioCommand::Play` as a traffic/cleanliness change only, clearly labeled as
  non-latency.
- **Seek:** the headline `convergence_ms` is already near a synchronous floor
  and should not be the optimization target. The real, optimizable residual is
  the rebuffer window (`progress_after_convergence_ms` +
  `streaming_output_shortfall`). The highest-leverage change is a persistent
  memory-streaming decode worker that keeps the decoder (and, with a correct
  soxr reset, the resampler) alive across seeks, turning each seek into
  `decoder.seek()` + decode rather than open + probe + new-soxr + seek + decode.
- **Verification when implemented:** rerun the existing 50-trial streaming
  memory-mode FLAC seek stress and watch `progress_after_convergence_ms`,
  `streaming_output_shortfall_count`/`_frames`, `streaming_queue_min_len`
  (expect it to stop hitting 0 at the seek), and the underrun counters — not
  just `convergence_ms`.

## Persistent memory-streaming worker — implemented, benchmarked, REVERTED (negative result, 2026-06-04)

The highest-leverage recommendation above (persistent decode/seek worker that
keeps the decoder + resampler alive across seeks; task
`06-04-persist-memory-streaming-decoder-across-seeks-to-cut-rebuffer-latency`)
was fully implemented and benchmarked. **It did not deliver and was reverted.**
The hypothesis — that the per-seek file open + format probe + `thread::spawn`
is the dominant rebuffer cost — was **disproved by measurement** for local
cached FLAC.

### What was built (then reverted)

* `StreamingResampler::reset_for_seek()` = `reset()` + per-instance
  `Soxr::clear()`, producer-thread only (RT `reset()` left allocation-free).
  Two unit tests proved `clear()` truly flushes the soxr polyphase delay line
  (reused == fresh, < 1e-9). The primitive worked as designed.
* A persistent `StreamingWorkerCmd { Seek, Shutdown }` worker
  (`run_memory_streaming_seek_worker`) that opens the decoder + resampler once
  and serves seeks via `decoder.seek()` + `reset_for_seek()` + refill, with
  generation/cancel coalescing, EOF park/re-arm, and lifecycle teardown on
  stop/track-load/device/settings change. 452 unit tests + an 8-point
  trellis-check review passed; the worker was **functionally correct**.

### Benchmark (50-trial streaming memory-mode FLAC seek stress, release-fast)

Three confirmation runs (v53/v54/v55) vs the v52 baseline. v52 already had all
the v42–v52 underrun fixes (clean 0/0).

| metric | v52 base | v53 | v54 | v55 | verdict |
|---|---|---|---|---|---|
| seek `progress_after_convergence_ms` p50 | 38.4 | 45.8 | 34.3 | 35.4 | flat (within run-to-run noise) |
| seek `progress_after_convergence_ms` p95 | 47.5 | 49.5 | 48.0 | 51.3 | flat / slightly worse |
| seek `progress_after_convergence_ms` **max** | **48.4** | 74.8 | 66.8 | 74.4 | **consistently ~25 ms worse** |
| seek `streaming_output_shortfall` (cnt/frames) | 55 / 26400 | 48 / 23040 | 53 / 25440 | 48 / 23040 | marginal (~10 %, within noise) |
| global **underrun** (cnt/frames) | **0 / 0** | 5 / 680 | 9 / 1100 | 7 / 930 | **regression — all `audio_buffer_output_shortfall` on seek rows** |
| `playback_recovery_count` | 0 | 0 | 0 | 0 | unchanged (good) |
| resume p50 / p95 | 36.9 / 52.3 | 36.6 / 51.5 | 33.4 / 51.2 | 33.0 / 49.8 | unchanged (untouched) |

(`convergence_ms` p50 "improved" 23.5 → ~16–18, but that metric is the
synchronous floor and is not a real seek cost — see the analysis above; the
movement is measurement timing, not latency.)

### Why the hypothesis failed

* **The bottleneck is the rebuffer window itself, not open+spawn.** After a seek
  the worker still has to `decoder.seek()` (Symphonia `Coarse`) and decode
  `STREAMING_START_BUFFER_FRAMES` before it can publish — that decode-bound
  refill dominates `progress_after_convergence_ms`, and the worker does not
  shorten it. For **local cached** files the open+probe+spawn it removed was
  already cheap, so removing it bought ~nothing on p50.
* **The worker added tail latency.** Control-channel handoff + `soxr.clear()` +
  occasional `recv_timeout` on the stale-generation race lengthened the worst
  case (`max` 48 → ~70 ms, consistent across all three runs).
* **It reintroduced an underrun regression v51/v52 had eliminated.** The
  worker's *asynchronous* pickup of the `Seek` widens the gap between the
  synchronous prep (which flips `streaming_active`/`is_loading` so the callback
  is immediately eligible to render) and the first post-seek chunk, re-exposing
  the `audio_buffer_output_shortfall` race that the v42–v52 work had driven to 0.
  Consistent 5–9 events/run.

Net: p50 flat, tail worse, a fresh underrun regression, and more concurrency
surface. Even fixing the underrun race would at best make it *neutral* (same
latency, more code) — not a win. Reverted on 2026-06-04 per the
"benchmark-before-commit" gate.

### Corrected recommendation (supersedes "Persistent decoder across seeks" above)

* For **local cached** memory-mode FLAC, do **not** pursue persistent
  decoder/worker for seek latency — empirically the open+spawn it removes is not
  the bottleneck, and the async handoff makes the tail and underruns worse.
* The real residual cost is the **decode-bound refill** of
  `STREAMING_START_BUFFER_FRAMES` after `decoder.seek()`. The only levers that
  could actually move `progress_after_convergence_ms` are ones that make the
  *first post-seek samples* available sooner without a from-scratch decode —
  e.g. opportunity #4 above (a small already-decoded ring around the playhead so
  an in-range seek serves the first callback from cache while the producer
  catches up). That is higher complexity and should itself be prototyped +
  benchmarked before any commit.
* The persistent-worker idea may still have merit for **remote/HTTP** streaming
  (where re-open = a new network round-trip), which this benchmark did not cover.
  If revisited, benchmark that path specifically — do not generalize from the
  local-file result here.
* **Process note:** this is exactly the failure mode the
  `progress_after_convergence_ms` vs `convergence_ms` distinction exists to
  catch. The synchronous-floor metric "improved" while the real cost did not;
  benchmarking the right metric before commit prevented shipping a regression.

## Web Audio API vs this engine — seek/resume latency comparison (2026-06-04)

Follow-up: why does streaming-mode seek feel "behind" a Web-Audio-based player?
Verified the native engine at HEAD (sub-agent code map) against the Web Audio
model (MDN / W3C 1.1 / Boris Smus). Result reframes the question.

### Finding: the engine already has Web Audio's fast-seek model — the lag is isolated to one mode

The native playback paths map almost 1:1 onto Web Audio's two source models —
the same tradeoff, independently arrived at:

| Dimension | Web Audio | This engine (HEAD) | Verdict |
|---|---|---|---|
| Output latency floor | Win10+ WASAPI shared (~1.3 ms engine + ~10 ms buffer) | CPAL→WASAPI shared, `BufferSize::Default` (`output_stream.rs:340`) | parity |
| Resume (pause→play) | `AudioContext.resume()` async, restarts HW stream, "not instantaneous" | shared mode: atomic state flip on a warm running stream, ≈1 callback period (`command_handlers.rs:75-106`, `callback.rs:1177`) | we match or beat |
| Seek — full-decode / default mode | `AudioBufferSourceNode.start(0, offset)` ≈ instant | whole track resident in `audio_buffer`; seek just moves `position_frames`, backend seek is a no-op (`mod.rs:740-751`, `command_handlers.rs:108`) | parity (instant, fwd+back) |
| Seek — streaming `MemoryOnly` mode | `MediaElementAudioSourceNode` + `currentTime`: browser rebuffers from new pos, **but retains buffered ranges** → in-range seek instant | `restart_memory_streaming_at`: re-open file + re-probe + new resampler + `decoder.seek` + decode ~0.28 s start buffer; **discards decoded window** | **the gap** |
| Startup latency | AudioBuffer slow (whole-file predecode) / MediaElement fast | full-decode slow / streaming fast (~0.28 s first sound) | parity (each its own trade) |
| Memory | AudioBuffer ≈84 MB/4 min (f32) / MediaElement low | full-decode ≈168 MB/4 min (**f64**) / MemoryOnly low | Web Audio slightly better |

`streaming_first_buffer` defaults to `false` (`config.rs:352`) → the default path
is full-decode = whole PCM track resident = instant in-range seek = the
AudioBuffer model. The perceived lag is specific to **streaming-first-buffer
mode**, worst in the **`MemoryOnly` sub-mode** (tracks over
`streaming_full_buffer_limit_mib`, default 256 MiB, `config.rs:9`).

### The real gap is not "streaming rebuffers" — Web Audio's streaming model rebuffers too

`MediaElementAudioSourceNode` also rebuffers on a cross-range seek. The
difference is three concrete implementation choices the browser media stack
avoids and we don't:

1. We re-open the file + re-probe container/codec every seek
   (`loading.rs:455-460`). (Cheap for local cached files per the benchmark above
   — not the dominant cost.)
2. We discard the entire decoded window every seek (`mod.rs:585-596` clears the
   queue + `audio_buffer`). We are holding up to **128 × 4096 = 524,288 frames
   ≈ 11.9 s @ 44.1 kHz** of already-decoded PCM (`state.rs:489`, `loading.rs:28`),
   and a seek whose target lies *inside* that window still throws it away and
   re-decodes from the file. The browser serves an in-buffered-range seek
   instantly from retained ranges.
3. No behind-the-playhead retention at all (queue is forward-only, consumed
   chunks retired — `callback.rs:923-924`). So every backward seek rebuffers.

The actual bottleneck is the ~0.28 s decode-bound start-buffer refill after
`decoder.seek()` (established above). The browser hides in-window seeks entirely
by retaining decoded ranges (ahead + behind); we throw ours away.

### Why the reverted worker missed it, and what would close the gap

The reverted persistent worker kept the *decoder* open (addressing #1) but still
re-decoded the start buffer from scratch on every seek — it never touched the
real cost (#2, the decode refill). That is why it regressed.

The change that would actually close the gap = **retain a bounded ring of
decoded PCM around the playhead (ahead + behind)**; serve an in-window seek
directly from RAM with zero decode (move the read offset, like the full-decode
path / Web Audio AudioBuffer); only an out-of-window seek re-decodes (and even
then, reuse an open demuxer). This is the browser's "buffered ranges" behavior,
bounded — the concrete form of opportunity #4 above. Tracked in task
`06-04-streaming-seek-pcm-ring`. As with the worker, it must be prototyped +
benchmarked (`progress_after_convergence_ms`, `streaming_output_shortfall`,
underrun) before any commit.

External references: MDN `AudioBufferSourceNode` / `start()` / `AudioBuffer` /
Web Audio best practices / `AudioContext` `baseLatency`·`outputLatency`·`resume`;
W3C Web Audio 1.1; Microsoft Learn "Low Latency Audio"; Boris Smus, *Web Audio
API* ch.2.

## PCM Ring PR2 Benchmark Gate (2026-06-05)

Follow-up task: `06-04-streaming-seek-pcm-ring`.

The first PCM-ring PR2 attempt confirmed the useful part of the design:
`progress_after_convergence_ms` improved on some in-window backward seek trials,
meaning retained PCM really can make audible playback resume faster. It still
failed the gate because `convergence_ms` regressed from the no-PR2 baseline
(`19.422 ms` p50) to about `83 ms` p50. A queue-drain-only fix reduced streaming
shortfall but left convergence unchanged.

Root cause of the remaining convergence regression: the prefix replay path sent
`StreamingLoadReady` only after pushing the entire retained prefix. The benchmark
requires `is_loading == false` for convergence, so audio could already move from
RAM while the measured convergence stayed blocked behind the delayed ready
command.

Final repair: keep the complete reset + injected-prefix design, but publish
`StreamingLoadReady` as soon as the retained prefix has queued
`STREAMING_START_BUFFER_FRAMES`. Continue pushing the rest of the prefix and
decode continuation behind it.

Persisted report:

- `apps/desktop/output/lyne-evidence/pr4-in-window-ready-threshold/playback-latency-benchmark.json`

Comparison:

| Run | In-window convergence p50 / p95 / max | Progress-after p50 / p95 / max | Combined p50 | Recovery | Underrun | Streaming shortfall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| No-PR2 baseline | 19.422 / 21.554 / 26.674 ms | 41.448 / 48.147 / 48.249 ms | 60.870 ms | 0 | 0 | 6 |
| PR2 initial | 82.953 / 146.209 / 176.237 ms | 34.705 / 52.199 / 56.481 ms | 117.658 ms | 0 | 0 | 20 |
| PR2 queue-drain fix | 82.896 / 148.280 / 159.631 ms | 31.758 / 48.776 / 89.628 ms | 114.654 ms | 0 | 0 | 1 |
| PR2 ready-threshold fix | 1.022 / 19.350 / 22.055 ms | 18.285 / 47.214 / 47.900 ms | 19.307 ms | 0 | 0 | 0 |

Verdict: PR2 now passes the benchmark gate for backward/at in-window
memory-streaming seeks. Combined p50 improved from baseline `60.870 ms` to
`19.307 ms`; recovery and underrun remained 0; in-window streaming shortfall was
eliminated. Regular seek p50 in this run was higher than the no-PR2 comparison
(`21.904 ms` vs `13.306 ms`), but p95/max and progress-after stayed in the same
range, and the changed code path is scoped to in-window prefix readiness. Treat
that as run-to-run p50 variation to continue watching, not as a proven
regular-seek regression.

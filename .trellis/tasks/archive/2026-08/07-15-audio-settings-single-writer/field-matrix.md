# Audio settings field matrix

`settings.json` is the durable authority. `AudioSettingsCoordinator` is the
only active commit writer. `AudioPlayer.config`, `SharedState`, and lock-free
DSP parameters are actuator caches/readbacks.

| Persistent API field | Runtime actuator/readback | Apply class | Frontend editor |
|---|---|---|---|
| `volume` | volume + dynamic-loudness atomics; `SharedState.volume` | live / previewable | PlayerBar, FullPlayer, AudioEngineSection |
| `device_id` | player/shared selected device, consumed on output build | restart output | AudioEngineSection |
| `exclusive_mode` | player/shared exclusive flag, consumed on output build | restart output | AudioEngineSection |
| `eq_type` | FIR/IIR transition applicator + shared readback | live control-plane rebuild | AudioEngineSection |
| `eq_bands` | FIR band command or lock-free IIR bands | live / previewable | AudioEngineSection |
| `fir_taps` | FIR convolver rebuild outside callback | live control-plane rebuild | AudioEngineSection |
| `dither_enabled` | lock-free noise-shaper enabled flag | live | AudioEngineSection |
| `output_bits` | lock-free noise-shaper bits + shared format hint | live | AudioEngineSection |
| `noise_shaper_curve` | lock-free curve + audio-thread command/readback | live | AudioEngineSection |
| `loudness_enabled` | live normalizer state | live | AudioEngineSection |
| `loudness_mode` | live normalizer mode + loaded-track refresh | live | AudioEngineSection |
| `target_lufs` | normalizer + audio-thread target command | live | AudioEngineSection |
| `preamp_db` | normalizer preamp + loaded-track refresh | live | AudioEngineSection |
| `saturation_enabled` | lock-free saturation enabled flag | live | AudioEngineSection |
| `saturation_drive` | lock-free saturation drive | live | AudioEngineSection |
| `saturation_mix` | lock-free saturation mix | live | AudioEngineSection |
| `crossfeed_enabled` | lock-free crossfeed enabled flag | live | AudioEngineSection |
| `crossfeed_mix` | lock-free crossfeed mix | live | AudioEngineSection |
| `dynamic_loudness_enabled` | lock-free dynamic-loudness enabled flag | live | AudioEngineSection |
| `dynamic_loudness_strength` | lock-free dynamic-loudness strength | live | AudioEngineSection |
| `target_samplerate` | versioned player decode config | next track | AudioEngineSection |
| `resample_quality` | player decode config + shared output-build cache | next track | AudioEngineSection |
| `use_cache` | player load/decode config | next track | AudioEngineSection |
| `preemptive_resample` | player config + shared output preference | next track | AudioEngineSection |
| `streaming_first_buffer` | player streaming-session config | next track | AudioEngineSection |
| `streaming_pcm_window_limit_mib` | player streaming-session config | next track | AudioEngineSection |
| `use_next_prefetch` | player gapless/prefetch config | next track | PlaybackSection |

## Compatibility endpoint audit

| Route family | Outcome |
|---|---|
| `/settings`, `/save_settings` | read/patch through coordinator; no direct manager publication |
| `/volume` | compatibility volume commit through coordinator |
| output/device/exclusive routes | one typed coordinator patch; no SQLite active-config write |
| resampling/upsampling/normalization routes | one typed coordinator patch |
| persistent EQ/effect/noise-shaper/output-bit routes | coordinator patch |
| `device_configs`, `dsp_configs` domain routes | read-only legacy diagnostics; never active authority |

## Explicit non-persistent/runtime-only controls

These are not silently treated as durable settings. They need a future schema
decision before a settings UI claims persistence:

- EQ enabled/bypass (`/set_eq.enabled`);
- ReplayGain enabled and per-track album gain;
- saturation threshold, input/output gain, high-pass mode/cutoff, type, and
  quality;
- IR load/unload state;
- engine-only `phase_response`, ReplayGain reference and other advanced
  loudness/dynamic-loudness fields not represented by `PersistentSettings`.

## Remaining acknowledgement gap

Next-track and restart-output fields update the correct pending runtime config
and are reported honestly, but the current implementation does not yet consume
a revisioned decoder/output acknowledgement to move them from
`next_track`/`restart_output` to `applied`. This is a follow-up, not a second
writer.

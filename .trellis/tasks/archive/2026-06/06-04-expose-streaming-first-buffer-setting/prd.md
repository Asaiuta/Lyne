# Expose Streaming First-Buffer Playback Setting

## Goal

Make local streaming first-buffer playback configurable from the desktop settings UI and keep the backend/frontend settings contract complete.

## Scope

- Add `streaming_first_buffer` to the desktop frontend settings types, response parser, form model, settings search catalog, and audio engine settings UI.
- Add `streaming_full_buffer_limit_mib` to the frontend settings contract if the backend already returns it, so settings parsing does not discard a user-facing streaming limit field.
- Keep backend defaults unchanged: `streaming_first_buffer=false`, `preemptive_resample=true`.
- Do not extend streaming first-buffer playback to HTTP/NCM in this task.
- Do not inject `AUDIO_STREAMING_FIRST_BUFFER` or `AUDIO_PREEMPTIVE_RESAMPLE` from the Tauri sidecar launcher.

## Acceptance Criteria

- Users can toggle local first-buffer playback from Settings -> Audio Engine.
- Settings round-trip through `/settings` and `/save_settings` without hand-editing `audio_settings.json`.
- Existing preemptive resampling and cache settings continue to work.
- Focused frontend settings tests cover the new fields.
- Backend config/settings tests cover persistence shape for `streaming_first_buffer` and `streaming_full_buffer_limit_mib`.

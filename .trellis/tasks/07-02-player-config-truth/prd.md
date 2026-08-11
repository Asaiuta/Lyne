# Player: remove replaygain echo and close config-truth residual

## Goal

Kill the duplicated-config-state pattern that produces "API reports applied but nothing happened" bugs, and make settings persistence crash-safe. (Review findings M3, m7, M5-settings, n7.)

## Scope reconciliation (2026-07-17)

- R1 target sample-rate ownership, R3 atomic/corrupt settings handling, and R4 dither symmetry were absorbed by `07-15-audio-settings-single-writer` and are implemented in the current uncommitted worktree.
- R2 was the remaining gap and is closed as of 2026-08-11: the mutable
  `replaygain_enabled` echo is removed, while the compatibility read field is
  derived from `NormalizationMode`.
- Do not duplicate the absorbed work. Finish this task by removing or deriving the replaygain echo, adding focused coverage, and re-verifying after the 07-15 task is committed.

## Requirements

**R1 — runtime target-samplerate changes must take effect (M3, MAJOR).**
`AudioPlayer` has `pub target_sample_rate` (mod.rs:106) which `configure_upsampling` (src/server/playback/device_config.rs:89) and settings-apply (src/server/state_helpers.rs:96) write — but every decode path reads `self.config.target_samplerate` (loading.rs:150-166 `target_sample_rate_for_device`), which nothing writes after construction. The API echoes the new value while the decode target stays frozen at boot value.
Required: single source of truth. Remove the duplicate `pub target_sample_rate` field; add a setter that mutates `self.config.target_samplerate` (mirroring `set_resample_quality`/`set_use_cache`); update all readers/writers. State reporting must read the same field decoding uses. Note: a change should apply like other decode-affecting settings do (document whether it takes effect next track or triggers reload — match `set_resample_quality` behavior).

**R2 — `replaygain_enabled` must stop being a pure echo (m7, MINOR).**
`mod.rs:108,292`, written by `src/server/effects.rs:186-187`, read only by state reporting; actual behavior driven by `NormalizationMode`. Either wire the flag to the mode (if API compat requires the endpoint) or remove the field and derive the reported value from `NormalizationMode`. Pick based on what the frontend actually calls (grep apps/desktop for the endpoint) — do not silently change observable API behavior for a consumer that relies on it.
Recon done (2026-07-03): `configureOptimizations` has **zero feature callers** in apps/desktop — only the API wrapper itself plus a contract test reference it — so the "delete the field, derive the reported value from `NormalizationMode`" route is safe.

**R3 — settings save must be atomic; corrupt settings must not brick startup (M5, MAJOR).**
`src/config.rs:203-223` `save` uses bare `fs::write` (truncate-then-write); `src/main.rs:47-48` hard-fails boot on parse error, so a crash mid-save bricks the app until manual file deletion. `SettingsManager::new` (settings.rs:140-145) already falls back to defaults — main.rs's load must do the same.
Required: (a) full atomic-write triple: write to `<file>.tmp` in the same directory → **fsync the temp file** (`File::sync_all`; maps to `FlushFileBuffers` on Windows) → rename over the target — or use `tempfile`'s `NamedTempFile::persist`, which encapsulates the same sequence. Without the fsync step a crash after rename can still leave a zero-length/partial file on some filesystems. Keep the existing verification item: confirm std::fs::rename over an existing file is atomic on Windows/NTFS; use `ReplaceFile`-equivalent semantics if rename-over-existing fails on Windows, e.g. remove+rename with the tmp as the durable copy; (b) on load parse failure, log loudly, back up the corrupt file (e.g. `.corrupt` suffix), and continue with `from_env_defaults()`.

**R4 — dither flag asymmetry (n7, NIT, opportunistic).**
`state_helpers.rs:72` sets `player.dither_enabled` without `lockfree_noise_shaper_params.set_enabled`, unlike `effects.rs:181-184`. Align the settings-apply path with the HTTP handler.

## Acceptance Criteria

- [x] `pub target_sample_rate` field gone; a test proves `configure_upsampling`-equivalent setter changes what `target_sample_rate_for_device` returns.
- [x] `replaygain_enabled` no longer a write-only echo (wired or derived); frontend usage checked and preserved.
- [x] Settings: kill-during-save simulation (write tmp, skip rename) leaves the old file intact; corrupt-file load test boots with defaults and preserves the corrupt file as backup. Unit tests for both.
- [x] `cargo test` green; no new clippy warnings in touched files.
- [x] EngineSettings/PersistentSettings still contain only engine-level fields (project rule — no app/online settings drift in).

## Constraints

- Conflicts with 07-02-player-seek-race (mod.rs) and 07-02-server-token-log (config.rs) — run AFTER both land.
- `settings.json` format must remain backward-compatible (existing files load unchanged).

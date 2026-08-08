# Unify audio settings source of truth

## Goal

Make every audio setting have one authoritative owner and an explicit lifecycle from user intent to durable storage to the audio engine. PlayerBar, the global audio settings page, startup hydration, and legacy HTTP endpoints must no longer overwrite each other or report values that the DSP/output thread is not actually using.

## Problem Statement

The current implementation represents the same setting in several independently mutable places: `settings.json`, `SettingsManager`, `AudioPlayer.config`, public `AudioPlayer` mirror fields, `SharedState`, lock-free DSP atomics, audio-thread startup copies, SQLite `device_configs` / `dsp_configs`, `PlayerState`, and frontend form/draft state. HTTP handlers update different subsets of those stores and often reapply a complete stale snapshot after a partial change.

Confirmed failures include:

- PlayerBar `/volume` changes runtime volume only; a later `/save_settings` reapplies the persisted volume and silently overwrites it.
- Startup hydrates `SharedState.volume` but can leave the volume DSP atomic at the audio-core default, so the UI and actual gain differ.
- Persisted EQ state is not completely applied at startup; FIR-to-IIR changes can update only the label while FIR processing remains enabled.
- Device, exclusive mode, output bit depth, and noise shaping use multi-step runtime/SQLite/JSON writes that can partially succeed.
- `target_sample_rate` and `config.target_samplerate` are distinct, while decode reads only the latter.
- The audio thread freezes settings such as resampling quality and output bit depth in startup copies.
- Streaming buffer settings can be persisted without being applied to the current runtime.
- nullable patch fields cannot reliably distinguish omitted from explicit `null`.
- stale frontend requests can replace newer playback/settings state because responses have no revision ordering.
- `SettingsManager::update()` mutates memory before disk persistence, leaving memory ahead of disk after a write failure.
- the settings UI accepts a different volume range (`0..4`) from PlayerBar and the backend (`0..1`).

## Requirements

### R1 — one control-plane writer

Introduce an `AudioSettingsCoordinator` (name may change during implementation) as the only component allowed to commit persistent audio-setting changes or coordinate their runtime application. HTTP handlers, PlayerBar adapters, settings handlers, and device/DSP domain handlers must submit typed commands instead of independently mutating `AudioPlayer`, atomics, SQLite, or `SettingsManager`.

### R2 — explicit desired and effective state

Expose a versioned snapshot containing:

- `revision`: a monotonic committed-settings revision;
- `state_revision`: a monotonic version for every observable snapshot mutation,
  including preview, cancel, expiry, and commit;
- `desired`: the latest durably committed user intent;
- `effective`: the values currently used by the engine;
- per-field/group apply state: `applied`, `next_track`, `restart_output`, or `failed` with a safe diagnostic.

State APIs must never claim that a value is effective merely because it was accepted or persisted.

### R3 — preview, commit, and cancel semantics

Realtime UI interaction must use an explicit preview session with a monotonically increasing sequence number. A preview can change runtime behavior but cannot alter durable desired state. Commit accepts a typed patch and base revision; cancel or session expiry restores the committed desired value. Out-of-order preview messages must be ignored.

PlayerBar volume uses the same mechanism as the settings page: immediate preview while dragging and a durable commit at interaction end (with a short debounce fallback for keyboard/wheel input). The two surfaces must remain synchronized.

### R4 — patch and conflict correctness

Settings writes must carry only dirty fields. The backend must distinguish absent, explicit `null`, and concrete values for nullable fields such as `device_id` and `target_samplerate`. A stale write must not overwrite a newer change. Non-overlapping patches may be rebased onto the latest revision; overlapping stale patches must return a conflict snapshot.

### R5 — durable persistence ordering

`settings.json` remains the authority during this migration. A commit must validate and build a candidate snapshot, atomically persist it, and only then publish it as desired state. An I/O failure must leave both the in-memory committed snapshot and the previous file unchanged. Runtime application failures after persistence are represented as desired/effective divergence and must be retryable and visible.

### R6 — deterministic startup hydration

All player mirrors, shared state, lock-free parameters, decoder configuration, and audio-thread configuration must be initialized from one validated settings snapshot before playback starts. Tests must prove that persisted volume, EQ mode/bands, dither/noise shaping, output bits, target sample rate, and other supported fields agree with the engine-visible values after construction.

### R7 — classified runtime application

Every field must be classified as one of:

- live/lock-free;
- effective for the next decode/track;
- requires output stream rebuild;
- requires application restart (only if technically unavoidable).

The coordinator must route changes through the corresponding actuator. Audio-thread startup copies must not remain the hidden source of truth for settings advertised as runtime configurable.

### R8 — frontend ordering and shared state

Create one frontend audio-settings store used by PlayerBar and the settings page. It accepts only snapshots/replies newer than the currently applied revision (and preview sequence). The settings form stores dirty overrides rather than a second full authoritative snapshot, rebases untouched fields, and preserves dirty fields across unrelated updates.

### R9 — legacy migration without dual writes

Keep existing routes working as compatibility adapters during migration, but route them through the coordinator and return versioned state. Stop treating SQLite `device_configs` and `dsp_configs` as competing authorities; either remove their writes or redefine them as derived diagnostic/history records that are never read to decide active engine state. Remove deprecated direct-write paths after all frontend callers migrate.

### R10 — regression coverage

Add backend and frontend tests for ordering, persistence failures, startup hydration, preview cancellation, stale conflicts, and cross-surface interaction. Include a regression test for the exact sequence: PlayerBar volume change → unrelated global audio setting save → volume remains the committed/effective value.

## Scope

In scope:

- engine-level audio settings in `EngineSettings` / `PersistentSettings`;
- backend control-plane, persistence, startup hydration, audio-thread configuration handoff, and related APIs;
- PlayerBar volume and the desktop audio-engine settings section;
- compatibility adapters and cleanup of overlapping device/DSP persistence.

Out of scope unless required by an in-scope invariant:

- redesigning the DSP algorithms themselves;
- changing the `settings.json` user-facing schema incompatibly;
- general playback queue/transport state ownership. Transport responses should receive a separate player-state revision task if the same audit confirms stale play/pause/repeat/shuffle responses outside audio settings.

## Acceptance Criteria

- [x] The PlayerBar-volume-then-settings-save regression is covered and passes; neither desired nor effective volume regresses.
- [x] A single coordinator owns all persistent audio-setting commits; audited HTTP handlers contain no direct multi-store writes.
- [x] `GET`/commit responses expose monotonic committed/state revisions, desired/effective values, and honest apply status.
- [x] Preview ordering (same and cross-session), cancel/expiry rollback, delayed post-expiry rejection, commit, same-field stale conflict, and unrelated-field rebase are tested.
- [x] Explicit `null` clears nullable device/sample-rate settings while omission leaves them unchanged.
- [x] A failed settings write changes neither the durable publication path nor the in-memory committed snapshot; writes use same-directory flush + atomic replacement.
- [x] Startup tests prove persisted volume and EQ/DSP configuration reach the actual lock-free/runtime parameters, not only `PlayerState` mirrors.
- [x] FIR → IIR disables FIR processing; persisted EQ state is restored consistently on startup.
- [x] Runtime-configurable resampling/output/streaming fields either update the correct pending runtime config or report `next_track` / `restart_output`; no silent no-op remains.
- [x] PlayerBar and the settings page share the same range (`0..1` internally), revision, and visible value.
- [x] SQLite device/DSP records cannot override active settings and are no longer part of a dual-write commit path.
- [x] Existing `settings.json` files and legacy API callers remain compatible through the migration.
- [x] Focused/full Rust and desktop tests, formatting, typecheck, build, check, and default Clippy gates pass. Strict `-D warnings` still exposes repository baseline warnings outside this task's changed lines.

## Constraints and Related Work

- Use a phased migration rather than a big-bang replacement so each invariant can be tested and rolled back independently.
- Preserve real-time safety: no file I/O, allocation-heavy mutation, or blocking lock may be added to the audio callback.
- Preserve unrelated user changes in the currently dirty worktree.
- `.trellis/tasks/07-02-player-config-truth` overlaps on target sample rate, atomic settings persistence, and dither symmetry. It is still in planning; implementation must consolidate that scope rather than independently landing two conflicting fixes.

## Decision Gate

Recommended implementation policy: land the P0 consistency and regression-test phase first, then migrate to the coordinator in the same task. This plan must be approved before `task.py start` and code changes.

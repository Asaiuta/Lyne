# Implementation plan: single-writer audio settings

## Policy

Implement in small, independently testable phases. Do not start code changes until the PRD/design are approved and `python ./.trellis/scripts/task.py start 07-15-audio-settings-single-writer` succeeds. Preserve unrelated dirty-worktree changes.

## Phase 0 — characterize ownership and freeze regressions

1. Build an exhaustive field matrix for every `EngineSettings` / `PersistentSettings` field:
   - durable writer/readers;
   - runtime actuator/readback;
   - frontend editor(s);
   - live/next-track/output-rebuild classification;
   - current duplicate mirrors and legacy endpoints.
2. Add failing or characterization-focused tests for:
   - PlayerBar `/volume` followed by unrelated `/save_settings`;
   - persisted volume versus the actual volume atomic after player construction;
   - persisted EQ/FIR startup state and FIR → IIR transition;
   - explicit-null patch decoding;
   - disk-write failure leaving `SettingsManager` memory unchanged;
   - resample/streaming/output settings that currently remain frozen.
3. Record the exact overlap with `.trellis/tasks/07-02-player-config-truth` and avoid duplicate implementations.

Gate: tests reproduce each confirmed bug or document an already-correct path before production behavior changes.

## Phase 1 — P0 consistency containment

1. Refactor `SettingsManager` to candidate → atomic persist → publish ordering; reuse/complete the crash-safe save work planned in `07-02-player-config-truth`.
2. Add a typed tri-state patch representation and range/cross-field validation.
3. Make legacy settings application patch-scoped: a request applies only fields present in its patch and cannot reapply stale volume or other omitted values.
4. Create one exhaustive startup hydration function and initialize all DSP atomics/runtime settings from the loaded snapshot before the audio thread starts.
5. Fix FIR → IIR transition symmetry and dither/noise-shaper symmetry through shared applicator functions.
6. Remove or redirect the duplicate `target_sample_rate` mirror so decode and reporting read the same value.
7. Normalize the frontend/backend volume contract to `0.0..=1.0`.

Likely backend touch points:

- `src/settings.rs`
- `src/config.rs`
- `src/player/mod.rs`
- `src/player/audio_thread.rs`
- `src/server/settings_handlers.rs`
- `src/server/state_helpers.rs`
- `src/server/playback/device_config.rs`
- focused tests adjacent to those modules

Gate: P0 regressions pass with legacy APIs; no direct save of an unrelated setting can overwrite a newer runtime volume.

## Phase 2 — backend coordinator and versioned runtime handoff

1. Introduce coordinator state, typed commands, global revision, and per-field last-changed revisions.
2. Move commit validation, conflict detection, persistence, runtime application, effective readback, and status recording into the coordinator.
3. Add preview session management with sequence ordering, cancellation, expiry, and desired-state restoration.
4. Split runtime applicators by class:
   - lock-free live DSP application;
   - versioned decoder/next-track configuration;
   - output control-thread rebuild with revisioned acknowledgement.
5. Replace mutable audio-thread startup copies for advertised runtime settings with versioned config/commands.
6. Route settings, volume, device, exclusive-mode, output-bit, noise-shaping, and DSP handlers through the coordinator.
7. Expose versioned desired/effective/apply-status snapshots and conflict responses.

Gate: backend concurrency tests prove stale preview/acknowledgement drops, same-field conflict detection, unrelated-field merge, persistence failure isolation, and honest desired/effective divergence.

## Phase 3 — frontend shared store and interaction migration

1. Add typed API contracts/parsers for snapshot, revision, preview, commit, cancel, status, and conflict responses.
2. Implement a shared `AudioSettingsStore`, following project state conventions and the preview/commit/rollback behavior already tested in `uiSettingsStorage.ts`.
3. Migrate PlayerBar volume:
   - begin/continue preview with increasing sequence;
   - commit on interaction end;
   - debounce keyboard/wheel fallback;
   - cancel/rollback on explicit cancellation;
   - display latest store value without a private authority.
4. Migrate `AudioEngineSection`:
   - dirty-field overrides only;
   - rebase untouched fields on newer snapshots;
   - preserve dirty fields;
   - handle conflict/retry/apply status visibly;
   - remove unconditional refresh patterns that can restore stale state.
5. Add request-generation/revision guards wherever a complete playback response embeds audio settings.

Likely desktop touch points:

- `apps/desktop/src/shared/api/types.ts`
- `apps/desktop/src/shared/api/settings.ts`
- `apps/desktop/src/shared/api/playback.ts`
- `apps/desktop/src/shared/state/` (new shared store and tests)
- `apps/desktop/src/app/usePlaybackCommands.ts`
- `apps/desktop/src/features/settings/sections/AudioEngineSection.tsx`
- PlayerBar component/hooks that own drag lifecycle

Gate: frontend tests simulate reordered network responses and concurrent PlayerBar/settings-page edits without value regression.

## Phase 4 — remove dual writes and obsolete mirrors

1. Migrate all remaining legacy clients to coordinator operations.
2. Remove direct handler writes to `AudioPlayer`, settings atomics, and overlapping SQLite active configuration.
3. Remove public mirror fields that no longer represent authority; keep only typed actuators/readbacks.
4. Deprecate/delete or convert `device_configs` / `dsp_configs` to revision-tagged optional diagnostics.
5. Remove compatibility routes only when repository-wide caller search and contract tests show no remaining consumers.
6. Update project specs with the ownership invariant and a checklist for adding a new audio setting.

Gate: repository search finds one commit authority, each field has one documented applicator, and no active-state read depends on SQLite overlap or a stale player mirror.

## Verification matrix

### Backend

- Unit tests: patch tri-state serde, field conflicts, preview sequence, cancellation/expiry, status transitions.
- Persistence tests: temp-write/replace failure, corrupt input recovery if included from related task, memory/disk ordering.
- Player construction tests: desired/effective equality for all startup-applicable fields.
- Integration tests: legacy and new routes interleaved, runtime failure, output rebuild acknowledgement ordering.
- Quality: `cargo fmt --check`, focused `cargo test`, relevant full `cargo test`, `cargo clippy`/`cargo check` according to project gates.

### Desktop

- API parser/contract tests for new envelopes and 409 conflicts.
- Store reducer tests for revision ordering, dirty-field rebase, preview rollback, failed commit, late response.
- component/hook tests for PlayerBar drag/keyboard commit and settings-form coexistence.
- Quality: focused desktop tests, typecheck, lint/build gates required by the package spec.

### Manual scenario

1. Start with persisted volume 70%; verify UI and measured/effective atomic both report 70%.
2. Drag PlayerBar to 35%; hear immediate preview, release, observe committed revision.
3. Open/save an unrelated resampling or EQ setting; volume remains 35% in both surfaces and effective state.
4. Preview a new value and cancel; it returns to the latest desired value.
5. Force an output-device apply failure; desired/effective divergence and retry guidance are visible.
6. Restart; committed settings hydrate consistently.

## Rollback strategy

- Keep legacy route adapters until phase 4.
- Land behavior changes behind the coordinator boundary, not duplicate feature flags inside the audio callback.
- Each phase must leave tests green and can be reverted without changing `settings.json` format.
- If versioned runtime handoff is not ready, report `next_track` / `restart_output` rather than silently claiming live application.

## Follow-up task

Create a separate player-state revision task for stale full-state responses from play/pause/repeat/shuffle/refresh flows after this task establishes the revision pattern. It is the same race category but outside the audio-settings ownership boundary.

## Implementation record (2026-07-15)

- [x] Characterized all public persistent fields and compatibility routes in
  `field-matrix.md`.
- [x] Added atomic candidate persistence and corrupt-file preservation.
- [x] Added backend coordinator, per-field conflict metadata,
  desired/effective/apply status, preview sequence/expiry/tombstones, and
  committed plus observable revisions.
- [x] Hydrated runtime atomics/config from one startup snapshot, removed the
  duplicate target-sample-rate mirror, and made FIR → IIR symmetric.
- [x] Migrated persistent legacy output/resampling/effect routes and removed
  active SQLite device/DSP writes.
- [x] Added shared frontend store, effective PlayerState projection, dirty-form
  rebase, PlayerBar/FullPlayer preview + commit, and wheel debounce.
- [x] Added cross-session ordering and failure-cleanup regression tests found in
  the final quality review.
- [x] Added backend/frontend executable code-specs and debug retrospective.

Validated commands:

```text
cargo fmt --all -- --check
cargo check --bin audio_server
cargo test --lib
cargo clippy --lib --bin audio_server
npm run typecheck
npm test
npm run build
git diff --check
```

Strict Clippy with `-D warnings` remains red on repository baseline warnings;
the task-file diagnostics were cross-checked against changed hunks and no new
warning originates from this implementation.

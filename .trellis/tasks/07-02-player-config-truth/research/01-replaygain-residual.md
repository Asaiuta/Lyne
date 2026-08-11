# ReplayGain config-truth residual

Date: 2026-08-11

## Refactor decision

The residual warranted a bounded ownership refactor, not another compatibility
write and not a second audio-settings redesign:

- `AudioPlayer.replaygain_enabled` was independently mutable but did not control
  DSP behavior;
- `NormalizationMode` already controlled ReplayGain track/album behavior;
- the archived `07-15-audio-settings-single-writer` field matrix explicitly
  classifies ReplayGain enabled as runtime-only and non-persistent;
- R1, R3, and R4 were already absorbed and validated by that task, so reopening
  their implementation here would duplicate an established owner.

The one-use mode predicate remains inline in `get_player_state`; a test-only
helper or new shared domain abstraction would add more structure than this
single compatibility projection needs.

## Caller and compatibility evidence

`rg` found no desktop feature caller for `/configure_optimizations`. The only
desktop references are the API route/wrapper and its type-contract assertion.
The frontend playback-state parser and typed state still consume
`replaygain_enabled`, so the response field is retained.

The request field and mutable `AudioPlayer` field are removed. State reporting
now reads the same `NormalizationMode` used by playback and reports
`replaygain_enabled=true` only for `ReplayGainTrack` and `ReplayGainAlbum`.
It also reuses `normalization_mode_to_string` instead of maintaining a second
mode-to-string match.

## Validation

- `cargo check --locked --tests`: passed;
- focused behavior test
  `server::state_helpers::tests::replaygain_state_is_derived_from_normalization_mode`:
  passed for all five normalization modes;
- `cargo test --locked`: 429 passed;
- `cargo clippy --locked --lib --tests --message-format=short`: exit 0, with
  repository baseline warnings and no new task warning;
- targeted `rustfmt --edition 2021 --check` over the four Rust product files:
  passed;
- `npm run typecheck`, `npm test`, and `npm run build` in `apps/desktop`:
  passed; bundle budget passed;
- task-scoped `git diff --check`: passed.

The Windows test link was rerun with `LIB` pointed at the existing
`audio-engine-core` build output containing `soxr.lib`; the dependency build
script's pkg-config search path contains a space-truncated
`C:/Users/Yukina` entry in this shell.

## Spec sync

No new `.trellis/spec/` rule is needed. The existing backend audio-settings
control-plane spec already requires one persistent writer, treats runtime
caches as actuators rather than owners, and defines legacy routes as
compatibility adapters. This change closes one residual violation of that
contract rather than establishing a new convention.

## Closeout state

All task acceptance criteria are satisfied. The task remains `in_progress`
until the user explicitly approves archival; the large unrelated dirty
worktree remains outside this task's staged scope.

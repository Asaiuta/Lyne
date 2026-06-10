# Tighten audio engine core dependency ownership

## Goal

After extracting `crates/audio-engine-core`, make Cargo dependency ownership match the new package boundary. The root `audio_engine` crate should not keep direct runtime dependencies that are now only used by `audio-engine-core`.

## Requirements

- Remove root `Cargo.toml` dependencies that are no longer used by root `src/` or root bench targets.
- Keep dependencies that root app/server/player code still imports directly.
- Keep bench-only direct dependencies as `dev-dependencies` instead of runtime dependencies.
- Remove root SoXR build metadata/build dependencies if root no longer links SoXR directly.
- Keep `audio-engine-core` dependencies self-contained.
- Do not change Rust APIs, module layout, playback behavior, or public re-export surfaces.
- Follow Occam's razor: no workspace dependency table, no feature matrix, no compatibility shims.

## Acceptance Criteria

- [x] `cargo check --bin audio_server` passes.
- [x] `cargo test -p audio-engine-core --lib` passes.
- [x] At least one root bench target that uses moved/bench-only dependencies compiles far enough to catch missing deps.
- [x] Root `Cargo.toml` no longer lists core-only runtime dependencies.
- [x] Existing unrelated dirty files remain untouched.

## Notes

- Current scan shows `symphonia`, `soxr`, `rayon`, and `atomic_float` are core-only after the split.
- `rustfft` and `ebur128` are still used directly by root benches, so they should move to root `dev-dependencies`.
- `parking_lot`, `rand`, `arc-swap`, `rusqlite`, `reqwest`, and `thiserror` are still used by root app/server/player code and should stay in root runtime dependencies.
- Backend directory structure spec was updated so build-script ownership matches the cleanup: SoXR link discovery lives only in `crates/audio-engine-core/build.rs`.

## Validation

- `cargo check --bin audio_server` — passed.
- `cargo test -p audio-engine-core --lib` — 152 passed.
- `cargo check --bench audio_convolver_perf --bench audio_quality_measurements` — passed.

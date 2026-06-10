# Prepare audio-engine-core for open-source packaging

## Goal

Make `crates/audio-engine-core` ready for a credible first open-source crate/package dry-run without broad API redesign. The package should describe itself clearly, include the required Cargo publication metadata, generate clean public docs, and pass packaging verification.

## Requirements

- Add crate-level publication metadata to `crates/audio-engine-core/Cargo.toml`: license/license-file, repository, documentation/homepage where appropriate, readme, keywords, and categories.
- Add a crate-specific `crates/audio-engine-core/README.md` focused on the reusable core crate, not the full Lyne desktop app.
- Document the current scope honestly: decoder, DSP, resampler, loudness, pipeline primitives; no playback device/runtime/server/UI ownership.
- Document SoXR/native build expectations for Windows and Unix-like environments.
- Fix current `cargo doc -p audio-engine-core --no-deps` rustdoc warnings caused by public docs linking to private modules.
- Keep this as a release-prep task only: no API redesign, no dependency feature matrix, no broad compatibility shims, no license strategy change beyond making the current license explicit.

## Acceptance Criteria

- [x] `cargo check -p audio-engine-core` passes.
- [x] `cargo test -p audio-engine-core --lib` passes.
- [x] `cargo doc -p audio-engine-core --no-deps` passes without rustdoc warnings from this crate.
- [x] `cargo package -p audio-engine-core --allow-dirty --list` includes the crate README and expected source files only.
- [x] `cargo package -p audio-engine-core --allow-dirty` passes without manifest metadata warnings.
- [x] If network/registry access permits, `cargo publish -p audio-engine-core --dry-run --allow-dirty` is attempted and its result recorded.
- [x] Existing unrelated dirty files remain untouched.

## Definition of Done

- The core crate can be packaged and documented as a standalone artifact.
- Documentation clearly states the crate is experimental `0.1.x` API surface.
- Validation results are recorded in this PRD before commit/archive.

## Technical Approach

Use the current AGPL-3.0 project license as the package license for this task. Add minimal metadata and docs, then fix rustdoc links by linking exported items or using plain text for private module names. Do not introduce workspace dependency tables or optional feature splits.

## Out of Scope

- Publishing to crates.io for real.
- Changing project license or adding dual licensing.
- Renaming the crate/package.
- Stabilizing or redesigning the public API.
- Adding CI workflows.
- Splitting SoXR, network decoding, SQLite, or loudness database into optional features.

## Technical Notes

- Previous packaging probe showed `cargo package -p audio-engine-core --allow-dirty` can verify the package, but Cargo warned that manifest license/repository/documentation metadata was missing.
- Previous rustdoc probe showed private intra-doc link warnings in `crates/audio-engine-core/src/processor/mod.rs`.
- `cargo search audio-engine-core --limit 5` returned no visible same-name result in the current environment, but formal name reservation is still out of scope until publish/dry-run.

## Validation

- `cargo check -p audio-engine-core` - passed.
- `cargo fmt -p audio-engine-core --check` - passed.
- `cargo doc -p audio-engine-core --no-deps` - passed with no warnings.
- `cargo test -p audio-engine-core --lib` - 152 passed.
- `cargo package -p audio-engine-core --allow-dirty --list` - passed; package includes crate `README.md` and source/build files only.
- `cargo package -p audio-engine-core --allow-dirty` - passed after network-enabled retry; no manifest metadata warning.
- `cargo publish -p audio-engine-core --dry-run --allow-dirty` - passed; upload aborted only because dry-run was requested.

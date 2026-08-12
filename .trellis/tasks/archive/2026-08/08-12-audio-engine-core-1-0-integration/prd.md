# Integrate latest audio-engine-core 1.0.1

## Goal

Upgrade AudioPlayer from its current `audio-engine-core` revision to the
latest verified `1.0.1` commit, `af5899886939add755217cc72865ed8426e3d9cc`,
and migrate every application and benchmark call site to the stable 1.0 API.
The upgrade is complete only when decoder, streaming, DSP, callback, and
persistence behavior remains valid under the new typed contracts.

## Confirmed Facts

- AudioPlayer currently consumes `5389c32f66c52c2d0b870acdeae4b20cf9c9de47`.
- `D:\AI\audio-engine-core` `main` and `origin/main` point to
  `af5899886939add755217cc72865ed8426e3d9cc`; the core repository contains
  only an unrelated untracked Trellis task and must not be modified here.
- The target core is `1.0.1`, following the breaking `1.0.0` API release and
  the `Symphonia 0.6` migration.
- A temporary local-path resolution exposed about 97 library compile errors
  and 156 test-target errors, so this is a source migration rather than a
  version bump. The committed lockfile was restored and its hash matched.
- Main migration areas are typed `MediaLocation` decoder inputs, owned
  cancellation tokens, fallible DSP construction and controls, convolver
  control/disposal, private loudness state, and moved streaming APIs.
- `07-02-build-ci-hygiene` remains independent; its pinned revision and files
  are not changed by this task.

## Requirements

### R1 - Migrate decoder and source boundaries

- Convert local paths and remote URLs at the application boundary into the
  core's typed `MediaLocation` contract.
- Migrate decoder probing/opening, staged sources, seek paths, AutoMix
  analysis, loudness construction, and preload benchmarks together.
- Replace removed HTTP-policy APIs with the existing application-owned remote
  fetch/security boundary without weakening redirect, URL, or cookie policy.
- Update cancellation construction and propagation to the current
  `DecodeCancelToken` ownership model.

### R2 - Migrate public exports and configuration

- Replace removed legacy exports and configuration types with current playback,
  processor, and parameter contracts.
- Preserve settings ownership: application settings remain outside core engine
  configuration types.
- Access decoder metadata and loudness state through read-only accessors and
  typed identities.

### R3 - Migrate DSP, callback, and lifecycle integration

- Adapt `DspChain` construction, processor insertion, sample-rate handling,
  and error propagation to the fallible `u32`-rate API.
- Migrate resampler, noise-shaper, saturation, volume, limiter, and callback
  paths to `StreamingProcessor` and current parameter APIs.
- Adapt convolver construction and control publication to `ConvolverControl`,
  including producer-side retirement/disposal required by the lifecycle.
- Preserve allocation-free callback behavior and existing ownership boundaries.

### R4 - Update tests, benches, and dependency lock

- Add or adjust focused compatibility tests before changing the dependency pin.
- Keep benchmark cases meaningful and update API glue only.
- After source migration compiles, update `Cargo.toml` and `Cargo.lock` to the
  target commit and verify that exact revision.

## Acceptance Criteria

- [x] No production, test, or benchmark target references removed core APIs.
- [x] `cargo metadata --locked --no-deps` resolves the target revision.
- [x] Root fmt and clippy gates pass without unrelated worktree changes.
- [x] Root workspace tests pass with required SoXR native libraries; any local
  limitation is recorded with its exact command and error. 445 passed, 0 failed,
  1 ignored; no SoXR limitation was hit.
- [x] Relevant callback, decoder, resampler, convolver, and playback benchmark
  gates pass without unexplained regressions. Callback chain, callback output
  path, and resampler streaming all report `bench_gate verdict=passed
  mode=check`, and the output-path bench reports zero deadline misses.
  `audio_convolver_perf` is report-only (no gate spec) and improved over its
  legacy path. These are integrity verdicts, not device or end-to-end latency
  evidence.
- [x] The independent Tauri crate still checks, tests, and links as required:
  `cargo check --all-targets` 0 errors, `cargo test` 19 passed. Its pre-existing
  `main.rs` fmt drift is untouched by this task.
- [x] `Cargo.toml` and `Cargo.lock` point to the target commit and the final
  diff contains no unrelated changes; the `Cargo.toml` diff is exactly the one
  revision line.

## Explicitly Out Of Scope

- Any source, commit, push, or task changes in `D:\AI\audio-engine-core`.
- Reworking CI or the Electron comparison benchmark dependency.
- New DSP features, audio-quality policy changes, or broad unrelated refactors.
- Device/driver/DAC or end-to-end latency claims from library benchmarks.

## Constraints

- Preserve unrelated dirty worktree changes and stage only task-owned files.
- Keep the current revision until source compatibility is proven.
- Do not use `git reset`, `git checkout`, or broad staging commands.
- Do not push either repository without explicit user approval.

# Extract audio engine core workspace crate

## Goal

Create the first internal package boundary for the Rust audio engine by introducing a workspace core crate for reusable audio-engine code. The immediate goal is not public release; it is to make the future open-source boundary real inside the repo while keeping the current `audio_server` behavior unchanged.

## What I already know

- The repo root is currently the `audio_engine` crate and also owns the `audio_server` binary.
- The meaningful split is a workspace package boundary, not merely moving the whole `src/` tree.
- Core candidates are decoder, processor, pipeline, and callback/streaming primitives where they can move without dragging app/server concerns.
- App-specific concerns should remain in the root app/server crate for this task: HTTP/WebSocket server, app database, NetEase/WebDAV, runtime paths, settings persistence, and desktop protocol glue.
- The worktree already has unrelated dirty files. This task must preserve them and only touch files needed for the extraction.

## Requirements

- Add a workspace member under `crates/audio-engine-core/`.
- Move or expose a minimal coherent core surface from the existing root crate into that package.
- Keep app/server-only modules in the root crate.
- Update imports so the root crate depends on the new core crate instead of continuing to own the moved core modules.
- Keep public behavior unchanged for the current desktop/server integration.
- Avoid broad cleanup, API polish, or publication work that is not required to compile and validate the first internal boundary.
- Follow Occam's razor: prefer the smallest real package boundary that compiles and proves ownership; do not add compatibility layers, future-facing abstractions, or extra crate splits unless the current compile boundary requires them.

## Acceptance Criteria

- [x] `cargo check --bin audio_server` passes.
- [x] Focused core tests compile and run for moved modules where practical.
- [x] The root crate no longer defines every moved core module directly.
- [x] `server`, `app_database`, `webdav`, `netease`, and settings persistence remain outside the core crate.
- [x] The split does not introduce new runtime fallback layers or duplicate sources of truth.
- [x] The split stays minimal and avoids over-design / over-compatibility.

## Definition of Done

- Tests/checks added or updated where the extraction changes compile boundaries.
- Relevant Trellis/backend spec context followed.
- Residual follow-up scope documented if only part of the future open-source split is feasible in this task.
- Unrelated dirty files are left untouched.

## Technical Approach

Start with a conservative internal package split. Prefer moving modules that are already app-agnostic or can be made app-agnostic with small import changes. If a module currently depends on app-owned state, leave it in the root crate and document it as a later extraction candidate rather than adding compatibility shims.

## Decision (ADR-lite)

**Context**: The audio engine has open-source value, but the current crate combines reusable audio work with app/server concerns.

**Decision**: Introduce an internal `crates/audio-engine-core` workspace crate first, then make the root application crate depend on it. This validates the ownership boundary before any external publication.

**Consequences**: The first split may be intentionally partial. It favors a compiling, maintainable boundary over a large mechanical move that exports app-specific contracts.

## Out of Scope

- Publishing to crates.io or creating a separate public repository.
- Stabilizing a long-term public API.
- Moving HTTP/WebSocket server handlers.
- Moving app database, NetEase, WebDAV, runtime path, or desktop settings persistence.
- Rewriting audio algorithms or changing playback behavior.
- Cleaning unrelated active Trellis tasks or dirty files.

## Technical Notes

- Backend spec context: `.trellis/spec/backend/index.md`, `directory-structure.md`, `error-handling.md`, `quality-guidelines.md`, `logging-guidelines.md`.
- Shared thinking context: `.trellis/spec/guides/index.md`, `cross-layer-thinking-guide.md`, `code-reuse-thinking-guide.md`.
- Existing memory note: extract `decoder` + `processor` + `pipeline` + callback/streaming primitives into core where practical; keep app/server concerns outside.

## Implementation Notes

- Created `crates/audio-engine-core` as an internal workspace package.
- Moved `decoder`, `processor`, `pipeline`, and the small shared `config`/`diagnostics`/`runtime` helpers needed by those modules.
- Kept playback control, server routes, app database, WebDAV, NetEase, settings persistence, and runtime path ownership in the root application crate.
- Added a package-local Windows SoXR build script so the core crate can link and run its own tests.

## Validation

- `cargo test -p audio-engine-core --lib` — 152 passed.
- `cargo check --bin audio_server` — passed.
- `cargo test player::callback --lib` — 31 passed.

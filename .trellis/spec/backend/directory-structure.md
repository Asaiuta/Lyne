# Directory Structure

> How backend code is organized in this project.

---

## Overview

This is a Rust audio engine workspace with a root application/server crate (`audio_engine`) and an optional Tauri desktop frontend. The root crate builds the library (`cdylib` + `rlib`) and the standalone server binary (`audio_server`). Reusable decoder, DSP, resampler, loudness, and pipeline primitives live in `audio-engine-core`, which is now a **separate repository consumed as a pinned git dependency** — not a workspace member and not a directory in this tree.

---

## Directory Layout

```
src/
├── main.rs              # Server binary entry point (actix-web)
├── lib.rs               # Library root - re-exports app modules and core audio API
├── config.rs            # App/server config plus re-exports core DSP config types
├── settings.rs          # PersistentSettings, SettingsManager (JSON file persistence)
├── runtime.rs           # RuntimePaths (data dir, cache, logs, db paths) plus core audio-thread helpers
├── app_database.rs      # AppDatabase (SQLite domain state: sessions, history, queue)
├── webdav.rs            # WebDAV client configuration
├── server/
│   ├── mod.rs           # AppState, route config, helper functions, path security
│   ├── playback.rs      # Playback HTTP handlers (load, play, pause, seek, volume)
│   ├── effects.rs       # DSP effects HTTP handlers (EQ, saturation, crossfeed)
│   ├── settings_handlers.rs  # Settings persistence HTTP handlers
│   ├── webdav_handlers.rs    # WebDAV browse/configure HTTP handlers
│   └── ws_handlers.rs   # WebSocket handlers (spectrum data streaming)
├── player/
│   ├── mod.rs           # AudioPlayer (main thread API, command dispatch)
│   ├── state.rs         # SharedState, AudioCommand, PlayerState, AudioDeviceInfo
│   ├── audio_thread.rs  # Audio thread main loop (cpal output stream)
│   ├── callback.rs      # Lock-free audio callback (DSP chain execution)
│   ├── gapless.rs       # GaplessManager (gapless playback / preloading)
│   └── spectrum.rs      # Spectrum analyzer thread
└── wasapi_output.rs     # Windows WASAPI exclusive mode output (cfg(windows))

crates/
├── audio-runtime-paths/    # Env key constants for app/runtime paths
└── windows-runtime-stage/  # Windows native runtime DLL closure staging

apps/desktop/
├── src-tauri/           # Tauri desktop app wrapper (owns its own Cargo.lock)
└── node_modules/        # Frontend dependencies
```

`audio-engine-core` is not in this tree. It is pinned in `[dependencies]`:

```toml
audio-engine-core = { git = "https://github.com/Asaiuta/audio-engine-core", rev = "af5899886939add755217cc72865ed8426e3d9cc" }
```

A local checkout may exist for reading, and `crates/audio-engine-core` is listed
in workspace `exclude` so a stale directory cannot path-override the pinned git
revision. Never edit the core through this repository.

---

## Module Organization

### Top-level modules in `src/`

- **Single-responsibility files**: Each `.rs` file at the top level handles one domain concern (config, settings, database, etc.)
- **Submodule directories**: Complex app/server domains (`server/`, `player/`) use directory modules with `mod.rs`
- **Conditional compilation**: `wasapi_output.rs` uses `#[cfg(windows)]`

### Core dependency boundary

- **Core crate**: App-agnostic decoder, DSP, resampler, loudness, pipeline, and audio-thread helpers belong in the `audio-engine-core` repository, behind its pinned revision. Changing them is a separate task in that repository followed by a deliberate revision bump here.
- **Root crate**: Keep playback control, HTTP/WebSocket routes, app database, WebDAV/NetEase integrations, settings persistence, runtime paths, remote-fetch credential policy, and desktop glue in `src/`.
- **Adapters**: Application code adapts to the core's current API. Do not add a local shim that re-creates a removed core API; migrate the call sites instead.
- **Re-exports**: The root `src/lib.rs`, `src/config.rs`, `src/diagnostics.rs`, and `src/runtime.rs` re-export core types to preserve the app-facing API. Do not add new compatibility layers unless a current compile boundary requires them.
- **Build scripts**: SoXR link discovery is owned by the core package's own `build.rs`; the root crate must not keep a `build.rs` for core-only native links.
- **Revision bumps**: Migrate sources first and keep the old revision until compatibility is proven. Verify with `cargo metadata --locked --no-deps` and keep the `Cargo.toml` diff limited to the revision.

### Naming conventions

- **Files**: `snake_case.rs` (e.g., `audio_thread.rs`, `lockfree_params.rs`)
- **Modules**: Match file names, declared in parent `mod.rs`
- **Re-exports**: `lib.rs` re-exports key types for external consumers; submodule `mod.rs` re-exports for internal convenience

### Adding a new module

1. Create `src/new_module.rs` (simple) or `src/new_module/mod.rs` + sub-files (complex)
2. Add `pub mod new_module;` to `src/lib.rs`
3. Add re-exports to `src/lib.rs` if the type is part of the public API
4. If it is a reusable DSP processor, it belongs in the `audio-engine-core` repository, not here. Add it there, release a revision, then bump the pin.

---

## Key Patterns

### DSP Processor Structure

Each processor in the core repository's `src/processor/` follows this pattern:
1. Core struct with state (e.g., `Saturation`, `Crossfeed`)
2. `mod.rs` re-exports it
3. A corresponding lock-free params struct in `lockfree_params.rs` (e.g., `AtomicSaturationParams`)
4. A `StreamingProcessor` adapter in `adapters.rs` (e.g., `SaturationProcessor`). Stages valid for fixed in-place 1:1 execution also implement `FixedInPlaceProcessor`, which `DspChain::add` requires.

### Server Handler Structure

Each handler group in `src/server/` follows:
1. `configure_routes()` function that registers `web::resource()` routes
2. Handler functions take `web::Data<Arc<AppState>>` as shared state
3. Request types use `#[derive(Deserialize)]`, response types use `#[derive(Serialize)]`

---

## Examples

- **Well-organized processor**: the core repository's `src/processor/saturation.rs` (core logic) + `lockfree_params.rs` (atomic params) + `adapters.rs` (trait impl)
- **Well-organized server group**: `src/server/playback.rs` (routes + handlers + request/response types)
- **Clean module re-exports**: the core repository's `src/processor/mod.rs` (core processor types) and `src/lib.rs` (root app-facing API)

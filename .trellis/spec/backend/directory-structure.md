# Directory Structure

> How backend code is organized in this project.

---

## Overview

This is a Rust audio engine workspace with a root application/server crate (`audio_engine`), an internal reusable core crate (`audio-engine-core`), and an optional Tauri desktop frontend. The root crate still builds the library (`cdylib` + `rlib`) and standalone server binary (`audio_server`); reusable decoder, DSP, and pipeline primitives live under `crates/audio-engine-core/`.

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
├── audio-engine-core/
│   ├── build.rs         # SoXR link discovery owned by the core package
│   └── src/
│       ├── lib.rs       # Core public surface
│       ├── config.rs    # App-agnostic DSP/resampler/loudness config types
│       ├── diagnostics.rs  # Decode memory budget helpers
│       ├── runtime.rs   # Audio-thread FTZ/DAZ helpers
│       ├── pipeline.rs  # AudioPipeline ring-buffer primitives
│       ├── decoder/     # Symphonia/local/network decode primitives
│       └── processor/   # DSP processors, lock-free params, resampler, loudness DB
└── audio-runtime-paths/ # Env key constants for app/runtime paths

apps/desktop/
├── src-tauri/           # Tauri desktop app wrapper
└── node_modules/        # Frontend dependencies
```

---

## Module Organization

### Top-level modules in `src/`

- **Single-responsibility files**: Each `.rs` file at the top level handles one domain concern (config, settings, database, etc.)
- **Submodule directories**: Complex app/server domains (`server/`, `player/`) use directory modules with `mod.rs`
- **Conditional compilation**: `wasapi_output.rs` uses `#[cfg(windows)]`

### Workspace crate boundary

- **Core crate**: Put app-agnostic decoder, DSP, resampler, loudness, pipeline, and audio-thread helpers in `crates/audio-engine-core/`.
- **Root crate**: Keep playback control, HTTP/WebSocket routes, app database, WebDAV/NetEase integrations, settings persistence, runtime paths, and desktop glue in `src/`.
- **Re-exports**: The root `src/lib.rs`, `src/config.rs`, `src/diagnostics.rs`, and `src/runtime.rs` may re-export core types to preserve the current app-facing API. Do not add new compatibility layers unless a current compile boundary requires them.
- **Build scripts**: SoXR link discovery is owned by `crates/audio-engine-core/build.rs`; the root crate should not keep a `build.rs` for core-only native links.

### Naming conventions

- **Files**: `snake_case.rs` (e.g., `audio_thread.rs`, `lockfree_params.rs`)
- **Modules**: Match file names, declared in parent `mod.rs`
- **Re-exports**: `lib.rs` re-exports key types for external consumers; submodule `mod.rs` re-exports for internal convenience

### Adding a new module

1. Create `src/new_module.rs` (simple) or `src/new_module/mod.rs` + sub-files (complex)
2. Add `pub mod new_module;` to `src/lib.rs`
3. Add re-exports to `src/lib.rs` if the type is part of the public API
4. If it is a reusable DSP processor, add it under `crates/audio-engine-core/src/processor/` and re-export it from that crate's `processor/mod.rs`

---

## Key Patterns

### DSP Processor Structure

Each processor in `crates/audio-engine-core/src/processor/` follows this pattern:
1. Core struct with state (e.g., `Saturation`, `Crossfeed`)
2. `mod.rs` re-exports it
3. A corresponding lock-free params struct in `lockfree_params.rs` (e.g., `AtomicSaturationParams`)
4. An `AudioProcessor` adapter in `adapters.rs` (e.g., `SaturationProcessor`)

### Server Handler Structure

Each handler group in `src/server/` follows:
1. `configure_routes()` function that registers `web::resource()` routes
2. Handler functions take `web::Data<Arc<AppState>>` as shared state
3. Request types use `#[derive(Deserialize)]`, response types use `#[derive(Serialize)]`

---

## Examples

- **Well-organized processor**: `crates/audio-engine-core/src/processor/saturation.rs` (core logic) + `lockfree_params.rs` (atomic params) + `adapters.rs` (trait impl)
- **Well-organized server group**: `src/server/playback.rs` (routes + handlers + request/response types)
- **Clean module re-exports**: `crates/audio-engine-core/src/processor/mod.rs` (core processor types) and `src/lib.rs` (root app-facing API)

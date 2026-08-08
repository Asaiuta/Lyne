# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

This is a real-time audio engine where the audio callback runs on a dedicated thread with strict timing constraints. Code quality directly affects audio stability — a single allocation or lock in the wrong place causes audible glitches.

---

## Forbidden Patterns

### In the audio callback path

These are **hard forbidden** in code that runs inside `audio_callback` (the cpal output callback):

| Pattern | Why | Example of what NOT to do |
|---------|-----|--------------------------|
| Heap allocation | Causes latency spikes | `Vec::new()`, `String::from()`, `Box::new()` |
| Mutex/lock acquisition | Can block the audio thread | `mutex.lock()`, `Mutex::new()` |
| File I/O | Unbounded latency | `File::open()`, `fs::read()` |
| Logging | `log::info!` allocates for formatting | `log::info!("...")` |
| Network I/O | Completely blocks | `reqwest::get()`, `TcpStream` |

Use lock-free atomics (`AtomicF64`, `AtomicBool`) or pre-allocated buffers instead.

### Anywhere in the codebase

| Pattern | Why |
|---------|-----|
| `unwrap()` on `Option`/`Result` in production code | Use `?`, `.unwrap_or()`, or explicit `match` |
| Hardcoded file paths | Use `RuntimePaths` for all paths |
| Hardcoded sample rates | Always derive from device config or file info |
| Duplicate definitions of the same type | Single source of truth (see M-4 fix in config.rs) |
| `unsafe` without `// SAFETY:` comment | Every `unsafe` block must explain why it's safe |
| Re-locking `data.player` while already holding it | `parking_lot::Mutex<AudioPlayer>` is not reentrant; nested helpers can deadlock HTTP handlers while audio keeps playing |

---

## Required Patterns

### Lock-free parameter passing to audio thread

All DSP parameters must use the lock-free atomic pattern:

```rust
// Main thread writes
self.lockfree_saturation_params.set_drive(0.5);

// Audio thread reads (in callback)
let snapshot = lockfree_saturation_params.read();
if snapshot.enabled {
    // Apply DSP with snapshot values
}
```

See `src/processor/lockfree_params.rs` for the pattern.

### Config validation with `.clamp()`

All user-facing numeric parameters must be clamped:

```rust
// CORRECT
let target_lufs = env::var("AUDIO_TARGET_LUFS")
    .ok()
    .and_then(|s| s.parse::<f64>().ok())
    .unwrap_or(-12.0)
    .clamp(-30.0, -6.0);
```

### Error context in `.map_err()`

Every error must include what operation failed and relevant context:

```rust
// CORRECT
.map_err(|e| format!("Failed to open loudness database '{}': {}", path, e))?;
```

### Windows native runtime dependency closure

#### 1. Scope / Trigger

Apply this contract whenever a Windows executable or DLL depends on a
non-system native runtime, including sidecars, benches, release bundles, and
new consumers of `libsoxr.dll`. A successful Cargo launch is not proof that the
artifact is self-contained: Cargo may inject `target/<profile>/deps` into the
child environment and hide missing sibling DLLs.

#### 2. Signatures

The canonical implementation is the std-only `windows-runtime-stage` crate:

```rust
pub fn stage_binary_runtime(
    binary: &Path,
    plan: &StagePlan,
) -> Result<StageReport, StageError>;

pub fn stage_named_runtime(
    names: &[&str],
    plan: &StagePlan,
) -> Result<StageReport, StageError>;
```

Its CLI contract is:

```powershell
cargo run --quiet `
  --manifest-path crates/windows-runtime-stage/Cargo.toml `
  --bin stage-windows-runtime -- `
  --target-dir <target-dir> `
  --profile <profile> `
  [--root <linked-pe-file>]
```

`build.rs` and `scripts/stage-soxr-runtime.ps1` must remain thin callers.
`apps/desktop/scripts/build-sidecar.mjs` must invoke `--root` after linking the
actual `audio_server.exe`; that post-link scan is the authoritative closure
check.

#### 3. Contracts

| Input / output | Contract |
|------|------|
| `CARGO_TARGET_DIR` / `--target-dir` | Selects the target tree; never assume the repository default when an override is present |
| `SOXR_RUNTIME_DIR` | Optional highest-priority native runtime search directory |
| Search candidates | Resolve imports case-insensitively from the importing file's directory and ordered configured search directories |
| PE imports | Traverse every non-system import transitively; a candidate is valid only when its complete closure resolves |
| Copy behavior | Compare file contents, not only name or length, before deciding a destination is current |
| Development destinations | Stage beside the executable and into the profile `deps` directory |
| Bundle destination | Stage all runtime DLLs in `target/<profile>/sidecar-runtime` |
| Tauri release resources | Flatten `audio_server.exe` and `sidecar-runtime/*.dll` into the same installed resource directory |

The process `PATH` is a discovery input during staging, not a supported runtime
dependency. A directly launched staged executable must load its non-system DLLs
from its own directory.

#### 4. Validation & Error Matrix

| Condition | Required behavior |
|------|------|
| Root PE file does not exist or is not valid PE | Fail with the root path and parsing context |
| Named runtime has several candidates | Try candidates in order until one complete transitive closure resolves |
| A non-system DLL is unresolved | Fail with the importing PE name, missing DLL, and searched directories |
| A staged file has the same length but different content | Replace it |
| Post-link closure verification fails | Fail the sidecar build; do not start Tauri or create a bundle |
| Release DLL is outside the flattened resource directory | Treat bundle layout as invalid even when development launch succeeds |

#### 5. Good/Base/Bad Cases

- Good: `audio_server.exe`, `libsoxr.dll`, `libgomp-1.dll`,
  `libgcc_s_seh-1.dll`, and `libwinpthread-1.dll` are colocated, and the
  executable reaches `/state` with a system-only `PATH`.
- Base: a static native build has no non-system imports; the closure contains
  only the linked root and needs no extra DLL copy.
- Bad: copy only `libsoxr.dll`, then accept a Cargo-launched smoke test that
  silently loads its MinGW dependencies from `target/debug/deps`.

#### 6. Tests Required

- Unit-test recursive import resolution, case-insensitive lookup, complete
  candidate fallback, missing-transitive-import diagnostics, and
  same-size/different-content replacement in `windows-runtime-stage`.
- Run `cargo test -p windows-runtime-stage` and
  `cargo check --workspace --all-targets` after changing staging behavior.
- Run both development and release sidecar builds so the authoritative
  post-link root is checked in each output profile.
- Launch a copied/staged sidecar with a Windows-system-only `PATH`, assert an
  authenticated or expected unauthenticated HTTP response, and verify loaded
  non-system modules resolve beside the executable.
- In a task-local copy, remove one transitive DLL and assert staging fails with
  the importer and missing DLL. Do not mutate the live profile to create this
  negative test.

#### 7. Wrong vs Correct

#### Wrong

```powershell
Copy-Item libsoxr.dll target/audio-dev
# Assume success because `cargo run` happened to launch the sidecar.
```

#### Correct

```powershell
cargo run --quiet `
  --manifest-path crates/windows-runtime-stage/Cargo.toml `
  --bin stage-windows-runtime -- `
  --target-dir target `
  --profile audio-dev `
  --root target/audio-dev/audio_server.exe
```

This verifies the imports of the linked executable and stages the complete
non-system closure before runtime.

### Path validation for user-provided paths

Use `validate_path()` from `server/mod.rs` for all file paths from HTTP requests:

```rust
let safe_path = validate_path(&request.path)?;
```

### Local library disk delete contract

#### 1. Scope / Trigger

Use this contract for any user-facing action that deletes a media file from local disk. It is stricter than playback path validation because the operation is destructive.

#### 2. Signatures

```http
POST /domain/media_items/delete_file
{ "media_id": "<media_items.media_id>" }
```

The frontend must call the authenticated sidecar API by `media_id`. Do not expose a Tauri command that accepts an arbitrary filesystem path for deletion.

#### 3. Contracts

| Boundary | Contract |
|------|------|
| Frontend input | Send the selected library item's `media_id`, not `source_path` |
| DB lookup | Resolve the media row server-side and require `source_kind == "local"` |
| Root authority | Load configured `library_roots` and use only roots with `source_kind == "local"` |
| Filesystem check | Canonicalize the target and containing root before deletion |
| Successful delete | Delete the disk file, then remove the media row from the library index |

#### 4. Validation & Error Matrix

| Condition | Response |
|------|------|
| Empty `media_id` | 400 |
| Media item not found | 404 |
| Remote/WebDAV media item | 400 |
| Relative path, URL, UNC path, directory, or symbolic link | 400 |
| File outside configured local library roots | 400 |
| Filesystem or database failure | 500 with context |

#### 5. Good/Base/Bad Cases

- Good: A local media row under a configured music root is deleted from disk and removed from `media_items`.
- Base: "Delete from library" continues to use `/domain/media_items/delete` and does not touch disk.
- Bad: A renderer or Tauri command accepts `{ path: "C:\\..." }` and calls `remove_file` directly.

#### 6. Tests Required

- Unit-test canonical root containment for allowed files and outside-root files.
- Unit-test rejection of directories, remote URLs, and non-local roots.
- Test symlink rejection where the platform can create symlinks without elevated privileges.
- Run `cargo test server::playback::library_domain_handlers` after changing this path.

#### 7. Wrong vs Correct

#### Wrong

```rust
#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    std::fs::remove_file(path).map_err(|e| e.to_string())
}
```

#### Correct

```rust
let item = app_db.media_metadata_for_path(&media_id)?.ok_or("not found")?;
ensure_local_library_delete_target(&item.source_path, &app_db.list_library_roots()?)?;
std::fs::remove_file(canonical_target)?;
app_db.delete_media_items(&[item.media_id])?;
```

### Player mutex lock boundary

HTTP handlers that need `AudioPlayer` state must keep the `data.player.lock()` scope small. If a helper needs queue snapshot/event state after touching the player, capture `Arc<SharedState>` inside the lock and call a `_from_shared` helper after the lock drops:

```rust
let (state_response, shared_state) = {
    let mut player = data.player.lock();
    player.load_with_credentials_and_autoplay(&path, credentials.as_ref())?;
    (get_player_state(&player), player.shared_state())
};

sync_queue_snapshot_from_shared(&data, &shared_state);
```

Do not call helpers that acquire `data.player.lock()` from inside an existing player lock scope. This can make `/domain/queue/play` or `/load` never return even though the audio thread already received the play command, which in turn blocks seek, volume, skip, and state refresh requests behind the same mutex.

### Async playback generation guards

Explicit track loads and gapless preloads run on background threads. A newer user action can supersede an older background job before that older job finishes. Older jobs must not be allowed to replace `audio_buffer`, `file_path`, `track_metadata`, `current_track_path`, pending gapless state, or playback error state.

#### Signatures

```rust
pub enum AudioCommand {
    LoadComplete { generation: u64, result: LoadResult },
    LoadError { generation: u64, message: String },
}

pub struct SharedState {
    pub load_generation: AtomicU64,
    pub preload_generation: AtomicU64,
}
```

#### Contracts

| Case | Expected behavior |
|------|-------------------|
| Starting `load_with_credentials_inner()` | Increment `load_generation`, capture the returned generation in the decode thread |
| Decode thread completes | Send `AudioCommand::LoadComplete { generation, result }` |
| Audio thread receives load result | Apply it only when `shared_state.load_generation == generation`; otherwise log and ignore |
| Decode thread fails | Update `load_error` and send `LoadError` only for the current generation |
| Starting gapless preload | Increment `preload_generation`, capture it in the preload thread |
| Cancelling preload | Increment `preload_generation`, set `cancel_preload_signal`, clear pending buffer/path/metadata/readiness and `gapless_swap_pending` |
| Preload thread completes after cancellation or newer preload | Discard without touching pending state |
| Audio callback performs gapless swap | Set `gapless_swap_pending=true` before publishing `EVENT_TRACK_CHANGED` so WebSocket handlers never observe a half-swapped track |

#### Wrong

```rust
let _ = cmd_tx.send(AudioCommand::LoadComplete(load_result));
shared.pending_buffer.store(Some(Arc::new(samples)));
```

#### Correct

```rust
let generation = shared.load_generation.fetch_add(1, Ordering::AcqRel) + 1;
let _ = cmd_tx.send(AudioCommand::LoadComplete { generation, result });

if shared.preload_generation.load(Ordering::Acquire) != generation {
    return;
}
shared.pending_buffer.store(Some(Arc::new(samples)));
```

#### Tests required

- Cancelling preload invalidates the generation and clears all pending playback metadata/state.
- `cargo check` must pass after changing `AudioCommand`, because both normal and WASAPI audio loops must handle every command shape.

### Streaming PCM-window contract

Use one preallocated absolute-frame PCM window for every streaming-first-buffer
session. The window is the only production streaming PCM transport; do not add
an allocated chunk queue, retention ring, replay prefix, or duplicate full
buffer promotion path.

- The active session owns one persistent producer, decoder, opened source,
  memory reservation, window, realtime view, and cold telemetry plane.
- The producer writes directly from reused decode/resample scratch into claimed
  window slots. Steady-state slot publication must not allocate.
- The callback may only claim bounded slot spans, copy into preallocated scratch,
  run DSP/output conversion, and publish atomics. It must not allocate, lock,
  log, perform I/O, wake the producer, or destroy PCM ownership.
- Resident forward and backward seeks only change the callback cursor after exact
  epoch/sequence validation. They must not issue decoder, file, or network work.
- Out-of-window seeks use the existing producer and decoder through the
  latest-wins source-seek mailbox. Ordinary seeks must not spawn a worker or
  reopen/probe the source.
- EOF parks the producer so a later source seek can reuse the same session.
  Ready/EOF publication must recheck cancellation and newer seek serials before
  activating an epoch.
- All decoded PCM capacity, slot metadata, staging, resampler carry, current and
  pending buffers must hold an RAII reservation from the process-wide decoded
  memory ledger before allocation.
- Streaming diagnostics live under the nested `streaming_v2` object and report
  window geometry/residency, seek outcomes/latency, source seeks, worker
  lifecycle, shortfalls, and memory ownership. Do not expose queue-era fields.
- Gapless pending full buffers may remain as a compatibility path, but they use
  the same memory ledger and must not become a second streaming transport.

Required validation includes exact first audible frame after resident and source
seeks, paused backward protection, latest-wins races, Ready/EOF reuse, remote
resident zero-request behavior, allocation-free callback checks, and callback,
window-seek, and source-seek performance benchmarks.

### CPAL output stream recovery contract

#### 1. Scope / Trigger

Use this contract when changing shared-mode CPAL stream reuse, stop-for-load,
or playback recovery after a missing first callback/progress watchdog.

#### 2. Signatures

```rust
pub enum AudioCommand {
    EnsurePlaybackProgress { generation: u64, replay_attempted: bool },
}

pub(crate) const PLAYBACK_PROGRESS_AFTER_PLAY_GRACE_MS: u64 = 300;
pub(crate) const PLAYBACK_PROGRESS_REPLAY_GRACE_MS: u64 = 150;
pub(crate) const PLAYBACK_PROGRESS_REPLAY_COMMAND_GRACE_MS: u64 = 250;

pub struct SharedState {
    pub active_stream_source_sample_rate: AtomicU64,
    pub active_stream_output_sample_rate: AtomicU64,
    pub active_stream_channels: AtomicU64,
    pub active_stream_running: AtomicBool,
    pub parked_output_stream_count: AtomicU64,
    pub parked_output_stream_release_count: AtomicU64,
    pub output_callback_after_play_ms: AtomicU64,
    pub playback_progress_generation: AtomicU64,
}
```

#### 3. Contracts

| Field / path | Contract |
|------|------|
| Active stream key | Must match current source sample rate, channels, device, exclusive mode, and default-config preference before warm reuse |
| `StopForLoad` in compatible shared mode | Keeps the stream warm and lets callback output silence while the next track becomes ready |
| Streaming progress watchdog | Should observe generation/progress state before sending `EnsurePlaybackProgress`; do not send the command while stream play has not returned or while the post-play callback grace window is still open |
| First missing-progress check | Sends `EnsurePlaybackProgress { replay_attempted: false }` after the normal grace. If the active stream is already marked running and still produced no heartbeat, rebuild immediately; otherwise replay the warm output stream once before rebuilding |
| Replay confirmation check | Sends `EnsurePlaybackProgress { replay_attempted: true }` only after the replay command has had a bounded chance to reset `stream_play_returned_ms`, then waits `PLAYBACK_PROGRESS_REPLAY_GRACE_MS` for callback/progress |
| `playback_progress_generation` | Records that the current load generation has produced callback or position progress; unlike one-shot first-play timestamps, it must survive later resume/play marker resets |
| `output_callback_after_play_ms` | Records current-generation callback heartbeat before audio gates. It is not playback progress, but it proves the output callback is alive, so output-stream recovery must not rebuild solely because position has not advanced yet |
| `EnsurePlaybackProgress` | Must ignore stale generations, non-playing states, already-progressed playback by timestamp or `playback_progress_generation`, missing `stream_play_returned_ms`, and play-returned states still inside `PLAYBACK_PROGRESS_AFTER_PLAY_GRACE_MS` |
| Recovery rebuild | Must remove the old stream from the active slot before building a replacement |
| Parked streams | May be held by the audio thread during active playback; expose count through diagnostics |
| Parked stream release | Release only after playback is not active or when the audio thread exits |

#### 4. Validation & Error Matrix

| Condition | Expected behavior |
|------|------|
| Warm stream matches current output key and is running | Reuse it and mark playback started |
| Warm stream matches but is paused | Call `play()`, mark it running, and reuse it |
| Warm stream does not match current output key | Release it before building a new stream |
| Watchdog observes no `stream_play_returned_ms` | Keep observing until the bounded observe window expires; do not rebuild before play has returned |
| Watchdog observes `stream_play_returned_ms` but callback grace has not elapsed | Keep observing; do not rebuild inside the grace window |
| Watchdog first fires after play returned, callback grace elapsed, no callback/progress exists, and the stream is already marked running | Park the old active stream, clear active stream diagnostics, increment recovery, then rebuild without replay |
| Watchdog first fires after play returned, callback grace elapsed, no callback/progress exists, and the stream is not marked running | Replay the compatible warm stream once, reset play timing, and do not increment recovery if progress resumes |
| Watchdog confirmation fires after replay and still no callback/progress exists | Park the old active stream, clear active stream diagnostics, increment recovery, then rebuild |
| Watchdog wakes after later resume/play reset first-callback timestamps but `playback_progress_generation` matches | Do nothing; the load generation already proved progress |
| Watchdog observes current-generation `output_callback_after_play_ms` but no position progress | Do not rebuild the output stream; the callback is alive, so the stall belongs to buffering/state/progress diagnostics instead of CPAL recovery |
| Watchdog fires for stale generation, paused/stopped playback, or after progress | Do nothing |
| Parked stream exists while playback is active | Keep it parked; do not drop it in the active command window |
| Playback becomes inactive or thread exits | Release parked streams and increment release diagnostics |

#### 5. Good/Base/Bad Cases

- Good: A streaming load starts on a warm compatible shared stream without
  rebuilding CPAL output.
- Good: A delayed watchdog for an already-progressed load does not rebuild just
  because a later resume/play command reset `first_callback_after_play` and
  `first_position_advanced`.
- Good: If the warm stream stops producing callbacks, recovery parks the old
  stream and starts a fresh output stream without blocking the command thread on
  CPAL drop.
- Base: Exclusive WASAPI remains owned by the WASAPI backend and does not use
  the CPAL parked-stream path.
- Bad: Dropping or pausing old CPAL streams while active playback commands are
  still running can reintroduce seek/load progress timeouts.

#### 6. Tests Required

- Command handler tests must cover recovery flow and warm stream matching.
- Command handler tests must cover stale, progressed, waiting-for-play,
  waiting-for-callback-grace, and real-stuck recovery decisions.
- Command handler tests must cover already-running stalled streams rebuilding
  without replay while non-running streams still replay first.
- Loading tests must cover the streaming watchdog observer stopping for stale,
  paused, and progressed loads, waiting while stream play has not returned, and
  sending only after the post-play grace window elapses.
- State, command handler, and loading tests must cover generation-level progress
  surviving a later `mark_stream_play_returned()` reset.
- Command handler and loading tests must cover current-generation output callback
  heartbeat suppressing output-stream recovery without marking playback progress.
- Runtime diagnostics must expose active stream key, recovery counters, and
  parked stream counters, including `playback_progress_generation` and callback
  heartbeat/silence counters.
- Real-file stress should cover repeated load/resume/seek with
  `AUDIO_STREAMING_FIRST_BUFFER=true` and memory-mode streaming.
- `cargo check --bin audio_server`, `cargo test --lib`, and a release real-file
  benchmark must pass after changing this path.

#### 7. Wrong vs Correct

#### Wrong

```rust
fn recover_playback(&mut self, shared_state: &SharedState) -> AudioCommandFlow {
    release_output_stream(self.stream, shared_state);
    AudioCommandFlow::StartPlayback
}
```

This can block the command thread on CPAL stream drop before the replacement
stream reaches `output_prepare_started`.

#### Correct

```rust
fn recover_playback(&mut self, shared_state: &SharedState) -> AudioCommandFlow {
    park_output_stream_for_recovery(self.stream, self.parked_streams, shared_state);
    AudioCommandFlow::StartPlayback
}
```

The replacement stream is built first; parked streams are released only after
playback is inactive or the audio thread exits.

---

## Testing Requirements

### Unit tests

- Each `processor/` module should have `#[cfg(test)] mod tests`
- Use `AppDatabase::in_memory()` for database tests
- Use `assert!((value - expected).abs() < 1e-10)` for floating-point comparisons

### What to test

- DSP processor enable/disable/bypass behavior
- Database CRUD operations (create, read, update, delete)
- Config parsing and validation (clamping, defaults)
- Path security validation

### Test structure

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_feature_name() {
        // Arrange
        let mut proc = MyProcessor::new();

        // Act
        let result = proc.process(&mut buffer, 2);

        // Assert
        assert_eq!(result, ProcessResult::Ok);
    }
}
```

---

## Code Review Checklist

- [ ] No allocations in audio callback path
- [ ] No mutex/lock in audio callback path
- [ ] All numeric user inputs are clamped
- [ ] All errors have context (`.map_err()` with description)
- [ ] Lock-free params used for audio thread communication
- [ ] Server handlers do not re-enter `data.player.lock()` via helper calls
- [ ] No duplicate type definitions (check `config.rs` and `processor/` for conflicts)
- [ ] `#[cfg(windows)]` used for Windows-specific code
- [ ] Tests exist for new DSP processors or database operations
- [ ] `validate_path()` used for any user-provided file paths

---

## Concurrency Model

| Component | Thread | Synchronization |
|-----------|--------|-----------------|
| Server handlers | actix-web async workers | `Mutex<AudioPlayer>` (parking_lot) |
| Audio callback | Dedicated cpal thread | Lock-free atomics only |
| Spectrum analyzer | Dedicated thread | `crossbeam::channel` |
| Background analysis | Tokio `spawn_blocking` | `Semaphore` for concurrency limit |
| Shared state | Any | `Arc<T>` for sharing, `Mutex<T>` for mutation |

---

## Realtime benchmark gate contract

Canonical realtime benches (`audio_callback_chain_perf`, `audio_callback_output_path_perf`,
`audio_resampler_streaming_perf`, `audio_spectrum_handoff_perf`) follow the shared
gate contract in `src/bench_gate.rs` (PERF-001 remediation):

- **Report** (no flag): complete measurements, no verdict, never fails on timing.
- **`--check`**: deterministic integrity (finite/positive/non-empty); failure = exit 3.
  `--enforce` is a deprecated alias of `--check`.
- **`--gate`**: budget gate against `benches/gate-specs/<bench>.gate.json`
  (override with `--gate-spec <path>`). Exit 0 passed, 1 budget failed,
  2 unsupported env / misconfigured spec, 3 integrity failed.
- Budget verdicts are host-sensitive: the spec's `environment.class` must match
  `BENCH_GATE_ENV_CLASS`; a mismatched host is `unsupported` (exit 2), never passed.
- `--gate-self-test` runs canned pass/fail/unsupported verdicts without measuring.
- Machine-readable verdicts: stdout line `bench_gate verdict=<v> bench=.. mode=.. reason=..`;
  `audio_callback_output_path_perf --report <path>` embeds a `gate` object
  `{mode, verdict, reason, exit_code}` in the JSON report.
- Lyne latency benchmark folds enabled stability/control sub-gates into
  `summary.pass` with `failure_reasons`; `pipeline-v2-playback-matrix.cjs`
  classifies sub-gate failures as failed rows.

Gate specs must declare measurable budgets (`metrics`) and a budget provenance;
specs with empty metrics are rejected. Do not label report-only runs as gates:
"the command proves reachability, not regression protection" unless run with
an approved-env gate spec.

## Performance artifact provenance contract (PERF-005)

Every machine-readable performance artifact (Rust bench JSON, Electron/Lyne
report JSON, Tauri `launch-meta.json`) carries a versioned provenance block:

- **Location**: Rust `src/bench_provenance.rs` · Node
  `apps/desktop/scripts/provenance-utils.cjs` — implementations MUST stay field-
  and semantics-identical; cross-family fingerprints are computed over the
  same normalized `git status --porcelain` lines (CRLF-stripped, sorted).
- **Schema**: `schemaVersion: 1` with `source {gitHead, dirty, dirtyFingerprint,
  branch}`, `build {profile, toolchain, binary{path, sha256}}`, `host {os, arch,
  cpuClass}`, `fixtures[{name, sha256}]`, `runtime` (Node-only, null in Rust),
  `workload`, `attribution`. Additive evolution only: new fields may be added;
  existing field VALUES must not change meaning within a schema version.
- **Privacy**: `dirtyFingerprint` is a SHA-256 over normalized porcelain lines —
  a hash, never an embedded path list. File paths are recorded repo-relative
  only. No tokens, credentials, or unrestricted user paths in artifacts.
- **Comparability**: two artifacts are comparable only when schemaVersion,
  `gitHead`, and `dirtyFingerprint` all match (plus, when present, host
  os/arch, binary SHA-256, and same-named fixture hashes). Same `gitHead` but
  different `dirtyFingerprint` → `dirty-tree-differs` → incomparable.
  `compareProvenance` (Rust + Node) implements this; do not hand-roll.
- **Writing**: every report writer calls `attachReportProvenance(report,
  {...})` (or `bench_provenance::collect` in Rust) before writing; Tauri
  launcher merges `provenance-utils.cjs --emit-git-fields` output into
  `launch-meta.json`.
- Legacy `generated_at` fields are frozen and left untouched.

---

## Dependencies

| Crate | Purpose | When to use |
|-------|---------|-------------|
| `parking_lot` | Mutex/RwLock | All mutex needs (faster than std, no poisoning) |
| `crossbeam` | Channels, scoped threads | Thread communication |
| `atomic_float` | Atomic f64/f32 | Lock-free float sharing |
| `arc-swap` | Lock-free Arc swapping | Large buffer swapping |
| `thiserror` | Error enums | When structured error variants needed |
| `serde` / `serde_json` | Serialization | All JSON handling |
| `rusqlite` | SQLite | All database operations |
| `log` | Logging facade | All logging (use `log::info!`, `log::warn!`, etc.) |

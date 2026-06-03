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

### Path validation for user-provided paths

Use `validate_path()` from `server/mod.rs` for all file paths from HTTP requests:

```rust
let safe_path = validate_path(&request.path)?;
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

### Streaming first-buffer playback queue contract

#### 1. Scope / Trigger

Use this contract when adding or changing a playback path that starts output
before the complete decoded buffer is available.

#### 2. Signatures

```rust
pub enum AudioCommand {
    StreamingLoadReady { generation: u64, track: StreamingTrackStart, autoplay: bool },
    StreamingLoadFinished { generation: u64, samples: Option<Vec<f64>>, total_frames: u64 },
}

pub struct SharedState {
    pub streaming_chunks: ArrayQueue<StreamingAudioChunk>,
    pub streaming_active: AtomicBool,
    pub streaming_decode_finished: AtomicBool,
    pub streaming_generation: AtomicU64,
}
```

#### 3. Contracts

| Field / flag | Contract |
|------|------|
| `AUDIO_STREAMING_FIRST_BUFFER` | Must default to false unless explicitly enabled |
| `AUDIO_STREAMING_FULL_BUFFER_LIMIT_MIB` | Caps full decoded PCM publication for streaming first-buffer loads; default is memory-bounded but small-track compatible |
| `StreamingLoadReady.autoplay` | Carries the load-time autoplay intent because `StopForLoad` can temporarily set `state=Stopped` before streaming ready applies |
| `StreamingLoadReady` | May start playback after the first chunk threshold, before full decode finishes; start exactly once from the ready handler when `autoplay=true` unless the current state is explicitly `Paused` |
| `streaming_chunks` | In full-buffer mode it is a bounded startup aid; in memory mode it is the sequential playback source and chunks must not be dropped |
| `StreamingLoadFinished` with `Some(samples)` | Publishes the full `audio_buffer` without resetting `position_frames`, clears the streaming queue, and switches playback back to `audio_buffer` |
| `StreamingLoadFinished` with `None` | Marks decode finished for memory mode without clearing the queue; the callback drains queued chunks and stops at EOF |
| Unknown decoded size | Treat unknown `total_frames` / overflowed size estimates as memory mode, not as a small publishable buffer |
| Generation checks | Ready/finish/chunks must be ignored when `load_generation != generation` |

#### 4. Validation & Error Matrix

| Condition | Expected behavior |
|------|------|
| Queue full while producer is still decoding in full-buffer mode | Drop later streaming chunks and keep decoding into the full buffer |
| Queue full while producer is still decoding in memory mode | Producer waits with cancel/generation checks; chunks must not be dropped |
| Queue empty before decode finishes | Callback writes silence and increments underrun diagnostics |
| Decode finishes while streaming is active | Store full buffer, mark `streaming_decode_finished`, clear queue, and set `streaming_active=false` |
| Memory-mode decode finishes while streaming is active | Mark `streaming_decode_finished` and keep `streaming_active=true` until queued chunks drain |
| Stale ready/finish command | Do not change current track state, buffer, or event flags |
| Ready command has `autoplay=true` after `StopForLoad` set `state=Stopped` | Treat the load as autoplay and start output from the ready handler |
| Ready command has `autoplay=true` after a user pause set `state=Paused` | Respect the pause and skip starting output |
| Stale queued chunk in callback | Discard it before deciding whether streaming can continue |

#### 5. Good/Base/Bad Cases

- Good: A local-file autoplay path queues enough chunks to start, keeps full decode
  running independently, then publishes the full buffer within the same load
  generation.
- Good: A large decoded-output local file enters memory mode, uses bounded
  backpressure instead of accumulating a full `Vec<f64>`, and plays through the
  queue without publishing a full buffer.
- Base: If streaming is disabled, the existing `LoadComplete` full-buffer path
  remains unchanged.
- Bad: Blocking the producer on a full playback queue paces full decode by audio
  playback speed and leaves `streaming_finished` unavailable for seconds.
  This is only acceptable for explicit memory mode, where the queue is the
  playback source and the goal is bounded memory rather than early full decode.

#### 6. Tests Required

- Callback consumes a current-generation streaming chunk and advances
  `position_frames` while `audio_buffer` is still empty.
- Empty queue before decode finish records underrun silence.
- Finished decode with empty or stale queue falls back to full `audio_buffer`
  in the same callback.
- Stale ready/finish commands do not publish stale state.
- Streaming ready autoplay starts even when `StopForLoad` left the state
  temporarily stopped.
- Streaming ready autoplay respects an explicit paused state.
- Fresh full-buffer finish publishes the full buffer without resetting
  `position_frames` and drains `streaming_chunks`.
- Fresh memory-mode finish does not replace `audio_buffer`, does not clear
  `streaming_chunks`, and lets the callback stop at EOF after the queue drains.
- `cargo check --bin audio_server` and `cargo test --lib` must pass after
  changing `AudioCommand`.

#### 7. Wrong vs Correct

#### Wrong for full-buffer mode

```rust
while shared.streaming_chunks.push(chunk).is_err() {
    std::thread::sleep(Duration::from_millis(2));
}
```

This blocks full decode on playback progress.

#### Correct for full-buffer mode

```rust
if shared.streaming_chunks.push(chunk).is_err() {
    // Keep decoding into the full buffer; queued chunks are only a startup aid.
}
```

#### Correct for memory mode

```rust
while let Err(returned) = shared.streaming_chunks.push(chunk) {
    chunk = returned;
    ensure_load_is_still_current()?;
    std::thread::sleep(STREAMING_QUEUE_BACKPRESSURE_SLEEP);
}
```

In memory mode the queue is the playback source of truth, so producer chunks
must use bounded backpressure instead of being dropped.

### CPAL output stream recovery contract

#### 1. Scope / Trigger

Use this contract when changing shared-mode CPAL stream reuse, stop-for-load,
or playback recovery after a missing first callback/progress watchdog.

#### 2. Signatures

```rust
pub enum AudioCommand {
    EnsurePlaybackProgress { generation: u64 },
}

pub(crate) const PLAYBACK_PROGRESS_AFTER_PLAY_GRACE_MS: u64 = 500;

pub struct SharedState {
    pub active_stream_source_sample_rate: AtomicU64,
    pub active_stream_output_sample_rate: AtomicU64,
    pub active_stream_channels: AtomicU64,
    pub active_stream_running: AtomicBool,
    pub parked_output_stream_count: AtomicU64,
    pub parked_output_stream_release_count: AtomicU64,
}
```

#### 3. Contracts

| Field / path | Contract |
|------|------|
| Active stream key | Must match current source sample rate, channels, device, exclusive mode, and default-config preference before warm reuse |
| `StopForLoad` in compatible shared mode | Keeps the stream warm and lets callback output silence while the next track becomes ready |
| Streaming progress watchdog | Should observe generation/progress state before sending `EnsurePlaybackProgress`; do not send the command while stream play has not returned or while the post-play callback grace window is still open |
| `EnsurePlaybackProgress` | Must ignore stale generations, non-playing states, already-progressed playback, missing `stream_play_returned_ms`, and play-returned states still inside `PLAYBACK_PROGRESS_AFTER_PLAY_GRACE_MS` |
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
| Watchdog fires after play returned, callback grace elapsed, and no callback/progress exists | Park the old active stream, clear active stream diagnostics, then rebuild |
| Watchdog fires for stale generation, paused/stopped playback, or after progress | Do nothing |
| Parked stream exists while playback is active | Keep it parked; do not drop it in the active command window |
| Playback becomes inactive or thread exits | Release parked streams and increment release diagnostics |

#### 5. Good/Base/Bad Cases

- Good: A streaming load starts on a warm compatible shared stream without
  rebuilding CPAL output.
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
- Loading tests must cover the streaming watchdog observer stopping for stale,
  paused, and progressed loads, waiting while stream play has not returned, and
  sending only after the post-play grace window elapses.
- Runtime diagnostics must expose active stream key, recovery counters, and
  parked stream counters.
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

# Design: single-writer audio settings control plane

## 1. Design objectives

The design separates three concepts that the current code conflates:

1. **Desired settings** — validated user intent that has been durably committed.
2. **Effective settings** — values the active decoder/DSP/output path is actually using.
3. **Preview overlay** — temporary runtime values owned by a UI interaction session.

The control plane may use locks and perform I/O. The real-time path remains lock-free and receives only bounded atomic updates or versioned control-thread commands.

## 2. Ownership model

`AudioSettingsCoordinator` lives in backend application state and owns:

- the last committed `desired` snapshot;
- the last known `effective` snapshot and apply status;
- global `revision` plus per-field/group `last_changed_revision` metadata;
- active preview sessions and their latest sequence numbers;
- access to the durable `SettingsManager` repository;
- typed runtime applicators for player, decoder, DSP atomics, and output-thread commands.

The coordinator is serialized through a command queue or one async mutex around short control-plane state transitions. The selected mechanism must not be held while executing an audio callback. HTTP handlers are adapters only.

The resulting write path is:

```text
PlayerBar / Settings UI
          ↓ typed Preview | Commit | Cancel
AudioSettingsCoordinator (single writer + revision)
          ├─→ atomic settings.json repository (desired)
          └─→ typed runtime applicators (effective / status)
                    ├─ live DSP atomics
                    ├─ next-track decoder snapshot
                    └─ output control-thread rebuild command
```

## 3. Data contracts

Illustrative Rust model (exact names may follow existing conventions):

```rust
struct AudioSettingsSnapshot {
    revision: u64,
    state_revision: u64,
    desired: EngineSettings,
    effective: EffectiveAudioSettings,
    apply_status: AudioSettingsApplyStatus,
}

enum ApplyDisposition {
    Applied,
    NextTrack,
    RestartOutput,
    Failed { code: ApplyErrorCode, message: String },
}

struct CommitAudioSettings {
    base_revision: u64,
    patch: EngineSettingsPatch,
    preview_session_id: Option<Uuid>,
}

struct PreviewAudioSettings {
    session_id: Uuid,
    seq: u64,
    patch: PreviewableSettingsPatch,
}
```

`revision` orders durable desired-state commits. `state_revision` orders every
observable snapshot mutation, including previews, cancellation, expiry, and
commits. Both are required because two snapshots can share a committed revision
while carrying different effective preview overlays.

`EngineSettingsPatch` must use an explicit tri-state representation for nullable fields. An absent field means “leave unchanged”; JSON `null` means “clear”; a value means “set”. Do not rely on plain `Option<Option<T>>` without a proven custom deserializer and round-trip tests.

Per-field revision tracking is preferred over rejecting every globally stale request:

- if no field in the incoming patch changed after `base_revision`, merge the patch into the latest desired snapshot;
- if any patched field changed, return HTTP 409 with the current snapshot and conflicting field names;
- nested groups use stable logical paths (for example `dither.enabled`, `dither.bits`) so unrelated edits can merge.

## 4. Field application classes

The exact mapping must be verified against the audio-core APIs during phase 0. The intended classification is:

| Class | Typical fields | Application path | Reported status |
|---|---|---|---|
| Live | volume, EQ bands/enabled mode, saturation, crossfeed, dynamic loudness, compatible dither toggles | existing lock-free atomics or bounded DSP control command | `applied` after actuator acknowledgement/readback |
| Next track/decode | target sample rate, resample quality, cache/preemptive resampling, streaming window/prefetch policy | replace a versioned decoder/runtime config snapshot consumed at load/session creation | `next_track` until a decoder acknowledges the revision |
| Output rebuild | device, exclusive mode, output bit depth or fields tied to stream format | audio control-thread command; rebuild outside callback and acknowledge success/failure | `restart_output`, then `applied` on acknowledgement |
| App restart | only fields proven impossible to refresh safely | persist desired and expose the limitation explicitly | dedicated restart-required status if one is needed |

Atomics and audio-thread copies are actuators/caches, never authorities. API reads come from the coordinator snapshot, with actuator acknowledgements updating `effective`.

## 5. Commit transaction and failure semantics

Commit processing is ordered as follows:

1. Validate patch shape, ranges, cross-field invariants, base revision, and conflicts.
2. Merge into the latest desired snapshot to produce a candidate.
3. Serialize and atomically persist the complete candidate to a temp file in the same directory, flush it, and replace the target.
4. Only after persistence succeeds, publish the new desired snapshot and increment revision.
5. Remove or bind any matching preview overlay to the committed revision.
6. Apply changed fields through typed applicators.
7. Record acknowledgements as effective values and dispositions; broadcast the versioned snapshot.

Persistence failure returns an error and keeps the previous in-memory desired snapshot. Any preview involved in the failed commit remains explicitly preview-only until the client cancels or it expires; the response tells the client what happened.

Runtime application failure does not corrupt or silently roll back the committed file. Desired remains the user’s durable intent, effective remains the last verified runtime value, and the failed disposition allows retry or corrective UI. This makes an unavoidable cross-resource non-atomicity observable instead of pretending it did not occur.

## 6. Preview lifecycle

- A preview session has a random session ID, latest `seq`, touched fields, and expiry.
- The coordinator ignores `seq <= latest_seq` for that session.
- Accepted preview/cancel/expiry operations advance `state_revision`; expired
  sessions leave a bounded tombstone so delayed requests cannot resurrect them.
- Only preview-safe fields are accepted. Device changes and destructive stream reconfiguration use normal commits, not slider-style previews.
- Cancel restores the current desired values, not the values that existed when the preview started; this handles unrelated commits during a long edit session.
- Session expiry performs the same restore and emits a snapshot/event.
- Commit optionally names the session so its overlay can be removed without an intermediate audible rollback.

For PlayerBar volume, pointer movement sends preview updates. Pointer-up commits once. Keyboard/wheel changes use a bounded debounce and flush on blur/unmount/application shutdown when possible. Backend validation clamps/rejects outside `0.0..=1.0`; the UI may display percentage but never uses a `0..4` engine value.

## 7. Startup hydration

Startup must use one constructor/factory sequence:

1. Load and validate `settings.json`, with existing backward-compatible defaults/migrations.
2. Build the coordinator’s desired revision-zero snapshot.
3. Construct runtime parameter objects directly from that snapshot or run one exhaustive `apply_initial_settings` before the audio thread starts.
4. Build the decoder/output versioned config from the same snapshot.
5. Read back/acknowledge all initialized actuators and create effective revision zero.
6. Start serving HTTP/UI state only after hydration succeeds or an explicit failed disposition is recorded.

The exhaustive initializer must cover volume atomics, EQ type/bands/FIR enablement, dither/noise shaping, output bits, target sample rate, resampling/streaming fields, and every setting exposed in `PersistentSettings`.

## 8. EQ mode correctness

EQ mode is modeled as a typed enum rather than a free-form string inside the control plane. Transition code owns both sides of the mode switch:

- entering FIR configures/enables FIR and disables mutually exclusive IIR behavior as required by the core;
- leaving FIR explicitly calls the FIR-disable actuator before reporting IIR/disabled as effective;
- startup uses the same transition/applicator logic as runtime commits.

No separate label field may be updated without the DSP transition succeeding.

## 9. Runtime configuration handoff

Replace frozen mutable startup copies with one of two bounded mechanisms, chosen per field:

- atomic parameters for values designed for lock-free realtime updates;
- a versioned immutable `Arc<RuntimeAudioConfig>` (for example via `ArcSwap`) or an existing audio command channel for values consumed at track/session/stream boundaries.

Decoder/stream creation captures a snapshot and reports which settings revision it consumed. Output rebuild commands carry the target revision and return an acknowledgement containing actual device/format values. Late acknowledgements for older revisions cannot replace newer effective state.

## 10. HTTP/API migration

Add versioned operations, either under new routes or a versioned envelope on current routes:

- `GET /audio_settings` → current `AudioSettingsSnapshot`;
- `POST /audio_settings/preview` → preview acknowledgement/snapshot;
- `POST /audio_settings/commit` → committed snapshot or 409 conflict;
- `POST /audio_settings/cancel` → restored snapshot.

During migration:

- `/volume` becomes a compatibility commit/preview adapter through the coordinator;
- `/settings` reads the coordinator desired snapshot;
- `/save_settings` converts the legacy payload to a typed dirty patch and commits through the coordinator;
- device/output/DSP routes call coordinator commands;
- complete `PlayerState` responses include a settings revision when they embed audio settings, so a stale response cannot regress them.

Legacy routes must not reconstruct and reapply a complete snapshot from an unrelated partial request.

## 11. Frontend store

Create a shared `AudioSettingsStore` (React context/external store consistent with current project patterns) with:

- server snapshot and highest accepted revision;
- active preview session/sequence per editor;
- pending commit metadata;
- dirty form overrides and conflict/error state.

Rules:

- accept a committed response only if its revision is at least the latest known revision and its request generation is still relevant;
- apply preview replies only to the matching session and sequence;
- settings forms render `{...latestDesired, ...dirtyOverrides}` rather than copying the full response into independent state;
- after a successful commit, clear only committed dirty fields;
- on 409, rebase non-conflicting dirty fields and surface actual conflicts;
- never perform an unconditional post-save GET that can rebuild the form from an older response.

Reuse the proven preview/commit/rollback shape in `apps/desktop/src/shared/state/uiSettingsStorage.ts` and its tests, adapted to server-authoritative revisions.

## 12. SQLite overlap

`settings.json` is the only authoritative persistence source for this task. Existing `device_configs` and `dsp_configs` must follow one of these explicit outcomes:

1. preferred: stop writing overlapping active values and deprecate/remove the endpoints;
2. allowed transitional outcome: store append-only diagnostic/history projections after a successful commit, tagged with revision, and never read them to determine desired/effective state.

A failure to write optional diagnostics cannot fail or roll back an otherwise successful settings commit.

## 13. Observability

Structured logs should include command kind, revision, changed field paths, apply disposition, and a correlation/session ID without logging sensitive file contents. Add counters/log assertions for stale preview drops, commit conflicts, persistence failures, and runtime apply failures. This is essential for diagnosing desired/effective divergence.

## 14. Compatibility and rollout

- Preserve the existing JSON schema and default behavior; add wire fields compatibly.
- Keep route adapters until all desktop callers and tests use the new client.
- Ship phase gates with characterization tests before deleting mirrors or legacy writes.
- Consolidate the overlapping unstarted `07-02-player-config-truth` scope into this implementation.
- Do not mix general playback transport revisioning into this task beyond preventing embedded audio settings from regressing; track broader stale `PlayerState` ordering separately.

## 15. Alternatives considered

### Keep multiple stores and synchronize all of them

Rejected because every new write path must remember the same fan-out and rollback order. It preserves the root cause and cannot make disk/runtime partial failure honest.

### Treat frontend state as authoritative

Rejected because startup, legacy clients, device failures, and actual DSP acknowledgement still require a backend authority.

### Persist every PlayerBar movement directly

Rejected because it creates excessive file writes and still lacks cancellation/ordering semantics. Preview plus one debounced/final commit provides immediate audio feedback and durable intent.

### Big-bang replacement

Rejected for rollout. The architecture is the target, but implementation is phased behind compatibility adapters and regression gates.

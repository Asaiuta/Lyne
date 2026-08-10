# Frontend Audio Settings Store

## 1. Scope / Trigger

Apply this contract to PlayerBar/FullPlayer volume controls, the audio-engine
settings panel, playback responses containing audio mirrors, and any new UI
that edits persistent engine settings.

## 2. Signatures

All surfaces share one `AudioSettingsStore`:

```ts
interface AudioSettingsStore {
  readonly snapshot: Accessor<AudioSettingsSnapshot | null>;
  readonly desired: Accessor<PersistentSettings | null>;
  readonly effective: Accessor<PersistentSettings | null>;
  reservePreview(sessionId: string, seq: number): void;
  refresh(): Promise<AudioSettingsSnapshot>;
  preview(sessionId: string, seq: number, patch: AudioSettingsPreviewPatch): Promise<AudioSettingsPreviewResult>;
  commit(patch: PersistentSettingsUpdate, options?: AudioSettingsCommitOptions): Promise<AudioSettingsSnapshot>;
  cancelPreview(sessionId: string): Promise<AudioSettingsSnapshot>;
}
```

The server snapshot includes committed `revision` and observable
`state_revision`. Preview requests additionally carry `session_id` and `seq`.

## 3. Contracts

### Snapshot ordering

1. Reject lower committed `revision`.
2. Reject lower `state_revision`; this orders different preview sessions and
   cancel/expiry responses that share one committed revision.
3. For an identical `(revision, state_revision)`, reject an older local request
   generation.
4. Within one session, reserve the latest intended `seq` before coalescing or
   dispatching network work. An in-flight older response must not replace a
   newer local slider intent.

### Shared read model

- Settings forms render `desired` plus dirty local overrides.
- PlayerBar, FullPlayer, and audio mirrors embedded in `PlayerState` render
  `effective`.
- A stale full `PlayerState` response must be projected through the latest
  effective audio snapshot before it reaches components.
- No component owns an independent authoritative audio settings copy.

### Form editing

- Send only dirty fields.
- Record the committed base revision when a field first becomes dirty.
- A newer snapshot rebases untouched fields and preserves dirty values.
- Clear only fields confirmed by a successful commit.
- On HTTP 409, apply the conflict snapshot, preserve dirty values, show the
  conflict, and move those dirty fields' retry base to the returned revision.
- Do not perform an unconditional post-save GET that can race the commit
  response and rebuild the form from stale state.

### Preview and commit

- Slider input creates/reuses a random session and increasing sequence.
- Pointer/key commit sends one durable dirty patch with that session id.
- Wheel changes preview immediately and debounce to one commit.
- Capture the base revision when the first preview is actually dispatched, not
  when it is merely queued behind an earlier owned commit.
- Any failed commit cancels its preview session, even when a newer command has
  superseded its UI error.
- After failed EQ commit/cancel, discard the closed session id; the next edit
  must create a new session.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Lower `revision` or `state_revision` response | Ignore it |
| Same server versions, older request generation | Ignore it |
| Older sequence in the same preview session | Ignore it |
| Preview response session/sequence mismatch | Reject as protocol error |
| 409 commit | Apply current snapshot, preserve dirty overrides, surface typed conflict |
| Persistence/network failure during preview commit | Cancel overlay and retain dirty form value/error |
| PlayerState arrives after a newer settings snapshot | Keep audio mirrors projected from `effective` |
| No settings snapshot loaded yet | Refresh before commit or fail explicitly; never invent a revision |

## 5. Good / Base / Bad Cases

- Good: a queued second volume interaction begins after the first owned commit;
  its first dispatched preview captures the post-commit base revision.
- Good: settings EQ preview fails to commit, cancels, and the next drag uses a
  new session id.
- Base: a select change sends one field patch and disables that control until
  it resolves.
- Bad: call `/volume` for preview and `/save_settings` with a full form on
  release.
- Bad: compare preview snapshots only by committed revision.
- Bad: clear an entire dirty form after one field succeeds.

## 6. Tests Required

- Same-revision request-generation ordering.
- Same-session out-of-order preview sequences.
- Cross-session preview responses ordered by `state_revision`.
- Reserved-but-not-yet-dispatched preview intent rejects an older in-flight
  response.
- Conflict snapshot becomes current while typed conflict and dirty values are
  retained.
- Failed superseded volume commit still cancels its session.
- Preview queued behind an owned commit uses the resulting base revision.
- Effective settings override audio mirrors in stale `PlayerState` responses.
- PlayerBar/settings regression: volume commit followed by unrelated settings
  commit does not change visible/effective volume.
- Run `npm run typecheck`, `npm test`, and `npm run build` after changing the
  contract.

## 7. Wrong vs Correct

### Wrong

```ts
await api.setVolume(value);
await api.saveSettings({ ...lastLoadedSettings, use_cache: true });
setForm(await api.getSettings());
```

### Correct

```ts
audioSettings.reservePreview(session.id, seq);
await audioSettings.preview(session.id, seq, { volume: value });
await audioSettings.commit(
  { volume: value },
  { baseRevision: session.baseRevision, previewSessionId: session.id }
);
```

The same store owns ordering for every surface, while the backend remains the
durable authority.

## Scenario: Engine Default Fallback Parity

### 1. Scope / Trigger

Apply this contract whenever an `EngineSettings` default or bound changes and
the settings form can render before an audio-settings snapshot is available.
It prevents the empty-snapshot UI from displaying or submitting a stale value.

### 2. Signatures

The Rust authority and frontend fallback are:

```rust
pub const DEFAULT_STREAMING_PCM_WINDOW_LIMIT_MIB: u64;
pub const MAX_STREAMING_PCM_WINDOW_LIMIT_MIB: u64;
impl Default for EngineSettings;
```

```ts
export const STREAMING_FULL_BUFFER_LIMIT_MIB_DEFAULT: number;
export const STREAMING_FULL_BUFFER_LIMIT_MIB_MAX: number;
```

### 3. Contracts

- A loaded `AudioSettingsSnapshot.desired` value always wins over a frontend
  fallback; existing persisted values are not rewritten merely because the
  engine default changes.
- When no snapshot exists, the descriptor fallback in
  `audioEngineSettingsModel.ts` must equal `EngineSettings::default()` and use
  the same maximum bound from `src/config.rs`.
- `AUDIO_STREAMING_PCM_WINDOW_LIMIT_MIB` remains a runtime/config override; it
  does not create a second frontend default owner.
- A default or bound change must update the Rust constant, frontend descriptor,
  and their focused tests in the same change.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Snapshot contains a valid persisted value | Render that value unchanged |
| Snapshot is absent during initial form construction | Render the Rust-aligned frontend fallback |
| Rust default changes but frontend fallback does not | Focused model/default tests must fail review |
| Environment override is present | Backend applies and reports the effective desired value; frontend does not infer the environment |

### 5. Good / Base / Bad Cases

- Good: Rust and the frontend both default the PCM window to `128` MiB while a
  persisted `64` MiB setting continues to render as `64`.
- Base: a snapshot arrives after initial form construction and replaces only
  untouched fallback fields through the normal store rebase.
- Bad: `src/config.rs` changes from `256` to `128` while the descriptor keeps
  `256`, making an empty settings form disagree with actual engine behavior.

### 6. Tests Required

- Rust config tests assert `EngineSettings::default()` and normalization use
  the canonical default and maximum constants.
- `audioEngineSettingsModel.test.ts` asserts both form construction and scalar
  rollback use the matching fallback, while a supplied settings value wins.
- Run `cargo test --lib`, `npm test`, `npm run typecheck`, and `npm run build`
  after changing this contract.

### 7. Wrong vs Correct

Wrong:

```ts
const STREAMING_FULL_BUFFER_LIMIT_MIB_DEFAULT = 256; // independent UI default
```

Correct:

```ts
// Mirrors the named Rust constants; focused tests pin fallback behavior.
export const STREAMING_FULL_BUFFER_LIMIT_MIB_DEFAULT = 128;
```

# WebDAV Credential-Origin Binding: Implementation And Validation

Date: 2026-08-10

## Outcome

The SDC-04 credential leak path is closed. A URL receives WebDAV Basic Auth
only when one persisted source identity authorizes that URL's normalized origin
and collection. Public, NCM, playlist, and explicitly public queue entries use
public-only address policy and no WebDAV credentials.

## Data Flow

```text
request or queue row
  -> source_key/source_identity resolution in AppDatabase
  -> normalized configured WebDAV URL or validated public path
  -> MediaSourceAccess { credentials, address_policy, source_key }
  -> direct load / queue load / gapless preload / streaming reopen
     / loudness / AutoMix / WebDAV indexing
  -> audio-engine-core HTTP client validates every redirect destination
```

Migration 13 adds `playback_queue_entries.source_key` plus the `infer`, `public`,
and `webdav` source-identity state. Existing rows remain `infer`. New NCM/public
rows are explicitly public, and WebDAV rows persist their exact source. Queue
cursor movement and status changes now use `entry_id`; path equality cannot
select a different duplicate row. Pending preload state carries path, entry id,
and generation so an older failure cannot clear or promote a newer request.

## WebDAV Boundary

`WebDavConfig` parses and normalizes hrefs with `Url`. It rejects changed
scheme/host/effective port, embedded userinfo, query/fragment, encoded parent or
separator tricks, and paths outside the configured collection. PROPFIND uses
same-origin redirects and no ambient proxy. Decoder/AutoMix traffic uses pinned
core revision `5389c32f66c52c2d0b870acdeae4b20cf9c9de47`.

## Validation Evidence

- Targeted task-file rustfmt check: passed.
- `cargo check --locked --tests`: passed.
- Migration tests: 17/17 passed.
- Source resolver tests: 7/7 passed.
- WebDAV parser/redirect tests: 7/7 passed.
- Playlist handler regression: append and replace persist `source_key = NULL`
  and `source_identity = public` even when the URL has a WebDAV membership.
- `cargo test --locked`: 428/428 passed.
- `cargo clippy --locked --lib --tests --message-format=short`: exit 0; warnings
  are existing project warnings.
- Core HTTP-policy module: 8/8 passed before the pushed core commit; same-origin
  redirect requests retain Basic Auth, and a rejected cross-address redirect
  produces no second request.
- Core commit `5389c32` is pushed to `origin/fix/automix-http-policy` and the
  AudioPlayer manifest/lockfile use its full 40-character revision.

## Known Unrelated Baseline

- Full `cargo fmt --all -- --check` still reports only pre-existing formatting
  drift in `src/bench_gate.rs` and `src/bench_provenance.rs`.
- Full `cargo clippy --locked --all-targets` still fails only because
  `benches/pcm_window_perf.rs` calls a private/changed `PcmWindow::create` API.
  Task-owned lib/test targets pass clippy.

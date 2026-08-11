# WebDAV credential-origin binding implementation plan

## 1. Persistence and source resolution

- [x] Add migration 13 and baseline schema support for nullable queue
      `source_key`.
- [x] Extend queue records/inserts/selects with source identity while keeping
      existing string-only helpers compatible for local/public callers.
- [x] Add a database query that resolves unambiguous WebDAV source identity
      from media membership.
- [x] Add one server-side media access resolver; remove default WebDAV config
      fallback and raw `/queue_next` credentials.

## 2. Structured WebDAV boundaries

- [x] Normalize configured origins and collection paths with `Url`.
- [x] Reject cross-origin/userinfo/collection-escape hrefs and return one
      normalized absolute URL plus relative href.
- [x] Restrict PROPFIND redirects to the configured origin and disable ambient
      proxies.
- [x] Add parser and redirect regression tests.

## 3. Decoder policy propagation

- [x] Pin `audio-engine-core` to exact revision
      `5389c32f66c52c2d0b870acdeae4b20cf9c9de47`.
- [x] Introduce typed `MediaSourceAccess` and pass it through direct load,
      persistent queue, gapless preload, streaming source reopen, loudness,
      AutoMix and WebDAV indexing.
- [x] Ensure public/NCM/playlist paths always use public-only access without
      WebDAV credentials.
- [x] Ensure configured WebDAV paths use the exact persisted source origin.

## 4. Focused validation

- [x] Migration and queue persistence tests, including old nullable rows and
      multi-source restart behavior.
- [x] Resolver tests: public URL gets no credentials; two sources cannot cross;
      ambiguous memberships fail closed.
- [x] Href tests: same-origin valid, cross-origin, userinfo, encoded parent,
      trailing-slash alias and collection escape.
- [x] Mock HTTP tests: same-origin Basic Auth preserved; cross-origin redirect
      receives no authenticated request.
- [x] Player/server tests cover direct load, queue playback/preload, loudness,
      AutoMix and WebDAV scan policy propagation.

## 5. Quality gate and closeout

- [x] Targeted task-file `rustfmt --edition 2021 --check` passes. Full
      `cargo fmt --all -- --check` remains blocked only by unrelated existing
      drift in `src/bench_gate.rs` and `src/bench_provenance.rs`.
- [x] Focused migration, app database, WebDAV, playlist public-source,
      player loading/gapless and server playback tests.
- [x] `cargo test --locked` (428 passed).
- [x] `cargo clippy --locked --lib --tests --message-format=short` exits 0.
      Full `--all-targets` remains blocked only by the unrelated existing
      `benches/pcm_window_perf.rs` API drift.
- [x] Update backend specs and task Research with the final data-flow evidence.
- [x] Commit task-owned files only. Keep the task active until the user
      explicitly confirms archive, then resume `07-02-server-fetch-hardening`.

## Risky files

- `src/migration.rs`, `migrations/001_baseline.sql`: schema version and fresh DB
  must agree.
- `src/app_database/queue_entries.rs`: every select column offset must remain
  aligned with `QueueEntryRecord`.
- `src/webdav.rs`: normalization must preserve legitimate configured LAN
  collections while rejecting authority/path escapes.
- `src/player/loading.rs`, `src/player/gapless.rs`,
  `src/player/streaming/source.rs`: access policy must survive thread and reopen
  boundaries without adding callback work.
- `Cargo.toml`, `Cargo.lock`: the core pin is valid only after every WebDAV call
  uses explicit trusted-origin access.

# Batch 03: Server, Data, Concurrency, and Security

Date: 2026-08-07

## Remediation Update: SDC-04 Resolved (2026-08-10)

`08-07-webdav-credential-origin-binding` has closed SDC-04 in the current
working tree. Credentials and destination policy now travel together through
`MediaSourceAccess`; source authority comes from an explicit persisted
`source_key` or one unambiguous library membership, never from the default
WebDAV config or URL-origin matching alone. Migration 13 persists queue source
identity, duplicate URLs navigate/update by exact entry id, and preload state
also carries entry identity plus generation.

WebDAV hrefs are parsed structurally and constrained to the configured origin
and collection. PROPFIND rejects cross-origin redirects before a second
authenticated request. The pinned core revision
`5389c32f66c52c2d0b870acdeae4b20cf9c9de47` revalidates redirect destinations;
its mock tests retain Basic Auth across same-origin hops and issue no second
request for a rejected cross-address hop.

Validation: targeted format check, `cargo check --locked --tests`, migration
17/17, resolver 7/7, WebDAV 7/7, playlist public-source regression 1/1, root
`cargo test --locked` 428/428, and `cargo clippy --locked --lib --tests` all
pass. Full-repository fmt/all-targets clippy remain blocked only by the
separately existing bench formatting and `pcm_window_perf` API-drift baselines
recorded in the child Research.

## Snapshot And Audit Contract

- Authoritative baseline: current working tree on `feat/desktop-lyric`.
- Comparison HEAD: `dbbbdafd903ca1e0feb19f7d6359f3e24936ec60`.
- The scoped status check for `src/server.rs`, `src/server/**`, `src/app_database.rs`, `src/app_database/**`, `src/migration.rs`, `migrations/**`, `src/settings.rs`, `src/config.rs`, `src/webdav.rs`, `src/playlist.rs`, and `src/main.rs` reported no product-source changes. The repository remains broadly dirty outside this batch.
- Product source is read-only for this audit. Findings and remediation ownership are recorded in Trellis only.
- Review contracts loaded: backend database, directory, error, quality, logging, WebSocket, NCM proxy, and shared cross-layer/reuse guides.

## Entry And Ownership Inventory

`src/server.rs` owns the Actix server, bearer middleware, CORS, route-family registration, and shared `AppState`. The main shared ownership boundaries are:

- `parking_lot::Mutex<AudioPlayer>` for the control plane.
- `Arc<AppDatabase>` plus `AsyncRepo` over the same single SQLite connection.
- a dedicated analysis runtime with semaphore and timeout/cancellation support.
- separate mutexes for WebDAV configuration, scan task maps, active playback session, and NCM scrobble state.
- a Tokio broadcast sender for backend-owned WebSocket events.

The server refuses startup when `AUDIO_API_TOKEN` is missing or blank. Normal HTTP routes are guarded by `BearerAuth`; `/ws` is deliberately bypassed by middleware and performs its own header/subprotocol/query-token authentication. Access logging uses a redacted path/query formatter, so current-source verification must distinguish this landed behavior from the archived token-log finding.

The route surface is split across playback, effects, settings, WebDAV, diagnostics, NetEase, and WebSocket modules. The NetEase surface has two intentionally different contracts: raw `/api/netease/*` passthrough and normalized `/domain/ncm/*` DTO routes.

`AsyncRepo` is a thin `spawn_blocking` facade over `Arc<AppDatabase>` and documents that no connection guard crosses `.await`. It currently wraps a selected set of cover-art, library-view, and NCM metadata calls. Because `AppState.app_db` remains public to server modules, facade existence alone does not prove that every handler or supervisor avoids synchronous SQLite work on an Actix/Tokio worker.

## Existing Trellis Ownership Map

Current-source disposition after the concurrency, data, and security passes:

| Task | Current task state | Intended ownership |
|---|---|---|
| `07-02-server-token-log` | archived, resolved | bearer-token logging and CORS/auth closeout |
| `07-02-server-blocking-handlers` | archived, closed-residual | enumerated decoder-load sites landed; queue_next decision and broader synchronous DB surface remained |
| `06-08-server-async-blocking-offload` | archived, resolved for declared first wave | initial `AsyncRepo` and first offload sites |
| `06-08-server-netease-proxy-path-security` | archived as superseded | ownership transferred to token-log and fetch-hardening tasks |
| `07-02-server-fetch-hardening` | planning, residual confirmed | redirect/DNS SSRF, raw NCM override controls, WebDAV scan cycles, remote roots, and indirect playlist URLs |
| `06-08-persistence-robustness` | planning, residual confirmed | migration version guard, cross-write atomicity, poisoned connection lock, silent JSON loss and queue dual-write consistency |
| `06-08-library-track-view-sql-pushdown` | planning, residual confirmed | whole-table library view/group filtering and sorting, with CJK semantic constraints |
| `08-07-server-handler-db-offload-residual` | planning, new | current broad async-handler synchronous SQLite residual |
| `08-07-webdav-credential-origin-binding` | planning, new | WebDAV credential/source binding and cross-origin href/redirect containment |

## Method For Remaining Passes

1. Trace every high-risk handler from route entry through locks, blocking work, transaction completion and response/event publication.
2. Revalidate archived tasks against current source rather than assuming their labels prove resolution.
3. Review migration and repository invariants with focused in-memory tests; never open or mutate the user's real database.
4. Review remote URL, redirect/DNS, cookie, path and destructive-operation boundaries without sending live upstream traffic.
5. Classify findings as P0-P3 and `confirmed`, `probable`, or `report-only`; only confirmed distinct root causes receive new tasks.

## Handler And Concurrency Pass

### Confirmed execution model

`AppDatabase` owns one `rusqlite::Connection` behind
`std::sync::Mutex<Connection>` (`src/app_database.rs:33-35`). The connection is
opened with foreign keys enabled and, for the file-backed database, WAL plus
`synchronous=NORMAL` (`src/app_database.rs:89-98`, `234-246`). WAL does not make
the Rust mutex concurrent: every synchronous repository method still serializes
through the same process-local guard.

`AsyncRepo` correctly moves its selected operations into
`actix_web::rt::task::spawn_blocking` and never carries a connection guard across
`.await` (`src/server/repository.rs:29-48`). Its present surface is deliberately
small: cover art, library view/group/summary reads, and selected NCM metadata
writes. `AppState.app_db` remains directly reachable from handlers, so there is
no type or ownership boundary preventing synchronous SQLite calls on executor
workers.

Representative reachable paths that still bypass the facade:

- `GET /state` is an `async fn` that calls `enrich_player_state` synchronously
  (`src/server/playback/transport.rs:285-292`). For a current track the helper
  performs `media_metadata_for_path` and then `ncm_track_source_for_path`, two
  separately locked SQLite reads (`src/server/state_helpers.rs:125-171`).
- Play, pause, stop, and seek release the player mutex before persistence, but
  still perform synchronous session/history writes on the executor worker
  (`src/server/playback/transport.rs:63-82`, `108-127`, `153-173`, `199-217`).
- Queue adjacency/snapshot/list/replace/remove/clear handlers call synchronous
  queue methods directly (`src/server/playback/queue_handlers.rs:257-303`,
  `324-327`, `376-395`). `queue_next` also retains the explicitly undecided
  residual from the archived task: its status write is inline at `:97-102`.
- Account session handlers synchronously read and write SQLite before and after
  upstream awaits (`src/server/netease/accounts.rs:12-178`). WebDAV source CRUD
  does the same (`src/server/webdav_handlers.rs:46-213`). Library history,
  detail, playlist, root, scan-task, and metadata handlers contain further
  direct calls throughout `src/server/playback/library_domain_handlers.rs`.

Player guards observed in these representative transport paths are released
before database calls and awaits; no player/SQLite nested-lock deadlock was
confirmed in this pass. The defect is executor blocking and head-of-line
contention, not a proven deadlock. No load benchmark was run, so the duration
and production tail-latency impact remain unmeasured.

### Finding SDC-01: synchronous SQLite remains reachable from async handlers

- **Severity/evidence:** P1, `confirmed`.
- **Impact chain:** authenticated request -> Actix `async fn` -> synchronous
  SQLite method -> wait for the single `Mutex<Connection>` and execute query on
  an executor worker -> unrelated requests scheduled on that worker, including
  `/state` and other control-plane work, cannot progress until the call returns.
- **Why confirmed:** the route-to-call paths above are current and reachable;
  `src/server/repository.rs:3-8` itself records that direct calls violate the
  project's executor boundary. The exact latency magnitude is not claimed.
- **Ownership:** `06-08-server-async-blocking-offload` resolved its enumerated
  first-wave sites. `07-02-server-blocking-handlers` resolved the five decoder
  load sites but was archived with all acceptance boxes unchecked and left its
  named `queue_next` scope decision unresolved. The broad remaining handler
  surface therefore needs a clearly bounded residual task rather than being
  misreported as covered by either archive.

## Data And Recovery Pass

### Confirmed database behavior

- Each migration body and its version record share a transaction through
  `apply_migration_tx` (`src/migration.rs:77-89`). Current success/idempotency
  tests cover the individual migrations, but `run_migrations` reads the maximum
  version and applies versions 1 through 12 without rejecting a database whose
  version is newer than this build (`src/migration.rs:18-65`).
- Foreign keys are enabled for every application connection; the file-backed
  connection additionally uses WAL. This rules out the old claim that these
  pragmas are absent, but does not address the single poisonable mutex.
- Media metadata batch writes now use one immediate transaction plus per-record
  savepoints (`src/app_database/media_items.rs:74-97`, `374-400`). In contrast,
  `start_playback_session`, `record_external_media_metadata`, and
  `record_ncm_track_source` still call `record_media_stub`, commit it, then
  reacquire the connection and issue the dependent write
  (`src/app_database/playback_activity.rs:27-55`,
  `src/app_database/media_items.rs:140-173`,
  `src/app_database/ncm_track_sources.rs:37-64`). A later error can therefore
  leave the stub without the dependent row/update.
- Corrupt JSON is still silently converted to `Null`/`None` in DSP config,
  analysis-task results, and playback-history payloads
  (`src/app_database/runtime_state.rs:19-24`,
  `src/app_database/analysis_tasks.rs:9-18`,
  `src/app_database/playback_activity.rs:196-203`).
- Queue entries and the runtime queue snapshot are independent methods and
  independent lock/write operations; `save_queue_snapshot` writes
  `playback_queue_state` at `src/app_database/runtime_state.rs:138-168`, while
  queue entry mutations live on a separate repository path. No transaction can
  currently make the pair crash-atomic.

### Finding SDC-02: persistence recovery gaps remain open

- **Severity/evidence:** P2, `confirmed` for the missing upper-version guard,
  poisonable connection lock, split stub/dependent writes, silent JSON fallback,
  and queue dual-write boundary. Failure injection and downgrade-open behavior
  were not executed in this audit, so no frequency claim is made.
- **Ownership:** exact root-cause match with active task
  `06-08-persistence-robustness`; do not create a duplicate.

### Resolved/excluded persistence claims

Settings persistence is not a current defect. `EngineSettings::save` serializes
the normalized candidate and calls a same-directory atomic writer
(`src/config.rs:210-224`, `561-605`); it writes a new temporary file, calls
`sync_all`, and uses write-through replacement on Windows (`:628-664`).
`SettingsManager::update_with_persist` only publishes the candidate in memory
after persistence succeeds (`src/settings.rs:193-203`), and tests assert that a
failed update preserves both the old file and in-memory state
(`src/settings.rs:351-371`).

`library_track_view`/`groups` still materialize and sort the full summary set,
but those operations already run through `AsyncRepo`. Their large-library CPU,
allocation, indexing, and CJK-equivalence work remains correctly owned by
`06-08-library-track-view-sql-pushdown`; this audit has no runtime measurement
that would justify a stronger performance claim.

## Security And External-I/O Pass

### Authentication, CORS, secrets, and response contracts

The archived `07-02-server-token-log` findings are resolved in current source:

- startup rejects a missing/blank `AUDIO_API_TOKEN`
  (`src/server.rs:387-405`), and the server binds only `127.0.0.1`
  (`src/server.rs:635-637`);
- HTTP routes use `BearerAuth`; `/ws` is the only middleware bypass and performs
  its own header/subprotocol/query authentication with the same constant-time
  comparison (`src/server/auth.rs:61-105`, `src/server/ws_handlers.rs:37-72`,
  `336-358`);
- the access logger rebuilds the request line through
  `redacted_path_and_query`, with focused tests for query-token removal
  (`src/server.rs:575-590`, `src/server/auth.rs:131-156`, `312-340`);
- the default origin list excludes `Origin: null`; wildcard configuration
  disables credential support, while explicit origins use credentials
  (`src/config.rs:736-762`, `src/server.rs:548-615`).

Raw `/api/netease/*` and normalized `/domain/ncm/*` retain their deliberately
different envelopes. Account cookies are skipped during account serialization,
and WebDAV passwords are skipped during serialization and masked by `Debug`.
No current envelope leak was confirmed.

Local media deletion is also correctly server-owned: the request supplies a
`media_id`, the server reloads the stored source path, rejects non-local rows,
symlinks, non-files, UNC/broad/system roots, canonicalizes the target and each
configured local root, and requires containment before `remove_file`
(`src/server/playback/library_domain_handlers.rs:534-686`). No arbitrary
client-supplied delete path remains in this route.

### Finding SDC-03: remote-fetch validation remains incomplete

- **Severity/evidence:** P1, `confirmed` for the validation and routing gaps;
  runtime exploitability remains bounded by localhost bearer authentication and
  was not exercised against live services.
- `validate_remote_media_url` rejects literal private IPs and ambiguous numeric
  hosts but performs no DNS resolution (`src/server/path_security.rs:107-195`).
  The pinned decoder and `src/webdav.rs:143-170` construct reqwest clients
  without a redirect policy, so initial validation is not applied to redirect
  destinations.
- Raw NCM proxy input still assigns arbitrary `proxy`, `ua`, and `realIP`
  overrides (`src/server/netease/proxy/request.rs:94-137`). Active account cookie
  injection happens afterward (`src/server/netease.rs:88-110`), and
  `request_option_from_query` forwards cookie plus proxy to the upstream client
  (`src/server/netease/proxy/registry.rs:301-312`). This is a reachable cookie
  exfiltration path for a caller holding the local bearer token.
- `scan_library_root` classifies every `http(s)` and leading-`/` value as remote
  and skips `validate_path` (`src/server/playback/library_domain_handlers.rs:1175-1204`).
- WebDAV recursion has cancellation and a per-PROPFIND timeout but only guards
  `child_path != path`; it has no normalized visited set, depth/entry bound, or
  overall deadline (`src/server/playback/library_scan.rs:809-879`).
- Local M3U/PLS URL entries validate only their scheme
  (`src/playlist.rs:180-190`, `239-263`) and can be persisted by
  `playlist_handlers.rs:14-23`, bypassing the direct-load URL policy.
- **Ownership:** active task `07-02-server-fetch-hardening`, updated with the
  playlist/indirect-URL and remote-root classification deltas. No duplicate
  SSRF task was created.

### Finding SDC-04: WebDAV credentials are not bound to their source

- **Severity/evidence:** P1, `confirmed`.
- **Impact chain:** configure WebDAV credentials -> open any remote URL through
  direct load, persistent queue/preload, or loudness analysis -> handler clones
  default credentials without comparing the destination -> pinned decoder adds
  HTTP Basic Auth to HEAD/GET/range requests for that destination. This can leak
  WebDAV credentials to unrelated public/NCM/playlist URLs even without a
  malicious WebDAV response.
- A WebDAV server can additionally return an absolute cross-origin file `href`;
  `build_full_url` preserves it, and the library scan opens it with configured
  credentials (`src/webdav.rs:292-321`, `413-427`;
  `src/server/playback/library_scan.rs:839-879`).
- **Ownership:** new task `08-07-webdav-credential-origin-binding`. This is an
  origin/source-identity defect, distinct from general SSRF and NCM proxy
  hardening.

### Input and resource bounds

Library scans have a configurable concurrency semaphore and cancellation token;
WebDAV PROPFIND has 30-second request and 10-second connect timeouts. Those do
not bound total traversal, as recorded in SDC-03. WebDAV source keys, display
names, and browse paths have explicit length/character validation.

Several NCM domain handlers accept any positive `limit` and forward it upstream
without a local maximum (for example `src/server/netease/discover.rs:311-325`
and `src/server/netease/playlists.rs:77-84`). Upstream caps and actual response
sizes were not tested, so this is **P3 `probable`** resource-amplification debt,
not a confirmed production performance defect. It remains report-only pending
an endpoint matrix and measured payload/memory evidence.

## Maintainability And Ownership Debt

The largest scoped modules are `diagnostics.rs`,
`playback/library_domain_handlers.rs`, `playback/library_scan.rs`, and
`app_database/library_memberships.rs` (roughly 43-48 KiB each). Size alone is
not a finding: the audit did not create a generic "split large files" task.

Two concrete ownership problems do emerge from the control-flow review:

1. `AppState` exposes both `app_db` and `repo` publicly to every server module.
   That makes the correct async boundary optional and has already produced the
   broad SDC-01 residual. `08-07-server-handler-db-offload-residual` therefore
   requires an enforceable boundary/guard, not only another call-site sweep.
2. WebDAV URL identity is implemented through manual string concatenation and
   prefix stripping in `src/webdav.rs:65-123`, `347-437`, while credentials are
   selected separately from global/default state. The resulting split ownership
   is the cause of SDC-04; `08-07-webdav-credential-origin-binding` requires one
   structured source/origin resolver.

The raw/domain NCM envelope split and the many route-specific success DTOs are
intentional contracts, not duplication to collapse. Stringly typed repository
errors remain separate debt owned by `06-08-error-types-thiserror`; changing
them inside either new P1 task would widen scope and obscure behavioral review.

## Findings

| ID | Priority | Evidence | Finding | Trellis ownership |
|---|---|---|---|---|
| SDC-01 | P1 | confirmed | Synchronous SQLite calls remain directly reachable from many async handlers and contend on one connection mutex on executor workers. | New `08-07-server-handler-db-offload-residual`. |
| SDC-02 | P2 | confirmed | Migration/version, poison recovery, cross-write atomicity, silent JSON loss, and queue dual-write gaps remain. | Existing `06-08-persistence-robustness`. |
| SDC-03 | P1 | confirmed | DNS/redirect validation, raw NCM proxy override, remote-root classification, unbounded WebDAV recursion, and playlist URL policy gaps remain. | Existing `07-02-server-fetch-hardening` (scope refreshed). |
| SDC-04 | P1 | confirmed | Default WebDAV Basic Auth is sent without destination/source binding; cross-origin hrefs can enter the same path. | New `08-07-webdav-credential-origin-binding`. |
| SDC-05 | P3 | probable | Positive NCM pagination limits are not consistently capped locally; upstream/runtime impact is unmeasured. | Report-only pending measurement. |

No P0 finding was identified in this batch.

## Validation Evidence

All commands below ran against the unchanged dirty-worktree baseline and exited
with status 0:

- `cargo test --locked server::auth -- --nocapture`: 12 passed, 0 failed.
- `cargo test --locked path_security -- --nocapture`: 7 passed, 0 failed.
- `cargo test --locked webdav -- --nocapture`: 14 passed, 0 failed.
- `cargo test --locked migration::tests -- --nocapture`: 15 passed, 0 failed.
- `cargo test --locked app_database::tests -- --nocapture`: 47 passed, 0 failed.
- `cargo test --locked server::netease::tests -- --nocapture`: 43 passed, 0
  failed.
- `cargo check --bin audio_server --locked`: completed successfully.

The WebDAV-filtered run overlaps some migration and app-database tests; counts
above are per invocation and are not presented as a unique-test total. A broad
`cargo test --lib --locked` was not run because the focused suites cover the
inspected contracts and no product code changed in this audit.

These checks confirm the existing positive behavior for authentication and
redaction, literal URL/path rejection, current WebDAV parsing and membership,
migration rollback, database persistence, NCM envelopes, and server compilation.
They do not exercise DNS rebinding, redirects, credential delivery to a live
destination, traversal exhaustion, executor saturation, downgrade-open behavior,
or repository failure injection. Accordingly they do not close SDC-01 through
SDC-04 or raise SDC-05 above probable/report-only.

No external service, real user database, load test, or production workload was
touched.

Audit-artifact closeout also completed successfully:

- targeted `git diff --check` exited 0;
- `task.py validate` passed for this audit child, the parent audit,
  `07-02-server-fetch-hardening`, `08-07-server-handler-db-offload-residual`,
  and `08-07-webdav-credential-origin-binding`;
- the final scoped `git status --short` for all product paths named in the
  audit contract returned no entries, matching the recorded baseline;
- `.trellis/` is ignored by the repository root `.gitignore`, so the Git check
  cannot inspect these untracked task files; a separate trailing-whitespace
  scan across the seven created or updated Markdown artifacts returned no
  matches.

The two new remediation tasks remain non-active in `planning`; the parent audit
remains open for later batches. This audit child is complete but is not
archived.

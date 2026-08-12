# Remote Fetch Boundaries

## 1. Scope / Trigger

Use this contract whenever server input can select a remote media URL, a
configured WebDAV source, or a WebDAV library traversal path. These inputs have
different trust models and must not share an untyped string fallback.

This document owns source classification and traversal behavior. NCM raw
override behavior remains owned by [NCM Proxy Contract](./ncm-proxy-contract.md),
and library membership finalization remains owned by
[Database Guidelines](./database-guidelines.md#local-library-root-membership-and-cleanup-contract).

## 2. Signatures

```rust
pub(crate) fn validate_path(path: &str) -> Result<String, String>;

pub struct MediaSourceAccess {
    credentials: Option<HttpCredentials>,
    source_key: Option<String>,
}

pub(super) fn resolve_media_source(
    app_db: &AppDatabase,
    raw_path: &str,
    explicit_source_key: Option<&str>,
) -> Result<ResolvedMediaSource, String>;

pub(super) fn resolve_queue_media_source(
    app_db: &AppDatabase,
    entry: &QueueEntryRecord,
) -> Result<ResolvedMediaSource, String>;

pub(crate) fn normalize_source_key(source_key: &str) -> Result<String, String>;
pub(crate) fn validate_browse_path(path: &str) -> Result<(), WebDavError>;

pub(super) fn scan_webdav_library(
    data: &web::Data<Arc<AppState>>,
    scan_task_id: u64,
    started_at: u64,
    root_id: i64,
    root_path: &str,
    source_key: &str,
    cancel_token: AnalysisCancelToken,
) -> Result<LibraryScanOutcome, String>;
```

Production WebDAV traversal limits are depth 64, 100,000 listed entries, and
one hour elapsed time.

## 3. Contracts

| Source | Contract |
|--------|----------|
| Request-supplied HTTP(S) media URL | Validate through `validate_path` before queue persistence or playback. M3U/PLS entries use the same boundary as direct loads. |
| Public/NCM/playlist media | Construct `MediaSourceAccess::public_only()` and persist `source_identity = 'public'`; never infer WebDAV authority from a matching URL. Playlist append/replace maps every validated entry through `QueueEntryInput::public` and uses the source-aware queue APIs. |
| Playlist WebDAV URL | Reject `webdav://` and `webdavs://`; a playlist has no configured source identity with which to bind credentials. |
| Configured WebDAV source | Require a persisted `source_key`, normalize the media URL against that source's origin and collection path, then construct one `MediaSourceAccess` binding credentials to that source. `trusted_origin` validates that the configured origin is an HTTP(S) URL with a host; it no longer grants a private-address allowance, because the core removed every destination-policy opt-in. A source configured on a LAN/private address can therefore no longer be opened by the decoder. |
| Source key omitted for indexed media | Infer from durable `library_root_memberships`; exactly one WebDAV owner grants configured access, no owner stays public-only, and multiple owners fail closed. |
| Persistent queue replay/preload | Resolve the complete `QueueEntryRecord`, including `source_identity` and `source_key`; never select credentials from the process-global default WebDAV config. |
| Duplicate queue URLs | Treat `entry_id` as the cursor and preserve `source_key`; path equality alone cannot identify an entry or authorize credentials. |
| Library scan root without `source_key` | Treat as local only after local path validation. Reject HTTP(S), and reject leading `/` on Windows; on non-Windows, leading `/` remains a local absolute path. |
| WebDAV response href | Resolve with `Url`, reject userinfo/query/fragment, require normalized scheme/host/effective-port equality, and require collection-path containment before returning a media URL. |
| Credentialed redirect | The pinned core validates every destination unconditionally: a custom DNS resolver rejects loopback/private/link-local/CGNAT/reserved addresses, and `redirect::Policy::custom` re-resolves and re-validates every hop, erroring instead of following a rejected one. A rejected hop sends no second request. WebDAV PROPFIND additionally rejects cross-origin redirects before another authenticated request. |
| WebDAV traversal identity | Normalize absolute href paths, query/fragment suffixes, percent encoding, separators, dot segments, trailing slashes, and ASCII case for cycle detection. |
| Traversal bound or ASCII-case collision | Finish as partial, preserve unseen memberships, expose `scan_status = "partial"` and `partial_reason`, and keep the outer task terminal status as `success`. |
| Cancellation, browse failure, or indexing write failure | Finish as an error and retain the last committed membership set. |

DNS resolution and redirect-hop validation run in the HTTP client that actually
opens the media. The app must not add a blocking Actix DNS preflight and claim
rebinding protection. `audio-engine-core` revision
`af5899886939add755217cc72865ed8426e3d9cc` (1.0.1) owns the destination policy
for decoder and AutoMix traffic. That policy is unconditional — there is no
policy value to pass — so application code must not reimplement, relax, or claim
to override it. What the application still owns is which configured source may
attach credentials: `validate_path` for request-supplied URLs, source resolution,
and `MediaSourceAccess` as the only producer of credentials.

## 4. Validation & Error Matrix

| Input / condition | Required behavior |
|-------------------|-------------------|
| `http://127.0.0.1/...` playlist entry | Reject before the entry reaches the queue. |
| Public HTTP(S) playlist entry | Accept after the shared request URL policy succeeds. |
| Validated playlist URL already has a WebDAV library membership | Persist `source_key = NULL` and `source_identity = 'public'`; playlist input cannot grant configured-source authority. |
| Public/NCM URL while WebDAV is configured | Resolve public-only access with no Basic Auth. |
| Explicit WebDAV `source_key` does not own the URL | Reject before decoder open. |
| Media belongs to multiple WebDAV sources and has no explicit key | Reject as ambiguous; do not choose the default source. |
| Queue row has `source_identity = 'webdav'` but its source was deleted | Fail closed; do not reinterpret it as public or another configured source. |
| Cross-origin, userinfo, query, fragment, encoded parent/slash, or collection-escape href | Skip/reject before indexing or decoder open. |
| Same-origin WebDAV redirect | Preserve Basic Auth and the trusted-origin policy. |
| Redirect target rejected by address/origin policy | Send no second authenticated request. |
| HTTP(S) library scan root without `source_key` | HTTP 400; do not reinterpret it as WebDAV. |
| Existing configured WebDAV source on a private host | Accept its source-relative path. |
| Missing, empty, or malformed WebDAV `source_key` | HTTP 400 before creating a root or spawning work. |
| Absolute URL or traversal in a WebDAV browse path | Reject as an invalid source-relative path. |
| Encoded, case, slash, or trailing-slash directory alias | Visit at most once by normalized key. |
| Two distinct paths differ only by ASCII case | Skip the collision, mark the scan partial, and perform no stale cleanup. |
| Depth, entry, or duration limit reached | Stop or skip the bounded branch, commit seen members in partial mode, and preserve unseen members. |

## 5. Good/Base/Bad Cases

- Good: a configured NAS source named `archive` scans `/music`, and a depth
  limit retains previously indexed tracks below the unvisited branch.
- Good: two queue rows may share one URL while retaining distinct `entry_id`
  and `source_key` values; restart, navigation, status updates, and preload use
  the selected row's source only.
- Base: a local Unix `/music` root still passes through local canonicalization;
  a Windows `/music` request without source identity is rejected.
- Base: a legacy queue row remains `source_identity = 'infer'` and may recover
  one unambiguous library membership; otherwise it remains public-only or fails
  closed when ambiguous.
- Bad: accept an arbitrary absolute URL, inherit process-global WebDAV
  credentials, or run complete stale-member cleanup after a bounded walk.
- Bad: resolve a hostname in the handler, then let a separate decoder client
  resolve and follow redirects independently while claiming the fetch is safe.

## 6. Tests Required

- Path-policy tests reject loopback, credentials, traversal, and ambiguous
  numeric hosts while accepting a public HTTPS URL.
- Playlist tests prove HTTP(S) entries call the shared validator, source-less
  WebDAV schemes are rejected, and append/replace persist public identity even
  when the URL already has a WebDAV library membership.
- Root-classification tests cover configured WebDAV, missing source identity,
  absolute URL rejection, Windows leading slash, and non-Windows local paths.
- Traversal tests cover percent-encoded/case/trailing-slash aliases, a synthetic
  ancestor cycle, depth, entry, duration, and ASCII-case collision behavior.
- Database tests assert partial finalization retains unseen memberships, clears
  the temporary seen set, reports zero cleanup, and marks the root partial.
- Resolver tests cover public-only URLs, explicit source containment, unique and
  ambiguous memberships, NCM exclusion, and duplicate URL/source pairs.
- Queue tests cover migration 13, nullable legacy rows, restart persistence,
  exact entry-id navigation/status updates, and failed preload ownership.
- WebDAV tests reject cross-origin/userinfo/query/fragment/encoded traversal
  hrefs and prove same-origin auth redirect behavior.
- Core HTTP-policy tests prove same-origin Basic Auth survives two hops and a
  rejected cross-address redirect produces no second request.
- Run `cargo fmt --check`, the focused path/playlist/WebDAV/library-scan tests,
  and `cargo test --locked`.

## 7. Wrong vs Correct

### Wrong

```rust
let is_remote = path.starts_with("http") || path.starts_with('/');
let credentials = global_webdav_config.http_credentials();
player.load_with_credentials(path, credentials.as_ref())?;

let entries = playlist_paths.into_iter().map(QueueEntryInput::new).collect();
app_db.replace_queue_entries_with_sources("active", &entries)?;
```

### Correct

```rust
let resolved = resolve_media_source(&app_db, path, source_key)?;
player.load_with_source_access(&resolved.path, &resolved.access)?;

let entries = playlist_paths
    .into_iter()
    .map(QueueEntryInput::public)
    .collect::<Vec<_>>();
app_db.replace_queue_entries_with_sources("active", &entries)?;
```

The resolver makes credential-bearing access impossible without configured
source authority and keeps credentials inseparable from destination policy.

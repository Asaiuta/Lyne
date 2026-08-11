# Server remote-fetch hardening design

## Design goal

Represent the three trust classes explicitly and enforce each class at the
boundary that owns enough information to do so:

1. local filesystem paths canonicalize through `validate_path`;
2. request-supplied HTTP(S) media URLs use the public remote URL policy;
3. configured WebDAV scans require a persisted `source_key` plus a path within
   that source, and may intentionally target LAN/private hosts.

The implementation must not turn a preflight-only check into a claim that the
subsequent decoder fetch is protected from DNS rebinding or redirects.

## Boundaries

### Request-supplied media URLs

`src/server/path_security.rs` remains the single owner of URL syntax, scheme,
userinfo, traversal, ambiguous numeric host and private-address checks.
Playlist HTTP(S) entries must call this same validator before they can be
returned or persisted. `webdav://` and `webdavs://` playlist entries are not
accepted because a playlist does not carry a configured source identity.

DNS and redirect validation must execute in the HTTP client that opens the
media. The locked `audio-engine-core` revision `b7bc799` constructs its own
reqwest clients and exposes no redirect/fetch-policy hook. A separate
resolve-before-fetch in this repository would block Actix workers, race the
decoder's independent resolution, and still miss redirect hops. Therefore this
repository will not add that misleading preflight. The task stays open until a
core hook can validate every resolved address and redirect destination.

### Configured WebDAV scans

A WebDAV library scan must name an existing `source_key`. Its `path` is a
source-relative browse path, never an arbitrary absolute URL. This keeps LAN
NAS configurations working without weakening the request-supplied URL policy
and removes the fallback from unclassified input to global WebDAV credentials.

The later `08-07-webdav-credential-origin-binding` task still owns redirect and
response-href origin containment. This task only ensures that traversal starts
from an explicit configured source and terminates.

### Raw NCM proxy

The raw NCM adapter consumes and discards the `proxy` parameter and never copies
`Query.proxy` into `RequestOption`. `realIP` accepts one syntactically valid
IPv4 address. `ua` accepts bounded visible ASCII. The normal domain allowlist,
cookie behavior and response envelopes remain unchanged.

## WebDAV traversal

Traversal uses a stack of `(path, depth)` plus a normalized visited set.
Normalization:

- parses absolute hrefs structurally when present;
- removes query/fragment material from relative hrefs;
- percent-decodes path bytes;
- normalizes separators, dot segments and trailing slashes;
- folds ASCII case conservatively so case aliases cannot defeat cycle checks.

Bounds are deliberately generous: depth 64, 100,000 listed entries and one
hour total scan time. A depth-bound branch is skipped. Entry/time bounds stop
the traversal and return a partial result.

Partial completion is a distinct persistence mode. It inserts/refreshes seen
memberships, retains unseen existing memberships, clears the temporary seen
set, and marks the root `partial`. A complete scan keeps today's stale-member
cleanup. This prevents a safety bound from deleting tracks that were simply
not reached.

## Compatibility

- Local scans and direct local playback retain existing behavior.
- Existing frontend rescans already send a stored `source_key` for WebDAV
  roots. Source-less absolute/leading-slash remote scan requests are rejected
  instead of inheriting default WebDAV credentials.
- HTTP(S) playlist entries remain supported after the shared policy check;
  source-less WebDAV-scheme playlist entries are rejected.
- NCM callers in `apps/desktop` do not send `proxy`, `realIP` or `ua` raw
  overrides.

## Rollback points

The changes are separable by contract: NCM override handling, playlist URL
validation, scan-root classification, traversal limits and partial-finalize
persistence. Reverting one does not require reverting unrelated dirty-worktree
changes. The core hook is not implemented or simulated in this repository.

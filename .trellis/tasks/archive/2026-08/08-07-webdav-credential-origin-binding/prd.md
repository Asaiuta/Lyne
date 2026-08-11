# Bind WebDAV credentials to configured source origins

## Goal

Ensure stored WebDAV Basic Auth credentials are sent only to the configured
WebDAV source that owns a media URL. Public/NCM/playlist URLs, cross-origin
WebDAV `href` values, and redirect targets must never receive unrelated WebDAV
credentials.

## Current Evidence

- `load_validated_path_for_playback`, persistent-queue playback/preload, and
  loudness analysis unconditionally clone credentials from the default
  `webdav_config` before opening any URL
  (`src/server/playback/queue_state.rs:188-203`, `322-338`, `555-562`;
  `src/server/playback/loudness_handlers.rs:40-49`). There is no URL/source
  origin comparison.
- The pinned `audio-engine-core` revision from `Cargo.lock` attaches every
  supplied `HttpCredentials` value with `reqwest::RequestBuilder::basic_auth`
  to HEAD, GET, and range requests (`decoder/source.rs:194-228`, `324-331`,
  `384-427` in revision `b7bc7998384a9eb2feb1306ed7f5392a61c1061d`).
- `parse_propfind_response` accepts an absolute `http(s)` `href` and
  `build_full_url` returns it verbatim (`src/webdav.rs:292-321`, `413-427`). A
  WebDAV library scan then opens that URL with the configured source credentials
  (`src/server/playback/library_scan.rs:839-879`).
- Multiple WebDAV sources are persisted, but queue rows carry only a source
  path. Falling back to one global default credential set cannot safely select
  credentials for arbitrary stored URLs.
- The remotely reachable compatibility core revision
  `4c39d7b1c8d7488e97f77ce7a6a65318e36f60de` defaults existing decoder opens
  to a public-only address policy and exposes an explicit trusted-origin policy.
  Pinning it before this task lands would reject legitimate LAN WebDAV playback.
- The desktop does not currently use the WebDAV browse endpoint for playback;
  indexed WebDAV tracks already have durable `library_root_memberships` linked
  to a `library_roots.source_key`. This identity can seed direct library loads
  and queue persistence without guessing from an arbitrary request URL.
- `/queue_next` still accepts raw username/password fields. The desktop does
  not send them, so the secure contract can remove that authority and accept an
  optional persisted `source_key` instead.

## Confirmed Decisions

1. A typed media-source access value owns credentials and the core HTTP address
   policy together. Player/analysis APIs do not accept bare credentials.
2. WebDAV authority comes only from an explicit persisted `source_key` or an
   unambiguous library membership. URL-origin matching alone never grants
   credentials to a request-supplied URL.
3. Persistent queue rows store an optional `source_key`. Existing rows remain
   valid and may resolve through their media membership; ambiguous ownership
   fails closed instead of choosing the default WebDAV source.
4. Structured URL parsing enforces normalized scheme/host/effective-port and
   configured collection containment for WebDAV hrefs. Cross-origin hrefs,
   embedded userinfo, encoded parent traversal and collection escapes are
   rejected.
5. WebDAV PROPFIND follows only same-origin redirects. Decoder redirects use
   the core trusted-origin policy: same-origin LAN hops keep trust, cross-origin
   hops return to public-only validation and must not receive Basic Auth.

## Requirements

1. Introduce one credential resolver that binds credentials to a concrete
   configured WebDAV source identity and normalized origin (scheme, host, and
   effective port). Public/NCM URLs and unmatched URLs resolve to no credentials.
2. Preserve multi-source behavior. Queue playback, gapless preload, loudness
   analysis, scan, and direct load must resolve the owning source rather than
   blindly using the default source. If durable source identity is needed after
   queue persistence/restart, extend the domain contract explicitly rather than
   guessing from global state.
3. Parse WebDAV `href` values with a structured URL API. Same-origin absolute
   hrefs may be normalized to the configured source representation; cross-origin
   hrefs, embedded credentials, and paths escaping the configured collection
   boundary must be rejected or skipped with an observable diagnostic.
4. Redirect handling for credentialed WebDAV requests must re-evaluate the
   destination before every hop and must not forward Basic Auth across origin.
   Coordinate the decoder-client hook with `07-02-server-fetch-hardening` and
   the pinned `audio-engine-core` dependency rather than duplicating clients.
5. Keep private/LAN WebDAV sources supported. The fix is credential scoping and
   redirect/href validation, not a blanket public-IP requirement for configured
   sources.
6. Passwords/cookies remain absent from serialized domain responses and logs.

## Acceptance Criteria

- [x] A public or NCM URL opened while WebDAV is configured receives no WebDAV
      Authorization header in direct load, queue playback/preload, and loudness
      paths.
- [x] A URL owned by the selected configured WebDAV source still authenticates
      and works across direct load, queue/restart, scan, and analysis paths.
- [x] Parser tests reject cross-origin absolute hrefs, embedded credentials,
      collection escape, and encoded/trailing-slash aliases; same-origin valid
      hrefs normalize to one identity.
- [x] Local mock-server tests prove Basic Auth is not forwarded to a cross-origin
      redirect target and is preserved only for allowed same-origin hops.
- [x] Multi-source tests prove two sources cannot receive each other's
      credentials and persisted queue playback resolves the correct owner.
- [x] Focused WebDAV/player/server tests and both root and pinned-core checks pass.

## Implementation Outcome

- `MediaSourceAccess` now carries credentials, address policy, and source cache
  identity as one player-owned value.
- Migration 13 persists `source_key` and `source_identity`; queue navigation,
  status changes, preload publication, and promotion use exact entry identity.
- WebDAV hrefs and PROPFIND redirects are structurally constrained to the
  configured origin and collection; public/NCM queues persist explicit public
  authority and cannot inherit a later WebDAV membership.
- Root dependency is pinned to
  `5389c32f66c52c2d0b870acdeae4b20cf9c9de47`; its HTTP-policy tests cover
  same-origin auth preservation and rejected redirect boundaries.

## Out Of Scope

- General DNS/private-address validation and NCM proxy override removal, owned
  by `07-02-server-fetch-hardening`.
- Redesigning the user-facing WebDAV account model beyond the source identity
  required for correct credential selection.

## Open Questions

None. The remaining design choices are determined by the existing persisted
source model, the compatible core API, and the fail-closed acceptance criteria.

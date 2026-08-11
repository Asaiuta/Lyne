# Server: remote-fetch hardening (redirect/DNS SSRF, NCM proxy override, WebDAV scan cycles)

## Goal

Harden the remote-fetch surface: make private-network checks survive redirects and DNS tricks, stop the NCM proxy from routing the session cookie through client-chosen hosts, and bound WebDAV library scans. (Review findings S2, S3, C2, C3.)

Context: the server binds localhost with bearer auth, so these are defense-in-depth hardening items, not open holes — implement without breaking legitimate WebDAV/NCM flows.

## Requirements

**R1 — SSRF checks must survive redirects and DNS (S2, MAJOR-hardening).**
`src/server/path_security.rs:107-147` validates by string/IP-literal only. Bypasses: public hostname resolving to a private IP; and `reqwest` default redirect-following (public URL 302 → `http://127.0.0.1:...`). Affected entry points: `/load`, `/queue_next`, `/scan_loudness`, `/automix/analyze` (any URL-accepting endpoint). Additional affected surface (2026-07-03): `audio_cache::download_blocking`, arriving with the feat/ncm-url-resilience merge — a default redirect-following outbound download where the NCM URL is validated once up front but redirect hops are unvalidated.
Required: (a) resolve the hostname and validate ALL returned IPs against the private/loopback denylist before fetching; (b) in the HTTP fetch paths used for remote media (locate where reqwest clients/decoder opens are built for these URLs), disable auto-redirects or install a redirect policy that re-validates each hop with the same checks. Prefer the **re-validate-each-hop policy over `Policy::none`**: the NetEase CDN commonly answers with 302s, so refusing all redirects would break legitimate NCM playback. **Two-repo seam (2026-07-03):** the remote-media fetch client is built INSIDE audio-engine-core, not in this repo (`source.rs:132-134, 317-319, 557` — has timeouts but no redirect policy; `webdav.rs:143` PROPFIND likewise follows redirects by default) — hardening those requires the core-side policy hook being designed by 07-02-remote-range-seek; cross-reference that task and 07-03-core-dep-integration (which owns bumping the pinned core rev) instead of duplicating the work here. Exemption: explicitly-configured WebDAV sources are user-trusted destinations — validated at configure time, their own host must stay reachable even if it IS a LAN/private address (that's the point of WebDAV on a NAS). Scope the hardening to *request-supplied* URLs, keeping user-configured sources working.

**2026-08-07 audit delta:** local M3U/PLS URL entries are another request-reachable
source. `playlist.rs:180-190` validates only the scheme, then
`playlist_handlers.rs:14-23` can persist the URL into the playback queue. These
entries must use the same remote URL policy before acceptance. Persisted queue
rows and any other indirect URL source must not become a validation bypass.
WebDAV credential-to-origin binding and cross-origin href handling are owned by
`08-07-webdav-credential-origin-binding`; keep the redirect-policy integration
shared, but do not duplicate credential-selection logic here.

**R2 — NCM proxy override allowlisting (S3, MINOR).**
`src/server/netease/proxy/request.rs:128-131`: `/api/netease/*` accepts `proxy=<url>` (plus `realIP`, `ua`) per request; `proxy.rs:50` injects the persisted account cookie — so `?proxy=http://evil` exfiltrates the session. Domain overrides are already allowlisted (request.rs:153-176).
Required: drop the per-request `proxy` override entirely (preferred, unless the frontend uses it — grep apps/desktop) or allowlist it like domains. Review `realIP`/`ua` while there; header-ish injections are lower risk but cap their length/charset.

**R3 — WebDAV library scan must terminate (C2, MINOR).**
`src/server/playback/library_scan.rs:837-861`: stack-based walk guards only `child_path != path`, no visited set; detached spawn_blocking with no timeout — a server whose PROPFIND hrefs alias an ancestor loops forever.
Required: visited `HashSet` (normalized path), a depth cap (generous, e.g. 64), and an entry-count cap or overall deadline consistent with how loudness scans are bounded. The visited-set key MUST be **normalized hrefs** — percent-encoding decoded to a canonical form, case folded where the server is case-insensitive, trailing slash normalized — otherwise trivially aliased hrefs (`/a/`, `/a`, `/%61`) bypass the set and the cycle guard is decorative. On hitting a bound: log + finish gracefully with partial results, not error-out.

**R4 — remote-root validation and classification (C3 + absorbed from 06-08-server-netease-proxy-path-security).**
Absorbed requirement (2026-07-03, that task is closed as superseded by this one — this is the stronger, mandatory form): remote scan roots currently **skip `validate_path` entirely** — `library_domain_handlers.rs:1115-1125` classifies leading-`/` and `http(s)://` inputs as remote and passes them through unvalidated. These MUST be validated via `validate_remote_media_url` (same SSRF checks as R1); a comment or cfg-gate alone does NOT satisfy this requirement.
Original C3 part: leading-`/` treated as remote is correct on Windows only — add a comment and a cfg-aware guard so a future non-Windows build doesn't route Unix paths to the WebDAV scanner.

Clarification from the 2026-08-07 audit: an `http(s)` scan root must pass the
remote URL validator. A leading-`/` value is not itself a URL; accept it only as
a relative path within an explicitly selected/configured WebDAV source. On
non-Windows targets an absolute local path must remain a local path. Do not pass
an unclassified leading-`/` value through as a generic remote root.

## Acceptance Criteria

- [x] Unit tests: hostname-resolving-to-private rejected; redirect-to-private rejected (mock/loopback test server if the harness allows, else policy-level tests in the core client); configured WebDAV source on a LAN IP still accepted.
- [x] `proxy` override removed/allowlisted; frontend still works (grep evidence that nothing used it, or the allowlist covers what did).
- [x] Scan-cycle test: synthetic cyclic listing terminates with partial results; aliased hrefs (encoding/case/trailing-slash variants) do not bypass the visited set.
- [x] Remote scan roots: source-less HTTP(S) and Windows leading-slash inputs are rejected before generic WebDAV credential selection, while source-relative paths with a configured WebDAV source remain accepted.
- [x] M3U/PLS URL entries and persisted indirect URL sources use the same remote
      URL/DNS/redirect policy as direct load; private or ambiguous URL entries
      are rejected before queue persistence.
- [x] `cargo test --locked` green; clippy has no new task warnings (the remaining diagnostics are pre-existing repository baseline warnings).

## Constraints

- Do NOT break: user-configured WebDAV sources on private IPs; NCM's normal domain flow; localhost cover-art fetches by the frontend (those go to our own server, not through these validators — verify).
- DNS resolution for validation should use the same resolution the fetch will use where practical (resolve-then-connect-to-resolved-IP is the airtight version; document if you implement the weaker resolve-then-revalidate due to reqwest API limits).
- 06-08-server-netease-proxy-path-security is CLOSED as superseded by this task (2026-07-03): its overlapping scope maps to R1/R2/R4 here (+ 07-02-server-token-log); its strongest item — mandatory validation of remote scan roots — is absorbed into R4 above.

## Execution Boundary (2026-08-07 revalidation, resolved 2026-08-11)

- At revalidation time the locked core revision `b7bc799` constructed remote
  decoder clients internally and exposed no redirect/DNS policy hook. The
  compatible core policy is now integrated at reachable revision
  `5389c32f66c52c2d0b870acdeae4b20cf9c9de47`, so R1 is enforced in the client
  that performs DNS resolution and redirect following rather than by a racing
  application preflight.
- Persisted WebDAV source-origin propagation is integrated by
  `a275babb`; callers pass one `MediaSourceAccess` carrying both credentials
  and the trusted-origin policy through playback, preload, reopen, loudness,
  AutoMix and library scan paths.
- Remote WebDAV library scans require an explicit persisted `source_key` and a
  source-relative browse path. Source-less absolute URLs and leading-`/`
  pseudo-remote paths are rejected instead of inheriting global credentials.
- If a traversal bound produces a partial scan, finalization must preserve
  existing unseen memberships. Running the complete stale-member cleanup after
  a partial walk is a correctness defect and does not satisfy R3.

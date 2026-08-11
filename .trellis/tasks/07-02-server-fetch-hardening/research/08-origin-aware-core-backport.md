# Origin-aware core HTTP policy backport

Date: 2026-08-08

## Why the first core fix could not be integrated

The previously verified core commit `1bd3f2a` was built on a newer core API,
while AudioPlayer's Git dependency is still locked to `b7bc799`. More
importantly, applying a public-only destination rule to every credentialed HTTP
decoder would break a legitimate product flow:

- `scan_webdav_library` loads a persisted WebDAV source configuration;
- the configured source may intentionally be a LAN/private NAS;
- each returned `entry.url` is opened by `StreamingDecoder` with credentials;
- credentials alone do not prove that the URL is a trusted configured origin.

The correct boundary is therefore an explicit origin policy, not a global
private-address exception and not an implicit "credentials mean trusted" rule.

## Compatible implementation

A compatibility branch was created from the exact locked revision:

- branch: `fix/audioplayer-http-fetch-policy`;
- base: `b7bc799`;
- local commit: `4c39d7b fix(decoder): enforce HTTP address policies`.

The backport introduces public `HttpAddressPolicy` and keeps existing decoder
open methods source-compatible:

- existing open methods default to `PublicOnly`;
- `open_with_http_policy` / `open_path_with_http_policy` accept an explicit
  policy;
- `trusted_origin(url)` permits private resolution only for the exact parsed
  scheme/host/port from persisted configuration;
- same-origin redirects retain that trust;
- cross-origin redirects return to the public-address policy;
- changing only the trusted host's scheme or port is rejected instead of
  inheriting trust;
- Range probing, initial prefetch, later seek reads and full-download fallback
  all carry the same policy;
- policy clients disable ambient proxies with `no_proxy()` and preserve
  reqwest's ten-hop redirect limit;
- policy failures remain non-retriable and do not fall through to a second
  download path;
- the existing public `NetworkError` variants remain unchanged.

Reserved-address coverage includes IPv4 private/loopback/link-local,
documentation, carrier-grade NAT and benchmarking ranges, plus IPv6 mapped,
NAT64, 6to4, discard-only, documentation, benchmarking, deprecated site-local
and other non-public ranges. The `3fff::/20` boundary is represented exactly;
it does not over-reject the rest of `3fff::/16`.

The core directory and error-handling specs were updated with the module and
origin-policy contracts.

## Validation evidence

All commands below exited 0 after the origin-aware refactor in the compatibility
worktree:

- `cargo fmt --all -- --check`;
- `cargo check --offline`;
- `cargo clippy --offline --all-targets --all-features -- -D warnings`;
- `cargo clippy --offline --all-targets --no-default-features -- -D warnings`;
- focused `http_policy` tests: 8 passed, covering reserved ranges, DNS
  `localhost`, direct loopback literals, redirect-to-loopback with no second
  request, trusted LAN access, same-origin trusted redirects, and scheme/port
  trust boundaries;
- `cargo test --offline --all-features`: 237 unit tests passed; doctests had 1
  pass and 1 intentional ignore;
- `cargo test --offline --no-default-features`: 221 unit tests passed; doctests
  had 1 pass and 1 intentional ignore;
- HTTP-only and loudness-db-only `cargo check --offline` feature builds passed;
- `RUSTDOCFLAGS="-D warnings" cargo doc --offline --no-deps --all-features`
  passed;
- AudioPlayer `cargo check --offline` passed in a disposable verification
  worktree with a local path dependency on this backport.

The AudioPlayer path-dependency check proves source compatibility only. It does
not prove LAN WebDAV runtime compatibility because current AudioPlayer decoder
calls still pass credentials without the persisted source origin.

## Remaining integration boundary

Do not update the main AudioPlayer `Cargo.toml` or `Cargo.lock` yet. Two
conditions remain:

1. `4c39d7b` must be reachable from the configured remote Git dependency; it is
   currently a local branch commit and was not pushed.
2. AudioPlayer must propagate a trusted policy from a persisted WebDAV source
   identity/origin through scan, playback, preload, seek recovery and analysis
   decoder opens. This must align with
   `08-07-webdav-credential-origin-binding`; deriving trust from request
   credentials would recreate an authority-confusion bug.

Until both are complete and runtime-tested, R1 remains locally implemented but
not integrated into the shipped dependency.

## Resolution

The persisted source-origin propagation was completed by
`08-07-webdav-credential-origin-binding` in AudioPlayer commit `a275babb`.
The compatible maintenance branch then advanced to
`5389c32f66c52c2d0b870acdeae4b20cf9c9de47`; the earlier `4c39d7b` backport is
historical evidence and is superseded rather than the revision to pin.

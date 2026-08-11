# Core HTTP address policy

Date: 2026-08-08

## Revalidation

The actual remote media requests still originate in
`D:\AI\audio-engine-core\src\decoder\source\http.rs`. Range capability probes,
initial prefetches, later seek reads, and bounded full-download fallback all
flow through one `reqwest::blocking::Client` builder. AudioPlayer therefore
cannot close R1 with an Actix-side DNS preflight: that would race the resolver
used for the real connection and would not cover redirect hops.

The core checkout was on `chore/gate2-legacy-public-surface`. Its only
pre-existing dirty item was the untracked
`.trellis/tasks/08-01-replace-string-errors-with-typed-errors/prd.md`; it was
preserved and excluded from the security commit.

## Implementation

Core commit `1bd3f2a fix(decoder): reject private HTTP destinations` adds the
policy at the shared client boundary:

- a custom reqwest resolver checks every returned address before handing the
  same address set to the connector;
- IP literals are checked before request construction because they may bypass
  DNS resolution;
- loopback, RFC1918/private, link-local, multicast, documentation, carrier-grade
  NAT, benchmarking, IPv4-mapped private, and otherwise reserved ranges are
  rejected;
- a custom redirect policy parses and resolves every target before following
  it, while retaining normal public CDN redirects;
- Range requests and full-download fallback use the same builder and policy;
- blocked resolver/redirect errors are non-retriable and do not enter the
  non-Range fallback;
- the existing public `NetworkError` surface was not expanded. The rejection
  stays in the current `Other` compatibility boundary so this security task
  does not overlap the separate typed-error/API-gate work.

The tracked core backend spec was updated with the same resolver and redirect
contracts.

## Regression evidence

All of these commands exited 0 in `D:\AI\audio-engine-core`:

- `cargo fmt --check`;
- `cargo check --locked` (production resolver configuration);
- `cargo clippy --locked --all-targets --message-format=short`;
- focused HTTP tests: 14 passed, including `localhost` DNS rejection, reserved
  IPv4/IPv6 classification, and a real loopback response redirecting to
  `127.0.0.1` with no second request;
- `cargo test --locked`: 457 library tests, 20 benchmark-support tests, 2 public
  API tests, 22 resampler-support tests with 1 intentional ignore, 3 Windows
  deployment tests, and 6 doctests passed;
- `cargo test --locked --no-default-features --features rubato`: 485 library
  tests, 20 benchmark-support tests, 2 public API tests, 25 resampler-support
  tests with 1 intentional ignore, 3 Windows deployment tests, and 6 doctests
  passed.

`cargo clippy --locked --all-targets -- -D warnings` remains blocked by one
pre-existing feature-conditional unused variable at
`benches/resampler_comparison_support/mod.rs:428`, emitted once for the bench
and once for its test wrapper. No warning points to the touched HTTP/error
files; the unrelated benchmark was not changed.

## Remaining integration boundary

AudioPlayer still depends on remote `audio-engine-core` branch `main` and its
lockfile still records `b7bc799`. The core local `main` is already 32 commits
ahead of `origin/main`; the current core branch is a further 5 commits ahead
after the security commit. Updating AudioPlayer's lockfile cannot select
`1bd3f2a` until an intentional remote branch integration/push makes that commit
reachable from the configured dependency.

R1 therefore has a verified local core implementation but is not yet closed in
the shipped AudioPlayer dependency. Do not replace the dependency with a
committed local path override and do not claim remote integration from a local
Cargo patch check.

## Resolution

This research records the pre-integration state. The compatible policy was
subsequently completed on the locked-base maintenance line and superseded by
the origin-aware revision `5389c32f66c52c2d0b870acdeae4b20cf9c9de47`; see
Research 09 and Research 10 for the final integration evidence.

# Server remote-fetch hardening implementation plan

## 1. Evidence and activation

- [x] Recheck URL, playlist, NCM and WebDAV control flow against current source.
- [x] Verify the desktop does not send raw NCM `proxy`, `realIP` or `ua` overrides.
- [x] Verify the locked and current core implementations have no redirect/fetch-policy hook.
- [x] Run focused unchanged-baseline tests and record results in Research.
- [x] Validate planning artifacts and activate the task.

## 2. In-repository policy fixes

- [x] Make the remote HTTP(S) validator reusable by playlist validation.
- [x] Route HTTP(S) playlist entries through the shared validator and reject source-less WebDAV schemes.
- [x] Remove raw NCM proxy routing and validate `realIP`/`ua` overrides.
- [x] Require a configured WebDAV `source_key` for remote library scans and reject unclassified remote roots.

## 3. Bounded WebDAV traversal

- [x] Add normalized visited-path tracking with encoded/case/trailing-slash alias coverage.
- [x] Add depth, listed-entry and total-duration bounds.
- [x] Add partial-finalize persistence that preserves unseen existing memberships.
- [x] Expose partial status/reason in the stored scan result without changing the success/error envelope.

## 4. Tests and quality gate

- [x] Add focused URL/playlist/NCM/scan-classification/traversal/persistence tests.
- [x] Run `cargo fmt --check`.
- [x] Run `cargo test --locked path_security -- --nocapture`.
- [x] Run `cargo test --locked playlist::tests -- --nocapture`.
- [x] Run `cargo test --locked server::netease::tests -- --nocapture`.
- [x] Run `cargo test --locked webdav -- --nocapture`.
- [x] Run focused library-scan and app-database tests.
- [x] Run `cargo clippy --locked --all-targets -- -D warnings` or document any unrelated baseline blocker.
- [x] Run `cargo test --locked` if the focused checks pass.

## 5. Closeout

- [x] Update Research with implementation and validation evidence.
- [x] Update backend specs with the reusable source-trust and partial-scan contracts.
- [x] Commit only task-owned product files; preserve the 219-entry dirty baseline.
- [x] Close the R1 residual after the core-side DNS/redirect hook, persisted
      source-origin propagation and AudioPlayer lockfile integration are tested.

## 6. Core HTTP policy integration

- [x] Implement resolver-result and IP-literal checks in the core client used by Range and full-download paths.
- [x] Revalidate every redirect target before following while retaining public CDN redirects.
- [x] Add hostname-to-private and redirect-to-loopback regression tests.
- [x] Run default and no-HTTP/Rubato-only core test matrices and commit the core change locally.
- [x] Reuse the persisted source-origin propagation owned by
      `08-07-webdav-credential-origin-binding`; do not duplicate its credential
      resolver or infer private-origin trust from credentials alone.
- [x] Publish the compatible core commit on a remote maintenance branch without
      changing remote `main`.
- [x] Refresh AudioPlayer's lockfile to that reachable revision and rerun the
      AudioPlayer quality gate.

## Risky files and rollback

- `src/app_database/library_memberships.rs`: partial finalize must never run stale cleanup.
- `src/server/playback/library_scan.rs`: bounds must not convert cancellation/network failures into success.
- `src/server/playback/library_domain_handlers.rs`: source classification must preserve local absolute paths on non-Windows targets.
- `src/server/netease/proxy/request.rs` and `registry.rs`: cookie/domain behavior must remain unchanged.

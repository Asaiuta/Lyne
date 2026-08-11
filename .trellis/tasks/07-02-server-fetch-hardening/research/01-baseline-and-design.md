# Baseline and design research

Date: 2026-08-07

## Worktree and task state

- Branch: `feat/desktop-lyric`.
- Baseline: 219 uncommitted entries belonging to existing user work.
- The task started in `planning` with `prd.md` only; none of the product files
  inspected for this task appeared in the scoped dirty-status check.
- Previous remediation commit: `a3f7ae1 build(desktop): harden release debug artifacts`.

## Confirmed source facts

### Remote media policy

- `validate_remote_media_url` performs syntax and literal-host checks only and
  is private to `path_security.rs`.
- Direct load, queue, loudness, automix and persistent queue inputs call
  `validate_path`; playlist URL entries bypass it and validate only schemes.
- The locked core dependency is `b7bc799`. Its Range and full-download clients
  use default reqwest redirects. The current local core main also has no
  redirect/fetch-policy hook.
- A blocking DNS preflight in the Actix handler would not bind the decoder's
  later independent resolution and would not cover redirects. It is rejected
  as a false-complete fix.

### NCM raw overrides

- `apply_query_overrides` copies arbitrary `proxy`, `realIP` and `ua` strings
  into `Query`.
- `request_option_from_query` forwards those values together with the active
  cookie.
- Desktop source search found no raw override callers. The settings proxy UI is
  unrelated presentation scaffolding and does not send these request fields.

### WebDAV root and traversal

- `LibraryScanRequest` already carries `source_key`; rescans pass a stored
  root's `source_key`.
- The handler currently treats every HTTP(S) string and, on every platform,
  every leading `/` as WebDAV without validating source identity.
- The scan falls back to global/default WebDAV credentials when `source_key`
  is absent.
- Traversal only checks `child_path != path`; it has no normalized visited set,
  depth/entry bound or total deadline.

### Partial-finalize correctness

- `finalize_library_root_scan` removes every membership absent from the
  temporary seen set and then deletes orphaned media/dependent state.
- Therefore a bounded traversal cannot call the complete finalizer after an
  early stop: doing so would misclassify unvisited tracks as deleted.
- The correct partial mode must add/refresh seen memberships, retain unseen
  memberships, clear temporary state, and mark the root partial.

## Chosen approach

- Reuse one public HTTP(S) input validator for direct and playlist inputs.
- Require explicit configured-source identity for WebDAV scans; do not add an
  `allow_private` boolean to the generic URL validator.
- Remove NCM proxy routing at both extraction and request-option boundaries;
  validate the remaining header-like overrides.
- Add traversal normalization/bounds together with safe partial persistence.
- Leave credential-to-origin and response-href containment to
  `08-07-webdav-credential-origin-binding`.
- Keep core DNS/redirect protection as an explicit residual until the core
  client exposes and consumes a per-hop policy.

## Unchanged-baseline validation

All commands exited 0:

- `cargo test --locked path_security -- --nocapture`: 7 passed.
- `cargo test --locked playlist::tests -- --nocapture`: 5 passed.
- `cargo test --locked webdav -- --nocapture`: 14 passed.
- `cargo test --locked server::netease::tests -- --nocapture`: 43 passed.

No live upstream service, external account or real user database was used.

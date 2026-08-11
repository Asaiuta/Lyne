# Quality gate and residual

Date: 2026-08-07

## Scoped lint correction

- `cargo clippy --locked --all-targets` initially identified two warnings in
  code added by this task: the query/fragment character split and the WebDAV
  progress interval modulo check.
- Both were behavior-preserving standard-library substitutions:
  `split(['?', '#'])` and `is_multiple_of(LOCAL_SCAN_PROGRESS_INTERVAL)`.
- A structured Clippy diagnostic pass over all 13 task-owned product files
  found only warnings on code already present in `HEAD` after those changes.
  No lint suppression or unrelated cleanup was added.

## Final validation

All of these commands exited 0:

- `cargo fmt --check`.
- `cargo clippy --locked --all-targets`.
- `cargo test --locked path_security -- --nocapture`: 7 passed.
- `cargo test --locked playlist::tests -- --nocapture`: 6 passed.
- `cargo test --locked server::netease::tests -- --nocapture`: 45 passed.
- `cargo test --locked webdav_ -- --nocapture`: 15 passed.
- `cargo test --locked library_scan -- --nocapture`: 16 passed.
- `cargo test --locked partial_scan_finalize_preserves_unseen_memberships -- --nocapture`:
  1 passed.
- `cargo test --locked`: 380 passed.
- Scoped `git diff --check` over the 13 product files.

`cargo clippy --locked --all-targets -- -D warnings` remains blocked by the
existing repository baseline. The post-fix structured run exited 101 with 66
library and 76 library-test diagnostics. Representative categories are
`too_many_arguments`, `manual_repeat_n`, `field_reassign_with_default`,
`duplicated_attributes`, and `manual_strip`. The strict gate has two fewer
diagnostics in each target than the pre-fix run because the task-owned warnings
were removed; changing the remaining baseline is outside this task.

## Cross-layer review

- Request HTTP(S) inputs and configured WebDAV inputs now have distinct typed
  branches; no boolean `allow_private` escape hatch or default-credential
  fallback was introduced.
- Playlist, NCM, WebDAV handler, traversal, database finalization and task-result
  paths preserve their existing response envelopes.
- Partial traversal selects partial persistence before stale cleanup. The outer
  analysis task remains `success` so existing polling terminates, while its
  result and the root record expose `partial` explicitly.
- The final scoped diff contains no debug print, lint allow, placeholder, or
  unrelated formatting change.

## Open residual

R1 is not complete. The locked `audio-engine-core` revision builds the actual
remote decoder clients internally and exposes no DNS/redirect policy hook.
Adding a separate Actix DNS preflight would race the real fetch and miss later
redirects, so this repository intentionally does not claim hostname rebinding
or per-hop redirect protection.

The task must remain open until the core client validates every resolved address
and redirect destination and AudioPlayer integrates that revision. WebDAV
credential-to-origin binding remains owned by
`08-07-webdav-credential-origin-binding`.

## Submission decision

The 13 product files are appropriate for an open-source commit: they fix
request-boundary security, bounded traversal, and data-preservation behavior,
and include regression tests. Trellis task artifacts, local outputs, generated
tool state, and unrelated dirty-worktree files must remain uncommitted.

Committed as `dbe79c4 fix(server): harden remote fetch boundaries`. The commit
contains exactly the 13 reviewed product files and was not pushed.

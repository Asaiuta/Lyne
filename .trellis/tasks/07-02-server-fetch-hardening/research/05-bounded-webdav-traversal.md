# Bounded WebDAV traversal and partial persistence

Date: 2026-08-07

## Traversal contract

- The production walk now uses a reusable traversal driver with a normalized
  visited set and a stack of `(path, depth)`.
- Visit keys parse absolute hrefs structurally, remove query/fragment data,
  percent-decode path bytes, normalize slash and dot segments, remove trailing
  slash aliases and fold ASCII case.
- Production bounds are depth 64, 100,000 listed entries and one hour. A depth
  overflow skips that branch; entry and time bounds stop the walk.
- Cancellation and directory-list failures remain errors. Bounds return a
  successful partial result with a stable reason and warning log.

## Persistence contract

- Complete finalize retains the existing stale-membership removal and orphan
  cleanup behavior.
- Partial finalize shares the same transactional seen-membership upsert and
  source-kind/NCM filtering, but does not query/delete stale memberships or
  invoke media cleanup.
- Partial finalize counts all retained plus newly seen memberships, clears the
  temporary seen set and sets `library_roots.scan_status = 'partial'`.
- The stored scan result includes `scan_status` and `partial_reason`. The task
  remains a terminal `success` so the existing frontend success/error poller
  still terminates; the HTTP envelope is unchanged.

## Validation

- `cargo fmt --check`: passed.
- `cargo test --locked webdav_ -- --nocapture`: 15 passed.
- `cargo test --locked library_scan -- --nocapture`: 16 passed.
- `cargo test --locked partial_scan_finalize_preserves_unseen_memberships -- --nocapture`:
  1 passed.
- The synthetic cycle feeds `/A/`, `/%61`, `/a` and an absolute URL alias into
  the actual traversal driver; only root and one child are listed.
- Bound tests cover skipped depth, two-of-three entry processing at the entry
  cap and a zero-duration deadline. The database regression proves an unseen
  old member survives beside a newly seen member with zero cleanup.

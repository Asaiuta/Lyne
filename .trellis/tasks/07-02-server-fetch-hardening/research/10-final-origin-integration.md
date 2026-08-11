# Final origin-aware core integration

Date: 2026-08-11

## Integration evidence

- AudioPlayer commit `a275babb29b896db84802d4c209636480b0dd26f` completed the
  persisted WebDAV source-origin contract. `MediaSourceAccess` carries
  credentials, `HttpAddressPolicy::trusted_origin` and `source_key` together;
  public/NCM/playlist inputs remain `public_only`.
- The contract is propagated through direct load, persistent queue replay and
  restart, both gapless preload implementations, streaming source open and
  recovery, loudness analysis, AutoMix analysis and WebDAV library indexing.
  No production remote path falls back to a credential-only decoder open.
- `Cargo.toml` and `Cargo.lock` both pin
  `audio-engine-core` to
  `5389c32f66c52c2d0b870acdeae4b20cf9c9de47`.
- The exact revision is reachable from `origin/fix/automix-http-policy` in the
  core checkout. It supersedes the earlier locked-base backport `4c39d7b`.

## Validation

With the Windows native library path set to the existing core build output:

- `cargo check --locked --tests`: passed;
- `cargo test --locked path_security -- --nocapture`: 7 passed;
- `cargo test --locked playlist::tests -- --nocapture`: 6 passed;
- `cargo test --locked server::netease::tests -- --nocapture`: 45 passed;
- `cargo test --locked webdav -- --nocapture`: 25 passed;
- `cargo test --locked source_access -- --nocapture`: 10 passed;
- `cargo test --locked library_scan -- --nocapture`: 16 passed;
- `cargo test --locked partial_scan_finalize_preserves_unseen_memberships -- --nocapture`: 1 passed;
- `cargo test --locked`: 428 passed;
- `cargo clippy --locked --lib --tests --message-format=short`: exit 0.

`cargo fmt --check` remains blocked by unrelated formatting changes already
present in `src/bench_gate.rs` and `src/bench_provenance.rs`; no task-owned
formatting drift appears in `a275babb` (`git diff --check` passes).

## Closeout state

R1 is now closed in the shipped dependency. The task remains `in_progress` in
Trellis until the user explicitly requests archival; no generated output or
unrelated dirty-worktree file is part of this task's evidence commit.

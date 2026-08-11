# Remote backport and integration order

Date: 2026-08-08

## Remote state revalidation

The dependency relationship was checked against the live GitHub refs before
integration:

- AudioPlayer's lockfile revision is `b7bc799`;
- `origin/main` is now `0c62feb` and is 90 commits ahead of that locked base;
- the compatible security backport is one commit ahead of the locked base;
- directly refreshing the existing `branch = "main"` dependency would therefore
  combine this security fix with 90 unrelated core commits and newer API
  changes.

The minimal maintenance branch was pushed without changing remote `main`:

- remote branch: `fix/audioplayer-http-fetch-policy`;
- exact commit: `4c39d7b1c8d7488e97f77ce7a6a65318e36f60de`;
- base: `b7bc7998384a9eb2feb1306ed7f5392a61c1061d`.

AudioPlayer can now use an exact `rev` pin instead of a floating maintenance
branch once its WebDAV caller contract is ready.

## Why the lockfile is intentionally unchanged

The new core API defaults every existing decoder open method to the public-only
address policy. That is correct for request-supplied/NCM/playlist URLs, but the
current AudioPlayer call graph still passes only `HttpCredentials` for WebDAV.
It does not carry the persisted source origin through direct load, persistent
queue playback, gapless preload, loudness/AutoMix analysis, or source reopen.

Pinning `4c39d7b` now would compile, but configured LAN WebDAV playback and
indexing would be rejected at runtime. Treating any credentialed URL as trusted
would avoid that regression only by recreating the credential-authority bug.

## Ownership and required order

The complete source selection contract is already owned by
`08-07-webdav-credential-origin-binding`. It must resolve a URL to one persisted
WebDAV source (or none), bind credentials to that source's normalized
scheme/host/effective-port, preserve multi-source behavior, and reject
cross-origin href/redirect authority. This task must reuse that result rather
than introduce a second resolver.

Required order:

1. complete the source-origin/credential propagation owned by
   `08-07-webdav-credential-origin-binding`;
2. pin AudioPlayer's `audio-engine-core` dependency to exact rev `4c39d7b...`;
3. run the full AudioPlayer quality gate plus LAN-WebDAV and public redirect
   regression tests;
4. only then close R1 and this task.

Current status is therefore: the core fix is reviewed, tested, committed and
remotely reachable; product integration remains deliberately pending to avoid
a known runtime regression.

## Resolution (2026-08-11)

The required order is now complete. AudioPlayer commit `a275babb` propagates
the persisted source identity and trusted origin through direct load, queue
replay, gapless preload, stream recovery, loudness, AutoMix and WebDAV scan.
`Cargo.toml` and `Cargo.lock` pin the reachable maintenance revision
`5389c32f66c52c2d0b870acdeae4b20cf9c9de47` on
`fix/automix-http-policy`. The earlier `4c39d7b` compatibility backport is
superseded by this final revision.

The AudioPlayer integration gate passed:

- `cargo check --locked --tests`;
- focused path, playlist, NCM, WebDAV, source-access, library-scan and partial
  finalize tests;
- `cargo test --locked`: 428 passed;
- `cargo clippy --locked --lib --tests --message-format=short`: exit 0.

The only non-green repository check is `cargo fmt --check`, which reports
formatting drift in unrelated dirty files `src/bench_gate.rs` and
`src/bench_provenance.rs`; the integrated commit itself is clean under
`git diff --check`.

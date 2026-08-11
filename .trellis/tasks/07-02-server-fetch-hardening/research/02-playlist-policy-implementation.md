# Playlist policy implementation

Date: 2026-08-07

## Implemented contract

- `validate_remote_media_url` remains the single private owner of the remote
  host policy. Playlist validation reaches it through the existing
  `validate_path` boundary, so no broader API surface was needed.
- M3U/PLS HTTP(S) entries are passed through the same `validate_path` callback
  as direct loads before the entries can be returned to the handler.
- Source-less `webdav://` and `webdavs://` entries are rejected. A playlist
  entry has no persisted WebDAV source identity and therefore cannot safely
  select credentials or inherit a configured LAN trust boundary.
- Added `percent-encoding` as a direct dependency for the next bounded-scan
  phase. Version `2.3.2` was already present transitively in `Cargo.lock`.

## Design notes

- The playlist module retains only format-specific scheme classification. It
  does not copy host, private-address, credential or traversal rules from
  `path_security`.
- Local relative paths still resolve against the playlist directory and then
  use the same supplied validator as before.
- This closes the pre-persistence playlist bypass, but it does not claim DNS
  rebinding or redirect-hop protection; those remain owned by the core fetch
  client integration described in the task boundary.

## Validation

- `cargo fmt --check`: passed.
- `cargo test --locked playlist::tests -- --nocapture`: 6 passed, including a
  regression proving `http://127.0.0.1/...` is rejected by the shared policy.
- `cargo test --locked path_security -- --nocapture`: 7 passed.
- The first playlist compile exposed a test-only reference to the private
  `path_security` module. The test was corrected to use the existing
  `crate::server::validate_path` re-export; the rerun passed.

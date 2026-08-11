# WebDAV root classification

Date: 2026-08-07

## Implemented contract

- Library scan roots are represented as `Local { path }` or
  `WebDav { path, source_key }`. The type no longer permits a WebDAV scan
  without source identity.
- With a `source_key`, the request path must be a valid source-relative WebDAV
  browse path. Absolute URLs, other schemes, traversal, backslashes, control
  characters and paths above 4096 bytes are rejected.
- The handler verifies that the named source exists and is configured before
  creating a library root or spawning work.
- Without a `source_key`, HTTP(S) input is rejected. On Windows a leading `/`
  is also rejected rather than being reclassified as remote. On non-Windows
  the same leading-slash form continues through local canonicalization.
- `scan_webdav_library` now requires `&str` source identity and cannot fall
  back to the process-global/default WebDAV credentials.

## Single-source cleanup

- WebDAV source-key syntax and length are owned by `webdav::normalize_source_key`.
- WebDAV browse-path syntax and length are owned by
  `webdav::validate_browse_path` and reused by both browse and scan handlers.
- The temporary crate-visible change to `validate_remote_media_url` was
  removed after classification showed there was no valid consumer: absolute
  URLs are not browse paths, and a `pub(crate)` app function cannot protect the
  separate core HTTP client.

## Validation

- `cargo fmt --check`: passed.
- `cargo test --locked webdav -- --nocapture`: 14 passed.
- `cargo test --locked library_scan_root -- --nocapture`: 2 passed.
- Classification tests cover source-relative WebDAV input, source-less
  loopback/public HTTP(S), absolute URL rejection even with a source key,
  Windows leading-slash rejection and non-Windows local-path routing.

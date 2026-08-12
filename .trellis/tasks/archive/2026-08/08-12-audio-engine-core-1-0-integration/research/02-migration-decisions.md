# Migration Decisions (audio-engine-core 1.0.1)

Source of truth: the pinned core sources, extracted read-only from rustdoc into
`target/coresrc/` (gitignored). Direct reads of `D:\AI\audio-engine-core` are
blocked by the agent sandbox, so `cargo doc --no-deps -p audio-engine-core`
plus HTML-to-source extraction was used instead. The core repo is untouched.

## D1 - Application HTTP policy after `HttpAddressPolicy` removal

`StreamingDecoder::open_with_http_policy` and `HttpAddressPolicy` are gone. The
core's `decoder::source::http` module now owns destination policy
unconditionally:

- a custom `reqwest` DNS resolver rejects loopback/private/link-local/CGNAT/
  reserved addresses before connecting,
- `redirect::Policy::custom` re-resolves and re-validates every redirect hop and
  errors instead of following a rejected one,
- `validate_literal_host` rejects literal private IPs on the initial request.

There is no core opt-in for private destinations any more, so AudioPlayer cannot
"pass a policy" through the decoder. The application boundary keeps what it
still owns and can enforce:

- `validate_path()` (unchanged) still rejects loopback/userinfo/traversal for
  request-supplied URLs,
- `resolve_media_source` / `resolve_queue_media_source` still decide which
  configured source may attach credentials, and normalize the URL against that
  source's origin and collection path,
- `MediaSourceAccess` still binds credentials to one configured source and is
  the only place credentials are produced.

`MediaSourceAccess::address_policy()` is therefore removed rather than
re-implemented, and `trusted_origin` keeps validating that the configured origin
is an HTTP(S) URL with a host. Net effect on policy: redirect/DNS/private-address
enforcement is *stricter* than before (always on, no trusted-origin bypass).

Known consequence, recorded rather than hidden: a WebDAV source configured on a
LAN/private address can no longer be opened by the core decoder. That is a core
1.0 policy change, not something to work around by weakening the boundary.

## D2 - `MediaLocation` conversion lives on `MediaSourceAccess`

`MediaSourceAccess::media_location(path)` is the single conversion helper for
every decoder/AutoMix/loudness call site, so `http://`/`https://` detection is
not duplicated across `loading.rs`, `gapless.rs`, `analysis.rs`,
`library_scan.rs`, `automix_handlers.rs`, and `playback_config.rs`.

## D3 - Loudness cache identity

Core loudness APIs now take `&LoudnessSourceIdentity` instead of `&str`.

- `MediaSourceAccess::loudness_identity(path)` returns
  `LoudnessSourceIdentity::from_location(&self.media_location(path)?)`.
- The per-configured-source namespacing that `cache_key()` provides is **not**
  applied to loudness identities. `LoudnessDatabase::needs_scan` reports every
  HTTP row as stale by policy (no ETag/validator evidence is stored), so
  `get_fresh` can never serve a cached HTTP measurement to the wrong source.
  For local paths the identity must stay pristine, because `needs_scan` uses
  `local_path()` mtime/size as its freshness evidence.
- `cache_key()` is retained unchanged for the decoded/resampled PCM disk cache,
  which does cache real content and therefore still needs source separation.

`TrackLoudness` lost `track_id`/`file_path`; JSON responses now use
`source.cache_id()` and `source.display_label()`.

## D4 - Cancellation tokens

`DecodeCancelToken::new()` takes no arguments. Sites that already own an
`Arc<AtomicBool>` (player load cancel, analysis cancel registry) use
`DecodeCancelToken::from_flag(flag)`; sites with no external flag use `new()`.

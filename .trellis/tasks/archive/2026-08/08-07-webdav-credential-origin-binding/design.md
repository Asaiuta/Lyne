# WebDAV credential-origin binding design

## Design goal

Make it impossible for playback code to carry WebDAV credentials without also
carrying the configured origin that authorizes them. Public/NCM/playlist URLs
remain public-only, while a persisted WebDAV source can explicitly trust its
own LAN origin.

## Trust model

The application recognizes three source classes:

1. local paths: no HTTP credentials or address policy is used;
2. request-supplied HTTP(S): no WebDAV credentials and the core public-only
   address policy;
3. configured WebDAV media: credentials plus a trusted-origin policy derived
   from one persisted `source_key` and its normalized `base_url`.

An arbitrary URL cannot acquire class 3 by matching a configured host. The
authority must be explicit or come from a durable library membership.

## Typed access boundary

Add a player-owned `MediaSourceAccess` value with private fields:

```rust
pub struct MediaSourceAccess {
    credentials: Option<HttpCredentials>,
    address_policy: HttpAddressPolicy,
}
```

Constructors expose only `public_only()` and a crate-private configured WebDAV
constructor. Decoder opens receive both fields from the same value. Direct
loads, normal queue playback, gapless preload, source reopen, loudness,
AutoMix, and library indexing all pass this type instead of independent
credential options.

## Source resolver

A single server-side resolver accepts `path` plus an optional persisted
`source_key`:

- explicit key: load that source, require the URL to be inside its normalized
  origin and collection path, then build trusted access;
- no explicit key: query library memberships for the media identity; exactly
  one owning WebDAV source may build trusted access;
- no owning source: return public-only access;
- multiple source identities: fail closed and require an explicit key.

The resolver never falls back to `AppState.webdav_config` and never derives
trust from raw username/password input.

## Queue persistence

Migration 13 adds nullable `source_key` and a non-null `source_identity` enum
(`infer`, `public`, or `webdav`) to `playback_queue_entries`. The source key has
a foreign key that clears it when a configured source is deleted. Queue record
selects and insert/update paths carry both fields. Explicit public/NCM queues
remain public even if their URL later gains a WebDAV membership; configured
rows preserve their exact source; legacy rows remain `infer` and use the
resolver's unambiguous membership fallback during playback.

Queue responses need not expose credentials. `source_key` may be serialized as
non-secret provenance; existing desktop parsers tolerate additive fields.

## WebDAV URL and redirect handling

`WebDavConfig` parses its base URL with `reqwest::Url`. A returned href is
resolved structurally, rejects userinfo/query/fragment, normalizes percent
encoding and dot segments for containment, requires the same
scheme/host/effective-port, and must remain below the configured collection
path. The normalized absolute URL and source-relative href are produced from
the same parsed value.

The PROPFIND client uses a same-origin redirect policy and `no_proxy()` so
ambient proxy configuration cannot redirect credentials. Cross-origin
redirects fail before a second authenticated request. Decoder traffic delegates
DNS and redirect-hop behavior to core revision
`5389c32f66c52c2d0b870acdeae4b20cf9c9de47`; same-origin hops keep trust while
every changed destination is revalidated before a request is sent.

## Compatibility and migration

- Existing local and public queue rows keep `source_key = NULL`.
- Existing indexed WebDAV rows recover identity from library memberships.
- Existing desktop playback payloads remain valid; optional `source_key` is
  additive for `/load`, analysis, queue and preload requests.
- Raw `/queue_next` username/password fields are removed from the Rust request
  contract; unknown legacy JSON fields are ignored and never used.
- LAN WebDAV remains supported only through configured source identity.

## Rollback points

The work is separable into schema/source resolution, WebDAV href enforcement,
player access propagation, and core pinning. If integration fails, revert the
core pin and typed call-site commit together; never retain a pin where LAN
WebDAV calls still use the public-only default.

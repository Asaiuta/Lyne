# NCM override hardening

Date: 2026-08-07

## Implemented contract

- Raw `proxy` input is removed from merged request parameters and discarded;
  it no longer populates `Query.proxy`.
- The final `RequestOption` builder sets `proxy: None` even if an internal
  caller constructs a `Query` containing a proxy. This keeps the account
  cookie and request-selected network destinations from being combined.
- `realIP` and `real_ip` are both consumed. A non-empty value must parse as an
  IPv4 address and is stored in canonical dotted-decimal form.
- A non-empty `ua` is trimmed, limited to 512 bytes and restricted to printable
  ASCII, including normal spaces but excluding control characters.
- Existing domain allowlisting, cookie precedence, response envelopes and
  route dispatch remain unchanged.

## Scope evidence

- Desktop source search found no raw `proxy`, `realIP`, `real_ip` or `ua`
  request override caller. Network proxy settings text in the desktop is not
  wired to these raw NCM parameters.
- The settings/UI files were therefore not changed.

## Validation

- `cargo fmt --check`: passed.
- `cargo test --locked server::netease::tests -- --nocapture`: 45 passed.
- New tests cover discarded proxy input, final-option defense in depth,
  canonical valid IPv4, rejected IPv6/hostname/invalid IPv4, control/non-ASCII
  user agents and the 512-byte user-agent limit.

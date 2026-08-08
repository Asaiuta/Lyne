# Server: stop logging bearer token in request lines + CORS null origin

## Goal

Stop the per-run API bearer token from being persisted into log files, and drop the `"null"` origin from the default CORS allowlist. Lightweight task (PRD-only).

## Requirements (review findings S1, S4)

**R1 — token must not reach logs (S1, MAJOR).**
`src/server/auth.rs:109-111` accepts `?token=<secret>` as auth fallback (needed for `<img>` cover-art URLs which can't send headers). `src/server.rs:563` uses `middleware::Logger::default()`, whose `%r` logs the full request line including the query string — so every cover-art request writes the token to the log directory. Fix: replace `Logger::default()` with a custom format/redaction so the logged request line never contains the `token` query parameter value (redact just the token param, or log path-without-query; keep method/status/timing). Redaction must cover all routes, not just cover art.

**R2 — drop `"null"` from default allowed origins (S4, MINOR).**
`src/config.rs:573-580` default origin list includes `"null"`, and `src/server.rs:566-584` honors list entries with `supports_credentials()`. `Origin: null` is producible by any sandboxed iframe. Remove `"null"` from the default list. If `"*"` is honored as match-anything, make `"*"` disable credential support (or document why not). Keep the Tauri/localhost origins working — check what origins the desktop webview actually sends before removing anything beyond `"null"`.

## Acceptance Criteria

- [ ] With a debug run (or a unit test on the log-format function), a request containing `?token=SECRET` produces a log line without `SECRET` in it.
- [ ] `"null"` no longer in the default origin list; frontend still connects (WS + HTTP + cover art render) — verify via existing tests/typecheck plus a manual or scripted smoke if available.
- [ ] `cargo test` (workspace) passes; no new clippy warnings in touched files.
- [ ] No change to auth semantics: query-token fallback still works for `<img>` requests.

## Constraints

- Do not change the token scheme itself (per-run token + timing-safe compare stays).
- Frontend `client.ts` `?token=` URL construction stays as-is in this task (it's the necessary <img> mechanism); a follow-up comment there about never logging query strings is welcome but optional.
## 归档一致性注记（2026-08-08）

- 本 PRD 验收框未勾选：该任务归档时未附逐条验收证据（无 validation-evidence.md 或实现验证记录）。
  出于元数据真实性，本任务保留未勾选状态，不作为"已验收"伪证；如需补验，请重新打开任务并补充证据。

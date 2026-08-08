# Frontend/Tauri: enable CSP + constrain delete_file command

## Goal

Restore defense-in-depth in the Tauri shell: a real CSP instead of `null`, and a `delete_file` command that can no longer delete arbitrary absolute paths. (Review finding 2, MAJOR.)

## Requirements

**R1 — real CSP (finding 2a).**
`apps/desktop/src-tauri/tauri.conf.json:27` has `"csp": null` while the main window renders remote NCM-derived content (covers, comments, wiki) and the app deliberately supports user-provided custom JS via `new Function` (`src/shared/styles/customAppearance.ts:253-264`, enabled at boot).
Required: define a CSP that (a) allows the app bundle, Vite dev server in dev, the localhost sidecar (HTTP + WS + images with ?token), and the remote image/media hosts actually used (audit what domains covers/lyrics/avatars load from — NCM CDN domains, plus user WebDAV hosts which can be arbitrary → `img-src` may need broad https: + http: for LAN NAS; document the tradeoff); (b) keeps `script-src` tight (`'self'` + whatever Tauri IPC needs; SolidJS needs no eval). The custom-JS feature uses `new Function` — that requires `'unsafe-eval'` in script-src. Decision: gate it — include `'unsafe-eval'` ONLY if that's the accepted cost of the feature; preferred: keep the feature working (it's deliberate) and document that script-src carries 'unsafe-eval' for it, while everything else is locked down. Verify styles: UnoCSS runtime/custom-appearance may need `'unsafe-inline'` in style-src (typical for this stack).
Verification matters more than strictness on paper: the app must fully work (dev + build) with the CSP on — broken covers/lyrics/WS are unacceptable.

**R2 — constrain `delete_file` (finding 2b).**
`apps/desktop/src-tauri/src/main.rs:95-109` deletes any absolute path (`is_file()` is not a safety boundary), invokable from any app window.
Required: the command must only delete files the app legitimately manages. Find the caller(s) in the frontend (grep `delete_file`) to learn the actual use case (likely: deleting library media files). Constrain server-side-of-the-shell: e.g. require the path to be inside a known library root / validated by the sidecar (the sidecar knows the library), reject directories, symlinks, UNC tricks, and system paths. If validation truly needs library knowledge only the sidecar has, consider moving deletion to a sidecar endpoint (already authenticated) and shrinking the Tauri command away entirely — pick the smaller diff that closes the hole without breaking the feature.

## Acceptance Criteria

- [ ] `"csp"` is a real policy; app fully functional under it: dev run loads, covers render, WS connects, lyrics show, custom-appearance JS still executes (if kept), settings pages work. Evidence: manual smoke via tauri dev if the environment allows, else a documented checklist of what each directive permits and why, plus typecheck/build green.
- [ ] `delete_file` (or its replacement) rejects: paths outside allowed roots, directories, and relative-path tricks — unit-tested in Rust where practical.
- [ ] Frontend callers updated if the command signature/flow changed; `npm run typecheck` green; `cargo check` (src-tauri) green.
- [ ] No regression to the desktop-lyric overlay window (its capability set untouched or consciously updated).

## Constraints

- Do not remove the custom-JS user feature without asking — it's deliberate; the task is containment, not amputation.
- WebDAV cover art may load from arbitrary user hosts — if `img-src` ends up broad, note that the CSP's main value here is script/connect containment, which is where the review's concern lies.
- Coordinate with frontend-lyric-fixes changes in src-tauri/main.rs — run AFTER it lands to avoid conflicts.
## 归档一致性注记（2026-08-08）

- 本 PRD 验收框未勾选：该任务归档时未附逐条验收证据（无 validation-evidence.md 或实现验证记录）。
  出于元数据真实性，本任务保留未勾选状态，不作为"已验收"伪证；如需补验，请重新打开任务并补充证据。

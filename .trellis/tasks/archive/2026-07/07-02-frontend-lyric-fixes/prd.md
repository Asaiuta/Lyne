# Frontend: desktop-lyric lifecycle (zombie overlay) + per-frame tick + overlay perf

## Goal

Fix the desktop-lyric overlay defects found in the 2026-07-02 review before this branch (feat/desktop-lyric) merges: the unclosable zombie overlay on main-window exit, the tick channel silently running at 60Hz IPC instead of the designed 500ms, and overlay render-loop efficiency issues.

## Requirements (review findings 1, 8, 9, 10, 4, 5)

**R1 — No zombie overlay (finding 1, MAJOR).**
`WindowControls.tsx:118` exits via `currentWindow.close()` (main window only); `src-tauri/src/main.rs:617-628` has no window-event handler tying the overlay's lifetime to the main window; the overlay's close button only does `emitTo("main", ...)` (`desktopLyricBridge.ts:27-31`), which has no listener once main is gone. Result: exiting the app with the overlay open leaves an always-on-top unclosable window + running sidecar + dead tray (`restore_main_window` no-ops, main.rs:525-539).
Required: (a) in main.rs, when the `main` window is destroyed, close the `desktop-lyric` window (or exit the app — match existing tray/exit semantics); (b) the overlay's close control must also work standalone (call `getCurrentWindow().close()` directly as fallback; its capability already grants `core:window:allow-close`).

**R2 — Tick emission must honor the 500ms design (finding 8, MAJOR perf).**
`useDesktopLyricBridge.ts:154-159`: the play/pause-transition effect calls `buildTick()`, which reads `options.position()` (= `playback.displayPosition`, a per-rAF signal via `playbackDisplayClock.ts:150-157`). Solid tracks the read → the effect re-runs ~60×/s and `emitTo("desktop-lyric", tick)` fires per frame while active, defeating `TICK_INTERVAL_MS` and the overlay's `DRIFT_THRESHOLD` re-anchoring; even with overlay closed, the effect body runs per frame.
Required: the effect must track only the play/pause transition (e.g. `isPlaying()`), reading position inside `untrack()`. Steady-state emission stays on the 500ms interval.

**R3 — Overlay render loop efficiency (findings 9, 10, MINOR perf).**
`DesktopLyricApp.tsx:199-223`: marquee effect does `querySelector` + `scrollWidth`/`clientWidth` reads per rAF tick (forced layout at 60Hz) — measure once per active-line change (and on resize), keep only progress→transform math per frame. `DesktopLyricApp.tsx:169-174,278`: the rAF loop reschedules unconditionally — stop while `playing()` is false / no lyrics, restart on transitions.

**R4 — Overlay position restore must clamp on-screen (finding 5, MINOR).**
`desktopLyricBridge.ts:73-83` restores raw `PhysicalPosition` from localStorage; after monitor removal/resolution change the frameless skip-taskbar overlay can be permanently off-screen. Clamp against available monitors or reset when out of bounds.

**R5 — Seed bridge `active` state from reality (finding 4, MINOR).**
`useDesktopLyricBridge.ts:49` starts `active=false` on every main-window load; after a dev reload / webview recovery with the overlay open, the toggle shows off and ticks stop. `desktop_lyric_is_open` (desktop_lyric.rs:63-66) is registered but never invoked — call it once on mount to seed `active`.

## Acceptance Criteria

- [ ] Exiting the main window with the overlay open closes the overlay too (verified in `npm run tauri dev` or a debug build); tray/exit semantics unchanged otherwise.
- [ ] Overlay close button works even if the main window is already gone.
- [ ] With overlay active and music playing, `emitTo(..., 'tick')` fires at the interval cadence (≈2Hz), not per frame — verified by counting emissions over a few seconds (temporary counter/log during dev, removed before commit) or by a unit test on the effect's tracked dependencies.
- [ ] Marquee: no per-frame `scrollWidth`/`clientWidth` reads; measurements happen on active-line change/resize only.
- [ ] Overlay rAF loop idles when paused/no lyrics; resumes on play.
- [ ] Overlay restores on-screen after a stored position that is out of bounds.
- [ ] `active` reflects an already-open overlay after main-window reload.
- [ ] `npm run typecheck` passes; existing frontend tests pass (`npm test` or the project's runner); `cargo check` in apps/desktop/src-tauri passes.

## Constraints

- This is the active feature branch (feat/desktop-lyric) with other in-flight work in the tree — touch only the files needed, commit only those.
- Follow the frontend spec conventions (.trellis/spec/frontend/index.md): accessor props, no `any`, no leftover console.log, preview/commit settings split untouched.
- Keep the existing bridge protocol (`track`/`tick`/`control`/`ready` events) — no protocol redesign in this task.
## 归档一致性注记（2026-08-08）

- 本 PRD 验收框未勾选：该任务归档时未附逐条验收证据（无 validation-evidence.md 或实现验证记录）。
  出于元数据真实性，本任务保留未勾选状态，不作为"已验收"伪证；如需补验，请重新打开任务并补充证据。

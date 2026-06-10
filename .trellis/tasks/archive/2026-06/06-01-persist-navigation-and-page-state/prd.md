# Persist Navigation And Page State Across Reload

> Source: frontend review finding **ARCH-1** (priority P1, most user-perceivable defect).

## Goal

Make the in-app navigation state survive a reload / hot-reload / crash-recovery so the user is no longer thrown back to the home page (`recommend`) with all in-page state reset. Today navigation is 100% in-memory: `activePage`, the back/forward `historyStack`, the selected playlist, and per-page state (tabs, search term, scroll position) are all plain signals that reset on every app (re)launch.

## Requirements

- Persist the current `activePage` and restore it as the initial value on startup, replacing the hardcoded `createSignal<ActivePage>("recommend")` (`app/useNavigationController.ts:80`).
- Persist `selectedPlaylistId` so a reload on a playlist page restores that playlist (or cleanly falls back to its parent page if the playlist no longer exists).
- Persist the key navigation request seeds that decide what a page shows on entry: `discoverTabRequest.tab`, `likedCollectionTabRequest.tab` (`useNavigationController.ts:82-107`).
- Persist per-page scroll position via the existing `PageSurface` scroll context so returning to a page restores the scroll offset.
- Validate restored values against the current `ActivePage` union (`shared/ui/navigation`) on startup; unknown/stale values must fall back to `"recommend"` rather than crash or show a blank page.
- Reuse the existing storage abstraction pattern (localStorage with the `fallbackUISettingsStorage` guard) from `shared/state/uiSettingsStorage.ts:453`; do not introduce a new persistence mechanism.
- The back/forward `historyStack` (`useNavigationController.ts:112`) restore is best-effort: at minimum the restored `activePage` must be a valid stack entry; full multi-entry history restoration is optional.

## Acceptance Criteria

- [ ] Reloading the app while on a non-home page (e.g. Library, a playlist, a Discover tab) restores that page instead of `recommend`.
- [ ] Reloading restores the active Discover / Liked-collection tab and the page scroll position.
- [ ] A persisted page/playlist that no longer exists falls back to `recommend` without error.
- [ ] No regression to back/forward (`canGoBack`/`canGoForward`) behavior within a session.
- [ ] `npm run typecheck` passes for `apps/desktop`.
- [ ] A focused test covers startup restore + stale-value fallback.

## Technical Approach

- Add a small `navigationPersistence` module (mirroring `uiSettingsStorage`) that reads/writes a namespaced key (e.g. `ui.nav.state`) holding `{ activePage, selectedPlaylistId, discoverTab, likedCollectionTab }`.
- In `useNavigationController`, seed the signals from the persisted snapshot (after validation) and write back through a debounced `createEffect` on the relevant accessors.
- For scroll, persist a `Record<ActivePage, number>` keyed by page and rehydrate inside `PageSurface` on mount.

## Decision (ADR-lite)

Context: Navigation is intentionally signal-based with no router library and no URL. That keeps routing simple but means every restart resets the whole UI to home.

Decision: Keep the signal-based router; add a thin persistence layer over the existing localStorage abstraction rather than adopting a router library or `history.pushState`.

Consequences: Startup reads one extra localStorage key and must defensively validate it. We gain reload/restore continuity without taking on a routing dependency or URL-encoding scheme.

## Out of Scope

- Introducing a hash/URL router or deep-linkable URLs.
- Encoding deep detail-view state (open artist/album/song-wiki views) — only top-level page + tab + scroll are persisted.
- Multi-window / multi-profile state separation.

## Technical Notes

- Relevant spec: `.trellis/spec/frontend/index.md`, `.trellis/spec/frontend/page-primitives.md`.
- Anchor files: `apps/desktop/src/app/useNavigationController.ts`, `apps/desktop/src/shared/ui/navigation.ts`, `apps/desktop/src/components/page/PageSurface.tsx`, `apps/desktop/src/shared/state/uiSettingsStorage.ts`.
- Existing persistence precedent to copy: `ui.theme.mode`, `ui.search.history`.

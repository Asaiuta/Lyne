# Introduce PlaybackContext To Remove Playback Prop-Drilling

> Source: frontend review findings **ARCH-2** (prop-drilling), **ARCH-3** (flat god-object controller), **ARCH-5** (FullPlayer ~40 props), priority P2. Maintainability debt, not a correctness bug.

## Goal

Collapse the playback wiring that is currently threaded by hand through props. The same ~8-12 playback callbacks/state (`onPlay`, `onPause`, `currentTrackPath`, `currentSongId`, `isPlaying`, `onRegisterPlayback`, `onNavigateToSongWiki`, …) are prop-drilled 3-4 layers (`App → NeteasePage → DiscoverMode → discoverShowcases`), `FullPlayer` receives ~40 props, and `useAppController` re-flattens its well-separated sub-controllers into one 90+ member object. Adding one playback callback today means editing 4 files.

## Requirements

- Create a `PlaybackContext` (`createContext`) that exposes the current playback context (current track path / song id / isPlaying / cover / title / lyrics / repeat / shuffle / volume) and the playback command callbacks, sourced from the existing `createPlaybackController` output.
- Consume `PlaybackContext` via `useContext` in the online subtree (`NeteasePage`, `DiscoverMode`, `discoverShowcases`, and the detail pages) instead of forwarding the same props through each layer (`features/online/NeteasePage.tsx:122-224` currently repeats ~10 props across 5 `<Match>` blocks).
- Refactor `FullPlayer` (`components/FullPlayer.tsx`) to read playback state/commands from context; `app/App.tsx:419-461` should pass only genuinely UI-local props (e.g. `isOpen`, `onClose`).
- Reshape `useAppController` (`app/useAppController.ts:48-140, 333-425`) to return grouped domain objects `{ playback, queue, navigation, ncm, ui }` instead of a flat 90+ member surface; update `App.tsx` consumers accordingly.
- Preserve SolidJS fine-grained reactivity: the context value must expose stable accessors/functions (not a re-created object per render) so consumers do not over-subscribe.

## Acceptance Criteria

- [ ] `NeteasePage` no longer forwards playback props to `DiscoverMode`/`discoverShowcases`; those components read from `PlaybackContext`.
- [ ] `FullPlayer`'s prop count is materially reduced (target: only UI-local props remain).
- [ ] `useAppController` returns grouped sub-controllers; `App.tsx` consumes them by group.
- [ ] No behavioral regression in play/pause, song-wiki navigation, or playback registration from online surfaces.
- [ ] `npm run typecheck` passes for `apps/desktop`.
- [ ] Focused playback tests still pass (update wiring as needed).

## Technical Approach

- Wrap the existing `createPlaybackController` product in a `PlaybackProvider` mounted high in `App.tsx`; expose a typed `usePlayback()` hook.
- Migrate one consumer subtree at a time (start with the online/Discover subtree, then `FullPlayer`) to keep diffs reviewable.
- Keep `useAppController` as the composition root but have it assemble grouped objects; this is a mechanical reshape, not a logic change.

## Decision (ADR-lite)

Context: The codebase deliberately avoids a "god Context" — global state is hook-composed and passed by props. That is sound, but the playback domain specifically is consumed so widely that prop-drilling has become the dominant maintenance cost.

Decision: Introduce exactly one domain Context for playback (not a catch-all app Context), leaving i18n/account/search/ui-settings Contexts and the hook-composition root intact.

Consequences: One new provider + hook. Playback field changes stop rippling through intermediate components. Risk is limited to wiring; behavior is unchanged.

## Out of Scope

- Introducing Contexts for queue / library / navigation (only playback is in scope).
- Changing playback logic, the WebSocket transport, or the command/seek semantics.
- Splitting `DiscoverMode` (tracked separately in `06-01-dedupe-media-actions-split-discovermode`).

## Technical Notes

- Relevant spec: `.trellis/spec/frontend/index.md`, `.trellis/spec/guides/code-reuse-thinking-guide.md`.
- Anchor files: `app/App.tsx`, `app/useAppController.ts`, `app/usePlaybackController.ts`, `components/FullPlayer.tsx`, `features/online/NeteasePage.tsx`, `features/online/modes/DiscoverMode.tsx`.
- Context precedent to mirror: `shared/state/NcmAccountContext.tsx`, `shared/state/UISearchContext.tsx`.
## 归档一致性注记（2026-08-08）

- 本 PRD 验收框未勾选：该任务归档时未附逐条验收证据（无 validation-evidence.md 或实现验证记录）。
  出于元数据真实性，本任务保留未勾选状态，不作为"已验收"伪证；如需补验，请重新打开任务并补充证据。

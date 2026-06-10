# Virtualize Discover Card Grids And Comment Lists

> Source: frontend review findings **PERF-1** (discover grids) and **PERF-2** (comment list), priority P2.

## Goal

Stop unbounded DOM growth on the two load-more lists that currently render with a bare `<For>` and never trim accumulated items: the Discover page's four card grids and the resource comment list. As the user pages further, these accumulate hundreds of nodes (each card/comment hosts an `SImage` with its own IntersectionObserver subscription), degrading mount and reconcile cost. Reuse the project's existing self-rolled virtualization rather than adding a dependency.

## Requirements

- Virtualize the four Discover card grids (playlists / artists / mvs / new-albums) in `features/online/modes/discoverShowcases.tsx:111-127, 194-208, 432-442, 513-524`, which grow by `DISCOVER_PAGE_LIMIT` (50) per load-more without trimming.
- Virtualize the comment list in `features/online/details/ResourceCommentsPanel.tsx:329-404`, which appends `PAGE_SIZE` (20) per load-more via `[...current, ...payload.comments]` and never trims.
- Reuse the existing visible-range algorithms rather than introducing `@tanstack/virtual`: follow `resolveMediaListVisibleRange` (`components/media/MediaList.tsx`) for variable layouts and/or `resolveQueueVisibleRange` (`features/queue/QueueDrawer.tsx`) for fixed-height rows.
- Grid virtualization must account for column count + row height (responsive columns); comment virtualization can assume near-uniform row height.
- Preserve all existing behavior: load-more / infinite scroll, click-through into detail views, `SImage` lazy-load + offscreen release, empty/loading/error states.
- Keep the `<For>` keying stable so visible cards/comments are not needlessly rebuilt while scrolling.

## Acceptance Criteria

- [ ] After several load-more pages on Discover, rendered card DOM nodes stay bounded to the visible window + overscan, not the full accumulated set.
- [ ] After several load-more pages of comments, rendered comment DOM nodes stay bounded similarly.
- [ ] Scrolling remains smooth and click-into-detail / play actions still work from a virtualized card/comment.
- [ ] `npm run typecheck` passes for `apps/desktop`.
- [ ] A focused test covers the new visible-range resolution for the grid (mirroring the existing `resolve*VisibleRange` tests).

## Technical Approach

- Factor a `resolveGridVisibleRange({ total, columns, rowHeight, scrollTop, viewportHeight, overscan })` helper next to the existing range helpers, returning `{ startRow, endRow, padTop, padBottom }`.
- Measure the viewport with the same `ResizeObserver` + rAF-coalesced `scrollTop` pattern already used in `MediaList`.
- For comments, prefer the fixed-height `resolveQueueVisibleRange` approach with a `translateY` spacer.

## Decision (ADR-lite)

Context: The project already owns three tested virtualization helpers (`MediaList`, `FullPlayerLyrics`, `QueueDrawer`), each with a threshold so small lists pay no virtualization cost. Discover/comments predate that pattern and were left on bare `<For>`.

Decision: Extend the existing in-house virtualization pattern to these two surfaces instead of pulling in a virtualization library, keeping the codebase dependency-light and consistent.

Consequences: One new grid range helper to maintain and test. Offscreen `SImage` already avoids image decode for hidden cards, so this change targets DOM-node/observer count, not image cost.

## Out of Scope

- Touching the already-virtualized local library song list (covered by `05-31-local-library-worker-virtualization`).
- Search-result grids that are limit-capped and do not accumulate (e.g. SearchMode `limit=30`).
- Visual redesign of cards or comments.

## Technical Notes

- Relevant spec: `.trellis/spec/frontend/index.md`, `.trellis/spec/frontend/image-component.md` (SImage contract).
- Reference implementations: `components/media/MediaList.tsx` (`resolveMediaListVisibleRange`), `features/queue/QueueDrawer.tsx` (`resolveQueueVisibleRange`), `components/player/FullPlayerLyrics.tsx`.
- Anchor files: `features/online/modes/discoverShowcases.tsx`, `features/online/details/ResourceCommentsPanel.tsx`.

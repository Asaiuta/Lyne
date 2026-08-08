# Refactor Local Library Songs To Worker Virtualization

## Goal

Move the local library songs tab off scroll-driven `/domain/library/view` range requests and onto the existing frontend library worker. The purpose is to remove wheel-scroll flicker, reduce backend/API pressure during scrolling, and keep the visible song list responsive for large local libraries.

## Requirements

- Load lightweight local-library summaries once through `getLibraryTrackSummaries` when the library view refreshes.
- Initialize `LibraryWorkerClient` with the summary rows and folder descriptors.
- For the songs tab, derive visible rows, total count, total size, folder options, all media ids, and full rows from the worker instead of making per-scroll `/domain/library/view` requests.
- Keep visible song rows summary-only: no `source_path` should be required for row rendering or normal playback.
- Preserve existing detail-only behavior for copy path, show in folder, delete, playlist add, and legacy path fallback via `trackKey` detail lookup.
- Keep artists/albums backed by the existing backend group endpoint for this task.
- Keep folders usable by fetching full rows from the worker when the folders tab needs a full list.
- Preserve existing sort, search, folder filtering, play-all, batch, and visible current-row behavior.
- Work with existing uncommitted UI changes in `MediaList.tsx` and `LibraryPage.tsx` without reverting them.

## Acceptance Criteria

- [ ] Scrolling the local songs tab no longer sends a backend request for every visible-range change.
- [ ] `MediaList` receives rows whose `virtualStart` matches the loaded worker slice.
- [ ] Play-all and per-row playback in the songs tab use worker-provided ordered `media_id[]`.
- [ ] Batch operations on the songs tab can request all rows from the worker.
- [ ] Folder filter uses folder paths/descriptors consistently with the existing folder tree.
- [ ] `npm run typecheck` passes for `apps/desktop`.
- [ ] Focused library tests pass or are updated to cover the new worker path.

## Technical Approach

- Treat `/domain/library/track_summaries` as the source-of-truth payload for the frontend worker index.
- Use the existing `LibraryWorkerClient` to initialize the worker, request visible slices, request full rows, and request ordered media ids.
- Adapt `LibraryWorkerRow` to `LibraryListItem` through a dedicated adapter that keeps the summary-only contract intact.
- Keep `/domain/library/view` in the API client for fallback and backend-owned contracts not removed in this task.

## Decision (ADR-lite)

Context: The old songs tab used `virtualRange` both as the requested backend range and as the rendered `virtualStart`. During wheel scroll, this allowed old rows to be rendered at a new offset while a new HTTP request was in flight, causing visible flicker and extra backend work.

Decision: Use the existing Web Worker as the scroll-time virtualization owner for local songs. Backend remains responsible for producing lightweight summaries and detail lookups; worker owns client-side filtering, sorting, folder filtering, range slicing, full row export, and ordered media ids.

Consequences: Initial local-library refresh transfers all lightweight summaries to the frontend worker, increasing startup memory and refresh cost relative to range-only loading. In exchange, scroll-time work avoids HTTP/DB round-trips and row/offset state can update atomically from worker results.

## Out of Scope

- Removing `/domain/library/view`.
- Rewriting artists/albums to worker-backed grouping.
- Changing local playlist storage or backend queue semantics.
- Visual redesign of the media list.

## Technical Notes

- Relevant spec: `.trellis/spec/frontend/index.md`.
- Existing worker files: `apps/desktop/src/features/library/libraryWorker.ts`, `libraryWorkerClient.ts`, `libraryWorkerProtocol.ts`.
- Current controller: `apps/desktop/src/features/library/libraryControllerViewState.ts`.
- Existing visible list component: `apps/desktop/src/components/media/MediaList.tsx`.
## 归档一致性注记（2026-08-08）

- 本 PRD 验收框未勾选：该任务归档时未附逐条验收证据（无 validation-evidence.md 或实现验证记录）。
  出于元数据真实性，本任务保留未勾选状态，不作为"已验收"伪证；如需补验，请重新打开任务并补充证据。

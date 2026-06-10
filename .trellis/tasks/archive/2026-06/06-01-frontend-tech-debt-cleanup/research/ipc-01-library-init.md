# IPC-01 Library Init Assessment

Date: 2026-06-01

## Question

Should `getLibraryTrackSummaries` -> `LibraryWorkerClient.init(...)` be changed now to a custom chunked init path?

## Current Shape

- `apps/desktop/src/shared/api/library.ts` loads `/domain/library/track_summaries` as one JSON response and validates all `tracks`.
- `apps/desktop/src/features/library/libraryControllerViewState.ts` sends the full parsed track array to `LibraryWorkerClient.init`.
- `apps/desktop/src/features/library/libraryWorkerClient.ts` posts one `INIT` message to the Web Worker.
- `apps/desktop/src/features/library/libraryWorker.ts` builds the worker-side haystack index and handles filter/sort/range queries.
- The backend already exposes `/domain/library/view` with range support and optional `media_ids`, implemented by `library_track_view` in `src/app_database/library_media.rs`.

## Existing Better Options Than Immediate Custom Chunking

1. Reuse the existing backend range view for first paint or large libraries.
   - The endpoint already returns filtered/sorted ranges plus folders/counts.
   - This avoids inventing a second chunk protocol while keeping a bounded response on the main thread.

2. Use browser-native transfer mechanisms if measurement points to worker transfer cost.
   - Web Worker `postMessage` uses structured clone; transferable objects can avoid copying for data represented as `ArrayBuffer`/typed arrays.
   - A custom row-object chunk protocol would still pay object allocation and clone overhead unless the data format changes.

3. Measure before changing architecture.
   - The suspected cost has two separable parts: response JSON parse/validation on the main thread, and worker `postMessage`/index build.
   - Chunking only helps some of that cost and can add ordering, cancellation, partial-ready, and error-state complexity.

## Decision

Defer IPC-01 in this cleanup task. Do not implement custom chunked init without measured evidence and a threshold.

Recommended follow-up if this becomes real:

- Add performance marks around request start/end, parse/validation, worker init post, worker READY, and first visible view result.
- Test against a large real or generated library snapshot.
- If cold-start first paint is the problem, prefer a hybrid:
  - request initial visible rows through `/domain/library/view`;
  - warm the worker index in the background;
  - switch songs-tab filtering to the worker once ready.
- If transfer cost dominates, evaluate a compact transferable index format instead of object chunks.

## PRD Acceptance Status

IPC-01 is explicitly deferred with rationale. It should graduate to its own measured performance task rather than being silently skipped or folded into this maintainability cleanup.

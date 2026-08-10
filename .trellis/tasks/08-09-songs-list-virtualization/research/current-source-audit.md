# Current source audit

Date: 2026-08-10

## Conflicting evidence

The archived `08-09-frontend-image-bitmap-audit` report measured the local
songs route at 19,353 nodes and 598/598 decoded images for 592 rows. That result
describes the runtime used by that audit.

Current source already contains virtualization:

- `apps/desktop/src/components/media/MediaList.tsx` computes a visible range,
  renders a spacer and translated row window, and exposes
  `data-virtualized="true"` above the threshold.
- `apps/desktop/src/features/library/LibraryTabContent.tsx` passes
  `totalCount`, `virtualStart` and `onVisibleRangeChange`.
- `apps/desktop/src/features/library/libraryControllerViewState.ts` requests the
  visible range from `LibraryWorkerClient` and stores the returned loaded range
  and rows.
- `apps/desktop/src/components/media/mediaListVirtualization.ts` currently uses
  a 120-item threshold, 90 px row height and 5-row overscan.

This source audit cannot prove runtime effectiveness. A production-equivalent
rebuild and CDP/process measurement is the next required evidence.

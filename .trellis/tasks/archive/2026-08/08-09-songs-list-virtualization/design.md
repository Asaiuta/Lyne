# Design: songs list virtualization verification

## Evidence boundary

The archived image audit measured 19,353 DOM nodes and 598 decoded images for
592 local songs. Current source already has two-level virtualization:

- `MediaList` derives a visible range from scroll position and viewport height.
- The local-library controller sends that range to `LibraryWorkerClient`.
- The worker result supplies only the loaded rows plus `totalCount` and
  `virtualStart` back to `MediaList`.

Therefore the archived result is a hypothesis to reproduce, not a current
baseline. A source change is allowed only after a current runtime sample proves
that the contract expands to the full result set or otherwise misses the
acceptance threshold.

## Measurement setup

1. Build the current dirty checkout through the Tauri build path so the shell
   includes `custom-protocol`; a plain `cargo build --release` is invalid.
2. Record Git HEAD, dirty fingerprint, binary path/hash, shell PID, WebView2
   descendant PIDs, viewport size, route and library item total.
3. Reuse the task-local CDP tooling contract from
   `.trellis/spec/frontend/runtime-performance-probes.md`. Attribute process
   memory only to the checkout-owned shell tree.
4. At the initial position and approximately 50% scroll, capture:
   `data-virtualized`, viewport `clientHeight` and `scrollHeight`, rendered
   `[role=row]` count, image element and decoded-image count, total DOM nodes,
   renderer working set and private bytes.
5. Keep the playback sidecar and unrelated WebView2 trees outside renderer
   attribution.

## Decision gate

- If both positions have no more than 2,500 DOM nodes and the rendered rows are
  bounded to the viewport plus overscan, declare the old baseline stale. Make
  no speculative frontend implementation change.
- If all or most rows are rendered, inspect the observed viewport height,
  emitted visible range, loaded worker range and returned row count. Fix the
  first broken contract with the smallest ownership-correct change.
- Do not replace worker-owned virtualization with a second full client-side
  list, and do not alter scan, SQL, image or observer behavior in this task.

## Behavioral contracts

The fix, if needed, must preserve sorting, filtering, refresh, selection across
scroll, current/playback row identity, context-menu anchoring, drag behavior,
keyboard navigation and lazy image decoding. Scroll updates may be frame
coalesced, but stale worker responses must never replace a newer requested
range.

## Validation

- Focused virtualization and library-worker tests.
- Desktop TypeScript typecheck and test suite.
- Runtime scroll through at least five viewports, selection persistence,
  current-row visibility, context menu and keyboard navigation checks.
- Initial and 50% screenshots plus machine-readable measurement JSON.
- A report that separates current absolute memory from any measured delta; no
  memory saving is claimed when there is no comparable failing baseline.

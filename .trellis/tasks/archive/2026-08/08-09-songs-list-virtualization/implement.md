# Implementation plan

## 1. Establish the current baseline

- [x] Build a production-equivalent Tauri shell with `custom-protocol`.
- [x] Launch it with checkout-owned CDP/process provenance.
- [x] Navigate to local library / songs and collect initial-position metrics.
- [x] Scroll to approximately 50% and collect the same metrics.
- [x] Write raw data and build/runtime provenance under `research/`.

## 2. Apply the measurement gate

- [x] Apply the measurement gate. The current baseline exceeded 2,500 nodes,
      so the skip-source branch was rejected and the failure was traced.
- [x] If full rendering reproduces, trace viewport geometry -> visible range ->
      worker request -> loaded range -> rendered rows.
- [x] Add a focused regression test for the proven failure before the smallest
      source correction.

## 3. Validate behavior and quality

- [x] Run focused `MediaList` virtualization and library worker/controller
      tests.
- [x] Run `npm run typecheck` and `npm test` in `apps/desktop`. (`npm test` has
      one documented unrelated Streaming v2 constant failure.)
- [x] Verify five-screen scrolling, no blank/flicker, selection persistence,
      context-menu placement, playback row and keyboard behavior.
      (Playback row N/A without an active measurement track; row keyboard and
      drag behavior are not implemented by the current component.)
- [x] Capture the first viewport and 50% position screenshots.

## 4. Record the result

- [x] Write `research/result.md` with absolute metrics and, only when a failing
      current baseline exists, a before/after memory delta.
- [x] Synchronize the parent/child Trellis acceptance state with actual
      evidence.
- [x] Mark complete without archiving; leave commit/archival decisions to the
      user.

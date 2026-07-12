# Shared-State Split Design Review

Reviewed 2026-07-11 against `.trellis/tasks/06-08-shared-state-split/prd.md`,
the current player state/callback implementation, and pipeline-v2 `design.md`.

## Verdict

`06-08-shared-state-split` has a valid problem statement but is not
implementation-ready. It has no `design.md`, and two PRD contracts conflict
with required playback behavior. The split should not begin as a mechanical
move of all `SharedState` fields.

## Blocking Findings

### 1. Global monotonic time conflicts with backward seek

The acceptance criterion requires `current_time_secs()` to remain monotonic
across seek boundaries. A successfully applied backward seek must move audible
time backward. The correct contract is:

- within one audible epoch/applied-seek serial, published audible time is
  monotonic non-decreasing;
- a backward seek may produce one intentional decrease only after the callback
  publishes the matching applied serial/result;
- stale callbacks from the prior serial may not move the new epoch forward or
  backward.

Tests must assert serial-scoped monotonicity, not global monotonicity.

### 2. One derived `position` is insufficient

The PRD says `position` should be derived from one render clock, but pipeline-v2
requires distinct meanings:

- requested frame + request serial for API/UI pending-seek state;
- audible frame + applied serial for producer reclaim and playback truth;
- render span + monotonic anchor for interpolation between callbacks.

These belong to one typed `PlaybackClock`, but must not be collapsed into one
atomic or one ambiguous `position`. API state may choose requested or audible
presentation explicitly; producer logic must use audible position only.

## High-Priority Design Gaps

### 3. Split boundaries and writers are unspecified

The PRD names example sub-structs but does not define, per field group:

- the single writer;
- allowed readers;
- publication order and memory ordering;
- whether fields are callback-hot, producer-hot, or cold diagnostics;
- reset/track-switch ownership.

The design must contain an ownership table before fields move.

### 4. Cache-line requirements are missing

Moving atomics into ordinary nested structs improves naming but can worsen false
sharing. Pipeline-v2 requires physically separate cache lines for window
identity, producer publication, callback publication, and seek mailbox. Layout
must be verified with size/offset tests. Cold telemetry must not share those
lines.

### 5. Migration order is too broad

"Split ~151 fields" is not a safe executable step. Recommended order:

1. land typed `PlaybackClock` publication/read APIs and explicit validity;
2. migrate seek mailbox into the same clock boundary;
3. add `StreamingRtView` with cache-line layout tests;
4. move cold diagnostics;
5. move active-stream and gapless groups;
6. privatize legacy fields only after all direct accesses are removed.

Each step must preserve callback allocation and latency gates.

### 6. No compatibility rule for the old streaming transport

The shared-state split must not create a permanent generic `StreamingState`
around queue/ring fields scheduled for deletion by pipeline-v2. Legacy fields
may remain behind temporary adapters; the final owned structure should model
the PCM window/session path.

## Landed Contract From This Review

The render clock now uses an explicit valid bit and a sequence publication:

- writer marks sequence odd, writes start/end/anchor/valid, then Release
  publishes an even sequence;
- readers accept only matching even sequence snapshots;
- anchor `0` is a valid monotonic timestamp;
- reset publishes `valid=false` instead of overloading anchor value `0`.

This fixes the sentinel defect without yet claiming the complete
requested/audible clock split.

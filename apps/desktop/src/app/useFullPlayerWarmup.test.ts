import assert from "node:assert/strict";
import test from "node:test";
import { createFullPlayerWarmupOrchestration } from "./useFullPlayerWarmup";

function createHarness() {
  const scheduled = new Map<number, () => void>();
  let nextHandle = 1;
  let warmups = 0;
  let opens = 0;
  let mountedNotifications = 0;
  let disposals = 0;
  let cancellations = 0;

  const orchestration = createFullPlayerWarmupOrchestration({
    commands: {
      warmup: () => {
        warmups += 1;
      },
      requestOpen: () => {
        opens += 1;
      },
      notifyShellMounted: () => {
        mountedNotifications += 1;
      },
      dispose: () => {
        disposals += 1;
      }
    },
    scheduleIdle: (callback) => {
      const handle = nextHandle;
      nextHandle += 1;
      scheduled.set(handle, callback);
      return () => {
        if (scheduled.delete(handle)) cancellations += 1;
      };
    }
  });

  const runNext = () => {
    const next = scheduled.entries().next().value as [number, () => void] | undefined;
    if (!next) throw new Error("expected a scheduled warmup");
    scheduled.delete(next[0]);
    next[1]();
  };

  return {
    orchestration,
    runNext,
    pending: () => scheduled.size,
    counts: () => ({ warmups, opens, mountedNotifications, disposals, cancellations })
  };
}

test("eligibility schedules idle warmup and hidden state cancels it", () => {
  const harness = createHarness();

  harness.orchestration.updateEligibility(true);
  assert.equal(harness.pending(), 1);
  harness.orchestration.updateEligibility(false);
  assert.equal(harness.pending(), 0);
  assert.equal(harness.counts().cancellations, 1);

  harness.orchestration.updateEligibility(true);
  harness.runNext();
  assert.equal(harness.counts().warmups, 1, "visible eligibility resumes warmup");
  assert.equal(harness.pending(), 0);
});

test("priority warmup and open cancel pending idle work", () => {
  const warmupHarness = createHarness();
  warmupHarness.orchestration.updateEligibility(true);
  warmupHarness.orchestration.prewarm();
  assert.deepEqual(warmupHarness.counts(), {
    warmups: 1,
    opens: 0,
    mountedNotifications: 0,
    disposals: 0,
    cancellations: 1
  });

  const openHarness = createHarness();
  openHarness.orchestration.updateEligibility(true);
  openHarness.orchestration.requestOpen();
  assert.deepEqual(openHarness.counts(), {
    warmups: 0,
    opens: 1,
    mountedNotifications: 0,
    disposals: 0,
    cancellations: 1
  });
});

test("dispose cancels scheduled work and ignores later commands", () => {
  const harness = createHarness();
  harness.orchestration.updateEligibility(true);
  harness.orchestration.dispose();
  harness.orchestration.prewarm();
  harness.orchestration.requestOpen();
  harness.orchestration.notifyShellMounted();
  harness.orchestration.updateEligibility(true);

  assert.equal(harness.pending(), 0);
  assert.deepEqual(harness.counts(), {
    warmups: 0,
    opens: 0,
    mountedNotifications: 0,
    disposals: 1,
    cancellations: 1
  });
});

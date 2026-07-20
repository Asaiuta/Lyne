import assert from "node:assert/strict";
import test from "node:test";
import {
  SIDEBAR_COLLAPSE_MOTION_FALLBACK_MS,
  SIDEBAR_COLLAPSED_CONTENT_RETENTION_MS,
  createSidebarCollapseLifecycle,
  initialSidebarCollapsePhase,
  sidebarCollapsePresentation,
  type SidebarCollapsePhase
} from "./sidebarCollapseLifecycle";

type ScheduledTaskKind = "frame" | "delay" | "idle";

interface ScheduledTask {
  readonly handle: number;
  readonly kind: ScheduledTaskKind;
  readonly delayMs: number | null;
  readonly callback: () => void;
}

function createHarness(initialCollapsed = false) {
  const tasks = new Map<number, ScheduledTask>();
  const phases: SidebarCollapsePhase[] = [initialSidebarCollapsePhase(initialCollapsed)];
  let nextHandle = 1;

  const schedule = (
    kind: ScheduledTaskKind,
    callback: () => void,
    delayMs: number | null = null
  ): (() => void) => {
    const handle = nextHandle;
    nextHandle += 1;
    tasks.set(handle, { handle, kind, delayMs, callback });
    return () => {
      tasks.delete(handle);
    };
  };

  const lifecycle = createSidebarCollapseLifecycle({
    initialCollapsed,
    onPhaseChange: (phase) => phases.push(phase),
    scheduleFrame: (callback) => schedule("frame", callback),
    scheduleDelay: (callback, delayMs) => schedule("delay", callback, delayMs),
    scheduleIdle: (callback) => schedule("idle", callback)
  });

  const pending = (kind?: ScheduledTaskKind): ScheduledTask[] =>
    [...tasks.values()].filter((task) => kind === undefined || task.kind === kind);

  const runNext = (kind: ScheduledTaskKind): ScheduledTask => {
    const task = pending(kind)[0];
    if (!task) throw new Error(`expected a scheduled ${kind} task`);
    tasks.delete(task.handle);
    task.callback();
    return task;
  };

  return { lifecycle, phases, pending, runNext };
}

test("collapse keeps expanded content through transition and releases it after retention plus idle", () => {
  const harness = createHarness();
  const generation = harness.lifecycle.beginTransition(true, false);

  assert.equal(harness.lifecycle.currentPhase(), "collapsing");
  assert.deepEqual(sidebarCollapsePresentation("collapsing"), {
    expandedContentMounted: true,
    expandedContentVisible: true,
    compactContentVisible: false,
    motionActive: true
  });
  assert.equal(harness.pending("delay")[0]?.delayMs, SIDEBAR_COLLAPSE_MOTION_FALLBACK_MS);

  harness.lifecycle.requestSettle(generation, true);
  assert.equal(harness.pending("delay").length, 0, "transition end cancels the fallback");
  assert.equal(harness.lifecycle.currentPhase(), "collapsing", "the event frame keeps the tree visible");

  harness.runNext("frame");
  assert.equal(harness.lifecycle.currentPhase(), "collapsed-retained");
  assert.deepEqual(sidebarCollapsePresentation("collapsed-retained"), {
    expandedContentMounted: true,
    expandedContentVisible: false,
    compactContentVisible: true,
    motionActive: false
  });
  assert.equal(harness.pending("delay")[0]?.delayMs, SIDEBAR_COLLAPSED_CONTENT_RETENTION_MS);

  harness.runNext("delay");
  assert.equal(harness.lifecycle.currentPhase(), "collapsed-retained");
  assert.equal(harness.pending("idle").length, 1);

  harness.runNext("idle");
  assert.equal(harness.lifecycle.currentPhase(), "collapsed-unmounted");
  assert.deepEqual(sidebarCollapsePresentation("collapsed-unmounted"), {
    expandedContentMounted: false,
    expandedContentVisible: false,
    compactContentVisible: true,
    motionActive: false
  });
});

test("re-expanding inside the retention window reuses the mounted tree and cancels release", () => {
  const harness = createHarness();
  const collapseGeneration = harness.lifecycle.beginTransition(true, false);
  harness.lifecycle.requestSettle(collapseGeneration, true);
  harness.runNext("frame");
  assert.equal(harness.pending("delay").length, 1);

  const expandGeneration = harness.lifecycle.beginTransition(false, false);
  assert.equal(harness.pending("delay").length, 1, "only the expand fallback remains");
  assert.deepEqual(sidebarCollapsePresentation(harness.lifecycle.currentPhase()), {
    expandedContentMounted: true,
    expandedContentVisible: true,
    compactContentVisible: false,
    motionActive: true
  });

  harness.lifecycle.requestSettle(expandGeneration, false);
  harness.runNext("frame");
  assert.equal(harness.lifecycle.currentPhase(), "expanded");
  assert.equal(harness.pending().length, 0);
});

test("re-expanding cancels an already scheduled idle unmount", () => {
  const harness = createHarness();
  const collapseGeneration = harness.lifecycle.beginTransition(true, false);
  harness.lifecycle.requestSettle(collapseGeneration, true);
  harness.runNext("frame");
  harness.runNext("delay");
  assert.equal(harness.pending("idle").length, 1);

  harness.lifecycle.beginTransition(false, false);
  assert.equal(harness.pending("idle").length, 0);
  assert.equal(harness.lifecycle.currentPhase(), "expanding");
});

test("rapid reversal rejects stale generations and only settles the latest target", () => {
  const harness = createHarness();
  const collapseGeneration = harness.lifecycle.beginTransition(true, false);
  harness.lifecycle.requestSettle(collapseGeneration, true);
  assert.equal(harness.pending("frame").length, 1);

  const expandGeneration = harness.lifecycle.beginTransition(false, false);
  assert.equal(harness.pending("frame").length, 0, "reversal cancels the old settle frame");
  harness.lifecycle.requestSettle(collapseGeneration, true);
  assert.equal(harness.pending("frame").length, 0, "stale completion cannot schedule work");

  harness.lifecycle.requestSettle(expandGeneration, false);
  harness.lifecycle.requestSettle(expandGeneration, false);
  assert.equal(harness.pending("frame").length, 1, "duplicate completion is coalesced");
  harness.runNext("frame");
  assert.equal(harness.lifecycle.currentPhase(), "expanded");
  assert.deepEqual(harness.phases, ["expanded", "collapsing", "expanding", "expanded"]);
});

test("reduced motion requests the settled phase on the next frame without a fallback", () => {
  const harness = createHarness();
  harness.lifecycle.beginTransition(true, true);

  assert.equal(harness.lifecycle.currentPhase(), "collapsing");
  assert.equal(harness.pending("delay").length, 0);
  assert.equal(harness.pending("frame").length, 1);

  harness.runNext("frame");
  assert.equal(harness.lifecycle.currentPhase(), "collapsed-retained");
});

test("dispose cancels every pending phase task and ignores later completion", () => {
  const harness = createHarness();
  const generation = harness.lifecycle.beginTransition(true, false);
  harness.lifecycle.requestSettle(generation, true);
  assert.equal(harness.pending("frame").length, 1);

  harness.lifecycle.dispose();
  assert.equal(harness.pending().length, 0);
  harness.lifecycle.requestSettle(generation, true);
  assert.equal(harness.pending().length, 0);
});

test("initial collapsed presentation mounts only the compact content", () => {
  assert.equal(initialSidebarCollapsePhase(true), "collapsed-unmounted");
  assert.deepEqual(sidebarCollapsePresentation(initialSidebarCollapsePhase(true)), {
    expandedContentMounted: false,
    expandedContentVisible: false,
    compactContentVisible: true,
    motionActive: false
  });
});

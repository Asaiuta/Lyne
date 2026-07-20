import assert from "node:assert/strict";
import test from "node:test";
import {
  SIDEBAR_GEOMETRY_PROPERTY,
  createSidebarGeometryMotion,
  parseCssTimeMs
} from "./sidebarGeometryMotion";

interface FakeAnimation extends Animation {
  cancelCalls: number;
  reverseCalls: number;
}

const createFakeAnimation = (): FakeAnimation => {
  const fake = {
    cancelCalls: 0,
    reverseCalls: 0,
    currentTime: 0,
    oncancel: null,
    onfinish: null,
    playbackRate: 1,
    playState: "running" as AnimationPlayState,
    startTime: null,
    cancel() {
      this.cancelCalls += 1;
      this.playState = "idle";
    },
    reverse() {
      this.reverseCalls += 1;
      this.playbackRate *= -1;
    }
  };
  return fake as unknown as FakeAnimation;
};

test("CSS time parsing accepts motion-token units and rejects invalid values", () => {
  assert.equal(parseCssTimeMs("300ms"), 300);
  assert.equal(parseCssTimeMs("0.3s"), 300);
  assert.equal(parseCssTimeMs("-1ms"), null);
  assert.equal(parseCssTimeMs("300"), null);
});

test("sidebar geometry motion anchors one owner animation to the current timeline", () => {
  const animation = createFakeAnimation();
  let capturedKeyframes: Keyframe[] | null = null;
  let capturedOptions: KeyframeAnimationOptions | null = null;
  const completed: Array<readonly [number, boolean]> = [];
  const motion = createSidebarGeometryMotion({
    expandedSize: "240px",
    collapsedSize: "64px",
    durationMs: 300,
    easing: "cubic-bezier(0.4, 0, 0.2, 1)",
    timelineTime: () => 42,
    animate: (keyframes, options) => {
      capturedKeyframes = keyframes;
      capturedOptions = options;
      return animation;
    },
    onFinished: (generation, collapsed) => completed.push([generation, collapsed])
  });

  motion.animateTo(7, true);

  assert.deepEqual(capturedKeyframes, [
    { [SIDEBAR_GEOMETRY_PROPERTY]: "240px" },
    { [SIDEBAR_GEOMETRY_PROPERTY]: "64px" }
  ]);
  assert.deepEqual(capturedOptions, {
    duration: 300,
    easing: "cubic-bezier(0.4, 0, 0.2, 1)",
    fill: "both"
  });
  assert.equal(animation.startTime, 42);
  assert.deepEqual(completed, []);

  animation.onfinish?.call(animation, {} as AnimationPlaybackEvent);
  assert.deepEqual(completed, [[7, true]]);
  assert.equal(animation.cancelCalls, 1);
});

test("rapid reversal reuses the active animation and settles only the latest generation", () => {
  const animation = createFakeAnimation();
  let animationCount = 0;
  const completed: Array<readonly [number, boolean]> = [];
  const motion = createSidebarGeometryMotion({
    expandedSize: "240px",
    collapsedSize: "64px",
    durationMs: 300,
    easing: "ease",
    timelineTime: () => 12,
    animate: () => {
      animationCount += 1;
      return animation;
    },
    onFinished: (generation, collapsed) => completed.push([generation, collapsed])
  });

  motion.animateTo(1, true);
  motion.animateTo(2, false);
  motion.animateTo(3, true);

  assert.equal(animationCount, 1);
  assert.equal(animation.reverseCalls, 2);
  animation.onfinish?.call(animation, {} as AnimationPlaybackEvent);
  assert.deepEqual(completed, [[3, true]]);
});

test("dispose cancels the transient animation without settling", () => {
  const animation = createFakeAnimation();
  let completionCount = 0;
  const motion = createSidebarGeometryMotion({
    expandedSize: "240px",
    collapsedSize: "64px",
    durationMs: 300,
    easing: "ease",
    timelineTime: () => 0,
    animate: () => animation,
    onFinished: () => {
      completionCount += 1;
    }
  });

  motion.animateTo(1, true);
  motion.dispose();
  animation.onfinish?.call(animation, {} as AnimationPlaybackEvent);

  assert.equal(animation.cancelCalls, 1);
  assert.equal(completionCount, 0);
});

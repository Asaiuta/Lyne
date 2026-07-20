import assert from "node:assert/strict";
import test from "node:test";
import {
  longestCssTimelineMs,
  transitionPhaseClassNames
} from "./KeyedOutInTransition";

test("longestCssTimelineMs reads seconds, milliseconds, delays, and repeated CSS lists", () => {
  assert.equal(
    longestCssTimelineMs({
      transitionDuration: "100ms, 0.3s",
      transitionDelay: "20ms",
      animationDuration: "0s",
      animationDelay: "0s"
    }),
    320
  );
  assert.equal(
    longestCssTimelineMs({
      transitionDuration: "100ms",
      transitionDelay: "0ms, 50ms",
      animationDuration: "0.2s",
      animationDelay: "25ms"
    }),
    225
  );
});

test("longestCssTimelineMs resolves zero-duration reduced motion synchronously", () => {
  assert.equal(
    longestCssTimelineMs({
      transitionDuration: "0ms, 0s",
      transitionDelay: "0ms",
      animationDuration: "0s",
      animationDelay: "0s"
    }),
    0
  );
});

test("transitionPhaseClassNames reuses one named CSS motion matrix", () => {
  assert.deepEqual(transitionPhaseClassNames("page-slide", "leave"), [
    "page-slide-leave-from",
    "page-slide-leave-active",
    "page-slide-leave-to"
  ]);
  assert.deepEqual(
    transitionPhaseClassNames("local-library-title-fade", "enter"),
    [
      "local-library-title-fade-enter-from",
      "local-library-title-fade-enter-active",
      "local-library-title-fade-enter-to"
    ]
  );
});

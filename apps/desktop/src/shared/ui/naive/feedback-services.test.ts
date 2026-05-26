import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MESSAGE_DURATION_MS,
  createLoadingBarState,
  normalizeFeedbackDuration
} from "./feedback-services-logic";

test("feedback duration falls back and clamps negative values", () => {
  assert.equal(normalizeFeedbackDuration(undefined, DEFAULT_MESSAGE_DURATION_MS), 3000);
  assert.equal(normalizeFeedbackDuration(Number.NaN, DEFAULT_MESSAGE_DURATION_MS), 3000);
  assert.equal(normalizeFeedbackDuration(-10, DEFAULT_MESSAGE_DURATION_MS), 0);
  assert.equal(normalizeFeedbackDuration(1200, DEFAULT_MESSAGE_DURATION_MS), 1200);
});

test("loading bar state clamps progress and hides only when idle", () => {
  assert.deepEqual(createLoadingBarState("idle", 50), {
    visible: false,
    status: "idle",
    progress: 50
  });
  assert.deepEqual(createLoadingBarState("loading", 120), {
    visible: true,
    status: "loading",
    progress: 100
  });
  assert.deepEqual(createLoadingBarState("error", -10), {
    visible: true,
    status: "error",
    progress: 0
  });
});

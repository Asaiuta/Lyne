"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { measureSubGates } = require("./lyne-playback-latency-benchmark.cjs");

const cleanStability = {
  enabled: true,
  summary: {
    playback_false_samples: 0,
    loading_samples: 0,
    load_error_delta: 0,
    recovery_delta: 0,
    underrun_delta: 0,
    streaming_output_shortfall_delta: 0,
    current_time_monotonic_resets: 0
  }
};

const cleanControl = {
  enabled: true,
  sample_count: 10,
  samples: Array.from({ length: 10 }, () => ({ status: "success" }))
};

test("both sub-gates disabled -> pass", () => {
  const { stabilityPass, controlUpdatePass, failureReasons } = measureSubGates(null, null);
  assert.equal(stabilityPass, true);
  assert.equal(controlUpdatePass, true);
  assert.deepEqual(failureReasons, []);
});

test("enabled stable + enabled control success -> pass", () => {
  const { stabilityPass, controlUpdatePass, failureReasons } = measureSubGates(
    cleanStability,
    cleanControl
  );
  assert.equal(stabilityPass, true);
  assert.equal(controlUpdatePass, true);
  assert.deepEqual(failureReasons, []);
});

test("enabled stability with underruns -> fail with reason", () => {
  const { stabilityPass, failureReasons } = measureSubGates(
    {
      ...cleanStability,
      summary: { ...cleanStability.summary, underrun_delta: 3 }
    },
    cleanControl
  );
  assert.equal(stabilityPass, false);
  assert.ok(failureReasons.includes("stability:sub-gate-failed"));
});

test("enabled control with failed ack -> fail with reason", () => {
  const { controlUpdatePass, failureReasons } = measureSubGates(cleanStability, {
    ...cleanControl,
    samples: [{ status: "success" }, { status: "failed" }]
  });
  assert.equal(controlUpdatePass, false);
  assert.ok(failureReasons.includes("control:sub-gate-failed"));
});

test("disabled stability object does not gate", () => {
  const { stabilityPass, failureReasons } = measureSubGates(
    { enabled: false, summary: cleanStability.summary },
    cleanControl
  );
  assert.equal(stabilityPass, true);
  assert.deepEqual(failureReasons, []);
});
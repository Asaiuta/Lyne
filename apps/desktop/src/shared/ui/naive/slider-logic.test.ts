import assert from "node:assert/strict";
import test from "node:test";
import {
  getNaiveSliderPercent,
  isNaiveSliderStepKey,
  normalizeNaiveSliderValue,
  resolveNaiveSliderMarks,
  resolveNaiveSliderThumbStyle
} from "./slider-logic";

test("slider value helpers normalize finite values and percent bounds", () => {
  assert.equal(normalizeNaiveSliderValue(3, undefined, 0), 3);
  assert.equal(normalizeNaiveSliderValue(undefined, 4, 0), 4);
  assert.equal(normalizeNaiveSliderValue(Number.NaN, 4, 0), 4);
  assert.equal(normalizeNaiveSliderValue(undefined, undefined, -12), -12);

  assert.equal(getNaiveSliderPercent(5, 0, 10), 50);
  assert.equal(getNaiveSliderPercent(-1, 0, 10), 0);
  assert.equal(getNaiveSliderPercent(15, 0, 10), 100);
  assert.equal(getNaiveSliderPercent(1, 10, 10), 0);
});

test("slider marks sort, position, and activate by NaiveUI single-thumb rule", () => {
  const marks = resolveNaiveSliderMarks(
    [
      { value: 2, label: "2x" },
      { value: 0.2, label: "0.2x" },
      { value: 1, label: "1x" }
    ],
    1,
    0.2,
    2
  );

  assert.deepEqual(
    marks.map((mark) => mark.value),
    [0.2, 1, 2]
  );
  assert.equal(marks[0]?.percent, 0);
  assert.equal(Math.abs((marks[1]?.percent ?? 0) - 44.44444444444444) < 0.0000000001, true);
  assert.equal(marks[2]?.percent, 100);
  assert.equal(marks[0]?.active, true);
  assert.equal(marks[1]?.active, true);
  assert.equal(marks[2]?.active, false);
});

test("slider keyboard blocking recognizes step keys only", () => {
  assert.equal(isNaiveSliderStepKey("ArrowLeft"), true);
  assert.equal(isNaiveSliderStepKey("Home"), true);
  assert.equal(isNaiveSliderStepKey("PageDown"), true);
  assert.equal(isNaiveSliderStepKey("Enter"), false);
  assert.equal(isNaiveSliderStepKey(" "), false);
});

test("slider thumb inline style preserves centered alignment over Kobalte placement styles", () => {
  assert.deepEqual(resolveNaiveSliderThumbStyle("horizontal"), {
    transform: "translate(-50%, -50%)"
  });
  assert.deepEqual(resolveNaiveSliderThumbStyle("vertical"), {
    left: "50%",
    transform: "translate(-50%, 50%)"
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  naiveInputGroupClass,
  naiveInputGroupLabelClass,
  naiveInputGroupLabelStyle,
  resolveNaiveInputGroupLabelMetrics
} from "./input-group-logic";

test("NaiveInputGroup emits NaiveUI group class hooks", () => {
  assert.equal(naiveInputGroupClass("set"), "naive-input-group n-input-group set");
  assert.equal(
    naiveInputGroupLabelClass("unit"),
    "naive-input-group-label n-input-group-label unit"
  );
});

test("NaiveInputGroupLabel resolves NaiveUI size metrics", () => {
  assert.deepEqual(resolveNaiveInputGroupLabelMetrics("small"), {
    fontSize: "13px",
    height: "28px"
  });
  assert.deepEqual(resolveNaiveInputGroupLabelMetrics(undefined), {
    fontSize: "14px",
    height: "34px"
  });
});

test("NaiveInputGroupLabel style keeps caller style after NaiveUI css vars", () => {
  const style = naiveInputGroupLabelStyle("large", { width: "40px" });

  assert.equal(style["--n-height"], "40px");
  assert.equal(style["--n-font-size"], "15px");
  assert.equal(style.width, "40px");
});

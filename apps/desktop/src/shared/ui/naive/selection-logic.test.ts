import assert from "node:assert/strict";
import test from "node:test";
import {
  isNaiveCheckboxDisabledByQuota,
  naiveSelectionValueKey,
  resolveNaiveRadioSplitorState,
  resolveNaiveSelectionOriginalValue,
  toggleNaiveCheckboxValues,
  type NaiveSelectionValue
} from "./selection-logic";

test("checkbox value keys preserve numeric round trips through lookup maps", () => {
  const lookup = new Map<string, NaiveSelectionValue>([
    [naiveSelectionValueKey(7), 7],
    [naiveSelectionValueKey("translation"), "translation"]
  ]);

  assert.equal(resolveNaiveSelectionOriginalValue("7", lookup), 7);
  assert.equal(resolveNaiveSelectionOriginalValue("translation", lookup), "translation");
  assert.equal(resolveNaiveSelectionOriginalValue("missing", lookup), "missing");
});

test("checkbox group toggles values while enforcing max and min quotas", () => {
  const checked = toggleNaiveCheckboxValues(["a"], "b", true, { max: 2 });
  assert.deepEqual(checked.values, ["a", "b"]);
  assert.equal(checked.changed, true);
  assert.equal(checked.blocked, false);
  assert.equal(checked.actionType, "check");

  const maxBlocked = toggleNaiveCheckboxValues(["a", "b"], "c", true, { max: 2 });
  assert.deepEqual(maxBlocked.values, ["a", "b"]);
  assert.equal(maxBlocked.changed, false);
  assert.equal(maxBlocked.blocked, true);

  const unchecked = toggleNaiveCheckboxValues(["a", "b"], "a", false, { min: 1 });
  assert.deepEqual(unchecked.values, ["b"]);
  assert.equal(unchecked.actionType, "uncheck");

  const minBlocked = toggleNaiveCheckboxValues(["b"], "b", false, { min: 1 });
  assert.deepEqual(minBlocked.values, ["b"]);
  assert.equal(minBlocked.blocked, true);
});

test("checkbox quota disabled state follows NaiveUI max and min rules", () => {
  assert.equal(isNaiveCheckboxDisabledByQuota(["a"], "b", false, undefined, false, { max: 1 }), true);
  assert.equal(isNaiveCheckboxDisabledByQuota(["a"], "a", true, undefined, false, { min: 1 }), true);
  assert.equal(isNaiveCheckboxDisabledByQuota(["a"], "a", true, false, true, { min: 0 }), false);
  assert.equal(isNaiveCheckboxDisabledByQuota(["a"], "b", false, true, false, { max: 2 }), true);
});

test("radio splitor state adopts the higher-priority neighbor", () => {
  assert.deepEqual(
    resolveNaiveRadioSplitorState(
      { checked: false, disabled: false },
      { checked: true, disabled: false }
    ),
    { checked: true, disabled: false }
  );
  assert.deepEqual(
    resolveNaiveRadioSplitorState(
      { checked: true, disabled: true },
      { checked: false, disabled: false }
    ),
    { checked: true, disabled: true }
  );
});

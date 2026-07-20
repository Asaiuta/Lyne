import assert from "node:assert/strict";
import test from "node:test";
import { findNextEnabledMenuIndex } from "./menu";

test("menu keyboard navigation wraps and skips disabled items", () => {
  const items = [{ disabled: false }, { disabled: true }, { disabled: false }];

  assert.equal(findNextEnabledMenuIndex(items, 0, 1), 2);
  assert.equal(findNextEnabledMenuIndex(items, 2, 1), 0);
  assert.equal(findNextEnabledMenuIndex(items, 0, -1), 2);
});

test("menu keyboard navigation reports no focusable item", () => {
  assert.equal(findNextEnabledMenuIndex([], 0, 1), -1);
  assert.equal(
    findNextEnabledMenuIndex([{ disabled: true }, { disabled: true }], 0, 1),
    -1
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import source from "./SegmentedTabs.tsx?raw";

test("segmented tabs are a compatibility adapter over NaiveTabs", () => {
  assert.equal(/<NaiveTabs\b/.test(source), true);
  assert.equal(/type="segment"/.test(source), true);
  assert.equal(/<button\b/.test(source), false);
  assert.equal(/<select\b/.test(source), false);
});

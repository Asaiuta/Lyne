import assert from "node:assert/strict";
import test from "node:test";
import { isOnlineOnlyPage, isPlaceholderPage, isSearchEnabledPage } from "./navigation";

test("online search page is searchable and online-only", () => {
  assert.equal(isSearchEnabledPage("search"), true);
  assert.equal(isOnlineOnlyPage("search"), true);
  assert.equal(isPlaceholderPage("search"), false);
});

test("library search remains local and enabled", () => {
  assert.equal(isSearchEnabledPage("library"), true);
  assert.equal(isOnlineOnlyPage("library"), false);
});
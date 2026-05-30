import assert from "node:assert/strict";
import test from "node:test";
import { SETTINGS_CATALOG } from "./catalog";
import { SETTINGS_SECTION_ITEM_IDS, SETTINGS_SECTION_ITEM_ID_SETS } from "./settingItemIds";

test("settings catalog item ids are backed by rendered setting sections", () => {
  const missingEntries = SETTINGS_CATALOG
    .filter((entry) => !SETTINGS_SECTION_ITEM_ID_SETS[entry.category].has(entry.itemId))
    .map((entry) => `${entry.category}:${entry.itemId}`);

  assert.deepEqual(missingEntries, []);
});

test("settings section item ids stay unique inside each category", () => {
  const duplicatedIds = Object.entries(SETTINGS_SECTION_ITEM_IDS).flatMap(([category, ids]) => {
    const seen = new Set<string>();
    return ids
      .filter((id) => {
        const duplicated = seen.has(id);
        seen.add(id);
        return duplicated;
      })
      .map((id) => `${category}:${id}`);
  });

  assert.deepEqual(duplicatedIds, []);
});

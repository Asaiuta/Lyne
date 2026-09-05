import assert from "node:assert/strict";
import test from "node:test";
import { SETTINGS_CATALOG, type SettingsCatalogEntry } from "./catalog";
import { SETTINGS_SECTION_ITEM_IDS } from "./settingItemIds";
import {
  CONTEXT_MENU_ITEMS,
  COVER_DISPLAY_ITEMS,
  COVER_MANAGER_ITEM,
  LAYOUT_MANAGER_ITEMS,
  PLAYLIST_PAGE_ITEMS,
  SIDEBAR_VISIBILITY_ITEMS,
  THEME_MANAGER_ITEMS
} from "../sections/appearanceConfig";
import {
  AUDIO_ENGINE_BOOLEAN_ITEMS,
  AUDIO_ENGINE_TEXT_ITEMS
} from "../sections/audioEngineSettingsModel";
import { en } from "../../../shared/i18n/locales/en";

/**
 * Settings metadata sync guard (task 08-03, E2).
 * SETTINGS_SECTION_ITEM_IDS is derived from SETTINGS_CATALOG; the section
 * configs (appearanceConfig, audioEngineSettingsModel) hand-own itemIds that
 * the catalog must mirror. These tests fail with the offending itemId +
 * section whenever a new setting is added to only one of the lists.
 */

const catalogRowsByCategory = new Map<string, SettingsCatalogEntry[]>();
for (const entry of SETTINGS_CATALOG) {
  const rows = catalogRowsByCategory.get(entry.category) ?? [];
  rows.push(entry);
  catalogRowsByCategory.set(entry.category, rows);
}

const catalogItemIds = (category: string): readonly string[] =>
  (catalogRowsByCategory.get(category) ?? []).map((entry) => entry.itemId);

const catalogEntryCount = (itemId: string): number =>
  SETTINGS_CATALOG.filter((entry) => entry.itemId === itemId).length;

test("section item id lists exactly mirror the catalog per category", () => {
  const missingFromCatalog: string[] = [];
  const missingFromSections: string[] = [];
  for (const [category, sectionIds] of Object.entries(SETTINGS_SECTION_ITEM_IDS)) {
    const derived = catalogItemIds(category);
    for (const itemId of sectionIds) {
      if (!derived.includes(itemId)) {
        missingFromCatalog.push(`${category}:${itemId}`);
      }
    }
    for (const itemId of derived) {
      if (!sectionIds.includes(itemId)) {
        missingFromSections.push(`${category}:${itemId}`);
      }
    }
  }
  assert.deepEqual(
    missingFromCatalog,
    [],
    `section item ids without a SETTINGS_CATALOG row (E1: add the catalog entry): ${missingFromCatalog.join(", ")}`
  );
  assert.deepEqual(
    missingFromSections,
    [],
    `catalog item ids not present in SETTINGS_SECTION_ITEM_IDS (unexpected after E1 derivation): ${missingFromSections.join(", ")}`
  );
});

test("catalog item ids are globally unique (single row per setting)", () => {
  const duplicated: string[] = [];
  const seen = new Map<string, string>();
  for (const entry of SETTINGS_CATALOG) {
    const previous = seen.get(entry.itemId);
    if (previous !== undefined && previous !== entry.category) {
      duplicated.push(`${entry.itemId} (${previous} + ${entry.category})`);
    }
    seen.set(entry.itemId, entry.category);
  }
  assert.deepEqual(
    duplicated,
    [],
    `catalog itemId rows must stay unique: ${duplicated.join(", ")}`
  );
});

const APPEARANCE_CONFIG_LISTS: Readonly<Record<string, readonly { itemId: string }[]>> = {
  SIDEBAR_VISIBILITY_ITEMS,
  PLAYLIST_PAGE_ITEMS,
  CONTEXT_MENU_ITEMS,
  COVER_DISPLAY_ITEMS,
  LAYOUT_MANAGER_ITEMS,
  THEME_MANAGER_ITEMS
};

test("appearance section config itemIds are backed by exactly one catalog row", () => {
  const problems: string[] = [];
  for (const [listName, items] of Object.entries(APPEARANCE_CONFIG_LISTS)) {
    for (const item of items) {
      const count = catalogEntryCount(item.itemId);
      const row = SETTINGS_CATALOG.find((entry) => entry.itemId === item.itemId);
      if (count !== 1 || row?.category !== "appearance") {
        problems.push(
          `${listName}:${item.itemId} -> catalog rows=${count} category=${row?.category ?? "none"}`
        );
      }
    }
  }
  assert.deepEqual(
    problems,
    [],
    `appearance config itemIds missing or mis-categorized in catalog: ${problems.join(", ")}`
  );
});

test("cover manager itemId is backed by exactly one appearance catalog row", () => {
  const count = catalogEntryCount(COVER_MANAGER_ITEM.itemId);
  const row = SETTINGS_CATALOG.find((entry) => entry.itemId === COVER_MANAGER_ITEM.itemId);
  assert.deepEqual(
    count === 1 && row?.category === "appearance" ? [] : [`appearance:${COVER_MANAGER_ITEM.itemId} rows=${count} category=${row?.category ?? "none"}`],
    [],
    `COVER_MANAGER_ITEM itemId not backed by exactly one appearance catalog row`
  );
});

const AUDIO_ENGINE_FORM_ITEMS: ReadonlyArray<{ readonly source: string; readonly id: string }> = [
  ...Object.values(AUDIO_ENGINE_TEXT_ITEMS).map((item) => ({
    source: "AUDIO_ENGINE_TEXT_ITEMS",
    id: item.id
  })),
  ...Object.values(AUDIO_ENGINE_BOOLEAN_ITEMS).map((item) => ({
    source: "AUDIO_ENGINE_BOOLEAN_ITEMS",
    id: item.id
  }))
];

test("audio-engine form ids are backed by catalog rows under audio-engine", () => {
  const audioEngineCatalogIds = catalogItemIds("audio-engine");
  const missing = AUDIO_ENGINE_FORM_ITEMS
    .filter((item) => !audioEngineCatalogIds.includes(item.id))
    .map((item) => `${item.source}:${item.id}`);
  assert.deepEqual(
    missing,
    [],
    `audio-engine form ids without a catalog row (add the entry): ${missing.join(", ")}`
  );
});

test("catalog label and description keys resolve in the default locale", () => {
  const unresolvable: string[] = [];
  for (const entry of SETTINGS_CATALOG) {
    if (en[entry.labelKey] === undefined) {
      unresolvable.push(`${entry.category}:${entry.itemId} labelKey=${entry.labelKey}`);
    }
    if (entry.descriptionKey !== undefined && en[entry.descriptionKey] === undefined) {
      unresolvable.push(`${entry.category}:${entry.itemId} descriptionKey=${entry.descriptionKey}`);
    }
  }
  assert.deepEqual(
    unresolvable,
    [],
    `catalog rows with unresolvable i18n keys: ${unresolvable.join(", ")}`
  );
});
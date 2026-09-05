import type { SettingsCategoryKey } from "../components/SettingsCategoryNav";
import { SETTINGS_CATALOG } from "./catalog";

/**
 * Single source of truth for settings metadata (task 08-03, E1).
 * SETTINGS_SECTION_ITEM_IDS is derived from SETTINGS_CATALOG instead of a
 * hand-maintained parallel list, so adding a setting touches exactly one
 * file (the catalog row) and drift between the search index and the section
 * item lists can no longer fail silently. appearanceConfig continues to own
 * the itemId-bearing sub-panel configs (LAYOUT_MANAGER_ITEMS etc.); the
 * catalog mirrors those itemIds as rows and settings-metadata-sync.test.ts
 * guards the mirror.
 */
const catalogItemIds = (category: SettingsCategoryKey): readonly string[] =>
  SETTINGS_CATALOG.filter((entry) => entry.category === category).map(
    (entry) => entry.itemId
  );

export const SETTINGS_SECTION_ITEM_IDS: Record<SettingsCategoryKey, readonly string[]> = {
  general: catalogItemIds("general"),
  appearance: catalogItemIds("appearance"),
  playback: catalogItemIds("playback"),
  lyrics: catalogItemIds("lyrics"),
  local: catalogItemIds("local"),
  keyboard: catalogItemIds("keyboard"),
  network: catalogItemIds("network"),
  "audio-engine": catalogItemIds("audio-engine"),
  plugins: catalogItemIds("plugins"),
  about: catalogItemIds("about")
};

export const SETTINGS_SECTION_ITEM_ID_SETS: Record<SettingsCategoryKey, ReadonlySet<string>> = {
  general: new Set(SETTINGS_SECTION_ITEM_IDS.general),
  appearance: new Set(SETTINGS_SECTION_ITEM_IDS.appearance),
  playback: new Set(SETTINGS_SECTION_ITEM_IDS.playback),
  lyrics: new Set(SETTINGS_SECTION_ITEM_IDS.lyrics),
  local: new Set(SETTINGS_SECTION_ITEM_IDS.local),
  keyboard: new Set(SETTINGS_SECTION_ITEM_IDS.keyboard),
  network: new Set(SETTINGS_SECTION_ITEM_IDS.network),
  "audio-engine": new Set(SETTINGS_SECTION_ITEM_IDS["audio-engine"]),
  plugins: new Set(SETTINGS_SECTION_ITEM_IDS.plugins),
  about: new Set(SETTINGS_SECTION_ITEM_IDS.about)
};
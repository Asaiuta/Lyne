import assert from "node:assert/strict";
import test from "node:test";
import { NON_SCHEMA_STORAGE_KEYS } from "./storageKeysRegistry";
import fullPlayerSource from "../../components/FullPlayer.tsx?raw";
import desktopLyricBridgeSource from "../../features/desktop-lyric/desktopLyricBridge.ts?raw";

/**
 * D1 registry contract (task 08-03): every `ui.*` / `desktop-lyric.*`
 * localStorage key that is not managed by the uiSettingsStorage schema must
 * be listed in NON_SCHEMA_STORAGE_KEYS with a real owner. The owner is
 * verified by `?raw`-importing the owner file (the same pattern as the
 * engine contract test) and asserting the key string actually appears in
 * that file — a registry entry whose owner does not reference the key is a
 * stale/placeholder owner and fails loudly.
 */
const OWNER_SOURCES = {
  "components/FullPlayer.tsx": fullPlayerSource,
  "features/desktop-lyric/desktopLyricBridge.ts": desktopLyricBridgeSource
} as const satisfies Record<
  (typeof NON_SCHEMA_STORAGE_KEYS)[number]["owner"],
  string
>;

test("every non-schema storage key documents a real owner file that references the key", () => {
  for (const entry of NON_SCHEMA_STORAGE_KEYS) {
    const ownerSource = OWNER_SOURCES[entry.owner as keyof typeof OWNER_SOURCES];
    assert.equal(
      Boolean(ownerSource) && ownerSource.length > 0,
      true,
      `registry entry "${entry.key}" has a missing owner file: apps/desktop/src/${entry.owner}`
    );
    assert.equal(
      ownerSource.includes(entry.key),
      true,
      `owner file apps/desktop/src/${entry.owner} does not reference its registered key "${entry.key}"`
    );
  }
});

test("every non-schema storage key is ui.* or desktop-lyric.* prefixed", () => {
  for (const entry of NON_SCHEMA_STORAGE_KEYS) {
    assert.equal(
      entry.key.startsWith("ui.") || entry.key.startsWith("desktop-lyric."),
      true,
      `registry key "${entry.key}" must be ui.* or desktop-lyric.* prefixed`
    );
  }
});

test("non-schema storage keys are unique", () => {
  const keys = NON_SCHEMA_STORAGE_KEYS.map((entry) => entry.key);
  assert.equal(new Set(keys).size, keys.length, "registry keys should be unique");
});
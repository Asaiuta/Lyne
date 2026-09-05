/**
 * Non-schema localStorage key registry (task 08-03, D1/D2).
 *
 * Every `ui.*` / `desktop-lyric.*` localStorage key must either be managed by
 * the `uiSettingsStorage` schema (validated read/write, event sync, rollback,
 * import-export/reset visibility) or be listed here with its owner + reason.
 * This registry is a documentation/reference contract — `storageKeysRegistry
 * .test.ts` guards that each owner file exists and each key follows the
 * naming prefix.
 *
 * The appearance-engine stub key `ui.appearance.mode.stub` is owned by
 * `shared/theme/appearanceEngine.ts` (see its `APPEARANCE_MODE_STORAGE_KEY`),
 * and the legacy background fields (`ui.bg.enabled`,
 * `ui.player.backgroundType`, `ui.player.backgroundFps`,
 * `ui.player.backgroundFlowSpeed`, `ui.player.backgroundRenderScale`,
 * `ui.player.backgroundPause`, `ui.player.backgroundLowFreqVolume`) are
 * schema-managed dormant fields; the live background parameters are
 * `ui.bg.blur`, `ui.bg.mask`, and `ui.bg.dynamicMaxFps`.
 */
export const NON_SCHEMA_STORAGE_KEYS = [
  {
    key: "ui.lyric.songOffsets",
    owner: "components/FullPlayer.tsx",
    reason:
      "per-song lyric offset map keyed by song id; map-shaped, kept out of schema to avoid revalidating a dictionary"
  },
  {
    key: "desktop-lyric.bounds",
    owner: "features/desktop-lyric/desktopLyricBridge.ts",
    reason:
      "overlay window position written by overlay window; shared localStorage with main window"
  }
] as const;

export type NonSchemaStorageKey = (typeof NON_SCHEMA_STORAGE_KEYS)[number]["key"];

export const NON_SCHEMA_STORAGE_KEY_SET: ReadonlySet<string> = new Set(
  NON_SCHEMA_STORAGE_KEYS.map((entry) => entry.key)
);
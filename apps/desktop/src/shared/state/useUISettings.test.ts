import assert from "node:assert/strict";
import test from "node:test";
import type { Setter } from "solid-js";
import {
  commitUISettingField,
  createUISettingsStore,
  persistUISettingField,
  persistUISetting,
  readUISettingsSnapshot,
  STORAGE_KEYS,
  type UISettingsRuntime
} from "./useUISettings";

const runtimeFromValues = (values: Record<string, string>): UISettingsRuntime => ({
  storage: {
    getItem: (key) => values[key] ?? null
  },
  events: {
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  }
});

interface MutableSettingsRuntime extends UISettingsRuntime {
  values: Record<string, string>;
}

const mutableRuntimeFromValues = (values: Record<string, string>): MutableSettingsRuntime => {
  return {
    values,
    storage: {
      getItem: (key) => values[key] ?? null
    },
    events: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }
  };
};

test("readUISettingsSnapshot reads settings from an injected storage adapter", () => {
  const settings = readUISettingsSnapshot(
    runtimeFromValues({
      [STORAGE_KEYS.bgEnabled]: "true",
      [STORAGE_KEYS.bgBlur]: "18",
      [STORAGE_KEYS.themeMode]: "light",
      [STORAGE_KEYS.closeAppMethod]: "exit",
      [STORAGE_KEYS.searchInputBehavior]: "clear",
      [STORAGE_KEYS.shareUrlFormat]: "mobile",
      [STORAGE_KEYS.routeAnimation]: "flow",
      [STORAGE_KEYS.fullPlayerLayout]: "lyrics",
      [STORAGE_KEYS.dynamicCover]: "true",
      [STORAGE_KEYS.fullPlayerShowCopyLyric]: "false",
      [STORAGE_KEYS.contextMenuOptions]: JSON.stringify({ search: false }),
      [STORAGE_KEYS.homeSections]: JSON.stringify([
        { key: "artists", order: 0, visible: false }
      ])
    })
  );

  assert.equal(settings.bgEnabled, true);
  assert.equal(settings.bgBlur, 18);
  assert.equal(settings.themeMode, "light");
  assert.equal(settings.closeAppMethod, "exit");
  assert.equal(settings.searchInputBehavior, "clear");
  assert.equal(settings.shareUrlFormat, "mobile");
  assert.equal(settings.routeAnimation, "flow");
  assert.equal(settings.fullPlayerLayout, "lyrics");
  assert.equal(settings.dynamicCover, true);
  assert.equal(settings.fullPlayerShowCopyLyric, false);
  assert.equal(settings.fullPlayerShowLyricOffset, true);
  assert.equal(settings.contextMenuOptions.search, false);
  assert.equal(settings.contextMenuOptions.play, true);
  assert.equal(settings.contextMenuOptions.more, true);
  assert.equal(settings.contextMenuOptions.openFolder, true);
  assert.equal(settings.contextMenuOptions.deleteFromCloud, true);
  assert.equal(settings.contextMenuOptions.cloudMatch, true);
  assert.deepEqual(settings.homeSections, [{ key: "artists", order: 0, visible: false }]);
});

test("readUISettingsSnapshot falls back to defaults when injected storage fails", () => {
  const reported: Array<{ key: string; reason: string }> = [];
  const settings = readUISettingsSnapshot({
    storage: {
      getItem: () => {
        throw new Error("storage unavailable");
      }
    },
    events: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    },
    reportReadError: (key, reason) => {
      reported.push({ key, reason });
    }
  });

  assert.equal(settings.bgEnabled, false);
  assert.equal(settings.bgBlur, 32);
  assert.equal(settings.themeMode, "dark");
  assert.equal(settings.ncmSongLevel, "exhigh");
  assert.equal(reported.length > 0, true);
  assert.equal(reported[0]?.reason, "storage_unavailable");
});

test("createUISettingsStore keeps injected runtimes isolated", () => {
  const firstRuntime = mutableRuntimeFromValues({
    [STORAGE_KEYS.bgEnabled]: "false",
    [STORAGE_KEYS.bgBlur]: "12"
  });
  const secondRuntime = mutableRuntimeFromValues({
    [STORAGE_KEYS.bgEnabled]: "true",
    [STORAGE_KEYS.bgBlur]: "44"
  });

  const firstStore = createUISettingsStore(firstRuntime);
  const secondStore = createUISettingsStore(secondRuntime);

  assert.equal(firstStore.settings.bgEnabled, false);
  assert.equal(secondStore.settings.bgEnabled, true);
  assert.equal(firstStore.settings.bgBlur, 12);
  assert.equal(secondStore.settings.bgBlur, 44);

  firstRuntime.values[STORAGE_KEYS.bgEnabled] = "true";
  firstRuntime.values[STORAGE_KEYS.bgBlur] = "18";
  firstStore.sync();

  assert.equal(firstStore.settings.bgEnabled, true);
  assert.equal(secondStore.settings.bgEnabled, true);
  assert.equal(firstStore.settings.bgBlur, 18);
  assert.equal(secondStore.settings.bgBlur, 44);
});

test("persistUISetting writes through the injected runtime and notifies listeners", () => {
  const writes: Array<{ key: string; value: string }> = [];
  let notified = 0;
  const runtime: UISettingsRuntime = {
    storage: {
      getItem: () => null,
      setItem: (key, value) => {
        writes.push({ key, value });
      }
    },
    events: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    },
    notifyChange: () => {
      notified += 1;
    }
  };

  assert.equal(persistUISetting(STORAGE_KEYS.ncmSongLevel, "lossless", runtime), true);
  assert.deepEqual(writes, [{ key: STORAGE_KEYS.ncmSongLevel, value: "lossless" }]);
  assert.equal(notified, 1);
});

test("persistUISettingField writes schema-managed linked settings together", () => {
  const writes: Array<{ key: string; value: string }> = [];
  const values: Record<string, string> = {};
  let notified = 0;
  const runtime: UISettingsRuntime = {
    storage: {
      getItem: (key) => values[key] ?? null,
      setItem: (key, value) => {
        values[key] = value;
        writes.push({ key, value });
      }
    },
    events: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    },
    notifyChange: () => {
      notified += 1;
    }
  };

  assert.equal(persistUISettingField("playerType", "record", runtime), true);
  assert.deepEqual(writes, [
    { key: STORAGE_KEYS.playerType, value: "record" },
    { key: STORAGE_KEYS.fullPlayerCoverMode, value: "record" }
  ]);
  assert.equal(notified, 1);
});

test("persistUISettingField serializes structured home sections through schema metadata", () => {
  const values: Record<string, string> = {};
  const runtime: UISettingsRuntime = {
    storage: {
      getItem: (key) => values[key] ?? null,
      setItem: (key, value) => {
        values[key] = value;
      }
    },
    events: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }
  };

  const nextSections = [
    { key: "albums", order: 0, visible: false },
    { key: "dailyPicks", order: 1, visible: true }
  ] as const;

  assert.equal(persistUISettingField("homeSections", [...nextSections], runtime), true);
  assert.deepEqual(JSON.parse(values[STORAGE_KEYS.homeSections] ?? "null"), nextSections);
});

test("readUISettingsSnapshot reads custom appearance settings from schema", () => {
  const settings = readUISettingsSnapshot(
    runtimeFromValues({
      [STORAGE_KEYS.customAccentColor]: "#57c785",
      [STORAGE_KEYS.themeGlobalColor]: "true",
      [STORAGE_KEYS.globalFont]: "custom",
      [STORAGE_KEYS.customFontFamily]: '"LXGW WenKai", system-ui',
      [STORAGE_KEYS.customCss]: ".app-body { letter-spacing: 0; }",
      [STORAGE_KEYS.customJs]: "window.__custom = true;"
    })
  );

  assert.equal(settings.customAccentColor, "#57c785");
  assert.equal(settings.themeGlobalColor, true);
  assert.equal(settings.globalFont, "custom");
  assert.equal(settings.customFontFamily, '"LXGW WenKai", system-ui');
  assert.equal(settings.customCss, ".app-body { letter-spacing: 0; }");
  assert.equal(settings.customJs, "window.__custom = true;");
});

test("readUISettingsSnapshot rejects invalid SPlayer-aligned general enums", () => {
  const settings = readUISettingsSnapshot(
    runtimeFromValues({
      [STORAGE_KEYS.closeAppMethod]: "quit",
      [STORAGE_KEYS.updateChannel]: "dev",
      [STORAGE_KEYS.searchInputBehavior]: "unknown",
      [STORAGE_KEYS.shareUrlFormat]: "desktop"
    })
  );

  assert.equal(settings.closeAppMethod, "hide");
  assert.equal(settings.updateChannel, "stable");
  assert.equal(settings.searchInputBehavior, "normal");
  assert.equal(settings.shareUrlFormat, "web");
});

test("commitUISettingField rolls back local state when schema-managed persist fails", () => {
  let currentTheme: "dark" | "light" | "auto" = "dark";
  const runtime: UISettingsRuntime = {
    storage: {
      getItem: () => null,
      setItem: () => {
        throw new Error("no storage");
      }
    },
    events: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }
  };

  const readTheme = () => currentTheme;
  const setTheme: Setter<"dark" | "light" | "auto"> = ((value) => {
    currentTheme = typeof value === "function" ? value(currentTheme) : value;
    return currentTheme;
  }) as Setter<"dark" | "light" | "auto">;

  assert.equal(commitUISettingField("themeMode", "light", readTheme, setTheme, runtime), false);
  assert.equal(currentTheme, "dark");
});

test("persistUISetting reports write failures without throwing", () => {
  const reported: Array<{ key: string; reason: string }> = [];
  const readonlyRuntime: UISettingsRuntime = {
    storage: {
      getItem: () => null
    },
    events: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    },
    reportWriteError: (key, reason) => {
      reported.push({ key, reason });
    }
  };

  assert.equal(persistUISetting(STORAGE_KEYS.ncmSongLevel, "lossless", readonlyRuntime), false);
  assert.deepEqual(reported, [
    { key: STORAGE_KEYS.ncmSongLevel, reason: "storage_readonly" }
  ]);

  const throwingRuntime: UISettingsRuntime = {
    storage: {
      getItem: () => null,
      setItem: () => {
        throw new Error("no storage");
      }
    },
    events: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    },
    reportWriteError: (key, reason) => {
      reported.push({ key, reason });
    }
  };

  assert.equal(persistUISetting(STORAGE_KEYS.ncmSongLevel, "hires", throwingRuntime), false);
  assert.equal(reported[1]?.reason, "storage_unavailable");
});

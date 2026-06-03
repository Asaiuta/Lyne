import type { Accessor, Setter } from "solid-js";
import {
  DEFAULT_CONTEXT_MENU_OPTIONS,
  DEFAULT_HIDDEN_COVERS,
  DEFAULT_HOME_SECTIONS,
  DEFAULT_PLAYLIST_PAGE_ELEMENTS,
  DEFAULT_SIDEBAR_HIDDEN_ITEMS,
  NCM_SONG_LEVELS,
  type CloseAppMethod,
  type FullPlayerCommentMode,
  type FullPlayerCoverMode,
  type GlobalFont,
  type HomeSectionConfig,
  type HomeSectionKey,
  type LyricsBlendMode,
  type LyricsPosition,
  type LyricPriority,
  type NcmSongLevel,
  type PlayerBackgroundType,
  type PlayerExpandAnimation,
  type PlayerTimeFormat,
  type PlayerType,
  type RouteAnimation,
  type SearchInputBehavior,
  type ShareUrlFormat,
  type UISettings,
  type UISettingsBooleanFieldName,
  type UISettingsFieldName,
  type UpdateChannel
} from "./uiSettingsModel";

export const UI_SETTINGS_CHANGED_EVENT = "ui-settings-changed";

export interface UISettingsStorage {
  getItem: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}

export interface UISettingsEventTarget {
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
}

export interface UISettingsRuntime {
  storage: UISettingsStorage;
  events: UISettingsEventTarget;
  notifyChange?: () => void;
  reportReadError?: (key: string, reason: string) => void;
  reportWriteError?: (key: string, reason: string) => void;
}

const VALID_SONG_LEVELS = new Set<NcmSongLevel>(NCM_SONG_LEVELS);

const VALID_ROUTE_ANIMATIONS = new Set<RouteAnimation>([
  "none",
  "fade",
  "zoom",
  "slide",
  "up",
  "flow",
  "mask-left",
  "mask-top"
]);

const VALID_COMMENT_MODES = new Set<FullPlayerCommentMode>([
  "fullscreen",
  "half-left",
  "half-right"
]);

const VALID_COVER_MODES = new Set<FullPlayerCoverMode>(["normal", "record"]);

const VALID_PLAYER_TYPES = new Set<PlayerType>(["cover", "record", "fullscreen"]);

const VALID_PLAYER_BACKGROUND_TYPES = new Set<PlayerBackgroundType>([
  "animation",
  "blur",
  "color"
]);

const VALID_PLAYER_EXPAND_ANIMATIONS = new Set<PlayerExpandAnimation>(["up", "flow"]);

const VALID_GLOBAL_FONTS = new Set<GlobalFont>(["default", "system", "serif", "mono", "custom"]);

const VALID_TIME_FORMATS = new Set<PlayerTimeFormat>([
  "current-total",
  "remaining-total",
  "current-remaining"
]);

const VALID_CLOSE_APP_METHODS = new Set<CloseAppMethod>(["hide", "exit"]);

const VALID_UPDATE_CHANNELS = new Set<UpdateChannel>(["stable", "nightly"]);

const VALID_SHARE_URL_FORMATS = new Set<ShareUrlFormat>(["web", "mobile"]);

const VALID_SEARCH_INPUT_BEHAVIORS = new Set<SearchInputBehavior>([
  "normal",
  "clear",
  "sync"
]);

const VALID_LYRICS_POSITIONS = new Set<LyricsPosition>(["flex-start", "center", "flex-end"]);

const VALID_LYRICS_BLEND_MODES = new Set<LyricsBlendMode>(["screen", "plus-lighter"]);

const VALID_LYRIC_PRIORITIES = new Set<LyricPriority>(["auto", "official"]);

interface UISettingField<T> {
  key: string;
  defaultValue: T;
  read: (runtime: UISettingsRuntime) => T;
  write: (runtime: UISettingsRuntime, value: T) => boolean;
}

type UISettingsSchema = {
  [K in keyof UISettings]: UISettingField<UISettings[K]>;
};


type UISettingSerializedWrite = {
  key: string;
  value: string;
};

function createField<T>(
  key: string,
  defaultValue: T,
  read: (runtime: UISettingsRuntime) => T,
  serialize: (value: T) => string = (value) => String(value)
): UISettingField<T> {
  return {
    key,
    defaultValue,
    read,
    write: (runtime, value) => persistUISetting(key, serialize(value), runtime)
  };
}

function createBoolField(key: string, defaultValue: boolean): UISettingField<boolean> {
  return createField(key, defaultValue, (runtime) => readBool(runtime, key, defaultValue));
}

function createNumberField(key: string, defaultValue: number): UISettingField<number> {
  return createField(key, defaultValue, (runtime) => readNumber(runtime, key, defaultValue));
}

function createStringField(key: string, defaultValue: string): UISettingField<string> {
  return createField(key, defaultValue, (runtime) => readString(runtime, key, defaultValue));
}

function createStringArrayField(key: string, defaultValue: string[]): UISettingField<string[]> {
  return createField(
    key,
    defaultValue,
    (runtime) => readStringArray(runtime, key, defaultValue),
    (value) => JSON.stringify(normalizeStringArray(value))
  );
}

function createClampedNumberField(
  key: string,
  defaultValue: number,
  min: number,
  max: number
): UISettingField<number> {
  return createField(key, defaultValue, (runtime) =>
    Math.min(max, Math.max(min, readNumber(runtime, key, defaultValue)))
  );
}

function createEnumField<T extends string>(
  key: string,
  defaultValue: T,
  validValues: ReadonlySet<T>
): UISettingField<T> {
  return createField(key, defaultValue, (runtime) => {
    const raw = readString(runtime, key, defaultValue);
    if (validValues.has(raw as T)) {
      return raw as T;
    }
    reportReadError(runtime, key, "invalid_value");
    return defaultValue;
  });
}

function createBoolRecordField<T extends Record<string, boolean>>(
  key: string,
  defaultValue: T
): UISettingField<T> {
  return createField(
    key,
    defaultValue,
    (runtime) => readBoolRecord(runtime, key, defaultValue),
    (value) => JSON.stringify(value)
  );
}

function createHomeSectionsField(
  key: string,
  defaultValue: HomeSectionConfig[]
): UISettingField<HomeSectionConfig[]> {
  return createField(
    key,
    defaultValue,
    (runtime) => {
      try {
        const raw = runtime.storage.getItem(key);
        if (!raw) return defaultValue;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          reportReadError(runtime, key, "invalid_value");
          return defaultValue;
        }
        const validKeys = new Set(defaultValue.map((section) => section.key));
        const sections = parsed.filter(
          (section): section is HomeSectionConfig =>
            isPlainRecord(section) &&
            typeof section.key === "string" &&
            validKeys.has(section.key as HomeSectionKey) &&
            typeof section.order === "number" &&
            typeof section.visible === "boolean"
        );
        if (sections.length > 0) {
          return sections;
        }
        reportReadError(runtime, key, "invalid_value");
      } catch {
        reportReadError(runtime, key, "invalid_json");
      }
      return defaultValue;
    },
    (value) => JSON.stringify(value)
  );
}

function createFullPlayerLayoutField(
  key: string,
  defaultValue: UISettings["fullPlayerLayout"]
): UISettingField<UISettings["fullPlayerLayout"]> {
  return createField(key, defaultValue, (runtime) => {
    try {
      const raw = runtime.storage.getItem(key);
      if (raw === "lyrics" || raw === "balanced") {
        return raw;
      }
      if (raw !== null) {
        reportReadError(runtime, key, "invalid_value");
      }
    } catch {
      reportReadError(runtime, key, "storage_unavailable");
    }
    return defaultValue;
  });
}

function createPlayerTypeField(
  key: string,
  defaultValue: PlayerType,
  coverModeField: UISettingField<FullPlayerCoverMode>
): UISettingField<PlayerType> {
  return {
    key,
    defaultValue,
    read: (runtime) => {
      const raw = readString(runtime, key, "");
      if (VALID_PLAYER_TYPES.has(raw as PlayerType)) {
        return raw as PlayerType;
      }
      if (raw.trim().length > 0) {
        reportReadError(runtime, key, "invalid_value");
      }
      return coverModeField.read(runtime) === "record" ? "record" : defaultValue;
    },
    write: (runtime, value) =>
      persistUISettingsBatch(
        [
          { key, value },
          { key: coverModeField.key, value: value === "record" ? "record" : "normal" }
        ],
        runtime
      )
  };
}

const fullPlayerCoverModeField = createEnumField(
  "ui.fullPlayer.coverMode",
  "normal",
  VALID_COVER_MODES
);

const UI_SETTINGS_SCHEMA: UISettingsSchema = {
  useOnlineService: createBoolField("ui.general.useOnlineService", true),
  closeAppMethod: createEnumField("ui.general.closeAppMethod", "hide", VALID_CLOSE_APP_METHODS),
  showCloseAppTip: createBoolField("ui.general.showCloseAppTip", true),
  showTaskbarProgress: createBoolField("ui.general.showTaskbarProgress", false),
  checkUpdateOnStart: createBoolField("ui.general.checkUpdateOnStart", true),
  updateChannel: createEnumField("ui.general.updateChannel", "stable", VALID_UPDATE_CHANNELS),
  showSearchHistory: createBoolField("ui.search.showHistory", true),
  showHotSearch: createBoolField("ui.search.showHotSearch", true),
  enableSearchKeyword: createBoolField("ui.search.enableKeyword", true),
  searchInputBehavior: createEnumField(
    "ui.search.inputBehavior",
    "normal",
    VALID_SEARCH_INPUT_BEHAVIORS
  ),
  shareUrlFormat: createEnumField("ui.general.shareUrlFormat", "web", VALID_SHARE_URL_FORMATS),
  bgEnabled: createBoolField("ui.bg.enabled", false),
  bgBlur: createNumberField("ui.bg.blur", 32),
  bgMask: createNumberField("ui.bg.mask", 50),
  customChrome: createBoolField("ui.window.customChrome", true),
  fullPlayerLayout: createFullPlayerLayoutField("ui.fullPlayer.layout", "balanced"),
  fullPlayerAutoFocusLyrics: createBoolField("ui.fullPlayer.autoFocusLyrics", true),
  fullPlayerCommentMode: createEnumField(
    "ui.fullPlayer.commentMode",
    "fullscreen",
    VALID_COMMENT_MODES
  ),
  fullPlayerCoverMode: fullPlayerCoverModeField,
  playerType: createPlayerTypeField("ui.player.type", "cover", fullPlayerCoverModeField),
  playerStyleRatio: createClampedNumberField("ui.player.styleRatio", 50, 30, 70),
  playerFullscreenGradient: createClampedNumberField(
    "ui.player.fullscreenGradient",
    15,
    0,
    100
  ),
  playerBackgroundType: createEnumField(
    "ui.player.backgroundType",
    "blur",
    VALID_PLAYER_BACKGROUND_TYPES
  ),
  playerBackgroundFps: createClampedNumberField("ui.player.backgroundFps", 30, 24, 256),
  playerBackgroundFlowSpeed: createClampedNumberField(
    "ui.player.backgroundFlowSpeed",
    4,
    0.1,
    10
  ),
  playerBackgroundRenderScale: createClampedNumberField(
    "ui.player.backgroundRenderScale",
    0.5,
    0.1,
    3
  ),
  playerBackgroundPause: createBoolField("ui.player.backgroundPause", false),
  playerBackgroundLowFreqVolume: createBoolField("ui.player.backgroundLowFreqVolume", false),
  playerExpandAnimation: createEnumField(
    "ui.player.expandAnimation",
    "up",
    VALID_PLAYER_EXPAND_ANIMATIONS
  ),
  dynamicCover: createBoolField("ui.player.dynamicCover", false),
  playerFollowCoverColor: createBoolField("ui.player.followCoverColor", true),
  hiddenCovers: createBoolRecordField("ui.cover.hiddenCovers", DEFAULT_HIDDEN_COVERS),
  sidebarHiddenItems: createBoolRecordField(
    "ui.sidebar.hiddenItems",
    DEFAULT_SIDEBAR_HIDDEN_ITEMS
  ),
  playlistPageElements: createBoolRecordField(
    "ui.playlistPage.elements",
    DEFAULT_PLAYLIST_PAGE_ELEMENTS
  ),
  contextMenuOptions: createBoolRecordField(
    "ui.contextMenu.options",
    DEFAULT_CONTEXT_MENU_OPTIONS
  ),
  customAccentColor: createStringField("ui.theme.customAccentColor", "#fe7971"),
  themeFollowCover: createBoolField("ui.theme.followCover", false),
  themeGlobalColor: createBoolField("ui.theme.globalColor", false),
  globalFont: createEnumField("ui.font.global", "default", VALID_GLOBAL_FONTS),
  customFontFamily: createStringField("ui.font.customFamily", ""),
  customCss: createStringField("ui.custom.css", ""),
  customJs: createStringField("ui.custom.js", ""),
  menuShowCover: createBoolField("ui.sidebar.menuShowCover", true),
  fullPlayerShowAddToPlaylist: createBoolField("ui.fullPlayer.elements.addToPlaylist", true),
  fullPlayerShowCommentCount: createBoolField("ui.fullPlayer.elements.commentCount", false),
  fullPlayerShowComments: createBoolField("ui.fullPlayer.elements.comments", true),
  fullPlayerShowCopyLyric: createBoolField("ui.fullPlayer.elements.copyLyric", true),
  fullPlayerShowDesktopLyric: createBoolField("ui.fullPlayer.elements.desktopLyric", true),
  fullPlayerShowDownload: createBoolField("ui.fullPlayer.elements.download", true),
  fullPlayerShowLike: createBoolField("ui.fullPlayer.elements.like", true),
  fullPlayerShowLyricOffset: createBoolField("ui.fullPlayer.elements.lyricOffset", true),
  fullPlayerShowLyricSettings: createBoolField("ui.fullPlayer.elements.lyricSettings", true),
  fullPlayerShowMoreSettings: createBoolField("ui.fullPlayer.elements.moreSettings", true),
  autoHidePlayerMeta: createBoolField("ui.fullPlayer.autoHideMeta", true),
  showPlayMeta: createBoolField("ui.player.showPlayMeta", true),
  countDownShow: createBoolField("ui.player.countDownShow", true),
  showSpectrums: createBoolField("ui.fullPlayer.showSpectrums", false),
  homeSections: createHomeSectionsField("ui.home.sections", DEFAULT_HOME_SECTIONS),
  showHomeGreeting: createBoolField("ui.home.showGreeting", false),
  themeMode: createEnumField("ui.theme.mode", "auto", new Set(["dark", "light", "auto"])),
  ncmSongLevel: createEnumField("ncm.song.level", "exhigh", VALID_SONG_LEVELS),
  autoPlay: createBoolField("ui.playback.autoPlay", false),
  volumeFade: createBoolField("ui.playback.volumeFade", true),
  volumeFadeTime: createNumberField("ui.playback.volumeFadeTime", 300),
  memoryLastSeek: createBoolField("ui.playback.memoryLastSeek", true),
  localLyricDirectories: createStringArrayField("ui.local.lyricDirectories", []),
  lyricPriority: createEnumField("ui.lyric.priority", "auto", VALID_LYRIC_PRIORITIES),
  progressTooltipShow: createBoolField("ui.playback.progressTooltipShow", true),
  progressLyricShow: createBoolField("ui.playback.progressLyricShow", true),
  progressAdjustLyric: createBoolField("ui.playback.progressAdjustLyric", false),
  lyricFontSize: createNumberField("ui.lyric.fontSize", 28),
  lyricFontWeight: createNumberField("ui.lyric.fontWeight", 700),
  showLyricTranslation: createBoolField("ui.lyric.showTranslation", true),
  showLyricRomanization: createBoolField("ui.lyric.showRomanization", true),
  showWordLyrics: createBoolField("ui.lyric.showWordLyrics", true),
  lyricsBlur: createBoolField("ui.lyric.blurInactive", false),
  lyricsScrollOffset: createNumberField("ui.lyric.scrollOffset", 0.25),
  routeAnimation: createEnumField("ui.route.animation", "slide", VALID_ROUTE_ANIMATIONS),
  showPlaylistCount: createBoolField("ui.player.showPlaylistCount", true),
  barLyricShow: createBoolField("ui.player.barLyricShow", true),
  showSongQuality: createBoolField("ui.song.showQuality", true),
  showSongPrivilegeTag: createBoolField("ui.song.showPrivilegeTag", true),
  showSongExplicitTag: createBoolField("ui.song.showExplicitTag", true),
  showSongOriginalTag: createBoolField("ui.song.showOriginalTag", true),
  showSongAlbum: createBoolField("ui.song.showAlbum", true),
  showSongDuration: createBoolField("ui.song.showDuration", true),
  showSongOperations: createBoolField("ui.song.showOperations", true),
  showSongArtist: createBoolField("ui.song.showArtist", true),
  hideBracketedContent: createBoolField("ui.song.hideBracketedContent", false),
  showPlayerQuality: createBoolField("ui.player.showQuality", true),
  timeFormat: createEnumField("ui.player.timeFormat", "current-total", VALID_TIME_FORMATS),
  lyricTranslationFontSize: createNumberField("ui.lyric.translationFontSize", 22),
  lyricRomanizationFontSize: createNumberField("ui.lyric.romanizationFontSize", 18),
  swapLyricTranslationRomanization: createBoolField(
    "ui.lyric.swapTranslationRomanization",
    false
  ),
  lyricsPosition: createEnumField("ui.lyric.position", "flex-start", VALID_LYRICS_POSITIONS),
  lyricHorizontalOffset: createNumberField("ui.lyric.horizontalOffset", 10),
  lyricAlignRight: createBoolField("ui.lyric.alignRight", false),
  lyricsBlendMode: createEnumField("ui.lyric.blendMode", "screen", VALID_LYRICS_BLEND_MODES)
};

export const STORAGE_KEYS = Object.fromEntries(
  Object.entries(UI_SETTINGS_SCHEMA).map(([field, schema]) => [field, schema.key])
) as { [K in keyof UISettings]: UISettingsSchema[K]["key"] };

const UI_SETTING_FIELDS = Object.keys(UI_SETTINGS_SCHEMA) as UISettingsFieldName[];

const UI_SETTING_FIELD_BY_STORAGE_KEY = Object.fromEntries(
  UI_SETTING_FIELDS.map((field) => [UI_SETTINGS_SCHEMA[field].key, field])
) as Record<string, UISettingsFieldName>;

const fallbackUISettingsStorage: UISettingsStorage = {
  getItem: () => null
};

const fallbackUISettingsEvents: UISettingsEventTarget = {
  addEventListener: () => undefined,
  removeEventListener: () => undefined
};

export const browserUISettingsRuntime = (): UISettingsRuntime => ({
  storage: typeof localStorage === "undefined" ? fallbackUISettingsStorage : localStorage,
  events: typeof window === "undefined" ? fallbackUISettingsEvents : window,
  notifyChange: () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(UI_SETTINGS_CHANGED_EVENT));
    }
  },
  reportReadError: (key, reason) => {
    console.warn("[settings] failed to read setting", { key, reason });
  },
  reportWriteError: (key, reason) => {
    console.warn("[settings] failed to persist setting", { key, reason });
  }
});

function readBool(runtime: UISettingsRuntime, key: string, fallback: boolean): boolean {
  try {
    const raw = runtime.storage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    reportReadError(runtime, key, "storage_unavailable");
    return fallback;
  }
}

function reportReadError(
  runtime: UISettingsRuntime,
  key: string,
  reason: string
): void {
  runtime.reportReadError?.(key, reason);
}

function reportWriteError(
  runtime: UISettingsRuntime,
  key: string,
  reason: string
): void {
  runtime.reportWriteError?.(key, reason);
}

export function persistUISetting(
  key: string,
  value: string,
  runtime: UISettingsRuntime = browserUISettingsRuntime()
): boolean {
  return persistUISettingsBatch([{ key, value }], runtime);
}

function rollbackPersistedWrites(
  runtime: UISettingsRuntime,
  previousValues: ReadonlyArray<{ key: string; value: string | null }>
): void {
  if (!runtime.storage.setItem) {
    return;
  }
  previousValues.forEach(({ key, value }) => {
    try {
      if (value === null) {
        runtime.storage.removeItem?.(key);
      } else {
        runtime.storage.setItem?.(key, value);
      }
    } catch {
      // Best effort rollback only.
    }
  });
}

function persistUISettingsBatch(
  writes: ReadonlyArray<UISettingSerializedWrite>,
  runtime: UISettingsRuntime = browserUISettingsRuntime()
): boolean {
  const previousValues = writes.map(({ key }) => ({
    key,
    value: runtime.storage.getItem(key)
  }));
  try {
    if (!runtime.storage.setItem) {
      reportWriteError(runtime, writes[0]?.key ?? "unknown", "storage_readonly");
      return false;
    }
    for (const write of writes) {
      runtime.storage.setItem(write.key, write.value);
    }
    runtime.notifyChange?.();
    return true;
  } catch {
    rollbackPersistedWrites(runtime, previousValues);
    reportWriteError(runtime, writes[0]?.key ?? "unknown", "storage_unavailable");
    return false;
  }
}

export function persistUISettingField<K extends UISettingsFieldName>(
  field: K,
  value: UISettings[K],
  runtime: UISettingsRuntime = browserUISettingsRuntime()
): boolean {
  return UI_SETTINGS_SCHEMA[field].write(runtime, value);
}

export function readUISettingField<K extends UISettingsFieldName>(
  field: K,
  runtime: UISettingsRuntime = browserUISettingsRuntime()
): UISettings[K] {
  return UI_SETTINGS_SCHEMA[field].read(runtime);
}

export function commitUISettingField<K extends UISettingsFieldName>(
  field: K,
  value: UISettings[K],
  currentValue: Accessor<UISettings[K]>,
  setValue: Setter<UISettings[K]>,
  runtime: UISettingsRuntime = browserUISettingsRuntime()
): boolean {
  const previous = currentValue();
  setValue(() => value);
  if (persistUISettingField(field, value, runtime)) {
    return true;
  }
  setValue(() => previous);
  console.warn("[settings] failed to persist setting", {
    field,
    key: UI_SETTINGS_SCHEMA[field].key
  });
  return false;
}

export function toggleUISettingField<K extends UISettingsBooleanFieldName>(
  field: K,
  currentValue: Accessor<UISettings[K]>,
  setValue: Setter<UISettings[K]>,
  runtime: UISettingsRuntime = browserUISettingsRuntime()
): boolean {
  return commitUISettingField(field, (!currentValue()) as UISettings[K], currentValue, setValue, runtime);
}

export function storageKeyToUISettingField(key: string): UISettingsFieldName | null {
  return UI_SETTING_FIELD_BY_STORAGE_KEY[key] ?? null;
}

export function shouldSyncUISettingsFromEvent(event: Event): boolean {
  if (event.type !== "storage" || !("key" in event)) {
    return true;
  }
  const key = (event as StorageEvent).key;
  return key === null || storageKeyToUISettingField(key) !== null;
}

function readNumber(runtime: UISettingsRuntime, key: string, fallback: number): number {
  try {
    const raw = runtime.storage.getItem(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    reportReadError(runtime, key, "storage_unavailable");
    return fallback;
  }
}

function readString(runtime: UISettingsRuntime, key: string, fallback: string): string {
  try {
    const raw = runtime.storage.getItem(key);
    return raw ?? fallback;
  } catch {
    reportReadError(runtime, key, "storage_unavailable");
    return fallback;
  }
}

function normalizeStringArray(value: readonly string[]): string[] {
  return Array.from(
    new Set(
      value
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    )
  );
}

function readStringArray(
  runtime: UISettingsRuntime,
  key: string,
  fallback: string[]
): string[] {
  try {
    const raw = runtime.storage.getItem(key);
    if (!raw) return [...fallback];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      reportReadError(runtime, key, "invalid_json");
      return [...fallback];
    }
    return normalizeStringArray(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    reportReadError(runtime, key, "invalid_json");
    return [...fallback];
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoolRecord<T extends Record<string, boolean>>(
  runtime: UISettingsRuntime,
  key: string,
  fallback: T
): T {
  try {
    const raw = runtime.storage.getItem(key);
    if (!raw) return { ...fallback };
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecord(parsed)) {
      reportReadError(runtime, key, "invalid_json");
      return { ...fallback };
    }

    const next = { ...fallback };
    (Object.keys(fallback) as Array<keyof T>).forEach((field) => {
      const value = parsed[String(field)];
      if (typeof value === "boolean") {
        next[field] = value as T[typeof field];
      }
    });
    return next;
  } catch {
    reportReadError(runtime, key, "invalid_json");
    return { ...fallback };
  }
}

export function readUISettingsSnapshot(
  runtime: UISettingsRuntime = browserUISettingsRuntime()
): UISettings {
  return Object.fromEntries(
    UI_SETTING_FIELDS.map((field) => [field, readUISettingField(field, runtime)])
  ) as unknown as UISettings;
}

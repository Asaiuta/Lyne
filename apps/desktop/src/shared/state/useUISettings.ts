import { createStore } from "solid-js/store";
import { onCleanup, onMount } from "solid-js";

export type HomeSectionKey = "dailyPicks" | "playlists" | "radar" | "artists" | "mvs" | "podcasts" | "albums";

export type ThemeMode = "dark" | "light" | "auto";

export type RouteAnimation = "none" | "fade" | "zoom" | "slide" | "up" | "flow" | "mask-left" | "mask-top";

export interface HomeSectionConfig {
  key: HomeSectionKey;
  order: number;
  visible: boolean;
}

export interface UISettings {
  bgEnabled: boolean;
  bgBlur: number;
  bgMask: number;
  customChrome: boolean;
  fullPlayerLayout: "balanced" | "lyrics";
  fullPlayerAutoFocusLyrics: boolean;
  homeSections: HomeSectionConfig[];
  themeMode: ThemeMode;
  ncmSongLevel: string;
  autoPlay: boolean;
  volumeFade: boolean;
  volumeFadeTime: number;
  memoryLastSeek: boolean;
  lyricFontSize: number;
  showLyricTranslation: boolean;
  showWordLyrics: boolean;
  routeAnimation: RouteAnimation;
}

export const STORAGE_KEYS = {
  bgEnabled: "ui.bg.enabled",
  bgBlur: "ui.bg.blur",
  bgMask: "ui.bg.mask",
  customChrome: "ui.window.customChrome",
  fullPlayerLayout: "ui.fullPlayer.layout",
  fullPlayerAutoFocusLyrics: "ui.fullPlayer.autoFocusLyrics",
  homeSections: "ui.home.sections",
  themeMode: "ui.theme.mode",
  ncmSongLevel: "ncm.song.level",
  autoPlay: "ui.playback.autoPlay",
  volumeFade: "ui.playback.volumeFade",
  volumeFadeTime: "ui.playback.volumeFadeTime",
  memoryLastSeek: "ui.playback.memoryLastSeek",
  lyricFontSize: "ui.lyric.fontSize",
  showLyricTranslation: "ui.lyric.showTranslation",
  showWordLyrics: "ui.lyric.showWordLyrics",
  routeAnimation: "ui.route.animation"
} as const;

export const DEFAULT_HOME_SECTIONS: HomeSectionConfig[] = [
  { key: "dailyPicks", order: 0, visible: true },
  { key: "playlists", order: 1, visible: true },
  { key: "radar", order: 2, visible: true },
  { key: "artists", order: 3, visible: true },
  { key: "mvs", order: 4, visible: true },
  { key: "podcasts", order: 5, visible: true },
  { key: "albums", order: 6, visible: true }
];

const DEFAULTS: UISettings = {
  bgEnabled: false,
  bgBlur: 32,
  bgMask: 50,
  customChrome: true,
  fullPlayerLayout: "balanced",
  fullPlayerAutoFocusLyrics: true,
  homeSections: DEFAULT_HOME_SECTIONS,
  themeMode: "dark",
  ncmSongLevel: "exhigh",
  autoPlay: false,
  volumeFade: true,
  volumeFadeTime: 300,
  memoryLastSeek: true,
  lyricFontSize: 28,
  showLyricTranslation: true,
  showWordLyrics: true,
  routeAnimation: "slide"
};

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function readHomeSections(): HomeSectionConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.homeSections);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const validKeys = new Set(DEFAULT_HOME_SECTIONS.map((s) => s.key));
        const sections = parsed.filter(
          (s): s is HomeSectionConfig =>
            typeof s === "object" &&
            s !== null &&
            typeof s.key === "string" &&
            validKeys.has(s.key as HomeSectionKey) &&
            typeof s.order === "number" &&
            typeof s.visible === "boolean"
        );
        if (sections.length > 0) return sections;
      }
    }
  } catch {
    // corrupted — fall through
  }
  return DEFAULT_HOME_SECTIONS;
}

function readString(key: string, fallback: string): string {
  try {
    const raw = localStorage.getItem(key);
    return raw ?? fallback;
  } catch {
    return fallback;
  }
}

const VALID_SONG_LEVELS = new Set(["standard", "higher", "exhigh", "lossless", "hires", "jyeffect", "sky", "jymaster"]);

const VALID_ROUTE_ANIMATIONS = new Set<RouteAnimation>(["none", "fade", "zoom", "slide", "up", "flow", "mask-left", "mask-top"]);

function readRouteAnimation(): RouteAnimation {
  const raw = readString(STORAGE_KEYS.routeAnimation, DEFAULTS.routeAnimation);
  return VALID_ROUTE_ANIMATIONS.has(raw as RouteAnimation) ? (raw as RouteAnimation) : DEFAULTS.routeAnimation;
}

function readSettings(): UISettings {
  const layoutRaw = (() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.fullPlayerLayout);
    } catch {
      return null;
    }
  })();

  const fullPlayerLayout =
    layoutRaw === "lyrics" || layoutRaw === "balanced"
      ? layoutRaw
      : DEFAULTS.fullPlayerLayout;

  const themeRaw = readString(STORAGE_KEYS.themeMode, DEFAULTS.themeMode);
  const themeMode: ThemeMode =
    themeRaw === "light" || themeRaw === "auto" ? themeRaw : "dark";

  const levelRaw = readString(STORAGE_KEYS.ncmSongLevel, DEFAULTS.ncmSongLevel);
  const ncmSongLevel = VALID_SONG_LEVELS.has(levelRaw) ? levelRaw : DEFAULTS.ncmSongLevel;

  return {
    bgEnabled: readBool(STORAGE_KEYS.bgEnabled, DEFAULTS.bgEnabled),
    bgBlur: readNumber(STORAGE_KEYS.bgBlur, DEFAULTS.bgBlur),
    bgMask: readNumber(STORAGE_KEYS.bgMask, DEFAULTS.bgMask),
    customChrome: readBool(STORAGE_KEYS.customChrome, DEFAULTS.customChrome),
    fullPlayerLayout,
    fullPlayerAutoFocusLyrics: readBool(
      STORAGE_KEYS.fullPlayerAutoFocusLyrics,
      DEFAULTS.fullPlayerAutoFocusLyrics
    ),
    homeSections: readHomeSections(),
    themeMode,
    ncmSongLevel,
    autoPlay: readBool(STORAGE_KEYS.autoPlay, DEFAULTS.autoPlay),
    volumeFade: readBool(STORAGE_KEYS.volumeFade, DEFAULTS.volumeFade),
    volumeFadeTime: readNumber(STORAGE_KEYS.volumeFadeTime, DEFAULTS.volumeFadeTime),
    memoryLastSeek: readBool(STORAGE_KEYS.memoryLastSeek, DEFAULTS.memoryLastSeek),
    lyricFontSize: readNumber(STORAGE_KEYS.lyricFontSize, DEFAULTS.lyricFontSize),
    showLyricTranslation: readBool(STORAGE_KEYS.showLyricTranslation, DEFAULTS.showLyricTranslation),
    showWordLyrics: readBool(STORAGE_KEYS.showWordLyrics, DEFAULTS.showWordLyrics),
    routeAnimation: readRouteAnimation()
  };
}

/**
 * Reads UI settings from localStorage and listens for changes
 * dispatched by GeneralSettingsSection.
 */
export function useUISettings(): UISettings {
  const [settings, setSettings] = createStore<UISettings>(readSettings());

  const handleChange = () => {
    setSettings(readSettings());
  };

  onMount(() => {
    window.addEventListener("ui-settings-changed", handleChange);
  });

  onCleanup(() => {
    window.removeEventListener("ui-settings-changed", handleChange);
  });

  return settings;
}

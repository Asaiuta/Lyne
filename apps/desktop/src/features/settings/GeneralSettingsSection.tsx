import { Show, For, createSignal } from "solid-js";
import { useTranslation } from "../../shared/i18n";
import { HomeSectionManager } from "./HomeSectionManager";
import type { ThemeMode, RouteAnimation } from "../../shared/state/useUISettings";
import { STORAGE_KEYS } from "../../shared/state/useUISettings";

// ── helpers ──────────────────────────────────────────────

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

function readString(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: boolean | number | string) {
  try {
    localStorage.setItem(key, String(value));
  } catch { /* ignore */ }
  window.dispatchEvent(new Event("ui-settings-changed"));
}

// ── theme resolution ─────────────────────────────────────

function resolveTheme(mode: ThemeMode): "dark" | "light" {
  if (mode === "auto") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return mode;
}

function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = resolveTheme(mode);
}

// ── setting item component ───────────────────────────────

interface SettingItemProps {
  label: string;
  description?: string;
  children: any;
}

function SettingItem(props: SettingItemProps) {
  return (
    <div class="set-item">
      <div class="set-item-label">
        <span class="set-item-name">{props.label}</span>
        <Show when={props.description}>
          <span class="set-item-desc">{props.description}</span>
        </Show>
      </div>
      <div class="set-item-control">{props.children}</div>
    </div>
  );
}

function SettingGroup(props: { title: string; children: any }) {
  return (
    <div class="settings-section-group">
      <h3 class="settings-section-group-title">{props.title}</h3>
      {props.children}
    </div>
  );
}

// ── main component ───────────────────────────────────────

export function GeneralSettingsSection() {
  const { t } = useTranslation();

  // ── appearance state ──
  const [themeMode, setThemeMode] = createSignal<ThemeMode>(
    (() => {
      const raw = readString(STORAGE_KEYS.themeMode, "dark");
      return raw === "light" || raw === "auto" ? raw : "dark";
    })()
  );
  const [bgEnabled, setBgEnabled] = createSignal(readBool(STORAGE_KEYS.bgEnabled, false));
  const [bgBlur, setBgBlur] = createSignal(readNumber(STORAGE_KEYS.bgBlur, 32));
  const [bgMask, setBgMask] = createSignal(readNumber(STORAGE_KEYS.bgMask, 50));
  const [customChrome, setCustomChrome] = createSignal(readBool(STORAGE_KEYS.customChrome, true));

  // ── playback state ──
  const [autoPlay, setAutoPlay] = createSignal(readBool(STORAGE_KEYS.autoPlay, false));
  const [volumeFade, setVolumeFade] = createSignal(readBool(STORAGE_KEYS.volumeFade, true));
  const [volumeFadeTime, setVolumeFadeTime] = createSignal(readNumber(STORAGE_KEYS.volumeFadeTime, 300));
  const [memoryLastSeek, setMemoryLastSeek] = createSignal(readBool(STORAGE_KEYS.memoryLastSeek, true));

  // ── NCM state ──
  const [ncmSongLevel, setNcmSongLevel] = createSignal(readString(STORAGE_KEYS.ncmSongLevel, "exhigh"));

  // ── lyric state ──
  const [lyricFontSize, setLyricFontSize] = createSignal(readNumber(STORAGE_KEYS.lyricFontSize, 28));
  const [showLyricTranslation, setShowLyricTranslation] = createSignal(readBool(STORAGE_KEYS.showLyricTranslation, true));
  const [showWordLyrics, setShowWordLyrics] = createSignal(readBool(STORAGE_KEYS.showWordLyrics, true));

  // ── route animation state ──
  const VALID_ROUTE_ANIMATIONS = new Set<string>(["none", "fade", "zoom", "slide", "up", "flow", "mask-left", "mask-top"]);
  const [routeAnimation, setRouteAnimation] = createSignal<RouteAnimation>(
    (() => {
      const raw = readString(STORAGE_KEYS.routeAnimation, "slide");
      return VALID_ROUTE_ANIMATIONS.has(raw) ? (raw as RouteAnimation) : "slide";
    })()
  );

  // ── full player state ──
  const [fullPlayerLayout, setFullPlayerLayout] = createSignal<"balanced" | "lyrics">(
    (() => {
      const raw = localStorage.getItem(STORAGE_KEYS.fullPlayerLayout);
      return raw === "lyrics" || raw === "balanced" ? raw : "balanced";
    })()
  );
  const [fullPlayerAutoFocusLyrics, setFullPlayerAutoFocusLyrics] = createSignal(
    readBool(STORAGE_KEYS.fullPlayerAutoFocusLyrics, true)
  );

  // ── handlers ──

  const handleThemeChange = (mode: ThemeMode) => {
    setThemeMode(mode);
    persist(STORAGE_KEYS.themeMode, mode);
    applyTheme(mode);
  };

  const handleRouteAnimation = (value: RouteAnimation) => {
    setRouteAnimation(value);
    persist(STORAGE_KEYS.routeAnimation, value);
  };

  const handleBgToggle = () => {
    const next = !bgEnabled();
    setBgEnabled(next);
    persist(STORAGE_KEYS.bgEnabled, next);
  };

  const handleBgBlur = (v: number) => { setBgBlur(v); persist(STORAGE_KEYS.bgBlur, v); };
  const handleBgMask = (v: number) => { setBgMask(v); persist(STORAGE_KEYS.bgMask, v); };

  const handleCustomChrome = () => {
    const next = !customChrome();
    setCustomChrome(next);
    persist(STORAGE_KEYS.customChrome, next);
  };

  const handleAutoPlay = () => {
    const next = !autoPlay();
    setAutoPlay(next);
    persist(STORAGE_KEYS.autoPlay, next);
  };

  const handleVolumeFade = () => {
    const next = !volumeFade();
    setVolumeFade(next);
    persist(STORAGE_KEYS.volumeFade, next);
  };

  const handleVolumeFadeTime = (v: number) => { setVolumeFadeTime(v); persist(STORAGE_KEYS.volumeFadeTime, v); };

  const handleMemoryLastSeek = () => {
    const next = !memoryLastSeek();
    setMemoryLastSeek(next);
    persist(STORAGE_KEYS.memoryLastSeek, next);
  };

  const handleNcmSongLevel = (level: string) => {
    setNcmSongLevel(level);
    persist(STORAGE_KEYS.ncmSongLevel, level);
  };

  const handleLyricFontSize = (v: number) => { setLyricFontSize(v); persist(STORAGE_KEYS.lyricFontSize, v); };

  const handleShowLyricTranslation = () => {
    const next = !showLyricTranslation();
    setShowLyricTranslation(next);
    persist(STORAGE_KEYS.showLyricTranslation, next);
  };

  const handleShowWordLyrics = () => {
    const next = !showWordLyrics();
    setShowWordLyrics(next);
    persist(STORAGE_KEYS.showWordLyrics, next);
  };

  const handleFullPlayerLayout = (value: "balanced" | "lyrics") => {
    setFullPlayerLayout(value);
    persist(STORAGE_KEYS.fullPlayerLayout, value);
  };

  const handleFullPlayerAutoFocusLyrics = () => {
    const next = !fullPlayerAutoFocusLyrics();
    setFullPlayerAutoFocusLyrics(next);
    persist(STORAGE_KEYS.fullPlayerAutoFocusLyrics, next);
  };

  // ── NCM quality options ──
  const ROUTE_ANIMATIONS: { value: RouteAnimation; i18nKey: string }[] = [
    { value: "none", i18nKey: "settings.appearance.routeAnimation.none" },
    { value: "fade", i18nKey: "settings.appearance.routeAnimation.fade" },
    { value: "zoom", i18nKey: "settings.appearance.routeAnimation.zoom" },
    { value: "slide", i18nKey: "settings.appearance.routeAnimation.slide" },
    { value: "up", i18nKey: "settings.appearance.routeAnimation.up" },
    { value: "flow", i18nKey: "settings.appearance.routeAnimation.flow" },
    { value: "mask-left", i18nKey: "settings.appearance.routeAnimation.maskLeft" },
    { value: "mask-top", i18nKey: "settings.appearance.routeAnimation.maskTop" },
  ];

  const SONG_LEVELS: { value: string; i18nKey: string }[] = [
    { value: "standard", i18nKey: "settings.ncm.songLevel.standard" },
    { value: "higher", i18nKey: "settings.ncm.songLevel.higher" },
    { value: "exhigh", i18nKey: "settings.ncm.songLevel.exhigh" },
    { value: "lossless", i18nKey: "settings.ncm.songLevel.lossless" },
    { value: "hires", i18nKey: "settings.ncm.songLevel.hires" },
    { value: "jyeffect", i18nKey: "settings.ncm.songLevel.jyeffect" },
    { value: "sky", i18nKey: "settings.ncm.songLevel.sky" },
    { value: "jymaster", i18nKey: "settings.ncm.songLevel.jymaster" }
  ];

  return (
    <section class="settings-general-section">
      {/* ── Appearance ──────────────────────────── */}
      <SettingGroup title={t("settings.appearance.title")}>
        <SettingItem label={t("settings.appearance.themeMode")}>
          <select
            class="select-input"
            value={themeMode()}
            onChange={(e) => handleThemeChange(e.currentTarget.value as ThemeMode)}
          >
            <option value="dark">{t("settings.appearance.themeMode.dark")}</option>
            <option value="light">{t("settings.appearance.themeMode.light")}</option>
            <option value="auto">{t("settings.appearance.themeMode.auto")}</option>
          </select>
        </SettingItem>

        <SettingItem label={t("settings.appearance.routeAnimation")}>
          <select
            class="select-input"
            value={routeAnimation()}
            onChange={(e) => handleRouteAnimation(e.currentTarget.value as RouteAnimation)}
          >
            <For each={ROUTE_ANIMATIONS}>
              {(anim) => <option value={anim.value}>{t(anim.i18nKey as any)}</option>}
            </For>
          </select>
        </SettingItem>

        <SettingItem label={t("settings.general.background.enabled")}>
          <label class="toggle-switch">
            <input type="checkbox" checked={bgEnabled()} onChange={handleBgToggle} />
            <span class="toggle-switch-slider" />
          </label>
        </SettingItem>

        <Show when={bgEnabled()}>
          <SettingItem label={t("settings.general.background.blur")}>
            <div class="range-with-value">
              <span class="range-value">{bgBlur()}</span>
              <input
                type="range"
                min={0}
                max={80}
                step={1}
                value={bgBlur()}
                onInput={(e) => handleBgBlur(Number(e.currentTarget.value))}
              />
            </div>
          </SettingItem>
          <SettingItem label={t("settings.general.background.mask")}>
            <div class="range-with-value">
              <span class="range-value">{bgMask()}%</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={bgMask()}
                onInput={(e) => handleBgMask(Number(e.currentTarget.value))}
              />
            </div>
          </SettingItem>
        </Show>

        <SettingItem label={t("settings.general.window.customChrome")}>
          <label class="toggle-switch">
            <input type="checkbox" checked={customChrome()} onChange={handleCustomChrome} />
            <span class="toggle-switch-slider" />
          </label>
        </SettingItem>
      </SettingGroup>

      {/* ── Playback ────────────────────────────── */}
      <SettingGroup title={t("settings.playback.title")}>
        <SettingItem
          label={t("settings.playback.autoPlay")}
          description={t("settings.playback.autoPlay.desc")}
        >
          <label class="toggle-switch">
            <input type="checkbox" checked={autoPlay()} onChange={handleAutoPlay} />
            <span class="toggle-switch-slider" />
          </label>
        </SettingItem>

        <SettingItem
          label={t("settings.playback.volumeFade")}
          description={t("settings.playback.volumeFade.desc")}
        >
          <label class="toggle-switch">
            <input type="checkbox" checked={volumeFade()} onChange={handleVolumeFade} />
            <span class="toggle-switch-slider" />
          </label>
        </SettingItem>

        <Show when={volumeFade()}>
          <SettingItem label={t("settings.playback.volumeFadeTime")}>
            <div class="range-with-value">
              <span class="range-value">{volumeFadeTime()}ms</span>
              <input
                type="range"
                min={100}
                max={2000}
                step={50}
                value={volumeFadeTime()}
                onInput={(e) => handleVolumeFadeTime(Number(e.currentTarget.value))}
              />
            </div>
          </SettingItem>
        </Show>

        <SettingItem
          label={t("settings.playback.memoryLastSeek")}
          description={t("settings.playback.memoryLastSeek.desc")}
        >
          <label class="toggle-switch">
            <input type="checkbox" checked={memoryLastSeek()} onChange={handleMemoryLastSeek} />
            <span class="toggle-switch-slider" />
          </label>
        </SettingItem>
      </SettingGroup>

      {/* ── NCM ─────────────────────────────────── */}
      <SettingGroup title={t("settings.ncm.title")}>
        <SettingItem label={t("settings.ncm.songLevel")}>
          <select
            class="select-input"
            value={ncmSongLevel()}
            onChange={(e) => handleNcmSongLevel(e.currentTarget.value)}
          >
            <For each={SONG_LEVELS}>
              {(level) => <option value={level.value}>{t(level.i18nKey as any)}</option>}
            </For>
          </select>
        </SettingItem>
      </SettingGroup>

      {/* ── Lyrics ──────────────────────────────── */}
      <SettingGroup title={t("settings.lyric.title")}>
        <SettingItem label={t("settings.lyric.fontSize")}>
          <div class="range-with-value">
            <span class="range-value">{lyricFontSize()}px</span>
            <input
              type="range"
              min={16}
              max={48}
              step={1}
              value={lyricFontSize()}
              onInput={(e) => handleLyricFontSize(Number(e.currentTarget.value))}
            />
          </div>
        </SettingItem>

        <SettingItem
          label={t("settings.lyric.showTranslation")}
          description={t("settings.lyric.showTranslation.desc")}
        >
          <label class="toggle-switch">
            <input type="checkbox" checked={showLyricTranslation()} onChange={handleShowLyricTranslation} />
            <span class="toggle-switch-slider" />
          </label>
        </SettingItem>

        <SettingItem
          label={t("settings.lyric.showWordLyrics")}
          description={t("settings.lyric.showWordLyrics.desc")}
        >
          <label class="toggle-switch">
            <input type="checkbox" checked={showWordLyrics()} onChange={handleShowWordLyrics} />
            <span class="toggle-switch-slider" />
          </label>
        </SettingItem>
      </SettingGroup>

      {/* ── Full Player ─────────────────────────── */}
      <SettingGroup title={t("settings.general.fullPlayer.layout")}>
        <SettingItem label={t("settings.general.fullPlayer.layout")}>
          <select
            class="select-input"
            value={fullPlayerLayout()}
            onChange={(e) => handleFullPlayerLayout(e.currentTarget.value as "balanced" | "lyrics")}
          >
            <option value="balanced">{t("settings.general.fullPlayer.layout.balanced")}</option>
            <option value="lyrics">{t("settings.general.fullPlayer.layout.lyrics")}</option>
          </select>
        </SettingItem>

        <SettingItem label={t("settings.general.fullPlayer.autoFocusLyrics")}>
          <label class="toggle-switch">
            <input
              type="checkbox"
              checked={fullPlayerAutoFocusLyrics()}
              onChange={handleFullPlayerAutoFocusLyrics}
            />
            <span class="toggle-switch-slider" />
          </label>
        </SettingItem>
      </SettingGroup>

      {/* ── Home Section Order ───────────────────── */}
      <SettingGroup title={t("settings.general.homeSections.title")}>
        <HomeSectionManager />
      </SettingGroup>

      {/* ── hints ────────────────────────────────── */}
      <div class="settings-hint">{t("settings.general.window.modeHint")}</div>
      <Show when={!customChrome()}>
        <div class="settings-hint">{t("settings.general.window.restartHint")}</div>
      </Show>
    </section>
  );
}

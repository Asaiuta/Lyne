import type { UISettings } from "../state/uiSettingsModel";
import { DEFAULT_THEME_SEED_HEX, paletteEngine, type DynamicPalette } from "../theme/paletteEngine";

const CUSTOM_CSS_STYLE_ID = "audioplayer-custom-css";
const THEME_PRIMARY = "var(--theme-primary, var(--splayer-primary, var(--color-primary)))";
const THEME_BACKGROUND = "var(--theme-background, var(--splayer-background, var(--bg-base)))";
const THEME_SURFACE_CONTAINER =
  "var(--theme-surface-container, var(--splayer-surface-container, var(--surface-container-default)))";
const PLAYER_BAR_THEME_ACCENT = THEME_PRIMARY;
const FULL_PLAYER_COVER_ACCENT = "var(--player-cover-accent)";
const FULL_PLAYER_DEFAULT_ACCENT = "var(--player-cover-accent-default)";

type CssTokenName = `--${string}`;
type CssTokenEntry = readonly [CssTokenName, string];

export interface AppearanceColorTokenPlan {
  readonly semantic: readonly CssTokenEntry[];
  readonly themeGlobalColor: boolean;
}

type AppearanceColorSettings = Pick<UISettings, "playerFollowCoverColor" | "themeGlobalColor">;

const FONT_STACKS: Record<UISettings["globalFont"], string | null> = {
  default: null,
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"SF Mono", "JetBrains Mono", "Fira Code", ui-monospace, monospace',
  custom: null
};

function isSafeCssValue(value: string): boolean {
  return !/[;{}]/.test(value);
}

function readFontStack(settings: UISettings): string | null {
  if (settings.globalFont === "custom") {
    const trimmed = settings.customFontFamily.trim();
    return trimmed.length > 0 && isSafeCssValue(trimmed) ? trimmed : null;
  }
  return FONT_STACKS[settings.globalFont];
}

function applyAccentColor(settings: UISettings): void {
  const root = document.documentElement;
  const color = settings.customAccentColor.trim() || DEFAULT_THEME_SEED_HEX;
  paletteEngine.applySeed(color, root);
  applyAppearanceColorTokenPlan(settings, root);
}

function setTokenEntries(root: HTMLElement, entries: readonly CssTokenEntry[]): void {
  entries.forEach(([name, value]) => root.style.setProperty(name, value));
}

function syncColorModeAttributes(root: HTMLElement, settings: Pick<AppearanceColorSettings, "themeGlobalColor">): void {
  if (settings.themeGlobalColor) {
    root.dataset.themeGlobalColor = "true";
  } else {
    delete root.dataset.themeGlobalColor;
  }
}

function semanticTokenEntries(settings: AppearanceColorSettings): readonly CssTokenEntry[] {
  const surfaceEntries: readonly CssTokenEntry[] = settings.themeGlobalColor
    ? [
        ["--bg-dynamic", THEME_BACKGROUND],
        ["--surface-container-dynamic", THEME_SURFACE_CONTAINER],
        ["--player-bar-surface-dynamic", THEME_SURFACE_CONTAINER],
        ["--floating-surface-dynamic", THEME_SURFACE_CONTAINER]
      ]
    : [
        ["--bg-dynamic", "var(--bg-base)"],
        ["--surface-container-dynamic", "var(--surface-container-default)"],
        ["--player-bar-surface-dynamic", "var(--player-bar-surface-default)"],
        ["--floating-surface-dynamic", "var(--surface-2)"]
      ];

  return [
    ...surfaceEntries,
    ["--accent-dynamic", THEME_PRIMARY],
    ["--player-bar-accent-dynamic", PLAYER_BAR_THEME_ACCENT],
    [
      "--player-cover-color",
      settings.playerFollowCoverColor ? FULL_PLAYER_COVER_ACCENT : FULL_PLAYER_DEFAULT_ACCENT
    ]
  ];
}

export function buildAppearanceColorTokenPlan(settings: AppearanceColorSettings): AppearanceColorTokenPlan {
  return {
    semantic: semanticTokenEntries(settings),
    themeGlobalColor: settings.themeGlobalColor
  };
}

function applyAppearanceColorTokenPlan(settings: AppearanceColorSettings, root: HTMLElement): void {
  const plan = buildAppearanceColorTokenPlan(settings);
  syncColorModeAttributes(root, plan);
  setTokenEntries(root, plan.semantic);
}

export function applyThemePaletteForSettings(
  settings: UISettings,
  palette: DynamicPalette,
  root: HTMLElement = document.documentElement
): void {
  paletteEngine.applyPalette(palette, root);
  applyAppearanceColorTokenPlan(settings, root);
}

export function applyPlayerCoverAccentColor(
  accentColor: string | null,
  accentChannels: string | null = null,
  root: HTMLElement = document.documentElement
): void {
  if (accentColor) {
    setTokenEntries(root, [["--player-cover-accent-dynamic", accentColor]]);
  } else {
    root.style.removeProperty("--player-cover-accent-dynamic");
  }

  if (accentChannels) {
    setTokenEntries(root, [["--player-cover-accent-rgb", accentChannels]]);
  } else {
    root.style.removeProperty("--player-cover-accent-rgb");
  }
}

function applyGlobalFont(settings: UISettings): void {
  const root = document.documentElement;
  const stack = readFontStack(settings);
  if (!stack) {
    root.style.removeProperty("--font-sans");
    root.style.removeProperty("--font-display");
    return;
  }
  root.style.setProperty("--font-sans", stack);
  root.style.setProperty("--font-display", stack);
}

export function applyCustomCss(css: string): void {
  const trimmed = css.trim();
  const existing = document.getElementById(CUSTOM_CSS_STYLE_ID);
  if (!trimmed) {
    existing?.remove();
    return;
  }

  const style = existing instanceof HTMLStyleElement
    ? existing
    : document.createElement("style");
  style.id = CUSTOM_CSS_STYLE_ID;
  style.textContent = css;
  if (!style.parentNode) {
    document.head.appendChild(style);
  }
}

export function executeCustomJs(js: string): boolean {
  const trimmed = js.trim();
  if (!trimmed) return true;
  try {
    const customFunction = new Function(trimmed);
    customFunction();
    return true;
  } catch (error) {
    console.warn("[settings] custom JavaScript execution failed", error);
    return false;
  }
}

export function applyUserAppearanceSettings(
  settings: UISettings,
  options: { executeJs?: boolean } = {}
): void {
  if (typeof document === "undefined") return;
  applyAccentColor(settings);
  applyGlobalFont(settings);
  applyCustomCss(settings.customCss);
  if (options.executeJs) {
    executeCustomJs(settings.customJs);
  }
}

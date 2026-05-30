import type { UISettings } from "../state/useUISettings";
import { paletteEngine, type DynamicPalette } from "../theme/paletteEngine";

const CUSTOM_CSS_STYLE_ID = "audioplayer-custom-css";
const SPLAYER_PRIMARY = "var(--splayer-primary, var(--color-primary))";
const SPLAYER_BACKGROUND = "var(--splayer-background, var(--bg-base))";
const SPLAYER_SURFACE_CONTAINER = "var(--splayer-surface-container, var(--surface-container-default))";
const PLAYER_BAR_THEME_ACCENT = SPLAYER_PRIMARY;
const FULL_PLAYER_COVER_ACCENT = "var(--player-cover-accent)";
const FULL_PLAYER_DEFAULT_ACCENT = "var(--player-cover-accent-default)";

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
  const color = settings.customAccentColor.trim() || "#fe7971";
  paletteEngine.applySeed(color, root);
  applyDynamicAppearanceTokens(settings, root);
}

function applyDynamicAppearanceTokens(settings: UISettings, root: HTMLElement): void {
  applySurfaceTokens(settings, root);
  applyPlayerAccentTokens(settings, root);
  applyNaiveProviderTokens(settings, root);
}

function applySurfaceTokens(settings: UISettings, root: HTMLElement): void {
  if (settings.themeGlobalColor) {
    root.style.setProperty("--bg-dynamic", SPLAYER_BACKGROUND);
    root.style.setProperty("--surface-container-dynamic", SPLAYER_SURFACE_CONTAINER);
    root.style.setProperty("--player-bar-surface-dynamic", SPLAYER_SURFACE_CONTAINER);
    root.style.setProperty("--floating-surface-dynamic", SPLAYER_SURFACE_CONTAINER);
  } else {
    root.style.setProperty("--bg-dynamic", "var(--bg-base)");
    root.style.setProperty("--surface-container-dynamic", "var(--surface-container-default)");
    root.style.setProperty("--player-bar-surface-dynamic", "var(--player-bar-surface-default)");
    root.style.setProperty("--floating-surface-dynamic", "var(--surface-2)");
  }
}

function applyPlayerAccentTokens(settings: UISettings, root: HTMLElement): void {
  root.style.setProperty("--accent-dynamic", SPLAYER_PRIMARY);
  root.style.setProperty("--player-bar-accent-dynamic", PLAYER_BAR_THEME_ACCENT);
  root.style.setProperty(
    "--player-cover-color",
    settings.playerFollowCoverColor ? FULL_PLAYER_COVER_ACCENT : FULL_PLAYER_DEFAULT_ACCENT
  );
}

function alphaMix(color: string, alphaPercent: number): string {
  return `color-mix(in srgb, ${color} ${alphaPercent}%, transparent)`;
}

function setCommonNaiveThemeTokens(root: HTMLElement): void {
  root.style.setProperty("--naive-primary-color", SPLAYER_PRIMARY);
  root.style.setProperty("--naive-primary-color-hover", alphaMix(SPLAYER_PRIMARY, 78));
  root.style.setProperty("--naive-primary-color-pressed", alphaMix(SPLAYER_PRIMARY, 26));
  root.style.setProperty("--naive-primary-color-suppl", alphaMix(SPLAYER_PRIMARY, 12));
  root.style.setProperty("--naive-primary-color-09", alphaMix(SPLAYER_PRIMARY, 9));
  root.style.setProperty("--naive-primary-color-10", alphaMix(SPLAYER_PRIMARY, 10));
  root.style.setProperty("--naive-primary-color-12", alphaMix(SPLAYER_PRIMARY, 12));
  root.style.setProperty("--naive-primary-color-16", alphaMix(SPLAYER_PRIMARY, 16));
  root.style.setProperty("--naive-primary-color-20", alphaMix(SPLAYER_PRIMARY, 20));
  root.style.setProperty("--naive-primary-color-30", alphaMix(SPLAYER_PRIMARY, 30));
  root.style.setProperty("--naive-primary-color-38", alphaMix(SPLAYER_PRIMARY, 38));
  root.style.setProperty("--naive-primary-color-48", alphaMix(SPLAYER_PRIMARY, 48));
  root.style.setProperty("--naive-primary-color-58", alphaMix(SPLAYER_PRIMARY, 58));

  root.style.setProperty("--naive-slider-handle-color", SPLAYER_PRIMARY);
  root.style.setProperty("--naive-slider-fill-color", SPLAYER_PRIMARY);
  root.style.setProperty("--naive-slider-fill-color-hover", SPLAYER_PRIMARY);
  root.style.setProperty("--naive-slider-rail-color", alphaMix(SPLAYER_PRIMARY, 20));
  root.style.setProperty("--naive-slider-rail-color-hover", alphaMix(SPLAYER_PRIMARY, 30));
  root.style.setProperty("--naive-slider-indicator-color", SPLAYER_SURFACE_CONTAINER);
  root.style.setProperty("--naive-slider-indicator-text-color", SPLAYER_PRIMARY);

  root.style.setProperty("--naive-icon-color", SPLAYER_PRIMARY);
  root.style.setProperty("--naive-tooltip-color", SPLAYER_SURFACE_CONTAINER);
  root.style.setProperty("--naive-tooltip-text-color", SPLAYER_PRIMARY);
  root.style.setProperty("--naive-tabs-color-segment", SPLAYER_SURFACE_CONTAINER);
  root.style.setProperty("--naive-tabs-tab-color-segment", alphaMix(SPLAYER_PRIMARY, 12));
}

function setGlobalNaiveThemeTokens(root: HTMLElement): void {
  root.style.setProperty("--naive-text-color-1", SPLAYER_PRIMARY);
  root.style.setProperty("--naive-text-color-2", alphaMix(SPLAYER_PRIMARY, 82));
  root.style.setProperty("--naive-text-color-3", alphaMix(SPLAYER_PRIMARY, 52));
  root.style.setProperty("--naive-text-color-disabled", alphaMix(SPLAYER_PRIMARY, 30));
  root.style.setProperty("--naive-placeholder-color-disabled", alphaMix(SPLAYER_PRIMARY, 30));
  root.style.setProperty("--naive-icon-color-hover", alphaMix(SPLAYER_PRIMARY, 47.5));
  root.style.setProperty("--naive-icon-color-disabled", alphaMix(SPLAYER_PRIMARY, 30));
  root.style.setProperty("--naive-close-icon-color", alphaMix(SPLAYER_PRIMARY, 58));
  root.style.setProperty("--naive-hover-color", alphaMix(SPLAYER_PRIMARY, 9));
  root.style.setProperty("--naive-border-color", alphaMix(SPLAYER_PRIMARY, 9));
  root.style.setProperty("--naive-card-color", SPLAYER_SURFACE_CONTAINER);
  root.style.setProperty("--naive-tag-color", SPLAYER_SURFACE_CONTAINER);
  root.style.setProperty("--naive-modal-color", SPLAYER_SURFACE_CONTAINER);
  root.style.setProperty("--naive-popover-color", SPLAYER_SURFACE_CONTAINER);
  root.style.setProperty("--naive-button-color-2", alphaMix(SPLAYER_PRIMARY, 8));
  root.style.setProperty("--naive-button-color-2-hover", alphaMix(SPLAYER_PRIMARY, 12));
  root.style.setProperty("--naive-button-color-2-pressed", alphaMix(SPLAYER_PRIMARY, 8));
  root.style.setProperty("--naive-button-text-color-hover", alphaMix(SPLAYER_PRIMARY, 78));
  root.style.setProperty("--naive-button-text-color-focus", alphaMix(SPLAYER_PRIMARY, 58));
  root.style.setProperty("--naive-button-color-primary", alphaMix(SPLAYER_PRIMARY, 90));
  root.style.setProperty("--naive-button-color-hover-primary", SPLAYER_PRIMARY);
  root.style.setProperty("--naive-button-color-pressed-primary", alphaMix(SPLAYER_PRIMARY, 80));
  root.style.setProperty("--naive-button-color-focus-primary", SPLAYER_PRIMARY);
  root.style.setProperty("--naive-switch-rail-color-active", alphaMix(SPLAYER_PRIMARY, 80));
  root.style.setProperty("--naive-input-color", alphaMix(SPLAYER_PRIMARY, 10));
  root.style.setProperty("--naive-input-color-focus", SPLAYER_SURFACE_CONTAINER);
  root.style.setProperty("--naive-input-placeholder-color", alphaMix(SPLAYER_PRIMARY, 58));
  root.style.setProperty("--naive-input-border", `1px solid ${alphaMix(SPLAYER_PRIMARY, 10)}`);
  root.style.setProperty("--naive-input-clear-color", alphaMix(SPLAYER_PRIMARY, 38));
  root.style.setProperty("--naive-input-clear-color-hover", alphaMix(SPLAYER_PRIMARY, 48));
  root.style.setProperty("--naive-input-clear-color-pressed", alphaMix(SPLAYER_PRIMARY, 30));
  root.style.setProperty("--naive-empty-text-color", alphaMix(SPLAYER_PRIMARY, 38));
  root.style.setProperty("--naive-divider-color", alphaMix(SPLAYER_PRIMARY, 9));
  root.style.setProperty("--naive-dropdown-divider-color", alphaMix(SPLAYER_PRIMARY, 9));
  root.style.setProperty("--naive-layout-sider-border-color", alphaMix(SPLAYER_PRIMARY, 9));
  root.style.setProperty("--naive-drawer-header-border-bottom", `1px solid ${alphaMix(SPLAYER_PRIMARY, 9)}`);
  root.style.setProperty("--naive-drawer-footer-border-top", `1px solid ${alphaMix(SPLAYER_PRIMARY, 9)}`);
  root.style.setProperty("--naive-menu-divider-color", alphaMix(SPLAYER_PRIMARY, 9));
  root.style.setProperty("--naive-progress-rail-color", alphaMix(SPLAYER_PRIMARY, 16));
  root.style.setProperty("--naive-tabs-color-segment", alphaMix(SPLAYER_PRIMARY, 8));
}

function setNeutralNaiveThemeTokens(root: HTMLElement): void {
  root.style.setProperty("--naive-text-color-1", "var(--text)");
  root.style.setProperty("--naive-text-color-2", "var(--text-soft)");
  root.style.setProperty("--naive-text-color-3", "var(--muted)");
  root.style.setProperty("--naive-text-color-disabled", "var(--text-placeholder)");
  root.style.setProperty("--naive-placeholder-color-disabled", "var(--text-placeholder)");
  root.style.setProperty("--naive-icon-color-hover", "var(--text-soft)");
  root.style.setProperty("--naive-icon-color-disabled", "var(--text-placeholder)");
  root.style.setProperty("--naive-close-icon-color", "var(--muted)");
  root.style.setProperty("--naive-hover-color", "var(--state-hover-on-surface)");
  root.style.setProperty("--naive-border-color", "var(--border-overlay)");
  root.style.setProperty("--naive-card-color", "var(--surface-2)");
  root.style.setProperty("--naive-tag-color", "var(--surface-2)");
  root.style.setProperty("--naive-modal-color", "var(--floating-surface)");
  root.style.setProperty("--naive-popover-color", "var(--floating-surface)");
  root.style.setProperty("--naive-button-color-2", "var(--state-hover-on-surface)");
  root.style.setProperty("--naive-button-color-2-hover", "var(--state-pressed-on-surface)");
  root.style.setProperty("--naive-button-color-2-pressed", "var(--state-hover-on-surface)");
  root.style.setProperty("--naive-button-text-color-hover", "var(--naive-primary-color-hover)");
  root.style.setProperty("--naive-button-text-color-focus", "var(--naive-primary-color-58)");
  root.style.setProperty("--naive-button-color-primary", "var(--naive-primary-color)");
  root.style.setProperty("--naive-button-color-hover-primary", "var(--naive-primary-color-hover)");
  root.style.setProperty("--naive-button-color-pressed-primary", "var(--naive-primary-color-pressed)");
  root.style.setProperty("--naive-button-color-focus-primary", "var(--naive-primary-color)");
  root.style.setProperty("--naive-switch-rail-color-active", "var(--naive-primary-color)");
  root.style.setProperty("--naive-input-color", "color-mix(in oklch, var(--surface-2) 70%, transparent)");
  root.style.setProperty("--naive-input-color-focus", "var(--naive-input-color)");
  root.style.setProperty("--naive-input-placeholder-color", "var(--text-placeholder)");
  root.style.setProperty("--naive-input-border", "1px solid var(--border-subtle)");
  root.style.setProperty("--naive-input-clear-color", "var(--text-placeholder)");
  root.style.setProperty("--naive-input-clear-color-hover", "var(--text-soft)");
  root.style.setProperty("--naive-input-clear-color-pressed", "var(--text)");
  root.style.setProperty("--naive-empty-text-color", "var(--muted)");
  root.style.setProperty("--naive-divider-color", "var(--border-overlay)");
  root.style.setProperty("--naive-dropdown-divider-color", "var(--border-overlay)");
  root.style.setProperty("--naive-layout-sider-border-color", "var(--border-overlay)");
  root.style.setProperty("--naive-drawer-header-border-bottom", "1px solid var(--border-overlay)");
  root.style.setProperty("--naive-drawer-footer-border-top", "1px solid var(--border-overlay)");
  root.style.setProperty("--naive-menu-divider-color", "var(--border-overlay)");
  root.style.setProperty("--naive-progress-rail-color", "var(--surface-3)");
}

function applyNaiveProviderTokens(settings: UISettings, root: HTMLElement): void {
  setCommonNaiveThemeTokens(root);
  if (settings.themeGlobalColor) {
    setGlobalNaiveThemeTokens(root);
  } else {
    setNeutralNaiveThemeTokens(root);
  }
}

export function applyThemePaletteForSettings(
  settings: UISettings,
  palette: DynamicPalette,
  root: HTMLElement = document.documentElement
): void {
  paletteEngine.applyPalette(palette, root);
  applyDynamicAppearanceTokens(settings, root);
}

export function applyPlayerCoverAccentColor(
  accentColor: string | null,
  accentChannels: string | null = null,
  root: HTMLElement = document.documentElement
): void {
  if (accentColor) {
    root.style.setProperty("--player-cover-accent-dynamic", accentColor);
  } else {
    root.style.removeProperty("--player-cover-accent-dynamic");
  }

  if (accentChannels) {
    root.style.setProperty("--player-cover-accent-rgb", accentChannels);
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

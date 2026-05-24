import type { UISettings } from "../state/useUISettings";
import { paletteEngine } from "../theme/paletteEngine";

const CUSTOM_CSS_STYLE_ID = "audioplayer-custom-css";

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

  if (settings.themeGlobalColor) {
    root.style.setProperty(
      "--surface-container-dynamic",
      "var(--color-neutral-container)"
    );
  } else {
    root.style.setProperty("--surface-container-dynamic", "var(--surface-container-default)");
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

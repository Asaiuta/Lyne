import type { ThemeMode } from "../state/uiSettingsModel";

const LIGHT_COLOR_SCHEME_QUERY = "(prefers-color-scheme: light)";

/**
 * Single owner of the `ui.theme.mode` + `matchMedia` -> `data-theme`
 * resolution. Boot (mountMainWindow) and settings-change
 * (useAppearanceSettings) paths must both go through here.
 *
 * SSR-safe: without a window, "auto" resolves to "dark" (all current call
 * sites are browser-only, but shared/theme modules stay node-testable).
 */
export function resolveThemeMode(mode: ThemeMode): "dark" | "light" {
  if (mode === "auto") {
    if (typeof window === "undefined") return "dark";
    return window.matchMedia(LIGHT_COLOR_SCHEME_QUERY).matches ? "light" : "dark";
  }
  return mode;
}

export function applyThemeMode(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolveThemeMode(mode);
}

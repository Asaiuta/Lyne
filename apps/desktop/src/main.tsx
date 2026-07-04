import { ErrorBoundary } from "solid-js";
import { render } from "solid-js/web";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./shared/styles/global.css";
import "./shared/styles/appearance.css";
import "./shared/styles/components/naive.css";
import "./shared/styles/components/shell.css";
import "./shared/styles/components/pages.css";
import "./shared/styles/transitions.css";
import "virtual:uno.css";
import App from "./app/App";
import { I18nProvider } from "./shared/i18n";
import { NcmAccountProvider } from "./shared/state/NcmAccountContext";
import { readUISettingsSnapshot } from "./shared/state/uiSettingsStorage";
import { applyUserAppearanceSettings } from "./shared/styles/customAppearance";
import { installNativeBrowserBehaviorGuards } from "./shared/ui/nativeBrowserBehavior";

/** Which Tauri window this renderer is hosting (defaults to the main window). */
function resolveWindowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
}

// Apply theme before render to prevent flash
function applyTheme(): void {
  try {
    const mode = localStorage.getItem("ui.theme.mode") ?? "auto";
    const resolved =
      mode === "auto"
        ? window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark"
        : mode;
    document.documentElement.dataset.theme = resolved;
  } catch {
    document.documentElement.dataset.theme = window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
}

function mountMainWindow(target: HTMLElement): void {
  applyTheme();
  applyUserAppearanceSettings(readUISettingsSnapshot(), { executeJs: true });
  installNativeBrowserBehaviorGuards();

  render(
    () => (
      <ErrorBoundary
        fallback={(error) => (
          <main class="root-error-boundary" role="alert">
            <strong>Lyne failed to start</strong>
            <span>{error instanceof Error ? error.message : "Unknown error"}</span>
            <button type="button" class="ghost-button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </main>
        )}
      >
        <I18nProvider>
          <NcmAccountProvider>
            <App />
          </NcmAccountProvider>
        </I18nProvider>
      </ErrorBoundary>
    ),
    target
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

if (resolveWindowLabel() === "desktop-lyric") {
  // The transparent overlay window renders a standalone lyric surface with no
  // app shell, providers, or appearance theming.
  void import("./features/desktop-lyric/DesktopLyricApp").then(({ DesktopLyricApp }) => {
    render(() => <DesktopLyricApp />, root);
  });
} else {
  mountMainWindow(root);
}

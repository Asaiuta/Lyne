import { ErrorBoundary } from "solid-js";
import { render } from "solid-js/web";
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
import { readUISettingsSnapshot } from "./shared/state/useUISettings";
import { applyUserAppearanceSettings } from "./shared/styles/customAppearance";
import { installNativeBrowserBehaviorGuards } from "./shared/ui/nativeBrowserBehavior";

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
applyTheme();
applyUserAppearanceSettings(readUISettingsSnapshot(), { executeJs: true });
installNativeBrowserBehaviorGuards();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

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
  root
);

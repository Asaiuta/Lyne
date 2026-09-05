import { ErrorBoundary } from "solid-js";
import { render } from "solid-js/web";
import "../shared/styles/global.css";
import "../shared/styles/appearance.css";
import "../shared/styles/components/naive.css";
import "../shared/styles/components/shell.css";
import "../shared/styles/transitions.css";
import "virtual:uno.css";
import App from "./App";
import { I18nProvider, type LoadedLocale } from "../shared/i18n";
import { NcmAccountProvider } from "../shared/state/NcmAccountContext";
import { readUISettingField, readUISettingsSnapshot } from "../shared/state/uiSettingsStorage";
import { applyThemeMode } from "../shared/theme/themeResolver";
import { applyUserAppearanceSettings } from "../shared/styles/customAppearance";
import { installNativeBrowserBehaviorGuards } from "../shared/ui/nativeBrowserBehavior";
import { NaiveButton } from "../shared/ui/naive";

export function mountMainWindow(target: HTMLElement, initialLocale: LoadedLocale): void {
  applyThemeMode(readUISettingField("themeMode"));
  applyUserAppearanceSettings(readUISettingsSnapshot(), { executeJs: true });
  installNativeBrowserBehaviorGuards();

  render(
    () => (
      <ErrorBoundary
        fallback={(error) => (
          <main class="root-error-boundary" role="alert">
            <strong>Lyne failed to start</strong>
            <span>{error instanceof Error ? error.message : "Unknown error"}</span>
            <NaiveButton variant="tertiary" onClick={() => window.location.reload()}>
              Reload
            </NaiveButton>
          </main>
        )}
      >
        <I18nProvider initial={initialLocale}>
          <NcmAccountProvider>
            <App />
          </NcmAccountProvider>
        </I18nProvider>
      </ErrorBoundary>
    ),
    target
  );
}

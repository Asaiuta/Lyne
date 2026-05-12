import { render } from "solid-js/web";
import App from "./app/App";
import { I18nProvider } from "./shared/i18n";
import { NcmAccountProvider } from "./shared/state/NcmAccountContext";
import "./shared/styles/global.css";
import "./shared/styles/components/shell.css";
import "./shared/styles/components/pages.css";
import "./shared/styles/components/player.css";
import "./shared/styles/components/modals.css";
import "./shared/styles/transitions.css";
import "virtual:uno.css";

// Apply theme before render to prevent flash
function applyTheme(): void {
  try {
    const mode = localStorage.getItem("ui.theme.mode") ?? "dark";
    const resolved =
      mode === "auto"
        ? window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark"
        : mode;
    document.documentElement.dataset.theme = resolved;
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
}
applyTheme();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

render(
  () => (
    <I18nProvider>
      <NcmAccountProvider>
        <App />
      </NcmAccountProvider>
    </I18nProvider>
  ),
  root
);

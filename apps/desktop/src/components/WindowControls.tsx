import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "../shared/i18n";
import { IconClose, IconMaximize, IconMinimize, IconRestore } from "./icons";

interface WindowControlsProps {
  visible: boolean;
}

/**
 * Custom min/max/close buttons for the frameless Tauri window.
 * Uses @tauri-apps/api v2 `getCurrentWindow()` — no Rust commands needed.
 */
export function WindowControls(props: WindowControlsProps) {
  const { t } = useTranslation();
  const [appWindow, setAppWindow] = createSignal<ReturnType<typeof getCurrentWindow> | null>(null);
  const [maximized, setMaximized] = createSignal(false);
  let unlisten: (() => void) | undefined;

  onMount(() => {
    let currentWindow: ReturnType<typeof getCurrentWindow>;
    try {
      currentWindow = getCurrentWindow();
    } catch {
      return;
    }

    setAppWindow(currentWindow);
    void currentWindow.onResized(() => {
      void currentWindow.isMaximized().then(setMaximized);
    }).then((fn) => {
      unlisten = fn;
    });
    void currentWindow.isMaximized().then(setMaximized);
  });

  onCleanup(() => {
    unlisten?.();
  });

  const handleMinimize = () => {
    void appWindow()?.minimize();
  };

  const handleToggleMaximize = () => {
    void appWindow()?.toggleMaximize();
  };

  const handleClose = () => {
    void appWindow()?.close();
  };

  return (
    <Show when={props.visible && appWindow() !== null}>
      <div class="window-controls" data-no-drag>
        <button
          type="button"
          class="window-control-button"
          onClick={handleMinimize}
          aria-label={t("window.aria.minimize")}
          title={t("window.aria.minimize")}
        >
          <IconMinimize />
        </button>
        <button
          type="button"
          class="window-control-button"
          onClick={handleToggleMaximize}
          aria-label={maximized() ? t("window.aria.restore") : t("window.aria.maximize")}
          title={maximized() ? t("window.aria.restore") : t("window.aria.maximize")}
        >
          <Show when={maximized()} fallback={<IconMaximize />}>
            <IconRestore />
          </Show>
        </button>
        <button
          type="button"
          class="window-control-button is-close"
          onClick={handleClose}
          aria-label={t("window.aria.close")}
          title={t("window.aria.close")}
        >
          <IconClose />
        </button>
      </div>
    </Show>
  );
}

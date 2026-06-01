import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "../shared/i18n";
import { persistUISettingField } from "../shared/state/uiSettingsStorage";
import { useUISettings } from "../shared/state/useUISettings";
import { dialog, message } from "../shared/ui/naive/feedback-services";
import { IconClose, IconMaximize, IconMinimize, IconRestore } from "./icons";
import {
  requestWindowClose,
  type WindowCloseDecision
} from "./windowClosePolicy";

interface WindowControlsProps {
  visible: boolean;
}

/**
 * Custom min/max/close buttons for the frameless Tauri window.
 * Uses @tauri-apps/api v2 `getCurrentWindow()` — no Rust commands needed.
 */
export function WindowControls(props: WindowControlsProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const [appWindow, setAppWindow] = createSignal<ReturnType<typeof getCurrentWindow> | null>(null);
  const [maximized, setMaximized] = createSignal(false);
  let unlisten: (() => void) | undefined;

  onMount(() => {
    let currentWindow: ReturnType<typeof getCurrentWindow>;
    try {
      currentWindow = getCurrentWindow();
    } catch (error) {
      console.debug("[WindowControls] Tauri window API unavailable; controls hidden", error);
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

  const persistCloseChoice = (decision: WindowCloseDecision): boolean => {
    const closeMethodSaved = persistUISettingField("closeAppMethod", decision.action);
    const closeTipSaved = closeMethodSaved
      ? persistUISettingField("showCloseAppTip", false)
      : false;
    if (!closeMethodSaved || !closeTipSaved) {
      message.error(t("settings.general.persistFailed"));
      return false;
    }
    return true;
  };

  const promptForCloseChoice = (): Promise<WindowCloseDecision | null> =>
    new Promise((resolve) => {
      let remembered = false;
      let settled = false;
      const settle = (decision: WindowCloseDecision | null) => {
        if (settled) return;
        settled = true;
        resolve(decision);
      };

      dialog.warning({
        closable: false,
        title: t("window.closeConfirm.title"),
        content: (
          <div class="window-close-confirm">
            <p>{t("window.closeConfirm.content")}</p>
            <label class="window-close-confirm-remember">
              <input
                type="checkbox"
                checked={remembered}
                onChange={(event) => {
                  remembered = event.currentTarget.checked;
                }}
              />
              <span>{t("window.closeConfirm.remember")}</span>
            </label>
          </div>
        ),
        negativeText: t("window.closeConfirm.exit"),
        positiveText: t("window.closeConfirm.hide"),
        onNegativeClick: () => {
          settle({ action: "exit", remember: remembered });
        },
        onPositiveClick: () => {
          settle({ action: "hide", remember: remembered });
        }
      });
    });

  const applyClose = async () => {
    const currentWindow = appWindow();
    if (!currentWindow) return;
    await requestWindowClose(
      {
        closeAppMethod: uiSettings.closeAppMethod,
        showCloseAppTip: uiSettings.showCloseAppTip
      },
      {
        exitApp: () => currentWindow.close(),
        hideApp: () => currentWindow.hide(),
        persistCloseChoice,
        promptForCloseChoice
      }
    );
  };

  const handleClose = () => {
    void applyClose();
  };

  return (
    <Show when={props.visible && appWindow() !== null}>
      <div class="window-controls" data-no-drag>
        <div class="window-control-wrapper" onClick={handleMinimize} title={t("window.aria.minimize")}>
          <button
            type="button"
            class="window-control-button"
            onClick={(event) => {
              event.stopPropagation();
              handleMinimize();
            }}
            aria-label={t("window.aria.minimize")}
            title={t("window.aria.minimize")}
          >
            <IconMinimize />
          </button>
          <span class="window-control-expanded-area is-minimize" aria-hidden="true" />
        </div>
        <div
          class="window-control-wrapper"
          onClick={handleToggleMaximize}
          title={maximized() ? t("window.aria.restore") : t("window.aria.maximize")}
        >
          <button
            type="button"
            class="window-control-button"
            onClick={(event) => {
              event.stopPropagation();
              handleToggleMaximize();
            }}
            aria-label={maximized() ? t("window.aria.restore") : t("window.aria.maximize")}
            title={maximized() ? t("window.aria.restore") : t("window.aria.maximize")}
          >
            <Show when={maximized()} fallback={<IconMaximize />}>
              <IconRestore />
            </Show>
          </button>
          <span class="window-control-expanded-area is-maximize" aria-hidden="true" />
        </div>
        <div class="window-control-wrapper" onClick={handleClose} title={t("window.aria.close")}>
          <button
            type="button"
            class="window-control-button is-close"
            onClick={(event) => {
              event.stopPropagation();
              handleClose();
            }}
            aria-label={t("window.aria.close")}
            title={t("window.aria.close")}
          >
            <IconClose />
          </button>
          <span class="window-control-expanded-area is-close" aria-hidden="true" />
        </div>
      </div>
    </Show>
  );
}

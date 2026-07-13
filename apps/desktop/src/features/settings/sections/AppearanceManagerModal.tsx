import { Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { IconClose } from "../../../components/icons";
import { useTranslation } from "../../../shared/i18n";
import { usePresenceTransition } from "../../../shared/ui/usePresenceTransition";
import { hasVisibleSettingsFloatingSurface } from "../settingsFloatingSurfaces";
import type { ManagerConfig } from "./appearanceConfig";

interface AppearanceManagerModalProps {
  open: boolean;
  manager: ManagerConfig | null;
  onClose: () => void;
  children: JSX.Element;
}

export function AppearanceManagerModal(props: AppearanceManagerModalProps) {
  const { t } = useTranslation();
  const presence = usePresenceTransition(() => props.open && props.manager !== null);
  const [renderedManager, setRenderedManager] = createSignal<ManagerConfig | null>(
    props.manager
  );

  createEffect(() => {
    const manager = props.manager;
    if (manager !== null) {
      setRenderedManager(manager);
      return;
    }
    if (!presence.rendered()) {
      setRenderedManager(null);
    }
  });

  createEffect(() => {
    if (!props.open) return;

    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (hasVisibleSettingsFloatingSurface()) return;
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
    };

    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
  });

  const modalClass = () =>
    `appearance-manager-modal${presence.visible() && !presence.closing() ? " is-open" : ""}${presence.closing() ? " is-closing" : ""}`;

  const titleId = () => `appearance-manager-${renderedManager()?.panel ?? "dialog"}-title`;
  const descriptionId = () =>
    `appearance-manager-${renderedManager()?.panel ?? "dialog"}-description`;
  const closeLabel = () => t("window.aria.close");

  return (
    <Show when={presence.rendered() && typeof document !== "undefined" && renderedManager()} keyed>
      {(manager) => (
        <Portal mount={document.body}>
          <div
            class={modalClass()}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId()}
            aria-describedby={descriptionId()}
            onMouseDown={(event) => {
              if (props.open && event.target === event.currentTarget) {
                props.onClose();
              }
            }}
          >
            <div class="appearance-manager-card">
              <header class="appearance-manager-header">
                <div class="appearance-manager-copy">
                  <h2 id={titleId()}>{t(manager.labelKey)}</h2>
                  <p id={descriptionId()}>{t(manager.descriptionKey)}</p>
                </div>
                <button
                  type="button"
                  class="appearance-manager-close"
                  aria-label={closeLabel()}
                  title={closeLabel()}
                  onClick={props.onClose}
                >
                  <IconClose />
                </button>
              </header>
              <div class="appearance-manager-body">{props.children}</div>
            </div>
          </div>
        </Portal>
      )}
    </Show>
  );
}

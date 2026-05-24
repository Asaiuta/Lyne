import { createEffect, onCleanup, Show } from "solid-js";
import type { JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { useTranslation } from "../shared/i18n";
import { usePresenceTransition } from "../shared/ui/usePresenceTransition";
import { IconClose } from "./icons";
import "../shared/styles/components/modals.css";

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  closeAriaLabel?: string;
  children: JSX.Element;
  footer?: JSX.Element;
  size?: "sm" | "md" | "lg" | "directory" | "login";
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  hideHeader?: boolean;
}

/**
 * Minimal modal - no focus trap yet. Closes on backdrop click and Escape.
 * Rendered via Portal to escape stacking contexts.
 */
export function Modal(props: ModalProps) {
  const { t } = useTranslation();
  const presence = usePresenceTransition(() => props.open);

  createEffect(() => {
    if (!props.open) {
      return;
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && props.closeOnEscape !== false) {
        props.onClose();
      }
    };

    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
  });

  const size = () => props.size ?? "md";
  const closeLabel = () => props.closeAriaLabel ?? t("library.modal.manageRoots.close");

  return (
    <Show when={presence.rendered() && typeof document !== "undefined"}>
      <Portal mount={document.body}>
        <div
          class={`modal-backdrop${presence.visible() && !presence.closing() ? " is-open" : ""}${presence.closing() ? " is-closing" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label={props.title}
          onMouseDown={(event) => {
            if (
              props.open &&
              props.closeOnBackdrop !== false &&
              event.target === event.currentTarget
            ) {
              props.onClose();
            }
          }}
        >
          <div class={`modal-card modal-card-size-${size()}`}>
            <Show when={!props.hideHeader}>
              <header class="modal-card-header">
                <h3 class="modal-card-title">{props.title}</h3>
                <button
                  type="button"
                  class="modal-card-close"
                  aria-label={closeLabel()}
                  title={closeLabel()}
                  onClick={props.onClose}
                >
                  <IconClose />
                </button>
              </header>
            </Show>
            <div class="modal-card-body">{props.children}</div>
            <Show when={props.footer}>
              {(footer) => <footer class="modal-card-footer">{footer()}</footer>}
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
}

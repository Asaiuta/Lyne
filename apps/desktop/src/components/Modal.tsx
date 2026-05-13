import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { useTranslation } from "../shared/i18n";
import { IconClose } from "./icons";

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
  const [rendered, setRendered] = createSignal<boolean>(props.open);
  const [visible, setVisible] = createSignal<boolean>(false);
  const [closing, setClosing] = createSignal<boolean>(false);

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

  createEffect(() => {
    let closeTimer: number | undefined;
    let openFrame: number | undefined;

    if (props.open) {
      setRendered(true);
      setClosing(false);
      openFrame = window.requestAnimationFrame(() => setVisible(true));
    } else if (rendered()) {
      setVisible(false);
      setClosing(true);
      closeTimer = window.setTimeout(() => {
        setRendered(false);
        setClosing(false);
      }, 140);
    }

    onCleanup(() => {
      if (openFrame !== undefined) window.cancelAnimationFrame(openFrame);
      if (closeTimer !== undefined) window.clearTimeout(closeTimer);
    });
  });

  const size = () => props.size ?? "md";
  const closeLabel = () => props.closeAriaLabel ?? t("library.modal.manageRoots.close");

  return (
    <Show when={rendered() && typeof document !== "undefined"}>
      <Portal mount={document.body}>
        <div
          class={`modal-backdrop${visible() && !closing() ? " is-open" : ""}${closing() ? " is-closing" : ""}`}
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

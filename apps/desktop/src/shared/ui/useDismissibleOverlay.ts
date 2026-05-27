import { createEffect, onCleanup, type Accessor } from "solid-js";

export interface DismissibleOverlayOptions {
  /**
   * Returns `true` if the pointer target sits inside the overlay (or its
   * trigger) and should NOT dismiss. Lets callers combine multiple refs —
   * e.g. when a dropdown is rendered through a Portal and lives outside
   * the trigger's DOM subtree.
   */
  isInside: (target: Node) => boolean;
  onDismiss: () => void;
  /** Dismiss on Escape (default `true`). */
  escape?: boolean;
  /** Optional post-dismiss hook for Escape-only cleanup, such as trigger focus restore. */
  onEscapeDismiss?: () => void;
  /** Dismiss on capturing window scroll (default `false`). */
  scroll?: boolean;
  /** Dismiss on window blur (default `false`). */
  blur?: boolean;
}

/**
 * Wires up the standard popover/dropdown/menu dismiss handlers while
 * `isOpen()` is true and tears them down on close or owner cleanup.
 *
 * Replaces the hand-copied `createEffect(() => { if (!open()) return;
 * window.addEventListener("mousedown", …); window.addEventListener("keydown",
 * …); onCleanup(…) })` block that appeared in PlayerBar, FullPlayer,
 * SelectInput, ContextMenu, and SettingsSearchBox.
 */
export function useDismissibleOverlay(
  isOpen: Accessor<boolean>,
  options: DismissibleOverlayOptions
): void {
  createEffect(() => {
    if (!isOpen()) return;

    const handlePointer = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (options.isInside(event.target)) return;
      options.onDismiss();
    };
    window.addEventListener("mousedown", handlePointer);
    onCleanup(() => window.removeEventListener("mousedown", handlePointer));

    if (options.escape !== false) {
      const handleKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          options.onDismiss();
          options.onEscapeDismiss?.();
        }
      };
      window.addEventListener("keydown", handleKey);
      onCleanup(() => window.removeEventListener("keydown", handleKey));
    }

    if (options.scroll) {
      const handleScroll = () => options.onDismiss();
      window.addEventListener("scroll", handleScroll, true);
      onCleanup(() => window.removeEventListener("scroll", handleScroll, true));
    }

    if (options.blur) {
      const handleBlur = () => options.onDismiss();
      window.addEventListener("blur", handleBlur);
      onCleanup(() => window.removeEventListener("blur", handleBlur));
    }
  });
}

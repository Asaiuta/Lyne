import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";

interface PresenceTransitionOptions {
  durationMs?: number;
}

interface PresenceTransitionState {
  rendered: Accessor<boolean>;
  visible: Accessor<boolean>;
  closing: Accessor<boolean>;
}

const DEFAULT_DURATION_MS = 140;

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function usePresenceTransition(
  open: Accessor<boolean>,
  options: PresenceTransitionOptions = {}
): PresenceTransitionState {
  const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
  const [rendered, setRendered] = createSignal<boolean>(open());
  const [visible, setVisible] = createSignal<boolean>(false);
  const [closing, setClosing] = createSignal<boolean>(false);

  createEffect(() => {
    let closeTimer: number | undefined;
    let closeFrame: number | undefined;
    let openFrame: number | undefined;

    if (open()) {
      setRendered(true);
      setClosing(false);
      if (typeof window === "undefined" || prefersReducedMotion()) {
        setVisible(true);
      } else {
        openFrame = window.requestAnimationFrame(() => setVisible(true));
      }
    } else if (rendered()) {
      setVisible(false);
      setClosing(true);
      const finishClose = (): void => {
        setRendered(false);
        setClosing(false);
      };
      if (typeof window === "undefined") {
        finishClose();
      } else if (prefersReducedMotion()) {
        closeFrame = window.requestAnimationFrame(finishClose);
      } else {
        closeTimer = window.setTimeout(finishClose, durationMs);
      }
    }

    onCleanup(() => {
      if (typeof window === "undefined") return;
      if (openFrame !== undefined) window.cancelAnimationFrame(openFrame);
      if (closeFrame !== undefined) window.cancelAnimationFrame(closeFrame);
      if (closeTimer !== undefined) window.clearTimeout(closeTimer);
    });
  });

  return {
    rendered,
    visible,
    closing
  };
}

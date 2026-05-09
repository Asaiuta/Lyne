import { createEffect, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import type { RouteAnimation } from "../shared/state/useUISettings";

interface PageTransitionProps {
  activePage: string;
  animation: RouteAnimation;
  /** Render function — receives the displayed page signal, which only updates after leave completes */
  children: (displayedPage: () => string) => JSX.Element;
}

/**
 * Out-in page transition wrapper.
 * On activePage change: leave animation on old content → swap → enter animation on new content.
 * The children render function receives displayedPage() so the inner Switch only re-renders
 * after the leave animation finishes, keeping old content visible during exit.
 */
export function PageTransition(props: PageTransitionProps) {
  const isNone = () => props.animation === "none";
  const [displayedPage, setDisplayedPage] = createSignal(props.activePage);

  let containerRef: HTMLDivElement | undefined;
  const pendingCleanups = new Set<() => void>();

  function animatePhase(
    el: Element | null,
    fromClass: string,
    activeClass: string,
    toClass: string
  ): Promise<void> {
    if (!el) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        el.removeEventListener("animationend", done);
        el.removeEventListener("transitionend", done);
        clearTimeout(tid);
        pendingCleanups.delete(cancel);
        el.classList.remove(activeClass, toClass);
        resolve();
      };
      const cancel = () => {
        el.removeEventListener("animationend", done);
        el.removeEventListener("transitionend", done);
        clearTimeout(tid);
      };
      pendingCleanups.add(cancel);
      el.addEventListener("animationend", done, { once: true });
      el.addEventListener("transitionend", done, { once: true });
      const tid = setTimeout(done, 600);
      pendingCleanups.add(() => clearTimeout(tid));

      el.classList.add(fromClass);
      (el as HTMLElement).offsetHeight; // force reflow
      el.classList.remove(fromClass);
      el.classList.add(activeClass, toClass);
    });
  }

  function cleanupPending() {
    for (const fn of pendingCleanups) fn();
    pendingCleanups.clear();
  }

  function getPanel(): Element | null {
    return containerRef?.querySelector(".panel") ?? containerRef?.firstElementChild ?? null;
  }

  // React to page changes
  createEffect(() => {
    const target = props.activePage;
    if (isNone()) {
      setDisplayedPage(target);
      return;
    }
    if (target === displayedPage()) return;

    const cls = props.animation;
    cleanupPending();

    const leavePanel = getPanel();
    const leaveFrom = `page-${cls}-leave-from`;
    const leaveActive = `page-${cls}-leave-active`;
    const leaveTo = `page-${cls}-leave-to`;
    const enterFrom = `page-${cls}-enter-from`;
    const enterActive = `page-${cls}-enter-active`;
    const enterTo = `page-${cls}-enter-to`;

    // Phase 1: leave animation on old content
    animatePhase(leavePanel, leaveFrom, leaveActive, leaveTo).then(() => {
      // Phase 2: swap content (Switch re-renders with new page)
      setDisplayedPage(target);
      // Phase 3: enter animation on new content (double-microtask waits for DOM update)
      queueMicrotask(() => {
        queueMicrotask(() => {
          const enterPanel = getPanel();
          animatePhase(enterPanel, enterFrom, enterActive, enterTo);
        });
      });
    });
  });

  // Initial mount: enter animation
  onMount(() => {
    if (!isNone()) {
      const cls = props.animation;
      queueMicrotask(() => {
        queueMicrotask(() => {
          const panel = getPanel();
          animatePhase(panel, `page-${cls}-enter-from`, `page-${cls}-enter-active`, `page-${cls}-enter-to`);
        });
      });
    }
  });

  onCleanup(cleanupPending);

  return (
    <div ref={containerRef} class="page-transition-container" style={{ display: "contents" }}>
      {props.children(displayedPage)}
    </div>
  );
}

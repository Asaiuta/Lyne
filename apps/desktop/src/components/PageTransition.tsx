import { createEffect, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import type { RouteAnimation } from "../shared/state/uiSettingsModel";
import type { ActivePage } from "../shared/ui/navigation";

interface PageTransitionProps {
  activePage: ActivePage;
  animation: RouteAnimation;
  onDisplayedPageChange?: (page: ActivePage) => void;
  /** Render function — receives the displayed page signal, which only updates after leave completes */
  children: (displayedPage: () => ActivePage) => JSX.Element;
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

  const readTimeList = (value: string): number[] =>
    value.split(",").map((part) => {
      const token = part.trim();
      if (token.endsWith("ms")) return Number.parseFloat(token);
      if (token.endsWith("s")) return Number.parseFloat(token) * 1000;
      return 0;
    }).filter((duration) => Number.isFinite(duration));

  const longestCssTimelineMs = (el: Element): number => {
    const style = window.getComputedStyle(el);
    const transitionDurations = readTimeList(style.transitionDuration);
    const transitionDelays = readTimeList(style.transitionDelay);
    const animationDurations = readTimeList(style.animationDuration);
    const animationDelays = readTimeList(style.animationDelay);
    const lastTransitionDelay = transitionDelays[transitionDelays.length - 1] ?? 0;
    const lastAnimationDelay = animationDelays[animationDelays.length - 1] ?? 0;
    const maxTransition = transitionDurations.reduce((max, duration, index) =>
      Math.max(max, duration + (transitionDelays[index] ?? lastTransitionDelay)), 0);
    const maxAnimation = animationDurations.reduce((max, duration, index) =>
      Math.max(max, duration + (animationDelays[index] ?? lastAnimationDelay)), 0);
    return Math.max(maxTransition, maxAnimation);
  };

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
        pendingCleanups.delete(clearTimer);
        el.classList.remove(activeClass, toClass);
        resolve();
      };
      const cancel = () => {
        el.removeEventListener("animationend", done);
        el.removeEventListener("transitionend", done);
        clearTimeout(tid);
      };
      pendingCleanups.add(cancel);

      el.classList.add(fromClass);
      (el as HTMLElement).offsetHeight; // force reflow
      el.classList.remove(fromClass);
      el.classList.add(activeClass, toClass);
      const timelineMs = longestCssTimelineMs(el);
      const tid = setTimeout(done, Math.max(50, timelineMs + 50));
      const clearTimer = () => clearTimeout(tid);
      pendingCleanups.add(clearTimer);
    });
  }

  function cleanupPending() {
    for (const fn of pendingCleanups) fn();
    pendingCleanups.clear();
  }

  function getPanel(): Element | null {
    return containerRef?.querySelector(".panel") ?? containerRef?.firstElementChild ?? null;
  }

  createEffect(() => {
    props.onDisplayedPageChange?.(displayedPage());
  });

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
    <div
      ref={containerRef}
      class="page-transition-container"
      style={{ display: "contents" }}
      data-perf-active-page={displayedPage()}
      data-perf-transition-pending={props.activePage !== displayedPage() ? "true" : undefined}
    >
      {props.children(displayedPage)}
    </div>
  );
}

import { createContext, createEffect, createMemo, createSignal, onCleanup, useContext } from "solid-js";
import type { Accessor, JSX, Setter } from "solid-js";
import {
  persistNavigationScrollPosition,
  readNavigationScrollPosition
} from "../../shared/state/navigationPersistence";

interface PageSurfaceContextValue {
  scrollTop: Accessor<number>;
  setScrollTop: Setter<number>;
  scrollRoot: Accessor<HTMLElement | null>;
  setScrollRoot: Setter<HTMLElement | null>;
  heroOffset: Accessor<number>;
  setHeroOffset: Setter<number>;
  scrollToTop: () => void;
}

const PageSurfaceContext = createContext<PageSurfaceContextValue | null>(null);

export function usePageSurfaceContext(): PageSurfaceContextValue {
  const context = useContext(PageSurfaceContext);
  if (!context) {
    throw new Error("usePageSurfaceContext must be used within PageSurface");
  }
  return context;
}

export function maybePageSurfaceContext(): PageSurfaceContextValue | null {
  return useContext(PageSurfaceContext);
}

interface PageSurfaceProps {
  children: JSX.Element;
  class?: string;
  floatingHero?: boolean;
  persistKey?: string;
  resetKey?: unknown;
}

const SCROLL_PERSIST_DELAY_MS = 200;

export function PageSurface(props: PageSurfaceProps) {
  const [scrollTop, setScrollTop] = createSignal<number>(0);
  const [scrollRoot, setScrollRoot] = createSignal<HTMLElement | null>(null);
  const [heroOffset, setHeroOffset] = createSignal<number>(0);
  let hasRestoredScroll = false;
  let previousResetKey = props.resetKey;
  let previousPersistKey = props.persistKey;
  let persistTimer: number | undefined;

  const context = createMemo<PageSurfaceContextValue>(() => ({
    scrollTop,
    setScrollTop,
    scrollRoot,
    setScrollRoot,
    heroOffset,
    setHeroOffset,
    scrollToTop: () => {
      const root = scrollRoot();
      if (!root) return;
      root.scrollTo({ top: 0, behavior: "smooth" });
    }
  }));

  createEffect(() => {
    const nextResetKey = props.resetKey;
    const persistKey = props.persistKey;
    const resetChanged = previousResetKey !== nextResetKey;
    const persistKeyChanged = previousPersistKey !== persistKey;
    previousResetKey = nextResetKey;
    previousPersistKey = persistKey;
    const root = scrollRoot();
    if ((!resetChanged || persistKeyChanged) && root && persistKey) {
      if (!persistKeyChanged && hasRestoredScroll) return;
      hasRestoredScroll = true;
      const restoredScrollTop = readNavigationScrollPosition(persistKey);
      if (restoredScrollTop > 0) {
        root.scrollTo({ top: restoredScrollTop });
        setScrollTop(restoredScrollTop);
        return;
      }
    }
    if (!resetChanged && !persistKeyChanged) return;
    hasRestoredScroll = false;
    if (root) {
      root.scrollTo({ top: 0 });
    }
    setScrollTop(0);
    hasRestoredScroll = root !== null;
    if (root && persistKey && resetChanged && !persistKeyChanged) {
      persistNavigationScrollPosition(persistKey, 0);
    }
  });

  createEffect(() => {
    const persistKey = props.persistKey;
    const nextScrollTop = scrollTop();
    if (!persistKey || !hasRestoredScroll) return;
    if (persistTimer !== undefined) {
      window.clearTimeout(persistTimer);
    }
    persistTimer = window.setTimeout(() => {
      persistTimer = undefined;
      persistNavigationScrollPosition(persistKey, nextScrollTop);
    }, SCROLL_PERSIST_DELAY_MS);
  });

  onCleanup(() => {
    if (persistTimer !== undefined) {
      window.clearTimeout(persistTimer);
      persistTimer = undefined;
    }
    if (props.persistKey && hasRestoredScroll) {
      persistNavigationScrollPosition(props.persistKey, scrollTop());
    }
    setScrollRoot(null);
    setScrollTop(0);
    setHeroOffset(0);
  });

  return (
    <PageSurfaceContext.Provider value={context()}>
      <section
        class={`page-surface${props.floatingHero === true ? " page-surface--floating-hero" : ""}${props.class ? ` ${props.class}` : ""}`}
        classList={{ "is-page-scrolled": scrollTop() > 0 }}
        data-page-surface
        style={{ "--page-hero-offset": `${heroOffset()}px` }}
      >
        {props.children}
      </section>
    </PageSurfaceContext.Provider>
  );
}

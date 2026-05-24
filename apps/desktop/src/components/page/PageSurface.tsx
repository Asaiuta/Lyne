import { createContext, createEffect, createMemo, createSignal, onCleanup, useContext } from "solid-js";
import type { Accessor, JSX, Setter } from "solid-js";

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
  resetKey?: unknown;
}

export function PageSurface(props: PageSurfaceProps) {
  const [scrollTop, setScrollTop] = createSignal<number>(0);
  const [scrollRoot, setScrollRoot] = createSignal<HTMLElement | null>(null);
  const [heroOffset, setHeroOffset] = createSignal<number>(0);

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
    props.resetKey;
    const root = scrollRoot();
    if (root) {
      root.scrollTo({ top: 0 });
    }
    setScrollTop(0);
  });

  onCleanup(() => {
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

import { onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { usePageSurfaceContext } from "./PageSurface";

interface PageBodyProps {
  children: JSX.Element;
  class?: string;
  offset?: boolean;
  scrollable?: boolean;
  scrollRootSelector?: string;
}

const DEFAULT_SCROLL_ROOT_SELECTOR = "[data-page-scroll-root]";

export function PageBody(props: PageBodyProps) {
  const surface = usePageSurfaceContext();
  let bodyRef: HTMLDivElement | undefined;
  let activeRoot: HTMLElement | null = null;
  let disposeScrollRoot: (() => void) | null = null;

  const resolveScrollRoot = (): HTMLElement | null => {
    if (!bodyRef) return null;
    if (props.scrollable === true) return bodyRef;
    return bodyRef.querySelector<HTMLElement>(
      props.scrollRootSelector ?? DEFAULT_SCROLL_ROOT_SELECTOR
    );
  };

  const bindScrollRoot = (nextRoot: HTMLElement | null) => {
    if (nextRoot === activeRoot) return;
    disposeScrollRoot?.();
    disposeScrollRoot = null;
    activeRoot = nextRoot;
    surface.setScrollRoot(nextRoot);
    surface.setScrollTop(nextRoot?.scrollTop ?? 0);
    if (!nextRoot) return;

    const handleScroll = () => {
      surface.setScrollTop(nextRoot.scrollTop);
    };
    nextRoot.addEventListener("scroll", handleScroll, { passive: true });
    disposeScrollRoot = () => {
      nextRoot.removeEventListener("scroll", handleScroll);
      if (surface.scrollRoot() === nextRoot) {
        surface.setScrollRoot(null);
        surface.setScrollTop(0);
      }
    };
  };

  onMount(() => {
    const syncScrollRoot = () => bindScrollRoot(resolveScrollRoot());
    syncScrollRoot();

    let frame = requestAnimationFrame(syncScrollRoot);
    const observer = new MutationObserver(syncScrollRoot);
    if (bodyRef) {
      observer.observe(bodyRef, {
        attributes: true,
        attributeFilter: ["data-page-scroll-root"],
        childList: true,
        subtree: true
      });
    }

    onCleanup(() => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      disposeScrollRoot?.();
      activeRoot = null;
      disposeScrollRoot = null;
    });
  });

  return (
    <div
      ref={bodyRef}
      class={`page-body${props.offset === true ? " page-body--hero-offset" : ""}${props.scrollable === true ? " page-body--scroll-root" : ""}${props.class ? ` ${props.class}` : ""}`}
      data-page-body
      data-page-scroll-root={props.scrollable === true ? "true" : undefined}
    >
      {props.children}
    </div>
  );
}

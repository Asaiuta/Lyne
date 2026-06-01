import { createEffect, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import {
  persistNavigationScrollPosition,
  readNavigationScrollPosition
} from "../shared/state/navigationPersistence";

interface ContentAreaProps {
  children: JSX.Element;
  persistKey?: string;
}

const SCROLL_PERSIST_DELAY_MS = 200;

export function ContentArea(props: ContentAreaProps) {
  let contentRef: HTMLElement | undefined;
  let previousPersistKey = props.persistKey;
  let persistTimer: number | undefined;
  let latestScrollTop = 0;

  const clearPersistTimer = () => {
    if (persistTimer === undefined) return;
    window.clearTimeout(persistTimer);
    persistTimer = undefined;
  };

  const persistCurrentScroll = (key: string | undefined) => {
    if (!key) return;
    persistNavigationScrollPosition(key, latestScrollTop);
  };

  createEffect(() => {
    const key = props.persistKey;
    if (!contentRef) return;

    if (previousPersistKey !== key) {
      clearPersistTimer();
      persistCurrentScroll(previousPersistKey);
      previousPersistKey = key;
    }

    const restoredScrollTop = key ? readNavigationScrollPosition(key) : 0;
    latestScrollTop = restoredScrollTop;
    contentRef.scrollTo({ top: restoredScrollTop });
  });

  const handleScroll = () => {
    const key = props.persistKey;
    if (!key || !contentRef) return;
    const scrollTop = contentRef.scrollTop;
    latestScrollTop = scrollTop;
    clearPersistTimer();
    persistTimer = window.setTimeout(() => {
      persistTimer = undefined;
      persistNavigationScrollPosition(key, scrollTop);
    }, SCROLL_PERSIST_DELAY_MS);
  };

  onCleanup(() => {
    clearPersistTimer();
    persistCurrentScroll(props.persistKey);
  });

  return (
    <main
      ref={contentRef}
      class="content-area"
      onScroll={handleScroll}
    >
      {props.children}
    </main>
  );
}

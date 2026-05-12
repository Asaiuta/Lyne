import { createSignal, type Accessor } from "solid-js";
import type { DiscoverCardItem } from "./types";

interface DiscoverCardsPage {
  items: DiscoverCardItem[];
  hasMore: boolean;
}

interface DiscoverCardsLoadContext {
  offset: number;
  currentItems: readonly DiscoverCardItem[];
}

interface PagedDiscoverCardsOptions {
  pageSize: number;
  onError?: (error: unknown) => void;
}

interface PagedDiscoverCardsController {
  items: Accessor<DiscoverCardItem[]>;
  isLoading: Accessor<boolean>;
  hasMore: Accessor<boolean>;
  hasLoaded: Accessor<boolean>;
  reset: () => Promise<void>;
  ensureLoaded: () => Promise<void>;
  loadMore: () => Promise<void>;
}

type DiscoverCardsLoader = (context: DiscoverCardsLoadContext) => Promise<DiscoverCardsPage>;
type LoadMode = "reset" | "append";

export function createPagedDiscoverCards(
  loadPage: DiscoverCardsLoader,
  options: PagedDiscoverCardsOptions
): PagedDiscoverCardsController {
  const [items, setItems] = createSignal<DiscoverCardItem[]>([]);
  const [isLoading, setIsLoading] = createSignal<boolean>(false);
  const [hasMore, setHasMore] = createSignal<boolean>(true);
  const [hasLoaded, setHasLoaded] = createSignal<boolean>(false);
  const [nextOffset, setNextOffset] = createSignal<number>(0);
  let requestVersion = 0;

  const run = async (mode: LoadMode) => {
    if (mode === "append" && (isLoading() || !hasMore())) return;

    const version = requestVersion + 1;
    requestVersion = version;
    const offset = mode === "reset" ? 0 : nextOffset();
    const currentItems = mode === "reset" ? [] : items();

    if (mode === "reset") {
      setItems([]);
      setHasMore(true);
      setNextOffset(0);
    }
    setIsLoading(true);

    try {
      const page = await loadPage({ offset, currentItems });
      if (version !== requestVersion) return;

      setItems(mode === "reset" ? page.items : [...currentItems, ...page.items]);
      setHasMore(page.hasMore);
      setNextOffset(offset + options.pageSize);
    } catch (error) {
      if (version !== requestVersion) return;

      options.onError?.(error);
      if (mode === "reset") {
        setItems([]);
        setNextOffset(0);
      }
      setHasMore(false);
    } finally {
      if (version !== requestVersion) return;

      setHasLoaded(true);
      setIsLoading(false);
    }
  };

  return {
    items,
    isLoading,
    hasMore,
    hasLoaded,
    reset: () => run("reset"),
    ensureLoaded: () => {
      if (hasLoaded() || isLoading()) return Promise.resolve();
      return run("reset");
    },
    loadMore: () => run("append")
  };
}

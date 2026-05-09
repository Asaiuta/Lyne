import { createContext, createEffect, createSignal, useContext } from "solid-js";
import type { Accessor, JSX, Setter } from "solid-js";
import type { ActivePage } from "../ui/navigation";

interface UISearchContextValue {
  query: Accessor<string>;
  setQuery: Setter<string>;
  activePage: Accessor<ActivePage>;
  submitNonce: Accessor<number>;
  submitSearch: () => void;
  history: Accessor<readonly string[]>;
  selectHistoryItem: (value: string) => void;
  clearHistory: () => void;
}

const UISearchContext = createContext<UISearchContextValue | null>(null);

type MaybeAccessor<T> = T | Accessor<T>;

interface UISearchProviderProps {
  activePage: MaybeAccessor<ActivePage>;
  children: JSX.Element;
}

const SEARCH_HISTORY_KEY = "ui.search.history";
const MAX_HISTORY_ITEMS = 8;

const toAccessor = <T,>(value: MaybeAccessor<T>): Accessor<T> =>
  typeof value === "function" ? (value as Accessor<T>) : () => value;

const readHistory = (): string[] => {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index)
      .slice(0, MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
};

const persistHistory = (history: readonly string[]) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Ignore storage failures.
  }
};

/**
 * Lifts the TopNav search query into a small global. Scoped to the Library
 * Songs tab in PR3 — `activePage` is forwarded so consumers can decide whether
 * to consume the query or render a "search disabled" hint.
 */
export function UISearchProvider(props: UISearchProviderProps) {
  const [query, setQuery] = createSignal("");
  const [submitNonce, setSubmitNonce] = createSignal(0);
  const [history, setHistory] = createSignal<readonly string[]>(readHistory());
  const activePage = toAccessor(props.activePage);

  createEffect(() => {
    persistHistory(history());
  });

  const pushHistory = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    setHistory((current) => [trimmed, ...current.filter((item) => item !== trimmed)].slice(0, MAX_HISTORY_ITEMS));
  };

  const submitSearch = () => {
    pushHistory(query());
    setSubmitNonce((current) => current + 1);
  };

  const selectHistoryItem = (value: string) => {
    setQuery(value);
  };

  const clearHistory = () => {
    setHistory([]);
  };

  return (
    <UISearchContext.Provider
      value={{
        query,
        setQuery,
        activePage,
        submitNonce,
        submitSearch,
        history,
        selectHistoryItem,
        clearHistory
      }}
    >
      {props.children}
    </UISearchContext.Provider>
  );
}

export function useUISearch(): UISearchContextValue {
  const ctx = useContext(UISearchContext);
  if (!ctx) {
    throw new Error("useUISearch must be used within UISearchProvider");
  }
  return ctx;
}

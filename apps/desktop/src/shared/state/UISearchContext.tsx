import { createContext, createEffect, createMemo, createSignal, useContext } from "solid-js";
import type { Accessor, JSX, Setter } from "solid-js";
import type { ActivePage } from "../ui/navigation";
import { persistUISettingField, readUISettingField } from "./uiSettingsStorage";

export interface OnlineSearchRequest {
  readonly query: string;
  readonly sourcePage: ActivePage;
  readonly version: number;
}

interface UISearchContextValue {
  query: Accessor<string>;
  setQuery: Setter<string>;
  activePage: Accessor<ActivePage>;
  submitNonce: Accessor<number>;
  submitSearch: () => void;
  pendingOnlineSearchRequest: Accessor<OnlineSearchRequest | null>;
  consumeOnlineSearchRequest: (version: number) => void;
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

const MAX_HISTORY_ITEMS = 8;

const toAccessor = <T,>(value: MaybeAccessor<T>): Accessor<T> =>
  typeof value === "function" ? (value as Accessor<T>) : () => value;

/**
 * Lifts the TopNav search query into a small global. Scoped to the Library
 * Songs tab in PR3 — `activePage` is forwarded so consumers can decide whether
 * to consume the query or render a "search disabled" hint.
 */
export function UISearchProvider(props: UISearchProviderProps) {
  // Search history lives in the uiSettingsStorage schema (`ui.search.history`,
  // createStringArrayField): read/write go through the validated, event-notifying
  // path instead of raw localStorage. The provider keeps its own trim/dedupe
  // on input (pushHistory) — the schema only normalizes the serialized array.
  const initialHistory = readUISettingField("searchHistory").slice(0, MAX_HISTORY_ITEMS);
  const [query, setQuery] = createSignal("");
  const [submitNonce, setSubmitNonce] = createSignal(0);
  const [onlineSearchRequest, setOnlineSearchRequest] =
    createSignal<OnlineSearchRequest | null>(null);
  const [consumedOnlineSearchVersion, setConsumedOnlineSearchVersion] = createSignal(0);
  const [history, setHistory] = createSignal<readonly string[]>(initialHistory);
  const activePage = toAccessor(props.activePage);
  let lastPersistedHistory = JSON.stringify(initialHistory);

  const pendingOnlineSearchRequest = createMemo<OnlineSearchRequest | null>(() => {
    const request = onlineSearchRequest();
    if (!request || request.version <= consumedOnlineSearchVersion()) {
      return null;
    }
    return request;
  });

  createEffect(() => {
    const nextHistory = history();
    const serializedHistory = JSON.stringify(nextHistory);
    if (serializedHistory === lastPersistedHistory) {
      return;
    }
    if (persistUISettingField("searchHistory", [...nextHistory])) {
      lastPersistedHistory = serializedHistory;
    }
  });

  const pushHistory = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    setHistory((current) => [trimmed, ...current.filter((item) => item !== trimmed)].slice(0, MAX_HISTORY_ITEMS));
  };

  const submitSearch = () => {
    const submittedQuery = query();
    const sourcePage = activePage();
    pushHistory(submittedQuery);
    setSubmitNonce((current) => current + 1);
    setOnlineSearchRequest((current) => ({
      query: submittedQuery,
      sourcePage,
      version: (current?.version ?? 0) + 1
    }));
  };

  const consumeOnlineSearchRequest = (version: number) => {
    setConsumedOnlineSearchVersion((current) => Math.max(current, version));
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
        pendingOnlineSearchRequest,
        consumeOnlineSearchRequest,
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

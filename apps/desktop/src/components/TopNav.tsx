import type { JSX } from "solid-js";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { searchDefault, searchHotDetail, searchSuggest, searchSuggestPc } from "../shared/api/ncm/search";
import {
  parseNcmSearchDefaultKeyword,
  parseNcmSearchHotDetail,
  parseNcmSearchSuggestions,
  type NcmSearchDefaultKeyword,
  type NcmSearchHotItem,
  type NcmSearchSuggestionItem,
  type NcmSearchSuggestionType
} from "../shared/api/ncmSearchEntryParsers";
import { useTranslation } from "../shared/i18n";
import { useUISearch } from "../shared/state/UISearchContext";
import { useUISettings } from "../shared/state/useUISettings";
import { isSearchEnabledPage, type ActivePage } from "../shared/ui/navigation";
import { NaiveButton, NaiveInput } from "../shared/ui/naive";
import { TopNavAccountMenu, type TopNavAccountCollectionTab } from "./TopNavAccountMenu";
import {
  searchFallbackKeyword,
  shouldLoadDefaultKeyword,
  shouldLoadHotSearches,
  shouldLoadSearchSuggestions,
  shouldShowSearchEntryPanel,
  visibleHotSearchItems
} from "./topNavSearchPolicy";
import {
  IconArtist,
  IconAlbum,
  IconChevronLeft,
  IconChevronRight,
  IconChat,
  IconMusic,
  IconSearch,
  IconSettings,
  IconPlaylist,
  IconSparkle,
  IconVideo
} from "./icons";

interface TopNavProps {
  activePage: ActivePage;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  onOpenSettings: () => void;
  onRequireNcmLogin: (options?: { disableUid?: boolean }) => void;
  onNavigateToLikedCollectionTab: (tab: TopNavAccountCollectionTab) => void;
  windowControls?: JSX.Element;
}

const TOP_NAV_HOT_LIMIT = 8;
const TOP_NAV_SUGGESTION_DEBOUNCE_MS = 180;

const loadNcmSuggestionItems = async (
  keywords: string,
  signal?: AbortSignal
): Promise<NcmSearchSuggestionItem[]> => {
  let pcError: unknown = null;
  try {
    const pcItems = parseNcmSearchSuggestions(await searchSuggestPc(keywords, { signal }));
    if (pcItems.length > 0) {
      return pcItems;
    }
  } catch (error) {
    pcError = error;
  }

  try {
    return parseNcmSearchSuggestions(await searchSuggest(keywords, { signal }));
  } catch (error) {
    throw pcError ?? error;
  }
};

/**
 * TopNav - search input wired to UISearchContext, settings action, and
 * window-controls slot for frameless mode.
 */
export function TopNav(props: TopNavProps) {
  const { t, td } = useTranslation();
  const suggestionTypeLabel = (type: NcmSearchSuggestionType) =>
    td(`nav.search.suggestion.${type}`);
  const uiSettings = useUISettings();
  const { query, setQuery, activePage: searchPage, submitSearch, history, selectHistoryItem, clearHistory } =
    useUISearch();

  const searchEnabled = () => uiSettings.useOnlineService && isSearchEnabledPage(searchPage());

  const searchScopeLabel = createMemo(() => t("nav.search.scope.online"));
  const [defaultKeyword, setDefaultKeyword] = createSignal<NcmSearchDefaultKeyword | null>(null);
  const [hotSearches, setHotSearches] = createSignal<readonly NcmSearchHotItem[]>([]);
  const [isSearchEntryLoading, setIsSearchEntryLoading] = createSignal(false);
  const [suggestions, setSuggestions] = createSignal<readonly NcmSearchSuggestionItem[]>([]);
  const [isSuggestionLoading, setIsSuggestionLoading] = createSignal(false);
  const [searchPanelOpen, setSearchPanelOpen] = createSignal(false);
  let searchInputRef: HTMLInputElement | undefined;

  const searchOpen = () => searchPanelOpen() && searchEnabled();
  const searchWrapClassName = () => `top-nav-search-wrap${searchOpen() ? " is-open" : ""}`;
  const searchClassName = () =>
    `top-nav-search${searchEnabled() ? "" : " is-disabled"}${searchOpen() ? " is-open" : ""}`;
  const searchTitle = () =>
    searchEnabled() ? undefined : t("nav.search.disabledHint", { scope: searchScopeLabel() });
  const ncmSearchEntryEnabled = () => searchEnabled();
  const trimmedSearchQuery = createMemo(() => query().trim());
  const defaultSearchLabel = createMemo(() =>
    uiSettings.useOnlineService && uiSettings.enableSearchKeyword
      ? defaultKeyword()?.showKeyword ?? null
      : null
  );
  const historyItems = createMemo(() =>
    uiSettings.showSearchHistory && trimmedSearchQuery().length === 0 ? history() : []
  );
  const visibleHotSearches = createMemo(() =>
    visibleHotSearchItems(hotSearches(), {
      limit: TOP_NAV_HOT_LIMIT,
      showHotSearch: uiSettings.useOnlineService && uiSettings.showHotSearch
    })
  );
  const showSearchPanel = () =>
    searchPanelOpen() &&
    searchEnabled() &&
    (showSearchEntryPanel() || showSuggestionPanel() || historyItems().length > 0);
  const showSearchEntryPanel = () =>
    shouldShowSearchEntryPanel({
      enableSearchKeyword: uiSettings.useOnlineService && uiSettings.enableSearchKeyword,
      ncmSearchEntryEnabled: ncmSearchEntryEnabled(),
      query: trimmedSearchQuery(),
      showHotSearch: uiSettings.useOnlineService && uiSettings.showHotSearch
    });
  const showSuggestionPanel = () =>
    shouldLoadSearchSuggestions({
      enableSearchKeyword: uiSettings.useOnlineService && uiSettings.enableSearchKeyword,
      ncmSearchEntryEnabled: ncmSearchEntryEnabled(),
      panelOpen: searchPanelOpen(),
      query: trimmedSearchQuery()
    });

  const handleSearchInput = (value: string) => {
    setQuery(value);
    setSearchPanelOpen(true);
  };

  const handleSearchSubmit = (fallbackKeyword?: string | null) => {
    if (!searchEnabled()) {
      return;
    }
    const targetKeyword =
      query().trim() ||
      searchFallbackKeyword(
        fallbackKeyword,
        uiSettings.useOnlineService && uiSettings.enableSearchKeyword
      );
    if (targetKeyword) {
      setQuery(targetKeyword);
    }
    submitSearch();
    setSearchPanelOpen(false);
  };

  const handleSearchClear = () => {
    setQuery("");
    setSuggestions([]);
    setSearchPanelOpen(true);
    searchInputRef?.focus();
  };

  const closeSearchFocus = () => {
    setSearchPanelOpen(false);
    if (uiSettings.searchInputBehavior === "clear") {
      setQuery("");
    }
    searchInputRef?.blur();
  };

  const handleSearchPanelKeyword = (keyword: string) => {
    setQuery(keyword);
    selectHistoryItem(keyword);
    handleSearchSubmit(keyword);
  };

  const suggestionIcon = (type: NcmSearchSuggestionType) => {
    switch (type) {
      case "song":
        return IconMusic;
      case "artist":
        return IconArtist;
      case "album":
        return IconAlbum;
      case "playlist":
        return IconPlaylist;
      case "video":
        return IconVideo;
      case "radio":
        return IconChat;
      default: {
        const _exhaustive: never = type;
        return _exhaustive;
      }
    }
  };

  createEffect(() => {
    const loadDefaultKeyword = shouldLoadDefaultKeyword({
      defaultKeywordLoaded: untrack(() => defaultKeyword() !== null),
      enableSearchKeyword: uiSettings.useOnlineService && uiSettings.enableSearchKeyword,
      hotSearchLoaded: untrack(() => hotSearches().length > 0),
      isLoading: untrack(isSearchEntryLoading),
      ncmSearchEntryEnabled: ncmSearchEntryEnabled(),
      panelOpen: searchPanelOpen(),
      query: trimmedSearchQuery(),
      showHotSearch: uiSettings.useOnlineService && uiSettings.showHotSearch
    });
    const loadHotSearches = shouldLoadHotSearches({
      defaultKeywordLoaded: untrack(() => defaultKeyword() !== null),
      enableSearchKeyword: uiSettings.useOnlineService && uiSettings.enableSearchKeyword,
      hotSearchLoaded: untrack(() => hotSearches().length > 0),
      isLoading: untrack(isSearchEntryLoading),
      ncmSearchEntryEnabled: ncmSearchEntryEnabled(),
      panelOpen: searchPanelOpen(),
      query: trimmedSearchQuery(),
      showHotSearch: uiSettings.useOnlineService && uiSettings.showHotSearch
    });

    if (!loadDefaultKeyword && !loadHotSearches) return;

    let cancelled = false;
    const abortController = new AbortController();
    setIsSearchEntryLoading(true);
    const requests = [
      loadDefaultKeyword
        ? searchDefault({ signal: abortController.signal })
        : Promise.resolve(null),
      loadHotSearches
        ? searchHotDetail({ signal: abortController.signal })
        : Promise.resolve(null)
    ] as const;

    void Promise.allSettled(requests).then((results) => {
      if (cancelled) return;
      const [defaultResult, hotResult] = results;
      if (loadDefaultKeyword && defaultResult.status === "fulfilled" && defaultResult.value) {
        setDefaultKeyword(parseNcmSearchDefaultKeyword(defaultResult.value));
      } else if (loadDefaultKeyword && defaultResult.status === "rejected") {
        console.warn("[TopNav] failed to load NCM default search keyword", defaultResult.reason);
      }
      if (loadHotSearches && hotResult.status === "fulfilled" && hotResult.value) {
        setHotSearches(parseNcmSearchHotDetail(hotResult.value));
      } else if (loadHotSearches && hotResult.status === "rejected") {
        console.warn("[TopNav] failed to load NCM hot searches", hotResult.reason);
      }
      setIsSearchEntryLoading(false);
    });
    onCleanup(() => {
      cancelled = true;
      abortController.abort();
      setIsSearchEntryLoading(false);
    });
  });

  createEffect(() => {
    const keyword = trimmedSearchQuery();
    if (
      !shouldLoadSearchSuggestions({
        enableSearchKeyword: uiSettings.useOnlineService && uiSettings.enableSearchKeyword,
        ncmSearchEntryEnabled: ncmSearchEntryEnabled(),
        panelOpen: searchPanelOpen(),
        query: keyword
      })
    ) {
      setSuggestions([]);
      setIsSuggestionLoading(false);
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();
    setIsSuggestionLoading(true);
    const timer = window.setTimeout(() => {
      void loadNcmSuggestionItems(keyword, abortController.signal)
        .then((items) => {
          if (!cancelled) {
            setSuggestions(items);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            console.warn("[TopNav] failed to load NCM search suggestions", error);
            setSuggestions([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsSuggestionLoading(false);
          }
        });
    }, TOP_NAV_SUGGESTION_DEBOUNCE_MS);

    onCleanup(() => {
      cancelled = true;
      window.clearTimeout(timer);
      abortController.abort();
    });
  });

  createEffect(() => {
    if (ncmSearchEntryEnabled()) return;
    setSearchPanelOpen(false);
    setSuggestions([]);
    setIsSuggestionLoading(false);
  });

  return (
    <header class="top-nav" role="banner">
      <div class="top-nav-group top-nav-history" role="group" aria-label={t("nav.aria.back")}>
        <NaiveButton
          class="top-nav-icon-button"
          circle
          tertiary
          dataNoDrag
          ariaLabel={t("nav.aria.back")}
          title={t("nav.aria.back")}
          onClick={props.onGoBack}
          disabled={!props.canGoBack}
        >
          <IconChevronLeft />
        </NaiveButton>
        <NaiveButton
          class="top-nav-icon-button"
          circle
          tertiary
          dataNoDrag
          ariaLabel={t("nav.aria.forward")}
          title={t("nav.aria.forward")}
          onClick={props.onGoForward}
          disabled={!props.canGoForward}
        >
          <IconChevronRight />
        </NaiveButton>
      </div>

      <div class="top-nav-main">
        <Show when={uiSettings.useOnlineService}>
          <div class={searchWrapClassName()}>
            <Show when={showSearchPanel()}>
              <div
                class="top-nav-search-mask"
                data-no-drag
                aria-hidden="true"
                onMouseDown={(event) => event.preventDefault()}
                onClick={closeSearchFocus}
              />
            </Show>
            <div class={searchClassName()} title={searchTitle()} data-no-drag>
              <NaiveInput
                inputRef={(element) => {
                  if (element instanceof HTMLInputElement) searchInputRef = element;
                }}
                type="search"
                class="top-nav-search-input"
                value={query()}
                clearable
                round
                clearAriaLabel={t("nav.search.clear")}
                onClear={handleSearchClear}
                onUpdateValue={handleSearchInput}
                onFocus={() => {
                  setSearchPanelOpen(true);
                }}
                onBlur={() =>
                  window.setTimeout(() => {
                    setSearchPanelOpen(false);
                    if (uiSettings.searchInputBehavior === "clear") {
                      setQuery("");
                    }
                  }, 120)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleSearchSubmit(defaultKeyword()?.realKeyword ?? null);
                  }
                }}
                placeholder={td(`nav.search.placeholder.${searchPage()}`)}
                ariaLabel={t("nav.aria.search")}
                disabled={!searchEnabled()}
                prefix={<IconSearch class="top-nav-search-icon" />}
              />
            </div>
            <Show when={showSearchPanel()}>
              <div class="top-nav-search-panel" role="listbox" aria-label={t("nav.search.panel.label")}>
              <Show when={showSearchEntryPanel()}>
                <Show when={defaultSearchLabel()}>
                  {(label) => (
                    <button
                      type="button"
                      class="top-nav-search-default"
                      role="option"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleSearchPanelKeyword(defaultKeyword()?.realKeyword ?? label())}
                    >
                      <IconSparkle class="top-nav-search-history-icon" />
                      <span class="top-nav-search-default-copy">
                        <span>{t("nav.search.defaultKeyword")}</span>
                        <strong>{label()}</strong>
                      </span>
                    </button>
                  )}
                </Show>
              </Show>

              <Show when={historyItems().length > 0}>
                <div class="top-nav-search-history-head">
                  <span>{t("nav.search.history.label")}</span>
                  <button
                    type="button"
                    class="top-nav-search-history-clear"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => clearHistory()}
                  >
                    {t("nav.search.history.clear")}
                  </button>
                </div>
                <For each={historyItems()}>
                  {(item) => (
                    <button
                      type="button"
                      class="top-nav-search-history-item"
                      role="option"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleSearchPanelKeyword(item)}
                    >
                      <IconSearch class="top-nav-search-history-icon" />
                      <span>{item}</span>
                    </button>
                  )}
                </For>
              </Show>

              <Show when={showSearchEntryPanel()}>
                <Show when={isSearchEntryLoading() && visibleHotSearches().length === 0}>
                  <div class="top-nav-search-status">{t("nav.search.loading")}</div>
                </Show>
                <Show when={visibleHotSearches().length > 0}>
                  <div class="top-nav-search-history-head">
                    <span>{t("nav.search.hot")}</span>
                  </div>
                  <For each={visibleHotSearches()}>
                    {(item, index) => (
                      <button
                        type="button"
                        class={`top-nav-search-history-item top-nav-search-hot-item${index() < 3 ? " is-leading" : ""}`}
                        role="option"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleSearchPanelKeyword(item.keyword)}
                      >
                        <span class="top-nav-search-hot-rank">{index() + 1}</span>
                        <span class="top-nav-search-item-copy">
                          <strong>{item.keyword}</strong>
                          <Show when={item.content}>
                            {(content) => <small>{content()}</small>}
                          </Show>
                        </span>
                      </button>
                    )}
                  </For>
                </Show>
              </Show>

              <Show when={showSuggestionPanel()}>
                <div class="top-nav-search-history-head">
                  <span>{t("nav.search.suggest")}</span>
                </div>
                <Show when={isSuggestionLoading()}>
                  <div class="top-nav-search-status">{t("nav.search.loading")}</div>
                </Show>
                <Show
                  when={suggestions().length > 0}
                  fallback={
                    <Show when={!isSuggestionLoading()}>
                      <div class="top-nav-search-status">{t("nav.search.noSuggestions")}</div>
                    </Show>
                  }
                >
                  <For each={suggestions()}>
                    {(item) => {
                      const Icon = suggestionIcon(item.type);
                      return (
                        <button
                          type="button"
                          class="top-nav-search-history-item top-nav-search-suggestion-item"
                          role="option"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleSearchPanelKeyword(item.keyword)}
                        >
                          <Icon class="top-nav-search-history-icon" />
                          <span class="top-nav-search-item-copy">
                            <strong>{item.keyword}</strong>
                            <small>
                              {suggestionTypeLabel(item.type)}{" "}
                              <Show when={item.subtitle}>
                                {(subtitle) => <span>{subtitle()}</span>}
                              </Show>
                            </small>
                          </span>
                        </button>
                      );
                    }}
                  </For>
                </Show>
              </Show>
              </div>
            </Show>
          </div>
        </Show>

        <div class="top-nav-drag" data-tauri-drag-region aria-hidden="true" />
      </div>

      <div class="top-nav-group top-nav-actions" data-no-drag>
        <Show when={uiSettings.useOnlineService}>
          <TopNavAccountMenu
            onRequireNcmLogin={props.onRequireNcmLogin}
            onNavigateToLikedCollectionTab={props.onNavigateToLikedCollectionTab}
          />
        </Show>
        <NaiveButton
          class="top-nav-icon-button"
          circle
          tertiary
          dataNoDrag
          ariaLabel={t("sidebar.nav.settings.label")}
          title={t("sidebar.nav.settings.label")}
          onClick={props.onOpenSettings}
        >
          <IconSettings />
        </NaiveButton>
        {props.windowControls}
      </div>
    </header>
  );
}

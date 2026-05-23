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
import { userSubcount, type NcmUserSubcountData } from "../shared/api/ncm/user";
import { useTranslation } from "../shared/i18n";
import { useNcmAccount } from "../shared/state/NcmAccountContext";
import { useUISearch } from "../shared/state/UISearchContext";
import { useUISettings } from "../shared/state/useUISettings";
import { isSearchEnabledPage, type ActivePage } from "../shared/ui/navigation";
import {
  IconArtist,
  IconAlbum,
  IconChevronLeft,
  IconChevronRight,
  IconChevronDown,
  IconChat,
  IconClose,
  IconMusic,
  IconSearch,
  IconSettings,
  IconPlus,
  IconPlaylist,
  IconPower,
  IconRefresh,
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
  onNavigateToLikedCollectionTab: (tab: "playlists" | "albums" | "artists") => void;
  windowControls?: JSX.Element;
}

const MAX_NCM_ACCOUNTS = 3;
const TOP_NAV_HOT_LIMIT = 8;
const TOP_NAV_SUGGESTION_DEBOUNCE_MS = 180;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNcmSearchEntryPage = (page: ActivePage): page is "recommend" | "discover" =>
  page === "recommend" || page === "discover";

const loadNcmSuggestionItems = async (keywords: string): Promise<NcmSearchSuggestionItem[]> => {
  let pcError: unknown = null;
  try {
    const pcItems = parseNcmSearchSuggestions(await searchSuggestPc(keywords));
    if (pcItems.length > 0) {
      return pcItems;
    }
  } catch (error) {
    pcError = error;
  }

  try {
    return parseNcmSearchSuggestions(await searchSuggest(keywords));
  } catch (error) {
    throw pcError ?? error;
  }
};

const readPositiveCount = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
};

const hasVipType = (vipType: number | null | undefined): boolean =>
  typeof vipType === "number" && vipType !== 0;

const readSubcountData = (payload: unknown): NcmUserSubcountData => {
  if (!isRecord(payload)) return {};
  return (isRecord(payload.data) ? payload.data : payload) as NcmUserSubcountData;
};

/**
 * TopNav - search input wired to UISearchContext, settings action, and
 * window-controls slot for frameless mode.
 */
export function TopNav(props: TopNavProps) {
  const { t, td } = useTranslation();
  const suggestionTypeLabel = (type: NcmSearchSuggestionType) =>
    td(`nav.search.suggestion.${type}`);
  const accountStore = useNcmAccount();
  const uiSettings = useUISettings();
  const { query, setQuery, activePage: searchPage, submitSearch, history, selectHistoryItem, clearHistory } =
    useUISearch();

  const searchEnabled = () => isSearchEnabledPage(searchPage());

  const searchScopeLabel = createMemo(() => {
    const page = searchPage();
    switch (page) {
      case "library":
        return t("nav.search.scope.library");
      case "recommend":
        return t("nav.search.scope.recommend");
      case "discover":
        return t("nav.search.scope.discover");
      default:
        return t("nav.search.scope.disabled");
    }
  });
  const account = createMemo(() => accountStore.activeAccount());
  const accountName = createMemo(() => account()?.nickname ?? t("nav.account.guest"));
  const accountAvatar = createMemo(() => account()?.avatarUrl ?? null);
  const isUidMode = createMemo(() => {
    const current = account();
    return current !== null && !current.hasCookie;
  });
  const [accountMenuOpen, setAccountMenuOpen] = createSignal(false);
  const [accountMenuFeedback, setAccountMenuFeedback] = createSignal<string | null>(null);
  const [accountStats, setAccountStats] = createSignal<NcmUserSubcountData>({});
  const [accountStatsUserId, setAccountStatsUserId] = createSignal<number | null>(null);
  const [isLoadingAccountStats, setIsLoadingAccountStats] = createSignal(false);
  const [validatedAccountUserId, setValidatedAccountUserId] = createSignal<number | null>(null);
  const [defaultKeyword, setDefaultKeyword] = createSignal<NcmSearchDefaultKeyword | null>(null);
  const [hotSearches, setHotSearches] = createSignal<readonly NcmSearchHotItem[]>([]);
  const [isSearchEntryLoading, setIsSearchEntryLoading] = createSignal(false);
  const [suggestions, setSuggestions] = createSignal<readonly NcmSearchSuggestionItem[]>([]);
  const [isSuggestionLoading, setIsSuggestionLoading] = createSignal(false);
  const [searchPanelOpen, setSearchPanelOpen] = createSignal(false);
  let accountMenuRef: HTMLDivElement | undefined;

  const searchClassName = () => `top-nav-search${searchEnabled() ? "" : " is-disabled"}`;
  const searchTitle = () =>
    searchEnabled() ? undefined : t("nav.search.disabledHint", { scope: searchScopeLabel() });
  const ncmSearchEntryEnabled = () => searchEnabled() && isNcmSearchEntryPage(searchPage());
  const trimmedSearchQuery = createMemo(() => query().trim());
  const defaultSearchLabel = createMemo(() => defaultKeyword()?.showKeyword ?? null);
  const historyItems = createMemo(() =>
    uiSettings.showSearchHistory && trimmedSearchQuery().length === 0 ? history() : []
  );
  const visibleHotSearches = createMemo(() => hotSearches().slice(0, TOP_NAV_HOT_LIMIT));
  const showSearchPanel = () =>
    searchPanelOpen() &&
    searchEnabled() &&
    (ncmSearchEntryEnabled() || historyItems().length > 0);
  const showSearchEntryPanel = () => ncmSearchEntryEnabled() && trimmedSearchQuery().length === 0;
  const showSuggestionPanel = () => ncmSearchEntryEnabled() && trimmedSearchQuery().length > 0;

  const accountOtherAccounts = createMemo(() => {
    const currentId = account()?.userId ?? null;
    return accountStore.userList().filter((item) => item.userId !== currentId);
  });

  const accountStatItems = createMemo(() => {
    const stats = accountStats();
    const playlistCount =
      readPositiveCount(stats.playlistCount) ||
      readPositiveCount(stats.createdPlaylistCount) + readPositiveCount(stats.subPlaylistCount);
    return [
      {
        key: "playlists" as const,
        label: t("ncm.collection.tabs.playlists"),
        value: playlistCount,
        icon: IconPlaylist
      },
      {
        key: "albums" as const,
        label: t("ncm.collection.tabs.albums"),
        value: readPositiveCount(stats.albumCount),
        icon: IconAlbum
      },
      {
        key: "artists" as const,
        label: t("ncm.collection.tabs.artists"),
        value: readPositiveCount(stats.artistCount),
        icon: IconArtist
      }
    ];
  });

  const handleSearchInput = (event: InputEvent) => {
    const target = event.currentTarget;
    if (target instanceof HTMLInputElement) {
      setQuery(target.value);
      setSearchPanelOpen(true);
    }
  };

  const handleSearchSubmit = (fallbackKeyword?: string | null) => {
    if (!searchEnabled()) {
      return;
    }
    const targetKeyword = query().trim() || fallbackKeyword?.trim() || null;
    if (targetKeyword) {
      setQuery(targetKeyword);
    }
    submitSearch();
    setSearchPanelOpen(false);
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

  const loadAccountStats = async () => {
    const current = account();
    if (!current || !current.hasCookie || accountStatsUserId() === current.userId) return;
    setIsLoadingAccountStats(true);
    try {
      setAccountStats(readSubcountData(await userSubcount()));
      setAccountStatsUserId(current.userId);
    } catch (error) {
      console.warn("[TopNav] failed to load account stats", error);
      setAccountStats({});
      setAccountStatsUserId(current.userId);
    } finally {
      setIsLoadingAccountStats(false);
    }
  };

  const handleExpiredActiveLogin = () => {
    setAccountStats({});
    setAccountStatsUserId(null);
    setAccountMenuOpen(false);
    setAccountMenuFeedback(t("nav.account.expired"));
    props.onRequireNcmLogin();
  };

  const validateActiveLogin = async (): Promise<boolean> => {
    const current = account();
    if (!current || !current.hasCookie) return true;
    const ok = await accountStore.ensureActiveLoginValid();
    if (!ok) {
      handleExpiredActiveLogin();
    }
    return ok;
  };

  const handleAccountClick = async () => {
    if (account() === null) {
      props.onRequireNcmLogin();
      return;
    }
    if (!(await validateActiveLogin())) return;
    setAccountMenuFeedback(null);
    setAccountMenuOpen((open) => !open);
  };

  const handleNavigateToCollectionTab = (tab: "playlists" | "albums" | "artists") => {
    setAccountMenuOpen(false);
    props.onNavigateToLikedCollectionTab(tab);
  };

  const handleSwitchAccount = async (userId: number) => {
    setAccountMenuFeedback(null);
    try {
      await accountStore.switchActive(userId);
      setAccountStats({});
      setAccountStatsUserId(null);
      setAccountMenuOpen(false);
    } catch (error) {
      setAccountMenuFeedback(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRemoveAccount = async (userId: number) => {
    setAccountMenuFeedback(null);
    try {
      await accountStore.removeAccount(userId);
    } catch (error) {
      setAccountMenuFeedback(error instanceof Error ? error.message : String(error));
    }
  };

  const handleAddAccount = () => {
    if (accountStore.userList().length >= MAX_NCM_ACCOUNTS) {
      setAccountMenuFeedback(t("nav.account.maxAccounts", { count: MAX_NCM_ACCOUNTS }));
      return;
    }
    setAccountMenuOpen(false);
    props.onRequireNcmLogin({ disableUid: true });
  };

  const handleRefreshAccount = async () => {
    setAccountMenuFeedback(null);
    try {
      await accountStore.refreshActive();
      setAccountStats({});
      setAccountStatsUserId(null);
      void loadAccountStats();
    } catch (error) {
      setAccountMenuFeedback(error instanceof Error ? error.message : String(error));
    }
  };

  const handleLogout = async () => {
    const current = account();
    if (!current) {
      props.onRequireNcmLogin();
      return;
    }
    if (typeof window !== "undefined" && !window.confirm(t("nav.account.logoutConfirm"))) {
      return;
    }
    setAccountMenuFeedback(null);
    try {
      await accountStore.logoutActive();
      setAccountStats({});
      setAccountStatsUserId(null);
      setAccountMenuOpen(false);
    } catch (error) {
      setAccountMenuFeedback(error instanceof Error ? error.message : String(error));
    }
  };

  createEffect(() => {
    if (!accountMenuOpen()) return;
    void loadAccountStats();
  });

  createEffect(() => {
    const current = account();
    if (!current || !current.hasCookie) {
      setValidatedAccountUserId(null);
      return;
    }
    if (validatedAccountUserId() === current.userId) return;
    setValidatedAccountUserId(current.userId);
    void validateActiveLogin();
  });

  createEffect(() => {
    const currentId = account()?.userId ?? null;
    if (accountStatsUserId() !== null && accountStatsUserId() !== currentId) {
      setAccountStats({});
      setAccountStatsUserId(null);
    }
    if (currentId === null) {
      setAccountMenuOpen(false);
    }
  });

  createEffect(() => {
    if (!ncmSearchEntryEnabled() || !searchPanelOpen() || trimmedSearchQuery().length > 0) return;
    if (untrack(isSearchEntryLoading) || untrack(() => defaultKeyword() !== null && hotSearches().length > 0)) return;

    let cancelled = false;
    setIsSearchEntryLoading(true);
    void Promise.allSettled([searchDefault(), searchHotDetail()]).then((results) => {
      if (cancelled) return;
      const [defaultResult, hotResult] = results;
      if (defaultResult.status === "fulfilled") {
        setDefaultKeyword(parseNcmSearchDefaultKeyword(defaultResult.value));
      } else {
        console.warn("[TopNav] failed to load NCM default search keyword", defaultResult.reason);
      }
      if (hotResult.status === "fulfilled") {
        setHotSearches(parseNcmSearchHotDetail(hotResult.value));
      } else {
        console.warn("[TopNav] failed to load NCM hot searches", hotResult.reason);
      }
      setIsSearchEntryLoading(false);
    });
    onCleanup(() => {
      cancelled = true;
      setIsSearchEntryLoading(false);
    });
  });

  createEffect(() => {
    const keyword = trimmedSearchQuery();
    if (!ncmSearchEntryEnabled() || !searchPanelOpen() || keyword.length === 0) {
      setSuggestions([]);
      setIsSuggestionLoading(false);
      return;
    }

    let cancelled = false;
    setIsSuggestionLoading(true);
    const timer = window.setTimeout(() => {
      void loadNcmSuggestionItems(keyword)
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
    });
  });

  createEffect(() => {
    if (ncmSearchEntryEnabled()) return;
    setSearchPanelOpen(false);
    setSuggestions([]);
    setIsSuggestionLoading(false);
  });

  createEffect(() => {
    if (!accountMenuOpen()) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && accountMenuRef?.contains(target)) return;
      setAccountMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    });
  });

  return (
    <header class="top-nav" role="banner">
      <div class="top-nav-group top-nav-history" role="group" aria-label={t("nav.aria.back")}>
        <button
          type="button"
          class="top-nav-icon-button"
          data-no-drag
          aria-label={t("nav.aria.back")}
          title={t("nav.aria.back")}
          onClick={props.onGoBack}
          disabled={!props.canGoBack}
        >
          <IconChevronLeft />
        </button>
        <button
          type="button"
          class="top-nav-icon-button"
          data-no-drag
          aria-label={t("nav.aria.forward")}
          title={t("nav.aria.forward")}
          onClick={props.onGoForward}
          disabled={!props.canGoForward}
        >
          <IconChevronRight />
        </button>
      </div>

      <div class="top-nav-main">
        <div class="top-nav-search-wrap">
          <label class={searchClassName()} title={searchTitle()} data-no-drag>
            <IconSearch class="top-nav-search-icon" />
            <input
              type="search"
              value={query()}
              onInput={handleSearchInput}
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
              aria-label={t("nav.aria.search")}
              aria-disabled={!searchEnabled()}
              disabled={!searchEnabled()}
            />
          </label>
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

        <div class="top-nav-drag" data-tauri-drag-region aria-hidden="true" />
      </div>

      <div class="top-nav-group top-nav-actions" data-no-drag>
        <div class="top-nav-account-wrap" ref={accountMenuRef}>
          <button
            type="button"
            class={`top-nav-account${accountMenuOpen() ? " is-open" : ""}`}
            data-no-drag
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen()}
            aria-label={t("nav.account.aria", { name: accountName() })}
            onClick={handleAccountClick}
          >
            <span class="top-nav-account-avatar" aria-hidden="true">
              <Show when={accountAvatar()} fallback={<IconArtist />}>
                {(avatar) => <img src={avatar()} alt="" />}
              </Show>
            </span>
            <span class="top-nav-account-copy">
              <span class="top-nav-account-name">{accountName()}</span>
            </span>
            <Show when={hasVipType(account()?.vipType)}>
              <span class="top-nav-account-vip">VIP</span>
            </Show>
            <span class="top-nav-account-badge">
              <IconChevronDown />
            </span>
          </button>
          <Show when={accountMenuOpen() && account()}>
            {(current) => (
              <div class="top-nav-account-menu" role="menu" data-no-drag>
                <section class="top-nav-account-menu-profile">
                  <span class="top-nav-account-menu-name">{current().nickname ?? t("nav.account.unknown")}</span>
                  <div class="top-nav-account-menu-tags">
                    <span class="top-nav-account-menu-level">Lv.{current().level ?? 0}</span>
                    <Show when={hasVipType(current().vipType)}>
                      <span class="top-nav-account-menu-vip">VIP</span>
                    </Show>
                  </div>
                </section>

                <div class="top-nav-account-menu-divider" />

                <Show
                  when={!isUidMode()}
                  fallback={
                    <section class="top-nav-account-uid-note">
                      <strong>{t("nav.account.uidMode")}</strong>
                      <span>{t("nav.account.uidModeHint")}</span>
                    </section>
                  }
                >
                  <section class="top-nav-account-stats" aria-label={t("nav.account.stats")}>
                    <For each={accountStatItems()}>
                      {(item) => {
                        const Icon = item.icon;
                        return (
                          <button
                            type="button"
                            class="top-nav-account-stat"
                            onClick={() => handleNavigateToCollectionTab(item.key)}
                            disabled={isLoadingAccountStats()}
                          >
                            <Icon />
                            <strong>{item.value}</strong>
                            <span>{item.label}</span>
                          </button>
                        );
                      }}
                    </For>
                  </section>
                </Show>

                <Show when={!isUidMode()}>
                  <div class="top-nav-account-menu-divider" />
                  <section class="top-nav-account-switch">
                    <span class="top-nav-account-section-title">{t("nav.account.switchTitle")}</span>
                    <Show
                      when={accountOtherAccounts().length > 0}
                      fallback={<span class="top-nav-account-empty">{t("nav.account.noOtherAccounts")}</span>}
                    >
                      <For each={accountOtherAccounts()}>
                        {(item) => (
                          <button
                            type="button"
                            class="top-nav-account-switch-item"
                            onClick={() => void handleSwitchAccount(item.userId)}
                            disabled={accountStore.isBusy()}
                          >
                            <span class="top-nav-account-switch-avatar" aria-hidden="true">
                              <Show when={item.avatarUrl} fallback={<IconArtist />}>
                                {(avatar) => <img src={avatar()} alt="" />}
                              </Show>
                            </span>
                            <span class="top-nav-account-switch-name">{item.nickname ?? item.userId}</span>
                            <span
                              role="button"
                              tabindex={0}
                              class="top-nav-account-delete"
                              aria-label={t("nav.account.removeAccount", {
                                name: item.nickname ?? item.userId
                              })}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleRemoveAccount(item.userId);
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ") return;
                                event.preventDefault();
                                event.stopPropagation();
                                void handleRemoveAccount(item.userId);
                              }}
                            >
                              <IconClose />
                            </span>
                          </button>
                        )}
                      </For>
                    </Show>
                    <button
                      type="button"
                      class="top-nav-account-add"
                      onClick={handleAddAccount}
                      disabled={accountStore.isBusy()}
                    >
                      <IconPlus />
                      {t("nav.account.addAccount")}
                    </button>
                  </section>
                </Show>

                <Show when={accountMenuFeedback()}>
                  {(message) => <div class="top-nav-account-feedback">{message()}</div>}
                </Show>

                <div class="top-nav-account-menu-divider" />
                <div class="top-nav-account-actions">
                  <button
                    type="button"
                    class="top-nav-account-action"
                    onClick={() => void handleRefreshAccount()}
                    disabled={accountStore.isBusy() || isUidMode()}
                  >
                    <IconRefresh />
                    {t("nav.account.refresh")}
                  </button>
                  <button
                    type="button"
                    class="top-nav-account-action is-danger"
                    onClick={() => void handleLogout()}
                    disabled={accountStore.isBusy()}
                  >
                    <IconPower />
                    {t("ncm.login.action.logout")}
                  </button>
                </div>
              </div>
            )}
          </Show>
        </div>
        <button
          type="button"
          class="top-nav-icon-button"
          data-no-drag
          aria-label={t("sidebar.nav.settings.label")}
          title={t("sidebar.nav.settings.label")}
          onClick={props.onOpenSettings}
        >
          <IconSettings />
        </button>
        {props.windowControls}
      </div>
    </header>
  );
}

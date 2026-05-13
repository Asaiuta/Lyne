import type { JSX } from "solid-js";
import { For, Show, createMemo, createSignal } from "solid-js";
import { useTranslation } from "../shared/i18n";
import { useNcmAccount } from "../shared/state/NcmAccountContext";
import { useUISearch } from "../shared/state/UISearchContext";
import { isSearchEnabledPage, type ActivePage } from "../shared/ui/navigation";
import {
  IconArtist,
  IconChevronLeft,
  IconChevronRight,
  IconChevronDown,
  IconSearch,
  IconSettings
} from "./icons";

interface TopNavProps {
  activePage: ActivePage;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  onOpenSettings: () => void;
  onRequireNcmLogin: () => void;
  windowControls?: JSX.Element;
}

/**
 * TopNav - search input wired to UISearchContext, settings action, and
 * window-controls slot for frameless mode.
 */
export function TopNav(props: TopNavProps) {
  const { t, td } = useTranslation();
  const accountStore = useNcmAccount();
  const { query, setQuery, activePage: searchPage, submitSearch, history, selectHistoryItem, clearHistory } =
    useUISearch();
  const [historyOpen, setHistoryOpen] = createSignal(false);

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

  const searchClassName = () => `top-nav-search${searchEnabled() ? "" : " is-disabled"}`;
  const searchTitle = () =>
    searchEnabled() ? undefined : t("nav.search.disabledHint", { scope: searchScopeLabel() });
  const showHistory = () => historyOpen() && searchEnabled() && history().length > 0 && query().trim().length === 0;

  const handleSearchInput = (event: InputEvent) => {
    const target = event.currentTarget;
    if (target instanceof HTMLInputElement) {
      setQuery(target.value);
      setHistoryOpen(target.value.trim().length === 0);
    }
  };

  const handleSearchSubmit = () => {
    if (!searchEnabled()) {
      return;
    }
    submitSearch();
    setHistoryOpen(false);
  };
  const handleAccountClick = () => {
    if (account() === null) {
      props.onRequireNcmLogin();
    }
  };

  return (
    <header class="top-nav" role="banner">
      <div class="top-nav-group top-nav-history" role="group" aria-label={t("nav.aria.back")}>
        <button
          type="button"
          class="top-nav-icon-button"
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
          <label class={searchClassName()} title={searchTitle()}>
            <IconSearch class="top-nav-search-icon" />
            <input
              type="search"
              value={query()}
              onInput={handleSearchInput}
              onFocus={() => setHistoryOpen(history().length > 0 && query().trim().length === 0)}
              onBlur={() => window.setTimeout(() => setHistoryOpen(false), 120)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleSearchSubmit();
                }
              }}
              placeholder={td(`nav.search.placeholder.${searchPage()}`)}
              aria-label={t("nav.aria.search")}
              aria-disabled={!searchEnabled()}
              disabled={!searchEnabled()}
            />
          </label>
          <Show when={showHistory()}>
            <div class="top-nav-search-history" role="listbox" aria-label={t("nav.search.history.label")}>
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
              <For each={history()}>
                {(item) => (
                  <button
                    type="button"
                    class="top-nav-search-history-item"
                    role="option"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      selectHistoryItem(item);
                      submitSearch();
                      setHistoryOpen(false);
                    }}
                  >
                    <IconSearch class="top-nav-search-history-icon" />
                    <span>{item}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>

        <div class="top-nav-drag" data-tauri-drag-region aria-hidden="true" />
      </div>

      <div class="top-nav-group top-nav-actions" data-no-drag>
        <button
          type="button"
          class="top-nav-account"
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
          <span class="top-nav-account-badge">
            <IconChevronDown />
          </span>
        </button>
        <button
          type="button"
          class="top-nav-icon-button"
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

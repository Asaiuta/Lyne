import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { IconSearch } from "../../../components/icons";
import type { TranslationKey } from "../../../shared/i18n";
import { useTranslation } from "../../../shared/i18n";
import { NaiveInput } from "../../../shared/ui/naive";
import { useDismissibleOverlay } from "../../../shared/ui/useDismissibleOverlay";
import { usePresenceTransition } from "../../../shared/ui/usePresenceTransition";
import type { SettingsCatalogEntry } from "../search/catalog";
import { SETTINGS_CATEGORIES } from "./SettingsCategoryNav";
import type { SettingsCategoryKey } from "./SettingsCategoryNav";

interface SettingsSearchBoxProps {
  onJump: (category: SettingsCategoryKey, itemId: string) => void;
  onActiveChange?: (active: boolean) => void;
}

const CATEGORY_LABELS: Record<SettingsCategoryKey, TranslationKey> = SETTINGS_CATEGORIES.reduce(
  (acc, cat) => {
    acc[cat.key] = cat.labelKey;
    return acc;
  },
  {} as Record<SettingsCategoryKey, TranslationKey>
);

const settingsSearchClass = "settings-search";

const settingsSearchInputClass = "settings-search-input";

const settingsSearchResultsClass = "settings-search-results";

const settingsSearchResultBaseClass = "settings-search-result";

const settingsSearchResultActiveClass = "is-active";

const settingsSearchResultLabelClass = "settings-search-result-label";

const settingsSearchResultCategoryClass = "settings-search-result-category";

const settingsSearchResultDescriptionClass = "settings-search-result-desc";

const settingsSearchEmptyClass = "settings-search-empty";

const SETTINGS_SEARCH_FADE_DOWN_MS = 100;

let catalogRequest: Promise<readonly SettingsCatalogEntry[]> | null = null;

const loadSettingsCatalog = (): Promise<readonly SettingsCatalogEntry[]> => {
  catalogRequest ??= import("../search/catalog").then((module) => module.SETTINGS_CATALOG);
  return catalogRequest;
};

export function SettingsSearchBox(props: SettingsSearchBoxProps) {
  const { t } = useTranslation();
  const [query, setQuery] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(-1);
  const [renderedMatches, setRenderedMatches] = createSignal<SettingsCatalogEntry[]>([]);
  const [catalogEntries, setCatalogEntries] =
    createSignal<readonly SettingsCatalogEntry[]>([]);
  let containerRef: HTMLDivElement | undefined;

  const ensureCatalogLoaded = (): void => {
    if (catalogEntries().length > 0) return;
    void loadSettingsCatalog()
      .then(setCatalogEntries)
      .catch((error) => {
        catalogRequest = null;
        console.warn("[SettingsSearchBox] failed to load settings catalog", error);
      });
  };

  const indexedEntries = createMemo(() => {
    return catalogEntries().map((entry) => ({
      entry,
      label: t(entry.labelKey).toLowerCase(),
      description: entry.descriptionKey ? t(entry.descriptionKey).toLowerCase() : "",
      keywords: (entry.keywords ?? []).join(" ").toLowerCase(),
      categoryLabel: t(CATEGORY_LABELS[entry.category]).toLowerCase()
    }));
  });

  const matches = createMemo<SettingsCatalogEntry[]>(() => {
    const q = query().trim().toLowerCase();
    if (!q) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    return indexedEntries()
      .filter(({ label, description, keywords, categoryLabel }) => {
        const haystack = `${label} ${description} ${keywords} ${categoryLabel}`;
        return tokens.every((token) => haystack.includes(token));
      })
      .slice(0, 10)
      .map(({ entry }) => entry);
  });

  const resultsVisible = createMemo<boolean>(() => open() && query().trim().length > 0);

  const resultsPresence = usePresenceTransition(resultsVisible, {
    durationMs: SETTINGS_SEARCH_FADE_DOWN_MS
  });

  const visibleMatches = createMemo<SettingsCatalogEntry[]>(() =>
    resultsPresence.closing() ? renderedMatches() : matches()
  );

  const resultsClassName = () =>
    `${settingsSearchResultsClass}${resultsPresence.visible() && !resultsPresence.closing() ? " is-visible" : ""}${resultsPresence.closing() ? " is-closing" : ""}`;

  createEffect(() => {
    props.onActiveChange?.(resultsVisible());
  });

  createEffect(() => {
    if (resultsVisible()) {
      setRenderedMatches(matches());
    }
  });

  useDismissibleOverlay(open, {
    isInside: (target) => !!containerRef && containerRef.contains(target),
    onDismiss: () => setOpen(false)
  });

  const handleSelect = (entry: SettingsCatalogEntry) => {
    props.onJump(entry.category, entry.itemId);
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleQueryChange = (value: string) => {
    ensureCatalogLoaded();
    setQuery(value);
    setOpen(true);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    ensureCatalogLoaded();
    const list = matches();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((idx) => Math.min(list.length - 1, idx + 1));
      setOpen(true);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((idx) => Math.max(0, idx - 1));
    } else if (event.key === "Enter") {
      const idx = activeIndex();
      const target = idx >= 0 ? list[idx] : list[0];
      if (target) {
        event.preventDefault();
        handleSelect(target);
      }
    }
  };

  return (
    <div class={settingsSearchClass} ref={containerRef}>
      <NaiveInput
        type="text"
        value={query()}
        class={settingsSearchInputClass}
        placeholder={t("settings.search.placeholder")}
        clearable
        onUpdateValue={handleQueryChange}
        onFocus={() => {
          ensureCatalogLoaded();
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        ariaLabel={t("settings.search.placeholder")}
        ariaExpanded={resultsVisible()}
        ariaControls="settings-search-results"
        prefix={<IconSearch />}
      />
      <Show when={resultsPresence.rendered()}>
        <div
          class={resultsClassName()}
          id="settings-search-results"
          role="listbox"
        >
          <Show
            when={visibleMatches().length > 0}
            fallback={<div class={settingsSearchEmptyClass}>{t("settings.search.noResults")}</div>}
          >
            <For each={visibleMatches()}>
              {(entry, index) => {
                const active = () => index() === activeIndex();
                const className = () =>
                  active()
                    ? `${settingsSearchResultBaseClass} ${settingsSearchResultActiveClass}`
                    : settingsSearchResultBaseClass;

                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={active()}
                    class={className()}
                    onMouseEnter={() => setActiveIndex(index())}
                    onClick={() => handleSelect(entry)}
                  >
                    <span class={settingsSearchResultCategoryClass}>
                      {t(CATEGORY_LABELS[entry.category])}
                    </span>
                    <span class={settingsSearchResultLabelClass}>{t(entry.labelKey)}</span>
                    <Show when={entry.descriptionKey}>
                      {(descriptionKey) => (
                        <span class={settingsSearchResultDescriptionClass}>
                          {t(descriptionKey())}
                        </span>
                      )}
                    </Show>
                  </button>
                );
              }}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
}

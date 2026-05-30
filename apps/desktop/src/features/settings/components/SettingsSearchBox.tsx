import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { IconSearch } from "../../../components/icons";
import type { TranslationKey } from "../../../shared/i18n";
import { useTranslation } from "../../../shared/i18n";
import { NaiveInput } from "../../../shared/ui/naive";
import { useDismissibleOverlay } from "../../../shared/ui/useDismissibleOverlay";
import { SETTINGS_CATALOG, type SettingsCatalogEntry } from "../search/catalog";
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

export function SettingsSearchBox(props: SettingsSearchBoxProps) {
  const { t } = useTranslation();
  const [query, setQuery] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(-1);
  let containerRef: HTMLDivElement | undefined;

  const indexedEntries = createMemo(() => {
    return SETTINGS_CATALOG.map((entry) => ({
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

  const resultsStyle = () => (resultsVisible() ? undefined : { display: "none" });

  createEffect(() => {
    props.onActiveChange?.(resultsVisible());
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
    setQuery(value);
    setOpen(true);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
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
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        ariaLabel={t("settings.search.placeholder")}
        ariaExpanded={resultsVisible()}
        ariaControls="settings-search-results"
        prefix={<IconSearch />}
      />
      <div
        class={settingsSearchResultsClass}
        id="settings-search-results"
        role="listbox"
        style={resultsStyle()}
      >
        <Show
          when={matches().length > 0}
          fallback={<div class={settingsSearchEmptyClass}>{t("settings.search.noResults")}</div>}
        >
          <For each={matches()}>
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
    </div>
  );
}

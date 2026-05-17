import { For, createSignal } from "solid-js";
import { useTranslation } from "../../shared/i18n";
import {
  readUISettingsSnapshot,
  STORAGE_KEYS,
  type HomeSectionConfig,
  type HomeSectionKey
} from "../../shared/state/useUISettings";
import { persist as persistSetting } from "./storage";

const SECTION_LABELS: Record<HomeSectionKey, string> = {
  dailyPicks: "ncm.home.section.dailyPicks",
  playlists: "ncm.home.section.recommendedPlaylists",
  radar: "ncm.home.section.radar",
  artists: "ncm.home.section.topArtists",
  mvs: "ncm.home.section.recommendedMv",
  podcasts: "ncm.home.section.podcasts",
  albums: "ncm.home.section.newAlbums"
};

const managerClass = "home-section-manager flex flex-col gap-[2px]";

const rowClass =
  "home-section-row flex items-center justify-between rounded-sm px-[10px] py-[6px] transition-background duration-150 ease-standard hover:bg-[var(--border-overlay)]";

const toggleClass = "home-section-toggle flex cursor-pointer items-center gap-[8px] text-[13px]";

const checkboxClass = "accent-accent";

const arrowsClass = "home-section-arrows flex gap-[4px]";

const arrowButtonClass =
  "icon-btn inline-flex h-[28px] w-[28px] items-center justify-center rounded-sm border-0 bg-transparent text-text text-[14px] transition-background duration-150 ease-standard hover:bg-[var(--surface-pressed)] disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent";

function readSections(): HomeSectionConfig[] {
  return readUISettingsSnapshot().homeSections;
}

const persistSections = (sections: HomeSectionConfig[]): boolean =>
  persistSetting(STORAGE_KEYS.homeSections, JSON.stringify(sections));

export function HomeSectionManager() {
  const { t } = useTranslation();
  const [sections, setSections] = createSignal(readSections());

  const sorted = () => [...sections()].sort((a, b) => a.order - b.order);

  const toggleVisibility = (key: HomeSectionKey) => {
    const next = sections().map((s) =>
      s.key === key ? { ...s, visible: !s.visible } : s
    );
    setSections(next);
    persistSections(next);
  };

  const moveUp = (key: HomeSectionKey) => {
    const sortedList = sorted();
    const idx = sortedList.findIndex((s) => s.key === key);
    if (idx <= 0) return;
    const prev = sortedList[idx - 1];
    const curr = sortedList[idx];
    const next = sections().map((s) => {
      if (s.key === curr.key) return { ...s, order: prev.order };
      if (s.key === prev.key) return { ...s, order: curr.order };
      return s;
    });
    setSections(next);
    persistSections(next);
  };

  const moveDown = (key: HomeSectionKey) => {
    const sortedList = sorted();
    const idx = sortedList.findIndex((s) => s.key === key);
    if (idx < 0 || idx >= sortedList.length - 1) return;
    const curr = sortedList[idx];
    const next_item = sortedList[idx + 1];
    const next = sections().map((s) => {
      if (s.key === curr.key) return { ...s, order: next_item.order };
      if (s.key === next_item.key) return { ...s, order: curr.order };
      return s;
    });
    setSections(next);
    persistSections(next);
  };

  return (
    <div class={managerClass}>
      <For each={sorted()}>
        {(section, index) => (
          <div class={rowClass}>
            <label class={toggleClass}>
              <input
                class={checkboxClass}
                type="checkbox"
                checked={section.visible}
                onChange={() => toggleVisibility(section.key)}
              />
              <span>{t(SECTION_LABELS[section.key] as Parameters<typeof t>[0])}</span>
            </label>
            <div class={arrowsClass}>
              <button
                type="button"
                class={arrowButtonClass}
                disabled={index() === 0}
                onClick={() => moveUp(section.key)}
                aria-label="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                class={arrowButtonClass}
                disabled={index() === sorted().length - 1}
                onClick={() => moveDown(section.key)}
                aria-label="Move down"
              >
                ↓
              </button>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

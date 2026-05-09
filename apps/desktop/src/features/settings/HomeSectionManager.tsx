import { For, createSignal } from "solid-js";
import { useTranslation } from "../../shared/i18n";
import {
  DEFAULT_HOME_SECTIONS,
  STORAGE_KEYS,
  type HomeSectionConfig,
  type HomeSectionKey
} from "../../shared/state/useUISettings";

const SECTION_LABELS: Record<HomeSectionKey, string> = {
  dailyPicks: "ncm.home.section.dailyPicks",
  playlists: "ncm.home.section.recommendedPlaylists",
  radar: "ncm.home.section.radar",
  artists: "ncm.home.section.topArtists",
  mvs: "ncm.home.section.recommendedMv",
  podcasts: "ncm.home.section.podcasts",
  albums: "ncm.home.section.newAlbums"
};

function readSections(): HomeSectionConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.homeSections);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const validKeys = new Set(DEFAULT_HOME_SECTIONS.map((s) => s.key));
        const sections = parsed.filter(
          (s): s is HomeSectionConfig =>
            typeof s === "object" &&
            s !== null &&
            typeof s.key === "string" &&
            validKeys.has(s.key as HomeSectionKey) &&
            typeof s.order === "number" &&
            typeof s.visible === "boolean"
        );
        if (sections.length > 0) return sections;
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_HOME_SECTIONS;
}

function persist(sections: HomeSectionConfig[]) {
  try {
    localStorage.setItem(STORAGE_KEYS.homeSections, JSON.stringify(sections));
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event("ui-settings-changed"));
}

export function HomeSectionManager() {
  const { t } = useTranslation();
  const [sections, setSections] = createSignal(readSections());

  const sorted = () => [...sections()].sort((a, b) => a.order - b.order);

  const toggleVisibility = (key: HomeSectionKey) => {
    const next = sections().map((s) =>
      s.key === key ? { ...s, visible: !s.visible } : s
    );
    setSections(next);
    persist(next);
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
    persist(next);
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
    persist(next);
  };

  return (
    <div class="home-section-manager">
      <For each={sorted()}>
        {(section, index) => (
          <div class="home-section-row">
            <label class="home-section-toggle">
              <input
                type="checkbox"
                checked={section.visible}
                onChange={() => toggleVisibility(section.key)}
              />
              <span>{t(SECTION_LABELS[section.key] as Parameters<typeof t>[0])}</span>
            </label>
            <div class="home-section-arrows">
              <button
                type="button"
                class="icon-btn"
                disabled={index() === 0}
                onClick={() => moveUp(section.key)}
                aria-label="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                class="icon-btn"
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

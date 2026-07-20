import { For, createMemo, createSignal } from "solid-js";
import { useTranslation } from "../../shared/i18n";
import type { HomeSectionConfig, HomeSectionKey } from "../../shared/state/uiSettingsModel";
import { commitUISettingField, readUISettingsSnapshot } from "../../shared/state/uiSettingsStorage";
import { NaiveSwitch } from "../../shared/ui/naive";

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
  "home-section-row flex items-center gap-[10px] rounded-sm px-[10px] py-[6px] transition-background duration-150 ease-standard hover:bg-[var(--border-overlay)]";

const rowDraggingClass = "is-dragging opacity-50";

const rowDropOverClass = "is-drop-over outline outline-1 outline-accent";

const handleClass =
  "home-section-handle inline-flex h-[24px] w-[24px] cursor-grab items-center justify-center text-text-secondary text-[16px] leading-none select-none active:cursor-grabbing";

const toggleClass = "home-section-toggle flex flex-1 items-center gap-[8px] text-[13px]";

function readSections(): HomeSectionConfig[] {
  return readUISettingsSnapshot().homeSections;
}

export function HomeSectionManager() {
  const { t } = useTranslation();
  const [sections, setSections] = createSignal(readSections());
  const [draggingKey, setDraggingKey] = createSignal<HomeSectionKey | null>(null);
  const [dropTargetKey, setDropTargetKey] = createSignal<HomeSectionKey | null>(null);

  const commitSections = (next: HomeSectionConfig[]) =>
    commitUISettingField("homeSections", next, sections, setSections);

  const sorted = createMemo(() => [...sections()].sort((a, b) => a.order - b.order));

  const setVisibility = (key: HomeSectionKey, visible: boolean) => {
    const next = sections().map((s) =>
      s.key === key ? { ...s, visible } : s
    );
    commitSections(next);
  };

  const reorder = (fromKey: HomeSectionKey, toKey: HomeSectionKey) => {
    if (fromKey === toKey) return;
    const list = sorted();
    const fromIdx = list.findIndex((s) => s.key === fromKey);
    const toIdx = list.findIndex((s) => s.key === toKey);
    if (fromIdx < 0 || toIdx < 0) return;
    const reordered = [...list];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const next = reordered.map((section, index) => ({ ...section, order: index }));
    commitSections(next);
  };

  const handleDragStart = (event: DragEvent, key: HomeSectionKey) => {
    setDraggingKey(key);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", key);
    }
  };

  const handleDragOver = (event: DragEvent, key: HomeSectionKey) => {
    if (draggingKey() === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    if (dropTargetKey() !== key) setDropTargetKey(key);
  };

  const handleDragLeave = (key: HomeSectionKey) => {
    if (dropTargetKey() === key) setDropTargetKey(null);
  };

  const handleDrop = (event: DragEvent, key: HomeSectionKey) => {
    event.preventDefault();
    const source = draggingKey();
    if (source !== null) reorder(source, key);
    setDraggingKey(null);
    setDropTargetKey(null);
  };

  const handleDragEnd = () => {
    setDraggingKey(null);
    setDropTargetKey(null);
  };

  const rowClassNameFor = (key: HomeSectionKey) => {
    const parts = [rowClass];
    if (draggingKey() === key) parts.push(rowDraggingClass);
    if (dropTargetKey() === key && draggingKey() !== key) parts.push(rowDropOverClass);
    return parts.join(" ");
  };

  return (
    <div class={managerClass}>
      <For each={sorted()}>
        {(section) => (
          <div
            class={rowClassNameFor(section.key)}
            draggable={true}
            onDragStart={(event) => handleDragStart(event, section.key)}
            onDragOver={(event) => handleDragOver(event, section.key)}
            onDragLeave={() => handleDragLeave(section.key)}
            onDrop={(event) => handleDrop(event, section.key)}
            onDragEnd={handleDragEnd}
          >
            <span class={handleClass} aria-hidden="true">⋮⋮</span>
            <div class={toggleClass}>
              <NaiveSwitch
                checked={section.visible}
                round={false}
                onChange={(checked) => setVisibility(section.key, checked)}
                ariaLabel={t(SECTION_LABELS[section.key] as Parameters<typeof t>[0])}
              />
              <span>{t(SECTION_LABELS[section.key] as Parameters<typeof t>[0])}</span>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

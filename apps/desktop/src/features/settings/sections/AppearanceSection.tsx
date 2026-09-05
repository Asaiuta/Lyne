import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { settingsSectionClass } from "../components/SettingItem";
import { AppearanceMainPanel } from "./AppearanceMainPanel";
import { AppearanceManagerContent } from "./AppearanceManagerContent";
import { AppearanceManagerModal } from "./AppearanceManagerModal";
import {
  CONTEXT_MENU_ITEMS,
  COVER_DISPLAY_ITEMS,
  COVER_MANAGER_ITEM,
  LAYOUT_MANAGER_ITEMS,
  PLAYLIST_PAGE_ITEMS,
  SIDEBAR_VISIBILITY_ITEMS,
  THEME_MANAGER_ITEMS,
  type AppearanceSubPanel as AppearanceSubPanelId,
  type ManagerConfig
} from "./appearanceConfig";
import { useAppearanceSettings } from "./useAppearanceSettings";

interface AppearanceSectionProps {
  highlightId: string | null;
}

const ALL_MANAGER_ITEMS: readonly ManagerConfig[] = [
  ...THEME_MANAGER_ITEMS,
  ...LAYOUT_MANAGER_ITEMS,
  COVER_MANAGER_ITEM
];

const findHighlightedElementInAppearanceModal = (highlightedId: string): HTMLElement | null => {
  const modal = document.querySelector<HTMLElement>(".appearance-manager-card");
  if (!modal) return null;

  const dataMatch = Array.from(modal.querySelectorAll<HTMLElement>("[data-setting-id]")).find(
    (el) => el.dataset.settingId === highlightedId
  );
  if (dataMatch) return dataMatch;

  return (
    Array.from(modal.querySelectorAll<HTMLElement>("[id]")).find(
      (el) => el.id === `setting-${highlightedId}`
    ) ?? null
  );
};

export function AppearanceSection(props: AppearanceSectionProps) {
  const [activeSubPanel, setActiveSubPanel] = createSignal<AppearanceSubPanelId | null>(null);
  const settings = useAppearanceSettings();

  const activeManager = createMemo<ManagerConfig | null>(() => {
    const panel = activeSubPanel();
    if (panel === null) return null;
    return ALL_MANAGER_ITEMS.find((item) => item.panel === panel) ?? null;
  });

  const managerHighlighted = (item: ManagerConfig) => {
    const highlightedId = props.highlightId;
    if (highlightedId === null) return false;
    if (highlightedId === item.itemId || highlightedId === `${item.itemId}.all`) return true;

    switch (item.panel) {
      case "sidebar":
        return SIDEBAR_VISIBILITY_ITEMS.some((entry) => entry.itemId === highlightedId);
      case "homeSections":
        return highlightedId === "homeSections";
      case "playlistPage":
        return PLAYLIST_PAGE_ITEMS.some((entry) => entry.itemId === highlightedId);
      case "fullPlayerElements":
        return highlightedId.startsWith("fullPlayerShow");
      case "contextMenu":
        return CONTEXT_MENU_ITEMS.some((entry) => entry.itemId === highlightedId);
      case "cover":
        return (
          highlightedId === "hiddenCovers.all" ||
          COVER_DISPLAY_ITEMS.some((entry) => entry.itemId === highlightedId)
        );
      case "themeConfig":
        return (
          highlightedId === "themeConfig" ||
          highlightedId === "themeFollowCover" ||
          highlightedId === "customAccentColor"
        );
      case "fontConfig":
        return (
          highlightedId === "fontConfig" ||
          highlightedId === "globalFont" ||
          highlightedId === "customFontFamily"
        );
      case "customCode":
        return (
          highlightedId === "customCode" ||
          highlightedId === "customCss" ||
          highlightedId === "customJs"
        );
      default: {
        const _exhaustive: never = item.panel;
        return _exhaustive;
      }
    }
  };

  createEffect(() => {
    const highlightedId = props.highlightId;
    if (highlightedId === null) return;
    const manager = ALL_MANAGER_ITEMS.find(managerHighlighted);
    if (manager) {
      setActiveSubPanel(manager.panel);
    }
  });

  createEffect(() => {
    const highlightedId = props.highlightId;
    if (highlightedId === null || activeManager() === null) return;
    if (typeof document === "undefined" || typeof window === "undefined") return;

    let frame: number | undefined;
    const timer = window.setTimeout(() => {
      frame = window.requestAnimationFrame(() => {
        const target = findHighlightedElementInAppearanceModal(highlightedId);
        target?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }, 0);

    onCleanup(() => {
      window.clearTimeout(timer);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    });
  });

  let mainItemIndex = 0;
  const nextMainIndex = () => mainItemIndex++;
  const closeManager = () => setActiveSubPanel(null);

  return (
    <section class={settingsSectionClass}>
      <AppearanceMainPanel
        settings={settings}
        highlightId={props.highlightId}
        nextIndex={nextMainIndex}
        managerHighlighted={managerHighlighted}
        onOpenSubPanel={setActiveSubPanel}
      />

      <AppearanceManagerModal
        open={activeManager() !== null}
        manager={activeManager()}
        onClose={closeManager}
      >
        <Show when={activeManager()} keyed>
          {(manager) => (
            <AppearanceManagerContent
              manager={manager}
              settings={settings}
              highlightId={props.highlightId}
              onClose={closeManager}
            />
          )}
        </Show>
      </AppearanceManagerModal>
    </section>
  );
}

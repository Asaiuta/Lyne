import { Match, Show, Switch, createEffect, createMemo, createSignal } from "solid-js";
import { settingsSectionClass } from "../components/SettingItem";
import {
  CustomCodePanel,
  FontConfigPanel,
  ThemeConfigPanel
} from "./AppearanceAdvancedPanels";
import { AppearanceMainPanel } from "./AppearanceMainPanel";
import { AppearanceSubPanel } from "./AppearanceSubPanel";
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

const isGenericSubPanel = (panel: AppearanceSubPanelId) =>
  panel === "sidebar" ||
  panel === "homeSections" ||
  panel === "playlistPage" ||
  panel === "fullPlayerElements" ||
  panel === "contextMenu" ||
  panel === "cover";

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
          highlightedId === "themeGlobalColor" ||
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

  let itemIndex = 0;
  const nextIndex = () => itemIndex++;

  return (
    <section class={settingsSectionClass}>
      <Show when={activeManager()} keyed>
        {(manager) => (
          <Switch>
            <Match when={manager.panel === "themeConfig"}>
              <ThemeConfigPanel
                manager={manager}
                settings={settings}
                highlightId={props.highlightId}
                nextIndex={nextIndex}
                onBack={() => setActiveSubPanel(null)}
              />
            </Match>
            <Match when={manager.panel === "fontConfig"}>
              <FontConfigPanel
                manager={manager}
                settings={settings}
                highlightId={props.highlightId}
                nextIndex={nextIndex}
                onBack={() => setActiveSubPanel(null)}
              />
            </Match>
            <Match when={manager.panel === "customCode"}>
              <CustomCodePanel
                manager={manager}
                settings={settings}
                highlightId={props.highlightId}
                nextIndex={nextIndex}
                onBack={() => setActiveSubPanel(null)}
              />
            </Match>
            <Match when={isGenericSubPanel(manager.panel)}>
              <AppearanceSubPanel
                manager={manager}
                settings={settings}
                highlightId={props.highlightId}
                nextIndex={nextIndex}
                onBack={() => setActiveSubPanel(null)}
              />
            </Match>
          </Switch>
        )}
      </Show>

      <Show when={!activeManager()}>
        <AppearanceMainPanel
          settings={settings}
          highlightId={props.highlightId}
          nextIndex={nextIndex}
          managerHighlighted={managerHighlighted}
          onOpenSubPanel={setActiveSubPanel}
        />
      </Show>
    </section>
  );
}

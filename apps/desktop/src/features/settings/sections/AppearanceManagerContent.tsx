import { Match, Switch } from "solid-js";
import {
  CustomCodePanel,
  FontConfigPanel,
  ThemeConfigPanel
} from "./AppearanceAdvancedPanels";
import { AppearanceSubPanel } from "./AppearanceSubPanel";
import type {
  AppearanceSubPanel as AppearanceSubPanelId,
  ManagerConfig
} from "./appearanceConfig";
import type { AppearanceSettings } from "./useAppearanceSettings";

interface AppearanceManagerContentProps {
  manager: ManagerConfig;
  settings: AppearanceSettings;
  highlightId: string | null;
  onClose: () => void;
}

const isGenericSubPanel = (panel: AppearanceSubPanelId) =>
  panel === "sidebar" ||
  panel === "homeSections" ||
  panel === "playlistPage" ||
  panel === "fullPlayerElements" ||
  panel === "contextMenu" ||
  panel === "cover";

export function AppearanceManagerContent(props: AppearanceManagerContentProps) {
  let itemIndex = 0;
  const nextIndex = () => itemIndex++;

  return (
    <Switch>
      <Match when={props.manager.panel === "themeConfig"}>
        <ThemeConfigPanel
          manager={props.manager}
          settings={props.settings}
          highlightId={props.highlightId}
          nextIndex={nextIndex}
          onBack={props.onClose}
          showHeader={false}
        />
      </Match>
      <Match when={props.manager.panel === "fontConfig"}>
        <FontConfigPanel
          manager={props.manager}
          settings={props.settings}
          highlightId={props.highlightId}
          nextIndex={nextIndex}
          onBack={props.onClose}
          showHeader={false}
        />
      </Match>
      <Match when={props.manager.panel === "customCode"}>
        <CustomCodePanel
          manager={props.manager}
          settings={props.settings}
          highlightId={props.highlightId}
          nextIndex={nextIndex}
          onBack={props.onClose}
          showHeader={false}
        />
      </Match>
      <Match when={isGenericSubPanel(props.manager.panel)}>
        <AppearanceSubPanel
          manager={props.manager}
          settings={props.settings}
          highlightId={props.highlightId}
          nextIndex={nextIndex}
          onBack={props.onClose}
          showHeader={false}
        />
      </Match>
    </Switch>
  );
}

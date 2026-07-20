import { createMemo, type JSX } from "solid-js";
import {
  IconCloud,
  IconControls,
  IconFolder,
  IconLogo,
  IconMusic,
  IconSettings,
  IconTextPlay,
  IconTune
} from "../../../components/icons";
import type { TranslationKey } from "../../../shared/i18n";
import { useTranslation } from "../../../shared/i18n";
import { NaiveMenu, type NaiveMenuItem } from "../../../shared/ui/naive";

export type SettingsCategoryKey =
  | "general"
  | "appearance"
  | "playback"
  | "lyrics"
  | "local"
  | "keyboard"
  | "network"
  | "audio-engine"
  | "plugins"
  | "about";

interface CategoryDef {
  key: SettingsCategoryKey;
  labelKey: TranslationKey;
  icon: () => JSX.Element;
}

const CATEGORIES: ReadonlyArray<CategoryDef> = [
  { key: "general", labelKey: "settings.nav.general", icon: () => <IconSettings /> },
  { key: "appearance", labelKey: "settings.nav.appearance", icon: () => <IconLogo /> },
  { key: "playback", labelKey: "settings.nav.playback", icon: () => <IconMusic /> },
  { key: "lyrics", labelKey: "settings.nav.lyrics", icon: () => <IconTextPlay /> },
  { key: "local", labelKey: "settings.nav.local", icon: () => <IconFolder /> },
  { key: "keyboard", labelKey: "settings.nav.keyboard", icon: () => <IconControls /> },
  { key: "network", labelKey: "settings.nav.network", icon: () => <IconCloud /> },
  { key: "audio-engine", labelKey: "settings.nav.audioEngine", icon: () => <IconControls /> },
  { key: "plugins", labelKey: "settings.nav.plugins", icon: () => <IconTune /> },
  { key: "about", labelKey: "settings.nav.about", icon: () => <IconLogo /> }
];

const settingsNavClass = "settings-nav n-menu";

const settingsNavListClass = "settings-nav-list";

const settingsNavItemBaseClass = "settings-nav-item";

const settingsNavItemActiveClass = "is-active";

const settingsNavItemIconClass = "settings-nav-item-icon";

const settingsNavItemLabelClass = "settings-nav-item-label";

interface SettingsCategoryNavProps {
  active: SettingsCategoryKey;
  onSelect: (key: SettingsCategoryKey) => void;
}

export function SettingsCategoryNav(props: SettingsCategoryNavProps) {
  const { t } = useTranslation();
  const items = createMemo<ReadonlyArray<NaiveMenuItem<SettingsCategoryKey>>>(() =>
    CATEGORIES.map((category) => ({
      key: category.key,
      label: t(category.labelKey),
      textValue: t(category.labelKey),
      icon: category.icon()
    }))
  );

  return (
    <nav aria-label={t("settings.nav.title")}>
      <NaiveMenu
        value={props.active}
        items={items()}
        onSelect={props.onSelect}
        orientation="vertical"
        ariaLabel={t("settings.nav.title")}
        class={`${settingsNavClass} ${settingsNavListClass}`}
        itemClass={settingsNavItemBaseClass}
        itemActiveClass={settingsNavItemActiveClass}
        itemIconClass={settingsNavItemIconClass}
        itemLabelClass={settingsNavItemLabelClass}
      />
    </nav>
  );
}

export const SETTINGS_CATEGORIES = CATEGORIES;

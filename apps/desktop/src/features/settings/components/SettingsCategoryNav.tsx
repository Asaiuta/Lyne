import { For, type JSX } from "solid-js";
import {
  IconCloud,
  IconControls,
  IconFolder,
  IconLogo,
  IconMusic,
  IconSettings,
  IconTextPlay
} from "../../../components/icons";
import type { TranslationKey } from "../../../shared/i18n";
import { useTranslation } from "../../../shared/i18n";

export type SettingsCategoryKey =
  | "general"
  | "appearance"
  | "playback"
  | "lyrics"
  | "local"
  | "keyboard"
  | "network"
  | "audio-engine"
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
  { key: "about", labelKey: "settings.nav.about", icon: () => <IconLogo /> }
];

const settingsNavClass = "settings-nav n-menu";

const settingsNavListClass = "settings-nav-list";

const settingsNavItemWrapperClass = "n-menu-item";

const settingsNavItemBaseClass = "settings-nav-item n-menu-item-content";

const settingsNavItemActiveClass = "is-active n-menu-item-content--selected";

const settingsNavItemIconClass = "settings-nav-item-icon n-menu-item-content__icon";

const settingsNavItemLabelClass = "settings-nav-item-label n-menu-item-content-header";

interface SettingsCategoryNavProps {
  active: SettingsCategoryKey;
  onSelect: (key: SettingsCategoryKey) => void;
}

export function SettingsCategoryNav(props: SettingsCategoryNavProps) {
  const { t } = useTranslation();

  return (
    <nav class={settingsNavClass} aria-label={t("settings.nav.title")}>
      <ul class={settingsNavListClass} role="tablist" aria-orientation="vertical">
        <For each={CATEGORIES}>
          {(cat) => {
            const active = () => props.active === cat.key;
            const className = () =>
              active()
                ? `${settingsNavItemBaseClass} ${settingsNavItemActiveClass}`
                : settingsNavItemBaseClass;

            return (
              <li class={settingsNavItemWrapperClass}>
                <button
                  type="button"
                  role="tab"
                  class={className()}
                  data-setting-category={cat.key}
                  aria-selected={active()}
                  onClick={() => props.onSelect(cat.key)}
                >
                  <span class={settingsNavItemIconClass} aria-hidden="true">
                    {cat.icon()}
                  </span>
                  <span class={settingsNavItemLabelClass}>{t(cat.labelKey)}</span>
                </button>
              </li>
            );
          }}
        </For>
      </ul>
    </nav>
  );
}

export const SETTINGS_CATEGORIES = CATEGORIES;

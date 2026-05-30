import { For, Show, createMemo } from "solid-js";
import type { Setter } from "solid-js";
import { useTranslation, type TranslationKey } from "../../../shared/i18n";
import type {
  FullPlayerCommentMode,
  PlayerBackgroundType,
  PlayerExpandAnimation,
  PlayerTimeFormat,
  PlayerType,
  RouteAnimation,
  ThemeMode,
  UISettingsBooleanFieldName
} from "../../../shared/state/useUISettings";
import {
  BooleanSettingItem,
  ButtonSettingItem,
  RangeSettingItem,
  SelectSettingItem,
  type SelectOption
} from "../components/SettingControls";
import { settingsHintClass } from "../components/SettingItem";
import { SettingGroup } from "../components/SettingGroup";
import {
  COVER_MANAGER_ITEM,
  LAYOUT_MANAGER_ITEMS,
  ROUTE_ANIMATIONS,
  THEME_MANAGER_ITEMS,
  type ManagerConfig
} from "./appearanceConfig";
import type { AppearanceSettings } from "./useAppearanceSettings";

interface AppearanceMainPanelProps {
  settings: AppearanceSettings;
  highlightId: string | null;
  nextIndex: () => number;
  managerHighlighted: (item: ManagerConfig) => boolean;
  onOpenSubPanel: (panel: ManagerConfig["panel"]) => void;
}

interface BooleanItemConfig {
  id: string;
  labelKey: TranslationKey;
  descriptionKey?: TranslationKey;
  field: UISettingsBooleanFieldName;
  value: (settings: AppearanceSettings) => () => boolean;
  setValue: (settings: AppearanceSettings) => Setter<boolean>;
}

interface DirectBooleanItemConfig {
  id: string;
  labelKey: TranslationKey;
  descriptionKey?: TranslationKey;
  checked: () => boolean;
  onChange: (checked: boolean) => void;
}

const LAYOUT_BOOLEAN_ITEMS: readonly BooleanItemConfig[] = [
  {
    id: "menuShowCover",
    labelKey: "settings.appearance.menuShowCover",
    descriptionKey: "settings.appearance.menuShowCover.desc",
    field: "menuShowCover",
    value: (settings) => settings.menuShowCover,
    setValue: (settings) => settings.setMenuShowCover
  },
  {
    id: "showPlaylistCount",
    labelKey: "settings.appearance.showPlaylistCount",
    descriptionKey: "settings.appearance.showPlaylistCount.desc",
    field: "showPlaylistCount",
    value: (settings) => settings.showPlaylistCount,
    setValue: (settings) => settings.setShowPlaylistCount
  }
];

const PLAYER_ELEMENT_ITEMS: readonly BooleanItemConfig[] = [
  {
    id: "autoHidePlayerMeta",
    labelKey: "settings.appearance.autoHidePlayerMeta",
    descriptionKey: "settings.appearance.autoHidePlayerMeta.desc",
    field: "autoHidePlayerMeta",
    value: (settings) => settings.autoHidePlayerMeta,
    setValue: (settings) => settings.setAutoHidePlayerMeta
  },
  {
    id: "showPlayMeta",
    labelKey: "settings.appearance.showPlayMeta",
    descriptionKey: "settings.appearance.showPlayMeta.desc",
    field: "showPlayMeta",
    value: (settings) => settings.showPlayMeta,
    setValue: (settings) => settings.setShowPlayMeta
  },
  {
    id: "countDownShow",
    labelKey: "settings.appearance.countDownShow",
    descriptionKey: "settings.appearance.countDownShow.desc",
    field: "countDownShow",
    value: (settings) => settings.countDownShow,
    setValue: (settings) => settings.setCountDownShow
  },
  {
    id: "barLyricShow",
    labelKey: "settings.appearance.barLyricShow",
    descriptionKey: "settings.appearance.barLyricShow.desc",
    field: "barLyricShow",
    value: (settings) => settings.barLyricShow,
    setValue: (settings) => settings.setBarLyricShow
  },
  {
    id: "showPlayerQuality",
    labelKey: "settings.appearance.showPlayerQuality",
    descriptionKey: "settings.appearance.showPlayerQuality.desc",
    field: "showPlayerQuality",
    value: (settings) => settings.showPlayerQuality,
    setValue: (settings) => settings.setShowPlayerQuality
  }
];

const SONG_LIST_ELEMENT_ITEMS: readonly BooleanItemConfig[] = [
  {
    id: "showSongAlbum",
    labelKey: "settings.appearance.showSongAlbum",
    descriptionKey: "settings.appearance.showSongAlbum.desc",
    field: "showSongAlbum",
    value: (settings) => settings.showSongAlbum,
    setValue: (settings) => settings.setShowSongAlbum
  },
  {
    id: "showSongArtist",
    labelKey: "settings.appearance.showSongArtist",
    descriptionKey: "settings.appearance.showSongArtist.desc",
    field: "showSongArtist",
    value: (settings) => settings.showSongArtist,
    setValue: (settings) => settings.setShowSongArtist
  },
  {
    id: "showSongDuration",
    labelKey: "settings.appearance.showSongDuration",
    descriptionKey: "settings.appearance.showSongDuration.desc",
    field: "showSongDuration",
    value: (settings) => settings.showSongDuration,
    setValue: (settings) => settings.setShowSongDuration
  },
  {
    id: "showSongOperations",
    labelKey: "settings.appearance.showSongOperations",
    descriptionKey: "settings.appearance.showSongOperations.desc",
    field: "showSongOperations",
    value: (settings) => settings.showSongOperations,
    setValue: (settings) => settings.setShowSongOperations
  },
  {
    id: "showSongQuality",
    labelKey: "settings.appearance.showSongQuality",
    descriptionKey: "settings.appearance.showSongQuality.desc",
    field: "showSongQuality",
    value: (settings) => settings.showSongQuality,
    setValue: (settings) => settings.setShowSongQuality
  },
  {
    id: "showSongPrivilegeTag",
    labelKey: "settings.appearance.showSongPrivilegeTag",
    descriptionKey: "settings.appearance.showSongPrivilegeTag.desc",
    field: "showSongPrivilegeTag",
    value: (settings) => settings.showSongPrivilegeTag,
    setValue: (settings) => settings.setShowSongPrivilegeTag
  },
  {
    id: "showSongExplicitTag",
    labelKey: "settings.appearance.showSongExplicitTag",
    descriptionKey: "settings.appearance.showSongExplicitTag.desc",
    field: "showSongExplicitTag",
    value: (settings) => settings.showSongExplicitTag,
    setValue: (settings) => settings.setShowSongExplicitTag
  },
  {
    id: "showSongOriginalTag",
    labelKey: "settings.appearance.showSongOriginalTag",
    descriptionKey: "settings.appearance.showSongOriginalTag.desc",
    field: "showSongOriginalTag",
    value: (settings) => settings.showSongOriginalTag,
    setValue: (settings) => settings.setShowSongOriginalTag
  },
  {
    id: "hideBracketedContent",
    labelKey: "settings.appearance.hideBracketedContent",
    descriptionKey: "settings.appearance.hideBracketedContent.desc",
    field: "hideBracketedContent",
    value: (settings) => settings.hideBracketedContent,
    setValue: (settings) => settings.setHideBracketedContent
  }
];

function renderBooleanItem(
  config: BooleanItemConfig,
  props: AppearanceMainPanelProps,
  t: (key: TranslationKey) => string
) {
  const value = config.value(props.settings);
  const setValue = config.setValue(props.settings);

  return (
    <BooleanSettingItem
      id={config.id}
      label={t(config.labelKey)}
      description={config.descriptionKey ? t(config.descriptionKey) : undefined}
      highlighted={props.highlightId === config.id}
      index={props.nextIndex()}
      checked={value()}
      onChange={(checked) => props.settings.setBooleanField(config.field, checked, value, setValue)}
    />
  );
}

function renderDirectBooleanItem(
  config: DirectBooleanItemConfig,
  props: AppearanceMainPanelProps,
  t: (key: TranslationKey) => string
) {
  return (
    <BooleanSettingItem
      id={config.id}
      label={t(config.labelKey)}
      description={config.descriptionKey ? t(config.descriptionKey) : undefined}
      highlighted={props.highlightId === config.id}
      index={props.nextIndex()}
      checked={config.checked()}
      onChange={config.onChange}
    />
  );
}

export function AppearanceMainPanel(props: AppearanceMainPanelProps) {
  const { t } = useTranslation();

  const themeModeOptions = createMemo<SelectOption[]>(() => [
    { value: "dark", label: t("settings.appearance.themeMode.dark") },
    { value: "light", label: t("settings.appearance.themeMode.light") },
    { value: "auto", label: t("settings.appearance.themeMode.auto") }
  ]);

  const routeAnimationOptions = createMemo<SelectOption[]>(() =>
    ROUTE_ANIMATIONS.map((anim) => ({
      value: anim.value,
      label: t(anim.i18nKey)
    }))
  );

  const fullPlayerLayoutOptions = createMemo<SelectOption[]>(() => [
    { value: "balanced", label: t("settings.general.fullPlayer.layout.balanced") },
    { value: "lyrics", label: t("settings.general.fullPlayer.layout.lyrics") }
  ]);

  const fullPlayerCommentModeOptions = createMemo<SelectOption[]>(() => [
    { value: "fullscreen", label: t("settings.general.fullPlayer.commentMode.fullscreen") },
    { value: "half-left", label: t("settings.general.fullPlayer.commentMode.halfLeft") },
    { value: "half-right", label: t("settings.general.fullPlayer.commentMode.halfRight") }
  ]);

  const playerTypeOptions = createMemo<SelectOption[]>(() => [
    { value: "cover", label: t("settings.appearance.playerType.cover") },
    { value: "record", label: t("settings.appearance.playerType.record") },
    { value: "fullscreen", label: t("settings.appearance.playerType.fullscreen") }
  ]);

  const playerBackgroundTypeOptions = createMemo<SelectOption[]>(() => [
    { value: "animation", label: t("settings.appearance.playerBackgroundType.animation") },
    { value: "blur", label: t("settings.appearance.playerBackgroundType.blur") },
    { value: "color", label: t("settings.appearance.playerBackgroundType.color") }
  ]);

  const playerExpandAnimationOptions = createMemo<SelectOption[]>(() => [
    { value: "up", label: t("settings.appearance.playerExpandAnimation.up") },
    { value: "flow", label: t("settings.appearance.playerExpandAnimation.flow") }
  ]);

  const timeFormatOptions = createMemo<SelectOption[]>(() => [
    { value: "current-total", label: t("settings.appearance.timeFormat.currentTotal") },
    { value: "remaining-total", label: t("settings.appearance.timeFormat.remainingTotal") },
    { value: "current-remaining", label: t("settings.appearance.timeFormat.currentRemaining") }
  ]);

  const animationBooleanItems = createMemo<readonly DirectBooleanItemConfig[]>(() => [
    {
      id: "playerBackgroundPause",
      labelKey: "settings.appearance.playerBackgroundPause",
      descriptionKey: "settings.appearance.playerBackgroundPause.desc",
      checked: props.settings.playerBackgroundPause,
      onChange: (checked) =>
        props.settings.setBooleanField(
          "playerBackgroundPause",
          checked,
          props.settings.playerBackgroundPause,
          props.settings.setPlayerBackgroundPause
        )
    },
    {
      id: "playerBackgroundLowFreqVolume",
      labelKey: "settings.appearance.playerBackgroundLowFreqVolume",
      descriptionKey: "settings.appearance.playerBackgroundLowFreqVolume.desc",
      checked: props.settings.playerBackgroundLowFreqVolume,
      onChange: (checked) =>
        props.settings.setBooleanField(
          "playerBackgroundLowFreqVolume",
          checked,
          props.settings.playerBackgroundLowFreqVolume,
          props.settings.setPlayerBackgroundLowFreqVolume
        )
    }
  ]);

  const playerDisplayBooleanItems = createMemo<readonly DirectBooleanItemConfig[]>(() => [
    {
      id: "showSpectrums",
      labelKey: "settings.appearance.showSpectrums",
      descriptionKey: "settings.appearance.showSpectrums.desc",
      checked: props.settings.showSpectrums,
      onChange: (checked) =>
        props.settings.setBooleanField(
          "showSpectrums",
          checked,
          props.settings.showSpectrums,
          props.settings.setShowSpectrums
        )
    }
  ]);

  const renderManagerButton = (item: ManagerConfig) => (
    <ButtonSettingItem
      id={item.itemId}
      label={t(item.labelKey)}
      description={t(item.descriptionKey)}
      highlighted={props.managerHighlighted(item)}
      index={props.nextIndex()}
      buttonLabel={t("settings.appearance.configure")}
      onClick={() => props.onOpenSubPanel(item.panel)}
    />
  );

  return (
    <>
      <SettingGroup title={t("settings.appearance.themeAndStyle")}>
        <SelectSettingItem
          id="themeMode"
          label={t("settings.appearance.themeMode")}
          highlighted={props.highlightId === "themeMode"}
          index={props.nextIndex()}
          value={props.settings.themeMode()}
          options={themeModeOptions()}
          onChange={(value) => props.settings.handleThemeChange(value as ThemeMode)}
        />

        <For each={THEME_MANAGER_ITEMS}>
          {(item) => renderManagerButton(item)}
        </For>

        <BooleanSettingItem
          id="bgEnabled"
          label={t("settings.general.background.enabled")}
          highlighted={props.highlightId === "bgEnabled"}
          index={props.nextIndex()}
          checked={props.settings.bgEnabled()}
          onChange={props.settings.handleBgToggle}
        />

        <Show when={props.settings.bgEnabled()}>
          <RangeSettingItem
            id="bgBlur"
            label={t("settings.general.background.blur")}
            highlighted={props.highlightId === "bgBlur"}
            index={props.nextIndex()}
            min={0}
            max={80}
            step={1}
            value={props.settings.bgBlur()}
            onPreview={props.settings.setBgBlur}
            onCommit={props.settings.handleBgBlur}
          />
          <RangeSettingItem
            id="bgMask"
            label={t("settings.general.background.mask")}
            highlighted={props.highlightId === "bgMask"}
            index={props.nextIndex()}
            min={0}
            max={100}
            step={1}
            value={props.settings.bgMask()}
            onPreview={props.settings.setBgMask}
            onCommit={props.settings.handleBgMask}
            formatSuffix="%"
          />
        </Show>

        <BooleanSettingItem
          id="customChrome"
          label={t("settings.general.window.customChrome")}
          highlighted={props.highlightId === "customChrome"}
          index={props.nextIndex()}
          checked={props.settings.customChrome()}
          onChange={props.settings.handleCustomChrome}
        />
      </SettingGroup>

      <SettingGroup title={t("settings.appearance.layoutManagement")}>
        <For each={LAYOUT_MANAGER_ITEMS}>
          {(item) => renderManagerButton(item)}
        </For>

        <For each={LAYOUT_BOOLEAN_ITEMS}>
          {(item) => renderBooleanItem(item, props, t)}
        </For>

        <SelectSettingItem
          id="routeAnimation"
          label={t("settings.appearance.routeAnimation")}
          highlighted={props.highlightId === "routeAnimation"}
          index={props.nextIndex()}
          value={props.settings.routeAnimation()}
          options={routeAnimationOptions()}
          onChange={(value) => props.settings.handleRouteAnimation(value as RouteAnimation)}
        />
      </SettingGroup>

      <SettingGroup title={t("settings.general.fullPlayer.layout")}>
        <SelectSettingItem
          id="fullPlayerLayout"
          label={t("settings.general.fullPlayer.layout")}
          highlighted={props.highlightId === "fullPlayerLayout"}
          index={props.nextIndex()}
          value={props.settings.fullPlayerLayout()}
          options={fullPlayerLayoutOptions()}
          onChange={(value) =>
            props.settings.handleFullPlayerLayout(value as "balanced" | "lyrics")
          }
        />

        <BooleanSettingItem
          id="fullPlayerAutoFocusLyrics"
          label={t("settings.general.fullPlayer.autoFocusLyrics")}
          highlighted={props.highlightId === "fullPlayerAutoFocusLyrics"}
          index={props.nextIndex()}
          checked={props.settings.fullPlayerAutoFocusLyrics()}
          onChange={props.settings.handleFullPlayerAutoFocusLyrics}
        />

        <SelectSettingItem
          id="playerType"
          label={t("settings.appearance.playerType")}
          description={t("settings.appearance.playerType.desc")}
          highlighted={props.highlightId === "playerType"}
          index={props.nextIndex()}
          value={props.settings.playerType()}
          options={playerTypeOptions()}
          onChange={(value) => props.settings.handlePlayerType(value as PlayerType)}
        />

        <Show
          when={props.settings.playerType() === "cover" || props.settings.playerType() === "record"}
        >
          <RangeSettingItem
            id="playerStyleRatio"
            label={t("settings.appearance.playerStyleRatio")}
            description={t("settings.appearance.playerStyleRatio.desc")}
            highlighted={props.highlightId === "playerStyleRatio"}
            index={props.nextIndex()}
            min={30}
            max={70}
            step={1}
            value={props.settings.playerStyleRatio()}
            onPreview={props.settings.setPlayerStyleRatio}
            onCommit={props.settings.handlePlayerStyleRatio}
            formatSuffix="%"
          />
        </Show>

        <Show when={props.settings.playerType() === "fullscreen"}>
          <RangeSettingItem
            id="playerFullscreenGradient"
            label={t("settings.appearance.playerFullscreenGradient")}
            description={t("settings.appearance.playerFullscreenGradient.desc")}
            highlighted={props.highlightId === "playerFullscreenGradient"}
            index={props.nextIndex()}
            min={0}
            max={100}
            step={1}
            value={props.settings.playerFullscreenGradient()}
            onPreview={props.settings.setPlayerFullscreenGradient}
            onCommit={props.settings.handlePlayerFullscreenGradient}
            formatSuffix="%"
          />
        </Show>

        <SelectSettingItem
          id="fullPlayerCommentMode"
          label={t("settings.general.fullPlayer.commentMode")}
          highlighted={props.highlightId === "fullPlayerCommentMode"}
          index={props.nextIndex()}
          value={props.settings.fullPlayerCommentMode()}
          options={fullPlayerCommentModeOptions()}
          onChange={(value) =>
            props.settings.handleFullPlayerCommentMode(value as FullPlayerCommentMode)
          }
        />

        <SelectSettingItem
          id="playerBackgroundType"
          label={t("settings.appearance.playerBackgroundType")}
          description={t("settings.appearance.playerBackgroundType.desc")}
          highlighted={props.highlightId === "playerBackgroundType"}
          index={props.nextIndex()}
          value={props.settings.playerBackgroundType()}
          options={playerBackgroundTypeOptions()}
          onChange={(value) =>
            props.settings.handlePlayerBackgroundType(value as PlayerBackgroundType)
          }
        />

        <Show when={props.settings.playerBackgroundType() === "animation"}>
          <RangeSettingItem
            id="playerBackgroundFps"
            label={t("settings.appearance.playerBackgroundFps")}
            description={t("settings.appearance.playerBackgroundFps.desc")}
            highlighted={props.highlightId === "playerBackgroundFps"}
            index={props.nextIndex()}
            min={24}
            max={256}
            step={1}
            value={props.settings.playerBackgroundFps()}
            onPreview={props.settings.setPlayerBackgroundFps}
            onCommit={props.settings.handlePlayerBackgroundFps}
            formatSuffix=" fps"
          />
          <RangeSettingItem
            id="playerBackgroundFlowSpeed"
            label={t("settings.appearance.playerBackgroundFlowSpeed")}
            description={t("settings.appearance.playerBackgroundFlowSpeed.desc")}
            highlighted={props.highlightId === "playerBackgroundFlowSpeed"}
            index={props.nextIndex()}
            min={0.1}
            max={10}
            step={0.1}
            value={props.settings.playerBackgroundFlowSpeed()}
            onPreview={props.settings.setPlayerBackgroundFlowSpeed}
            onCommit={props.settings.handlePlayerBackgroundFlowSpeed}
            formatSuffix="x"
          />
          <RangeSettingItem
            id="playerBackgroundRenderScale"
            label={t("settings.appearance.playerBackgroundRenderScale")}
            description={t("settings.appearance.playerBackgroundRenderScale.desc")}
            highlighted={props.highlightId === "playerBackgroundRenderScale"}
            index={props.nextIndex()}
            min={0.1}
            max={3}
            step={0.1}
            value={props.settings.playerBackgroundRenderScale()}
            onPreview={props.settings.setPlayerBackgroundRenderScale}
            onCommit={props.settings.handlePlayerBackgroundRenderScale}
            formatSuffix="x"
          />
          <For each={animationBooleanItems()}>
            {(item) => renderDirectBooleanItem(item, props, t)}
          </For>
        </Show>

        <SelectSettingItem
          id="playerExpandAnimation"
          label={t("settings.appearance.playerExpandAnimation")}
          description={t("settings.appearance.playerExpandAnimation.desc")}
          highlighted={props.highlightId === "playerExpandAnimation"}
          index={props.nextIndex()}
          value={props.settings.playerExpandAnimation()}
          options={playerExpandAnimationOptions()}
          onChange={(value) =>
            props.settings.handlePlayerExpandAnimation(value as PlayerExpandAnimation)
          }
        />

        <BooleanSettingItem
          id="dynamicCover"
          label={t("settings.appearance.dynamicCover")}
          description={t("settings.appearance.dynamicCover.desc")}
          highlighted={props.highlightId === "dynamicCover"}
          index={props.nextIndex()}
          checked={props.settings.dynamicCover()}
          onChange={props.settings.handleDynamicCover}
        />

        <BooleanSettingItem
          id="playerFollowCoverColor"
          label={t("settings.appearance.playerFollowCoverColor")}
          description={t("settings.appearance.playerFollowCoverColor.desc")}
          highlighted={props.highlightId === "playerFollowCoverColor"}
          index={props.nextIndex()}
          checked={props.settings.playerFollowCoverColor()}
          onChange={props.settings.handlePlayerFollowCoverColor}
        />

        <For each={playerDisplayBooleanItems()}>
          {(item) => renderDirectBooleanItem(item, props, t)}
        </For>
      </SettingGroup>

      <SettingGroup title={t("settings.appearance.playerElements")}>
        {renderManagerButton(COVER_MANAGER_ITEM)}

        <For each={PLAYER_ELEMENT_ITEMS}>
          {(item) => renderBooleanItem(item, props, t)}
        </For>

        <SelectSettingItem
          id="timeFormat"
          label={t("settings.appearance.timeFormat")}
          description={t("settings.appearance.timeFormat.desc")}
          highlighted={props.highlightId === "timeFormat"}
          index={props.nextIndex()}
          value={props.settings.timeFormat()}
          options={timeFormatOptions()}
          onChange={(value) => props.settings.handleTimeFormat(value as PlayerTimeFormat)}
        />
      </SettingGroup>

      <SettingGroup title={t("settings.appearance.songListElements")}>
        <For each={SONG_LIST_ELEMENT_ITEMS}>
          {(item) => renderBooleanItem(item, props, t)}
        </For>
      </SettingGroup>

      <div class={settingsHintClass}>{t("settings.general.window.modeHint")}</div>
      <Show when={!props.settings.customChrome()}>
        <div class={settingsHintClass}>{t("settings.general.window.restartHint")}</div>
      </Show>
    </>
  );
}

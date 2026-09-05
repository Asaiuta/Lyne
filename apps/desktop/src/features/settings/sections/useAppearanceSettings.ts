import { createMemo, type Accessor, type Setter } from "solid-js";
import {
  DEFAULT_HIDDEN_COVERS,
  type HiddenCovers,
  type ThemeMode,
  type UISettings,
  type UISettingsBooleanFieldName,
  type UISettingsBooleanRecordFieldName
} from "../../../shared/state/uiSettingsModel";
import {
  commitUISettingField,
  readUISettingsSnapshot
} from "../../../shared/state/uiSettingsStorage";
import {
  applyUserAppearanceSettings,
  executeCustomJs
} from "../../../shared/styles/customAppearance";
import { COVER_DISPLAY_ITEMS } from "./appearanceConfig";
import {
  APPEARANCE_RETURNED_SETTER_FIELDS,
  APPEARANCE_SIMPLE_COMMIT_FIELDS,
  APPEARANCE_STYLE_COMMIT_FIELDS,
  type AppearanceSignalField,
  commitAppearanceSignalField,
  createAppearanceAccessors,
  createAppearanceFieldCommitters,
  createAppearanceSetterAliases,
  createAppearanceSignals,
  previewAppearanceSignalField
} from "./appearanceSettingsModel";

function resolveTheme(mode: ThemeMode): "dark" | "light" {
  if (mode === "auto") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return mode;
}

function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = resolveTheme(mode);
}

export function useAppearanceSettings() {
  const signals = createAppearanceSignals(readUISettingsSnapshot());
  const accessors = createAppearanceAccessors(signals);
  const setters = createAppearanceSetterAliases(signals, APPEARANCE_RETURNED_SETTER_FIELDS);
  const applyAppearanceSnapshot = () => applyUserAppearanceSettings(readUISettingsSnapshot());
  const simpleCommitters = createAppearanceFieldCommitters(
    signals,
    APPEARANCE_SIMPLE_COMMIT_FIELDS
  );
  const styleCommitters = createAppearanceFieldCommitters(
    signals,
    APPEARANCE_STYLE_COMMIT_FIELDS,
    { afterPersist: applyAppearanceSnapshot }
  );

  const allCoversHidden = createMemo<boolean>(() =>
    COVER_DISPLAY_ITEMS.every((item) => accessors.hiddenCovers()[item.key])
  );

  const handleThemeChange = (mode: UISettings["themeMode"]) => {
    if (commitAppearanceSignalField(signals, "themeMode", mode)) {
      applyTheme(mode);
      applyAppearanceSnapshot();
    } else {
      applyTheme(accessors.themeMode());
    }
  };

  const handleCustomAccentColor = (value: UISettings["customAccentColor"]) => {
    styleCommitters.customAccentColor(value);
  };

  const setBooleanField = <K extends UISettingsBooleanFieldName>(
    field: K,
    nextValue: UISettings[K],
    value: Accessor<UISettings[K]>,
    setValue: Setter<UISettings[K]>
  ) => commitUISettingField(field, nextValue, value, setValue);

  const handleThemeFollowCover = (nextValue: UISettings["themeFollowCover"]) => {
    styleCommitters.themeFollowCover(nextValue);
  };

  const handleGlobalFont = (value: UISettings["globalFont"]) => {
    styleCommitters.globalFont(value);
  };

  const handleCustomFontFamily = (value: UISettings["customFontFamily"]) =>
    styleCommitters.customFontFamily(value);

  const handleCustomCss = (value: UISettings["customCss"]) =>
    styleCommitters.customCss(value);

  const handleCustomJs = (value: UISettings["customJs"]) =>
    simpleCommitters.customJs(value);

  const handleRunCustomJs = () => executeCustomJs(accessors.customJs());

  const createPreviewHandler =
    <K extends AppearanceSignalField>(field: K) =>
    (value: UISettings[K]) => {
      previewAppearanceSignalField(signals, field, value);
    };

  const handleBgBlurPreview = createPreviewHandler("bgBlur");
  const handleBgMaskPreview = createPreviewHandler("bgMask");
  const handleDynamicBackgroundMaxFpsPreview = createPreviewHandler("dynamicBackgroundMaxFps");
  const handlePlayerStyleRatioPreview = createPreviewHandler("playerStyleRatio");
  const handlePlayerFullscreenGradientPreview = createPreviewHandler("playerFullscreenGradient");
  const handlePlayerBackgroundFpsPreview = createPreviewHandler("playerBackgroundFps");
  const handlePlayerBackgroundFlowSpeedPreview = createPreviewHandler("playerBackgroundFlowSpeed");
  const handlePlayerBackgroundRenderScalePreview = createPreviewHandler(
    "playerBackgroundRenderScale"
  );

  const handleToggleAllCovers = () => {
    const nextHidden = !allCoversHidden();
    const nextRecord: HiddenCovers = { ...DEFAULT_HIDDEN_COVERS };
    COVER_DISPLAY_ITEMS.forEach((item) => {
      nextRecord[item.key] = nextHidden;
    });
    commitAppearanceSignalField(signals, "hiddenCovers", nextRecord);
  };

  const updateRecordField = <
    K extends UISettingsBooleanRecordFieldName,
    ItemKey extends keyof UISettings[K]
  >(
    field: K,
    record: Accessor<UISettings[K]>,
    itemKey: ItemKey,
    next: boolean,
    setValue: Setter<UISettings[K]>
  ) => {
    const current = record();
    const nextRecord = { ...current, [itemKey]: next } as UISettings[K];
    commitUISettingField(field, nextRecord, record, setValue);
  };

  return {
    ...accessors,
    allCoversHidden,
    ...setters,
    handleThemeChange,
    handleCustomAccentColor,
    handleThemeFollowCover,
    handleGlobalFont,
    handleCustomFontFamily,
    handleCustomCss,
    handleCustomJs,
    handleRunCustomJs,
    handleRouteAnimation: simpleCommitters.routeAnimation,
    handleBgToggle: simpleCommitters.bgEnabled,
    handleBgBlurPreview,
    handleBgBlur: simpleCommitters.bgBlur,
    handleBgMaskPreview,
    handleBgMask: simpleCommitters.bgMask,
    handleDynamicBackgroundMaxFpsPreview,
    handleDynamicBackgroundMaxFps: simpleCommitters.dynamicBackgroundMaxFps,
    handleFullPlayerLayout: simpleCommitters.fullPlayerLayout,
    handleFullPlayerAutoFocusLyrics: simpleCommitters.fullPlayerAutoFocusLyrics,
    handleFullPlayerCommentMode: simpleCommitters.fullPlayerCommentMode,
    handlePlayerType: simpleCommitters.playerType,
    handlePlayerStyleRatioPreview,
    handlePlayerStyleRatio: simpleCommitters.playerStyleRatio,
    handlePlayerFullscreenGradientPreview,
    handlePlayerFullscreenGradient: simpleCommitters.playerFullscreenGradient,
    handlePlayerBackgroundType: simpleCommitters.playerBackgroundType,
    handlePlayerBackgroundFpsPreview,
    handlePlayerBackgroundFps: simpleCommitters.playerBackgroundFps,
    handlePlayerBackgroundFlowSpeedPreview,
    handlePlayerBackgroundFlowSpeed: simpleCommitters.playerBackgroundFlowSpeed,
    handlePlayerBackgroundRenderScalePreview,
    handlePlayerBackgroundRenderScale: simpleCommitters.playerBackgroundRenderScale,
    handlePlayerExpandAnimation: simpleCommitters.playerExpandAnimation,
    handleDynamicCover: simpleCommitters.dynamicCover,
    handlePlayerFollowCoverColor: simpleCommitters.playerFollowCoverColor,
    handleTimeFormat: simpleCommitters.timeFormat,
    handleToggleAllCovers,
    setBooleanField,
    updateRecordField
  };
}

export type AppearanceSettings = ReturnType<typeof useAppearanceSettings>;

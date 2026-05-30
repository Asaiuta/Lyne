import { createSignal, type Accessor, type Setter } from "solid-js";
import type {
  UISettings,
  UISettingsFieldName,
  UISettingsRuntime
} from "../../../shared/state/useUISettings";
import { commitUISettingField } from "../../../shared/state/useUISettings";

export const APPEARANCE_SIGNAL_FIELDS = [
  "themeMode",
  "customAccentColor",
  "themeFollowCover",
  "themeGlobalColor",
  "globalFont",
  "customFontFamily",
  "customCss",
  "customJs",
  "bgEnabled",
  "bgBlur",
  "bgMask",
  "customChrome",
  "routeAnimation",
  "fullPlayerLayout",
  "fullPlayerAutoFocusLyrics",
  "fullPlayerCommentMode",
  "playerType",
  "playerStyleRatio",
  "playerFullscreenGradient",
  "playerBackgroundType",
  "playerBackgroundFps",
  "playerBackgroundFlowSpeed",
  "playerBackgroundRenderScale",
  "playerBackgroundPause",
  "playerBackgroundLowFreqVolume",
  "playerExpandAnimation",
  "dynamicCover",
  "playerFollowCoverColor",
  "sidebarHiddenItems",
  "playlistPageElements",
  "contextMenuOptions",
  "hiddenCovers",
  "menuShowCover",
  "autoHidePlayerMeta",
  "showPlayMeta",
  "countDownShow",
  "showSpectrums",
  "showPlaylistCount",
  "barLyricShow",
  "showSongQuality",
  "showSongPrivilegeTag",
  "showSongExplicitTag",
  "showSongOriginalTag",
  "showSongAlbum",
  "showSongDuration",
  "showSongOperations",
  "showSongArtist",
  "hideBracketedContent",
  "showPlayerQuality",
  "timeFormat",
  "fullPlayerShowLike",
  "fullPlayerShowAddToPlaylist",
  "fullPlayerShowDownload",
  "fullPlayerShowComments",
  "fullPlayerShowCopyLyric",
  "fullPlayerShowDesktopLyric",
  "fullPlayerShowLyricOffset",
  "fullPlayerShowLyricSettings",
  "fullPlayerShowMoreSettings",
  "fullPlayerShowCommentCount",
  "showHomeGreeting"
] as const satisfies readonly UISettingsFieldName[];

export type AppearanceSignalField = (typeof APPEARANCE_SIGNAL_FIELDS)[number];

export type AppearanceSignal<K extends AppearanceSignalField> = {
  value: Accessor<UISettings[K]>;
  setValue: Setter<UISettings[K]>;
};

export type AppearanceSignals = {
  [K in AppearanceSignalField]: AppearanceSignal<K>;
};

export type AppearanceAccessors = {
  [K in AppearanceSignalField]: Accessor<UISettings[K]>;
};

export type AppearanceSetters = {
  [K in AppearanceSignalField]: Setter<UISettings[K]>;
};

export const APPEARANCE_STYLE_COMMIT_FIELDS = [
  "customAccentColor",
  "themeGlobalColor",
  "themeFollowCover",
  "globalFont",
  "customFontFamily",
  "customCss"
] as const satisfies readonly AppearanceSignalField[];

export const APPEARANCE_SIMPLE_COMMIT_FIELDS = [
  "customJs",
  "routeAnimation",
  "bgEnabled",
  "bgBlur",
  "bgMask",
  "customChrome",
  "fullPlayerLayout",
  "fullPlayerAutoFocusLyrics",
  "fullPlayerCommentMode",
  "playerType",
  "playerStyleRatio",
  "playerFullscreenGradient",
  "playerBackgroundType",
  "playerBackgroundFps",
  "playerBackgroundFlowSpeed",
  "playerBackgroundRenderScale",
  "playerExpandAnimation",
  "dynamicCover",
  "playerFollowCoverColor",
  "timeFormat"
] as const satisfies readonly AppearanceSignalField[];

export const APPEARANCE_RETURNED_SETTER_FIELDS = [
  "bgBlur",
  "bgMask",
  "customAccentColor",
  "customFontFamily",
  "customCss",
  "customJs",
  "playerStyleRatio",
  "playerFullscreenGradient",
  "playerBackgroundFps",
  "playerBackgroundFlowSpeed",
  "playerBackgroundRenderScale",
  "sidebarHiddenItems",
  "playlistPageElements",
  "contextMenuOptions",
  "hiddenCovers",
  "menuShowCover",
  "autoHidePlayerMeta",
  "showPlayMeta",
  "countDownShow",
  "showSpectrums",
  "showPlaylistCount",
  "barLyricShow",
  "showSongQuality",
  "showSongPrivilegeTag",
  "showSongExplicitTag",
  "showSongOriginalTag",
  "showSongAlbum",
  "showSongDuration",
  "showSongOperations",
  "showSongArtist",
  "hideBracketedContent",
  "showPlayerQuality",
  "playerBackgroundPause",
  "playerBackgroundLowFreqVolume",
  "dynamicCover",
  "fullPlayerShowLike",
  "fullPlayerShowAddToPlaylist",
  "fullPlayerShowDownload",
  "fullPlayerShowComments",
  "fullPlayerShowCopyLyric",
  "fullPlayerShowDesktopLyric",
  "fullPlayerShowLyricOffset",
  "fullPlayerShowLyricSettings",
  "fullPlayerShowMoreSettings",
  "fullPlayerShowCommentCount",
  "showHomeGreeting"
] as const satisfies readonly AppearanceSignalField[];

type SetterAliasName<K extends string> = `set${Capitalize<K>}`;

export type AppearanceSetterAliases<
  Fields extends readonly AppearanceSignalField[] = typeof APPEARANCE_RETURNED_SETTER_FIELDS
> = {
  [K in Fields[number] as SetterAliasName<K>]: Setter<UISettings[K]>;
};

type Committers<Fields extends readonly AppearanceSignalField[]> = {
  [K in Fields[number]]: (value: UISettings[K]) => boolean;
};

interface CommitterOptions {
  afterPersist?: () => void;
  runtime?: UISettingsRuntime;
}

export function createAppearanceSignals(initialSettings: UISettings): AppearanceSignals {
  const entries = APPEARANCE_SIGNAL_FIELDS.map((field) => {
    const [value, setValue] = createSignal<UISettings[typeof field]>(initialSettings[field]);
    return [field, { value, setValue }];
  });
  return Object.fromEntries(entries) as AppearanceSignals;
}

export function createAppearanceAccessors(signals: AppearanceSignals): AppearanceAccessors {
  const entries = APPEARANCE_SIGNAL_FIELDS.map((field) => [field, signals[field].value]);
  return Object.fromEntries(entries) as AppearanceAccessors;
}

export function createAppearanceSetters(signals: AppearanceSignals): AppearanceSetters {
  const entries = APPEARANCE_SIGNAL_FIELDS.map((field) => [field, signals[field].setValue]);
  return Object.fromEntries(entries) as AppearanceSetters;
}

export function createAppearanceSetterAliases<
  const Fields extends readonly AppearanceSignalField[]
>(signals: AppearanceSignals, fields: Fields): AppearanceSetterAliases<Fields> {
  const entries = fields.map((field) => [
    `set${field[0].toUpperCase()}${field.slice(1)}`,
    signals[field].setValue
  ]);
  return Object.fromEntries(entries) as AppearanceSetterAliases<Fields>;
}

export function commitAppearanceSignalField<K extends AppearanceSignalField>(
  signals: AppearanceSignals,
  field: K,
  value: UISettings[K],
  runtime?: UISettingsRuntime
): boolean {
  const signal = signals[field];
  return commitUISettingField(field, value, signal.value, signal.setValue, runtime);
}

export function createAppearanceFieldCommitters<
  const Fields extends readonly AppearanceSignalField[]
>(
  signals: AppearanceSignals,
  fields: Fields,
  options: CommitterOptions = {}
): Committers<Fields> {
  const committers: Partial<Record<AppearanceSignalField, (value: unknown) => boolean>> = {};
  for (const field of fields) {
    committers[field] = (value) => {
      const persisted = commitAppearanceSignalField(
        signals,
        field,
        value as UISettings[typeof field],
        options.runtime
      );
      if (persisted) options.afterPersist?.();
      return persisted;
    };
  }
  return committers as Committers<Fields>;
}

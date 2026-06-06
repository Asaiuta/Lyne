import type { SettingsCategoryKey } from "../components/SettingsCategoryNav";
import {
  CONTEXT_MENU_ITEMS,
  COVER_DISPLAY_ITEMS,
  COVER_MANAGER_ITEM,
  LAYOUT_MANAGER_ITEMS,
  PLAYLIST_PAGE_ITEMS,
  SIDEBAR_VISIBILITY_ITEMS,
  THEME_MANAGER_ITEMS
} from "../sections/appearanceConfig";

const managerIds = (items: readonly { itemId: string }[]): string[] =>
  items.map((item) => item.itemId);

const GENERAL_ITEM_IDS = [
  "useOnlineService",
  "closeAppMethod",
  "showCloseAppTip",
  "showTaskbarProgress",
  "checkUpdateOnStart",
  "updateChannel",
  "showSearchHistory",
  "showHotSearch",
  "enableSearchKeyword",
  "searchInputBehavior",
  "shareUrlFormat"
] as const;

const APPEARANCE_ITEM_IDS = [
  "themeMode",
  ...managerIds(THEME_MANAGER_ITEMS),
  "themeGlobalColor",
  "themeFollowCover",
  "customAccentColor",
  "globalFont",
  "customFontFamily",
  "customCss",
  "customJs",
  "bgEnabled",
  "bgBlur",
  "bgMask",
  "customChrome",
  ...managerIds(LAYOUT_MANAGER_ITEMS),
  ...managerIds(SIDEBAR_VISIBILITY_ITEMS),
  "showHomeGreeting",
  "menuShowCover",
  "routeAnimation",
  ...managerIds(PLAYLIST_PAGE_ITEMS),
  ...managerIds(CONTEXT_MENU_ITEMS),
  COVER_MANAGER_ITEM.itemId,
  ...managerIds(COVER_DISPLAY_ITEMS),
  "fullPlayerLayout",
  "fullPlayerAutoFocusLyrics",
  "playerType",
  "playerStyleRatio",
  "playerFullscreenGradient",
  "fullPlayerCommentMode",
  "playerBackgroundType",
  "playerBackgroundFps",
  "playerBackgroundFlowSpeed",
  "playerBackgroundRenderScale",
  "playerBackgroundPause",
  "playerBackgroundLowFreqVolume",
  "playerExpandAnimation",
  "dynamicCover",
  "playerFollowCoverColor",
  "autoHidePlayerMeta",
  "showPlayMeta",
  "countDownShow",
  "showSpectrums",
  "showPlaylistCount",
  "barLyricShow",
  "showPlayerQuality",
  "timeFormat",
  "showSongAlbum",
  "showSongArtist",
  "showSongDuration",
  "showSongOperations",
  "showSongQuality",
  "showSongPrivilegeTag",
  "showSongExplicitTag",
  "showSongOriginalTag",
  "hideBracketedContent",
  "fullPlayerShowLike",
  "fullPlayerShowAddToPlaylist",
  "fullPlayerShowDownload",
  "fullPlayerShowComments",
  "fullPlayerShowCommentCount",
  "fullPlayerShowCopyLyric",
  "fullPlayerShowDesktopLyric",
  "fullPlayerShowLyricOffset",
  "fullPlayerShowLyricSettings",
  "fullPlayerShowMoreSettings"
] as const;

const PLAYBACK_ITEM_IDS = [
  "autoPlay",
  "useNextPrefetch",
  "volumeFade",
  "volumeFadeTime",
  "memoryLastSeek",
  "progressTooltipShow",
  "progressLyricShow",
  "progressAdjustLyric",
  "ncmSongLevel"
] as const;

const LYRICS_ITEM_IDS = [
  "lyricFontSize",
  "lyricFontWeight",
  "lyricTranslationFontSize",
  "lyricRomanizationFontSize",
  "showLyricTranslation",
  "showLyricRomanization",
  "swapLyricTranslationRomanization",
  "showWordLyrics",
  "lyricsBlur",
  "lyricsScrollOffset",
  "lyricsPosition",
  "lyricHorizontalOffset",
  "lyricAlignRight",
  "lyricsBlendMode"
] as const;

const AUDIO_ENGINE_ITEM_IDS = [
  "device",
  "exclusive",
  "volume",
  "upsampling",
  "eqType",
  "firTaps",
  "eqBands",
  "outputBits",
  "noiseShaper",
  "dither",
  "loudnessEnabled",
  "loudnessMode",
  "targetLufs",
  "preamp",
  "resampleQuality",
  "saturationEnabled",
  "saturationDrive",
  "saturationMix",
  "crossfeedEnabled",
  "crossfeedMix",
  "dynamicLoudnessEnabled",
  "dynamicLoudnessStrength",
  "useCache",
  "preemptiveResample",
  "streamingFirstBuffer",
  "streamingFullBufferLimitMib",
  "engineReload"
] as const;

const LOCAL_ITEM_IDS = [
  "localMusicDirectory",
  "localFolderDisplayMode",
  "showLocalCover",
  "showDefaultLocalPath",
  "localLyricDirectories",
  "downloadPath",
  "downloadMeta",
  "downloadCover",
  "downloadLyric",
  "downloadLyricTranslation",
  "downloadThreadCount",
  "downloadSongLevel",
  "cacheEnabled",
  "songCacheEnabled",
  "cacheLimit",
  "clearCache"
] as const;

const KEYBOARD_ITEM_IDS = [
  "globalShortcutEnabled",
  "globalPlayPause",
  "globalNext",
  "globalPrev",
  "globalVolumeUp",
  "globalVolumeDown",
  "localPlayPause",
  "localNext",
  "localPrev",
  "localLike",
  "resetShortcut"
] as const;

const NETWORK_ITEM_IDS = [
  "streamingEnabled",
  "streamingServerList",
  "proxyProtocol",
  "proxyServer",
  "proxyTest",
  "useRealIP",
  "lastfmEnabled",
  "lastfmConnect",
  "lastfmScrobble",
  "lastfmNowplaying",
  "discordEnabled",
  "discordPaused",
  "socketEnabled",
  "socketTest",
  "smtcOpen"
] as const;

const ABOUT_ITEM_IDS = [
  "appVersion",
  "checkUpdate",
  "changelog",
  "projectRepo",
  "reportIssue",
  "contributors",
  "references"
] as const;

export const SETTINGS_SECTION_ITEM_IDS: Record<SettingsCategoryKey, readonly string[]> = {
  general: GENERAL_ITEM_IDS,
  appearance: APPEARANCE_ITEM_IDS,
  playback: PLAYBACK_ITEM_IDS,
  lyrics: LYRICS_ITEM_IDS,
  local: LOCAL_ITEM_IDS,
  keyboard: KEYBOARD_ITEM_IDS,
  network: NETWORK_ITEM_IDS,
  "audio-engine": AUDIO_ENGINE_ITEM_IDS,
  about: ABOUT_ITEM_IDS
};

export const SETTINGS_SECTION_ITEM_ID_SETS: Record<SettingsCategoryKey, ReadonlySet<string>> = {
  general: new Set(GENERAL_ITEM_IDS),
  appearance: new Set(APPEARANCE_ITEM_IDS),
  playback: new Set(PLAYBACK_ITEM_IDS),
  lyrics: new Set(LYRICS_ITEM_IDS),
  local: new Set(LOCAL_ITEM_IDS),
  keyboard: new Set(KEYBOARD_ITEM_IDS),
  network: new Set(NETWORK_ITEM_IDS),
  "audio-engine": new Set(AUDIO_ENGINE_ITEM_IDS),
  about: new Set(ABOUT_ITEM_IDS)
};

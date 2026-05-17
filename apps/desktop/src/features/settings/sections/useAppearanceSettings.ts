import { createMemo, createSignal, type Accessor, type Setter } from "solid-js";
import type {
  ContextMenuOptions,
  FullPlayerCommentMode,
  HiddenCovers,
  PlayerBackgroundType,
  PlayerExpandAnimation,
  PlayerTimeFormat,
  PlayerType,
  PlaylistPageElements,
  RouteAnimation,
  SidebarHiddenItems,
  ThemeMode
} from "../../../shared/state/useUISettings";
import {
  DEFAULT_HIDDEN_COVERS,
  STORAGE_KEYS,
  readUISettingsSnapshot
} from "../../../shared/state/useUISettings";
import {
  commitPersistedRecordSetting,
  commitPersistedSetting,
  persist
} from "../storage";
import { COVER_DISPLAY_ITEMS } from "./appearanceConfig";

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
  const initialSettings = readUISettingsSnapshot();

  const [themeMode, setThemeMode] = createSignal<ThemeMode>(initialSettings.themeMode);
  const [bgEnabled, setBgEnabled] = createSignal<boolean>(initialSettings.bgEnabled);
  const [bgBlur, setBgBlur] = createSignal<number>(initialSettings.bgBlur);
  const [bgMask, setBgMask] = createSignal<number>(initialSettings.bgMask);
  const [customChrome, setCustomChrome] = createSignal<boolean>(initialSettings.customChrome);
  const [routeAnimation, setRouteAnimation] = createSignal<RouteAnimation>(initialSettings.routeAnimation);
  const [fullPlayerLayout, setFullPlayerLayout] =
    createSignal<"balanced" | "lyrics">(initialSettings.fullPlayerLayout);
  const [fullPlayerAutoFocusLyrics, setFullPlayerAutoFocusLyrics] =
    createSignal<boolean>(initialSettings.fullPlayerAutoFocusLyrics);
  const [fullPlayerCommentMode, setFullPlayerCommentMode] =
    createSignal<FullPlayerCommentMode>(initialSettings.fullPlayerCommentMode);
  const [playerType, setPlayerType] = createSignal<PlayerType>(initialSettings.playerType);
  const [playerStyleRatio, setPlayerStyleRatio] = createSignal<number>(initialSettings.playerStyleRatio);
  const [playerFullscreenGradient, setPlayerFullscreenGradient] =
    createSignal<number>(initialSettings.playerFullscreenGradient);
  const [playerBackgroundType, setPlayerBackgroundType] =
    createSignal<PlayerBackgroundType>(initialSettings.playerBackgroundType);
  const [playerBackgroundFps, setPlayerBackgroundFps] =
    createSignal<number>(initialSettings.playerBackgroundFps);
  const [playerBackgroundFlowSpeed, setPlayerBackgroundFlowSpeed] =
    createSignal<number>(initialSettings.playerBackgroundFlowSpeed);
  const [playerBackgroundRenderScale, setPlayerBackgroundRenderScale] =
    createSignal<number>(initialSettings.playerBackgroundRenderScale);
  const [playerBackgroundPause, setPlayerBackgroundPause] =
    createSignal<boolean>(initialSettings.playerBackgroundPause);
  const [playerBackgroundLowFreqVolume, setPlayerBackgroundLowFreqVolume] =
    createSignal<boolean>(initialSettings.playerBackgroundLowFreqVolume);
  const [playerExpandAnimation, setPlayerExpandAnimation] =
    createSignal<PlayerExpandAnimation>(initialSettings.playerExpandAnimation);
  const [playerFollowCoverColor, setPlayerFollowCoverColor] =
    createSignal<boolean>(initialSettings.playerFollowCoverColor);
  const [sidebarHiddenItems, setSidebarHiddenItems] =
    createSignal<SidebarHiddenItems>(initialSettings.sidebarHiddenItems);
  const [playlistPageElements, setPlaylistPageElements] =
    createSignal<PlaylistPageElements>(initialSettings.playlistPageElements);
  const [contextMenuOptions, setContextMenuOptions] =
    createSignal<ContextMenuOptions>(initialSettings.contextMenuOptions);
  const [hiddenCovers, setHiddenCovers] = createSignal<HiddenCovers>(initialSettings.hiddenCovers);
  const [menuShowCover, setMenuShowCover] = createSignal<boolean>(initialSettings.menuShowCover);
  const [autoHidePlayerMeta, setAutoHidePlayerMeta] =
    createSignal<boolean>(initialSettings.autoHidePlayerMeta);
  const [showPlayMeta, setShowPlayMeta] = createSignal<boolean>(initialSettings.showPlayMeta);
  const [countDownShow, setCountDownShow] = createSignal<boolean>(initialSettings.countDownShow);
  const [showSpectrums, setShowSpectrums] = createSignal<boolean>(initialSettings.showSpectrums);
  const [showPlaylistCount, setShowPlaylistCount] =
    createSignal<boolean>(initialSettings.showPlaylistCount);
  const [barLyricShow, setBarLyricShow] = createSignal<boolean>(initialSettings.barLyricShow);
  const [showSongQuality, setShowSongQuality] = createSignal<boolean>(initialSettings.showSongQuality);
  const [showSongPrivilegeTag, setShowSongPrivilegeTag] =
    createSignal<boolean>(initialSettings.showSongPrivilegeTag);
  const [showSongExplicitTag, setShowSongExplicitTag] =
    createSignal<boolean>(initialSettings.showSongExplicitTag);
  const [showSongOriginalTag, setShowSongOriginalTag] =
    createSignal<boolean>(initialSettings.showSongOriginalTag);
  const [showSongAlbum, setShowSongAlbum] = createSignal<boolean>(initialSettings.showSongAlbum);
  const [showSongDuration, setShowSongDuration] =
    createSignal<boolean>(initialSettings.showSongDuration);
  const [showSongOperations, setShowSongOperations] =
    createSignal<boolean>(initialSettings.showSongOperations);
  const [showSongArtist, setShowSongArtist] =
    createSignal<boolean>(initialSettings.showSongArtist);
  const [hideBracketedContent, setHideBracketedContent] =
    createSignal<boolean>(initialSettings.hideBracketedContent);
  const [showPlayerQuality, setShowPlayerQuality] =
    createSignal<boolean>(initialSettings.showPlayerQuality);
  const [timeFormat, setTimeFormat] = createSignal<PlayerTimeFormat>(initialSettings.timeFormat);
  const [fullPlayerShowLike, setFullPlayerShowLike] =
    createSignal<boolean>(initialSettings.fullPlayerShowLike);
  const [fullPlayerShowAddToPlaylist, setFullPlayerShowAddToPlaylist] =
    createSignal<boolean>(initialSettings.fullPlayerShowAddToPlaylist);
  const [fullPlayerShowDownload, setFullPlayerShowDownload] =
    createSignal<boolean>(initialSettings.fullPlayerShowDownload);
  const [fullPlayerShowComments, setFullPlayerShowComments] =
    createSignal<boolean>(initialSettings.fullPlayerShowComments);
  const [fullPlayerShowDesktopLyric, setFullPlayerShowDesktopLyric] =
    createSignal<boolean>(initialSettings.fullPlayerShowDesktopLyric);
  const [fullPlayerShowMoreSettings, setFullPlayerShowMoreSettings] =
    createSignal<boolean>(initialSettings.fullPlayerShowMoreSettings);
  const [fullPlayerShowCommentCount, setFullPlayerShowCommentCount] =
    createSignal<boolean>(initialSettings.fullPlayerShowCommentCount);

  const allCoversHidden = createMemo<boolean>(() =>
    COVER_DISPLAY_ITEMS.every((item) => hiddenCovers()[item.key])
  );

  const handleThemeChange = (mode: ThemeMode) => {
    if (commitPersistedSetting(STORAGE_KEYS.themeMode, mode, themeMode, setThemeMode)) {
      applyTheme(mode);
    } else {
      applyTheme(themeMode());
    }
  };
  const handleRouteAnimation = (value: RouteAnimation) => {
    commitPersistedSetting(STORAGE_KEYS.routeAnimation, value, routeAnimation, setRouteAnimation);
  };
  const handleBgToggle = () =>
    commitPersistedSetting(STORAGE_KEYS.bgEnabled, !bgEnabled(), bgEnabled, setBgEnabled);
  const handleBgBlur = (value: number) => {
    commitPersistedSetting(STORAGE_KEYS.bgBlur, value, bgBlur, setBgBlur);
  };
  const handleBgMask = (value: number) => {
    commitPersistedSetting(STORAGE_KEYS.bgMask, value, bgMask, setBgMask);
  };
  const handleCustomChrome = () =>
    commitPersistedSetting(
      STORAGE_KEYS.customChrome,
      !customChrome(),
      customChrome,
      setCustomChrome
    );
  const handleFullPlayerLayout = (value: "balanced" | "lyrics") => {
    commitPersistedSetting(
      STORAGE_KEYS.fullPlayerLayout,
      value,
      fullPlayerLayout,
      setFullPlayerLayout
    );
  };
  const handleFullPlayerAutoFocusLyrics = () =>
    commitPersistedSetting(
      STORAGE_KEYS.fullPlayerAutoFocusLyrics,
      !fullPlayerAutoFocusLyrics(),
      fullPlayerAutoFocusLyrics,
      setFullPlayerAutoFocusLyrics
    );
  const handleFullPlayerCommentMode = (value: FullPlayerCommentMode) => {
    commitPersistedSetting(
      STORAGE_KEYS.fullPlayerCommentMode,
      value,
      fullPlayerCommentMode,
      setFullPlayerCommentMode
    );
  };
  const handlePlayerType = (value: PlayerType) => {
    if (commitPersistedSetting(STORAGE_KEYS.playerType, value, playerType, setPlayerType)) {
      persist(STORAGE_KEYS.fullPlayerCoverMode, value === "record" ? "record" : "normal");
    }
  };
  const handlePlayerStyleRatio = (value: number) => {
    commitPersistedSetting(STORAGE_KEYS.playerStyleRatio, value, playerStyleRatio, setPlayerStyleRatio);
  };
  const handlePlayerFullscreenGradient = (value: number) => {
    commitPersistedSetting(
      STORAGE_KEYS.playerFullscreenGradient,
      value,
      playerFullscreenGradient,
      setPlayerFullscreenGradient
    );
  };
  const handlePlayerBackgroundType = (value: PlayerBackgroundType) => {
    commitPersistedSetting(
      STORAGE_KEYS.playerBackgroundType,
      value,
      playerBackgroundType,
      setPlayerBackgroundType
    );
  };
  const handlePlayerBackgroundFps = (value: number) => {
    commitPersistedSetting(
      STORAGE_KEYS.playerBackgroundFps,
      value,
      playerBackgroundFps,
      setPlayerBackgroundFps
    );
  };
  const handlePlayerBackgroundFlowSpeed = (value: number) => {
    commitPersistedSetting(
      STORAGE_KEYS.playerBackgroundFlowSpeed,
      value,
      playerBackgroundFlowSpeed,
      setPlayerBackgroundFlowSpeed
    );
  };
  const handlePlayerBackgroundRenderScale = (value: number) => {
    commitPersistedSetting(
      STORAGE_KEYS.playerBackgroundRenderScale,
      value,
      playerBackgroundRenderScale,
      setPlayerBackgroundRenderScale
    );
  };
  const handlePlayerExpandAnimation = (value: PlayerExpandAnimation) => {
    commitPersistedSetting(
      STORAGE_KEYS.playerExpandAnimation,
      value,
      playerExpandAnimation,
      setPlayerExpandAnimation
    );
  };
  const handlePlayerFollowCoverColor = () =>
    commitPersistedSetting(
      STORAGE_KEYS.playerFollowCoverColor,
      !playerFollowCoverColor(),
      playerFollowCoverColor,
      setPlayerFollowCoverColor
    );
  const handleTimeFormat = (value: PlayerTimeFormat) => {
    commitPersistedSetting(STORAGE_KEYS.timeFormat, value, timeFormat, setTimeFormat);
  };
  const handleToggleAllCovers = () => {
    const nextHidden = !allCoversHidden();
    const nextRecord: HiddenCovers = { ...DEFAULT_HIDDEN_COVERS };
    COVER_DISPLAY_ITEMS.forEach((item) => {
      nextRecord[item.key] = nextHidden;
    });
    commitPersistedRecordSetting(STORAGE_KEYS.hiddenCovers, nextRecord, hiddenCovers, setHiddenCovers);
  };

  const toggleBool = (key: string, value: Accessor<boolean>, setValue: Setter<boolean>) => {
    commitPersistedSetting(key, !value(), value, setValue);
  };

  const updateBoolRecord = <T extends Record<string, boolean>, K extends keyof T>(
    storageKey: string,
    record: Accessor<T>,
    field: K,
    next: boolean,
    setValue: Setter<T>
  ) => {
    const current = record();
    const nextRecord = { ...current, [field]: next };
    commitPersistedRecordSetting(storageKey, nextRecord, record, setValue);
  };

  return {
    themeMode,
    bgEnabled,
    bgBlur,
    bgMask,
    customChrome,
    routeAnimation,
    fullPlayerLayout,
    fullPlayerAutoFocusLyrics,
    fullPlayerCommentMode,
    playerType,
    playerStyleRatio,
    playerFullscreenGradient,
    playerBackgroundType,
    playerBackgroundFps,
    playerBackgroundFlowSpeed,
    playerBackgroundRenderScale,
    playerBackgroundPause,
    playerBackgroundLowFreqVolume,
    playerExpandAnimation,
    playerFollowCoverColor,
    sidebarHiddenItems,
    playlistPageElements,
    contextMenuOptions,
    hiddenCovers,
    menuShowCover,
    autoHidePlayerMeta,
    showPlayMeta,
    countDownShow,
    showSpectrums,
    showPlaylistCount,
    barLyricShow,
    showSongQuality,
    showSongPrivilegeTag,
    showSongExplicitTag,
    showSongOriginalTag,
    showSongAlbum,
    showSongDuration,
    showSongOperations,
    showSongArtist,
    hideBracketedContent,
    showPlayerQuality,
    timeFormat,
    fullPlayerShowLike,
    fullPlayerShowAddToPlaylist,
    fullPlayerShowDownload,
    fullPlayerShowComments,
    fullPlayerShowDesktopLyric,
    fullPlayerShowMoreSettings,
    fullPlayerShowCommentCount,
    allCoversHidden,
    setBgBlur,
    setBgMask,
    setPlayerStyleRatio,
    setPlayerFullscreenGradient,
    setPlayerBackgroundFps,
    setPlayerBackgroundFlowSpeed,
    setPlayerBackgroundRenderScale,
    handleThemeChange,
    handleRouteAnimation,
    handleBgToggle,
    handleBgBlur,
    handleBgMask,
    handleCustomChrome,
    handleFullPlayerLayout,
    handleFullPlayerAutoFocusLyrics,
    handleFullPlayerCommentMode,
    handlePlayerType,
    handlePlayerStyleRatio,
    handlePlayerFullscreenGradient,
    handlePlayerBackgroundType,
    handlePlayerBackgroundFps,
    handlePlayerBackgroundFlowSpeed,
    handlePlayerBackgroundRenderScale,
    handlePlayerExpandAnimation,
    handlePlayerFollowCoverColor,
    handleTimeFormat,
    handleToggleAllCovers,
    toggleBool,
    updateBoolRecord,
    setSidebarHiddenItems,
    setPlaylistPageElements,
    setContextMenuOptions,
    setHiddenCovers,
    setMenuShowCover,
    setAutoHidePlayerMeta,
    setShowPlayMeta,
    setCountDownShow,
    setShowSpectrums,
    setShowPlaylistCount,
    setBarLyricShow,
    setShowSongQuality,
    setShowSongPrivilegeTag,
    setShowSongExplicitTag,
    setShowSongOriginalTag,
    setShowSongAlbum,
    setShowSongDuration,
    setShowSongOperations,
    setShowSongArtist,
    setHideBracketedContent,
    setShowPlayerQuality,
    setPlayerBackgroundPause,
    setPlayerBackgroundLowFreqVolume,
    setFullPlayerShowLike,
    setFullPlayerShowAddToPlaylist,
    setFullPlayerShowDownload,
    setFullPlayerShowComments,
    setFullPlayerShowDesktopLyric,
    setFullPlayerShowMoreSettings,
    setFullPlayerShowCommentCount
  };
}

export type AppearanceSettings = ReturnType<typeof useAppearanceSettings>;

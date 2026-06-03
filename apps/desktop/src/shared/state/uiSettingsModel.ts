export type HomeSectionKey = "dailyPicks" | "playlists" | "radar" | "artists" | "mvs" | "podcasts" | "albums";

export type ThemeMode = "dark" | "light" | "auto";

export type GlobalFont = "default" | "system" | "serif" | "mono" | "custom";

export type RouteAnimation = "none" | "fade" | "zoom" | "slide" | "up" | "flow" | "mask-left" | "mask-top";

export type CloseAppMethod = "hide" | "exit";

export type UpdateChannel = "stable" | "nightly";

export type ShareUrlFormat = "web" | "mobile";

export type SearchInputBehavior = "normal" | "clear" | "sync";

export type FullPlayerCommentMode = "fullscreen" | "half-left" | "half-right";

export type FullPlayerCoverMode = "normal" | "record";

export type PlayerTimeFormat = "current-total" | "remaining-total" | "current-remaining";

export type PlayerType = "cover" | "record" | "fullscreen";

export type PlayerBackgroundType = "animation" | "blur" | "color";

export type PlayerExpandAnimation = "up" | "flow";

export type LyricsPosition = "flex-start" | "center" | "flex-end";

export type LyricsBlendMode = "screen" | "plus-lighter";

export type LyricPriority = "auto" | "official";

export const NCM_SONG_LEVELS = [
  "standard",
  "higher",
  "exhigh",
  "lossless",
  "hires",
  "jyeffect",
  "sky",
  "jymaster"
] as const;

export type NcmSongLevel = typeof NCM_SONG_LEVELS[number];

export function isNcmSongLevel(value: string): value is NcmSongLevel {
  return (NCM_SONG_LEVELS as readonly string[]).includes(value);
}

export type CoverHiddenKey =
  | "home"
  | "playlist"
  | "toplist"
  | "artist"
  | "new"
  | "personalFM"
  | "player"
  | "list"
  | "artistDetail"
  | "radio"
  | "album"
  | "like"
  | "video"
  | "videoDetail";

export type SidebarHiddenItemKey =
  | "recommend"
  | "discover"
  | "personalFm"
  | "radio"
  | "likedSongs"
  | "liked"
  | "cloud"
  | "download"
  | "streaming"
  | "library"
  | "recent"
  | "createdPlaylists"
  | "collectedPlaylists"
  | "heartbeatMode";

export type PlaylistPageElementKey = "tags" | "creator" | "time" | "description";

export type ContextMenuOptionKey =
  | "play"
  | "playNext"
  | "addToPlaylist"
  | "mv"
  | "dislike"
  | "more"
  | "cloudImport"
  | "search"
  | "copyName"
  | "wiki"
  | "download"
  | "openFolder"
  | "deleteFromPlaylist"
  | "deleteFromCloud"
  | "cloudMatch"
  | "deleteFromLibrary"
  | "deleteFromLocal"
  | "musicTagEditor"
  | "delete";

export type HiddenCovers = Record<CoverHiddenKey, boolean>;

export type SidebarHiddenItems = Record<SidebarHiddenItemKey, boolean>;

export type PlaylistPageElements = Record<PlaylistPageElementKey, boolean>;

export type ContextMenuOptions = Record<ContextMenuOptionKey, boolean>;

export interface HomeSectionConfig {
  key: HomeSectionKey;
  order: number;
  visible: boolean;
}

export interface UISettings {
  useOnlineService: boolean;
  closeAppMethod: CloseAppMethod;
  showCloseAppTip: boolean;
  showTaskbarProgress: boolean;
  checkUpdateOnStart: boolean;
  updateChannel: UpdateChannel;
  showSearchHistory: boolean;
  showHotSearch: boolean;
  enableSearchKeyword: boolean;
  searchInputBehavior: SearchInputBehavior;
  shareUrlFormat: ShareUrlFormat;
  bgEnabled: boolean;
  bgBlur: number;
  bgMask: number;
  customChrome: boolean;
  fullPlayerLayout: "balanced" | "lyrics";
  fullPlayerAutoFocusLyrics: boolean;
  fullPlayerCommentMode: FullPlayerCommentMode;
  fullPlayerCoverMode: FullPlayerCoverMode;
  playerType: PlayerType;
  playerStyleRatio: number;
  playerFullscreenGradient: number;
  playerBackgroundType: PlayerBackgroundType;
  playerBackgroundFps: number;
  playerBackgroundFlowSpeed: number;
  playerBackgroundRenderScale: number;
  playerBackgroundPause: boolean;
  playerBackgroundLowFreqVolume: boolean;
  playerExpandAnimation: PlayerExpandAnimation;
  dynamicCover: boolean;
  playerFollowCoverColor: boolean;
  hiddenCovers: HiddenCovers;
  sidebarHiddenItems: SidebarHiddenItems;
  playlistPageElements: PlaylistPageElements;
  contextMenuOptions: ContextMenuOptions;
  customAccentColor: string;
  themeFollowCover: boolean;
  themeGlobalColor: boolean;
  globalFont: GlobalFont;
  customFontFamily: string;
  customCss: string;
  customJs: string;
  menuShowCover: boolean;
  fullPlayerShowAddToPlaylist: boolean;
  fullPlayerShowCommentCount: boolean;
  fullPlayerShowComments: boolean;
  fullPlayerShowCopyLyric: boolean;
  fullPlayerShowDesktopLyric: boolean;
  fullPlayerShowDownload: boolean;
  fullPlayerShowLike: boolean;
  fullPlayerShowLyricOffset: boolean;
  fullPlayerShowLyricSettings: boolean;
  fullPlayerShowMoreSettings: boolean;
  autoHidePlayerMeta: boolean;
  showPlayMeta: boolean;
  countDownShow: boolean;
  showSpectrums: boolean;
  homeSections: HomeSectionConfig[];
  showHomeGreeting: boolean;
  themeMode: ThemeMode;
  ncmSongLevel: NcmSongLevel;
  autoPlay: boolean;
  volumeFade: boolean;
  volumeFadeTime: number;
  memoryLastSeek: boolean;
  localLyricDirectories: string[];
  lyricPriority: LyricPriority;
  progressTooltipShow: boolean;
  progressLyricShow: boolean;
  progressAdjustLyric: boolean;
  lyricFontSize: number;
  lyricFontWeight: number;
  showLyricTranslation: boolean;
  showLyricRomanization: boolean;
  showWordLyrics: boolean;
  lyricsBlur: boolean;
  lyricsScrollOffset: number;
  routeAnimation: RouteAnimation;
  showPlaylistCount: boolean;
  barLyricShow: boolean;
  showSongQuality: boolean;
  showSongPrivilegeTag: boolean;
  showSongExplicitTag: boolean;
  showSongOriginalTag: boolean;
  showSongAlbum: boolean;
  showSongDuration: boolean;
  showSongOperations: boolean;
  showSongArtist: boolean;
  hideBracketedContent: boolean;
  showPlayerQuality: boolean;
  timeFormat: PlayerTimeFormat;
  lyricTranslationFontSize: number;
  lyricRomanizationFontSize: number;
  swapLyricTranslationRomanization: boolean;
  lyricsPosition: LyricsPosition;
  lyricHorizontalOffset: number;
  lyricAlignRight: boolean;
  lyricsBlendMode: LyricsBlendMode;
}

export const DEFAULT_HOME_SECTIONS: HomeSectionConfig[] = [
  { key: "dailyPicks", order: 0, visible: true },
  { key: "playlists", order: 1, visible: true },
  { key: "radar", order: 2, visible: true },
  { key: "artists", order: 3, visible: true },
  { key: "mvs", order: 4, visible: true },
  { key: "podcasts", order: 5, visible: true },
  { key: "albums", order: 6, visible: true }
];

export const DEFAULT_HIDDEN_COVERS: HiddenCovers = {
  home: false,
  playlist: false,
  toplist: false,
  artist: false,
  new: false,
  personalFM: false,
  player: false,
  list: false,
  artistDetail: false,
  radio: false,
  album: false,
  like: false,
  video: false,
  videoDetail: false
};

export const DEFAULT_SIDEBAR_HIDDEN_ITEMS: SidebarHiddenItems = {
  recommend: false,
  discover: false,
  personalFm: false,
  radio: false,
  likedSongs: false,
  liked: false,
  cloud: false,
  download: false,
  streaming: false,
  library: false,
  recent: false,
  createdPlaylists: false,
  collectedPlaylists: false,
  heartbeatMode: false
};

export const DEFAULT_PLAYLIST_PAGE_ELEMENTS: PlaylistPageElements = {
  tags: true,
  creator: true,
  time: true,
  description: true
};

export const DEFAULT_CONTEXT_MENU_OPTIONS: ContextMenuOptions = {
  play: true,
  playNext: true,
  addToPlaylist: true,
  mv: true,
  dislike: true,
  more: true,
  cloudImport: true,
  search: true,
  copyName: true,
  wiki: true,
  download: true,
  openFolder: true,
  deleteFromPlaylist: true,
  deleteFromCloud: true,
  cloudMatch: true,
  deleteFromLibrary: true,
  deleteFromLocal: true,
  musicTagEditor: true,
  delete: true
};

export type UISettingsFieldName = keyof UISettings;

export type UISettingsScalarFieldName = {
  [K in UISettingsFieldName]: UISettings[K] extends boolean | number | string ? K : never;
}[UISettingsFieldName];

export type UISettingsBooleanFieldName = {
  [K in UISettingsFieldName]: UISettings[K] extends boolean ? K : never;
}[UISettingsFieldName];

export type UISettingsBooleanRecordFieldName = {
  [K in UISettingsFieldName]: UISettings[K] extends Record<string, boolean> ? K : never;
}[UISettingsFieldName];

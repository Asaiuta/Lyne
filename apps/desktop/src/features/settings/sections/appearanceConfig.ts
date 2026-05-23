import type { TranslationKey } from "../../../shared/i18n";
import type {
  ContextMenuOptions,
  HiddenCovers,
  PlaylistPageElements,
  RouteAnimation,
  SidebarHiddenItems
} from "../../../shared/state/useUISettings";

export interface ToggleConfig<Key extends string> {
  key: Key;
  itemId: string;
  labelKey: TranslationKey;
  descriptionKey?: TranslationKey;
}

export type AppearanceSubPanel =
  | "themeConfig"
  | "fontConfig"
  | "customCode"
  | "sidebar"
  | "homeSections"
  | "playlistPage"
  | "fullPlayerElements"
  | "contextMenu"
  | "cover";

export interface ManagerConfig {
  panel: AppearanceSubPanel;
  itemId: string;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
}

export const ROUTE_ANIMATIONS: readonly { value: RouteAnimation; i18nKey: TranslationKey }[] = [
  { value: "none", i18nKey: "settings.appearance.routeAnimation.none" },
  { value: "fade", i18nKey: "settings.appearance.routeAnimation.fade" },
  { value: "zoom", i18nKey: "settings.appearance.routeAnimation.zoom" },
  { value: "slide", i18nKey: "settings.appearance.routeAnimation.slide" },
  { value: "up", i18nKey: "settings.appearance.routeAnimation.up" },
  { value: "flow", i18nKey: "settings.appearance.routeAnimation.flow" },
  { value: "mask-left", i18nKey: "settings.appearance.routeAnimation.maskLeft" },
  { value: "mask-top", i18nKey: "settings.appearance.routeAnimation.maskTop" }
];

export const SIDEBAR_VISIBILITY_ITEMS: readonly ToggleConfig<keyof SidebarHiddenItems>[] = [
  { key: "recommend", itemId: "sidebarHiddenItems.recommend", labelKey: "settings.appearance.sidebar.recommend" },
  { key: "discover", itemId: "sidebarHiddenItems.discover", labelKey: "settings.appearance.sidebar.discover" },
  { key: "personalFm", itemId: "sidebarHiddenItems.personalFm", labelKey: "settings.appearance.sidebar.personalFm" },
  { key: "radio", itemId: "sidebarHiddenItems.radio", labelKey: "settings.appearance.sidebar.radio" },
  { key: "likedSongs", itemId: "sidebarHiddenItems.likedSongs", labelKey: "settings.appearance.sidebar.likedSongs" },
  { key: "liked", itemId: "sidebarHiddenItems.liked", labelKey: "settings.appearance.sidebar.liked" },
  { key: "cloud", itemId: "sidebarHiddenItems.cloud", labelKey: "settings.appearance.sidebar.cloud" },
  { key: "download", itemId: "sidebarHiddenItems.download", labelKey: "settings.appearance.sidebar.download" },
  { key: "streaming", itemId: "sidebarHiddenItems.streaming", labelKey: "settings.appearance.sidebar.streaming" },
  { key: "library", itemId: "sidebarHiddenItems.library", labelKey: "settings.appearance.sidebar.library" },
  { key: "recent", itemId: "sidebarHiddenItems.recent", labelKey: "settings.appearance.sidebar.recent" },
  { key: "createdPlaylists", itemId: "sidebarHiddenItems.createdPlaylists", labelKey: "settings.appearance.sidebar.createdPlaylists" },
  { key: "collectedPlaylists", itemId: "sidebarHiddenItems.collectedPlaylists", labelKey: "settings.appearance.sidebar.collectedPlaylists" },
  { key: "heartbeatMode", itemId: "sidebarHiddenItems.heartbeatMode", labelKey: "settings.appearance.sidebar.heartbeatMode" }
];

export const PLAYLIST_PAGE_ITEMS: readonly ToggleConfig<keyof PlaylistPageElements>[] = [
  { key: "tags", itemId: "playlistPageElements.tags", labelKey: "settings.appearance.playlistPage.tags" },
  { key: "creator", itemId: "playlistPageElements.creator", labelKey: "settings.appearance.playlistPage.creator" },
  { key: "time", itemId: "playlistPageElements.time", labelKey: "settings.appearance.playlistPage.time" },
  { key: "description", itemId: "playlistPageElements.description", labelKey: "settings.appearance.playlistPage.description" }
];

export const CONTEXT_MENU_ITEMS: readonly ToggleConfig<keyof ContextMenuOptions>[] = [
  { key: "play", itemId: "contextMenuOptions.play", labelKey: "settings.appearance.contextMenu.play" },
  { key: "playNext", itemId: "contextMenuOptions.playNext", labelKey: "settings.appearance.contextMenu.playNext" },
  { key: "addToPlaylist", itemId: "contextMenuOptions.addToPlaylist", labelKey: "settings.appearance.contextMenu.addToPlaylist" },
  { key: "dislike", itemId: "contextMenuOptions.dislike", labelKey: "settings.appearance.contextMenu.dislike" },
  { key: "more", itemId: "contextMenuOptions.more", labelKey: "settings.appearance.contextMenu.more" },
  { key: "search", itemId: "contextMenuOptions.search", labelKey: "settings.appearance.contextMenu.search" },
  { key: "copyName", itemId: "contextMenuOptions.copyName", labelKey: "settings.appearance.contextMenu.copyName" },
  { key: "openFolder", itemId: "contextMenuOptions.openFolder", labelKey: "settings.appearance.contextMenu.openFolder" },
  { key: "deleteFromPlaylist", itemId: "contextMenuOptions.deleteFromPlaylist", labelKey: "settings.appearance.contextMenu.deleteFromPlaylist" },
  { key: "deleteFromCloud", itemId: "contextMenuOptions.deleteFromCloud", labelKey: "settings.appearance.contextMenu.deleteFromCloud" },
  { key: "cloudMatch", itemId: "contextMenuOptions.cloudMatch", labelKey: "settings.appearance.contextMenu.cloudMatch" },
  { key: "deleteFromLibrary", itemId: "contextMenuOptions.deleteFromLibrary", labelKey: "settings.appearance.contextMenu.deleteFromLibrary" }
];

export const COVER_DISPLAY_ITEMS: readonly ToggleConfig<keyof HiddenCovers>[] = [
  { key: "home", itemId: "hiddenCovers.home", labelKey: "settings.appearance.cover.home" },
  { key: "playlist", itemId: "hiddenCovers.playlist", labelKey: "settings.appearance.cover.playlist" },
  { key: "toplist", itemId: "hiddenCovers.toplist", labelKey: "settings.appearance.cover.toplist" },
  { key: "artist", itemId: "hiddenCovers.artist", labelKey: "settings.appearance.cover.artist" },
  { key: "new", itemId: "hiddenCovers.new", labelKey: "settings.appearance.cover.new" },
  { key: "personalFM", itemId: "hiddenCovers.personalFM", labelKey: "settings.appearance.cover.personalFM" },
  { key: "player", itemId: "hiddenCovers.player", labelKey: "settings.appearance.cover.player" },
  { key: "list", itemId: "hiddenCovers.list", labelKey: "settings.appearance.cover.list" },
  { key: "artistDetail", itemId: "hiddenCovers.artistDetail", labelKey: "settings.appearance.cover.artistDetail" },
  { key: "radio", itemId: "hiddenCovers.radio", labelKey: "settings.appearance.cover.radio" },
  { key: "album", itemId: "hiddenCovers.album", labelKey: "settings.appearance.cover.album" },
  { key: "like", itemId: "hiddenCovers.like", labelKey: "settings.appearance.cover.like" },
  { key: "video", itemId: "hiddenCovers.video", labelKey: "settings.appearance.cover.video" },
  { key: "videoDetail", itemId: "hiddenCovers.videoDetail", labelKey: "settings.appearance.cover.videoDetail" }
];

export const LAYOUT_MANAGER_ITEMS: readonly ManagerConfig[] = [
  {
    panel: "sidebar",
    itemId: "sidebarHiddenItems",
    labelKey: "settings.appearance.sidebarManager",
    descriptionKey: "settings.appearance.sidebarManager.desc"
  },
  {
    panel: "homeSections",
    itemId: "homeSections",
    labelKey: "settings.general.homeSections.title",
    descriptionKey: "settings.general.homeSections.desc"
  },
  {
    panel: "playlistPage",
    itemId: "playlistPageElements",
    labelKey: "settings.appearance.playlistPageManager",
    descriptionKey: "settings.appearance.playlistPageManager.desc"
  },
  {
    panel: "fullPlayerElements",
    itemId: "fullPlayerElements",
    labelKey: "settings.appearance.fullPlayerManager",
    descriptionKey: "settings.appearance.fullPlayerManager.desc"
  },
  {
    panel: "contextMenu",
    itemId: "contextMenuOptions",
    labelKey: "settings.appearance.contextMenuManager",
    descriptionKey: "settings.appearance.contextMenuManager.desc"
  }
];

export const THEME_MANAGER_ITEMS: readonly ManagerConfig[] = [
  {
    panel: "themeConfig",
    itemId: "themeConfig",
    labelKey: "settings.appearance.themeConfig",
    descriptionKey: "settings.appearance.themeConfig.desc"
  },
  {
    panel: "fontConfig",
    itemId: "fontConfig",
    labelKey: "settings.appearance.fontConfig",
    descriptionKey: "settings.appearance.fontConfig.desc"
  },
  {
    panel: "customCode",
    itemId: "customCode",
    labelKey: "settings.appearance.customCode",
    descriptionKey: "settings.appearance.customCode.desc"
  }
];

export const COVER_MANAGER_ITEM: ManagerConfig = {
  panel: "cover",
  itemId: "coverManager",
  labelKey: "settings.appearance.coverManager",
  descriptionKey: "settings.appearance.coverManager.desc"
};

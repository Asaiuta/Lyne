export const ACTIVE_PAGES = [
  "recommend",
  "discover",
  "search",
  "album-detail",
  "playlist-detail",
  "daily-songs",
  "artist-detail",
  "video-detail",
  "personal-fm",
  "radio",
  "radio-detail",
  "liked-songs",
  "liked",
  "cloud",
  "song-wiki",
  "download",
  "streaming",
  "library",
  "recent",
  "created-playlists",
  "collected-playlists"
] as const;

export type ActivePage = (typeof ACTIVE_PAGES)[number];

export const LIBRARY_TABS = [
  "songs",
  "artists",
  "albums",
  "playlists",
  "folders"
] as const;

export type LibraryTab = (typeof LIBRARY_TABS)[number];

export type LibraryDestination =
  | { readonly kind: "tab"; readonly tab: LibraryTab }
  | { readonly kind: "playlist"; readonly playlistId: string };

export interface NavigationLocation {
  readonly page: ActivePage;
  readonly libraryDestination: LibraryDestination;
}

export const DEFAULT_LIBRARY_DESTINATION: LibraryDestination = {
  kind: "tab",
  tab: "songs"
};

export const PLAYLIST_PAGES = ["created-playlists", "collected-playlists"] as const;

export type PlaylistPage = (typeof PLAYLIST_PAGES)[number];

export const DISCOVER_TABS = ["playlists", "toplists", "artists", "new"] as const;

export type DiscoverTab = (typeof DISCOVER_TABS)[number];

export const DEFAULT_DISCOVER_TAB: DiscoverTab = "playlists";

export const SEARCH_ENABLED_PAGES = ACTIVE_PAGES;

export const PLACEHOLDER_PAGES = [] as const satisfies readonly ActivePage[];

export const ONLINE_ONLY_PAGES = [
  "recommend",
  "discover",
  "search",
  "album-detail",
  "playlist-detail",
  "daily-songs",
  "artist-detail",
  "video-detail",
  "personal-fm",
  "radio",
  "radio-detail",
  "liked-songs",
  "liked",
  "cloud",
  "streaming",
  "song-wiki",
  "created-playlists",
  "collected-playlists"
] as const;

export const LOCAL_FALLBACK_PAGE: ActivePage = "library";

export const isPlaylistPage = (page: ActivePage): page is PlaylistPage =>
  (PLAYLIST_PAGES as readonly ActivePage[]).includes(page);

export const isLibraryTab = (value: unknown): value is LibraryTab =>
  typeof value === "string" && (LIBRARY_TABS as readonly string[]).includes(value);

export const normalizeLibraryDestination = (value: unknown): LibraryDestination => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_LIBRARY_DESTINATION;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "tab" && isLibraryTab(candidate.tab)) {
    return { kind: "tab", tab: candidate.tab };
  }
  if (candidate.kind === "playlist" && typeof candidate.playlistId === "string") {
    const playlistId = candidate.playlistId.trim();
    if (playlistId.length > 0) {
      return { kind: "playlist", playlistId };
    }
  }
  return DEFAULT_LIBRARY_DESTINATION;
};

export const libraryDestinationToTab = (destination: LibraryDestination): LibraryTab =>
  destination.kind === "playlist" ? "playlists" : destination.tab;

export const libraryDestinationMotionKey = (
  destination: LibraryDestination
): string =>
  destination.kind === "playlist"
    ? `playlist:${destination.playlistId}`
    : `tab:${destination.tab}`;

export const libraryDestinationsEqual = (
  left: LibraryDestination,
  right: LibraryDestination
): boolean =>
  left.kind === right.kind &&
  (left.kind === "tab"
    ? right.kind === "tab" && left.tab === right.tab
    : right.kind === "playlist" && left.playlistId === right.playlistId);

export const normalizeOfflineLibraryDestination = (
  destination: LibraryDestination
): LibraryDestination =>
  destination.kind === "tab" && destination.tab === "playlists"
    ? DEFAULT_LIBRARY_DESTINATION
    : destination;

export const isDiscoverTab = (tab: string | undefined): tab is DiscoverTab =>
  tab !== undefined && (DISCOVER_TABS as readonly string[]).includes(tab);

export const normalizeDiscoverTab = (tab: unknown): DiscoverTab =>
  typeof tab === "string" && isDiscoverTab(tab) ? tab : DEFAULT_DISCOVER_TAB;

export const isSearchEnabledPage = (page: ActivePage): boolean =>
  (SEARCH_ENABLED_PAGES as readonly ActivePage[]).includes(page);

export const isPlaceholderPage = (page: ActivePage): boolean =>
  (PLACEHOLDER_PAGES as readonly ActivePage[]).includes(page);

export const isOnlineOnlyPage = (page: ActivePage): boolean =>
  (ONLINE_ONLY_PAGES as readonly ActivePage[]).includes(page);

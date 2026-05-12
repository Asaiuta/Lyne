export const ACTIVE_PAGES = [
  "recommend",
  "discover",
  "personal-fm",
  "radio",
  "liked-songs",
  "liked",
  "cloud",
  "download",
  "streaming",
  "library",
  "recent",
  "created-playlists",
  "collected-playlists"
] as const;

export type ActivePage = (typeof ACTIVE_PAGES)[number];

export const PLAYLIST_PAGES = ["created-playlists", "collected-playlists"] as const;

export type PlaylistPage = (typeof PLAYLIST_PAGES)[number];

export const SEARCH_ENABLED_PAGES = ["recommend", "discover", "library"] as const;

export const PLACEHOLDER_PAGES = [
  "personal-fm",
  "download",
  "streaming"
] as const;

export const isPlaylistPage = (page: ActivePage): page is PlaylistPage =>
  (PLAYLIST_PAGES as readonly ActivePage[]).includes(page);

export const isSearchEnabledPage = (page: ActivePage): boolean =>
  (SEARCH_ENABLED_PAGES as readonly ActivePage[]).includes(page);

export const isPlaceholderPage = (page: ActivePage): boolean =>
  (PLACEHOLDER_PAGES as readonly ActivePage[]).includes(page);

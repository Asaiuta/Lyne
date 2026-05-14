import type { LyricLine } from "./lyrics";
import type { PlayerState, QueueEntry } from "./types";

export interface ResolveNcmTrackInput {
  songId: number;
  level?: string | null;
  sourcePageUrl: string;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  durationSecs?: number | null;
  artworkUrl?: string | null;
}

export interface ResolvedNcmTrack {
  songId: number;
  streamUrl: string;
  sourcePageUrl: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  coverUrl: string | null;
  durationSecs: number | null;
}

export interface NcmTrackPlaybackResult {
  track: ResolvedNcmTrack;
  state: PlayerState;
}

export interface NcmTrackQueueResult {
  track: ResolvedNcmTrack;
  queue: QueueEntry[];
}

export interface ResolvedNcmTrackSupplement {
  songId: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  coverUrl: string | null;
  lyrics: LyricLine[];
  detailError: string | null;
  lyricsError: string | null;
}

export interface NcmAccountSummary {
  userId: number;
  nickname: string | null;
  avatarUrl: string | null;
  hasCookie: boolean;
  vipType: number | null;
  level: number | null;
  signinAt: number | null;
  addedAt: number;
  refreshedAt: number;
}

export interface NcmAccountState {
  accounts: NcmAccountSummary[];
  activeUserId: number | null;
}

export interface NcmAccountUpsertInput {
  userId: number;
  nickname?: string | null;
  avatarUrl?: string | null;
  cookie: string;
  vipType?: number | null;
  level?: number | null;
  signinAt?: number | null;
}

export type NcmUserPlaylistMode = "created-playlists" | "collected-playlists";

export interface ListNcmUserPlaylistsInput {
  uid: number;
  limit?: number;
  offset?: number;
  mode?: NcmUserPlaylistMode;
}

export interface NcmPlaylistSummary {
  id: number;
  name: string;
  creator: string | null;
  coverUrl: string | null;
  trackCount: number | null;
  subscribed: boolean;
}

export interface SearchNcmTracksInput {
  keywords: string;
  limit?: number;
  offset?: number;
}

export interface ListNcmPlaylistTracksInput {
  id: number;
  limit?: number;
  offset?: number;
}

export interface NcmTrackSummary {
  id: string;
  songId: number;
  source_path: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  duration_secs: number | null;
  artworkUrl: string | null;
  size_bytes?: number | null;
}

export interface ListNcmCloudTracksInput {
  limit?: number;
  offset?: number;
}

export interface NcmCloudTracksPage {
  tracks: NcmTrackSummary[];
  count: number;
  sizeBytes: number;
  maxSizeBytes: number;
}

export interface GetNcmHomeFeedInput {
  userId?: number | null;
}

export interface NcmHomeFeedCard {
  id: number;
  title: string;
  subtitle: string | null;
  coverUrl: string | null;
  playCount: number | null;
  description: string | null;
}

export interface NcmHomeTrackCover {
  id: number;
  url: string | null;
}

export interface NcmHomePersonalFmPreview {
  title: string;
  artist: string | null;
  album: string | null;
  coverUrl: string | null;
}

export interface NcmHomeFeedError {
  section: string;
  message: string;
}

export interface NcmHomeFeed {
  dailyPicks: NcmHomeFeedCard[];
  dailySongCovers: NcmHomeTrackCover[];
  likedSongCovers: NcmHomeTrackCover[];
  personalFmCovers: NcmHomeTrackCover[];
  personalFmPreview: NcmHomePersonalFmPreview | null;
  radarPlaylists: NcmHomeFeedCard[];
  recommendedPlaylists: NcmHomeFeedCard[];
  newAlbums: NcmHomeFeedCard[];
  featuredArtists: NcmHomeFeedCard[];
  recommendedMvs: NcmHomeFeedCard[];
  podcasts: NcmHomeFeedCard[];
  errors: NcmHomeFeedError[];
}

export type NcmDiscoverPlaylistKind = "normal" | "hq";
export type NcmDiscoverAlbumArea = "ALL" | "ZH" | "EA" | "KR" | "JP";
export type NcmDiscoverSongType = 0 | 7 | 96 | 16 | 8;

export interface ListNcmDiscoverPlaylistsInput {
  cat: string;
  kind: NcmDiscoverPlaylistKind;
  limit?: number;
  offset?: number;
  before?: number | null;
}

export interface ListNcmDiscoverAlbumsInput {
  area: NcmDiscoverAlbumArea;
  limit?: number;
  offset?: number;
}

export interface ListNcmDiscoverArtistsInput {
  type: number;
  area: number;
  initial: number | string;
  limit?: number;
  offset?: number;
}

export interface ListNcmDiscoverSongsInput {
  type: NcmDiscoverSongType;
}

export interface NcmDiscoverCard {
  id: number;
  title: string;
  subtitle: string | null;
  coverUrl: string | null;
  cursor: number | null;
}

export interface NcmDiscoverCardsPage {
  items: NcmDiscoverCard[];
  hasMore: boolean;
}

export interface NcmDiscoverToplistTrack {
  title: string;
  artist: string | null;
}

export interface NcmDiscoverToplist extends NcmDiscoverCard {
  description: string | null;
  tracks: NcmDiscoverToplistTrack[];
  isOfficial: boolean;
}

export interface NcmDiscoverPlaylistCategoryEntry {
  name: string;
  category: number;
  hot: boolean;
}

export interface NcmDiscoverPlaylistCategories {
  categories: Record<number, string>;
  entries: NcmDiscoverPlaylistCategoryEntry[];
  hqNames: string[];
}

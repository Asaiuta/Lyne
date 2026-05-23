import type { TranslationKey } from "../../../shared/i18n";
import type { MediaListItem } from "../../../components/media/MediaList";

export type NeteasePageMode =
  | "recommend"
  | "discover"
  | "liked-songs"
  | "liked"
  | "created-playlists"
  | "collected-playlists";
export type SearchTab = "songs" | "playlists" | "artists" | "albums" | "videos" | "radios";
export type DiscoverTab = "playlists" | "toplists" | "artists" | "new" | "mvs";
export type DiscoverPlaylistKind = "normal" | "hq";
export type DiscoverNewKind = "albums" | "songs";

export interface DiscoverArtistInitial {
  key: number | string;
  label: TranslationKey | string;
}

export interface DiscoverArtistArea {
  labelKey: TranslationKey;
  type: number;
  area: number;
}

export interface DiscoverNewArea {
  labelKey: TranslationKey;
  albumArea: "ALL" | "ZH" | "EA" | "KR" | "JP";
  songType: 0 | 7 | 96 | 16 | 8;
}

export interface DiscoverMvFilter<T extends string = string> {
  labelKey: TranslationKey;
  value: T;
}

export interface NcmProfile {
  userId: number;
  nickname: string | null;
}

export interface Feedback {
  tone: "neutral" | "success" | "error";
  message: string;
}

export interface OnlineTrackItem extends MediaListItem {
  source_path: string;
  songId: number;
}

export interface DiscoverCardItem {
  id: number;
  title: string;
  subtitle: string | null;
  coverUrl: string | null;
  cursor: number | null;
}

export interface DiscoverToplistTrack {
  title: string;
  artist: string | null;
}

export interface DiscoverToplistItem extends DiscoverCardItem {
  description: string | null;
  tracks: DiscoverToplistTrack[];
  isOfficial: boolean;
}

export interface FeedCardItem {
  id: number;
  videoId?: string | null;
  videoKind?: "mv" | "video";
  title: string;
  subtitle: string | null;
  coverUrl: string | null;
  playCount: number | null;
  description: string | null;
}

export interface RadioSubscribeEvent {
  radio: FeedCardItem;
  subscribed: boolean;
  version: number;
}

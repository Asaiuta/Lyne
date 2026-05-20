export interface LibraryListItem {
  id: string;
  trackKey?: number;
  media_id?: string | null;
  source_path?: string | null;
  source_kind?: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  track_number?: number | null;
  disc_number?: number | null;
  genre?: string | null;
  year?: number | null;
  duration_secs: number | null;
  sample_rate?: number | null;
  channels?: number | null;
  bitrate_bps?: number | null;
  bits_per_sample?: number | null;
  has_cover_art?: boolean;
  external_artwork_url?: string | null;
  size_bytes?: number | null;
  updated_at_epoch_secs?: number | null;
  added_at_epoch_secs?: number | null;
  fileName?: string | null;
  qualityLabel?: string | null;
  artworkUrl: string | null;
}

export interface LibraryGroup {
  key: string;
  label: string;
  songs: LibraryListItem[];
  count?: number;
  artworkUrl: string | null;
  detail?: string | undefined;
}

export type LibraryTab = "songs" | "artists" | "albums" | "playlists" | "folders";
export type LibrarySortField =
  | "default"
  | "title"
  | "artist"
  | "album"
  | "trackNumber"
  | "filename"
  | "duration"
  | "size"
  | "createTime"
  | "updatedTime";
export type LibrarySortOrder = "default" | "asc" | "desc";

export interface LibrarySortState {
  field: LibrarySortField;
  order: LibrarySortOrder;
}

export interface LibraryFolderNode {
  key: string;
  label: string;
  totalCount: number;
  directCount: number;
  depth: number;
  children: LibraryFolderNode[];
}

export const ALL_FOLDERS_VALUE = "__all";

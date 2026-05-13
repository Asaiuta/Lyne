import type { LibraryFolderSummary, LibraryTrackSummary } from "../../shared/api/types";

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
  has_cover_art?: boolean;
  external_artwork_url?: string | null;
  size_bytes?: number | null;
  updated_at_epoch_secs?: number | null;
  added_at_epoch_secs?: number | null;
  fileName?: string | null;
  artworkUrl: string | null;
}

export interface LibraryGroup {
  key: string;
  label: string;
  songs: LibraryListItem[];
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

export interface LibraryWorkerFolderGroup {
  key: string;
  label: string;
  path: string;
  count: number;
}

// Visible worker rows intentionally omit source_path. Detail-only actions must fetch by trackKey.
export interface LibraryWorkerRow {
  id: string;
  trackKey: number;
  source_path: null;
  media_id: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  track_number: number | null;
  duration_secs: number | null;
  size_bytes: number | null;
  added_at_epoch_secs: number | null;
  updated_at_epoch_secs: number | null;
  fileName: string;
  artworkUrl: string | null;
  hasCoverArt: boolean;
  externalArtworkUrl: string | null;
}

export interface LibraryWorkerViewInput {
  queries: string[];
  folderKey: string | null;
  sort: LibrarySortState;
}

export interface LibraryWorkerRange {
  start: number;
  end: number;
}

export interface LibraryWorkerInitRequest {
  type: "INIT";
  requestId: number;
  tracks: LibraryTrackSummary[];
  folders: LibraryFolderSummary[];
}

export type LibraryWorkerViewRequest = {
  type: "VIEW";
  requestId: number;
  range: LibraryWorkerRange;
} & LibraryWorkerViewInput;

export type LibraryWorkerTrackKeysRequest = {
  type: "TRACK_KEYS";
  requestId: number;
} & LibraryWorkerViewInput;

export type LibraryWorkerRowsRequest = {
  type: "ROWS";
  requestId: number;
} & LibraryWorkerViewInput;

export type LibraryWorkerRequest =
  | LibraryWorkerInitRequest
  | LibraryWorkerViewRequest
  | LibraryWorkerTrackKeysRequest
  | LibraryWorkerRowsRequest;

export type LibraryWorkerResponse =
  | {
      type: "READY";
      requestId: number;
      total: number;
    }
  | {
      type: "VIEW_RESULT";
      requestId: number;
      rows: LibraryWorkerRow[];
      total: number;
      totalSizeBytes: number;
      folders: LibraryWorkerFolderGroup[];
    }
  | {
      type: "TRACK_KEYS_RESULT";
      requestId: number;
      trackKeys: number[];
    }
  | {
      type: "ROWS_RESULT";
      requestId: number;
      rows: LibraryWorkerRow[];
    };

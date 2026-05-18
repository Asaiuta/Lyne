import type { LibraryFolderSummary, LibraryTrackSummary } from "../../shared/api/types";
import type { LibrarySortState } from "./libraryViewTypes";

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
  media_id: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  track_number: number | null;
  duration_secs: number | null;
  sample_rate: number | null;
  bitrate_bps: number | null;
  bits_per_sample: number | null;
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

export type LibraryWorkerMediaIdsRequest = {
  type: "MEDIA_IDS";
  requestId: number;
} & LibraryWorkerViewInput;

export type LibraryWorkerRowsRequest = {
  type: "ROWS";
  requestId: number;
} & LibraryWorkerViewInput;

export type LibraryWorkerRequest =
  | LibraryWorkerInitRequest
  | LibraryWorkerViewRequest
  | LibraryWorkerMediaIdsRequest
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
      type: "MEDIA_IDS_RESULT";
      requestId: number;
      mediaIds: string[];
    }
  | {
      type: "ROWS_RESULT";
      requestId: number;
      rows: LibraryWorkerRow[];
    };

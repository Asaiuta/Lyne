import type { LibraryFolderSummary, LibraryTrackSummary } from "../../shared/api/types";
import type { LibrarySortState } from "./libraryViewTypes";
import type {
  LibraryWorkerFolderGroup,
  LibraryWorkerRequest,
  LibraryWorkerResponse,
  LibraryWorkerRow
} from "./libraryWorkerProtocol";

interface IndexedTrack {
  summary: LibraryTrackSummary;
  haystack: string;
}

interface ViewSnapshot {
  key: string;
  sortedTracks: IndexedTrack[];
  totalSizeBytes: number;
  folders: LibraryWorkerFolderGroup[];
}

let summaries: IndexedTrack[] = [];
let currentSnapshot: ViewSnapshot | null = null;
let folderByKey = new Map<string, LibraryFolderSummary>();

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const normalizeQuery = (value: string): string => value.trim().toLowerCase();

const normalizePath = (path: string): string =>
  path
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\/i, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();

const pathContainsFolder = (parentFolder: string, childFolder: string): boolean => {
  const parent = normalizePath(parentFolder);
  const child = normalizePath(childFolder);
  return child === parent || child.startsWith(`${parent}/`);
};

const haystackForTrack = (track: LibraryTrackSummary): string =>
  [
    track.title,
    track.artist,
    track.album,
    track.file_name,
    track.folder_label
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n")
    .toLowerCase();

const matchesQueries = (track: IndexedTrack, queries: readonly string[]): boolean => {
  if (queries.length === 0) return true;
  return queries.every((query) => track.haystack.includes(query));
};

const compareText = (left: string | null | undefined, right: string | null | undefined): number =>
  collator.compare(left?.trim() ?? "", right?.trim() ?? "");

const sortTracks = (
  tracks: readonly IndexedTrack[],
  sort: LibrarySortState
): IndexedTrack[] => {
  const copied = [...tracks];
  if (sort.field === "default" || sort.order === "default") {
    return copied;
  }
  const factor = sort.order === "asc" ? 1 : -1;
  copied.sort((left, right) => {
    const leftTrack = left.summary;
    const rightTrack = right.summary;
    let result = 0;
    switch (sort.field) {
      case "title":
        result = compareText(
          leftTrack.title ?? leftTrack.file_name,
          rightTrack.title ?? rightTrack.file_name
        );
        break;
      case "artist":
        result = compareText(leftTrack.artist, rightTrack.artist);
        break;
      case "album":
        result = compareText(leftTrack.album, rightTrack.album);
        break;
      case "trackNumber":
        result = (leftTrack.track_number ?? 0) - (rightTrack.track_number ?? 0);
        break;
      case "filename":
        result = compareText(leftTrack.file_name, rightTrack.file_name);
        break;
      case "duration":
        result = (leftTrack.duration_secs ?? 0) - (rightTrack.duration_secs ?? 0);
        break;
      case "size":
        result = (leftTrack.size_bytes ?? 0) - (rightTrack.size_bytes ?? 0);
        break;
      case "createTime":
        result = (leftTrack.added_at_epoch_secs ?? 0) - (rightTrack.added_at_epoch_secs ?? 0);
        break;
      case "updatedTime":
        result = (leftTrack.updated_at_epoch_secs ?? 0) - (rightTrack.updated_at_epoch_secs ?? 0);
        break;
      case "default":
        result = 0;
        break;
      default: {
        const _exhaustive: never = sort.field;
        throw new Error(`Unhandled library sort field: ${_exhaustive}`);
      }
    }
    return result * factor;
  });
  return copied;
};

const buildFolders = (tracks: readonly IndexedTrack[]): LibraryWorkerFolderGroup[] => {
  const byKey = tracks.reduce<Map<string, LibraryWorkerFolderGroup>>((map, indexed) => {
    const track = indexed.summary;
    const existing = map.get(track.folder_key);
    if (existing) {
      existing.count += 1;
      return map;
    }
    map.set(track.folder_key, {
      key: track.folder_key,
      label: folderByKey.get(track.folder_key)?.label || track.folder_label || track.file_name,
      path: folderByKey.get(track.folder_key)?.path ?? "",
      count: 1
    });
    return map;
  }, new Map<string, LibraryWorkerFolderGroup>());
  return [...byKey.values()].sort((left, right) => collator.compare(left.label, right.label));
};

const rowForTrack = (track: LibraryTrackSummary): LibraryWorkerRow => ({
  id: String(track.track_key),
  trackKey: track.track_key,
  media_id: track.media_id,
  title: track.title ?? track.file_name,
  artist: track.artist,
  album: track.album,
  track_number: track.track_number,
  duration_secs: track.duration_secs,
  sample_rate: track.sample_rate,
  bitrate_bps: track.bitrate_bps,
  bits_per_sample: track.bits_per_sample,
  size_bytes: track.size_bytes,
  added_at_epoch_secs: track.added_at_epoch_secs,
  updated_at_epoch_secs: track.updated_at_epoch_secs,
  fileName: track.file_name,
  artworkUrl: null,
  hasCoverArt: track.has_cover_art,
  externalArtworkUrl: track.external_artwork_url
});

const viewKeyFor = (
  queries: readonly string[],
  folderKey: string | null,
  sort: LibrarySortState
): string => `${queries.join("\u0000")}\u0001${folderKey ?? ""}\u0001${sort.field}:${sort.order}`;

const snapshotForView = (
  queries: readonly string[],
  folderKey: string | null,
  sort: LibrarySortState
): ViewSnapshot => {
  const key = viewKeyFor(queries, folderKey, sort);
  if (currentSnapshot?.key === key) {
    return currentSnapshot;
  }

  const queryFiltered = summaries.filter((track) => matchesQueries(track, queries));
  const folders = buildFolders(queryFiltered);
  const folderFiltered = folderKey
    ? queryFiltered.filter((track) => {
        if (track.summary.folder_key === folderKey) return true;
        const folder = folderByKey.get(track.summary.folder_key);
        return folder ? pathContainsFolder(folderKey, folder.path) : false;
      })
    : queryFiltered;
  const sortedTracks = sortTracks(folderFiltered, sort);
  const totalSizeBytes = folderFiltered.reduce(
    (total, track) => total + (track.summary.size_bytes ?? 0),
    0
  );
  currentSnapshot = {
    key,
    sortedTracks,
    totalSizeBytes,
    folders
  };
  return currentSnapshot;
};

const handleView = (
  message: Extract<LibraryWorkerRequest, { type: "VIEW" }>
): LibraryWorkerResponse => {
  const queries = message.queries.map(normalizeQuery).filter((query) => query.length > 0);
  const snapshot = snapshotForView(queries, message.folderKey, message.sort);
  const start = Math.max(0, Math.min(message.range.start, snapshot.sortedTracks.length));
  const end = Math.max(start, Math.min(message.range.end, snapshot.sortedTracks.length));
  const rows = snapshot.sortedTracks
    .slice(start, end)
    .map((track) => rowForTrack(track.summary));
  return {
    type: "VIEW_RESULT",
    requestId: message.requestId,
    rows,
    total: snapshot.sortedTracks.length,
    totalSizeBytes: snapshot.totalSizeBytes,
    folders: snapshot.folders
  };
};

const handleMediaIds = (
  message: Extract<LibraryWorkerRequest, { type: "MEDIA_IDS" }>
): LibraryWorkerResponse => {
  const queries = message.queries.map(normalizeQuery).filter((query) => query.length > 0);
  const snapshot = snapshotForView(queries, message.folderKey, message.sort);
  return {
    type: "MEDIA_IDS_RESULT",
    requestId: message.requestId,
    mediaIds: snapshot.sortedTracks
      .map((track) => track.summary.media_id)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
  };
};

const handleRows = (
  message: Extract<LibraryWorkerRequest, { type: "ROWS" }>
): LibraryWorkerResponse => {
  const queries = message.queries.map(normalizeQuery).filter((query) => query.length > 0);
  const snapshot = snapshotForView(queries, message.folderKey, message.sort);
  return {
    type: "ROWS_RESULT",
    requestId: message.requestId,
    rows: snapshot.sortedTracks.map((track) => rowForTrack(track.summary))
  };
};

self.onmessage = (event: MessageEvent<LibraryWorkerRequest>) => {
  const message = event.data;
  if (message.type === "INIT") {
    summaries = message.tracks.map((summary) => ({
      summary,
      haystack: haystackForTrack(summary)
    }));
    folderByKey = new Map(message.folders.map((folder) => [folder.key, folder]));
    currentSnapshot = null;
    const response: LibraryWorkerResponse = {
      type: "READY",
      requestId: message.requestId,
      total: summaries.length
    };
    self.postMessage(response);
    return;
  }

  if (message.type === "VIEW") {
    self.postMessage(handleView(message));
    return;
  }

  if (message.type === "MEDIA_IDS") {
    self.postMessage(handleMediaIds(message));
    return;
  }

  self.postMessage(handleRows(message));
};

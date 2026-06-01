import type {
  LibraryFolderSummary,
  LibraryRoot,
  LibraryScanTask,
  LibraryTrackDetail,
  LibraryTrackGroupsResponse,
  LibraryTrackGroupSummary,
  LibraryTrackSummary,
  LibraryTrackViewResponse,
  LibraryTrackSummariesResponse,
  LocalPlaylist,
  LocalPlaylistDetail,
  MediaItem,
  PlayerState,
  QueueEntry,
  ScanResult
} from "./types";
import {
  defineParser,
  isInteger,
  isNullableString,
  isRecord,
  isString
} from "./ncmParserUtils";
import {
  parseLibraryScanTask,
  parseMediaItem,
  parsePlayerState,
  parseQueueEntries,
  parseScanResult
} from "./apiBoundaryParsers";

export interface LibraryQueueMediaIdsInput {
  mediaIds: string[];
  startMediaId?: string | null;
}

export interface LibraryQueuePlaybackResult {
  state: PlayerState;
  queuedCount: number;
}

export interface LibraryTrackViewInput {
  queries: string[];
  folderPath: string | null;
  sort: {
    field: string;
    order: string;
  };
  range?: {
    start: number;
    end: number;
  };
  includeMediaIds?: boolean;
}

export interface LibraryTrackGroupsInput {
  kind: "artists" | "albums";
  queries: string[];
  folderPath: string | null;
  sort: {
    field: string;
    order: string;
  };
  selectedGroupKey?: string | null;
}

export interface ExternalMediaMetadataInput {
  source_path: string;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  duration_secs?: number | null;
  external_artwork_url?: string | null;
}

export interface LocalPlaylistCreateInput {
  name: string;
  description?: string | null;
}

export interface LocalPlaylistUpdateInput {
  name?: string | null;
  description?: string | null;
}

export interface LibraryApiClient {
  getLibraryRoots: () => Promise<LibraryRoot[]>;
  scanLibraryRoot: (path: string, displayName?: string, sourceKey?: string) => Promise<ScanResult>;
  deleteLibraryRoot: (rootId: number) => Promise<void>;
  getLibraryScanTask: (taskId: number) => Promise<LibraryScanTask>;
  getMediaItems: (limit?: number, all?: boolean) => Promise<MediaItem[]>;
  getLibraryTrackSummaries: () => Promise<LibraryTrackSummariesResponse>;
  getLibraryTrackView: (input: LibraryTrackViewInput) => Promise<LibraryTrackViewResponse>;
  getLibraryTrackGroups: (input: LibraryTrackGroupsInput) => Promise<LibraryTrackGroupsResponse>;
  getLibraryTrackDetail: (trackKey: number) => Promise<LibraryTrackDetail>;
  replaceQueueFromMediaIds: (input: LibraryQueueMediaIdsInput) => Promise<LibraryQueuePlaybackResult>;
  enqueueQueueFromMediaIds: (input: LibraryQueueMediaIdsInput) => Promise<QueueEntry[]>;
  deleteMediaItems: (mediaIds: string[]) => Promise<number>;
  listLocalPlaylists: () => Promise<LocalPlaylist[]>;
  createLocalPlaylist: (input: LocalPlaylistCreateInput) => Promise<LocalPlaylist>;
  updateLocalPlaylist: (playlistId: string, input: LocalPlaylistUpdateInput) => Promise<LocalPlaylist>;
  deleteLocalPlaylist: (playlistId: string) => Promise<void>;
  getLocalPlaylist: (playlistId: string) => Promise<LocalPlaylistDetail>;
  addMediaToLocalPlaylist: (playlistId: string, mediaIds: string[]) => Promise<number>;
  removeMediaFromLocalPlaylist: (playlistId: string, mediaIds: string[]) => Promise<number>;
  saveExternalMediaMetadata: (metadata: ExternalMediaMetadataInput) => Promise<string>;
}

export type LibraryRequestJson = (path: string, init?: RequestInit) => Promise<unknown>;

export interface LibraryApiTransport {
  requestJson: LibraryRequestJson;
}

const parseStatus = (value: unknown): "success" | "error" => {
  if (value === "success" || value === "error") {
    return value;
  }
  throw new Error("Invalid library response status");
};

const parseStatusMessage = (value: unknown) => {
  if (!isRecord(value)) {
    throw new Error("Invalid API response shape");
  }

  return {
    status: parseStatus(value.status),
    message: typeof value.message === "string" ? value.message : null
  };
};

const parseLocalPlaylist = defineParser<LocalPlaylist>({
  boolean: ["cover_has_cover_art"],
  integer: ["track_count", "created_at_epoch_secs", "updated_at_epoch_secs"],
  nullableString: ["description", "cover_media_id", "cover_external_artwork_url"],
  string: ["playlist_id", "name"]
});

const parseLibraryTrackSummary = defineParser<LibraryTrackSummary>({
  boolean: ["has_cover_art"],
  integer: ["track_key", "added_at_epoch_secs", "updated_at_epoch_secs"],
  nullableInteger: ["track_number", "sample_rate", "bits_per_sample", "size_bytes"],
  nullableNumber: ["duration_secs", "bitrate_bps"],
  nullableString: ["title", "artist", "album", "external_artwork_url"],
  string: ["media_id", "file_name", "folder_key", "folder_label"]
});

const parseLibraryFolderSummary = defineParser<LibraryFolderSummary>({
  integer: ["count"],
  string: ["key", "label", "path"]
});

const parseLibraryTrackGroupSummary = defineParser<LibraryTrackGroupSummary>({
  boolean: ["has_cover_art"],
  integer: ["count"],
  nullableInteger: ["artwork_track_key"],
  nullableString: ["label", "external_artwork_url"],
  string: ["key"]
});

const parseLibraryTrackSummariesResponse = (value: unknown): LibraryTrackSummariesResponse => {
  if (!isRecord(value)) {
    throw new Error("Invalid library track summaries response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load library tracks");
  }
  if (
    !isString(value.revision) ||
    !isInteger(value.total_count) ||
    !isInteger(value.total_size_bytes) ||
    !Array.isArray(value.folders) ||
    !Array.isArray(value.tracks)
  ) {
    throw new Error("Invalid library track summaries payload");
  }
  const folders = value.folders.map(parseLibraryFolderSummary);
  const tracks = value.tracks.map(parseLibraryTrackSummary);
  if (folders.some((folder) => folder === null) || tracks.some((track) => track === null)) {
    throw new Error("Invalid library track summaries payload");
  }
  return {
    revision: value.revision,
    total_count: value.total_count,
    total_size_bytes: value.total_size_bytes,
    folders: folders as LibraryFolderSummary[],
    tracks: tracks as LibraryTrackSummary[]
  };
};

const parseLibraryTrackViewResponse = (value: unknown): LibraryTrackViewResponse => {
  if (!isRecord(value)) {
    throw new Error("Invalid library track view response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load library view");
  }
  if (
    !isString(value.revision) ||
    !isInteger(value.library_total_count) ||
    !isInteger(value.library_total_size_bytes) ||
    !isInteger(value.total_count) ||
    !isInteger(value.total_size_bytes) ||
    !Array.isArray(value.folders) ||
    !Array.isArray(value.rows) ||
    (value.media_ids !== null &&
      value.media_ids !== undefined &&
      !Array.isArray(value.media_ids))
  ) {
    throw new Error("Invalid library track view payload");
  }
  const folders = value.folders.map(parseLibraryFolderSummary);
  const rows = value.rows.map(parseLibraryTrackSummary);
  const rawMediaIds = value.media_ids;
  const mediaIds: string[] | null = Array.isArray(rawMediaIds)
    ? rawMediaIds.filter(isString)
    : null;
  const hasInvalidMediaIds = Array.isArray(rawMediaIds)
    ? mediaIds === null || mediaIds.length !== rawMediaIds.length
    : false;
  if (
    folders.some((folder) => folder === null) ||
    rows.some((track) => track === null) ||
    hasInvalidMediaIds
  ) {
    throw new Error("Invalid library track view payload");
  }
  return {
    revision: value.revision,
    library_total_count: value.library_total_count,
    library_total_size_bytes: value.library_total_size_bytes,
    total_count: value.total_count,
    total_size_bytes: value.total_size_bytes,
    folders: folders as LibraryFolderSummary[],
    rows: rows as LibraryTrackViewResponse["rows"],
    media_ids: mediaIds
  };
};

const parseLibraryTrackGroupsResponse = (value: unknown): LibraryTrackGroupsResponse => {
  if (!isRecord(value)) {
    throw new Error("Invalid library track groups response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load library groups");
  }
  if (
    !isString(value.revision) ||
    !isInteger(value.library_total_count) ||
    !isInteger(value.library_total_size_bytes) ||
    !isInteger(value.total_count) ||
    !isInteger(value.total_size_bytes) ||
    !Array.isArray(value.folders) ||
    !Array.isArray(value.groups) ||
    !isNullableString(value.selected_group_key) ||
    !Array.isArray(value.rows)
  ) {
    throw new Error("Invalid library track groups payload");
  }
  const folders = value.folders.map(parseLibraryFolderSummary);
  const groups = value.groups.map(parseLibraryTrackGroupSummary);
  const rows = value.rows.map(parseLibraryTrackSummary);
  if (
    folders.some((folder) => folder === null) ||
    groups.some((group) => group === null) ||
    rows.some((track) => track === null)
  ) {
    throw new Error("Invalid library track groups payload");
  }
  return {
    revision: value.revision,
    library_total_count: value.library_total_count,
    library_total_size_bytes: value.library_total_size_bytes,
    total_count: value.total_count,
    total_size_bytes: value.total_size_bytes,
    folders: folders as LibraryFolderSummary[],
    groups: groups as LibraryTrackGroupSummary[],
    selected_group_key: value.selected_group_key,
    rows: rows as LibraryTrackGroupsResponse["rows"]
  };
};

const parseLibraryTrackDetailResponse = (value: unknown): LibraryTrackDetail => {
  if (!isRecord(value)) {
    throw new Error("Invalid library track detail response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load library track");
  }
  const item = parseMediaItem(value.item);
  if (!isInteger(value.track_key) || !item) {
    throw new Error("Invalid library track detail payload");
  }
  return {
    track_key: value.track_key,
    item
  };
};

const parseLibraryQueuePlaybackResponse = (value: unknown): LibraryQueuePlaybackResult => {
  if (!isRecord(value)) {
    throw new Error("Invalid library queue response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to play library tracks");
  }
  const state = parsePlayerState(value.state);
  if (!state || !isInteger(value.queued_count)) {
    throw new Error("Invalid library queue payload");
  }
  return {
    state,
    queuedCount: value.queued_count
  };
};

const parseLibraryQueueEntriesResponse = (value: unknown, errorMessage: string): QueueEntry[] => {
  if (!isRecord(value)) {
    throw new Error(errorMessage);
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : errorMessage);
  }
  if (!Array.isArray(value.queue)) {
    throw new Error(errorMessage);
  }
  return parseQueueEntries(value.queue, errorMessage);
};

const parseLocalPlaylistsResponse = (value: unknown): LocalPlaylist[] => {
  if (!isRecord(value)) {
    throw new Error("Invalid local playlists response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load local playlists");
  }
  if (!Array.isArray(value.playlists)) {
    throw new Error("Invalid local playlists payload");
  }
  const playlists = value.playlists.map(parseLocalPlaylist);
  if (playlists.some((playlist) => playlist === null)) {
    throw new Error("Invalid local playlists payload");
  }
  return playlists as LocalPlaylist[];
};

const parseLocalPlaylistResponse = (value: unknown): LocalPlaylist => {
  if (!isRecord(value)) {
    throw new Error("Invalid local playlist response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to save local playlist");
  }
  const playlist = parseLocalPlaylist(value.playlist);
  if (!playlist) {
    throw new Error("Invalid local playlist payload");
  }
  return playlist;
};

const parseLocalPlaylistDetailResponse = (value: unknown): LocalPlaylistDetail => {
  if (!isRecord(value)) {
    throw new Error("Invalid local playlist detail response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load local playlist");
  }
  const playlist = parseLocalPlaylist(value.playlist);
  if (!playlist || !Array.isArray(value.items)) {
    throw new Error("Invalid local playlist detail payload");
  }
  const items = value.items.map(parseMediaItem);
  if (items.some((item) => item === null)) {
    throw new Error("Invalid local playlist detail payload");
  }
  return {
    playlist,
    items: items as MediaItem[]
  };
};

const postJson = (body: object): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body)
});

export const createLibraryApiClient = (transport: LibraryApiTransport): LibraryApiClient => ({
  getLibraryRoots: async () => {
    const json = await transport.requestJson("/domain/library/roots");
    if (!isRecord(json) || json.status !== "success" || !Array.isArray(json.roots)) {
      throw new Error("Invalid library roots response");
    }
    return json.roots as LibraryRoot[];
  },
  scanLibraryRoot: async (path, displayName, sourceKey) => {
    const body: Record<string, string> = { path };
    if (displayName) body.display_name = displayName;
    if (sourceKey) body.source_key = sourceKey;
    const json = await transport.requestJson("/domain/library/scan", postJson(body));
    const scanResult = parseScanResult(json);
    if (!isRecord(json) || json.status !== "success" || !scanResult) {
      throw new Error(typeof json === "object" && json !== null && "message" in json ? String(json.message) : "Failed to scan library");
    }
    return scanResult;
  },
  deleteLibraryRoot: async (rootId) => {
    const json = await transport.requestJson(`/domain/library/roots/${rootId}`, {
      method: "DELETE"
    });
    const response = parseStatusMessage(json);
    if (response.status === "error") {
      throw new Error(response.message ?? "Failed to delete library root");
    }
  },
  getLibraryScanTask: async (taskId) => {
    const json = await transport.requestJson(`/domain/library/scan_tasks/${taskId}`);
    const task = isRecord(json) ? parseLibraryScanTask(json.task) : null;
    if (!isRecord(json) || json.status !== "success" || !task) {
      throw new Error("Invalid library scan task response");
    }
    return task;
  },
  getMediaItems: async (limit = 100, all = false) => {
    const query = all ? "all=true" : `limit=${limit}`;
    const json = await transport.requestJson(`/domain/media_items?${query}`);
    if (!isRecord(json) || json.status !== "success" || !Array.isArray(json.media_items)) {
      throw new Error("Invalid media items response");
    }
    const mediaItems = json.media_items.map(parseMediaItem);
    if (mediaItems.some((item) => item === null)) {
      throw new Error("Invalid media items response");
    }
    return mediaItems as MediaItem[];
  },
  getLibraryTrackSummaries: async () =>
    parseLibraryTrackSummariesResponse(await transport.requestJson("/domain/library/track_summaries")),
  getLibraryTrackView: async (input) =>
    parseLibraryTrackViewResponse(
      await transport.requestJson(
        "/domain/library/view",
        postJson({
          queries: input.queries,
          folder_path: input.folderPath,
          sort: input.sort,
          range: input.range ?? null,
          include_media_ids: input.includeMediaIds === true
        })
      )
    ),
  getLibraryTrackGroups: async (input) =>
    parseLibraryTrackGroupsResponse(
      await transport.requestJson(
        "/domain/library/groups",
        postJson({
          kind: input.kind,
          queries: input.queries,
          folder_path: input.folderPath,
          sort: input.sort,
          selected_group_key: input.selectedGroupKey ?? null
        })
      )
    ),
  getLibraryTrackDetail: async (trackKey) =>
    parseLibraryTrackDetailResponse(
      await transport.requestJson(`/domain/library/tracks/${encodeURIComponent(String(trackKey))}`)
    ),
  replaceQueueFromMediaIds: async (input) =>
    parseLibraryQueuePlaybackResponse(
      await transport.requestJson(
        "/domain/library/queue_from_media_ids",
        postJson({
          media_ids: input.mediaIds,
          start_media_id: input.startMediaId ?? null
        })
      )
    ),
  enqueueQueueFromMediaIds: async (input) =>
    parseLibraryQueueEntriesResponse(
      await transport.requestJson(
        "/domain/library/queue_enqueue_from_media_ids",
        postJson({
          media_ids: input.mediaIds,
          start_media_id: input.startMediaId ?? null
        })
      ),
      "Invalid library queue enqueue response"
    ),
  deleteMediaItems: async (mediaIds) => {
    const json = await transport.requestJson(
      "/domain/media_items/delete",
      postJson({ media_ids: mediaIds })
    );
    if (!isRecord(json) || json.status !== "success" || !isInteger(json.deleted_count)) {
      throw new Error("Failed to delete media items");
    }
    return json.deleted_count;
  },
  listLocalPlaylists: async () =>
    parseLocalPlaylistsResponse(await transport.requestJson("/domain/local_playlists")),
  createLocalPlaylist: async (input) =>
    parseLocalPlaylistResponse(
      await transport.requestJson(
        "/domain/local_playlists",
        postJson({
          name: input.name,
          description: input.description ?? null
        })
      )
    ),
  updateLocalPlaylist: async (playlistId, input) =>
    parseLocalPlaylistResponse(
      await transport.requestJson(
        `/domain/local_playlists/${encodeURIComponent(playlistId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: input.name ?? null,
            description: input.description ?? null
          })
        }
      )
    ),
  deleteLocalPlaylist: async (playlistId) => {
    const json = await transport.requestJson(`/domain/local_playlists/${encodeURIComponent(playlistId)}`, {
      method: "DELETE"
    });
    const response = parseStatusMessage(json);
    if (response.status === "error") {
      throw new Error(response.message ?? "Failed to delete local playlist");
    }
  },
  getLocalPlaylist: async (playlistId) =>
    parseLocalPlaylistDetailResponse(
      await transport.requestJson(`/domain/local_playlists/${encodeURIComponent(playlistId)}`)
    ),
  addMediaToLocalPlaylist: async (playlistId, mediaIds) => {
    const json = await transport.requestJson(
      `/domain/local_playlists/${encodeURIComponent(playlistId)}/items`,
      postJson({ media_ids: mediaIds })
    );
    if (!isRecord(json) || json.status !== "success" || !isInteger(json.added_count)) {
      throw new Error("Failed to add media to local playlist");
    }
    return json.added_count;
  },
  removeMediaFromLocalPlaylist: async (playlistId, mediaIds) => {
    const json = await transport.requestJson(
      `/domain/local_playlists/${encodeURIComponent(playlistId)}/items/remove`,
      postJson({ media_ids: mediaIds })
    );
    if (!isRecord(json) || json.status !== "success" || !isInteger(json.removed_count)) {
      throw new Error("Failed to remove media from local playlist");
    }
    return json.removed_count;
  },
  saveExternalMediaMetadata: async (metadata) => {
    const json = await transport.requestJson("/domain/media_items/metadata", postJson(metadata));
    if (!isRecord(json) || json.status !== "success" || !isString(json.media_id)) {
      throw new Error("Failed to save external media metadata");
    }
    return json.media_id;
  }
});

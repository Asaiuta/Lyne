import type {
  ApiEnvelope,
  ApiStatus,
  AudioDeviceInfo,
  DevicesResponse,
  LibraryTrackDetail,
  LibraryFolderSummary,
  LibraryTrackSummariesResponse,
  LibraryTrackSummary,
  LocalPlaylist,
  LocalPlaylistDetail,
  PlaybackHistoryEntry,
  LibraryRoot,
  LibraryScanTask,
  MediaItem,
  PersistentSettings,
  PersistentSettingsUpdate,
  QueueEntry,
  QueueStatus,
  PlayerState,
  ScanResult,
  WebDavBrowseEntry,
  WebDavSource
} from "./types";
import { peekApiToken, resolveApiToken, resolveBaseUrl } from "./env";
import {
  getCurrentLyrics as requestCurrentLyrics,
  parseCurrentLyricsResponse,
  type CurrentLyricsResponse
} from "./lyrics";
import {
  createPlaybackApiClient,
  type PlaybackApiClient,
  type PlaybackApiTransport
} from "./playback";
import { requestEnvelope as requestTransportEnvelope, requestJson } from "./transport";
import {
  createEffectsApiClient,
  type EffectsApiClient,
  type EffectsApiTransport
} from "./effects";
import type {
  GetNcmHomeFeedInput,
  ListNcmCloudTracksInput,
  ListNcmDiscoverAlbumsInput,
  ListNcmDiscoverArtistsInput,
  ListNcmDiscoverPlaylistsInput,
  ListNcmDiscoverSongsInput,
  ListNcmPlaylistTracksInput,
  ListNcmUserPlaylistsInput,
  NcmAccountSummary,
  NcmAccountState,
  NcmAccountUpsertInput,
  NcmCloudTracksPage,
  NcmDiscoverCard,
  NcmDiscoverCardsPage,
  NcmDiscoverPlaylistCategories,
  NcmDiscoverPlaylistCategoryEntry,
  NcmDiscoverToplist,
  NcmDiscoverToplistTrack,
  NcmHomeFeed,
  NcmHomeFeedCard,
  NcmHomeFeedError,
  NcmHomePersonalFmPreview,
  NcmHomeTrackCover,
  NcmPlaylistSummary,
  NcmTrackPlaybackResult,
  NcmTrackQueueResult,
  NcmTrackSummary,
  ResolveNcmTrackInput,
  ResolvedNcmTrack,
  ResolvedNcmTrackSupplement,
  SearchNcmTracksInput
} from "./ncmDomainTypes";
export type { CurrentLyricsResponse, LyricLine, LyricWord } from "./lyrics";
export type { LoadOptions, PlaybackApiClient } from "./playback";
export type {
  GetNcmHomeFeedInput,
  ListNcmCloudTracksInput,
  ListNcmDiscoverAlbumsInput,
  ListNcmDiscoverArtistsInput,
  ListNcmDiscoverPlaylistsInput,
  ListNcmDiscoverSongsInput,
  ListNcmPlaylistTracksInput,
  ListNcmUserPlaylistsInput,
  NcmAccountState,
  NcmAccountSummary,
  NcmAccountUpsertInput,
  NcmCloudTracksPage,
  NcmDiscoverAlbumArea,
  NcmDiscoverCard,
  NcmDiscoverCardsPage,
  NcmDiscoverPlaylistCategories,
  NcmDiscoverPlaylistCategoryEntry,
  NcmDiscoverPlaylistKind,
  NcmDiscoverSongType,
  NcmDiscoverToplist,
  NcmDiscoverToplistTrack,
  NcmHomeFeed,
  NcmHomeFeedCard,
  NcmHomeFeedError,
  NcmHomePersonalFmPreview,
  NcmHomeTrackCover,
  NcmPlaylistSummary,
  NcmTrackPlaybackResult,
  NcmTrackQueueResult,
  NcmTrackSummary,
  NcmUserPlaylistMode,
  ResolveNcmTrackInput,
  ResolvedNcmTrack,
  ResolvedNcmTrackSupplement,
  SearchNcmTracksInput
} from "./ncmDomainTypes";
export type {
  ConfigureOptimizationsInput,
  ConfigureOutputBitsInput,
  CrossfeedResponse,
  CrossfeedSettings,
  DynamicLoudnessResponse,
  DynamicLoudnessSettings,
  NoiseShaperCurve,
  NoiseShaperResponse,
  NoiseShaperSettings,
  SaturationResponse,
  SaturationSettings,
  SetCrossfeedInput,
  SetDynamicLoudnessInput,
  SetEqInput,
  SetEqTypeInput,
  SetNoiseShaperCurveInput,
  SetSaturationInput,
  StatusMessageResponse
} from "./effects";

export interface ApiClient extends PlaybackApiClient, EffectsApiClient {
  getQueueStatus: () => Promise<QueueStatus>;
  queueNext: (path: string) => Promise<void>;
  cancelPreload: () => Promise<void>;
  getSettings: () => Promise<PersistentSettings>;
  saveSettings: (settings: PersistentSettingsUpdate) => Promise<void>;
  // Library
  getLibraryRoots: () => Promise<LibraryRoot[]>;
  scanLibraryRoot: (path: string, displayName?: string, sourceKey?: string) => Promise<ScanResult>;
  deleteLibraryRoot: (rootId: number) => Promise<void>;
  getLibraryScanTask: (taskId: number) => Promise<LibraryScanTask>;
  getMediaItems: (limit?: number, all?: boolean) => Promise<MediaItem[]>;
  getLibraryTrackSummaries: () => Promise<LibraryTrackSummariesResponse>;
  getLibraryTrackDetail: (trackKey: number) => Promise<LibraryTrackDetail>;
  replaceQueueFromLibraryQuery: (input: LibraryQueueQueryInput) => Promise<LibraryQueuePlaybackResult>;
  replaceQueueFromTrackKeys: (input: LibraryQueueTrackKeysInput) => Promise<LibraryQueuePlaybackResult>;
  deleteMediaItems: (mediaIds: string[]) => Promise<number>;
  listLocalPlaylists: () => Promise<LocalPlaylist[]>;
  createLocalPlaylist: (input: LocalPlaylistCreateInput) => Promise<LocalPlaylist>;
  updateLocalPlaylist: (playlistId: string, input: LocalPlaylistUpdateInput) => Promise<LocalPlaylist>;
  deleteLocalPlaylist: (playlistId: string) => Promise<void>;
  getLocalPlaylist: (playlistId: string) => Promise<LocalPlaylistDetail>;
  addMediaToLocalPlaylist: (playlistId: string, mediaIds: string[]) => Promise<number>;
  removeMediaFromLocalPlaylist: (playlistId: string, mediaIds: string[]) => Promise<number>;
  saveExternalMediaMetadata: (metadata: ExternalMediaMetadataInput) => Promise<string>;
  resolveNcmTrack: (input: ResolveNcmTrackInput) => Promise<ResolvedNcmTrack>;
  playNcmTrack: (input: ResolveNcmTrackInput) => Promise<NcmTrackPlaybackResult>;
  enqueueNcmTrack: (input: ResolveNcmTrackInput) => Promise<NcmTrackQueueResult>;
  resolveNcmTrackSupplement: (songId: number) => Promise<ResolvedNcmTrackSupplement>;
  getNcmAccounts: () => Promise<NcmAccountState>;
  upsertNcmAccount: (input: NcmAccountUpsertInput) => Promise<NcmAccountState>;
  setActiveNcmAccount: (userId: number) => Promise<NcmAccountState>;
  refreshActiveNcmAccount: () => Promise<NcmAccountState>;
  logoutActiveNcmAccount: () => Promise<NcmAccountState>;
  dailySigninActiveNcmAccount: () => Promise<NcmAccountState>;
  deleteNcmAccount: (userId: number) => Promise<NcmAccountState>;
  listNcmUserPlaylists: (input: ListNcmUserPlaylistsInput) => Promise<NcmPlaylistSummary[]>;
  searchNcmTracks: (input: SearchNcmTracksInput) => Promise<NcmTrackSummary[]>;
  searchNcmPlaylists: (input: SearchNcmTracksInput) => Promise<NcmPlaylistSummary[]>;
  listNcmPlaylistTracks: (input: ListNcmPlaylistTracksInput) => Promise<NcmTrackSummary[]>;
  listNcmDailySongTracks: () => Promise<NcmTrackSummary[]>;
  listNcmSongDetailTracks: (ids: number[]) => Promise<NcmTrackSummary[]>;
  listNcmPersonalFmTracks: () => Promise<NcmTrackSummary[]>;
  trashNcmPersonalFmTrack: (songId: number) => Promise<void>;
  listNcmAlbumTracks: (id: number) => Promise<NcmTrackSummary[]>;
  listNcmArtistTracks: (id: number) => Promise<NcmTrackSummary[]>;
  getNcmLikelistIds: (uid: number) => Promise<number[]>;
  listNcmCloudTracks: (input: ListNcmCloudTracksInput) => Promise<NcmCloudTracksPage>;
  deleteNcmCloudTrack: (songId: number) => Promise<void>;
  getNcmHomeFeed: (input?: GetNcmHomeFeedInput) => Promise<NcmHomeFeed>;
  listNcmDiscoverPlaylists: (input: ListNcmDiscoverPlaylistsInput) => Promise<NcmDiscoverCardsPage>;
  listNcmDiscoverAlbums: (input: ListNcmDiscoverAlbumsInput) => Promise<NcmDiscoverCardsPage>;
  listNcmDiscoverArtists: (input: ListNcmDiscoverArtistsInput) => Promise<NcmDiscoverCard[]>;
  listNcmDiscoverToplists: () => Promise<NcmDiscoverToplist[]>;
  listNcmDiscoverSongs: (input: ListNcmDiscoverSongsInput) => Promise<NcmTrackSummary[]>;
  getNcmDiscoverPlaylistCategories: () => Promise<NcmDiscoverPlaylistCategories>;
  // Persistent Queue
  getPersistentQueue: () => Promise<QueueEntry[]>;
  enqueueTrack: (path: string) => Promise<QueueEntry[]>;
  removeQueueEntry: (entryId: number) => Promise<QueueEntry[]>;
  clearPersistentQueue: () => Promise<void>;
  playFromQueue: (options?: PlayQueueOptions) => Promise<PlayerState>;
  playNextQueueEntry: () => Promise<PlayerState>;
  playPreviousQueueEntry: () => Promise<PlayerState>;
  getQueueAdjacent: () => Promise<QueueAdjacent>;
  replaceQueue: (paths: string[]) => Promise<QueueEntry[]>;
  // WebDAV
  listWebDavSources: () => Promise<WebDavSource[]>;
  upsertWebDavSource: (sourceKey: string, displayName: string, baseUrl: string, username?: string, password?: string, isDefault?: boolean) => Promise<WebDavSource>;
  setDefaultWebDavSource: (sourceKey: string) => Promise<WebDavSource>;
  deleteWebDavSource: (sourceKey: string) => Promise<void>;
  browseWebDav: (path?: string) => Promise<{ path: string; entries: WebDavBrowseEntry[] }>;
  // Playback History
  getPlaybackHistory: (limit?: number) => Promise<PlaybackHistoryEntry[]>;
  getCurrentLyrics: () => Promise<CurrentLyricsResponse>;
  // Cover Art
  getCoverArtUrl: (mediaId: string) => string;
  getLibraryTrackCoverArtUrl: (trackKey: number) => string;
}

export interface PlayQueueOptions {
  entryId?: number;
  sourcePath?: string;
}

export interface QueueAdjacent {
  previousEntryId: number | null;
  nextEntryId: number | null;
}

export interface LibraryQueueQueryInput {
  search?: string | null;
  folderPath?: string | null;
  sortField?: string | null;
  sortOrder?: string | null;
  startTrackKey?: number | null;
}

export interface LibraryQueueTrackKeysInput {
  trackKeys: number[];
  startTrackKey?: number | null;
}

export interface LibraryQueuePlaybackResult {
  state: PlayerState;
  queuedCount: number;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isInteger = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value);

const isString = (value: unknown): value is string => typeof value === "string";

const isNullableString = (value: unknown): value is string | null =>
  value === null || isString(value);

const isNullableNumber = (value: unknown): value is number | null =>
  value === null || isNumber(value);

const isNullableInteger = (value: unknown): value is number | null =>
  value === null || isInteger(value);

const isNumberRecord = (value: unknown): value is Record<string, number> => {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(isNumber);
};

const isStringRecord = (value: unknown): value is Record<string, string> => {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(isString);
};

const hasFields = <T extends string>(
  value: Record<string, unknown>,
  fields: readonly T[],
  predicate: (candidate: unknown) => boolean
) => fields.every((field) => predicate(value[field]));

const parseStatus = (value: unknown): ApiStatus => {
  if (value === "success" || value === "error") {
    return value;
  }
  throw new Error("Invalid response status");
};

const audioDeviceBooleanFields = ["is_default"] as const;
const audioDeviceIntegerFields = ["id"] as const;
const audioDeviceNullableIntegerFields = ["sample_rate"] as const;
const audioDeviceStringFields = ["name"] as const;

const parseAudioDeviceInfo = (value: unknown): AudioDeviceInfo | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !hasFields(value, audioDeviceBooleanFields, isBoolean) ||
    !hasFields(value, audioDeviceIntegerFields, isInteger) ||
    !hasFields(value, audioDeviceNullableIntegerFields, isNullableInteger) ||
    !hasFields(value, audioDeviceStringFields, isString)
  ) {
    return null;
  }

  return value as unknown as AudioDeviceInfo;
};

const parseDevicesResponse = (value: unknown): DevicesResponse | null => {
  if (!isRecord(value) || !isString(value.preferred_name)) {
    return null;
  }

  const preferred = Array.isArray(value.preferred)
    ? value.preferred.map(parseAudioDeviceInfo)
    : null;
  const other = Array.isArray(value.other)
    ? value.other.map(parseAudioDeviceInfo)
    : null;

  if (
    !preferred ||
    !other ||
    preferred.some((device) => device === null) ||
    other.some((device) => device === null)
  ) {
    return null;
  }

  return {
    preferred: preferred as AudioDeviceInfo[],
    other: other as AudioDeviceInfo[],
    preferred_name: value.preferred_name
  };
};

const playerStateBooleanFields = [
  "is_playing",
  "is_paused",
  "is_loading",
  "exclusive_mode",
  "dither_enabled",
  "replaygain_enabled",
  "loudness_enabled",
  "saturation_enabled",
  "crossfeed_enabled",
  "dynamic_loudness_enabled",
  "use_cache",
  "preemptive_resample",
  "has_cover_art"
] as const;

const playerStateNumberFields = [
  "duration",
  "current_time",
  "volume",
  "target_lufs",
  "preamp_db",
  "saturation_drive",
  "saturation_mix",
  "crossfeed_mix",
  "dynamic_loudness_strength",
  "dynamic_loudness_factor"
] as const;

const playerStateIntegerFields = ["output_bits"] as const;

const playerStateNullableIntegerFields = [
  "device_id",
  "ncm_song_id",
  "target_samplerate",
  "track_number",
  "disc_number",
  "year"
] as const;

const playerStateNullableNumberFields = [
  "rg_track_gain",
  "rg_album_gain",
  "rg_track_peak",
  "rg_album_peak"
] as const;

const playerStateStringFields = [
  "eq_type",
  "loudness_mode",
  "noise_shaper_curve",
  "resample_quality",
  "repeat_mode",
  "shuffle_mode"
] as const;

const playerStateNullableStringFields = [
  "file_path",
  "title",
  "artist",
  "album",
  "genre",
  "media_id",
  "ncm_source_page_url",
  "external_artwork_url"
] as const;

const parsePlayerState = (value: unknown): PlayerState | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (
    !hasFields(value, playerStateBooleanFields, isBoolean) ||
    !hasFields(value, playerStateNumberFields, isNumber) ||
    !hasFields(value, playerStateIntegerFields, isInteger) ||
    !hasFields(value, playerStateNullableIntegerFields, isNullableInteger) ||
    !hasFields(value, playerStateNullableNumberFields, isNullableNumber) ||
    !hasFields(value, playerStateStringFields, isString) ||
    !hasFields(value, playerStateNullableStringFields, isNullableString)
  ) {
    return null;
  }

  return value as unknown as PlayerState;
};

const persistentSettingsBooleanFields = [
  "exclusive_mode",
  "dither_enabled",
  "loudness_enabled",
  "saturation_enabled",
  "crossfeed_enabled",
  "dynamic_loudness_enabled",
  "use_cache",
  "preemptive_resample"
] as const;

const persistentSettingsNumberFields = [
  "volume",
  "target_lufs",
  "preamp_db",
  "saturation_drive",
  "saturation_mix",
  "crossfeed_mix",
  "dynamic_loudness_strength"
] as const;

const persistentSettingsIntegerFields = ["output_bits"] as const;

const persistentSettingsNullableIntegerFields = [
  "device_id",
  "fir_taps",
  "target_samplerate"
] as const;

const persistentSettingsStringFields = [
  "eq_type",
  "noise_shaper_curve",
  "loudness_mode",
  "resample_quality"
] as const;

const parsePersistentSettings = (value: unknown): PersistentSettings | null => {
  if (!isRecord(value)) {
    return null;
  }

  const eqBands = value.eq_bands;
  if (eqBands !== null && eqBands !== undefined && !isNumberRecord(eqBands)) {
    return null;
  }

  if (
    !hasFields(value, persistentSettingsBooleanFields, isBoolean) ||
    !hasFields(value, persistentSettingsNumberFields, isNumber) ||
    !hasFields(value, persistentSettingsIntegerFields, isInteger) ||
    !hasFields(value, persistentSettingsNullableIntegerFields, isNullableInteger) ||
    !hasFields(value, persistentSettingsStringFields, isString)
  ) {
    return null;
  }

  return {
    volume: value.volume as number,
    device_id: value.device_id as number | null,
    exclusive_mode: value.exclusive_mode as boolean,
    eq_type: value.eq_type as string,
    eq_bands: eqBands === undefined ? null : (eqBands as Record<string, number> | null),
    fir_taps: value.fir_taps as number | null,
    dither_enabled: value.dither_enabled as boolean,
    output_bits: value.output_bits as number,
    noise_shaper_curve: value.noise_shaper_curve as string,
    loudness_enabled: value.loudness_enabled as boolean,
    loudness_mode: value.loudness_mode as string,
    target_lufs: value.target_lufs as number,
    preamp_db: value.preamp_db as number,
    saturation_enabled: value.saturation_enabled as boolean,
    saturation_drive: value.saturation_drive as number,
    saturation_mix: value.saturation_mix as number,
    crossfeed_enabled: value.crossfeed_enabled as boolean,
    crossfeed_mix: value.crossfeed_mix as number,
    dynamic_loudness_enabled: value.dynamic_loudness_enabled as boolean,
    dynamic_loudness_strength: value.dynamic_loudness_strength as number,
    target_samplerate: value.target_samplerate as number | null,
    resample_quality: value.resample_quality as string,
    use_cache: value.use_cache as boolean,
    preemptive_resample: value.preemptive_resample as boolean
  };
};

const queueStatusBooleanFields = [
  "needs_preload",
  "pending_ready",
  "is_preload_canceling"
] as const;

const queueStatusNullableStringFields = [
  "current_track_path",
  "pending_track_path"
] as const;

const parseQueueStatus = (value: unknown): QueueStatus | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (
    !hasFields(value, queueStatusBooleanFields, isBoolean) ||
    !hasFields(value, queueStatusNullableStringFields, isNullableString)
  ) {
    return null;
  }

  return {
    current_track_path: value.current_track_path as string | null,
    pending_track_path: value.pending_track_path as string | null,
    needs_preload: value.needs_preload as boolean,
    pending_ready: value.pending_ready as boolean,
    is_preload_canceling: value.is_preload_canceling as boolean
  };
};

const parseEnvelope = (value: unknown): ApiEnvelope => {
  if (!isRecord(value)) {
    throw new Error("Invalid API response shape");
  }

  const state = value.state === undefined ? undefined : parsePlayerState(value.state);
  const devices = value.devices === undefined ? undefined : parseDevicesResponse(value.devices);

  if (value.state !== undefined && !state) {
    throw new Error("Invalid player state payload");
  }

  if (value.devices !== undefined && !devices) {
    throw new Error("Invalid device payload");
  }

  return {
    status: parseStatus(value.status),
    message: typeof value.message === "string" ? value.message : null,
    state: state ?? undefined,
    devices: devices ?? undefined
  };
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

const parseLocalPlaylist = (value: unknown): LocalPlaylist | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (
    !isString(value.playlist_id) ||
    !isString(value.name) ||
    !isNullableString(value.description) ||
    !isNullableString(value.cover_media_id) ||
    !isBoolean(value.cover_has_cover_art) ||
    !isNullableString(value.cover_external_artwork_url) ||
    !isInteger(value.track_count) ||
    !isInteger(value.created_at_epoch_secs) ||
    !isInteger(value.updated_at_epoch_secs)
  ) {
    return null;
  }

  return value as unknown as LocalPlaylist;
};

const parseLibraryTrackSummary = (value: unknown): LibraryTrackSummary | null => {
  if (!isRecord(value)) return null;
  if (
    !isInteger(value.track_key) ||
    !isString(value.media_id) ||
    !isNullableString(value.title) ||
    !isNullableString(value.artist) ||
    !isNullableString(value.album) ||
    !isNullableInteger(value.track_number) ||
    !isString(value.file_name) ||
    !isString(value.folder_key) ||
    !isString(value.folder_label) ||
    !isNullableNumber(value.duration_secs) ||
    !isBoolean(value.has_cover_art) ||
    !isNullableString(value.external_artwork_url) ||
    !isNullableInteger(value.size_bytes) ||
    !isInteger(value.added_at_epoch_secs) ||
    !isInteger(value.updated_at_epoch_secs)
  ) {
    return null;
  }
  return value as unknown as LibraryTrackSummary;
};

const parseLibraryFolderSummary = (value: unknown): LibraryFolderSummary | null => {
  if (!isRecord(value)) return null;
  if (
    !isString(value.key) ||
    !isString(value.label) ||
    !isString(value.path) ||
    !isInteger(value.count)
  ) {
    return null;
  }
  return value as unknown as LibraryFolderSummary;
};

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

const parseLibraryTrackDetailResponse = (value: unknown): LibraryTrackDetail => {
  if (!isRecord(value)) {
    throw new Error("Invalid library track detail response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load library track");
  }
  if (!isInteger(value.track_key) || !isRecord(value.item)) {
    throw new Error("Invalid library track detail payload");
  }
  return {
    track_key: value.track_key,
    item: value.item as unknown as MediaItem
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
  if (!isRecord(value.state) || !isInteger(value.queued_count)) {
    throw new Error("Invalid library queue payload");
  }
  return {
    state: value.state as unknown as PlayerState,
    queuedCount: value.queued_count
  };
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
  return {
    playlist,
    items: value.items as MediaItem[]
  };
};

const parseSettingsResponse = (value: unknown): PersistentSettings => {
  if (!isRecord(value)) {
    throw new Error("Invalid settings response shape");
  }

  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to fetch settings");
  }

  const settings = parsePersistentSettings(value.settings);
  if (!settings) {
    throw new Error("Invalid settings payload");
  }

  return settings;
};

const parseQueueStatusResponse = (value: unknown): QueueStatus => {
  if (!isRecord(value)) {
    throw new Error("Invalid queue status response shape");
  }

  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to fetch queue status");
  }

  const queue = parseQueueStatus(value.queue);
  if (!queue) {
    throw new Error("Invalid queue status payload");
  }

  return queue;
};

const parseResolvedNcmTrack = (value: unknown, errorMessage: string): ResolvedNcmTrack => {
  if (!isRecord(value)) {
    throw new Error(errorMessage);
  }

  if (
    !isInteger(value.song_id) ||
    !isString(value.stream_url) ||
    !isString(value.source_page_url) ||
    !isNullableString(value.title) ||
    !isNullableString(value.artist) ||
    !isNullableString(value.album) ||
    !isNullableString(value.cover_url) ||
    !isNullableNumber(value.duration_secs)
  ) {
    throw new Error(errorMessage);
  }

  return {
    songId: value.song_id,
    streamUrl: value.stream_url,
    sourcePageUrl: value.source_page_url,
    title: value.title,
    artist: value.artist,
    album: value.album,
    coverUrl: value.cover_url,
    durationSecs: value.duration_secs
  };
};

const parseResolvedNcmTrackResponse = (value: unknown): ResolvedNcmTrack => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM track response shape");
  }

  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to resolve NCM track");
  }

  return parseResolvedNcmTrack(value.track, "Invalid NCM track payload");
};

const parseNcmTrackPlaybackResponse = (value: unknown): NcmTrackPlaybackResult => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM playback response shape");
  }

  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to play NCM track");
  }

  const track = parseResolvedNcmTrack(value.track, "Invalid NCM playback track payload");
  const state = parsePlayerState(value.state);
  if (!state) {
    throw new Error("Invalid NCM playback state payload");
  }

  return { track, state };
};

const parseNcmTrackQueueResponse = (value: unknown): NcmTrackQueueResult => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM queue response shape");
  }

  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to enqueue NCM track");
  }

  const track = parseResolvedNcmTrack(value.track, "Invalid NCM queue track payload");
  if (!Array.isArray(value.queue)) {
    throw new Error("Invalid NCM queue payload");
  }

  return { track, queue: value.queue as QueueEntry[] };
};

const parseResolvedNcmTrackSupplementResponse = (value: unknown): ResolvedNcmTrackSupplement => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM supplement response shape");
  }

  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to resolve NCM supplement");
  }

  const supplement = isRecord(value.supplement) ? value.supplement : null;
  if (
    !supplement ||
    !isInteger(supplement.song_id) ||
    !isNullableString(supplement.title) ||
    !isNullableString(supplement.artist) ||
    !isNullableString(supplement.album) ||
    !isNullableString(supplement.cover_url) ||
    !Array.isArray(supplement.lyrics) ||
    !isNullableString(supplement.detail_error) ||
    !isNullableString(supplement.lyrics_error)
  ) {
    throw new Error("Invalid NCM supplement payload");
  }

  const lyrics = parseCurrentLyricsResponse({
    status: "success",
    lyrics: supplement.lyrics,
    source: null
  }).lyrics;

  return {
    songId: supplement.song_id,
    title: supplement.title,
    artist: supplement.artist,
    album: supplement.album,
    coverUrl: supplement.cover_url,
    lyrics,
    detailError: supplement.detail_error,
    lyricsError: supplement.lyrics_error
  };
};

const parseNcmAccountSummary = (value: unknown): NcmAccountSummary | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isInteger(value.user_id) ||
    !isNullableString(value.nickname) ||
    !isNullableString(value.avatar_url) ||
    !isBoolean(value.has_cookie) ||
    !isNullableInteger(value.vip_type) ||
    !isNullableInteger(value.level) ||
    !isNullableInteger(value.signin_at_ms) ||
    !isInteger(value.added_at_ms) ||
    !isInteger(value.refreshed_at_ms)
  ) {
    return null;
  }

  if ("cookie" in value) {
    throw new Error("Invalid NCM account payload");
  }

  return {
    userId: value.user_id,
    nickname: value.nickname,
    avatarUrl: value.avatar_url,
    hasCookie: value.has_cookie,
    vipType: value.vip_type,
    level: value.level,
    signinAt: value.signin_at_ms,
    addedAt: value.added_at_ms,
    refreshedAt: value.refreshed_at_ms
  };
};

const parseNcmAccountStateResponse = (value: unknown): NcmAccountState => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM account response shape");
  }

  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to read NCM accounts");
  }

  if (!Array.isArray(value.accounts) || !isNullableInteger(value.active_user_id)) {
    throw new Error("Invalid NCM account payload");
  }
  const accounts = value.accounts.map(parseNcmAccountSummary);
  if (accounts.some((account) => account === null)) {
    throw new Error("Invalid NCM account payload");
  }

  return {
    accounts: accounts as NcmAccountSummary[],
    activeUserId: value.active_user_id
  };
};

const parseNcmPlaylistSummary = (value: unknown): NcmPlaylistSummary | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isInteger(value.id) ||
    !isString(value.name) ||
    !isNullableString(value.creator) ||
    !isNullableString(value.cover_url) ||
    !isNullableInteger(value.track_count) ||
    !isBoolean(value.subscribed)
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    creator: value.creator,
    coverUrl: value.cover_url,
    trackCount: value.track_count,
    subscribed: value.subscribed
  };
};

const parseNcmUserPlaylistsResponse = (value: unknown): NcmPlaylistSummary[] => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM playlists response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load NCM playlists");
  }
  if (!Array.isArray(value.playlists)) {
    throw new Error("Invalid NCM playlists payload");
  }
  const playlists = value.playlists.map(parseNcmPlaylistSummary);
  if (playlists.some((playlist) => playlist === null)) {
    throw new Error("Invalid NCM playlists payload");
  }
  return playlists as NcmPlaylistSummary[];
};

const parseNcmTrackSummary = (value: unknown): NcmTrackSummary | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isString(value.id) ||
    !isInteger(value.song_id) ||
    !isString(value.source_path) ||
    !isNullableString(value.title) ||
    !isNullableString(value.artist) ||
    !isNullableString(value.album) ||
    !isNullableNumber(value.duration_secs) ||
    !isNullableString(value.artwork_url)
  ) {
    return null;
  }
  return {
    id: value.id,
    songId: value.song_id,
    source_path: value.source_path,
    title: value.title,
    artist: value.artist,
    album: value.album,
    duration_secs: value.duration_secs,
    artworkUrl: value.artwork_url,
    size_bytes: isNullableInteger(value.size_bytes) ? value.size_bytes : null
  };
};

const parseNcmTracksResponse = (value: unknown): NcmTrackSummary[] => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM tracks response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load NCM tracks");
  }
  if (!Array.isArray(value.tracks)) {
    throw new Error("Invalid NCM tracks payload");
  }
  const tracks = value.tracks.map(parseNcmTrackSummary);
  if (tracks.some((track) => track === null)) {
    throw new Error("Invalid NCM tracks payload");
  }
  return tracks as NcmTrackSummary[];
};

const parseNcmCloudTracksResponse = (value: unknown): NcmCloudTracksPage => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM cloud response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load NCM cloud tracks");
  }
  if (
    !Array.isArray(value.tracks) ||
    !isInteger(value.count) ||
    !isInteger(value.size_bytes) ||
    !isInteger(value.max_size_bytes)
  ) {
    throw new Error("Invalid NCM cloud payload");
  }
  const tracks = value.tracks.map(parseNcmTrackSummary);
  if (tracks.some((track) => track === null)) {
    throw new Error("Invalid NCM cloud payload");
  }
  return {
    tracks: tracks as NcmTrackSummary[],
    count: value.count,
    sizeBytes: value.size_bytes,
    maxSizeBytes: value.max_size_bytes
  };
};

const parseNcmHomeFeedCard = (value: unknown): NcmHomeFeedCard | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isInteger(value.id) ||
    !isString(value.title) ||
    !isNullableString(value.subtitle) ||
    !isNullableString(value.cover_url) ||
    !isNullableNumber(value.play_count) ||
    !isNullableString(value.description)
  ) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    subtitle: value.subtitle,
    coverUrl: value.cover_url,
    playCount: value.play_count,
    description: value.description
  };
};

const parseNcmHomeTrackCover = (value: unknown): NcmHomeTrackCover | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (!isInteger(value.id) || !isNullableString(value.url)) {
    return null;
  }
  return {
    id: value.id,
    url: value.url
  };
};

const parseNcmHomePersonalFmPreview = (value: unknown): NcmHomePersonalFmPreview | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isString(value.title) ||
    !isNullableString(value.artist) ||
    !isNullableString(value.album) ||
    !isNullableString(value.cover_url)
  ) {
    return null;
  }
  return {
    title: value.title,
    artist: value.artist,
    album: value.album,
    coverUrl: value.cover_url
  };
};

const parseNcmHomeFeedError = (value: unknown): NcmHomeFeedError | null => {
  if (!isRecord(value) || !isString(value.section) || !isString(value.message)) {
    return null;
  }
  return {
    section: value.section,
    message: value.message
  };
};

const parseArray = <T>(
  value: unknown,
  parse: (item: unknown) => T | null,
  errorMessage: string
): T[] => {
  if (!Array.isArray(value)) {
    throw new Error(errorMessage);
  }
  const parsed = value.map(parse);
  if (parsed.some((item) => item === null)) {
    throw new Error(errorMessage);
  }
  return parsed as T[];
};

const parseStringItem = (value: unknown): string | null =>
  isString(value) ? value : null;

const parseNcmDiscoverCard = (value: unknown): NcmDiscoverCard | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isInteger(value.id) ||
    !isString(value.title) ||
    !isNullableString(value.subtitle) ||
    !isNullableString(value.cover_url) ||
    !isNullableInteger(value.cursor)
  ) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    subtitle: value.subtitle,
    coverUrl: value.cover_url,
    cursor: value.cursor
  };
};

const parseNcmDiscoverCardsPageResponse = (value: unknown): NcmDiscoverCardsPage => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM discover cards response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load NCM discover cards");
  }
  if (!isBoolean(value.has_more)) {
    throw new Error("Invalid NCM discover cards payload");
  }
  return {
    items: parseArray(value.items, parseNcmDiscoverCard, "Invalid NCM discover cards payload"),
    hasMore: value.has_more
  };
};

const parseNcmDiscoverCardsResponse = (value: unknown): NcmDiscoverCard[] => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM discover cards response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load NCM discover cards");
  }
  return parseArray(value.items, parseNcmDiscoverCard, "Invalid NCM discover cards payload");
};

const parseNcmDiscoverToplistTrack = (value: unknown): NcmDiscoverToplistTrack | null => {
  if (!isRecord(value) || !isString(value.title) || !isNullableString(value.artist)) {
    return null;
  }
  return {
    title: value.title,
    artist: value.artist
  };
};

const parseNcmDiscoverToplist = (value: unknown): NcmDiscoverToplist | null => {
  const card = parseNcmDiscoverCard(value);
  if (!card || !isRecord(value) || !isNullableString(value.description) || !isBoolean(value.is_official)) {
    return null;
  }
  return {
    ...card,
    description: value.description,
    tracks: parseArray(value.tracks, parseNcmDiscoverToplistTrack, "Invalid NCM discover toplist tracks payload"),
    isOfficial: value.is_official
  };
};

const parseNcmDiscoverToplistsResponse = (value: unknown): NcmDiscoverToplist[] => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM discover toplists response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load NCM discover toplists");
  }
  return parseArray(value.toplists, parseNcmDiscoverToplist, "Invalid NCM discover toplists payload");
};

const parseNcmDiscoverPlaylistCategoryEntry = (value: unknown): NcmDiscoverPlaylistCategoryEntry | null => {
  if (!isRecord(value) || !isString(value.name) || !isInteger(value.category) || !isBoolean(value.hot)) {
    return null;
  }
  return {
    name: value.name,
    category: value.category,
    hot: value.hot
  };
};

const parseNcmDiscoverPlaylistCategoriesResponse = (value: unknown): NcmDiscoverPlaylistCategories => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM discover categories response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load NCM discover categories");
  }
  const categories = isRecord(value.categories) ? value.categories : null;
  if (!categories || !isStringRecord(categories.categories)) {
    throw new Error("Invalid NCM discover categories payload");
  }
  return {
    categories: categories.categories as Record<number, string>,
    entries: parseArray(categories.entries, parseNcmDiscoverPlaylistCategoryEntry, "Invalid NCM discover category entries payload"),
    hqNames: parseArray(categories.hq_names, parseStringItem, "Invalid NCM discover highquality tags payload")
  };
};

const parseNcmHomeFeedResponse = (value: unknown): NcmHomeFeed => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM home feed response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load NCM home feed");
  }
  const feed = isRecord(value.feed) ? value.feed : null;
  if (!feed) {
    throw new Error("Invalid NCM home feed payload");
  }
  const personalFmPreview =
    feed.personal_fm_preview === null
      ? null
      : parseNcmHomePersonalFmPreview(feed.personal_fm_preview);
  if (personalFmPreview === null && feed.personal_fm_preview !== null) {
    throw new Error("Invalid NCM home feed personal FM payload");
  }
  return {
    dailyPicks: parseArray(feed.daily_picks, parseNcmHomeFeedCard, "Invalid NCM home feed daily picks payload"),
    dailySongCovers: parseArray(feed.daily_song_covers, parseNcmHomeTrackCover, "Invalid NCM home feed daily song covers payload"),
    likedSongCovers: parseArray(feed.liked_song_covers, parseNcmHomeTrackCover, "Invalid NCM home feed liked song covers payload"),
    personalFmCovers: parseArray(feed.personal_fm_covers, parseNcmHomeTrackCover, "Invalid NCM home feed personal FM covers payload"),
    personalFmPreview,
    radarPlaylists: parseArray(feed.radar_playlists, parseNcmHomeFeedCard, "Invalid NCM home feed radar payload"),
    recommendedPlaylists: parseArray(feed.recommended_playlists, parseNcmHomeFeedCard, "Invalid NCM home feed playlists payload"),
    newAlbums: parseArray(feed.new_albums, parseNcmHomeFeedCard, "Invalid NCM home feed albums payload"),
    featuredArtists: parseArray(feed.featured_artists, parseNcmHomeFeedCard, "Invalid NCM home feed artists payload"),
    recommendedMvs: parseArray(feed.recommended_mvs, parseNcmHomeFeedCard, "Invalid NCM home feed MVs payload"),
    podcasts: parseArray(feed.podcasts, parseNcmHomeFeedCard, "Invalid NCM home feed podcasts payload"),
    errors: parseArray(feed.errors, parseNcmHomeFeedError, "Invalid NCM home feed errors payload")
  };
};

const parseNcmLikelistIdsResponse = (value: unknown): number[] => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM likelist response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load NCM likelist");
  }
  if (!Array.isArray(value.ids)) {
    throw new Error("Invalid NCM likelist payload");
  }
  const ids = value.ids.filter(isInteger);
  if (ids.length !== value.ids.length) {
    throw new Error("Invalid NCM likelist payload");
  }
  return ids;
};

const readNullableIntegerField = (record: Record<string, unknown>, key: string): number | null => {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (!isInteger(value)) {
    throw new Error(`Invalid queue adjacent ${key}`);
  }
  return value;
};

const parseQueueAdjacentResponse = (value: unknown): QueueAdjacent => {
  if (!isRecord(value) || value.status !== "success") {
    throw new Error("Invalid queue adjacent response");
  }
  return {
    previousEntryId: readNullableIntegerField(value, "previous_entry_id"),
    nextEntryId: readNullableIntegerField(value, "next_entry_id")
  };
};

const requestEnvelope = (baseUrl: string, path: string, init?: RequestInit) =>
  requestTransportEnvelope(baseUrl, path, parseEnvelope, init);

const buildResolveNcmTrackBody = (input: ResolveNcmTrackInput) => ({
  song_id: input.songId,
  level: input.level ?? null,
  source_page_url: input.sourcePageUrl,
  title: input.title ?? null,
  artist: input.artist ?? null,
  album: input.album ?? null,
  duration_secs: input.durationSecs ?? null,
  artwork_url: input.artworkUrl ?? null
});

export const createApiClient = (baseUrl = resolveBaseUrl()): ApiClient => {
  // Eagerly warm the token cache so synchronous callers (e.g. `getCoverArtUrl`)
  // see a value as soon as possible after construction.
  void resolveApiToken();

  const effectsTransport: EffectsApiTransport = {
    requestJson: (path, init) => requestJson(baseUrl, path, init),
    requestEnvelope: (path, init) => requestEnvelope(baseUrl, path, init)
  };
  const playbackTransport: PlaybackApiTransport = {
    requestEnvelope: (path, init) => requestEnvelope(baseUrl, path, init)
  };
  const effectsClient = createEffectsApiClient(effectsTransport);
  const playbackClient = createPlaybackApiClient(playbackTransport);

  return {
  ...playbackClient,
  getQueueStatus: async () => {
    const json = await requestJson(baseUrl, "/queue_status");
    return parseQueueStatusResponse(json);
  },
  queueNext: async (path: string) => {
    const envelope = await requestEnvelope(baseUrl, "/queue_next", {
      method: "POST",
      body: JSON.stringify({ path })
    });
    if (envelope.status === "error") {
      throw new Error(envelope.message ?? "Failed to queue next track");
    }
  },
  cancelPreload: async () => {
    const envelope = await requestEnvelope(baseUrl, "/cancel_preload", {
      method: "POST"
    });
    if (envelope.status === "error") {
      throw new Error(envelope.message ?? "Failed to cancel preload");
    }
  },
  getSettings: async () => {
    const json = await requestJson(baseUrl, "/settings");
    return parseSettingsResponse(json);
  },
  saveSettings: async (settings: PersistentSettingsUpdate) => {
    const json = await requestJson(baseUrl, "/save_settings", {
      method: "POST",
      body: JSON.stringify({ settings })
    });
    const response = parseStatusMessage(json);
    if (response.status === "error") {
      throw new Error(response.message ?? "Failed to save settings");
    }
  },
  ...effectsClient,
  getLibraryRoots: async () => {
    const json = await requestJson(baseUrl, "/domain/library/roots");
    if (!isRecord(json) || json.status !== "success" || !Array.isArray(json.roots)) {
      throw new Error("Invalid library roots response");
    }
    return json.roots as LibraryRoot[];
  },
  scanLibraryRoot: async (path: string, displayName?: string, sourceKey?: string) => {
    const body: Record<string, string> = { path };
    if (displayName) body.display_name = displayName;
    if (sourceKey) body.source_key = sourceKey;
    const json = await requestJson(baseUrl, "/domain/library/scan", {
      method: "POST",
      body: JSON.stringify(body)
    });
    if (!isRecord(json) || json.status !== "success") {
      throw new Error(typeof json === "object" && json !== null && "message" in json ? String(json.message) : "Failed to scan library");
    }
    return {
      root_id: json.root_id as number,
      task_id: json.task_id as number,
      scanned_files: json.scanned_files as number,
      indexed_files: json.indexed_files as number
    };
  },
  deleteLibraryRoot: async (rootId: number) => {
    const json = await requestJson(baseUrl, `/domain/library/roots/${rootId}`, {
      method: "DELETE"
    });
    const response = parseStatusMessage(json);
    if (response.status === "error") {
      throw new Error(response.message ?? "Failed to delete library root");
    }
  },
  getLibraryScanTask: async (taskId: number) => {
    const json = await requestJson(baseUrl, `/domain/library/scan_tasks/${taskId}`);
    if (!isRecord(json) || json.status !== "success" || !isRecord(json.task)) {
      throw new Error("Invalid library scan task response");
    }
    return json.task as unknown as LibraryScanTask;
  },
  getMediaItems: async (limit = 100, all = false) => {
    const query = all ? "all=true" : `limit=${limit}`;
    const json = await requestJson(baseUrl, `/domain/media_items?${query}`);
    if (!isRecord(json) || json.status !== "success" || !Array.isArray(json.media_items)) {
      throw new Error("Invalid media items response");
    }
    return json.media_items as MediaItem[];
  },
  getLibraryTrackSummaries: async () => {
    const json = await requestJson(baseUrl, "/domain/library/track_summaries");
    return parseLibraryTrackSummariesResponse(json);
  },
  getLibraryTrackDetail: async (trackKey: number) => {
    const json = await requestJson(baseUrl, `/domain/library/tracks/${encodeURIComponent(String(trackKey))}`);
    return parseLibraryTrackDetailResponse(json);
  },
  replaceQueueFromLibraryQuery: async (input: LibraryQueueQueryInput) => {
    const json = await requestJson(baseUrl, "/domain/library/queue_from_query", {
      method: "POST",
      body: JSON.stringify({
        search: input.search ?? null,
        folder_path: input.folderPath ?? null,
        sort_field: input.sortField ?? null,
        sort_order: input.sortOrder ?? null,
        start_track_key: input.startTrackKey ?? null
      })
    });
    return parseLibraryQueuePlaybackResponse(json);
  },
  replaceQueueFromTrackKeys: async (input: LibraryQueueTrackKeysInput) => {
    const json = await requestJson(baseUrl, "/domain/library/queue_from_track_keys", {
      method: "POST",
      body: JSON.stringify({
        track_keys: input.trackKeys,
        start_track_key: input.startTrackKey ?? null
      })
    });
    return parseLibraryQueuePlaybackResponse(json);
  },
  deleteMediaItems: async (mediaIds: string[]) => {
    const json = await requestJson(baseUrl, "/domain/media_items/delete", {
      method: "POST",
      body: JSON.stringify({ media_ids: mediaIds })
    });
    if (!isRecord(json) || json.status !== "success" || !isInteger(json.deleted_count)) {
      throw new Error("Failed to delete media items");
    }
    return json.deleted_count;
  },
  listLocalPlaylists: async () => {
    const json = await requestJson(baseUrl, "/domain/local_playlists");
    return parseLocalPlaylistsResponse(json);
  },
  createLocalPlaylist: async (input: LocalPlaylistCreateInput) => {
    const json = await requestJson(baseUrl, "/domain/local_playlists", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        description: input.description ?? null
      })
    });
    return parseLocalPlaylistResponse(json);
  },
  updateLocalPlaylist: async (playlistId: string, input: LocalPlaylistUpdateInput) => {
    const json = await requestJson(baseUrl, `/domain/local_playlists/${encodeURIComponent(playlistId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: input.name ?? null,
        description: input.description ?? null
      })
    });
    return parseLocalPlaylistResponse(json);
  },
  deleteLocalPlaylist: async (playlistId: string) => {
    const json = await requestJson(baseUrl, `/domain/local_playlists/${encodeURIComponent(playlistId)}`, {
      method: "DELETE"
    });
    const response = parseStatusMessage(json);
    if (response.status === "error") {
      throw new Error(response.message ?? "Failed to delete local playlist");
    }
  },
  getLocalPlaylist: async (playlistId: string) => {
    const json = await requestJson(baseUrl, `/domain/local_playlists/${encodeURIComponent(playlistId)}`);
    return parseLocalPlaylistDetailResponse(json);
  },
  addMediaToLocalPlaylist: async (playlistId: string, mediaIds: string[]) => {
    const json = await requestJson(baseUrl, `/domain/local_playlists/${encodeURIComponent(playlistId)}/items`, {
      method: "POST",
      body: JSON.stringify({ media_ids: mediaIds })
    });
    if (!isRecord(json) || json.status !== "success" || !isInteger(json.added_count)) {
      throw new Error("Failed to add media to local playlist");
    }
    return json.added_count;
  },
  removeMediaFromLocalPlaylist: async (playlistId: string, mediaIds: string[]) => {
    const json = await requestJson(baseUrl, `/domain/local_playlists/${encodeURIComponent(playlistId)}/items/remove`, {
      method: "POST",
      body: JSON.stringify({ media_ids: mediaIds })
    });
    if (!isRecord(json) || json.status !== "success" || !isInteger(json.removed_count)) {
      throw new Error("Failed to remove media from local playlist");
    }
    return json.removed_count;
  },
  saveExternalMediaMetadata: async (metadata: ExternalMediaMetadataInput) => {
    const json = await requestJson(baseUrl, "/domain/media_items/metadata", {
      method: "POST",
      body: JSON.stringify(metadata)
    });
    if (!isRecord(json) || json.status !== "success" || !isString(json.media_id)) {
      throw new Error("Failed to save external media metadata");
    }
    return json.media_id;
  },
  resolveNcmTrack: async (input: ResolveNcmTrackInput) => {
    const json = await requestJson(baseUrl, "/domain/ncm/track/resolve", {
      method: "POST",
      body: JSON.stringify(buildResolveNcmTrackBody(input))
    });
    return parseResolvedNcmTrackResponse(json);
  },
  playNcmTrack: async (input: ResolveNcmTrackInput) => {
    const json = await requestJson(baseUrl, "/domain/ncm/track/play", {
      method: "POST",
      body: JSON.stringify(buildResolveNcmTrackBody(input))
    });
    return parseNcmTrackPlaybackResponse(json);
  },
  enqueueNcmTrack: async (input: ResolveNcmTrackInput) => {
    const json = await requestJson(baseUrl, "/domain/ncm/track/enqueue", {
      method: "POST",
      body: JSON.stringify(buildResolveNcmTrackBody(input))
    });
    return parseNcmTrackQueueResponse(json);
  },
  resolveNcmTrackSupplement: async (songId: number) => {
    const json = await requestJson(baseUrl, "/domain/ncm/track/supplement", {
      method: "POST",
      body: JSON.stringify({
        song_id: songId
      })
    });
    return parseResolvedNcmTrackSupplementResponse(json);
  },
  getNcmAccounts: async () => {
    const json = await requestJson(baseUrl, "/domain/ncm/accounts");
    return parseNcmAccountStateResponse(json);
  },
  upsertNcmAccount: async (input: NcmAccountUpsertInput) => {
    const json = await requestJson(baseUrl, "/domain/ncm/accounts", {
      method: "POST",
      body: JSON.stringify({
        user_id: input.userId,
        nickname: input.nickname ?? null,
        avatar_url: input.avatarUrl ?? null,
        cookie: input.cookie,
        vip_type: input.vipType ?? null,
        level: input.level ?? null,
        signin_at_ms: input.signinAt ?? null
      })
    });
    return parseNcmAccountStateResponse(json);
  },
  setActiveNcmAccount: async (userId: number) => {
    const json = await requestJson(baseUrl, "/domain/ncm/accounts/active", {
      method: "POST",
      body: JSON.stringify({ user_id: userId })
    });
    return parseNcmAccountStateResponse(json);
  },
  refreshActiveNcmAccount: async () => {
    const json = await requestJson(baseUrl, "/domain/ncm/accounts/refresh", {
      method: "POST"
    });
    return parseNcmAccountStateResponse(json);
  },
  logoutActiveNcmAccount: async () => {
    const json = await requestJson(baseUrl, "/domain/ncm/accounts/logout", {
      method: "POST"
    });
    return parseNcmAccountStateResponse(json);
  },
  dailySigninActiveNcmAccount: async () => {
    const json = await requestJson(baseUrl, "/domain/ncm/accounts/daily_signin", {
      method: "POST"
    });
    return parseNcmAccountStateResponse(json);
  },
  deleteNcmAccount: async (userId: number) => {
    const json = await requestJson(baseUrl, `/domain/ncm/accounts/${userId}`, {
      method: "DELETE"
    });
    return parseNcmAccountStateResponse(json);
  },
  listNcmUserPlaylists: async (input: ListNcmUserPlaylistsInput) => {
    const json = await requestJson(baseUrl, "/domain/ncm/user/playlists", {
      method: "POST",
      body: JSON.stringify({
        uid: input.uid,
        limit: input.limit ?? null,
        offset: input.offset ?? null,
        mode: input.mode ?? null
      })
    });
    return parseNcmUserPlaylistsResponse(json);
  },
  searchNcmTracks: async (input: SearchNcmTracksInput) => {
    const json = await requestJson(baseUrl, "/domain/ncm/search/tracks", {
      method: "POST",
      body: JSON.stringify({
        keywords: input.keywords,
        limit: input.limit ?? null,
        offset: input.offset ?? null
      })
    });
    return parseNcmTracksResponse(json);
  },
  searchNcmPlaylists: async (input: SearchNcmTracksInput) => {
    const json = await requestJson(baseUrl, "/domain/ncm/search/playlists", {
      method: "POST",
      body: JSON.stringify({
        keywords: input.keywords,
        limit: input.limit ?? null,
        offset: input.offset ?? null
      })
    });
    return parseNcmUserPlaylistsResponse(json);
  },
  listNcmPlaylistTracks: async (input: ListNcmPlaylistTracksInput) => {
    const json = await requestJson(baseUrl, "/domain/ncm/playlist/tracks", {
      method: "POST",
      body: JSON.stringify({
        id: input.id,
        limit: input.limit ?? null,
        offset: input.offset ?? null
      })
    });
    return parseNcmTracksResponse(json);
  },
  listNcmDailySongTracks: async () => {
    const json = await requestJson(baseUrl, "/domain/ncm/recommend/songs/tracks", {
      method: "POST"
    });
    return parseNcmTracksResponse(json);
  },
  listNcmSongDetailTracks: async (ids: number[]) => {
    const json = await requestJson(baseUrl, "/domain/ncm/song/details/tracks", {
      method: "POST",
      body: JSON.stringify({ ids })
    });
    return parseNcmTracksResponse(json);
  },
  listNcmPersonalFmTracks: async () => {
    const json = await requestJson(baseUrl, "/domain/ncm/personal_fm/tracks", {
      method: "POST"
    });
    return parseNcmTracksResponse(json);
  },
  trashNcmPersonalFmTrack: async (songId: number) => {
    const json = await requestJson(baseUrl, "/domain/ncm/personal_fm/trash", {
      method: "POST",
      body: JSON.stringify({ song_id: songId })
    });
    const response = parseStatusMessage(json);
    if (response.status === "error") {
      throw new Error(response.message ?? "Failed to dislike Personal FM track");
    }
  },
  listNcmAlbumTracks: async (id: number) => {
    const json = await requestJson(baseUrl, "/domain/ncm/album/tracks", {
      method: "POST",
      body: JSON.stringify({ id })
    });
    return parseNcmTracksResponse(json);
  },
  listNcmArtistTracks: async (id: number) => {
    const json = await requestJson(baseUrl, "/domain/ncm/artist/tracks", {
      method: "POST",
      body: JSON.stringify({ id })
    });
    return parseNcmTracksResponse(json);
  },
  getNcmLikelistIds: async (uid: number) => {
    const json = await requestJson(baseUrl, "/domain/ncm/user/likelist", {
      method: "POST",
      body: JSON.stringify({ uid })
    });
    return parseNcmLikelistIdsResponse(json);
  },
  listNcmCloudTracks: async (input: ListNcmCloudTracksInput) => {
    const json = await requestJson(baseUrl, "/domain/ncm/user/cloud", {
      method: "POST",
      body: JSON.stringify({
        limit: input.limit ?? null,
        offset: input.offset ?? null
      })
    });
    return parseNcmCloudTracksResponse(json);
  },
  deleteNcmCloudTrack: async (songId: number) => {
    const json = await requestJson(baseUrl, "/domain/ncm/user/cloud/delete", {
      method: "POST",
      body: JSON.stringify({ song_id: songId })
    });
    const response = parseStatusMessage(json);
    if (response.status === "error") {
      throw new Error(response.message ?? "Failed to delete NCM cloud track");
    }
  },
  getNcmHomeFeed: async (input?: GetNcmHomeFeedInput) => {
    const json = await requestJson(baseUrl, "/domain/ncm/home_feed", {
      method: "POST",
      body: JSON.stringify({
        user_id: input?.userId ?? null
      })
    });
    return parseNcmHomeFeedResponse(json);
  },
  listNcmDiscoverPlaylists: async (input: ListNcmDiscoverPlaylistsInput) => {
    const json = await requestJson(baseUrl, "/domain/ncm/discover/playlists", {
      method: "POST",
      body: JSON.stringify({
        cat: input.cat,
        kind: input.kind,
        limit: input.limit ?? null,
        offset: input.offset ?? null,
        before: input.before ?? null
      })
    });
    return parseNcmDiscoverCardsPageResponse(json);
  },
  listNcmDiscoverAlbums: async (input: ListNcmDiscoverAlbumsInput) => {
    const json = await requestJson(baseUrl, "/domain/ncm/discover/albums", {
      method: "POST",
      body: JSON.stringify({
        area: input.area,
        limit: input.limit ?? null,
        offset: input.offset ?? null
      })
    });
    return parseNcmDiscoverCardsPageResponse(json);
  },
  listNcmDiscoverArtists: async (input: ListNcmDiscoverArtistsInput) => {
    const json = await requestJson(baseUrl, "/domain/ncm/discover/artists", {
      method: "POST",
      body: JSON.stringify({
        type: input.type,
        area: input.area,
        initial: input.initial,
        limit: input.limit ?? null,
        offset: input.offset ?? null
      })
    });
    return parseNcmDiscoverCardsResponse(json);
  },
  listNcmDiscoverToplists: async () => {
    const json = await requestJson(baseUrl, "/domain/ncm/discover/toplists", {
      method: "POST"
    });
    return parseNcmDiscoverToplistsResponse(json);
  },
  listNcmDiscoverSongs: async (input: ListNcmDiscoverSongsInput) => {
    const json = await requestJson(baseUrl, "/domain/ncm/discover/songs", {
      method: "POST",
      body: JSON.stringify({ type: input.type })
    });
    return parseNcmTracksResponse(json);
  },
  getNcmDiscoverPlaylistCategories: async () => {
    const json = await requestJson(baseUrl, "/domain/ncm/discover/playlist_categories", {
      method: "POST"
    });
    return parseNcmDiscoverPlaylistCategoriesResponse(json);
  },
  getPersistentQueue: async () => {
    const json = await requestJson(baseUrl, "/domain/queue");
    if (!isRecord(json) || json.status !== "success" || !Array.isArray(json.queue)) {
      throw new Error("Invalid queue response");
    }
    return json.queue as QueueEntry[];
  },
  enqueueTrack: async (path: string) => {
    const json = await requestJson(baseUrl, "/domain/queue/enqueue", {
      method: "POST",
      body: JSON.stringify({ path })
    });
    if (!isRecord(json) || json.status !== "success" || !Array.isArray(json.queue)) {
      throw new Error("Failed to enqueue track");
    }
    return json.queue as QueueEntry[];
  },
  removeQueueEntry: async (entryId: number) => {
    const json = await requestJson(baseUrl, `/domain/queue/${entryId}`, {
      method: "DELETE"
    });
    if (!isRecord(json) || json.status !== "success" || !Array.isArray(json.queue)) {
      throw new Error("Failed to remove queue entry");
    }
    return json.queue as QueueEntry[];
  },
  clearPersistentQueue: async () => {
    const json = await requestJson(baseUrl, "/domain/queue/clear", {
      method: "POST"
    });
    if (!isRecord(json) || json.status !== "success") {
      throw new Error("Failed to clear queue");
    }
  },
  playFromQueue: async (options?: PlayQueueOptions) => {
    const body: Record<string, unknown> = {};
    if (options?.entryId !== undefined) body.entry_id = options.entryId;
    if (options?.sourcePath) body.source_path = options.sourcePath;
    const envelope = await requestEnvelope(baseUrl, "/domain/queue/play", {
      method: "POST",
      body: JSON.stringify(body)
    });
    if (envelope.status === "error") {
      throw new Error(envelope.message ?? "Failed to play from queue");
    }
    if (!envelope.state) {
      throw new Error("State missing from response");
    }
    return envelope.state;
  },
  playNextQueueEntry: async () => {
    const envelope = await requestEnvelope(baseUrl, "/domain/queue/play_next", {
      method: "POST"
    });
    if (envelope.status === "error" || !envelope.state) {
      throw new Error(envelope.message ?? "Failed to play next queue entry");
    }
    return envelope.state;
  },
  playPreviousQueueEntry: async () => {
    const envelope = await requestEnvelope(baseUrl, "/domain/queue/play_previous", {
      method: "POST"
    });
    if (envelope.status === "error" || !envelope.state) {
      throw new Error(envelope.message ?? "Failed to play previous queue entry");
    }
    return envelope.state;
  },
  getQueueAdjacent: async () => {
    const json = await requestJson(baseUrl, "/domain/queue/adjacent");
    return parseQueueAdjacentResponse(json);
  },
  replaceQueue: async (paths: string[]) => {
    const json = await requestJson(baseUrl, "/domain/queue", {
      method: "POST",
      body: JSON.stringify({ paths })
    });
    if (!isRecord(json) || json.status !== "success" || !Array.isArray(json.queue)) {
      throw new Error("Failed to replace queue");
    }
    return json.queue as QueueEntry[];
  },
  listWebDavSources: async () => {
    const json = await requestJson(baseUrl, "/domain/webdav/sources");
    if (!isRecord(json) || json.status !== "success" || !Array.isArray(json.sources)) {
      throw new Error("Invalid WebDAV sources response");
    }
    return json.sources as WebDavSource[];
  },
  upsertWebDavSource: async (sourceKey: string, displayName: string, baseUrl_: string, username?: string, password?: string, isDefault?: boolean) => {
    const json = await requestJson(baseUrl, "/domain/webdav/sources", {
      method: "POST",
      body: JSON.stringify({
        source_key: sourceKey,
        display_name: displayName,
        base_url: baseUrl_,
        username: username ?? null,
        password: password ?? null,
        is_default: isDefault ?? false
      })
    });
    if (!isRecord(json) || json.status !== "success") {
      throw new Error(typeof json === "object" && json !== null && "message" in json ? String(json.message) : "Failed to save WebDAV source");
    }
    return json.source as WebDavSource;
  },
  setDefaultWebDavSource: async (sourceKey: string) => {
    const json = await requestJson(baseUrl, "/domain/webdav/sources/default", {
      method: "POST",
      body: JSON.stringify({ source_key: sourceKey })
    });
    if (!isRecord(json) || json.status !== "success") {
      throw new Error("Failed to set default WebDAV source");
    }
    return json.source as WebDavSource;
  },
  deleteWebDavSource: async (sourceKey: string) => {
    const json = await requestJson(baseUrl, `/domain/webdav/sources/${encodeURIComponent(sourceKey)}`, {
      method: "DELETE"
    });
    if (!isRecord(json) || json.status !== "success") {
      throw new Error("Failed to delete WebDAV source");
    }
  },
  browseWebDav: async (path?: string) => {
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    const json = await requestJson(baseUrl, `/webdav/browse${query}`);
    if (!isRecord(json) || json.status !== "success" || !Array.isArray(json.entries)) {
      throw new Error(typeof json === "object" && json !== null && "message" in json ? String(json.message) : "Failed to browse WebDAV");
    }
    return { path: json.path as string, entries: json.entries as WebDavBrowseEntry[] };
  },
  getPlaybackHistory: async (limit = 50) => {
    const json = await requestJson(baseUrl, `/domain/playback_history?limit=${limit}`);
    if (!isRecord(json) || json.status !== "success" || !Array.isArray(json.history)) {
      throw new Error("Invalid playback history response");
    }
    return json.history as PlaybackHistoryEntry[];
  },
  getCurrentLyrics: async () => {
    return requestCurrentLyrics((path, init) => requestJson(baseUrl, path, init));
  },
  getCoverArtUrl: (mediaId: string) => {
    const token = peekApiToken();
    const params = new URLSearchParams({ media_id: mediaId });
    if (token) {
      params.set("token", token);
    }
    return `${baseUrl}/domain/media_items/cover_art?${params.toString()}`;
  },
  getLibraryTrackCoverArtUrl: (trackKey: number) => {
    const token = peekApiToken();
    const params = new URLSearchParams();
    if (token) {
      params.set("token", token);
    }
    const query = params.toString();
    return `${baseUrl}/domain/library/tracks/${encodeURIComponent(String(trackKey))}/cover_art${query ? `?${query}` : ""}`;
  }
  };
};

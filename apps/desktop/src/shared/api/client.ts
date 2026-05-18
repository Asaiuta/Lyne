import type {
  ApiEnvelope,
  ApiStatus,
  AudioDeviceInfo,
  DevicesResponse,
  PlaybackHistoryEntry,
  PlayerState,
  WebDavBrowseEntry,
  WebDavSource
} from "./types";
import { peekApiToken, resolveApiToken, resolveBaseUrl } from "./env";
import {
  getCurrentLyrics as requestCurrentLyrics,
  type CurrentLyricsResponse
} from "./lyrics";
import {
  createPlaybackApiClient,
  type PlaybackApiClient,
  type PlaybackApiTransport
} from "./playback";
import {
  createQueueApiClient,
  type QueueApiClient,
  type QueueApiTransport
} from "./queue";
import {
  createSettingsApiClient,
  type SettingsApiClient,
  type SettingsApiTransport
} from "./settings";
import { requestEnvelope as requestTransportEnvelope, requestJson } from "./transport";
import {
  createEffectsApiClient,
  type EffectsApiClient,
  type EffectsApiTransport
} from "./effects";
import {
  createLibraryApiClient,
  type LibraryApiClient,
  type LibraryApiTransport
} from "./library";
import {
  createNcmApiClient,
  type NcmApiClient,
  type NcmApiTransport
} from "./ncmClient";
export type { CurrentLyricsResponse, LyricLine, LyricWord } from "./lyrics";
export type { LoadOptions, PlaybackApiClient } from "./playback";
export type { PlayQueueOptions, QueueAdjacent, QueueApiClient } from "./queue";
export type { SettingsApiClient } from "./settings";
export type {
  ExternalMediaMetadataInput,
  LibraryApiClient,
  LibraryQueuePlaybackResult,
  LibraryQueueMediaIdsInput,
  LocalPlaylistCreateInput,
  LocalPlaylistUpdateInput
} from "./library";
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
  NcmArtistSummary,
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
export type { NcmApiClient } from "./ncmClient";

export interface ApiClient extends PlaybackApiClient, QueueApiClient, SettingsApiClient, EffectsApiClient, LibraryApiClient, NcmApiClient {
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

const requestEnvelope = (baseUrl: string, path: string, init?: RequestInit) =>
  requestTransportEnvelope(baseUrl, path, parseEnvelope, init);

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
  const queueTransport: QueueApiTransport = {
    requestJson: (path, init) => requestJson(baseUrl, path, init),
    requestEnvelope: (path, init) => requestEnvelope(baseUrl, path, init)
  };
  const settingsTransport: SettingsApiTransport = {
    requestJson: (path, init) => requestJson(baseUrl, path, init)
  };
  const libraryTransport: LibraryApiTransport = {
    requestJson: (path, init) => requestJson(baseUrl, path, init)
  };
  const ncmTransport: NcmApiTransport = {
    requestJson: (path, init) => requestJson(baseUrl, path, init),
    parsePlayerState
  };
  const effectsClient = createEffectsApiClient(effectsTransport);
  const playbackClient = createPlaybackApiClient(playbackTransport);
  const queueClient = createQueueApiClient(queueTransport);
  const settingsClient = createSettingsApiClient(settingsTransport);
  const libraryClient = createLibraryApiClient(libraryTransport);
  const ncmClient = createNcmApiClient(ncmTransport);

  return {
  ...playbackClient,
  ...queueClient,
  ...settingsClient,
  ...effectsClient,
  ...libraryClient,
  ...ncmClient,
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

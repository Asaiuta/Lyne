import type {
  ApiEnvelope,
  PlaybackHistoryEntry,
  WebDavBrowseEntry,
  WebDavSource
} from "./types";
import { peekApiToken, resolveApiToken, resolveBaseUrl } from "./env";
import {
  getCurrentLyrics as requestCurrentLyrics,
  type CurrentLyricsInput,
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
import {
  parseDevicesResponse,
  parsePlaybackHistoryEntry,
  parsePlayerState,
  parseWebDavBrowseEntry,
  parseWebDavSource
} from "./apiBoundaryParsers";
import {
  parseArray,
  parseStatus,
  isRecord,
  isString
} from "./ncmParserUtils";
export type { CurrentLyricsInput, CurrentLyricsResponse, LyricLine, LyricWord } from "./lyrics";
export type { LoadOptions, PlaybackApiClient } from "./playback";
export type { PlayQueueOptions, QueueAdjacent, QueueApiClient } from "./queue";
export type { SettingsApiClient } from "./settings";
export type {
  ExternalMediaMetadataInput,
  LibraryApiClient,
  LibraryQueuePlaybackResult,
  LibraryQueueMediaIdsInput,
  LibraryTrackGroupsInput,
  LibraryTrackViewInput,
  LocalPlaylistCreateInput,
  LocalPlaylistUpdateInput
} from "./library";
export type {
  GetNcmHomeFeedInput,
  ListNcmArtistTracksInput,
  ListNcmCloudTracksInput,
  ListNcmDiscoverAlbumsInput,
  ListNcmDiscoverArtistsInput,
  ListNcmDiscoverPlaylistsInput,
  ListNcmDiscoverSongsInput,
  ListNcmPlaylistTracksInput,
  ListNcmUserPlaylistsInput,
  MatchNcmCloudTrackInput,
  NcmAccountState,
  NcmAccountSummary,
  NcmAccountUpsertInput,
  NcmArtistSummary,
  NcmCloudTracksPage,
  NcmDailySongDislikeResult,
  NcmDailySongsResult,
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
  NcmPlaylistTracksUpdateResult,
  NcmTrackPlaybackResult,
  NcmTrackQueueResult,
  NcmTracksPage,
  NcmTrackSummary,
  NcmUserPlaylistMode,
  ResolveNcmTrackInput,
  ResolvedNcmTrack,
  ResolvedNcmTrackLyrics,
  ResolvedNcmTrackSupplement,
  SearchNcmTracksInput,
  UpdateNcmPlaylistTracksInput
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
  getCurrentLyrics: (input?: CurrentLyricsInput) => Promise<CurrentLyricsResponse>;
  // Cover Art
  getCoverArtUrl: (mediaId: string) => string;
  getLibraryTrackCoverArtUrl: (trackKey: number) => string;
}

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
    return parseArray(json.sources, parseWebDavSource, "Invalid WebDAV sources response");
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
    const source = parseWebDavSource(json.source);
    if (!source) {
      throw new Error("Invalid WebDAV source payload");
    }
    return source;
  },
  setDefaultWebDavSource: async (sourceKey: string) => {
    const json = await requestJson(baseUrl, "/domain/webdav/sources/default", {
      method: "POST",
      body: JSON.stringify({ source_key: sourceKey })
    });
    if (!isRecord(json) || json.status !== "success") {
      throw new Error("Failed to set default WebDAV source");
    }
    const source = parseWebDavSource(json.source);
    if (!source) {
      throw new Error("Invalid WebDAV source payload");
    }
    return source;
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
    if (!isRecord(json) || json.status !== "success" || !isString(json.path) || !Array.isArray(json.entries)) {
      throw new Error(typeof json === "object" && json !== null && "message" in json ? String(json.message) : "Failed to browse WebDAV");
    }
    return {
      path: json.path,
      entries: parseArray(json.entries, parseWebDavBrowseEntry, "Invalid WebDAV browse payload")
    };
  },
  getPlaybackHistory: async (limit = 50) => {
    const json = await requestJson(baseUrl, `/domain/playback_history?limit=${limit}`);
    if (!isRecord(json) || json.status !== "success" || !Array.isArray(json.history)) {
      throw new Error("Invalid playback history response");
    }
    return parseArray(json.history, parsePlaybackHistoryEntry, "Invalid playback history response");
  },
  getCurrentLyrics: async (input?: CurrentLyricsInput) => {
    return requestCurrentLyrics((path, init) => requestJson(baseUrl, path, init), input);
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

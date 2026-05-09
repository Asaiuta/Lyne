import type {
  ApiEnvelope,
  ApiStatus,
  AudioDeviceInfo,
  DevicesResponse,
  PlaybackHistoryEntry,
  LibraryRoot,
  MediaItem,
  PersistentSettings,
  PersistentSettingsUpdate,
  QueueEntry,
  QueueStatus,
  PlayerState,
  RepeatMode,
  ScanResult,
  ShuffleMode,
  WebDavBrowseEntry,
  WebDavSource
} from "./types";
import { invalidateApiToken, peekApiToken, resolveApiToken, resolveBaseUrl } from "./env";

export interface ApiClient {
  getState: () => Promise<PlayerState>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  load: (path: string, options?: LoadOptions) => Promise<PlayerState>;
  seek: (position: number) => Promise<PlayerState>;
  setVolume: (volume: number) => Promise<PlayerState>;
  setRepeatMode: (mode: RepeatMode) => Promise<PlayerState>;
  setShuffleMode: (mode: ShuffleMode) => Promise<PlayerState>;
  listDevices: () => Promise<DevicesResponse>;
  configureOutput: (deviceId: number | null, exclusive?: boolean) => Promise<PlayerState>;
  getQueueStatus: () => Promise<QueueStatus>;
  queueNext: (path: string) => Promise<void>;
  cancelPreload: () => Promise<void>;
  getSettings: () => Promise<PersistentSettings>;
  saveSettings: (settings: PersistentSettingsUpdate) => Promise<void>;
  // Library
  getLibraryRoots: () => Promise<LibraryRoot[]>;
  scanLibraryRoot: (path: string, displayName?: string, sourceKey?: string) => Promise<ScanResult>;
  getMediaItems: (limit?: number) => Promise<MediaItem[]>;
  // Persistent Queue
  getPersistentQueue: () => Promise<QueueEntry[]>;
  enqueueTrack: (path: string) => Promise<QueueEntry[]>;
  removeQueueEntry: (entryId: number) => Promise<QueueEntry[]>;
  clearPersistentQueue: () => Promise<void>;
  playFromQueue: (entryId?: number) => Promise<PlayerState>;
  replaceQueue: (paths: string[]) => Promise<QueueEntry[]>;
  // WebDAV
  listWebDavSources: () => Promise<WebDavSource[]>;
  upsertWebDavSource: (sourceKey: string, displayName: string, baseUrl: string, username?: string, password?: string, isDefault?: boolean) => Promise<WebDavSource>;
  setDefaultWebDavSource: (sourceKey: string) => Promise<WebDavSource>;
  deleteWebDavSource: (sourceKey: string) => Promise<void>;
  browseWebDav: (path?: string) => Promise<{ path: string; entries: WebDavBrowseEntry[] }>;
  // Playback History
  getPlaybackHistory: (limit?: number) => Promise<PlaybackHistoryEntry[]>;
  // Cover Art
  getCoverArtUrl: (mediaId: string) => string;
}

interface LoadOptions {
  autoplay?: boolean;
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
  "media_id"
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

const requestJson = async (baseUrl: string, path: string, init?: RequestInit) => {
  const runRequest = async (forceTokenRefresh: boolean) => {
    const token = await resolveApiToken(forceTokenRefresh);
    const headers = new Headers(init?.headers ?? {});
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers
    });
  };

  let response = await runRequest(false);
  if (response.status === 401) {
    invalidateApiToken();
    response = await runRequest(true);
  }

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as unknown;
};

const requestEnvelope = async (baseUrl: string, path: string, init?: RequestInit) => {
  const json = await requestJson(baseUrl, path, init);
  return parseEnvelope(json);
};

export const createApiClient = (baseUrl = resolveBaseUrl()): ApiClient => {
  // Eagerly warm the token cache so synchronous callers (e.g. `getCoverArtUrl`)
  // see a value as soon as possible after construction.
  void resolveApiToken();

  return {
  getState: async () => {
    const envelope = await requestEnvelope(baseUrl, "/state");
    if (envelope.status === "error") {
      throw new Error(envelope.message ?? "Failed to fetch state");
    }
    if (!envelope.state) {
      throw new Error("State missing from response");
    }
    return envelope.state;
  },
  play: async () => {
    const envelope = await requestEnvelope(baseUrl, "/play", { method: "POST" });
    if (envelope.status === "error") {
      throw new Error(envelope.message ?? "Failed to play");
    }
  },
  pause: async () => {
    const envelope = await requestEnvelope(baseUrl, "/pause", { method: "POST" });
    if (envelope.status === "error") {
      throw new Error(envelope.message ?? "Failed to pause");
    }
  },
  stop: async () => {
    const envelope = await requestEnvelope(baseUrl, "/stop", { method: "POST" });
    if (envelope.status === "error") {
      throw new Error(envelope.message ?? "Failed to stop");
    }
  },
  load: async (path: string, options?: LoadOptions) => {
    const envelope = await requestEnvelope(baseUrl, "/load", {
      method: "POST",
      body: JSON.stringify({
        path,
        ...(options?.autoplay ? { autoplay: true } : {})
      })
    });
    if (envelope.status === "error") {
      throw new Error(envelope.message ?? "Failed to load");
    }
    if (!envelope.state) {
      throw new Error("State missing from response");
    }
    return envelope.state;
  },
  seek: async (position: number) => {
    const envelope = await requestEnvelope(baseUrl, "/seek", {
      method: "POST",
      body: JSON.stringify({ position })
    });
    if (envelope.status === "error") {
      throw new Error(envelope.message ?? "Failed to seek");
    }
    if (!envelope.state) {
      throw new Error("State missing from response");
    }
    return envelope.state;
  },
  setVolume: async (volume: number) => {
    const envelope = await requestEnvelope(baseUrl, "/volume", {
      method: "POST",
      body: JSON.stringify({ volume })
    });
    if (envelope.status === "error") {
      throw new Error(envelope.message ?? "Failed to set volume");
    }
    if (!envelope.state) {
      throw new Error("State missing from response");
    }
    return envelope.state;
  },
  setRepeatMode: async (mode: RepeatMode) => {
    const envelope = await requestEnvelope(baseUrl, "/repeat", {
      method: "POST",
      body: JSON.stringify({ mode })
    });
    if (envelope.status === "error") {
      throw new Error(envelope.message ?? "Failed to set repeat mode");
    }
    if (!envelope.state) {
      throw new Error("State missing from response");
    }
    return envelope.state;
  },
  setShuffleMode: async (mode: ShuffleMode) => {
    const envelope = await requestEnvelope(baseUrl, "/shuffle", {
      method: "POST",
      body: JSON.stringify({ mode })
    });
    if (envelope.status === "error") {
      throw new Error(envelope.message ?? "Failed to set shuffle mode");
    }
    if (!envelope.state) {
      throw new Error("State missing from response");
    }
    return envelope.state;
  },
  listDevices: async () => {
    const envelope = await requestEnvelope(baseUrl, "/devices");
    if (envelope.status === "error") {
      throw new Error(envelope.message ?? "Failed to list devices");
    }
    if (!envelope.devices) {
      throw new Error("Devices missing from response");
    }
    return envelope.devices;
  },
  getQueueStatus: async () => {
    const json = await requestJson(baseUrl, "/queue_status");
    return parseQueueStatusResponse(json);
  },
  configureOutput: async (deviceId: number | null, exclusive = false) => {
    const envelope = await requestEnvelope(baseUrl, "/configure_output", {
      method: "POST",
      body: JSON.stringify({ device_id: deviceId, exclusive })
    });
    if (envelope.status === "error") {
      throw new Error(envelope.message ?? "Failed to configure output");
    }
    if (!envelope.state) {
      throw new Error("State missing from response");
    }
    return envelope.state;
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
    return { root_id: json.root_id as number, scanned_files: json.scanned_files as number, indexed_files: json.indexed_files as number };
  },
  getMediaItems: async (limit = 100) => {
    const json = await requestJson(baseUrl, `/domain/media_items?limit=${limit}`);
    if (!isRecord(json) || json.status !== "success" || !Array.isArray(json.media_items)) {
      throw new Error("Invalid media items response");
    }
    return json.media_items as MediaItem[];
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
  playFromQueue: async (entryId?: number) => {
    const body: Record<string, unknown> = {};
    if (entryId !== undefined) body.entry_id = entryId;
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
  getCoverArtUrl: (mediaId: string) => {
    const token = peekApiToken();
    const suffix = token ? `?token=${encodeURIComponent(token)}` : "";
    return `${baseUrl}/domain/media_items/${encodeURIComponent(mediaId)}/cover_art${suffix}`;
  }
  };
};

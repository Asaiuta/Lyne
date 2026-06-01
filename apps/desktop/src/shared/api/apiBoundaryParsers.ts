import type {
  AudioDeviceInfo,
  DevicesResponse,
  LibraryScanTask,
  LibraryScanTaskPayload,
  MediaItem,
  PlaybackHistoryEntry,
  PlayerState,
  QueueEntry,
  ScanResult,
  WebDavBrowseEntry,
  WebDavSource
} from "./types";
import {
  defineParser,
  isBoolean,
  isInteger,
  isNullableString,
  isRecord,
  isString,
  parseArray
} from "./ncmParserUtils";

export const parseAudioDeviceInfo = defineParser<AudioDeviceInfo>({
  boolean: ["is_default"],
  integer: ["id"],
  nullableInteger: ["sample_rate"],
  string: ["name"]
});

export const parseDevicesResponse = (value: unknown): DevicesResponse | null => {
  if (!isRecord(value) || !isString(value.preferred_name)) return null;

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

export const parsePlayerState = defineParser<PlayerState>({
  boolean: [
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
  ],
  number: [
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
  ],
  integer: ["output_bits"],
  nullableInteger: [
    "device_id",
    "ncm_song_id",
    "target_samplerate",
    "track_number",
    "disc_number",
    "year"
  ],
  nullableNumber: [
    "rg_track_gain",
    "rg_album_gain",
    "rg_track_peak",
    "rg_album_peak"
  ],
  string: [
    "eq_type",
    "loudness_mode",
    "noise_shaper_curve",
    "resample_quality",
    "repeat_mode",
    "shuffle_mode"
  ],
  nullableString: [
    "file_path",
    "title",
    "artist",
    "album",
    "genre",
    "media_id",
    "ncm_source_page_url",
    "external_artwork_url"
  ]
});

export const parseMediaItem = defineParser<MediaItem>({
  boolean: ["has_cover_art"],
  integer: ["updated_at_epoch_secs"],
  nullableInteger: [
    "track_number",
    "disc_number",
    "year",
    "sample_rate",
    "channels",
    "bits_per_sample",
    "size_bytes"
  ],
  nullableNumber: ["duration_secs", "bitrate_bps"],
  nullableString: ["title", "artist", "album", "genre", "external_artwork_url"],
  string: ["media_id", "source_path", "source_kind"]
});

export const parseQueueEntry = defineParser<QueueEntry>({
  boolean: ["has_cover_art"],
  integer: ["entry_id", "position_index", "added_at_epoch_secs", "updated_at_epoch_secs"],
  nullableNumber: ["duration_secs"],
  nullableString: ["media_id", "title", "artist", "album", "external_artwork_url"],
  string: ["queue_id", "source_path", "status"]
});

export const parseQueueEntries = (value: unknown, errorMessage: string): QueueEntry[] =>
  parseArray(value, parseQueueEntry, errorMessage);

export const parseWebDavSource = defineParser<WebDavSource>({
  boolean: ["is_default"],
  integer: ["created_at_epoch_secs", "updated_at_epoch_secs"],
  nullableString: ["username"],
  string: ["source_key", "display_name", "base_url"]
});

export const parseWebDavBrowseEntry = defineParser<WebDavBrowseEntry>({
  boolean: ["is_dir"],
  string: ["href", "display_name", "url"]
});

export const parsePlaybackHistoryEntry = defineParser<PlaybackHistoryEntry>({
  boolean: ["has_cover_art"],
  integer: ["id", "event_at_epoch_secs"],
  nullableInteger: ["session_id", "ncm_song_id"],
  nullableNumber: ["position_secs", "duration_secs"],
  nullableString: [
    "media_id",
    "ncm_source_page_url",
    "title",
    "artist",
    "album",
    "external_artwork_url"
  ],
  string: ["source_path", "event_type"]
});

export const parseScanResult = (value: unknown): ScanResult | null => {
  if (!isRecord(value)) return null;
  if (
    !isInteger(value.root_id) ||
    !isInteger(value.task_id) ||
    !isInteger(value.scanned_files) ||
    !isInteger(value.indexed_files)
  ) {
    return null;
  }
  return {
    root_id: value.root_id,
    task_id: value.task_id,
    scanned_files: value.scanned_files,
    indexed_files: value.indexed_files
  };
};

const parseLibraryScanTaskPayload = defineParser<LibraryScanTaskPayload>({
  optionalInteger: [
    "root_id",
    "scanned_files",
    "indexed_files",
    "removed_files"
  ],
  optionalNullableString: ["source_key"],
  optionalString: ["source_kind", "display_name"]
});

export const parseLibraryScanTask = (value: unknown): LibraryScanTask | null => {
  if (!isRecord(value)) return null;
  const result =
    value.result === null || value.result === undefined
      ? null
      : parseLibraryScanTaskPayload(value.result);
  if (
    !isInteger(value.task_id) ||
    value.task_type !== "library_scan" ||
    !isString(value.source_path) ||
    !isString(value.status) ||
    !isBoolean(value.store_result) ||
    !isInteger(value.created_at_epoch_secs) ||
    !isInteger(value.updated_at_epoch_secs) ||
    (result === null && value.result !== null && value.result !== undefined) ||
    !isNullableString(value.error)
  ) {
    return null;
  }
  return {
    task_id: value.task_id,
    task_type: "library_scan",
    source_path: value.source_path,
    status: value.status,
    store_result: value.store_result,
    created_at_epoch_secs: value.created_at_epoch_secs,
    updated_at_epoch_secs: value.updated_at_epoch_secs,
    result,
    error: value.error
  };
};

import { parseCurrentLyricsResponse } from "./lyrics";
import type {
  NcmDailySongDislikeResult,
  NcmDailySongsResult,
  NcmTrackPlaybackResult,
  NcmTrackQueueResult,
  NcmTracksPage,
  NcmTrackSummary,
  ResolvedNcmTrack,
  ResolvedNcmTrackSupplement
} from "./ncmDomainTypes";
import {
  isInteger,
  isBoolean,
  isNullableNumber,
  isNullableString,
  isNullableInteger,
  isRecord,
  isString,
  parseStatus
} from "./ncmParserUtils";
import type { PlayerState, QueueEntry } from "./types";

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

export const parseResolvedNcmTrackResponse = (value: unknown): ResolvedNcmTrack => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM track response shape");
  }

  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to resolve NCM track");
  }

  return parseResolvedNcmTrack(value.track, "Invalid NCM track payload");
};

export const parseNcmTrackPlaybackResponse = (
  value: unknown,
  parsePlayerState: (value: unknown) => PlayerState | null
): NcmTrackPlaybackResult => {
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

export const parseNcmTrackQueueResponse = (value: unknown): NcmTrackQueueResult => {
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

export const parseResolvedNcmTrackSupplementResponse = (value: unknown): ResolvedNcmTrackSupplement => {
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
    !Array.isArray(supplement.artists) ||
    !isNullableString(supplement.album) ||
    !isNullableString(supplement.cover_url) ||
    !isNullableString(supplement.dynamic_cover_url) ||
    !Array.isArray(supplement.lyrics) ||
    !isNullableString(supplement.detail_error) ||
    !isNullableString(supplement.lyrics_error) ||
    !isNullableString(supplement.dynamic_cover_error)
  ) {
    throw new Error("Invalid NCM supplement payload");
  }

  const lyrics = parseCurrentLyricsResponse({
    status: "success",
    lyrics: supplement.lyrics,
    source: null
  }).lyrics;
  const artists = supplement.artists
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      id: item.id,
      name: item.name
    }))
    .filter(
      (item): item is { id: number; name: string } =>
        isInteger(item.id) && isString(item.name) && item.name.trim().length > 0
    );

  return {
    songId: supplement.song_id,
    title: supplement.title,
    artist: supplement.artist,
    artists,
    album: supplement.album,
    coverUrl: supplement.cover_url,
    dynamicCoverUrl: supplement.dynamic_cover_url,
    lyrics,
    detailError: supplement.detail_error,
    lyricsError: supplement.lyrics_error,
    dynamicCoverError: supplement.dynamic_cover_error
  };
};

export const parseNcmTrackSummary = (value: unknown): NcmTrackSummary | null => {
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
    !isNullableString(value.artwork_url) ||
    (value.quality_label !== undefined && !isNullableString(value.quality_label)) ||
    (value.privilege_tag !== undefined && !isNullableString(value.privilege_tag)) ||
    (value.explicit !== undefined && !isBoolean(value.explicit)) ||
    (value.original_tag !== undefined && !isNullableString(value.original_tag)) ||
    (value.mv_id !== undefined && !isNullableInteger(value.mv_id)) ||
    (value.is_cloud !== undefined && !isBoolean(value.is_cloud))
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
    size_bytes: isNullableInteger(value.size_bytes) ? value.size_bytes : null,
    qualityLabel: isNullableString(value.quality_label) ? value.quality_label : null,
    privilegeTag: isNullableString(value.privilege_tag) ? value.privilege_tag : null,
    explicit: isBoolean(value.explicit) ? value.explicit : false,
    originalTag: isNullableString(value.original_tag) ? value.original_tag : null,
    mvId: isNullableInteger(value.mv_id) ? value.mv_id : null,
    isCloud: isBoolean(value.is_cloud) ? value.is_cloud : false
  };
};

export const parseNcmTracksResponse = (value: unknown): NcmTrackSummary[] => {
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

export const parseNcmTracksPageResponse = (value: unknown): NcmTracksPage => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM tracks page response shape");
  }
  return {
    tracks: parseNcmTracksResponse(value),
    hasMore: isBoolean(value.has_more) ? value.has_more : false
  };
};

export const parseNcmDailySongsResponse = (value: unknown): NcmDailySongsResult => ({
  timestamp: Date.now(),
  tracks: parseNcmTracksResponse(value)
});

export const parseNcmDailySongDislikeResponse = (value: unknown): NcmDailySongDislikeResult => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM daily dislike response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to dislike daily song");
  }
  if (value.track === null || value.track === undefined) {
    return { track: null };
  }
  const track = parseNcmTrackSummary(value.track);
  if (!track) {
    throw new Error("Invalid NCM daily dislike track payload");
  }
  return { track };
};

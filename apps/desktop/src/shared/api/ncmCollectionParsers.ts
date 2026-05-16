import type { NcmCloudTracksPage, NcmPlaylistSummary } from "./ncmDomainTypes";
import {
  isBoolean,
  isInteger,
  isNullableInteger,
  isNullableString,
  isRecord,
  isString,
  parseStatus
} from "./ncmParserUtils";
import { parseNcmTrackSummary } from "./ncmTrackParsers";

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

export const parseNcmUserPlaylistsResponse = (value: unknown): NcmPlaylistSummary[] => {
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

export const parseNcmCloudTracksResponse = (value: unknown): NcmCloudTracksPage => {
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
    tracks: tracks as NcmCloudTracksPage["tracks"],
    count: value.count,
    sizeBytes: value.size_bytes,
    maxSizeBytes: value.max_size_bytes
  };
};

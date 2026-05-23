import type {
  NcmCloudTracksPage,
  NcmPlaylistSummary,
  NcmPlaylistTracksUpdateResult
} from "./ncmDomainTypes";
import {
  isBoolean,
  isInteger,
  isNullableInteger,
  isNullableNumber,
  isNullableString,
  isRecord,
  isString,
  parseStatus
} from "./ncmParserUtils";
import { parseNcmTrackSummary } from "./ncmTrackParsers";

export const parseNcmPlaylistSummary = (value: unknown): NcmPlaylistSummary | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isInteger(value.id) ||
    !isString(value.name) ||
    !isNullableInteger(value.user_id) ||
    !isNullableInteger(value.creator_id) ||
    !isNullableString(value.creator) ||
    !isNullableString(value.cover_url) ||
    !isNullableInteger(value.track_count) ||
    !isNullableNumber(value.play_count) ||
    !isNullableString(value.description) ||
    !Array.isArray(value.tags) ||
    !value.tags.every(isString) ||
    !isNullableInteger(value.create_time) ||
    !isNullableInteger(value.update_time) ||
    !isNullableInteger(value.privacy) ||
    !isBoolean(value.subscribed)
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    userId: value.user_id,
    creatorId: value.creator_id,
    creator: value.creator,
    coverUrl: value.cover_url,
    trackCount: value.track_count,
    playCount: value.play_count,
    description: value.description,
    tags: value.tags,
    createTime: value.create_time,
    updateTime: value.update_time,
    privacy: value.privacy,
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

export const parseNcmPlaylistDetailResponse = (value: unknown): NcmPlaylistSummary => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM playlist detail response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load NCM playlist detail");
  }
  const playlist = parseNcmPlaylistSummary(value.playlist);
  if (!playlist) {
    throw new Error("Invalid NCM playlist detail payload");
  }
  return playlist;
};

export const parseNcmPlaylistTracksUpdateResponse = (value: unknown): NcmPlaylistTracksUpdateResult => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM playlist track update response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to update NCM playlist tracks");
  }
  if (!isInteger(value.updated_count)) {
    throw new Error("Invalid NCM playlist track update payload");
  }
  return { updatedCount: value.updated_count };
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

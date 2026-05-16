import type {
  NcmHomeFeed,
  NcmHomeFeedCard,
  NcmHomeFeedError,
  NcmHomePersonalFmPreview,
  NcmHomeTrackCover
} from "./ncmDomainTypes";
import {
  isInteger,
  isNullableNumber,
  isNullableString,
  isRecord,
  isString,
  parseArray,
  parseStatus
} from "./ncmParserUtils";

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

export const parseNcmHomeFeedResponse = (value: unknown): NcmHomeFeed => {
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

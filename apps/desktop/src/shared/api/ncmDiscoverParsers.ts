import type {
  NcmDiscoverCard,
  NcmDiscoverCardsPage,
  NcmDiscoverPlaylistCategories,
  NcmDiscoverPlaylistCategoryEntry,
  NcmDiscoverToplist,
  NcmDiscoverToplistTrack
} from "./ncmDomainTypes";
import {
  isBoolean,
  isInteger,
  isNullableInteger,
  isNullableString,
  isRecord,
  isString,
  isStringRecord,
  parseArray,
  parseStatus,
  parseStringItem
} from "./ncmParserUtils";

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

export const parseNcmDiscoverCardsPageResponse = (value: unknown): NcmDiscoverCardsPage => {
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

export const parseNcmDiscoverCardsResponse = (value: unknown): NcmDiscoverCard[] => {
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

export const parseNcmDiscoverToplistsResponse = (value: unknown): NcmDiscoverToplist[] => {
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

export const parseNcmDiscoverPlaylistCategoriesResponse = (value: unknown): NcmDiscoverPlaylistCategories => {
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

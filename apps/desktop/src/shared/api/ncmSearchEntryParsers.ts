import type { NcmResponseEnvelope } from "./ncm/base";
import { isRecord } from "./ncmParserUtils";

export type NcmSearchSuggestionType = "song" | "artist" | "album" | "playlist" | "video" | "radio";

export interface NcmSearchDefaultKeyword {
  showKeyword: string;
  realKeyword: string;
}

export interface NcmSearchHotItem {
  keyword: string;
  content: string | null;
  score: number | null;
  iconUrl: string | null;
}

export interface NcmSearchSuggestionItem {
  keyword: string;
  type: NcmSearchSuggestionType;
  subtitle: string | null;
}

const SUGGESTION_LIMIT = 8;

const readArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const readPayloadData = (payload: NcmResponseEnvelope): Record<string, unknown> | null => {
  if (isRecord(payload.data)) return payload.data;
  if (isRecord(payload.result)) return payload.result;
  return isRecord(payload) ? payload : null;
};

const readArtists = (value: unknown): string | null => {
  const names = readArray(value)
    .map((item) => (isRecord(item) ? readString(item.name) : readString(item)))
    .filter((item): item is string => item !== null);
  return names.length > 0 ? names.join(" / ") : null;
};

const readNestedName = (value: unknown): string | null => {
  if (!isRecord(value)) return null;
  return readString(value.nickname) ?? readString(value.name) ?? readString(value.userName);
};

const readDefaultKeyword = (value: Record<string, unknown>): NcmSearchDefaultKeyword | null => {
  const showKeyword = readString(value.showKeyword) ?? readString(value.searchWord);
  const realKeyword = readString(value.realkeyword) ?? readString(value.realKeyword) ?? showKeyword;
  if (!showKeyword || !realKeyword) return null;
  return { showKeyword, realKeyword };
};

const parseSuggestionItem = (
  value: unknown,
  type: NcmSearchSuggestionType
): NcmSearchSuggestionItem | null => {
  if (!isRecord(value)) return null;
  const keyword = readString(value.name ?? value.title ?? value.keyword);
  if (!keyword) return null;
  const creator = Array.isArray(value.creator) ? value.creator[0] : value.creator;
  const album = isRecord(value.album) ? value.album : isRecord(value.al) ? value.al : null;
  const subtitle =
    readArtists(value.artists) ??
    readArtists(value.artist) ??
    readArtists(value.ar) ??
    readString(value.artistName) ??
    (album ? readString(album.name) : null) ??
    readNestedName(creator) ??
    readNestedName(value.dj) ??
    readString(value.description);
  return { keyword, type, subtitle };
};

const uniqueSuggestionItems = (
  items: readonly NcmSearchSuggestionItem[]
): NcmSearchSuggestionItem[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.type}:${item.keyword}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const parseNcmSearchDefaultKeyword = (
  payload: NcmResponseEnvelope
): NcmSearchDefaultKeyword | null => {
  const data = readPayloadData(payload);
  return data ? readDefaultKeyword(data) : null;
};

export const parseNcmSearchHotDetail = (payload: NcmResponseEnvelope): NcmSearchHotItem[] => {
  const data = isRecord(payload) ? readArray(payload.data) : [];
  return data
    .map((value): NcmSearchHotItem | null => {
      if (!isRecord(value)) return null;
      const keyword = readString(value.searchWord ?? value.first);
      if (!keyword) return null;
      return {
        keyword,
        content: readString(value.content ?? value.second),
        score: readNumber(value.score),
        iconUrl: readString(value.iconUrl)
      };
    })
    .filter((item): item is NcmSearchHotItem => item !== null);
};

export const parseNcmSearchSuggestions = (
  payload: NcmResponseEnvelope,
  limit = SUGGESTION_LIMIT
): NcmSearchSuggestionItem[] => {
  const result = readPayloadData(payload);
  if (!result) return [];

  const order = readArray(result.order)
    .map(readString)
    .filter((item): item is string => item !== null);
  const orderedKeys = order.length > 0 ? order : ["songs", "artists", "albums", "playlists", "mvs", "videos", "djRadios"];

  const typeByKey: Record<string, NcmSearchSuggestionType> = {
    songs: "song",
    artists: "artist",
    albums: "album",
    playlists: "playlist",
    mvs: "video",
    videos: "video",
    djRadios: "radio",
    radios: "radio",
    djprograms: "radio"
  };

  const items = orderedKeys.flatMap((key) => {
    const type = typeByKey[key];
    if (!type) return [];
    return readArray(result[key])
      .map((item) => parseSuggestionItem(item, type))
      .filter((item): item is NcmSearchSuggestionItem => item !== null);
  });

  return uniqueSuggestionItems(items).slice(0, Math.max(0, limit));
};

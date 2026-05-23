import type { NcmResponseEnvelope } from "../../shared/api/ncm/base";
import { parseRadioCard } from "./radioParsers";
import type { DiscoverCardItem, FeedCardItem, SearchTab } from "./shared/types";

export const NCM_SEARCH_TYPES: Record<SearchTab, number> = {
  songs: 1,
  albums: 10,
  artists: 100,
  playlists: 1000,
  videos: 1004,
  radios: 1009
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const readNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const stableStringId = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash * 31) + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) || 1;
};

const readFirstString = (value: unknown): string | null =>
  readArray(value)
    .map(readString)
    .find((item): item is string => item !== null) ?? null;

const readNestedName = (value: unknown): string | null => {
  if (!isRecord(value)) return null;
  return readString(value.nickname) ?? readString(value.name) ?? readString(value.userName);
};

const readArtists = (value: unknown): string | null => {
  const names = readArray(value)
    .map((item) => (isRecord(item) ? readString(item.name) : readString(item)))
    .filter((name): name is string => name !== null);
  if (names.length > 0) return names.join(" / ");
  if (isRecord(value)) {
    return readString(value.name) ?? readString(value.artistName);
  }
  return null;
};

const readCoverUrl = (value: Record<string, unknown>): string | null => {
  const album = isRecord(value.album) ? value.album : isRecord(value.al) ? value.al : null;
  return (
    readString(value.cover) ??
    readString(value.picUrl) ??
    readString(value.coverUrl) ??
    readString(value.coverImgUrl) ??
    readString(value.imgurl) ??
    readString(value.img1v1Url) ??
    (album ? readString(album.picUrl) : null)
  );
};

const readSearchResult = (payload: NcmResponseEnvelope): Record<string, unknown> | null => {
  if (isRecord(payload.result)) return payload.result;
  if (isRecord(payload.data)) return payload.data;
  return isRecord(payload) ? payload : null;
};

const readSearchItems = (payload: NcmResponseEnvelope, keys: readonly string[]): unknown[] => {
  const result = readSearchResult(payload);
  if (!result) return [];
  const matched = keys
    .map((key) => readArray(result[key]))
    .find((items) => items.length > 0);
  return matched ?? [];
};

const readBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const parseSearchCoverItem = (
  value: unknown,
  options: { videoKind?: "mv" | "video" } = {}
): FeedCardItem | null => {
  if (!isRecord(value)) return null;
  const rawVideoId = readString(value.vid ?? value.id);
  const id = readNumber(value.id ?? value.vid) ?? (rawVideoId ? stableStringId(rawVideoId) : null);
  const title = readString(value.name ?? value.title);
  if (id === null || title === null) return null;
  const creator = Array.isArray(value.creator) ? value.creator[0] : value.creator;
  const subtitle =
    readArtists(value.artist) ??
    readArtists(value.artists) ??
    readArtists(value.ar) ??
    readString(value.artistName) ??
    readNestedName(creator) ??
    readNestedName(value.dj) ??
    readString(value.category);
  return {
    id,
    ...(options.videoKind === undefined ? {} : {
      videoId: rawVideoId ?? String(id),
      videoKind: options.videoKind
    }),
    title,
    subtitle,
    coverUrl: readCoverUrl(value),
    playCount: readNumber(value.playCount ?? value.listenerCount ?? value.subCount),
    description: readString(value.description ?? value.desc ?? value.copywriter ?? value.updateFrequency)
  };
};

const parseSearchArtist = (value: unknown): FeedCardItem | null => {
  if (!isRecord(value)) return null;
  const id = readNumber(value.id);
  const title = readString(value.name);
  if (id === null || title === null) return null;
  return {
    id,
    title,
    subtitle: readFirstString(value.alias) ?? readFirstString(value.identifyTag),
    coverUrl: readCoverUrl(value),
    playCount: readNumber(value.fans),
    description: readString(value.description ?? value.briefDesc)
  };
};

export const parseNcmSearchArtists = (payload: NcmResponseEnvelope): FeedCardItem[] =>
  readSearchItems(payload, ["artists"])
    .map(parseSearchArtist)
    .filter((item): item is FeedCardItem => item !== null);

export const parseNcmSearchAlbums = (payload: NcmResponseEnvelope): FeedCardItem[] =>
  readSearchItems(payload, ["albums"])
    .map((item) => parseSearchCoverItem(item))
    .filter((item): item is FeedCardItem => item !== null);

export const parseNcmSearchVideos = (payload: NcmResponseEnvelope): FeedCardItem[] =>
  [
    ...readSearchItems(payload, ["mvs"])
      .map((item) => parseSearchCoverItem(item, { videoKind: "mv" })),
    ...readSearchItems(payload, ["videos"])
      .map((item) => parseSearchCoverItem(item, { videoKind: "video" }))
  ].filter((item): item is FeedCardItem => item !== null);

export const parseNcmMvAllVideos = (payload: NcmResponseEnvelope): FeedCardItem[] =>
  readSearchItems(payload, ["data", "mvs", "videos"])
    .map((item) => parseSearchCoverItem(item, { videoKind: "mv" }))
    .filter((item): item is FeedCardItem => item !== null);

export const parseNcmMvAllCards = (payload: NcmResponseEnvelope): DiscoverCardItem[] =>
  parseNcmMvAllVideos(payload).map((item) => ({
    id: item.id,
    title: item.title,
    subtitle: item.subtitle,
    coverUrl: item.coverUrl,
    cursor: null
  }));

export const parseNcmArtistAlbums = (payload: NcmResponseEnvelope): {
  items: FeedCardItem[];
  hasMore: boolean;
} => ({
  items: readSearchItems(payload, ["hotAlbums", "albums"])
    .map((item) => parseSearchCoverItem(item))
    .filter((item): item is FeedCardItem => item !== null),
  hasMore: readBoolean(payload.more) ?? false
});

export const parseNcmArtistVideos = (payload: NcmResponseEnvelope): {
  items: FeedCardItem[];
  hasMore: boolean;
} => ({
  items: readSearchItems(payload, ["mvs", "videos"])
    .map((item) => parseSearchCoverItem(item, { videoKind: "mv" }))
    .filter((item): item is FeedCardItem => item !== null),
  hasMore: readBoolean(payload.hasMore) ?? false
});

export const parseNcmSearchRadios = (payload: NcmResponseEnvelope): FeedCardItem[] =>
  readSearchItems(payload, ["djRadios", "radios", "djprograms"])
    .map(parseRadioCard)
    .filter((item): item is FeedCardItem => item !== null);

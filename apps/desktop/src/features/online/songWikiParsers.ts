import type { NcmResponseEnvelope } from "../../shared/api/ncm/base";
import type { FeedCardItem, OnlineTrackItem } from "./shared/types";

export interface SongWikiStory {
  firstListen: {
    season: string | null;
    period: string | null;
    date: string | null;
    meetDurationDesc: string | null;
  } | null;
  totalPlay: {
    playCount: number | null;
    text: string | null;
  } | null;
  likeSong: {
    like: boolean;
    text: string | null;
    redDesc: string | null;
  } | null;
}

export interface SongWikiBasicInfoItem {
  label: string;
  type: "text" | "tags";
  value: string | null;
  tags: string[];
}

export interface SongWikiSheet {
  id: number;
  name: string;
  playVersion: string | null;
  coverImageUrl: string | null;
  meta: string[];
  images: string[];
}

export interface SongWikiResourceItem {
  image: string | null;
  title: string;
  subtitle: string | null;
}

export interface SongWikiViewModel {
  story: SongWikiStory | null;
  basicInfo: SongWikiBasicInfoItem[];
  sheets: SongWikiSheet[];
  achievements: SongWikiResourceItem[];
  similarSongIds: number[];
}

export interface SongWikiSongMeta {
  track: OnlineTrackItem;
  title: string;
  artist: string | null;
  album: string | null;
  coverUrl: string | null;
  publishTime: number | null;
  artists: FeedCardItem[];
  albumItem: FeedCardItem | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const readBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const readRecord = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? value : null;

const unwrapData = (payload: unknown): unknown => {
  if (!isRecord(payload)) return payload;
  return payload.data ?? payload;
};

const unwrapListenData = (payload: unknown): unknown => {
  const data = unwrapData(payload);
  return isRecord(data) && data.data !== undefined ? data.data : data;
};

const readNestedRecord = (
  value: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> | null => {
  let current: unknown = value;
  for (const key of keys) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return readRecord(current);
};

const readNestedString = (value: Record<string, unknown>, keys: readonly string[]): string | null => {
  const parent = readNestedRecord(value, keys.slice(0, -1));
  const last = keys[keys.length - 1];
  return last && parent ? readString(parent[last]) : null;
};

const formatDateFromTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}.${month}.${day}`;
};

const readFirstListen = (
  listen: Record<string, unknown> | null,
  wiki: Record<string, unknown> | null
): SongWikiStory["firstListen"] => {
  const dto = readRecord(listen?.musicFirstListenDto) ?? readRecord(wiki?.musicFirstListenDto);
  if (!dto) return null;
  const listenTime = readNumber(dto.listenTime);
  const date = readString(dto.date) ?? (listenTime === null ? null : formatDateFromTimestamp(listenTime));
  const firstListen = {
    season: readString(dto.season),
    period: readString(dto.period) ?? readString(dto.timeText),
    date,
    meetDurationDesc: readString(dto.meetDurationDesc) ?? readString(dto.desc)
  };
  return Object.values(firstListen).some((value) => value !== null) ? firstListen : null;
};

const readTotalPlay = (
  listen: Record<string, unknown> | null,
  wiki: Record<string, unknown> | null
): SongWikiStory["totalPlay"] => {
  const dto = readRecord(listen?.musicTotalPlayDto) ?? readRecord(wiki?.musicTotalPlayDto);
  if (!dto) return null;
  const totalPlay = {
    playCount: readNumber(dto.playCount),
    text: readString(dto.text) ?? readString(dto.desc)
  };
  return totalPlay.playCount !== null || totalPlay.text !== null ? totalPlay : null;
};

const readLikeSong = (
  listen: Record<string, unknown> | null,
  wiki: Record<string, unknown> | null
): SongWikiStory["likeSong"] => {
  const dto = readRecord(listen?.musicLikeSongDto) ?? readRecord(wiki?.musicLikeSongDto);
  if (!dto) return null;
  const likeSong = {
    like: readBoolean(dto.like) ?? readBoolean(dto.collect) ?? false,
    text: readString(dto.text) ?? readString(dto.mainTitle),
    redDesc: readString(dto.redDesc) ?? readString(dto.desc)
  };
  return likeSong.like || likeSong.text !== null || likeSong.redDesc !== null ? likeSong : null;
};

const buildStory = (
  listen: Record<string, unknown> | null,
  wiki: Record<string, unknown> | null
): SongWikiStory | null => {
  const story: SongWikiStory = {
    firstListen: readFirstListen(listen, wiki),
    totalPlay: readTotalPlay(listen, wiki),
    likeSong: readLikeSong(listen, wiki)
  };
  return story.firstListen || story.totalPlay || story.likeSong ? story : null;
};

const readResourceTitle = (resource: Record<string, unknown>): string | null =>
  readNestedString(resource, ["uiElement", "mainTitle", "title"]);

const parseSheet = (value: unknown): SongWikiSheet | null => {
  if (!isRecord(value)) return null;
  const id = readNumber(value.id);
  const name = readString(value.name);
  if (id === null || name === null) return null;
  const instruments = readArray(value.type)
    .map((item) => (isRecord(item) ? readString(item.name) : null))
    .filter((item): item is string => item !== null);
  const pageCount = readNumber(value.totalPageSize);
  const bpm = readNumber(value.bpm);
  const meta = [
    readString(value.playVersion),
    readString(value.difficulty),
    readString(value.musicKey),
    ...instruments,
    bpm === null ? null : `${bpm} BPM`,
    pageCount === null ? null : `${pageCount} pages`
  ].filter((item): item is string => item !== null);

  return {
    id,
    name,
    playVersion: readString(value.playVersion),
    coverImageUrl: readString(value.coverImageUrl),
    meta,
    images: []
  };
};

const parseResourceItem = (value: unknown): SongWikiResourceItem | null => {
  if (!isRecord(value)) return null;
  const title = readResourceTitle(value);
  if (title === null) return null;
  const subtitles = readArray(readNestedRecord(value, ["uiElement"])?.subTitles)
    .map((item) => (isRecord(item) ? readString(item.title) : null))
    .filter((item): item is string => item !== null);
  const images = readArray(readNestedRecord(value, ["uiElement"])?.images);
  const firstImage = images.find((item) => isRecord(item) && readString(item.imageUrl) !== null);
  return {
    image: isRecord(firstImage) ? readString(firstImage.imageUrl) : null,
    title,
    subtitle: subtitles.length > 0 ? subtitles.join(" / ") : null
  };
};

const parseCreative = (
  creative: Record<string, unknown>,
  model: SongWikiViewModel,
  blockCode: string | null
) => {
  const creativeType = readString(creative.creativeType);
  const title = readNestedString(creative, ["uiElement", "mainTitle", "title"]);
  const resources = readArray(creative.resources);

  if (blockCode === "SONG_PLAY_ABOUT_SIMILAR_SONG") {
    for (const resource of resources) {
      if (!isRecord(resource)) continue;
      const id = readNumber(resource.resourceId);
      if (id !== null) model.similarSongIds.push(id);
    }
    return;
  }

  if (blockCode !== "SONG_PLAY_ABOUT_SONG_BASIC" || creativeType === null || title === null) {
    return;
  }

  if (creativeType === "songTag" || creativeType === "songBizTag") {
    const tags = resources
      .map((resource) => (isRecord(resource) ? readResourceTitle(resource) : null))
      .filter((item): item is string => item !== null);
    if (tags.length > 0) {
      model.basicInfo.push({ label: title, type: "tags", value: null, tags });
    }
    return;
  }

  if (creativeType === "language" || creativeType === "bpm") {
    const textLinks = readArray(readNestedRecord(creative, ["uiElement"])?.textLinks);
    const value = textLinks
      .map((item) => (isRecord(item) ? readString(item.text) : null))
      .find((item): item is string => item !== null);
    if (value) {
      model.basicInfo.push({ label: title, type: "text", value, tags: [] });
    }
    return;
  }

  if (creativeType === "songAward" || creativeType === "entertainment") {
    model.achievements.push(
      ...resources
        .map(parseResourceItem)
        .filter((item): item is SongWikiResourceItem => item !== null)
    );
  }
};

export const normalizeSongWikiData = (
  wikiPayload: NcmResponseEnvelope | null,
  listenPayload: NcmResponseEnvelope | null,
  sheetPayload: NcmResponseEnvelope | null
): SongWikiViewModel => {
  const wiki = readRecord(unwrapData(wikiPayload));
  const listen = readRecord(unwrapListenData(listenPayload));
  const sheetData = readRecord(unwrapData(sheetPayload));
  const model: SongWikiViewModel = {
    story: buildStory(listen, wiki),
    basicInfo: [],
    sheets: readArray(sheetData?.musicSheetSimpleInfoVOS)
      .map(parseSheet)
      .filter((item): item is SongWikiSheet => item !== null),
    achievements: [],
    similarSongIds: []
  };

  for (const blockValue of readArray(wiki?.blocks)) {
    if (!isRecord(blockValue)) continue;
    const blockCode = readString(blockValue.code);
    for (const creativeValue of readArray(blockValue.creatives)) {
      if (isRecord(creativeValue)) {
        parseCreative(creativeValue, model, blockCode);
      }
    }
  }

  model.similarSongIds = [...new Set(model.similarSongIds)].filter((id) => id > 0);
  return model;
};

export const readSongSheetPreviewImages = (payload: NcmResponseEnvelope): string[] => {
  const data = unwrapData(payload);
  const list = Array.isArray(data)
    ? data
    : isRecord(data)
      ? readArray(data.pageList).length > 0
        ? readArray(data.pageList)
        : readArray(data.pages)
      : [];

  return list
    .map((item) => (typeof item === "string" ? item : isRecord(item) ? readString(item.pageImageUrl) ?? readString(item.url) : null))
    .filter((item): item is string => item !== null);
};

const parseSongArtists = (value: unknown): FeedCardItem[] =>
  readArray(value)
    .map((item): FeedCardItem | null => {
      if (!isRecord(item)) return null;
      const id = readNumber(item.id);
      const title = readString(item.name);
      if (id === null || title === null) return null;
      return {
        id,
        title,
        subtitle: null,
        coverUrl: readString(item.img1v1Url) ?? readString(item.picUrl),
        playCount: null,
        description: null
      };
    })
    .filter((item): item is FeedCardItem => item !== null);

export const parseSongWikiSongMeta = (
  detailPayload: NcmResponseEnvelope | null,
  track: OnlineTrackItem
): SongWikiSongMeta => {
  const songs = readArray(isRecord(detailPayload) ? detailPayload.songs : null);
  const song =
    songs
      .map(readRecord)
      .find((item) => readNumber(item?.id) === track.songId) ??
    songs.map(readRecord).find((item): item is Record<string, unknown> => item !== null) ??
    null;
  const album = readRecord(song?.al) ?? readRecord(song?.album);
  const artists = parseSongArtists(song?.ar ?? song?.artists);
  const albumId = readNumber(album?.id);
  const albumName = readString(album?.name) ?? track.album ?? null;
  const albumCover = readString(album?.picUrl) ?? readString(song?.picUrl) ?? track.artworkUrl ?? null;

  return {
    track: {
      ...track,
      title: readString(song?.name) ?? track.title,
      artist: artists.length > 0 ? artists.map((item) => item.title).join(" / ") : track.artist,
      album: albumName,
      artworkUrl: albumCover
    },
    title: readString(song?.name) ?? track.title ?? String(track.songId),
    artist: artists.length > 0 ? artists.map((item) => item.title).join(" / ") : track.artist,
    album: albumName,
    coverUrl: albumCover,
    publishTime: readNumber(song?.publishTime) ?? readNumber(song?.createTime),
    artists,
    albumItem:
      albumId !== null && albumName !== null
        ? {
            id: albumId,
            title: albumName,
            subtitle: artists.length > 0 ? artists.map((item) => item.title).join(" / ") : track.artist,
            coverUrl: albumCover,
            playCount: null,
            description: readString(album?.description)
          }
        : null
  };
};

import type { FeedCardItem } from "./shared/types";
import type { OnlineTrackItem } from "./shared/types";

export interface RadioCategory {
  id: number;
  name: string;
}

export interface RadioCategorySection extends RadioCategory {
  radios: FeedCardItem[];
}

export interface RadioDetailInfo extends FeedCardItem {
  programCount: number | null;
  subscriberCount: number | null;
  subscribed: boolean | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

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

const readArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const readBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && (value === 0 || value === 1)) return value === 1;
  return null;
};

const readNestedCreator = (value: unknown): string | null => {
  if (!isRecord(value)) return null;
  return readString(value.nickname) ?? readString(value.name);
};

const readArtists = (value: unknown): string | null => {
  const artists = readArray(value)
    .map((item) => (isRecord(item) ? readString(item.name) : null))
    .filter((name): name is string => name !== null);
  return artists.length > 0 ? artists.join(" / ") : null;
};

const readSongAlbum = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? value : null;

export const parseRadioCard = (value: unknown): FeedCardItem | null => {
  if (!isRecord(value)) return null;
  const id = readNumber(value.id ?? value.radioId ?? value.rid);
  const title = readString(value.name ?? value.title);
  if (id === null || title === null) return null;

  const subtitle =
    readString(value.rcmdText) ??
    readString(value.desc) ??
    readString(value.copywriter) ??
    readNestedCreator(value.dj) ??
    readNestedCreator(value.creator);

  return {
    id,
    title,
    subtitle,
    coverUrl: readString(value.picUrl ?? value.picURL ?? value.coverUrl ?? value.coverImgUrl),
    playCount: readNumber(value.playCount ?? value.listenerCount ?? value.subCount),
    description: readString(value.desc ?? value.description)
  };
};

export const parseRadioDetailCard = (payload: unknown): FeedCardItem | null => {
  if (!isRecord(payload)) return null;
  return parseRadioCard(payload.data ?? payload.djRadio ?? payload.radio ?? payload);
};

export const parseRadioDetailInfo = (payload: unknown, fallback: FeedCardItem): RadioDetailInfo => {
  const source = isRecord(payload)
    ? (isRecord(payload.data) ? payload.data : isRecord(payload.djRadio) ? payload.djRadio : isRecord(payload.radio) ? payload.radio : payload)
    : null;
  const card = source === null ? null : parseRadioCard(source);
  return {
    ...fallback,
    ...(card ?? {}),
    programCount: readNumber(source?.programCount ?? source?.programCnt ?? source?.count) ?? null,
    subscriberCount: readNumber(source?.subCount ?? source?.subedCount ?? source?.subscribedCount) ?? card?.playCount ?? null,
    subscribed:
      readBoolean(source?.subed) ??
      readBoolean(source?.subscribed) ??
      readBoolean(source?.isSub)
  };
};

const parseProgramTrack = (value: unknown): OnlineTrackItem | null => {
  if (!isRecord(value)) return null;
  const song = isRecord(value.mainSong) ? value.mainSong : value;
  const songId = readNumber(song.id);
  const title = readString(song.name);
  if (songId === null || title === null) return null;

  const album = readSongAlbum(song.al) ?? readSongAlbum(song.album);
  const albumTitle = album ? readString(album.name) : null;
  const artworkUrl =
    (album ? readString(album.picUrl) : null) ??
    readString(song.picUrl) ??
    readString(value.coverUrl);
  const durationMs = readNumber(song.dt ?? song.duration);
  const radio = isRecord(value.radio) ? value.radio : null;

  return {
    id: `ncm-radio-program-${readNumber(value.id) ?? songId}`,
    songId,
    source_path: `https://music.163.com/#/song?id=${songId}`,
    title,
    artist:
      readArtists(song.ar) ??
      readArtists(song.artists) ??
      (isRecord(song.artist) ? readString(song.artist.name) : null),
    album: albumTitle ?? (radio ? readString(radio.name) : null),
    duration_secs: durationMs === null ? null : durationMs / 1000,
    artworkUrl,
    size_bytes: readNumber(song.size)
  };
};

export const parseRadioProgramTracks = (payload: unknown): OnlineTrackItem[] => {
  if (!isRecord(payload)) return [];
  return readArray(payload.programs)
    .map(parseProgramTrack)
    .filter((item): item is OnlineTrackItem => item !== null);
};

export const parseRadioCategories = (payload: unknown): RadioCategory[] => {
  if (!isRecord(payload)) return [];
  return readArray(payload.categories)
    .map((item) => {
      if (!isRecord(item)) return null;
      const id = readNumber(item.id);
      const name = readString(item.name);
      return id === null || name === null ? null : { id, name };
    })
    .filter((item): item is RadioCategory => item !== null);
};

export const parseRadioCardsFromKey = (payload: unknown, key: "toplist" | "djRadios"): FeedCardItem[] => {
  if (!isRecord(payload)) return [];
  return readArray(payload[key]).map(parseRadioCard).filter((item): item is FeedCardItem => item !== null);
};

export const parseRadioCategorySections = (payload: unknown): RadioCategorySection[] => {
  if (!isRecord(payload)) return [];
  return readArray(payload.data)
    .map((item) => {
      if (!isRecord(item)) return null;
      const id = readNumber(item.categoryId ?? item.id);
      const name = readString(item.categoryName ?? item.name);
      if (id === null || name === null) return null;
      return {
        id,
        name,
        radios: readArray(item.radios).map(parseRadioCard).filter((radio): radio is FeedCardItem => radio !== null)
      };
    })
    .filter((item): item is RadioCategorySection => item !== null);
};

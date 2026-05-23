import type { FeedCardItem } from "./shared/types";

export interface VideoDetailInfo {
  id: number | string;
  title: string;
  coverUrl: string | null;
  description: string | null;
  artist: FeedCardItem | null;
  playCount: number | null;
  commentCount: number | null;
  likedCount: number | null;
  subCount: number | null;
  shareCount: number | null;
  publishTime: number | null;
  tags: string[];
  qualities: number[];
}

export interface VideoSource {
  url: string;
  quality: number | null;
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

const readId = (value: unknown): number | string | null =>
  readNumber(value) ?? readString(value);

const readArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const readArtist = (value: unknown): FeedCardItem | null => {
  if (!isRecord(value)) return null;
  const id = readNumber(value.id);
  const title = readString(value.name);
  if (id === null || title === null) return null;
  return {
    id,
    title,
    subtitle: null,
    coverUrl: readString(value.img1v1Url ?? value.picUrl ?? value.cover),
    playCount: null,
    description: null
  };
};

export const parseVideoDetail = (detailPayload: unknown, infoPayload: unknown): VideoDetailInfo | null => {
  if (!isRecord(detailPayload)) return null;
  const data = isRecord(detailPayload.data) ? detailPayload.data : detailPayload;
  const id = readId(data.id ?? data.vid);
  const title = readString(data.name ?? data.title);
  if (id === null || title === null) return null;

  const info = isRecord(infoPayload) ? infoPayload : {};
  const artist =
    readArtist(data.artist) ??
    readArray(data.artists).map(readArtist).find((item): item is FeedCardItem => item !== null) ??
    null;

  return {
    id,
    title,
    coverUrl: readString(data.cover ?? data.coverUrl ?? data.picUrl),
    description: readString(data.desc ?? data.description ?? data.briefDesc),
    artist,
    playCount: readNumber(data.playCount ?? info.playCount),
    commentCount: readNumber(info.commentCount ?? data.commentCount),
    likedCount: readNumber(info.likedCount ?? data.likedCount),
    subCount: readNumber(info.subCount ?? data.subCount),
    shareCount: readNumber(info.shareCount ?? data.shareCount),
    publishTime: readNumber(data.publishTime ?? data.updateTime ?? data.createTime),
    tags: readArray(data.videoGroup)
      .map((item) => (isRecord(item) ? readString(item.name) : readString(item)))
      .filter((item): item is string => item !== null),
    qualities: readArray(data.brs)
      .map((item) => (isRecord(item) ? readNumber(item.br ?? item.size) : null))
      .concat(readArray(data.resolutions).map((item) => (isRecord(item) ? readNumber(item.resolution) : null)))
      .filter((item): item is number => item !== null)
      .sort((a, b) => b - a)
  };
};

export const parseVideoSource = (payload: unknown): VideoSource | null => {
  if (!isRecord(payload)) return null;
  const firstUrl = Array.isArray(payload.urls) ? payload.urls.find(isRecord) : null;
  const data = firstUrl ?? (isRecord(payload.data) ? payload.data : payload);
  const url = readString(data.url);
  if (url === null) return null;
  return {
    url: url.replace(/^http:/, "https:"),
    quality: readNumber(data.r ?? data.size)
  };
};

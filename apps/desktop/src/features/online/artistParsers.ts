import type { NcmResponseEnvelope } from "../../shared/api/ncm/base";
import type { FeedCardItem } from "./shared/types";

export interface ArtistDetailInfo extends FeedCardItem {
  alias: string | null;
  identify: string | null;
  musicSize: number | null;
  albumSize: number | null;
  mvSize: number | null;
  followed: boolean | null;
}

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

const readBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && (value === 0 || value === 1)) return value === 1;
  return null;
};

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readFirstString = (value: unknown): string | null =>
  readArray(value)
    .map(readString)
    .find((item): item is string => item !== null) ?? readString(value);

const readCoverUrl = (value: Record<string, unknown>): string | null =>
  readString(value.cover) ??
  readString(value.picUrl) ??
  readString(value.coverUrl) ??
  readString(value.coverImgUrl) ??
  readString(value.imgurl) ??
  readString(value.img1v1Url);

const readIdentify = (artist: Record<string, unknown>, data: Record<string, unknown> | null): string | null => {
  const dataIdentify = isRecord(data?.identify) ? data?.identify : null;
  return (
    readString(dataIdentify?.imageDesc) ??
    readString(dataIdentify?.imageUrlDesc) ??
    readFirstString(artist.identifyTag) ??
    readString(artist.identify)
  );
};

const readFollowed = (artist: Record<string, unknown>, data: Record<string, unknown> | null): boolean | null => {
  const user = isRecord(data?.user) ? data?.user : null;
  return (
    readBoolean(artist.followed) ??
    readBoolean(artist.subed) ??
    readBoolean(artist.subscribed) ??
    readBoolean(user?.followed)
  );
};

export const parseArtistDetailInfo = (
  payload: NcmResponseEnvelope,
  fallback: FeedCardItem
): ArtistDetailInfo => {
  const data = isRecord(payload.data) ? payload.data : null;
  const artist = isRecord(data?.artist)
    ? data.artist
    : isRecord(payload.artist)
      ? payload.artist
      : null;
  if (artist === null) {
    return {
      ...fallback,
      alias: fallback.subtitle,
      identify: null,
      musicSize: null,
      albumSize: null,
      mvSize: null,
      followed: null
    };
  }

  return {
    id: readNumber(artist.id) ?? fallback.id,
    title: readString(artist.name) ?? fallback.title,
    subtitle: readFirstString(artist.alias) ?? fallback.subtitle,
    coverUrl: readCoverUrl(artist) ?? fallback.coverUrl,
    playCount: readNumber(artist.fans) ?? fallback.playCount,
    description: readString(artist.description ?? artist.briefDesc) ?? fallback.description,
    alias: readFirstString(artist.alias),
    identify: readIdentify(artist, data),
    musicSize: readNumber(artist.musicSize),
    albumSize: readNumber(artist.albumSize),
    mvSize: readNumber(artist.mvSize),
    followed: readFollowed(artist, data)
  };
};

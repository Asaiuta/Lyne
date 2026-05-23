import type { NcmResponseEnvelope } from "../../shared/api/ncm/base";
import type { FeedCardItem } from "./shared/types";

export interface AlbumDynamicInfo {
  subscribed: boolean | null;
  commentCount: number | null;
  shareCount: number | null;
}

export interface AlbumDetailInfo extends FeedCardItem {
  subscribed: boolean | null;
  commentCount: number | null;
  shareCount: number | null;
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

const readBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && (value === 0 || value === 1)) return value === 1;
  return null;
};

export const parseAlbumDynamicInfo = (payload: NcmResponseEnvelope): AlbumDynamicInfo => {
  const data = isRecord(payload.data) ? payload.data : null;
  const source = data ?? payload;
  return {
    subscribed:
      readBoolean(source.subed) ??
      readBoolean(source.subscribed) ??
      readBoolean(source.isSub) ??
      readBoolean(source.liked),
    commentCount: readNumber(source.commentCount),
    shareCount: readNumber(source.shareCount)
  };
};

export const createAlbumDetailInfo = (
  album: FeedCardItem,
  dynamic: AlbumDynamicInfo | null
): AlbumDetailInfo => ({
  ...album,
  subscribed: dynamic?.subscribed ?? null,
  commentCount: dynamic?.commentCount ?? null,
  shareCount: dynamic?.shareCount ?? null
});

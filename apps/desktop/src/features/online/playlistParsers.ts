import type { NcmResponseEnvelope } from "../../shared/api/ncm/base";
import type { OnlinePlaylistSummary } from "./ncmPlaylistSummary";

export interface PlaylistDynamicInfo {
  subscribed: boolean | null;
  commentCount: number | null;
  shareCount: number | null;
  bookedCount: number | null;
}

export interface PlaylistDetailInfo extends OnlinePlaylistSummary {
  commentCount: number | null;
  shareCount: number | null;
  bookedCount: number | null;
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

export const parsePlaylistDynamicInfo = (payload: NcmResponseEnvelope): PlaylistDynamicInfo => {
  const data = isRecord(payload.data) ? payload.data : null;
  const source = data ?? payload;
  return {
    subscribed:
      readBoolean(source.subscribed) ??
      readBoolean(source.subed) ??
      readBoolean(source.isSub),
    commentCount: readNumber(source.commentCount),
    shareCount: readNumber(source.shareCount),
    bookedCount: readNumber(source.bookedCount)
  };
};

export const createPlaylistDetailInfo = (
  playlist: OnlinePlaylistSummary,
  dynamic: PlaylistDynamicInfo | null
): PlaylistDetailInfo => ({
  ...playlist,
  subscribed: dynamic?.subscribed ?? playlist.subscribed,
  commentCount: dynamic?.commentCount ?? null,
  shareCount: dynamic?.shareCount ?? null,
  bookedCount: dynamic?.bookedCount ?? null
});

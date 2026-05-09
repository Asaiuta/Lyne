interface OnlinePlaylistSummaryRecord extends Record<string, unknown> {
  id?: unknown;
  name?: unknown;
  creator?: unknown;
  coverImgUrl?: unknown;
  trackCount?: unknown;
  subscribed?: unknown;
}

export type UserPlaylistMode = "created-playlists" | "collected-playlists";

export interface OnlinePlaylistSummary {
  id: number;
  name: string;
  creator: string | null;
  coverUrl: string | null;
  trackCount: number | null;
  subscribed: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asRecord = (value: unknown): OnlinePlaylistSummaryRecord | null =>
  isRecord(value) ? (value as OnlinePlaylistSummaryRecord) : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const readString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const adaptPlaylist = (value: unknown): OnlinePlaylistSummary | null => {
  const item = asRecord(value);
  if (!item) return null;
  const id = readNumber(item.id);
  const name = readString(item.name);
  if (id === null || name === null) return null;
  return {
    id,
    name,
    creator: readString(asRecord(item.creator)?.nickname),
    coverUrl: readString(item.coverImgUrl),
    trackCount: readNumber(item.trackCount),
    subscribed: readBoolean(item.subscribed) ?? false
  };
};

export const readSearchPlaylists = (payload: unknown): OnlinePlaylistSummary[] => {
  const result = asRecord(asRecord(payload)?.result);
  return asArray(result?.playlists)
    .map(adaptPlaylist)
    .filter((item): item is OnlinePlaylistSummary => item !== null);
};

export const readUserPlaylists = (payload: unknown): OnlinePlaylistSummary[] =>
  asArray(asRecord(payload)?.playlist)
    .map(adaptPlaylist)
    .filter((item): item is OnlinePlaylistSummary => item !== null);

export const filterUserPlaylists = (
  playlists: readonly OnlinePlaylistSummary[],
  mode: UserPlaylistMode
): OnlinePlaylistSummary[] =>
  playlists.filter((item) => (mode === "created-playlists" ? !item.subscribed : item.subscribed));

export interface MediaIdentityListItem {
  source_path?: string | null;
  media_id?: string | null;
  songId?: number;
}

export interface CurrentMediaIdentity {
  sourcePath?: string | null;
  mediaId?: string | null;
  songId?: number | null;
}

export interface MediaIdentityIndex {
  songIds: ReadonlyMap<number, number>;
  mediaIds: ReadonlyMap<string, number>;
  sourcePaths: ReadonlyMap<string, number>;
}

export const mediaKeyForPath = (path: string | null | undefined): string | null => {
  if (!path) return null;
  return path
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\/i, "")
    .replace(/^\/\/\?\/UNC\//i, "")
    .replace(/^\/\/\?\//i, "")
    .replace(/\\/g, "/")
    .toLowerCase();
};

const mediaIdentityKey = (value: string | null | undefined): string | null =>
  mediaKeyForPath(value);

const setFirst = <K>(map: Map<K, number>, key: K | null | undefined, index: number) => {
  if (key === null || key === undefined || map.has(key)) return;
  map.set(key, index);
};

export const createMediaIdentityIndex = (
  items: readonly MediaIdentityListItem[]
): MediaIdentityIndex => {
  const songIds = new Map<number, number>();
  const mediaIds = new Map<string, number>();
  const sourcePaths = new Map<string, number>();

  items.forEach((item, index) => {
    if (typeof item.songId === "number") {
      setFirst(songIds, item.songId, index);
    }
    setFirst(mediaIds, mediaIdentityKey(item.media_id), index);
    setFirst(sourcePaths, mediaKeyForPath(item.source_path), index);
  });

  return { songIds, mediaIds, sourcePaths };
};

export const findMediaIdentityIndex = (
  index: MediaIdentityIndex,
  current: CurrentMediaIdentity
): number => {
  if (current.songId !== null && current.songId !== undefined) {
    const songIndex = index.songIds.get(current.songId);
    if (songIndex !== undefined) return songIndex;
  }

  const currentSourceKey = mediaKeyForPath(current.sourcePath);
  const currentMediaKey = currentSourceKey ?? mediaIdentityKey(current.mediaId);
  if (currentMediaKey) {
    const mediaIndex = index.mediaIds.get(currentMediaKey);
    if (mediaIndex !== undefined) return mediaIndex;
  }

  if (currentSourceKey) {
    const sourceIndex = index.sourcePaths.get(currentSourceKey);
    if (sourceIndex !== undefined) return sourceIndex;
  }

  return -1;
};

export const isMediaListItemCurrent = (
  item: MediaIdentityListItem,
  current: CurrentMediaIdentity
): boolean => {
  if (current.songId !== null && current.songId !== undefined && item.songId === current.songId) {
    return true;
  }

  const currentSourceKey = mediaKeyForPath(current.sourcePath);
  const currentMediaKey = currentSourceKey ?? mediaIdentityKey(current.mediaId);
  const itemMediaKey = mediaIdentityKey(item.media_id);
  if (currentMediaKey && itemMediaKey === currentMediaKey) {
    return true;
  }

  const itemSourceKey = mediaKeyForPath(item.source_path);
  return currentSourceKey !== null && itemSourceKey === currentSourceKey;
};

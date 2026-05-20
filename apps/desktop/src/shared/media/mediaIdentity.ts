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

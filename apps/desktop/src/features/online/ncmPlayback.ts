import type { ParsedLyricLine, ParsedLyricWord } from "../../shared/api/client";

export type NcmLyricLine = ParsedLyricLine;
export type NcmLyricWord = ParsedLyricWord;

export interface NcmTrackReference {
  songId: number;
  streamUrl: string;
  sourcePageUrl: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  coverUrl: string | null;
  durationSecs: number | null;
}

export interface NcmTrackSupplement {
  status: "loading" | "success" | "error";
  title: string | null;
  artist: string | null;
  album: string | null;
  coverUrl: string | null;
  lyrics: NcmLyricLine[];
  error: string | null;
}

export const mergeNcmTrackReference = (
  previous: NcmTrackReference | undefined,
  next: NcmTrackReference
): NcmTrackReference => ({
  ...previous,
  ...next,
  title: next.title ?? previous?.title ?? null,
  artist: next.artist ?? previous?.artist ?? null,
  album: next.album ?? previous?.album ?? null,
  coverUrl: next.coverUrl ?? previous?.coverUrl ?? null,
  durationSecs: next.durationSecs ?? previous?.durationSecs ?? null
});

export const findActiveLyricIndex = (
  lyrics: readonly NcmLyricLine[],
  currentTime: number
): number => {
  if (lyrics.length === 0 || !Number.isFinite(currentTime)) {
    return -1;
  }

  let low = 0;
  let high = lyrics.length - 1;
  let activeIndex = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (currentTime >= lyrics[middle].time) {
      activeIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return activeIndex;
};

export const findCurrentLyricLine = (
  lyrics: readonly NcmLyricLine[],
  currentTime: number
): string | null => {
  const index = findActiveLyricIndex(lyrics, currentTime);
  return index >= 0 ? lyrics[index]?.text ?? null : null;
};

export const snapSeekPositionToLyrics = (
  lyrics: readonly NcmLyricLine[],
  currentTime: number
): number => {
  if (lyrics.length === 0 || !Number.isFinite(currentTime)) {
    return currentTime;
  }

  const currentIndex = findActiveLyricIndex(lyrics, currentTime);
  const nextIndex = currentIndex + 1;
  if (nextIndex < lyrics.length) {
    const nextStart = lyrics[nextIndex]?.time;
    if (nextStart !== undefined && nextStart - currentTime <= 2.5) {
      return nextStart;
    }
  }

  if (currentIndex >= 0) {
    const currentStart = lyrics[currentIndex]?.time;
    if (currentStart !== undefined && currentTime - currentStart <= 10) {
      return currentStart;
    }
  }

  return currentTime;
};

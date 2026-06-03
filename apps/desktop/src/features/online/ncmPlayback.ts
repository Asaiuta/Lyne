import type { LyricLine } from "../../shared/media/lyrics";
import type { NcmArtistSummary } from "../../shared/api/ncmDomainTypes";

export type NcmLyricLine = LyricLine;
export type { NcmArtistSummary };

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
  alias: string | null;
  artist: string | null;
  artists: NcmArtistSummary[];
  album: string | null;
  albumId: number | null;
  coverUrl: string | null;
  dynamicCoverUrl: string | null;
  lyrics: NcmLyricLine[];
  lyricSource: string | null;
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

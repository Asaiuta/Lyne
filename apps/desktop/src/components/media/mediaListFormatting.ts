import { formatDuration } from "../player/time";
import { coverSizeUrl } from "../../shared/ui/coverSize";

const NCM_COVER_HOST = "music.126.net";

export const resolveMediaListArtworkUrl = (
  artworkUrl: string | null | undefined,
  songId: number | null | undefined
): string | undefined => {
  if (!artworkUrl || typeof songId !== "number" || !Number.isFinite(songId)) {
    return artworkUrl ?? undefined;
  }

  try {
    const parsed = new URL(artworkUrl);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      (parsed.hostname !== NCM_COVER_HOST && !parsed.hostname.endsWith(`.${NCM_COVER_HOST}`))
    ) {
      return artworkUrl;
    }
  } catch {
    return artworkUrl;
  }

  return coverSizeUrl(artworkUrl, "s");
};

export const formatMediaDuration = (secs: number | null): string => formatDuration(secs, "—");

export const formatMediaSize = (bytes: number | null | undefined): string => {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(0)} KB`;
  return `${bytes} B`;
};

export const stripBracketedContent = (value: string): string => {
  const stripped = value
    .replace(/\s*[\(（［\[{【].*?[\)）\]］}】]\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return stripped || value;
};

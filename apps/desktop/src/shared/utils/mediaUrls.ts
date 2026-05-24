const VIDEO_ARTWORK_EXTENSIONS = [".mp4", ".webm", ".mov", ".m4v"] as const;

const VIDEO_HOST_PATTERNS = [
  "vodkgeyttp9.vod.126.net",
  "vodkgeyttp8.vod.126.net",
  "vodkgemv9.vod.126.net",
  "vod.126.net"
] as const;

export const normalizeMediaUrlForDetection = (url: string): string => {
  try {
    const base = typeof window === "undefined" ? "http://localhost/" : window.location.href;
    const parsed = new URL(url, base);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  } catch {
    return url.split("?")[0]?.split("#")[0]?.toLowerCase() ?? "";
  }
};

export const isVideoArtworkUrl = (url: string | null | undefined): url is string => {
  if (!url) return false;
  const normalized = normalizeMediaUrlForDetection(url);
  return (
    VIDEO_ARTWORK_EXTENSIONS.some((extension) => normalized.endsWith(extension)) ||
    VIDEO_HOST_PATTERNS.some((pattern) => normalized.includes(pattern))
  );
};

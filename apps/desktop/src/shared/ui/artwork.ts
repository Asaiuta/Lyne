export const DEFAULT_COVER_ART_URL = "/images/song.jpg";

interface ArtworkUrlProvider {
  getCoverArtUrl: (mediaId: string) => string;
}

interface ArtworkSource {
  mediaId?: string | null;
  hasCoverArt?: boolean | null;
  externalArtworkUrl?: string | null;
}

interface ResolveArtworkUrlOptions extends ArtworkSource {
  urls: ArtworkUrlProvider;
  fallbackUrl?: string | null;
}

const hasText = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const resolveArtworkUrl = (options: ResolveArtworkUrlOptions): string | null => {
  if (hasText(options.externalArtworkUrl)) {
    return options.externalArtworkUrl;
  }

  if (options.hasCoverArt && hasText(options.mediaId)) {
    return options.urls.getCoverArtUrl(options.mediaId);
  }

  return options.fallbackUrl ?? null;
};

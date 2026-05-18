import type { MediaItem } from "../../shared/api/types";
import { audioQualityLabelFromMetadata } from "../../shared/media/audioQuality";
import { resolveArtworkUrl } from "../../shared/ui/artwork";
import type { LibraryListItem } from "./libraryViewTypes";
import type { LibraryWorkerRow } from "./libraryWorkerProtocol";

export interface LibraryItemUrlProvider {
  getCoverArtUrl: (mediaId: string) => string;
  getLibraryTrackCoverArtUrl: (trackKey: number) => string;
}

export const adaptMediaItemToListItem = (
  item: MediaItem,
  urls: LibraryItemUrlProvider
): LibraryListItem => ({
  ...item,
  id: item.media_id,
  qualityLabel: audioQualityLabelFromMetadata({
    fileName: item.source_path,
    sampleRate: item.sample_rate,
    bitsPerSample: item.bits_per_sample,
    bitrateBps: item.bitrate_bps
  }),
  artworkUrl: resolveArtworkUrl({
    externalArtworkUrl: item.external_artwork_url,
    mediaId: item.media_id,
    hasCoverArt: item.has_cover_art,
    urls
  })
});

export const adaptWorkerRowToListItem = (
  row: LibraryWorkerRow,
  urls: LibraryItemUrlProvider
): LibraryListItem => ({
  id: row.id,
  trackKey: row.trackKey,
  media_id: row.media_id,
  title: row.title,
  artist: row.artist,
  album: row.album,
  track_number: row.track_number,
  duration_secs: row.duration_secs,
  sample_rate: row.sample_rate,
  bitrate_bps: row.bitrate_bps,
  bits_per_sample: row.bits_per_sample,
  size_bytes: row.size_bytes,
  added_at_epoch_secs: row.added_at_epoch_secs,
  updated_at_epoch_secs: row.updated_at_epoch_secs,
  fileName: row.fileName,
  qualityLabel: audioQualityLabelFromMetadata({
    fileName: row.fileName,
    sampleRate: row.sample_rate,
    bitsPerSample: row.bits_per_sample,
    bitrateBps: row.bitrate_bps
  }),
  artworkUrl: resolveArtworkUrl({
    externalArtworkUrl: row.externalArtworkUrl,
    mediaId: String(row.trackKey),
    hasCoverArt: row.hasCoverArt,
    urls: {
      getCoverArtUrl: (trackKey) => urls.getLibraryTrackCoverArtUrl(Number(trackKey))
    }
  })
});

export class LibraryTrackDetailResolver {
  private readonly detailCache = new Map<number, MediaItem>();

  constructor(private readonly loadDetail: (trackKey: number) => Promise<MediaItem>) {}

  clear(): void {
    this.detailCache.clear();
  }

  async resolve(item: LibraryListItem): Promise<MediaItem | null> {
    if (item.source_path && item.media_id) {
      return item as MediaItem;
    }
    if (item.trackKey === undefined) {
      return null;
    }
    const cached = this.detailCache.get(item.trackKey);
    if (cached) return cached;
    const detail = await this.loadDetail(item.trackKey);
    this.detailCache.set(item.trackKey, detail);
    return detail;
  }
}

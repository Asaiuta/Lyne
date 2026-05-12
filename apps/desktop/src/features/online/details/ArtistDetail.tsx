import { Show } from "solid-js";
import { IconChevronLeft } from "../../../components/icons";
import { MediaList } from "../../../components/media/MediaList";
import { useTranslation } from "../../../shared/i18n";
import { useUISettings } from "../../../shared/state/useUISettings";
import type { PlaybackController } from "../shared/playback";
import type { FeedCardItem, OnlineTrackItem } from "../shared/types";

export interface ArtistDetailProps {
  artist: FeedCardItem | null;
  tracks: OnlineTrackItem[];
  isLoading: boolean;
  onBack: () => void;
  playback: PlaybackController;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
}

export function ArtistDetail(props: ArtistDetailProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const artist = props.artist;
  if (!artist) return null;
  return (
    <section class="ncm-daily-detail">
      <button
        type="button"
        class="ghost-button ncm-daily-detail-back"
        onClick={props.onBack}
      >
        <IconChevronLeft />
        {t("ncm.artist.backToFeed")}
      </button>
      <header class={`ncm-daily-detail-hero${uiSettings.hiddenCovers.artistDetail ? " is-cover-hidden" : ""}`}>
        <Show when={!uiSettings.hiddenCovers.artistDetail && artist.coverUrl}>
          {(url) => <img class="ncm-detail-hero-cover ncm-detail-hero-cover--round" src={url()} alt="" />}
        </Show>
        <h2>{artist.title}</h2>
        <p class="ncm-daily-detail-meta">
          {props.tracks.length > 0
            ? t("ncm.artist.metaCount", { count: props.tracks.length })
            : ""}
        </p>
      </header>
      <MediaList
        items={props.tracks}
        currentSourcePath={props.currentTrackPath}
        currentSongId={props.currentSongId}
        isPlayingNow={props.isPlaying}
        onPlay={(item) => void props.playback.playOnlineTrack(item)}
        onEnqueue={(item) => void props.playback.enqueueOnlineTrack(item)}
        isLoading={props.isLoading}
        emptyState={<div class="panel-note">{t("ncm.artist.empty")}</div>}
      />
    </section>
  );
}

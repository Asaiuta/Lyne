import { Show } from "solid-js";
import { IconChevronLeft } from "../../../components/icons";
import { MediaList } from "../../../components/media/MediaList";
import { useTranslation } from "../../../shared/i18n";
import { useUISettings } from "../../../shared/state/useUISettings";
import type { PlaybackController } from "../shared/playback";
import type { FeedCardItem, OnlineTrackItem } from "../shared/types";

export interface AlbumDetailProps {
  album: FeedCardItem | null;
  tracks: OnlineTrackItem[];
  isLoading: boolean;
  onBack: () => void;
  playback: PlaybackController;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
}

export function AlbumDetail(props: AlbumDetailProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const album = props.album;
  if (!album) return null;
  return (
    <section class="ncm-daily-detail">
      <button
        type="button"
        class="ghost-button ncm-daily-detail-back"
        onClick={props.onBack}
      >
        <IconChevronLeft />
        {t("ncm.album.backToFeed")}
      </button>
      <header class={`ncm-daily-detail-hero${uiSettings.hiddenCovers.album ? " is-cover-hidden" : ""}`}>
        <Show when={!uiSettings.hiddenCovers.album && album.coverUrl}>
          {(url) => <img class="ncm-detail-hero-cover" src={url()} alt="" />}
        </Show>
        <h2>{album.title}</h2>
        <p class="ncm-daily-detail-meta">
          {album.subtitle ?? ""}
          {props.tracks.length > 0
            ? ` · ${t("ncm.album.metaCount", { count: props.tracks.length })}`
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
        emptyState={<div class="panel-note">{t("ncm.album.empty")}</div>}
      />
    </section>
  );
}

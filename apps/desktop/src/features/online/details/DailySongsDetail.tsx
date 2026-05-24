import { createMemo, createSignal } from "solid-js";
import { IconChevronLeft, IconList, IconPlay, IconRefresh } from "../../../components/icons";
import { ContextMenu, type ContextMenuItem } from "../../../components/media/ContextMenu";
import type { MediaContextAction } from "../../../components/media/MediaList";
import { MediaList } from "../../../components/media/MediaList";
import { BackToTop } from "../../../components/page/BackToTop";
import { PageBody } from "../../../components/page/PageBody";
import { PageHero } from "../../../components/page/PageHero";
import { PageSurface } from "../../../components/page/PageSurface";
import { useTranslation } from "../../../shared/i18n";
import { createErrorMessageReader, type FeedbackSetter } from "../shared/feedback";
import type { PlaybackController } from "../shared/playback";
import type { NcmProfile, OnlineTrackItem } from "../shared/types";
import { DailySongsBatchModal } from "./DailySongsBatchModal";

export interface DailySongsDetailProps {
  loginProfile: NcmProfile | null;
  tracks: OnlineTrackItem[];
  updatedAt: number | null;
  isLoading: boolean;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  onPlayAll: () => Promise<void>;
  onDislike: (item: OnlineTrackItem) => Promise<void>;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  setFeedback: FeedbackSetter;
  playback: PlaybackController;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
}

const formatDailyUpdatedTime = (timestamp: number | null): string | null => {
  if (timestamp === null) {
    return null;
  }
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hours}:${minutes}`;
};

export function DailySongsDetail(props: DailySongsDetailProps) {
  const { t } = useTranslation();
  const readErrorMessage = createErrorMessageReader(t);
  const [menuOpen, setMenuOpen] = createSignal<boolean>(false);
  const [menuPosition, setMenuPosition] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });
  const [refreshing, setRefreshing] = createSignal<boolean>(false);
  const [playingAll, setPlayingAll] = createSignal<boolean>(false);
  const [batchOpen, setBatchOpen] = createSignal<boolean>(false);

  const updatedTime = createMemo<string | null>(() => formatDailyUpdatedTime(props.updatedAt));
  const tipText = createMemo<string>(() => {
    const time = updatedTime();
    return time
      ? t("ncm.daily.updatedTip", { time })
      : t("ncm.daily.defaultTip");
  });

  const menuItems = (): ContextMenuItem[] => [
    { key: "refresh", label: t("ncm.daily.refresh"), icon: <IconRefresh /> },
    { key: "batch", label: t("ncm.daily.batch"), icon: <IconList /> }
  ];

  const openMenu = (event: MouseEvent & { currentTarget: HTMLButtonElement }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({ x: rect.left, y: rect.bottom + 8 });
    setMenuOpen(true);
  };

  const handleRefresh = async () => {
    if (refreshing()) return;
    setRefreshing(true);
    try {
      await props.onRefresh();
    } catch (error) {
      props.setFeedback("error", readErrorMessage(error));
    } finally {
      setRefreshing(false);
    }
  };

  const handlePlayAll = async () => {
    if (playingAll() || props.tracks.length === 0) return;
    setPlayingAll(true);
    try {
      await props.onPlayAll();
    } catch (error) {
      props.setFeedback("error", readErrorMessage(error));
    } finally {
      setPlayingAll(false);
    }
  };

  const handleMenuSelect = (key: string) => {
    if (key === "refresh") {
      void handleRefresh();
    } else if (key === "batch") {
      setBatchOpen(true);
    }
  };

  const handleContextAction = (action: MediaContextAction, item: OnlineTrackItem) => {
    if (action === "daily-dislike") {
      void props.onDislike(item);
    } else if (action === "song-wiki") {
      props.onNavigateToSongWiki?.(item);
    }
  };

  return (
    <PageSurface class="ncm-daily-detail" resetKey={props.updatedAt}>
      <PageHero size="lg">
        <button
          type="button"
          class="ghost-button ncm-daily-detail-back"
          onClick={props.onBack}
        >
          <IconChevronLeft />
          {t("ncm.daily.backToFeed")}
        </button>
        <header class="ncm-daily-detail-hero">
          <h2>{t("ncm.daily.title")}</h2>
          <p class="ncm-daily-detail-meta">{tipText()}</p>
          <div class="ncm-daily-detail-menu">
            <button
              type="button"
              class="primary-button ncm-daily-play-all"
              disabled={props.tracks.length === 0 || playingAll()}
              onClick={() => void handlePlayAll()}
            >
              <IconPlay />
              <span>{playingAll() ? t("ncm.daily.playingAll") : t("ncm.daily.playAll")}</span>
            </button>
            <button
              type="button"
              class="ghost-button ncm-daily-more"
              aria-label={t("ncm.daily.more")}
              disabled={refreshing()}
              onClick={openMenu}
            >
              <IconList />
            </button>
          </div>
        </header>
      </PageHero>
      <PageBody class="ncm-detail-page-body">
        <MediaList
          items={props.tracks}
          currentSourcePath={props.currentTrackPath}
          currentSongId={props.currentSongId}
          isPlayingNow={props.isPlaying}
          onPlay={(item) => void props.playback.playOnlineTrack(item)}
          onEnqueue={(item) => void props.playback.enqueueOnlineTrack(item)}
          onContextAction={handleContextAction}
          contextActions={[
            "play",
            "enqueue",
            "daily-dislike",
            "search",
            "copy-name",
            "copy-id",
            "share-link",
            "song-wiki",
            "view-comments"
          ]}
          sortDisabled={true}
          isLoading={props.isLoading}
          emptyState={<div class="panel-note">{t("ncm.daily.empty")}</div>}
          hideTopScrollTool
        />
      </PageBody>
      <BackToTop label={t("media.scroll.top")} />
      <ContextMenu
        open={menuOpen()}
        x={menuPosition().x}
        y={menuPosition().y}
        items={menuItems()}
        onSelect={handleMenuSelect}
        onClose={() => setMenuOpen(false)}
      />
      <DailySongsBatchModal
        open={batchOpen()}
        items={props.tracks}
        loginProfile={props.loginProfile}
        playback={props.playback}
        setFeedback={props.setFeedback}
        onClose={() => setBatchOpen(false)}
      />
    </PageSurface>
  );
}

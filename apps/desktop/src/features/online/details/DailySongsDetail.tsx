import { createMemo, createSignal } from "solid-js";
import { IconChevronLeft, IconList, IconPlay, IconRefresh } from "../../../components/icons";
import type { MediaContextAction } from "../../../components/media/mediaContextActions";
import { NcmMediaList } from "../NcmMediaList";
import { BackToTop } from "../../../components/page/BackToTop";
import { PageBody } from "../../../components/page/PageBody";
import { PageHero } from "../../../components/page/PageHero";
import { PageSurface } from "../../../components/page/PageSurface";
import { usePlayback } from "../../../app/PlaybackContext";
import { useTranslation } from "../../../shared/i18n";
import { NaiveDropdown, NaiveH2, NaiveP, type NaiveDropdownOption } from "../../../shared/ui/naive";
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
  const playbackContext = usePlayback();
  const readErrorMessage = createErrorMessageReader(t);
  const [menuOpen, setMenuOpen] = createSignal<boolean>(false);
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

  const menuItems = (): readonly NaiveDropdownOption[] => [
    { key: "refresh", label: t("ncm.daily.refresh"), icon: <IconRefresh /> },
    { key: "batch", label: t("ncm.daily.batch"), icon: <IconList /> }
  ];

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
    } else if (action === "mv") {
      // TODO: Navigate to MV page
    } else if (action === "copy-song-info") {
      // TODO: Implement copy song info
    } else if (action === "download") {
      // TODO: Implement download — developer mode only
    }
  };

  return (
    <PageSurface class="ncm-daily-detail" persistKey="discover:daily" resetKey={props.updatedAt}>
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
          <NaiveH2>{t("ncm.daily.title")}</NaiveH2>
          <NaiveP class="ncm-daily-detail-meta">{tipText()}</NaiveP>
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
            <NaiveDropdown
              options={menuItems()}
              triggerMode="click"
              placement="bottom-start"
              gutter={8}
              open={menuOpen()}
              onOpenChange={setMenuOpen}
              onSelect={(option) => handleMenuSelect(option.key)}
              ariaLabel={t("ncm.daily.more")}
              disabled={refreshing()}
            >
              <button
                type="button"
                class="ghost-button ncm-daily-more"
                aria-label={t("ncm.daily.more")}
                disabled={refreshing()}
                aria-haspopup="menu"
                aria-expanded={menuOpen()}
              >
                <IconList />
              </button>
            </NaiveDropdown>
          </div>
        </header>
      </PageHero>
      <PageBody class="ncm-detail-page-body">
        <NcmMediaList
          items={props.tracks}
          currentSourcePath={playbackContext.currentTrackPath()}
          currentSongId={playbackContext.currentSongId()}
          isPlayingNow={playbackContext.isPlaying()}
          onPlay={(item) => void props.playback.playOnlineTrack(item)}
          onEnqueue={(item) => void props.playback.enqueueOnlineTrack(item)}
          onContextAction={handleContextAction}
          contextActions={[
            "play",
            "enqueue",
            "add-to-playlist",
            "mv",
            "view-comments",
            "daily-dislike",
            "search",
            "copy-name",
            "copy-id",
            "copy-song-info",
            "share-link",
            "music-tag-editor",
            "song-wiki"
          ]}
          sortDisabled={true}
          isLoading={props.isLoading}
          emptyState={<NaiveP class="panel-note">{t("ncm.daily.empty")}</NaiveP>}
          hideTopScrollTool
        />
      </PageBody>
      <BackToTop label={t("media.scroll.top")} />
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

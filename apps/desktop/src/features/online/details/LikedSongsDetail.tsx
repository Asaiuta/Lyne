import { IconChevronLeft, IconMusic } from "../../../components/icons";
import { MediaList } from "../../../components/media/MediaList";
import { useTranslation } from "../../../shared/i18n";
import type { PlaybackController } from "../shared/playback";
import type { NcmProfile, OnlineTrackItem } from "../shared/types";
import { NcmListDetail } from "./NcmListDetail";

export interface LikedSongsDetailProps {
  loginProfile: NcmProfile | null;
  tracks: OnlineTrackItem[];
  total: number;
  isLoading: boolean;
  onBack: () => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  playback: PlaybackController;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
}

export function LikedSongsDetail(props: LikedSongsDetailProps) {
  const { t } = useTranslation();
  const eyebrow = () => {
    const profile = props.loginProfile;
    return profile
      ? t("ncm.liked.eyebrow", { name: profile.nickname ?? profile.userId })
      : t("ncm.liked.eyebrowAnonymous");
  };
  return (
    <section class="ncm-daily-detail">
      <button
        type="button"
        class="ghost-button ncm-daily-detail-back"
        onClick={props.onBack}
      >
        <IconChevronLeft />
        {t("ncm.liked.backToFeed")}
      </button>
      <NcmListDetail
        title={t("ncm.liked.title")}
        hiddenCover
        description={eyebrow()}
        metaItems={[
          {
            icon: <IconMusic />,
            text: props.total > 0
              ? t("ncm.liked.metaCount", { count: props.total })
              : t("ncm.liked.description")
          }
        ]}
        playLabel={t("ncm.daily.playAll")}
        playDisabled={props.tracks.length === 0}
        loading={props.isLoading}
        onPlay={() => {
          const [first, ...rest] = props.tracks;
          if (!first) return;
          void (async () => {
            await props.playback.playOnlineTrack(first);
            for (const item of rest) {
              await props.playback.enqueueOnlineTrack(item);
            }
          })();
        }}
      />
      <MediaList
        items={props.tracks}
        currentSourcePath={props.currentTrackPath}
        currentSongId={props.currentSongId}
        isPlayingNow={props.isPlaying}
        onPlay={(item) => void props.playback.playOnlineTrack(item)}
        onEnqueue={(item) => void props.playback.enqueueOnlineTrack(item)}
        onContextAction={(action, item) => {
          if (action === "song-wiki") props.onNavigateToSongWiki?.(item);
        }}
        isLoading={props.isLoading}
        emptyState={<div class="panel-note">{t("ncm.liked.empty")}</div>}
      />
    </section>
  );
}

import { createEffect, on } from "solid-js";
import type { Accessor } from "solid-js";
import { useTranslation } from "../../../shared/i18n";
import type { FeedbackSetter } from "../shared/feedback";
import type { PlaybackController } from "../shared/playback";
import type { NcmProfile, OnlineTrackItem } from "../shared/types";
import { useDetailNavigation } from "../shared/useDetailNavigation";
import { DailySongsDetail } from "./DailySongsDetail";

export interface OnlineDailySongsRouteProps {
  request?: { version: number };
  loginProfile: Accessor<NcmProfile | null>;
  setFeedback: FeedbackSetter;
  playback: PlaybackController;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  onNavigateToMv?: (track: OnlineTrackItem) => void;
}

export function OnlineDailySongsRoute(props: OnlineDailySongsRouteProps) {
  const { t } = useTranslation();
  const detailNav = useDetailNavigation({
    t,
    loginProfile: props.loginProfile,
    playback: props.playback,
    setFeedback: props.setFeedback
  });

  createEffect(
    on(
      () => props.request?.version,
      (version) => {
        if (version === undefined || version === 0) return;
        detailNav.enterDailySongs();
      }
    )
  );

  return (
    <DailySongsDetail
      loginProfile={props.loginProfile()}
      tracks={detailNav.dailySongsState()}
      updatedAt={detailNav.dailySongsUpdatedAt()}
      isLoading={detailNav.isLoadingDailySongs()}
      showInlineBack={false}
      onRefresh={detailNav.refreshDailySongs}
      onPlayAll={detailNav.playAllDailySongs}
      onDislike={detailNav.dislikeDailySong}
      onNavigateToSongWiki={props.onNavigateToSongWiki}
      onNavigateToMv={props.onNavigateToMv}
      setFeedback={props.setFeedback}
      playback={props.playback}
    />
  );
}

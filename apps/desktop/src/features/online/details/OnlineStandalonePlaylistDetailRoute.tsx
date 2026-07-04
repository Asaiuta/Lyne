import { createEffect, on } from "solid-js";
import type { Accessor } from "solid-js";
import { useTranslation } from "../../../shared/i18n";
import type { OnlinePlaylistSummary } from "../ncmPlaylistSummary";
import type { FeedbackSetter } from "../shared/feedback";
import type { PlaybackController } from "../shared/playback";
import type { NcmProfile, OnlineTrackItem } from "../shared/types";
import { useDetailNavigation } from "../shared/useDetailNavigation";
import { OnlinePlaylistDetailRoute } from "./OnlinePlaylistDetailRoute";

export interface OnlineStandalonePlaylistDetailRouteProps {
  request?: { playlist: OnlinePlaylistSummary | null; version: number };
  loginProfile: Accessor<NcmProfile | null>;
  setFeedback: FeedbackSetter;
  playback: PlaybackController;
  onSelectedPlaylistChange?: (playlistId: number | null) => void;
  onPlaylistSubscribeChange?: (playlist: OnlinePlaylistSummary, subscribed: boolean) => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  onNavigateToMv?: (track: OnlineTrackItem) => void;
}

export function OnlineStandalonePlaylistDetailRoute(props: OnlineStandalonePlaylistDetailRouteProps) {
  const { t } = useTranslation();
  const detailNav = useDetailNavigation({
    t,
    loginProfile: props.loginProfile,
    playback: props.playback,
    setFeedback: props.setFeedback,
    onSelectedPlaylistChange: props.onSelectedPlaylistChange,
    onPlaylistSubscribeChange: props.onPlaylistSubscribeChange
  });

  createEffect(
    on(
      () => props.request?.version,
      (version) => {
        if (version === undefined || version === 0) return;
        const playlist = props.request?.playlist;
        if (!playlist) return;
        void detailNav.loadPlaylistTracks(playlist);
      }
    )
  );

  return (
    <OnlinePlaylistDetailRoute
      detailNav={detailNav}
      loginProfile={props.loginProfile()}
      setFeedback={props.setFeedback}
      playback={props.playback}
      onNavigateToSongWiki={props.onNavigateToSongWiki}
      onNavigateToMv={props.onNavigateToMv}
      showInlineBack={false}
    />
  );
}

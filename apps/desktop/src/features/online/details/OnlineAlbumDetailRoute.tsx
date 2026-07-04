import { createEffect, on } from "solid-js";
import type { Accessor } from "solid-js";
import { useTranslation } from "../../../shared/i18n";
import type { FeedbackSetter } from "../shared/feedback";
import type { PlaybackController } from "../shared/playback";
import type { FeedCardItem, NcmProfile, OnlineTrackItem } from "../shared/types";
import { useDetailNavigation } from "../shared/useDetailNavigation";
import { AlbumDetail } from "./AlbumDetail";

export interface OnlineAlbumDetailRouteProps {
  request?: { album: FeedCardItem | null; version: number };
  loginProfile: Accessor<NcmProfile | null>;
  setFeedback: FeedbackSetter;
  playback: PlaybackController;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  onAlbumSubscribeChange?: (album: FeedCardItem, subscribed: boolean) => void;
}

export function OnlineAlbumDetailRoute(props: OnlineAlbumDetailRouteProps) {
  const { t } = useTranslation();
  const detailNav = useDetailNavigation({
    t,
    loginProfile: props.loginProfile,
    playback: props.playback,
    setFeedback: props.setFeedback,
    onAlbumSubscribeChange: props.onAlbumSubscribeChange
  });

  createEffect(
    on(
      () => props.request?.version,
      (version) => {
        if (version === undefined || version === 0) return;
        const album = props.request?.album;
        if (!album) return;
        void detailNav.loadAlbumTracks(album);
      }
    )
  );

  return (
    <AlbumDetail
      album={detailNav.selectedAlbum()}
      detail={detailNav.albumDetailInfo()}
      tracks={detailNav.albumTracksState()}
      isLoading={detailNav.isLoadingAlbumTracks()}
      isLoadingDetail={detailNav.isLoadingAlbumDetail()}
      isTogglingSubscribe={detailNav.isTogglingAlbumSubscribe()}
      onToggleSubscribe={detailNav.toggleAlbumSubscribe}
      onNavigateToSongWiki={props.onNavigateToSongWiki}
      playback={props.playback}
    />
  );
}

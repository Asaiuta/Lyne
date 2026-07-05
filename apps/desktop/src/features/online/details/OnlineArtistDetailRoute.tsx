import { createEffect, on } from "solid-js";
import type { Accessor } from "solid-js";
import { useTranslation } from "../../../shared/i18n";
import type { FeedbackSetter } from "../shared/feedback";
import type { PlaybackController } from "../shared/playback";
import type { FeedCardItem, NcmProfile, OnlineTrackItem } from "../shared/types";
import { useDetailNavigation } from "../shared/useDetailNavigation";
import { ArtistDetail } from "./ArtistDetail";

export interface OnlineArtistDetailRouteProps {
  request?: { artist: FeedCardItem | null; version: number };
  loginProfile: Accessor<NcmProfile | null>;
  setFeedback: FeedbackSetter;
  playback: PlaybackController;
  onNavigateToAlbumDetail?: (album: FeedCardItem) => void;
  onNavigateToVideoDetail?: (video: FeedCardItem) => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  onArtistSubscribeChange?: (artist: FeedCardItem, followed: boolean) => void;
}

export function OnlineArtistDetailRoute(props: OnlineArtistDetailRouteProps) {
  const { t } = useTranslation();
  const detailNav = useDetailNavigation({
    t,
    loginProfile: props.loginProfile,
    playback: props.playback,
    setFeedback: props.setFeedback,
    onArtistSubscribeChange: props.onArtistSubscribeChange
  });

  createEffect(
    on(
      () => props.request?.version,
      (version) => {
        if (version === undefined || version === 0) return;
        const artist = props.request?.artist;
        if (!artist) return;
        void detailNav.loadArtistTracks(artist);
      }
    )
  );

  return (
    <ArtistDetail
      artist={detailNav.selectedArtist()}
      detail={detailNav.artistDetailInfo()}
      tracks={detailNav.artistTracksState()}
      isLoading={detailNav.isLoadingArtistTracks()}
      trackOrder={detailNav.artistTrackOrder()}
      hasMoreTracks={detailNav.artistTracksHasMore()}
      isLoadingDetail={detailNav.isLoadingArtistDetail()}
      isTogglingSubscribe={detailNav.isTogglingArtistSubscribe()}
      albums={detailNav.artistAlbumsState()}
      videos={detailNav.artistVideosState()}
      isLoadingAlbums={detailNav.isLoadingArtistAlbums()}
      isLoadingVideos={detailNav.isLoadingArtistVideos()}
      hasMoreAlbums={detailNav.artistAlbumsHasMore()}
      hasMoreVideos={detailNav.artistVideosHasMore()}
      onLoadAlbums={() => detailNav.loadArtistAlbums()}
      onLoadVideos={() => detailNav.loadArtistVideos()}
      onChangeTrackOrder={(order) => detailNav.changeArtistTrackOrder(order)}
      onLoadMoreTracks={() => detailNav.loadArtistTrackPage({ append: true })}
      onLoadMoreAlbums={() => detailNav.loadArtistAlbums({ append: true })}
      onLoadMoreVideos={() => detailNav.loadArtistVideos({ append: true })}
      onSelectAlbum={(album) => props.onNavigateToAlbumDetail?.(album)}
      onSelectVideo={(video) => props.onNavigateToVideoDetail?.(video)}
      onToggleSubscribe={detailNav.toggleArtistSubscribe}
      showInlineBack={false}
      onNavigateToSongWiki={props.onNavigateToSongWiki}
      playback={props.playback}
    />
  );
}

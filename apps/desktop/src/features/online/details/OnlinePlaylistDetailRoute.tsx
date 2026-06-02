import { PlaylistDetail } from "./PlaylistDetail";
import type { FeedbackSetter } from "../shared/feedback";
import type { PlaybackController } from "../shared/playback";
import type { NcmProfile, OnlineTrackItem } from "../shared/types";
import type { DetailNavigation } from "../shared/useDetailNavigation";

export interface OnlinePlaylistDetailRouteProps {
  detailNav: DetailNavigation;
  subtitleText?: string;
  loginProfile: NcmProfile | null;
  setFeedback: FeedbackSetter;
  playback: PlaybackController;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
}

export function OnlinePlaylistDetailRoute(props: OnlinePlaylistDetailRouteProps) {
  const refreshPlaylist = () => {
    const playlist = props.detailNav.selectedPlaylist();
    if (playlist) void props.detailNav.loadPlaylistTracks(playlist, { forceRefresh: true });
  };

  return (
    <PlaylistDetail
      playlist={props.detailNav.selectedPlaylist()}
      detail={props.detailNav.playlistDetailInfo()}
      tracks={props.detailNav.filteredPlaylistTracks()}
      trackCount={props.detailNav.playlistTrackCount()}
      metaText={props.detailNav.playlistMetaText()}
      subtitleText={props.subtitleText ?? ""}
      isLoadingTracks={props.detailNav.isLoadingPlaylistTracks()}
      isLoadingDetail={props.detailNav.isLoadingPlaylistDetail()}
      isTogglingSubscribe={props.detailNav.isTogglingPlaylistSubscribe()}
      isScrolled={props.detailNav.isPlaylistDetailScrolled()}
      filter={props.detailNav.playlistFilter()}
      detailTab={props.detailNav.playlistDetailTab()}
      setFilter={props.detailNav.setPlaylistFilter}
      setDetailTab={props.detailNav.setPlaylistDetailTab}
      onBack={props.detailNav.handleBackToPlaylists}
      onPlayAll={props.detailNav.playAllPlaylistTracks}
      onRefresh={refreshPlaylist}
      onToggleSubscribe={props.detailNav.togglePlaylistSubscribe}
      onPlaylistUpdated={props.detailNav.updateSelectedPlaylist}
      onNavigateToSongWiki={props.onNavigateToSongWiki}
      onScroll={props.detailNav.handlePlaylistTrackScroll}
      loginProfile={props.loginProfile}
      setFeedback={props.setFeedback}
      playback={props.playback}
    />
  );
}

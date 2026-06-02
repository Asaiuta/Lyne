import { useTranslation } from "../../../shared/i18n";
import type { OnlinePlaylistSummary } from "../ncmPlaylistSummary";
import type { FeedbackSetter } from "../shared/feedback";
import type { PlaybackController } from "../shared/playback";
import type { NcmProfile, OnlineTrackItem } from "../shared/types";
import type { DetailNavigation } from "../shared/useDetailNavigation";
import { PlaylistDetail } from "./PlaylistDetail";

export interface OnlineLikedPlaylistDetailRouteProps {
  detailNav: DetailNavigation;
  loginProfile: NcmProfile | null;
  setFeedback: FeedbackSetter;
  playback: PlaybackController;
  onRefresh?: (playlist: OnlinePlaylistSummary) => void | Promise<void>;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
}

export function OnlineLikedPlaylistDetailRoute(props: OnlineLikedPlaylistDetailRouteProps) {
  const { t } = useTranslation();

  const refreshLikedPlaylist = () => {
    const playlist = props.detailNav.selectedPlaylist();
    if (!playlist) return;
    if (props.onRefresh) {
      void props.onRefresh(playlist);
      return;
    }
    props.detailNav.refreshLikedSongs();
  };

  return (
    <PlaylistDetail
      playlist={props.detailNav.selectedPlaylist()}
      detail={props.detailNav.playlistDetailInfo()}
      tracks={props.detailNav.filteredPlaylistTracks()}
      trackCount={props.detailNav.playlistTrackCount()}
      metaText={props.detailNav.playlistMetaText()}
      subtitleText={t("ncm.liked.eyebrow", {
        name: props.loginProfile?.nickname ?? props.loginProfile?.userId ?? ""
      })}
      isLoadingTracks={props.detailNav.isLoadingPlaylistTracks()}
      isLoadingDetail={props.detailNav.isLoadingPlaylistDetail()}
      isTogglingSubscribe={props.detailNav.isTogglingPlaylistSubscribe()}
      isScrolled={props.detailNav.isPlaylistDetailScrolled()}
      filter={props.detailNav.playlistFilter()}
      detailTab={props.detailNav.playlistDetailTab()}
      setFilter={props.detailNav.setPlaylistFilter}
      setDetailTab={props.detailNav.setPlaylistDetailTab}
      onRefresh={refreshLikedPlaylist}
      onPlayAll={props.detailNav.playAllPlaylistTracks}
      onToggleSubscribe={props.detailNav.togglePlaylistSubscribe}
      onRemoveTracks={props.detailNav.removePlaylistTracks}
      onTracksRemovedLocally={props.detailNav.removePlaylistTracksLocally}
      onPlaylistUpdated={props.detailNav.updateSelectedPlaylist}
      onReorderTracks={props.detailNav.reorderPlaylistTracks}
      onNavigateToSongWiki={props.onNavigateToSongWiki}
      onScroll={props.detailNav.handlePlaylistTrackScroll}
      showCommentsTab={false}
      emptyStateText={t("ncm.liked.empty")}
      sourcePlaylistId={props.detailNav.selectedPlaylist()?.id}
      lockPlaylistName
      loginProfile={props.loginProfile}
      setFeedback={props.setFeedback}
      playback={props.playback}
    />
  );
}

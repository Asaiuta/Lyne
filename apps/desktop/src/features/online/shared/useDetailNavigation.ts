import { createEffect, on } from "solid-js";
import type { Accessor } from "solid-js";
import { createApiClient } from "../../../shared/api/client";
import type { OnlinePlaylistSummary } from "../ncmPlaylistSummary";
import { createErrorMessageReader, type FeedbackSetter, type Translator } from "./feedback";
import type { PlaybackController } from "./playback";
import type { FeedCardItem, NcmProfile } from "./types";
import { createAlbumDetailNavigation } from "./detailNavigation/albumDetailNavigation";
import { createArtistDetailNavigation } from "./detailNavigation/artistDetailNavigation";
import { createDailySongsDetailNavigation } from "./detailNavigation/dailySongsDetailNavigation";
import { createLikedSongsDetailNavigation } from "./detailNavigation/likedSongsDetailNavigation";
import { createPlaylistDetailNavigation } from "./detailNavigation/playlistDetailNavigation";
import { createVideoDetailNavigation } from "./detailNavigation/videoDetailNavigation";

const api = createApiClient();

export interface DetailNavigationContext {
  t: Translator;
  loginProfile: Accessor<NcmProfile | null>;
  playback: PlaybackController;
  setFeedback: FeedbackSetter;
  onSelectedPlaylistChange?: (id: number | null) => void;
  onPlaylistSubscribeChange?: (playlist: OnlinePlaylistSummary, subscribed: boolean) => void;
  onAlbumSubscribeChange?: (album: FeedCardItem, subscribed: boolean) => void;
  onArtistSubscribeChange?: (artist: FeedCardItem, followed: boolean) => void;
}

export function useDetailNavigation(ctx: DetailNavigationContext) {
  const {
    t,
    loginProfile,
    playback,
    setFeedback,
    onSelectedPlaylistChange,
    onPlaylistSubscribeChange,
    onAlbumSubscribeChange,
    onArtistSubscribeChange
  } = ctx;

  const readErrorMessage = createErrorMessageReader(t);
  const baseContext = {
    api,
    t,
    loginProfile,
    playback,
    setFeedback,
    readErrorMessage
  };

  let playlistNav: ReturnType<typeof createPlaylistDetailNavigation>;
  let dailySongsNav: ReturnType<typeof createDailySongsDetailNavigation>;
  let likedSongsNav: ReturnType<typeof createLikedSongsDetailNavigation>;
  let albumNav: ReturnType<typeof createAlbumDetailNavigation>;
  let artistNav: ReturnType<typeof createArtistDetailNavigation>;
  let videoNav: ReturnType<typeof createVideoDetailNavigation>;

  const clearPeerDetailViews = (options: { preserveLikedSelection?: boolean } = {}) => {
    dailySongsNav.clearDailySongs();
    if (options.preserveLikedSelection !== true) {
      likedSongsNav.clearLikedSongs();
    }
    albumNav.clearAlbumDetail();
    artistNav.clearArtistDetail();
    videoNav.clearVideoDetail();
  };

  const clearAllDetailViews = () => {
    playlistNav.clearPlaylistDetail({ resetUi: false });
    dailySongsNav.clearDailySongs();
    likedSongsNav.clearLikedSongs();
    albumNav.clearAlbumDetail();
    artistNav.clearArtistDetail();
    videoNav.clearVideoDetail();
  };

  playlistNav = createPlaylistDetailNavigation({
    ...baseContext,
    clearPeerDetailViews,
    onSelectedPlaylistChange,
    onPlaylistSubscribeChange
  });
  dailySongsNav = createDailySongsDetailNavigation({
    ...baseContext,
    clearAllDetailViews
  });
  likedSongsNav = createLikedSongsDetailNavigation({
    ...baseContext,
    clearAllDetailViews,
    clearPlaylistDetail: playlistNav.clearPlaylistDetail,
    loadPlaylistTracks: playlistNav.loadPlaylistTracks
  });
  albumNav = createAlbumDetailNavigation({
    ...baseContext,
    clearAllDetailViews,
    onAlbumSubscribeChange
  });
  artistNav = createArtistDetailNavigation({
    ...baseContext,
    clearAllDetailViews,
    onArtistSubscribeChange
  });
  videoNav = createVideoDetailNavigation({ clearAllDetailViews });

  createEffect(on(loginProfile, (profile, prev) => {
    if (prev !== undefined && prev !== null && profile === null) {
      clearAllDetailViews();
    }
  }, { defer: true }));

  return {
    selectedPlaylist: playlistNav.selectedPlaylist,
    playlistDetailInfo: playlistNav.playlistDetailInfo,
    playlistTracksState: playlistNav.playlistTracksState,
    isLoadingPlaylistTracks: playlistNav.isLoadingPlaylistTracks,
    isLoadingPlaylistDetail: playlistNav.isLoadingPlaylistDetail,
    isTogglingPlaylistSubscribe: playlistNav.isTogglingPlaylistSubscribe,
    playlistDetailTab: playlistNav.playlistDetailTab,
    playlistFilter: playlistNav.playlistFilter,
    selectedDailySongs: dailySongsNav.selectedDailySongs,
    dailySongsState: dailySongsNav.dailySongsState,
    dailySongsUpdatedAt: dailySongsNav.dailySongsUpdatedAt,
    isLoadingDailySongs: dailySongsNav.isLoadingDailySongs,
    selectedLikedSongs: likedSongsNav.selectedLikedSongs,
    likedSongsState: likedSongsNav.likedSongsState,
    likedSongsTotal: likedSongsNav.likedSongsTotal,
    isLoadingLikedSongs: likedSongsNav.isLoadingLikedSongs,
    selectedAlbum: albumNav.selectedAlbum,
    albumDetailInfo: albumNav.albumDetailInfo,
    albumTracksState: albumNav.albumTracksState,
    isLoadingAlbumTracks: albumNav.isLoadingAlbumTracks,
    isLoadingAlbumDetail: albumNav.isLoadingAlbumDetail,
    isTogglingAlbumSubscribe: albumNav.isTogglingAlbumSubscribe,
    selectedArtist: artistNav.selectedArtist,
    artistDetailInfo: artistNav.artistDetailInfo,
    artistTracksState: artistNav.artistTracksState,
    isLoadingArtistTracks: artistNav.isLoadingArtistTracks,
    isLoadingArtistDetail: artistNav.isLoadingArtistDetail,
    isTogglingArtistSubscribe: artistNav.isTogglingArtistSubscribe,
    artistTrackOrder: artistNav.artistTrackOrder,
    artistTracksHasMore: artistNav.artistTracksHasMore,
    artistAlbumsState: artistNav.artistAlbumsState,
    artistVideosState: artistNav.artistVideosState,
    isLoadingArtistAlbums: artistNav.isLoadingArtistAlbums,
    isLoadingArtistVideos: artistNav.isLoadingArtistVideos,
    artistAlbumsHasMore: artistNav.artistAlbumsHasMore,
    artistVideosHasMore: artistNav.artistVideosHasMore,
    selectedVideo: videoNav.selectedVideo,

    setSelectedPlaylist: playlistNav.setSelectedPlaylist,
    updateSelectedPlaylist: playlistNav.updateSelectedPlaylist,
    setPlaylistTracksState: playlistNav.setPlaylistTracksState,
    setPlaylistDetailTab: playlistNav.setPlaylistDetailTab,
    setPlaylistFilter: playlistNav.setPlaylistFilter,

    loadPlaylistTracks: playlistNav.loadPlaylistTracks,
    togglePlaylistSubscribe: playlistNav.togglePlaylistSubscribe,
    loadAlbumTracks: albumNav.loadAlbumTracks,
    toggleAlbumSubscribe: albumNav.toggleAlbumSubscribe,
    loadArtistTracks: artistNav.loadArtistTracks,
    loadArtistTrackPage: artistNav.loadArtistTrackPage,
    changeArtistTrackOrder: artistNav.changeArtistTrackOrder,
    loadArtistAlbums: artistNav.loadArtistAlbums,
    loadArtistVideos: artistNav.loadArtistVideos,
    toggleArtistSubscribe: artistNav.toggleArtistSubscribe,
    enterVideo: videoNav.enterVideo,

    enterDailySongs: dailySongsNav.enterDailySongs,
    refreshDailySongs: dailySongsNav.refreshDailySongs,
    playAllDailySongs: dailySongsNav.playAllDailySongs,
    dislikeDailySong: dailySongsNav.dislikeDailySong,
    removePlaylistTracks: playlistNav.removePlaylistTracks,
    removePlaylistTracksLocally: playlistNav.removePlaylistTracksLocally,
    reorderPlaylistTracks: playlistNav.reorderPlaylistTracks,
    enterLikedSongs: likedSongsNav.enterLikedSongs,
    refreshLikedSongs: likedSongsNav.refreshLikedSongs,
    exitDailySongs: dailySongsNav.exitDailySongs,
    exitLikedSongs: likedSongsNav.exitLikedSongs,
    exitAlbum: albumNav.exitAlbum,
    exitArtist: artistNav.exitArtist,
    exitVideo: videoNav.exitVideo,
    handleBackToPlaylists: playlistNav.handleBackToPlaylists,
    clearAllDetailViews,

    filteredPlaylistTracks: playlistNav.filteredPlaylistTracks,
    playlistTrackCount: playlistNav.playlistTrackCount,
    playlistMetaText: playlistNav.playlistMetaText,
    playAllPlaylistTracks: playlistNav.playAllPlaylistTracks
  };
}

export type DetailNavigation = ReturnType<typeof useDetailNavigation>;

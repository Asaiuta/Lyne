import { Match, Switch, createEffect, createMemo, on } from "solid-js";
import type { Accessor } from "solid-js";
import { useTranslation } from "../../../shared/i18n";
import { AlbumDetail } from "../details/AlbumDetail";
import { ArtistDetail } from "../details/ArtistDetail";
import { OnlinePlaylistDetailRoute } from "../details/OnlinePlaylistDetailRoute";
import { VideoDetail } from "../details/VideoDetail";
import type { FeedbackSetter } from "../shared/feedback";
import { createDetailViewReporter, type OnlineDetailViewReporterProps } from "../shared/detailViewReporter";
import type { PlaybackController } from "../shared/playback";
import type { OnlineSearchController } from "../shared/useOnlineSearchController";
import type { FeedCardItem, NcmProfile, OnlineTrackItem } from "../shared/types";
import { useDetailNavigation } from "../shared/useDetailNavigation";
import { SearchMode } from "./SearchMode";

type SearchDetailView =
  | { kind: "album" }
  | { kind: "artist" }
  | { kind: "video" }
  | { kind: "playlist" }
  | { kind: "results" };

export interface OnlineSearchModeProps extends OnlineDetailViewReporterProps {
  loginProfile: Accessor<NcmProfile | null>;
  search: OnlineSearchController;
  onNavigateToRadioDetail?: (radio: FeedCardItem) => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  onSelectedPlaylistChange?: (playlistId: number | null) => void;
  setFeedback: FeedbackSetter;
  playback: PlaybackController;
}

export function OnlineSearchMode(props: OnlineSearchModeProps) {
  const { t } = useTranslation();
  const detailNav = useDetailNavigation({
    t,
    loginProfile: props.loginProfile,
    playback: props.playback,
    setFeedback: props.setFeedback,
    onSelectedPlaylistChange: props.onSelectedPlaylistChange
  });

  const detailView = createMemo<SearchDetailView>(() => {
    if (detailNav.selectedAlbum()) return { kind: "album" };
    if (detailNav.selectedArtist()) return { kind: "artist" };
    if (detailNav.selectedVideo()) return { kind: "video" };
    if (detailNav.selectedPlaylist()) return { kind: "playlist" };
    return { kind: "results" };
  });
  const hasDetailView = createMemo<boolean>(() => detailView().kind !== "results");

  createDetailViewReporter(hasDetailView, props.onDetailViewChange);

  createEffect(
    on(
      props.search.runVersion,
      () => {
        detailNav.clearAllDetailViews();
      },
      { defer: true }
    )
  );

  return (
    <Switch>
      <Match when={detailView().kind === "album"}>
        <AlbumDetail
          album={detailNav.selectedAlbum()}
          detail={detailNav.albumDetailInfo()}
          tracks={detailNav.albumTracksState()}
          isLoading={detailNav.isLoadingAlbumTracks()}
          isLoadingDetail={detailNav.isLoadingAlbumDetail()}
          isTogglingSubscribe={detailNav.isTogglingAlbumSubscribe()}
          onToggleSubscribe={detailNav.toggleAlbumSubscribe}
          onBack={detailNav.exitAlbum}
          onNavigateToSongWiki={props.onNavigateToSongWiki}
          playback={props.playback}
        />
      </Match>
      <Match when={detailView().kind === "artist"}>
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
          onSelectAlbum={(album) => void detailNav.loadAlbumTracks(album)}
          onSelectVideo={(video) => detailNav.enterVideo(video)}
          onToggleSubscribe={detailNav.toggleArtistSubscribe}
          onBack={detailNav.exitArtist}
          onNavigateToSongWiki={props.onNavigateToSongWiki}
          playback={props.playback}
        />
      </Match>
      <Match when={detailView().kind === "video"}>
        <VideoDetail
          video={detailNav.selectedVideo()}
          onBack={detailNav.exitVideo}
          onSelectArtist={(artist) => void detailNav.loadArtistTracks(artist)}
        />
      </Match>
      <Match when={detailView().kind === "playlist"}>
        <OnlinePlaylistDetailRoute
          detailNav={detailNav}
          subtitleText={props.search.submittedQuery() || t("ncm.search.title")}
          loginProfile={props.loginProfile()}
          setFeedback={props.setFeedback}
          playback={props.playback}
          onNavigateToSongWiki={props.onNavigateToSongWiki}
        />
      </Match>
      <Match when={detailView().kind === "results"}>
        <SearchMode
          searchTab={props.search.searchTab()}
          onSearchTabChange={props.search.setSearchTab}
          isSearching={props.search.isSearching()}
          songResults={props.search.songResults()}
          playlistResults={props.search.playlistResults()}
          artistResults={props.search.artistResults()}
          albumResults={props.search.albumResults()}
          videoResults={props.search.videoResults()}
          radioResults={props.search.radioResults()}
          searchQuery={props.search.submittedQuery}
          onSelectPlaylist={(playlist) => void detailNav.loadPlaylistTracks(playlist)}
          onSelectArtist={(artist) => void detailNav.loadArtistTracks(artist)}
          onSelectAlbum={(album) => void detailNav.loadAlbumTracks(album)}
          onSelectVideo={(video) => detailNav.enterVideo(video)}
          onSelectRadio={(radio) => props.onNavigateToRadioDetail?.(radio)}
          onNavigateToSongWiki={props.onNavigateToSongWiki}
          playlistEmptyHint={t("ncm.empty.noPlaylistsHint")}
          playback={props.playback}
        />
      </Match>
    </Switch>
  );
}

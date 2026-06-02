import { Match, Show, Switch, createEffect, createMemo, createSignal, on } from "solid-js";
import type { Accessor } from "solid-js";
import { useTranslation } from "../../../shared/i18n";
import { createApiClient } from "../../../shared/api/client";
import { PageHeader } from "../../../components/page/PageHeader";
import { usePlayback } from "../../../app/PlaybackContext";
import { useUISettings } from "../../../shared/state/useUISettings";
import { NaiveP } from "../../../shared/ui/naive";
import { NeteaseHomeFeed } from "../NeteaseHomeFeed";
import { AlbumDetail } from "../details/AlbumDetail";
import { ArtistDetail } from "../details/ArtistDetail";
import { DailySongsDetail } from "../details/DailySongsDetail";
import { OnlineLikedPlaylistDetailRoute } from "../details/OnlineLikedPlaylistDetailRoute";
import { OnlinePlaylistDetailRoute } from "../details/OnlinePlaylistDetailRoute";
import { VideoDetail } from "../details/VideoDetail";
import { createErrorMessageReader, type FeedbackSetter } from "../shared/feedback";
import type { PlaybackController } from "../shared/playback";
import type { FeedCardItem, NcmProfile, OnlineTrackItem } from "../shared/types";
import { createDetailViewReporter, type OnlineDetailViewReporterProps } from "../shared/detailViewReporter";
import { useDetailNavigation } from "../shared/useDetailNavigation";

export interface RecommendModeProps extends OnlineDetailViewReporterProps {
  loginProfile: Accessor<NcmProfile | null>;
  globalQuery: Accessor<string>;
  submitNonce: Accessor<number>;
  onSelectedPlaylistChange?: (playlistId: number | null) => void;
  onNavigate?: (page: "recommend" | "discover" | "radio") => void;
  onNavigateToDiscover?: (tab: string) => void;
  onNavigateToRadioDetail?: (radio: FeedCardItem) => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  onMarkPendingDiscoverSearch: () => void;
  setFeedback: FeedbackSetter;
  playback: PlaybackController;
}

const api = createApiClient();

export function RecommendMode(props: RecommendModeProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const playbackContext = usePlayback();
  const [isPlayingPersonalFm, setIsPlayingPersonalFm] = createSignal(false);

  const detailNav = useDetailNavigation({
    t,
    loginProfile: props.loginProfile,
    playback: props.playback,
    setFeedback: props.setFeedback,
    onSelectedPlaylistChange: props.onSelectedPlaylistChange
  });

  const recommendGreeting = createMemo(() => {
    const hour = new Date().getHours();
    const greeting = (() => {
      if (hour < 6) return t("ncm.home.greeting.beforeDawn");
      if (hour < 9) return t("ncm.home.greeting.earlyMorning");
      if (hour < 12) return t("ncm.home.greeting.morning");
      if (hour < 14) return t("ncm.home.greeting.noon");
      if (hour < 17) return t("ncm.home.greeting.afternoon");
      if (hour < 19) return t("ncm.home.greeting.dusk");
      if (hour < 22) return t("ncm.home.greeting.evening");
      return t("ncm.home.greeting.lateNight");
    })();

    const name = props.loginProfile()?.nickname;
    return name ? `${greeting}，${name}` : greeting;
  });

  const readErrorMessage = createErrorMessageReader(t);
  const pageTitle = () => t("ncm.title.recommend");

  const hasDetailView = createMemo<boolean>(() =>
    detailNav.selectedDailySongs() ||
    detailNav.selectedLikedSongs() ||
    detailNav.selectedAlbum() !== null ||
    detailNav.selectedArtist() !== null ||
    detailNav.selectedPlaylist() !== null ||
    detailNav.selectedVideo() !== null
  );

  createDetailViewReporter(hasDetailView, props.onDetailViewChange);

  const renderHomeFeed = () => (
    <section class="online-recommend-stage">
      <NeteaseHomeFeed
        isLoggedIn={props.loginProfile() !== null}
        userId={props.loginProfile()?.userId ?? null}
        onSelectPlaylist={(playlist) => void detailNav.loadPlaylistTracks(playlist)}
        onSelectDailySongs={detailNav.enterDailySongs}
        onSelectLikedSongs={detailNav.enterLikedSongs}
        onPlayPersonalFm={() => void playPersonalFmRadio()}
        onDislikePersonalFm={(songId) => void dislikePersonalFmTrack(songId)}
        onSelectAlbum={(item) => void detailNav.loadAlbumTracks(item)}
        onSelectArtist={(item) => void detailNav.loadArtistTracks(item)}
        onSelectVideo={(item) => detailNav.enterVideo(item)}
        onNavigateToDiscover={(tab) => handleNavigateToDiscover(tab)}
        onSelectRadio={(item) => props.onNavigateToRadioDetail?.(item)}
      />
    </section>
  );

  const playPersonalFmRadio = async () => {
    if (isPlayingPersonalFm()) return;
    setIsPlayingPersonalFm(true);
    try {
      const tracks = await api.listNcmPersonalFmTracks();
      if (tracks.length === 0) {
        props.setFeedback("error", t("ncm.fm.feedback.empty"));
        return;
      }
      await props.playback.playAll(tracks);
      props.setFeedback("success", t("ncm.fm.feedback.started", { count: tracks.length }));
    } catch (error) {
      props.setFeedback("error", readErrorMessage(error));
    } finally {
      setIsPlayingPersonalFm(false);
    }
  };

  const dislikePersonalFmTrack = async (previewSongId: number | null) => {
    const songId = playbackContext.currentSongId() ?? previewSongId;
    try {
      if (songId !== null) {
        await api.trashNcmPersonalFmTrack(songId);
        props.setFeedback("success", t("ncm.fm.feedback.disliked"));
      }
      await playbackContext.skipNext();
    } catch (error) {
      props.setFeedback("error", readErrorMessage(error));
    }
  };

  const handleNavigateToDiscover = (tab: string) => {
    detailNav.clearAllDetailViews();
    props.onNavigateToDiscover?.(tab);
  };

  createEffect(
    on(props.submitNonce, () => {
      if (!props.globalQuery().trim()) return;
      props.onMarkPendingDiscoverSearch();
      props.onNavigate?.("discover");
    })
  );

  return (
    <>
      <Show when={!hasDetailView() && uiSettings.showHomeGreeting}>
        <PageHeader title={recommendGreeting()} />
      </Show>
      <Show when={!hasDetailView() && uiSettings.showHomeGreeting}>
        <NaiveP class="online-recommend-subtitle">{t("ncm.home.welcome")}</NaiveP>
      </Show>
      <Switch fallback={renderHomeFeed()}>
        <Match when={detailNav.selectedDailySongs()}>
          <DailySongsDetail
            loginProfile={props.loginProfile()}
            tracks={detailNav.dailySongsState()}
            updatedAt={detailNav.dailySongsUpdatedAt()}
            isLoading={detailNav.isLoadingDailySongs()}
            onBack={detailNav.exitDailySongs}
            onRefresh={detailNav.refreshDailySongs}
            onPlayAll={detailNav.playAllDailySongs}
            onDislike={detailNav.dislikeDailySong}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
            setFeedback={props.setFeedback}
            playback={props.playback}
          />
        </Match>
        <Match when={detailNav.selectedLikedSongs()}>
          <Show
            when={detailNav.selectedPlaylist()}
            fallback={<NaiveP class="panel-note">{detailNav.isLoadingLikedSongs() ? t("ncm.playlist.loading") : t("ncm.liked.empty")}</NaiveP>}
          >
            <OnlineLikedPlaylistDetailRoute
              detailNav={detailNav}
              loginProfile={props.loginProfile()}
              setFeedback={props.setFeedback}
              playback={props.playback}
              onNavigateToSongWiki={props.onNavigateToSongWiki}
            />
          </Show>
        </Match>
        <Match when={detailNav.selectedAlbum() !== null}>
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
        <Match when={detailNav.selectedArtist() !== null}>
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
        <Match when={detailNav.selectedPlaylist() !== null}>
          <OnlinePlaylistDetailRoute
            detailNav={detailNav}
            subtitleText={pageTitle()}
            loginProfile={props.loginProfile()}
            setFeedback={props.setFeedback}
            playback={props.playback}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
          />
        </Match>
        <Match when={detailNav.selectedVideo() !== null}>
          <VideoDetail
            video={detailNav.selectedVideo()}
            onBack={detailNav.exitVideo}
            onSelectArtist={(artist) => void detailNav.loadArtistTracks(artist)}
          />
        </Match>
      </Switch>
    </>
  );
}

import { Match, Show, Switch, createEffect, createMemo, createSignal, on } from "solid-js";
import type { Accessor } from "solid-js";
import { useTranslation } from "../../../shared/i18n";
import { createApiClient } from "../../../shared/api/client";
import { PageHeader } from "../../../components/page/PageHeader";
import { useUISettings } from "../../../shared/state/useUISettings";
import { NeteaseHomeFeed } from "../NeteaseHomeFeed";
import { AlbumDetail } from "../details/AlbumDetail";
import { ArtistDetail } from "../details/ArtistDetail";
import { DailySongsDetail } from "../details/DailySongsDetail";
import { PlaylistDetail } from "../details/PlaylistDetail";
import { VideoDetail } from "../details/VideoDetail";
import { createErrorMessageReader, type FeedbackSetter } from "../shared/feedback";
import type { PlaybackController } from "../shared/playback";
import type { FeedCardItem, NcmProfile, OnlineTrackItem } from "../shared/types";
import { useDetailNavigation } from "../shared/useDetailNavigation";

export interface RecommendModeProps {
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
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
  onPlay: () => Promise<void>;
  onPause: () => Promise<void>;
  onSkipNext: () => Promise<void> | undefined;
}

const api = createApiClient();

export function RecommendMode(props: RecommendModeProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
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

  const pageTitle = () => t("ncm.title.recommend");

  const readErrorMessage = createErrorMessageReader(t);

  const hasDetailView = createMemo<boolean>(() =>
    detailNav.selectedDailySongs() ||
    detailNav.selectedLikedSongs() ||
    detailNav.selectedAlbum() !== null ||
    detailNav.selectedArtist() !== null ||
    detailNav.selectedPlaylist() !== null ||
    detailNav.selectedVideo() !== null
  );

  const renderHomeFeed = () => (
    <section class="online-recommend-stage">
      <NeteaseHomeFeed
        isLoggedIn={props.loginProfile() !== null}
        userId={props.loginProfile()?.userId ?? null}
        onSelectPlaylist={(playlist) => void detailNav.loadPlaylistTracks(playlist)}
        onSelectDailySongs={detailNav.enterDailySongs}
        onSelectLikedSongs={detailNav.enterLikedSongs}
        onPlayPersonalFm={() => void playPersonalFmRadio()}
        onPlay={() => void props.onPlay()}
        onPause={() => void props.onPause()}
        onSkipNext={() => void props.onSkipNext()}
        onDislikePersonalFm={(songId) => void dislikePersonalFmTrack(songId)}
        isPlaying={props.isPlaying}
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
      const [first, ...rest] = tracks;
      await props.playback.playOnlineTrack(first);
      for (const track of rest) {
        await props.playback.enqueueOnlineTrack(track);
      }
      props.setFeedback("success", t("ncm.fm.feedback.started", { count: tracks.length }));
    } catch (error) {
      props.setFeedback("error", readErrorMessage(error));
    } finally {
      setIsPlayingPersonalFm(false);
    }
  };

  const dislikePersonalFmTrack = async (previewSongId: number | null) => {
    const songId = props.currentSongId ?? previewSongId;
    try {
      if (songId !== null) {
        await api.trashNcmPersonalFmTrack(songId);
        props.setFeedback("success", t("ncm.fm.feedback.disliked"));
      }
      await props.onSkipNext();
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
        <p class="online-recommend-subtitle">{t("ncm.home.welcome")}</p>
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
            currentTrackPath={props.currentTrackPath}
            currentSongId={props.currentSongId}
            isPlaying={props.isPlaying}
          />
        </Match>
        <Match when={detailNav.selectedLikedSongs()}>
          <Show
            when={detailNav.selectedPlaylist()}
            fallback={<div class="panel-note">{detailNav.isLoadingLikedSongs() ? t("ncm.playlist.loading") : t("ncm.liked.empty")}</div>}
          >
            <PlaylistDetail
              playlist={detailNav.selectedPlaylist()}
              detail={detailNav.playlistDetailInfo()}
              tracks={detailNav.filteredPlaylistTracks()}
              trackCount={detailNav.playlistTrackCount()}
              metaText={detailNav.playlistMetaText()}
              subtitleText={t("ncm.liked.eyebrow", {
                name: props.loginProfile()?.nickname ?? props.loginProfile()?.userId ?? ""
              })}
              isLoadingTracks={detailNav.isLoadingPlaylistTracks()}
              isLoadingDetail={detailNav.isLoadingPlaylistDetail()}
              isTogglingSubscribe={detailNav.isTogglingPlaylistSubscribe()}
              isScrolled={detailNav.isPlaylistDetailScrolled()}
              filter={detailNav.playlistFilter()}
              detailTab={detailNav.playlistDetailTab()}
              setFilter={detailNav.setPlaylistFilter}
              setDetailTab={detailNav.setPlaylistDetailTab}
              onBack={detailNav.exitLikedSongs}
              onRefresh={() => detailNav.enterLikedSongs()}
              onPlayAll={detailNav.playAllPlaylistTracks}
              onToggleSubscribe={detailNav.togglePlaylistSubscribe}
              onRemoveTracks={detailNav.removePlaylistTracks}
              onTracksRemovedLocally={detailNav.removePlaylistTracksLocally}
              onPlaylistUpdated={detailNav.updateSelectedPlaylist}
              onReorderTracks={detailNav.reorderPlaylistTracks}
              onNavigateToSongWiki={props.onNavigateToSongWiki}
              onScroll={detailNav.handlePlaylistTrackScroll}
              backLabel={t("ncm.liked.backToFeed")}
              showCommentsTab={false}
              emptyStateText={t("ncm.liked.empty")}
              sourcePlaylistId={detailNav.selectedPlaylist()?.id}
              lockPlaylistName={true}
              loginProfile={props.loginProfile()}
              setFeedback={props.setFeedback}
              playback={props.playback}
              currentTrackPath={props.currentTrackPath}
              currentSongId={props.currentSongId}
              isPlaying={props.isPlaying}
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
            currentTrackPath={props.currentTrackPath}
            currentSongId={props.currentSongId}
            isPlaying={props.isPlaying}
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
            currentTrackPath={props.currentTrackPath}
            currentSongId={props.currentSongId}
            isPlaying={props.isPlaying}
          />
        </Match>
        <Match when={detailNav.selectedPlaylist() !== null}>
          <PlaylistDetail
            playlist={detailNav.selectedPlaylist()}
            detail={detailNav.playlistDetailInfo()}
            tracks={detailNav.filteredPlaylistTracks()}
            trackCount={detailNav.playlistTrackCount()}
            metaText={detailNav.playlistMetaText()}
            subtitleText={pageTitle()}
            isLoadingTracks={detailNav.isLoadingPlaylistTracks()}
            isLoadingDetail={detailNav.isLoadingPlaylistDetail()}
            isTogglingSubscribe={detailNav.isTogglingPlaylistSubscribe()}
            isScrolled={detailNav.isPlaylistDetailScrolled()}
            filter={detailNav.playlistFilter()}
            detailTab={detailNav.playlistDetailTab()}
            setFilter={detailNav.setPlaylistFilter}
            setDetailTab={detailNav.setPlaylistDetailTab}
            onBack={detailNav.handleBackToPlaylists}
            onPlayAll={detailNav.playAllPlaylistTracks}
            onRefresh={() => {
              const playlist = detailNav.selectedPlaylist();
              if (playlist) void detailNav.loadPlaylistTracks(playlist);
            }}
            onToggleSubscribe={detailNav.togglePlaylistSubscribe}
            onPlaylistUpdated={detailNav.updateSelectedPlaylist}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
            onScroll={detailNav.handlePlaylistTrackScroll}
            loginProfile={props.loginProfile()}
            setFeedback={props.setFeedback}
            playback={props.playback}
            currentTrackPath={props.currentTrackPath}
            currentSongId={props.currentSongId}
            isPlaying={props.isPlaying}
          />
        </Match>
        <Match when={detailNav.selectedVideo() !== null}>
          <VideoDetail
            video={detailNav.selectedVideo()}
            onBack={detailNav.exitVideo}
            onPauseAudio={props.onPause}
            onSelectArtist={(artist) => void detailNav.loadArtistTracks(artist)}
          />
        </Match>
      </Switch>
    </>
  );
}

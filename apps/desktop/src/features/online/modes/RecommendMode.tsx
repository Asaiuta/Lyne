import { Show, createEffect, createMemo, createSignal, on } from "solid-js";
import type { Accessor } from "solid-js";
import { useTranslation } from "../../../shared/i18n";
import { personalFm } from "../../../shared/api/ncm";
import { PageHeader } from "../../../components/page/PageHeader";
import { NeteaseHomeFeed } from "../NeteaseHomeFeed";
import { AlbumDetail } from "../details/AlbumDetail";
import { ArtistDetail } from "../details/ArtistDetail";
import { DailySongsDetail } from "../details/DailySongsDetail";
import { LikedSongsDetail } from "../details/LikedSongsDetail";
import { PlaylistDetail } from "../details/PlaylistDetail";
import { readPersonalFmTracks } from "../shared/parsers";
import type { PlaybackController } from "../shared/playback";
import type { Feedback, NcmProfile } from "../shared/types";
import { useDetailNavigation } from "../shared/useDetailNavigation";

export interface RecommendModeProps {
  loginProfile: Accessor<NcmProfile | null>;
  globalQuery: Accessor<string>;
  submitNonce: Accessor<number>;
  onSelectedPlaylistChange?: (playlistId: number | null) => void;
  onNavigate?: (page: "recommend" | "discover") => void;
  onNavigateToDiscover?: (tab: string) => void;
  onMarkPendingDiscoverSearch: () => void;
  setFeedback: (tone: Feedback["tone"], message: string) => void;
  playback: PlaybackController;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
}

export function RecommendMode(props: RecommendModeProps) {
  const { t } = useTranslation();
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
    if (hour < 6) return t("ncm.home.greeting.lateNight");
    if (hour < 9) return t("ncm.home.greeting.earlyMorning");
    if (hour < 12) return t("ncm.home.greeting.morning");
    if (hour < 14) return t("ncm.home.greeting.noon");
    if (hour < 17) return t("ncm.home.greeting.afternoon");
    if (hour < 19) return t("ncm.home.greeting.dusk");
    if (hour < 22) return t("ncm.home.greeting.evening");
    return t("ncm.home.greeting.lateNight");
  });

  const pageTitle = () => t("ncm.title.recommend");

  const readErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : t("common.error.requestFailed");

  const playPersonalFmRadio = async () => {
    if (isPlayingPersonalFm()) return;
    setIsPlayingPersonalFm(true);
    try {
      const response = await personalFm();
      const tracks = readPersonalFmTracks(response);
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
      <Show when={!detailNav.selectedPlaylist()}>
        <PageHeader title={recommendGreeting()} />
      </Show>
      <p class="online-recommend-subtitle">{t("ncm.home.welcome")}</p>
      <Show
        when={detailNav.selectedDailySongs()}
        fallback={
        <Show
          when={detailNav.selectedLikedSongs()}
          fallback={
            <Show
              when={detailNav.selectedAlbum()}
              fallback={
                <Show
                  when={detailNav.selectedArtist()}
                  fallback={
                    <Show
                      when={detailNav.selectedPlaylist()}
                      fallback={
                        <section class="online-recommend-stage">
                          <NeteaseHomeFeed
                            isLoggedIn={props.loginProfile() !== null}
                            userId={props.loginProfile()?.userId ?? null}
                            onSelectPlaylist={(playlist) => void detailNav.loadPlaylistTracks(playlist)}
                            onSelectDailySongs={detailNav.enterDailySongs}
                            onSelectLikedSongs={detailNav.enterLikedSongs}
                            onPlayPersonalFm={() => void playPersonalFmRadio()}
                            onSelectAlbum={(item) => void detailNav.loadAlbumTracks(item)}
                            onSelectArtist={(item) => void detailNav.loadArtistTracks(item)}
                            onNavigateToDiscover={(tab) => handleNavigateToDiscover(tab)}
                          />
                        </section>
                      }
                    >
                      <PlaylistDetail
                        playlist={detailNav.selectedPlaylist()}
                        tracks={detailNav.filteredPlaylistTracks()}
                        trackCount={detailNav.playlistTrackCount()}
                        metaText={detailNav.playlistMetaText()}
                        subtitleText={pageTitle()}
                        isLoadingTracks={detailNav.isLoadingPlaylistTracks()}
                        isScrolled={detailNav.isPlaylistDetailScrolled()}
                        filter={detailNav.playlistFilter()}
                        detailTab={detailNav.playlistDetailTab()}
                        setFilter={detailNav.setPlaylistFilter}
                        setDetailTab={detailNav.setPlaylistDetailTab}
                        onBack={detailNav.handleBackToPlaylists}
                        onPlayAll={detailNav.playAllPlaylistTracks}
                        onScroll={detailNav.handlePlaylistTrackScroll}
                        playback={props.playback}
                        currentTrackPath={props.currentTrackPath}
                        currentSongId={props.currentSongId}
                        isPlaying={props.isPlaying}
                      />
                    </Show>
                  }
                >
                  <ArtistDetail
                    artist={detailNav.selectedArtist()}
                    tracks={detailNav.artistTracksState()}
                    isLoading={detailNav.isLoadingArtistTracks()}
                    onBack={detailNav.exitArtist}
                    playback={props.playback}
                    currentTrackPath={props.currentTrackPath}
                    currentSongId={props.currentSongId}
                    isPlaying={props.isPlaying}
                  />
                </Show>
              }
            >
              <AlbumDetail
                album={detailNav.selectedAlbum()}
                tracks={detailNav.albumTracksState()}
                isLoading={detailNav.isLoadingAlbumTracks()}
                onBack={detailNav.exitAlbum}
                playback={props.playback}
                currentTrackPath={props.currentTrackPath}
                currentSongId={props.currentSongId}
                isPlaying={props.isPlaying}
              />
            </Show>
          }
        >
          <LikedSongsDetail
            loginProfile={props.loginProfile()}
            tracks={detailNav.likedSongsState()}
            total={detailNav.likedSongsTotal()}
            isLoading={detailNav.isLoadingLikedSongs()}
            onBack={detailNav.exitLikedSongs}
            playback={props.playback}
            currentTrackPath={props.currentTrackPath}
            currentSongId={props.currentSongId}
            isPlaying={props.isPlaying}
          />
        </Show>
      }
    >
      <DailySongsDetail
        loginProfile={props.loginProfile()}
        tracks={detailNav.dailySongsState()}
        isLoading={detailNav.isLoadingDailySongs()}
        onBack={detailNav.exitDailySongs}
        playback={props.playback}
        currentTrackPath={props.currentTrackPath}
        currentSongId={props.currentSongId}
        isPlaying={props.isPlaying}
      />
      </Show>
    </>
  );
}

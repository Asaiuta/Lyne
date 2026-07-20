import {
  Match,
  Show,
  Suspense,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  on,
  type Accessor,
  type JSX
} from "solid-js";
import { AppShell } from "../components/AppShell";
import { AppearanceLayer } from "../components/AppearanceLayer";
import { PageTransition } from "../components/PageTransition";
import { PanelErrorBoundary } from "../components/PanelErrorBoundary";
import { PlayerBar } from "../components/PlayerBar";
import { TopNav } from "../components/TopNav";
import { WindowControls } from "../components/WindowControls";
import { ListSkeleton, Skeleton } from "../components/page/Skeleton";
import type { SettingsCategoryKey } from "../features/settings/components/SettingsCategoryNav";
import { createApiClient } from "../shared/api/client";
import { useTranslation } from "../shared/i18n";
import { useNcmAccount } from "../shared/state/NcmAccountContext";
import type { ActivePage } from "../shared/ui/navigation";
import { UISearchProvider, useUISearch } from "../shared/state/UISearchContext";
import { NaiveFeedbackProvider } from "../shared/ui/naive";
import "../shared/styles/components/page-foundation.css";
import { useAppController } from "./useAppController";
import { PlaybackProvider } from "./PlaybackContext";
import { Sidebar } from "./Sidebar";
import { createDeferredLazyComponent } from "./deferredLazyComponent";
import { useFullPlayerWarmup } from "./useFullPlayerWarmup";

const api = createApiClient();

const LibraryPage = createDeferredLazyComponent(() =>
  import("../features/library/LibraryPage").then((module) => module.LibraryPage)
);
const NeteasePage = createDeferredLazyComponent(() =>
  import("../features/online/NeteasePage").then((module) => module.NeteasePage)
);
const HistoryPage = createDeferredLazyComponent(() =>
  import("../features/history/HistoryPage").then((module) => module.HistoryPage)
);
const DownloadPage = createDeferredLazyComponent(() =>
  import("../features/download/DownloadPage").then((module) => module.DownloadPage)
);
const StreamingPage = createDeferredLazyComponent(() =>
  import("../features/streaming/StreamingPage").then((module) => module.StreamingPage)
);
const CloudPage = createDeferredLazyComponent(() =>
  import("../features/online/CloudPage").then((module) => module.CloudPage)
);
const PersonalFmPage = createDeferredLazyComponent(() =>
  import("../features/online/PersonalFmPage").then((module) => module.PersonalFmPage)
);
const NeteaseRadioPage = createDeferredLazyComponent(() =>
  import("../features/online/NeteaseRadioPage").then((module) => module.NeteaseRadioPage)
);
const SongWikiPage = createDeferredLazyComponent(() =>
  import("../features/online/SongWikiPage").then((module) => module.SongWikiPage)
);
const QueueDrawer = createDeferredLazyComponent(() =>
  import("../features/queue/QueueDrawer").then((module) => module.QueueDrawer)
);
const SettingsPage = createDeferredLazyComponent(() =>
  import("../features/settings/SettingsPage").then((module) => module.SettingsPage)
);
const FullPlayer = createDeferredLazyComponent(() =>
  import("../components/FullPlayer").then((module) => module.FullPlayer)
);
const LoginModal = createDeferredLazyComponent(() =>
  import("../components/LoginModal").then((module) => module.LoginModal)
);

const NETEASE_PAGES = [
  "recommend",
  "discover",
  "search",
  "album-detail",
  "playlist-detail",
  "daily-songs",
  "artist-detail",
  "video-detail",
  "liked-songs",
  "liked",
  "created-playlists",
  "collected-playlists"
] as const satisfies readonly ActivePage[];

type NeteasePageMode = (typeof NETEASE_PAGES)[number];

const isNeteasePageMode = (page: ActivePage): page is NeteasePageMode =>
  (NETEASE_PAGES as readonly ActivePage[]).includes(page);

const topLevelScrollKey = (page: ActivePage): string => `page:${page}`;

function RouteLoadingFallback(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div class="panel panel-placeholder" aria-busy="true" aria-label={t("player.loading.label")}>
      <div class="panel-header">
        <Skeleton shape="text" width="180px" height="28px" />
      </div>
      <ListSkeleton count={6} />
    </div>
  );
}

interface OnlineSearchRouteCoordinatorProps {
  activePage: Accessor<ActivePage>;
  onlineSearchEnabled: Accessor<boolean>;
  onNavigate: (page: ActivePage) => void;
}

function OnlineSearchRouteCoordinator(props: OnlineSearchRouteCoordinatorProps): null {
  const search = useUISearch();

  createEffect(() => {
    const request = search.pendingOnlineSearchRequest();
    if (!request) {
      return;
    }
    if (!props.onlineSearchEnabled()) {
      search.consumeOnlineSearchRequest(request.version);
      return;
    }
    if (props.activePage() === "search") return;
    props.onNavigate("search");
  });

  return null;
}

function AppContent() {
  const controller = useAppController(api);
  const playback = controller.playback;
  const queue = controller.queue;
  const navigation = controller.navigation;
  const ui = controller.ui;
  const { td } = useTranslation();
  const accountStore = useNcmAccount();
  const [isNcmLoginOpen, setIsNcmLoginOpen] = createSignal<boolean>(false);
  const [loginDisableUid, setLoginDisableUid] = createSignal<boolean>(false);
  const [shouldMountFullPlayer, setShouldMountFullPlayer] = createSignal<boolean>(false);
  const [hasRequestedQueueDrawer, setHasRequestedQueueDrawer] = createSignal<boolean>(false);
  const [hasRequestedSettingsPage, setHasRequestedSettingsPage] = createSignal<boolean>(false);
  const [hasRequestedLoginModal, setHasRequestedLoginModal] = createSignal<boolean>(false);
  const [displayedContentPage, setDisplayedContentPage] =
    createSignal<ActivePage>(navigation.activePage());
  const [settingsInitialCategory, setSettingsInitialCategory] =
    createSignal<SettingsCategoryKey | undefined>(undefined);
  const hasPlayableTrack = createMemo<boolean>(() => {
    const player = playback.player();
    return player !== null && (player.file_path !== null || player.ncm_song_id !== null);
  });
  const fullPlayerWarmup = useFullPlayerWarmup({
    load: FullPlayer.loadModule,
    hasPlayableTrack,
    requestMount: () => setShouldMountFullPlayer(true),
    commitOpen: () => ui.setFullPlayerOpen(true)
  });
  const requireNcmLogin = (options: { disableUid?: boolean } = {}) => {
    setLoginDisableUid(options.disableUid === true);
    setIsNcmLoginOpen(true);
  };
  const isNcmLoggedIn = () => accountStore.activeAccount() !== null;
  const activeWritableNcmProfile = () => {
    const account = accountStore.activeAccount();
    return account?.hasCookie === true ? account : null;
  };
  const openSettings = (category?: SettingsCategoryKey) => {
    setSettingsInitialCategory(category);
    ui.setSettingsOpen(true);
  };
  const handleFullPlayerArtistSelect = (artist: { id: number; name: string }) => {
    ui.setFullPlayerOpen(false);
    navigation.handleNavigateToArtistDetail({
      id: artist.id,
      title: artist.name,
      subtitle: null,
      coverUrl: playback.currentCoverUrl(),
      playCount: null,
      description: null
    });
  };
  const handleFullPlayerAlbumSelect = (album: {
    id: number;
    title: string;
    subtitle: string | null;
    coverUrl: string | null;
  }) => {
    ui.setFullPlayerOpen(false);
    navigation.handleNavigateToAlbumDetail({
      id: album.id,
      title: album.title,
      subtitle: album.subtitle,
      coverUrl: album.coverUrl,
      playCount: null,
      description: null
    });
  };

  createEffect(
    on(
      () => ui.uiSettings.useOnlineService,
      (onlineServiceEnabled) => {
        if (!onlineServiceEnabled) navigation.handleEnterOfflineMode();
      }
    )
  );

  createEffect(() => {
    if (ui.fullPlayerOpen()) setShouldMountFullPlayer(true);
    if (queue.queueDrawerOpen()) setHasRequestedQueueDrawer(true);
    if (ui.settingsOpen()) setHasRequestedSettingsPage(true);
    if (isNcmLoginOpen()) setHasRequestedLoginModal(true);
  });

  return (
    <PlaybackProvider value={playback}>
      <NaiveFeedbackProvider>
        <UISearchProvider activePage={navigation.activePage}>
        <OnlineSearchRouteCoordinator
          activePage={navigation.activePage}
          onlineSearchEnabled={() => ui.uiSettings.useOnlineService}
          onNavigate={navigation.handleActivePageChange}
        />
        <AppShell
          sidebar={
            <Sidebar
              api={api}
              activePage={navigation.activePage()}
              libraryDestination={navigation.libraryDestination()}
              onChange={navigation.handleActivePageChange}
              onSelectLibraryDestination={navigation.handleNavigateToLibrary}
              selectedPlaylistId={navigation.selectedPlaylistId()}
              onSelectPlaylist={navigation.handleSidebarPlaylistSelect}
              onSelectLocalPlaylist={navigation.handleSidebarLocalPlaylistSelect}
              isNcmLoggedIn={isNcmLoggedIn()}
              onRequireNcmLogin={requireNcmLogin}
              onRefreshPersonalFm={ui.requestPersonalFmRefresh}
              onStartHeartbeat={() => void ui.requestHeartbeatMode()}
              shuffleMode={playback.shuffleMode()}
            />
          }
          topNav={
            <TopNav
              activePage={navigation.activePage()}
              canGoBack={navigation.canGoBack()}
              canGoForward={navigation.canGoForward()}
              onGoBack={navigation.handleGoBack}
              onGoForward={navigation.handleGoForward}
              onOpenSettings={() => openSettings()}
              onRequireNcmLogin={requireNcmLogin}
              onNavigateToLikedCollectionTab={navigation.handleNavigateToLikedCollectionTab}
              windowControls={<WindowControls visible={ui.uiSettings.customChrome} />}
            />
          }
          backgroundLayer={
            <AppearanceLayer
              coverUrl={playback.resolvedCoverUrl()}
              enabled={ui.uiSettings.bgEnabled}
              blur={ui.uiSettings.bgBlur}
              maskOpacity={ui.uiSettings.bgMask / 100}
              dynamicBackgroundMaxFps={ui.uiSettings.dynamicBackgroundMaxFps}
              fullPlayerOpen={ui.fullPlayerOpen()}
            />
          }
          playerBar={
            <PlayerBar
              request={playback.state()}
              loadingProgress={playback.loadingProgress()}
              wsStatus={playback.wsStatus()}
              commandError={playback.commandError()}
              coverUrl={playback.resolvedCoverUrl()}
              title={playback.title()}
              subtitle={playback.subtitle()}
              currentLyric={playback.inlineLyric()}
              canSkipPrev={playback.previousEntryId() !== null}
              canSkipNext={playback.nextEntryId() !== null}
              displayPosition={playback.displayPosition()}
              queueLength={queue.queueEntries().length}
              repeatMode={playback.repeatMode()}
              shuffleMode={playback.shuffleMode()}
              lyrics={playback.lyrics()}
              artistLinks={playback.supplement()?.artists ?? []}
              isLiked={playback.isLiked()}
              onPlay={playback.play}
              onPause={playback.pause}
              onSeek={playback.seek}
              onVolumePreview={playback.previewVolume}
              onVolumeChange={playback.changeVolume}
              onVolumeStep={playback.stepVolume}
              onSkipPrev={playback.skipPrevious}
              onSkipNext={playback.skipNext}
              onCycleRepeat={playback.cycleRepeat}
              onToggleShuffle={playback.toggleShuffle}
              onToggleLike={playback.toggleLike}
              onCoverWarmup={fullPlayerWarmup.prewarm}
              onCoverClick={fullPlayerWarmup.requestOpen}
              onOpenQueue={queue.handleToggleQueue}
              onOpenSettings={() => openSettings()}
              onNavigate={navigation.handleActivePageChange}
              onSelectArtist={(artist) => navigation.handleNavigateToArtistDetail({
                id: artist.id,
                title: artist.name,
                subtitle: null,
                coverUrl: playback.currentCoverUrl(),
                playCount: null,
                description: null
              })}
              onSelectQuality={playback.changeCurrentNcmQuality}
              desktopLyricActive={controller.desktopLyric.active()}
              onToggleDesktopLyric={controller.desktopLyric.toggle}
              queueOpen={queue.queueDrawerOpen()}
            />
          }
          contentPersistKey={topLevelScrollKey(displayedContentPage())}
        >
          <PageTransition
            activePage={navigation.activePage()}
            animation={ui.uiSettings.routeAnimation}
            onDisplayedPageChange={setDisplayedContentPage}
          >
            {(displayedPage) => {
              const displayedNeteaseMode = () => {
                const page = displayedPage();
                return isNeteasePageMode(page) ? page : null;
              };
              return (
                <PanelErrorBoundary title={td(`sidebar.nav.${displayedPage()}.label`)}>
                  <Suspense fallback={<RouteLoadingFallback />}>
                    <Switch>
                    <Match when={displayedPage() === "library"}>
                      <LibraryPage
                        onStateRefresh={controller.refreshPlayback}
                        currentTrackPath={playback.currentTrackPath()}
                        currentMediaId={playback.currentMediaId()}
                        isPlaying={playback.isPlaying()}
                        onPlaybackState={playback.applyPlayerState}
                        onPlay={playback.play}
                        onPause={playback.pause}
                        onPlaybackHistoryChanged={ui.notifyPlaybackHistoryChanged}
                        routeActive={navigation.activePage() === "library"}
                        destination={navigation.libraryDestination()}
                        routeAnimation={ui.uiSettings.routeAnimation}
                        showViewMenu={ui.uiSettings.useOnlineService}
                        onDestinationChange={navigation.handleNavigateToLibrary}
                        onReplaceDestination={navigation.handleReplaceLibraryDestination}
                      />
                    </Match>
                    <Match when={displayedNeteaseMode()}>
                      {(mode) => (
                        <NeteasePage
                          mode={mode()}
                          selectedPlaylistId={navigation.selectedPlaylistId()}
                          onSelectedPlaylistChange={navigation.handleSelectedPlaylistChange}
                          onNavigate={navigation.handleActivePageChange}
                          onNavigateToRecommend={() => navigation.handleActivePageChange("recommend")}
                          onNavigateToDiscover={navigation.handleNavigateToDiscover}
                          onNavigateToDailySongs={navigation.handleNavigateToDailySongs}
                          onDiscoverTabChange={navigation.handleDiscoverTabChange}
                          onNavigateToArtistDetail={navigation.handleNavigateToArtistDetail}
                          onNavigateToRadioDetail={navigation.handleNavigateToRadioDetail}
                          onNavigateToSongWiki={navigation.handleNavigateToSongWiki}
                          onNavigateToMv={navigation.handleNavigateToMv}
                          onNavigateToAlbumDetail={navigation.handleNavigateToAlbumDetail}
                          onNavigateToPlaylistDetail={navigation.handleNavigateToPlaylistDetail}
                          onNavigateToVideoDetail={navigation.handleNavigateToVideoDetail}
                          discoverTabRequest={navigation.discoverTabRequest()}
                          dailySongsRequest={navigation.dailySongsRequest()}
                          likedCollectionTabRequest={navigation.likedCollectionTabRequest()}
                          onLikedCollectionTabChange={navigation.handleLikedCollectionTabChange}
                          artistDetailRequest={navigation.artistDetailRequest()}
                          albumDetailRequest={navigation.albumDetailRequest()}
                          playlistDetailRequest={navigation.playlistDetailRequest()}
                          videoDetailRequest={navigation.videoDetailRequest()}
                          radioSubscribeEvent={navigation.radioSubscribeEvent()}
                          onRequireNcmLogin={requireNcmLogin}
                        />
                      )}
                    </Match>
                    <Match when={displayedPage() === "recent"}>
                      <HistoryPage
                        refreshVersion={ui.playbackHistoryVersion()}
                        onStateRefresh={controller.refreshPlayback}
                        currentTrackPath={playback.currentTrackPath()}
                        currentMediaId={playback.currentMediaId()}
                        currentSongId={playback.currentSongId()}
                        isPlaying={playback.isPlaying()}
                        onRegisterPlayback={playback.registerNcmPlayback}
                        onNavigateToSongWiki={navigation.handleNavigateToSongWiki}
                      />
                    </Match>
                    <Match when={displayedPage() === "download"}>
                      <DownloadPage />
                    </Match>
                    <Match when={displayedPage() === "streaming"}>
                      <StreamingPage />
                    </Match>
                    <Match when={displayedPage() === "cloud"}>
                      <CloudPage
                        onRequireNcmLogin={requireNcmLogin}
                        onNavigateToSongWiki={navigation.handleNavigateToSongWiki}
                      />
                    </Match>
                    <Match when={displayedPage() === "personal-fm"}>
                      <PersonalFmPage
                        onRequireNcmLogin={() => requireNcmLogin({ disableUid: true })}
                        onNavigateToSongWiki={navigation.handleNavigateToSongWiki}
                        reloadTick={ui.personalFmReloadTick()}
                      />
                    </Match>
                    <Match when={displayedPage() === "radio"}>
                      <NeteaseRadioPage
                        loginProfile={activeWritableNcmProfile()}
                        onRequireNcmLogin={() => requireNcmLogin({ disableUid: true })}
                        onSubscribeChange={navigation.handleRadioSubscribeChange}
                        onNavigateToRadioDetail={navigation.handleNavigateToRadioDetail}
                        onNavigateToSongWiki={navigation.handleNavigateToSongWiki}
                      />
                    </Match>
                    <Match when={displayedPage() === "radio-detail"}>
                      <NeteaseRadioPage
                        isDetailRoute
                        radioDetailRequest={navigation.radioDetailRequest()}
                        loginProfile={activeWritableNcmProfile()}
                        onRequireNcmLogin={() => requireNcmLogin({ disableUid: true })}
                        onSubscribeChange={navigation.handleRadioSubscribeChange}
                        onNavigateToSongWiki={navigation.handleNavigateToSongWiki}
                      />
                    </Match>
                    <Match when={displayedPage() === "song-wiki"}>
                      <SongWikiPage
                        request={navigation.songWikiRequest()}
                        onBack={navigation.handleGoBack}
                        onNavigateToArtistDetail={navigation.handleNavigateToArtistDetail}
                        onNavigateToAlbumDetail={navigation.handleNavigateToAlbumDetail}
                      />
                    </Match>
                    <Match when={ui.isPlaceholderPage(displayedPage())}>
                      <div class="panel panel-placeholder">
                        <div class="panel-header">
                          <h2>{td(`sidebar.nav.${displayedPage()}.label`)}</h2>
                        </div>
                        <p class="panel-note">{td(`page.placeholder.${displayedPage()}`)}</p>
                      </div>
                    </Match>
                    </Switch>
                  </Suspense>
                </PanelErrorBoundary>
              );
            }}
          </PageTransition>
        </AppShell>

        <PanelErrorBoundary title={td("player.fallback.empty")}>
          <Suspense fallback={null}>
          <Show when={shouldMountFullPlayer()}>
            <FullPlayer
              isOpen={ui.fullPlayerOpen()}
              onReady={fullPlayerWarmup.notifyShellMounted}
              onClose={() => ui.setFullPlayerOpen(false)}
              onSelectArtist={handleFullPlayerArtistSelect}
              onSelectAlbum={handleFullPlayerAlbumSelect}
              onOpenLyricSettings={() => openSettings("lyrics")}
            />
          </Show>
          </Suspense>
        </PanelErrorBoundary>

        <PanelErrorBoundary title={td("sidebar.nav.queue.label")}>
          <Suspense fallback={null}>
          <Show when={hasRequestedQueueDrawer()}>
            <QueueDrawer
              open={queue.queueDrawerOpen()}
              entries={queue.queueEntries()}
              currentTrackPath={playback.currentTrackPath()}
              currentMediaId={playback.currentMediaId()}
              onClose={() => queue.setQueueDrawerOpen(false)}
              onPlayEntry={queue.handlePlayQueueEntry}
              onRemoveEntry={queue.handleRemoveQueueEntry}
              onClear={queue.handleClearQueue}
            />
          </Show>
          </Suspense>
        </PanelErrorBoundary>

        <PanelErrorBoundary title={td("sidebar.nav.settings.label")}>
          <Suspense fallback={null}>
          <Show when={hasRequestedSettingsPage()}>
            <SettingsPage
              isOpen={ui.settingsOpen()}
              onClose={() => ui.setSettingsOpen(false)}
              initialCategory={settingsInitialCategory()}
            />
          </Show>
          </Suspense>
        </PanelErrorBoundary>

        <PanelErrorBoundary title={td("ncm.login.title")}>
          <Suspense fallback={null}>
          <Show when={hasRequestedLoginModal()}>
            <LoginModal
              open={isNcmLoginOpen()}
              disableUid={loginDisableUid()}
              onClose={() => setIsNcmLoginOpen(false)}
            />
          </Show>
          </Suspense>
        </PanelErrorBoundary>
        </UISearchProvider>
      </NaiveFeedbackProvider>
    </PlaybackProvider>
  );
}

export function App() {
  return <AppContent />;
}

export default App;

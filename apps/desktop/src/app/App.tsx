import {
  Match,
  Show,
  Suspense,
  Switch,
  createEffect,
  createSignal,
  lazy,
  type Component,
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
import { isOnlineOnlyPage, LOCAL_FALLBACK_PAGE } from "../shared/ui/navigation";
import { UISearchProvider } from "../shared/state/UISearchContext";
import { NaiveFeedbackProvider } from "../shared/ui/naive";
import "../shared/styles/components/pages.css";
import { useAppController } from "./useAppController";
import { Sidebar } from "./Sidebar";

const api = createApiClient();

const lazyComponent = <Props extends object>(
  loader: () => Promise<Component<Props>>
): Component<Props> => lazy(async () => ({ default: await loader() }));

const LibraryPage = lazyComponent(() =>
  import("../features/library/LibraryPage").then((module) => module.LibraryPage)
);
const NeteasePage = lazyComponent(() =>
  import("../features/online/NeteasePage").then((module) => module.NeteasePage)
);
const HistoryPage = lazyComponent(() =>
  import("../features/history/HistoryPage").then((module) => module.HistoryPage)
);
const DownloadPage = lazyComponent(() =>
  import("../features/download/DownloadPage").then((module) => module.DownloadPage)
);
const StreamingPage = lazyComponent(() =>
  import("../features/streaming/StreamingPage").then((module) => module.StreamingPage)
);
const CloudPage = lazyComponent(() =>
  import("../features/online/CloudPage").then((module) => module.CloudPage)
);
const PersonalFmPage = lazyComponent(() =>
  import("../features/online/PersonalFmPage").then((module) => module.PersonalFmPage)
);
const NeteaseRadioPage = lazyComponent(() =>
  import("../features/online/NeteaseRadioPage").then((module) => module.NeteaseRadioPage)
);
const SongWikiPage = lazyComponent(() =>
  import("../features/online/SongWikiPage").then((module) => module.SongWikiPage)
);
const QueueDrawer = lazyComponent(() =>
  import("../features/queue/QueueDrawer").then((module) => module.QueueDrawer)
);
const SettingsPage = lazyComponent(() =>
  import("../features/settings/SettingsPage").then((module) => module.SettingsPage)
);
const FullPlayer = lazyComponent(() =>
  import("../components/FullPlayer").then((module) => module.FullPlayer)
);
const LoginModal = lazyComponent(() =>
  import("../components/LoginModal").then((module) => module.LoginModal)
);

const NETEASE_PAGES = [
  "recommend",
  "discover",
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

function AppContent() {
  const controller = useAppController(api);
  const { td } = useTranslation();
  const accountStore = useNcmAccount();
  const [isNcmLoginOpen, setIsNcmLoginOpen] = createSignal<boolean>(false);
  const [loginDisableUid, setLoginDisableUid] = createSignal<boolean>(false);
  const [hasRequestedFullPlayer, setHasRequestedFullPlayer] = createSignal<boolean>(false);
  const [hasRequestedQueueDrawer, setHasRequestedQueueDrawer] = createSignal<boolean>(false);
  const [hasRequestedSettingsPage, setHasRequestedSettingsPage] = createSignal<boolean>(false);
  const [hasRequestedLoginModal, setHasRequestedLoginModal] = createSignal<boolean>(false);
  const [displayedContentPage, setDisplayedContentPage] =
    createSignal<ActivePage>(controller.activePage());
  const [settingsInitialCategory, setSettingsInitialCategory] =
    createSignal<SettingsCategoryKey | undefined>(undefined);
  const refreshPlayback = async (expectedPath?: string | null) => {
    await Promise.all([
      controller.refreshState(expectedPath),
      controller.refreshQueue()
    ]);
  };
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
    controller.setSettingsOpen(true);
  };
  const fullPlayerAlbumLink = () => {
    const supplement = controller.currentNcmSupplement();
    const albumId = supplement?.albumId ?? null;
    const title = controller.fullPlayerAlbum();
    if (albumId === null || !title) {
      return null;
    }
    return {
      id: albumId,
      title,
      subtitle: controller.fullPlayerArtist(),
      coverUrl: controller.currentNcmCoverUrl()
    };
  };
  const handleFullPlayerArtistSelect = (artist: { id: number; name: string }) => {
    controller.setFullPlayerOpen(false);
    controller.handleNavigateToArtistDetail({
      id: artist.id,
      title: artist.name,
      subtitle: null,
      coverUrl: controller.currentNcmCoverUrl(),
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
    controller.setFullPlayerOpen(false);
    controller.handleNavigateToAlbumDetail({
      id: album.id,
      title: album.title,
      subtitle: album.subtitle,
      coverUrl: album.coverUrl,
      playCount: null,
      description: null
    });
  };

  createEffect(() => {
    if (!controller.uiSettings.useOnlineService && isOnlineOnlyPage(controller.activePage())) {
      controller.handleActivePageChange(LOCAL_FALLBACK_PAGE);
    }
  });

  createEffect(() => {
    if (controller.fullPlayerOpen()) setHasRequestedFullPlayer(true);
    if (controller.queueDrawerOpen()) setHasRequestedQueueDrawer(true);
    if (controller.settingsOpen()) setHasRequestedSettingsPage(true);
    if (isNcmLoginOpen()) setHasRequestedLoginModal(true);
  });

  return (
    <NaiveFeedbackProvider>
      <UISearchProvider activePage={controller.activePage}>
        <AppShell
          sidebar={
            <Sidebar
              api={api}
              activePage={controller.activePage()}
              onChange={controller.handleActivePageChange}
              selectedPlaylistId={controller.selectedPlaylistId()}
              onSelectPlaylist={controller.handleSidebarPlaylistSelect}
              onSelectLocalPlaylist={controller.handleSidebarLocalPlaylistSelect}
              isNcmLoggedIn={isNcmLoggedIn()}
              onRequireNcmLogin={requireNcmLogin}
              onRefreshPersonalFm={controller.requestPersonalFmRefresh}
              onStartHeartbeat={() => void controller.requestHeartbeatMode()}
              shuffleMode={controller.shuffleMode()}
            />
          }
          topNav={
            <TopNav
              activePage={controller.activePage()}
              canGoBack={controller.canGoBack()}
              canGoForward={controller.canGoForward()}
              onGoBack={controller.handleGoBack}
              onGoForward={controller.handleGoForward}
              onOpenSettings={() => openSettings()}
              onRequireNcmLogin={requireNcmLogin}
              onNavigateToLikedCollectionTab={controller.handleNavigateToLikedCollectionTab}
              windowControls={<WindowControls visible={controller.uiSettings.customChrome} />}
            />
          }
          backgroundLayer={
            <AppearanceLayer
              coverUrl={controller.resolvedCoverUrl()}
              enabled={controller.uiSettings.bgEnabled}
              blur={controller.uiSettings.bgBlur}
              maskOpacity={controller.uiSettings.bgMask / 100}
              fullPlayerOpen={controller.fullPlayerOpen()}
            />
          }
          playerBar={
            <PlayerBar
              request={controller.state()}
              loadingProgress={controller.loadingProgress()}
              wsStatus={controller.wsStatus()}
              commandError={controller.commandError()}
              coverUrl={controller.resolvedCoverUrl()}
              title={controller.fullPlayerTitle()}
              subtitle={controller.fullPlayerSubtitle()}
              currentLyric={controller.currentInlineLyric()}
              canSkipPrev={controller.prevEntryId() !== null}
              canSkipNext={controller.nextEntryId() !== null}
              livePosition={controller.livePosition()}
              queueLength={controller.queueEntries().length}
              repeatMode={controller.repeatMode()}
              shuffleMode={controller.shuffleMode()}
              lyrics={controller.currentLyricLines()}
              artistLinks={controller.currentNcmSupplement()?.artists ?? []}
              isLiked={controller.currentIsLiked()}
              onPlay={controller.handlePlay}
              onPause={controller.handlePause}
              onSeek={controller.handleSeek}
              onVolumePreview={controller.handleVolumePreview}
              onVolumeChange={controller.handleVolumeChange}
              onSkipPrev={controller.handleSkipPrev}
              onSkipNext={controller.handleSkipNext}
              onCycleRepeat={controller.handleCycleRepeat}
              onToggleShuffle={controller.handleToggleShuffle}
              onToggleLike={controller.handleToggleLike}
              onCoverClick={() => controller.setFullPlayerOpen(true)}
              onOpenQueue={controller.handleToggleQueue}
              onOpenSettings={() => openSettings()}
              onNavigate={controller.handleActivePageChange}
              onSelectArtist={(artist) => controller.handleNavigateToArtistDetail({
                id: artist.id,
                title: artist.name,
                subtitle: null,
                coverUrl: controller.currentNcmCoverUrl(),
                playCount: null,
                description: null
              })}
              onSelectQuality={controller.handleChangeCurrentNcmQuality}
              queueOpen={controller.queueDrawerOpen()}
            />
          }
          contentPersistKey={topLevelScrollKey(displayedContentPage())}
        >
          <PageTransition
            activePage={controller.activePage()}
            animation={controller.uiSettings.routeAnimation}
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
                        onStateRefresh={refreshPlayback}
                        currentTrackPath={controller.currentTrackPath()}
                        currentMediaId={controller.currentMediaId()}
                        isPlaying={Boolean(controller.player()?.is_playing)}
                        onPlaybackState={controller.applyPlayerState}
                        onPlay={controller.handlePlay}
                        onPause={controller.handlePause}
                        onPlaybackHistoryChanged={controller.notifyPlaybackHistoryChanged}
                        localPlaylistRequest={controller.localPlaylistRequest()}
                      />
                    </Match>
                    <Match when={displayedNeteaseMode()}>
                      {(mode) => (
                        <NeteasePage
                          mode={mode()}
                          onStateRefresh={refreshPlayback}
                          currentTrackPath={controller.currentTrackPath()}
                          currentSongId={controller.currentNcmSongId()}
                          isPlaying={Boolean(controller.player()?.is_playing)}
                          onPlay={controller.handlePlay}
                          onPause={controller.handlePause}
                          onSkipNext={controller.handleSkipNext}
                          onRegisterPlayback={controller.registerNcmPlayback}
                          selectedPlaylistId={controller.selectedPlaylistId()}
                          onSelectedPlaylistChange={controller.handleSelectedPlaylistChange}
                          onNavigate={controller.handleActivePageChange}
                          onNavigateToRecommend={() => controller.handleActivePageChange("recommend")}
                          onNavigateToDiscover={controller.handleNavigateToDiscover}
                          onDiscoverTabChange={controller.handleDiscoverTabChange}
                          onNavigateToRadioDetail={controller.handleNavigateToRadioDetail}
                          onNavigateToSongWiki={controller.handleNavigateToSongWiki}
                          discoverTabRequest={controller.discoverTabRequest()}
                          likedCollectionTabRequest={controller.likedCollectionTabRequest()}
                          onLikedCollectionTabChange={controller.handleLikedCollectionTabChange}
                          artistDetailRequest={controller.artistDetailRequest()}
                          albumDetailRequest={controller.albumDetailRequest()}
                          radioSubscribeEvent={controller.radioSubscribeEvent()}
                          onRequireNcmLogin={requireNcmLogin}
                        />
                      )}
                    </Match>
                    <Match when={displayedPage() === "recent"}>
                      <HistoryPage
                        refreshVersion={controller.playbackHistoryVersion()}
                        onStateRefresh={refreshPlayback}
                        currentTrackPath={controller.currentTrackPath()}
                        currentMediaId={controller.currentMediaId()}
                        currentSongId={controller.currentNcmSongId()}
                        isPlaying={Boolean(controller.player()?.is_playing)}
                        onRegisterPlayback={controller.registerNcmPlayback}
                        onNavigateToSongWiki={controller.handleNavigateToSongWiki}
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
                        onStateRefresh={refreshPlayback}
                        currentTrackPath={controller.currentTrackPath()}
                        currentSongId={controller.currentNcmSongId()}
                        isPlaying={Boolean(controller.player()?.is_playing)}
                        onRegisterPlayback={controller.registerNcmPlayback}
                        onRequireNcmLogin={requireNcmLogin}
                        onNavigateToSongWiki={controller.handleNavigateToSongWiki}
                      />
                    </Match>
                    <Match when={displayedPage() === "personal-fm"}>
                      <PersonalFmPage
                        onStateRefresh={refreshPlayback}
                        currentTrackPath={controller.currentTrackPath()}
                        currentSongId={controller.currentNcmSongId()}
                        isPlaying={Boolean(controller.player()?.is_playing)}
                        onPlay={controller.handlePlay}
                        onPause={controller.handlePause}
                        onSkipNext={controller.handleSkipNext}
                        onRegisterPlayback={controller.registerNcmPlayback}
                        onRequireNcmLogin={() => requireNcmLogin({ disableUid: true })}
                        onNavigateToSongWiki={controller.handleNavigateToSongWiki}
                        reloadTick={controller.personalFmReloadTick()}
                      />
                    </Match>
                    <Match when={displayedPage() === "radio"}>
                      <NeteaseRadioPage
                        radioDetailRequest={controller.radioDetailRequest()}
                        loginProfile={activeWritableNcmProfile()}
                        onRequireNcmLogin={() => requireNcmLogin({ disableUid: true })}
                        onSubscribeChange={controller.handleRadioSubscribeChange}
                        onStateRefresh={refreshPlayback}
                        currentTrackPath={controller.currentTrackPath()}
                        currentSongId={controller.currentNcmSongId()}
                        isPlaying={Boolean(controller.player()?.is_playing)}
                        onRegisterPlayback={controller.registerNcmPlayback}
                        onNavigateToSongWiki={controller.handleNavigateToSongWiki}
                      />
                    </Match>
                    <Match when={displayedPage() === "song-wiki"}>
                      <SongWikiPage
                        request={controller.songWikiRequest()}
                        onBack={controller.handleGoBack}
                        onStateRefresh={refreshPlayback}
                        onRegisterPlayback={controller.registerNcmPlayback}
                        onNavigateToArtistDetail={controller.handleNavigateToArtistDetail}
                        onNavigateToAlbumDetail={controller.handleNavigateToAlbumDetail}
                        currentTrackPath={controller.currentTrackPath()}
                        currentSongId={controller.currentNcmSongId()}
                        isPlaying={Boolean(controller.player()?.is_playing)}
                      />
                    </Match>
                    <Match when={controller.isPlaceholderPage(displayedPage())}>
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
          <Show when={hasRequestedFullPlayer()}>
            <FullPlayer
              isOpen={controller.fullPlayerOpen()}
              onClose={() => controller.setFullPlayerOpen(false)}
              coverUrl={controller.resolvedCoverUrl()}
              title={controller.fullPlayerTitle()}
              subtitle={controller.fullPlayerSubtitle()}
              artist={controller.fullPlayerArtist()}
              album={controller.fullPlayerAlbum()}
              artistLinks={controller.currentNcmSupplement()?.artists ?? []}
              albumLink={fullPlayerAlbumLink()}
              detail={controller.fullPlayerDetail()}
              currentSongId={controller.currentNcmSongId()}
              currentMediaId={controller.currentMediaId()}
              duration={controller.player()?.duration ?? 0}
              currentTime={controller.livePosition() ?? controller.player()?.current_time ?? 0}
              isPlaying={Boolean(controller.player()?.is_playing)}
              volume={controller.player()?.volume ?? 0}
              spectrum={controller.spectrum()}
              lyrics={controller.currentLyricLines()}
              lyricStatus={controller.lyricStatus()}
              lyricError={controller.currentNcmSupplement()?.error ?? null}
              repeatMode={controller.repeatMode()}
              shuffleMode={controller.shuffleMode()}
              canSkipPrev={controller.prevEntryId() !== null}
              canSkipNext={controller.nextEntryId() !== null}
              bgBlur={controller.uiSettings.bgBlur}
              onPlay={controller.handlePlay}
              onPause={controller.handlePause}
              onSeek={controller.handleSeek}
              onVolumePreview={controller.handleVolumePreview}
              onVolumeChange={controller.handleVolumeChange}
              onSkipPrev={controller.handleSkipPrev}
              onSkipNext={controller.handleSkipNext}
              onCycleRepeat={controller.handleCycleRepeat}
              onToggleShuffle={controller.handleToggleShuffle}
              onOpenQueue={controller.handleOpenQueueFromFullPlayer}
              onSelectArtist={handleFullPlayerArtistSelect}
              onSelectAlbum={handleFullPlayerAlbumSelect}
              isLiked={controller.currentIsLiked()}
              onToggleLike={controller.handleToggleLike}
              onOpenLyricSettings={() => openSettings("lyrics")}
            />
          </Show>
          </Suspense>
        </PanelErrorBoundary>

        <PanelErrorBoundary title={td("sidebar.nav.queue.label")}>
          <Suspense fallback={null}>
          <Show when={hasRequestedQueueDrawer()}>
            <QueueDrawer
              open={controller.queueDrawerOpen()}
              entries={controller.queueEntries()}
              currentTrackPath={controller.currentTrackPath()}
              currentMediaId={controller.currentMediaId()}
              onClose={() => controller.setQueueDrawerOpen(false)}
              onPlayEntry={controller.handlePlayQueueEntry}
              onRemoveEntry={controller.handleRemoveQueueEntry}
              onClear={controller.handleClearQueue}
            />
          </Show>
          </Suspense>
        </PanelErrorBoundary>

        <PanelErrorBoundary title={td("sidebar.nav.settings.label")}>
          <Suspense fallback={null}>
          <Show when={hasRequestedSettingsPage()}>
            <SettingsPage
              isOpen={controller.settingsOpen()}
              onClose={() => controller.setSettingsOpen(false)}
              onStateRefresh={controller.refreshState}
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
  );
}

export function App() {
  return <AppContent />;
}

export default App;

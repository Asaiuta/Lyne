import { Match, Switch, createEffect, createSignal } from "solid-js";
import { AppShell } from "../components/AppShell";
import { BackgroundLayer } from "../components/BackgroundLayer";
import { FullPlayer } from "../components/FullPlayer";
import { LoginModal } from "../components/LoginModal";
import { PageTransition } from "../components/PageTransition";
import { PlayerBar } from "../components/PlayerBar";
import { Sidebar } from "../components/Sidebar";
import { TopNav } from "../components/TopNav";
import { WindowControls } from "../components/WindowControls";
import { DownloadPage } from "../features/download/DownloadPage";
import { HistoryPage } from "../features/history/HistoryPage";
import { LibraryPage } from "../features/library/LibraryPage";
import { CloudPage } from "../features/online/CloudPage";
import { NeteasePage } from "../features/online/NeteasePage";
import { NeteaseRadioPage } from "../features/online/NeteaseRadioPage";
import { PersonalFmPage } from "../features/online/PersonalFmPage";
import { SongWikiPage } from "../features/online/SongWikiPage";
import { QueueDrawer } from "../features/queue/QueueDrawer";
import { SettingsPage } from "../features/settings/SettingsPage";
import { StreamingPage } from "../features/streaming/StreamingPage";
import type { SettingsCategoryKey } from "../features/settings/components/SettingsCategoryNav";
import { createApiClient } from "../shared/api/client";
import { useTranslation } from "../shared/i18n";
import { useNcmAccount } from "../shared/state/NcmAccountContext";
import type { ActivePage } from "../shared/ui/navigation";
import { isOnlineOnlyPage, LOCAL_FALLBACK_PAGE } from "../shared/ui/navigation";
import { UISearchProvider } from "../shared/state/UISearchContext";
import { useAppController } from "./useAppController";

const api = createApiClient();
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

function AppContent() {
  const controller = useAppController(api);
  const { td } = useTranslation();
  const accountStore = useNcmAccount();
  const [isNcmLoginOpen, setIsNcmLoginOpen] = createSignal<boolean>(false);
  const [loginDisableUid, setLoginDisableUid] = createSignal<boolean>(false);
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

  createEffect(() => {
    if (!controller.uiSettings.useOnlineService && isOnlineOnlyPage(controller.activePage())) {
      controller.handleActivePageChange(LOCAL_FALLBACK_PAGE);
    }
  });

  return (
    <>
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
            <BackgroundLayer
              coverUrl={controller.resolvedCoverUrl()}
              enabled={controller.uiSettings.bgEnabled}
              blur={controller.uiSettings.bgBlur}
              maskOpacity={controller.uiSettings.bgMask / 100}
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
        >
          <PageTransition
            activePage={controller.activePage()}
            animation={controller.uiSettings.routeAnimation}
          >
            {(displayedPage) => {
              const displayedNeteaseMode = () => {
                const page = displayedPage();
                return isNeteasePageMode(page) ? page : null;
              };
              return (
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
                        onNavigateToDiscover={controller.handleNavigateToDiscover}
                        onNavigateToRadioDetail={controller.handleNavigateToRadioDetail}
                        onNavigateToSongWiki={controller.handleNavigateToSongWiki}
                        discoverTabRequest={controller.discoverTabRequest()}
                        likedCollectionTabRequest={controller.likedCollectionTabRequest()}
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
              );
            }}
          </PageTransition>
        </AppShell>

        <FullPlayer
          isOpen={controller.fullPlayerOpen()}
          onClose={() => controller.setFullPlayerOpen(false)}
          coverUrl={controller.resolvedCoverUrl()}
          title={controller.fullPlayerTitle()}
          subtitle={controller.fullPlayerSubtitle()}
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
          onVolumeChange={controller.handleVolumeChange}
          onSkipPrev={controller.handleSkipPrev}
          onSkipNext={controller.handleSkipNext}
          onCycleRepeat={controller.handleCycleRepeat}
          onToggleShuffle={controller.handleToggleShuffle}
          onOpenQueue={controller.handleOpenQueueFromFullPlayer}
          isLiked={controller.currentIsLiked()}
          onToggleLike={controller.handleToggleLike}
          onOpenLyricSettings={() => openSettings("lyrics")}
        />
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
        <SettingsPage
          isOpen={controller.settingsOpen()}
          onClose={() => controller.setSettingsOpen(false)}
          onStateRefresh={controller.refreshState}
          initialCategory={settingsInitialCategory()}
        />
        <LoginModal
          open={isNcmLoginOpen()}
          disableUid={loginDisableUid()}
          onClose={() => setIsNcmLoginOpen(false)}
        />
      </UISearchProvider>
    </>
  );
}

export function App() {
  return <AppContent />;
}

export default App;

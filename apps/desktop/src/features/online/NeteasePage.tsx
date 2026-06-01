import { Match, Show, Switch, createEffect, createMemo, createSignal, on, onMount } from "solid-js";
import { createApiClient } from "../../shared/api/client";
import { useTranslation } from "../../shared/i18n";
import { useNcmAccount } from "../../shared/state/NcmAccountContext";
import { useUISearch } from "../../shared/state/UISearchContext";
import type { NcmTrackReference } from "./ncmPlayback";
import type { FeedCardItem, OnlineTrackItem, RadioSubscribeEvent } from "./shared/types";
import {
  createErrorMessageReader,
  createLoginStatusText,
  createFeedbackSetter,
  createInitialFeedback
} from "./shared/feedback";
import type { Feedback, NcmProfile, NeteasePageMode } from "./shared/types";
import { createPlaybackController } from "./shared/playback";
import { DiscoverMode } from "./modes/DiscoverMode";
import { LikedCollectionMode } from "./modes/LikedCollectionMode";
import { LikedSongsMode } from "./modes/LikedSongsMode";
import { RecommendMode } from "./modes/RecommendMode";
import { UserPlaylistsMode } from "./modes/UserPlaylistsMode";

const api = createApiClient();

interface NeteasePageProps {
  mode: NeteasePageMode;
  onStateRefresh: (expectedPath?: string | null) => Promise<void>;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
  onPlay: () => Promise<void>;
  onPause: () => Promise<void>;
  onSkipNext: () => Promise<void> | undefined;
  onRegisterPlayback: (track: NcmTrackReference) => void;
  selectedPlaylistId?: number | null;
  onSelectedPlaylistChange?: (playlistId: number | null) => void;
  onNavigate?: (page: "recommend" | "discover" | "radio") => void;
  onNavigateToRecommend?: () => void;
  onNavigateToDiscover?: (tab: string) => void;
  onDiscoverTabChange?: (tab: string) => void;
  onNavigateToRadioDetail?: (radio: FeedCardItem) => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  discoverTabRequest?: { tab: string; version: number };
  likedCollectionTabRequest?: { tab: "playlists" | "albums" | "artists"; version: number };
  onLikedCollectionTabChange?: (tab: "playlists" | "albums" | "artists") => void;
  artistDetailRequest?: { artist: FeedCardItem | null; version: number };
  albumDetailRequest?: { album: FeedCardItem | null; version: number };
  radioSubscribeEvent?: RadioSubscribeEvent | null;
  onRequireNcmLogin: () => void;
}

export function NeteasePage(props: NeteasePageProps) {
  const { t } = useTranslation();
  const accountStore = useNcmAccount();
  const { query: globalQuery, submitNonce } = useUISearch();

  const [isCheckingLogin, setIsCheckingLogin] = createSignal(false);
  const [isLoginBusy, setIsLoginBusy] = createSignal(false);
  const [hasDetailView, setHasDetailView] = createSignal(false);
  const [feedback, setFeedback] = createSignal<Feedback>(createInitialFeedback(t));
  const [pendingDiscoverSearch, setPendingDiscoverSearch] = createSignal(false);

  const loginProfile = createMemo<NcmProfile | null>(() => {
    const acct = accountStore.activeAccount();
    if (!acct) return null;
    return { userId: acct.userId, nickname: acct.nickname };
  });

  const setRawFeedback = createFeedbackSetter(setFeedback);
  const readErrorMessage = createErrorMessageReader(t);

  const playback = createPlaybackController({
    api,
    t,
    onRegisterPlayback: props.onRegisterPlayback,
    onStateRefresh: props.onStateRefresh,
    setFeedback: setRawFeedback
  });

  const refreshLoginStatus = async () => {
    setIsCheckingLogin(true);
    try {
      const profile = loginProfile();
      if (profile) {
        setRawFeedback(
          "success",
          t("ncm.feedback.loggedIn", { name: profile.nickname ?? profile.userId })
        );
      }
    } finally {
      setIsCheckingLogin(false);
    }
  };

  onMount(() => {
    void refreshLoginStatus();
  });

  const handleLogout = async () => {
    setIsLoginBusy(true);
    try {
      await accountStore.logoutActive();
      props.onSelectedPlaylistChange?.(null);
      setRawFeedback("success", t("ncm.feedback.loggedOut"));
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsLoginBusy(false);
    }
  };

  const loginStatusText = createLoginStatusText(t, isCheckingLogin, loginProfile);

  const isDiscoverMode = () => props.mode === "discover";
  const shouldShowFeedbackCard = createMemo<boolean>(() =>
    !hasDetailView() &&
    Boolean(feedback().message) &&
    feedback().message !== t("ncm.feedback.initial")
  );

  createEffect(on(
    () => props.mode,
    () => setHasDetailView(false)
  ));

  return (
    <div class={`panel panel-page online-page${props.mode === "recommend" ? " is-recommend-page" : ""}${isDiscoverMode() ? " is-discover-page" : ""}`}>
      <Switch>
        <Match when={props.mode === "recommend"}>
          <RecommendMode
            loginProfile={loginProfile}
            globalQuery={globalQuery}
            submitNonce={submitNonce}
            onSelectedPlaylistChange={props.onSelectedPlaylistChange}
            onNavigate={props.onNavigate}
            onNavigateToDiscover={props.onNavigateToDiscover}
            onNavigateToRadioDetail={props.onNavigateToRadioDetail}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
            onMarkPendingDiscoverSearch={() => setPendingDiscoverSearch(true)}
            setFeedback={setRawFeedback}
            playback={playback}
            currentTrackPath={props.currentTrackPath}
            currentSongId={props.currentSongId}
            isPlaying={props.isPlaying}
            onPlay={props.onPlay}
            onPause={props.onPause}
            onSkipNext={props.onSkipNext}
            onDetailViewChange={setHasDetailView}
          />
        </Match>
        <Match when={props.mode === "discover"}>
          <DiscoverMode
            loginProfile={loginProfile}
            globalQuery={globalQuery}
            submitNonce={submitNonce}
            pendingDiscoverSearch={pendingDiscoverSearch}
            clearPendingDiscoverSearch={() => setPendingDiscoverSearch(false)}
            discoverTabRequest={props.discoverTabRequest}
            onDiscoverTabChange={props.onDiscoverTabChange}
            artistDetailRequest={props.artistDetailRequest}
            albumDetailRequest={props.albumDetailRequest}
            onNavigateToRadioDetail={props.onNavigateToRadioDetail}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
            onSelectedPlaylistChange={props.onSelectedPlaylistChange}
            setFeedback={setRawFeedback}
            playback={playback}
            currentTrackPath={props.currentTrackPath}
            currentSongId={props.currentSongId}
            isPlaying={props.isPlaying}
            onPause={props.onPause}
            onDetailViewChange={setHasDetailView}
          />
        </Match>
        <Match when={props.mode === "liked-songs"}>
          <LikedSongsMode
            loginProfile={loginProfile}
            isCheckingLogin={isCheckingLogin}
            isLoginBusy={isLoginBusy}
            onBeginLogin={props.onRequireNcmLogin}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
            setFeedback={setRawFeedback}
            playback={playback}
            currentTrackPath={props.currentTrackPath}
            currentSongId={props.currentSongId}
            isPlaying={props.isPlaying}
            onDetailViewChange={setHasDetailView}
          />
        </Match>
        <Match when={props.mode === "liked"}>
          <LikedCollectionMode
            loginProfile={loginProfile}
            isCheckingLogin={isCheckingLogin}
            isLoginBusy={isLoginBusy}
            onBeginLogin={props.onRequireNcmLogin}
            onLogout={handleLogout}
            tabRequest={props.likedCollectionTabRequest}
            onTabChange={props.onLikedCollectionTabChange}
            onSelectedPlaylistChange={props.onSelectedPlaylistChange}
            setFeedback={setRawFeedback}
            playback={playback}
            currentTrackPath={props.currentTrackPath}
            currentSongId={props.currentSongId}
            isPlaying={props.isPlaying}
            onPause={props.onPause}
            onNavigateToRadioDetail={props.onNavigateToRadioDetail}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
            radioSubscribeEvent={props.radioSubscribeEvent}
            onDetailViewChange={setHasDetailView}
          />
        </Match>
        <Match when={props.mode === "created-playlists" || props.mode === "collected-playlists"}>
          <UserPlaylistsMode
            kind={props.mode as "created-playlists" | "collected-playlists"}
            loginProfile={loginProfile}
            isCheckingLogin={isCheckingLogin}
            isLoginBusy={isLoginBusy}
            onBeginLogin={props.onRequireNcmLogin}
            onLogout={handleLogout}
            selectedPlaylistId={props.selectedPlaylistId ?? null}
            onSelectedPlaylistChange={props.onSelectedPlaylistChange}
            onStaleSelectedPlaylist={() => {
              props.onSelectedPlaylistChange?.(null);
              props.onNavigateToRecommend?.();
            }}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
            setFeedback={setRawFeedback}
            playback={playback}
            currentTrackPath={props.currentTrackPath}
            currentSongId={props.currentSongId}
            isPlaying={props.isPlaying}
            onDetailViewChange={setHasDetailView}
          />
        </Match>
      </Switch>

      <Show when={shouldShowFeedbackCard()}>
        <section class="online-login-card">
          <div class="status-stack">
            <strong>{t("ncm.login.title")}</strong>
            <span class="status-line">{loginStatusText()}</span>
            <span class={feedback().tone === "error" ? "status-error" : "status-line"}>{feedback().message}</span>
          </div>
        </section>
      </Show>

    </div>
  );
}

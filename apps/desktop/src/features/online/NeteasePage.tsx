import { Match, Switch, createEffect, createMemo, createSignal, on } from "solid-js";
import { createApiClient } from "../../shared/api/client";
import { useTranslation } from "../../shared/i18n";
import { useNcmAccount } from "../../shared/state/NcmAccountContext";
import { useUISearch } from "../../shared/state/UISearchContext";
import { usePlayback } from "../../app/PlaybackContext";
import type { FeedCardItem, OnlineTrackItem, RadioSubscribeEvent } from "./shared/types";
import {
  createErrorMessageReader,
  createFeedbackSetter,
  createInitialFeedback
} from "./shared/feedback";
import type { Feedback, NcmProfile, NeteasePageMode } from "./shared/types";
import { createPlaybackController } from "./shared/playback";
import { DiscoverMode } from "./modes/DiscoverMode";
import { LikedCollectionMode } from "./modes/LikedCollectionMode";
import { LikedSongsMode } from "./modes/LikedSongsMode";
import { RecommendMode } from "./modes/RecommendMode";
import { OnlineSearchMode } from "./modes/OnlineSearchMode";
import { createOnlineSearchController } from "./shared/useOnlineSearchController";
import { UserPlaylistsMode } from "./modes/UserPlaylistsMode";
import type { OnlinePlaylistSummary } from "./ncmPlaylistSummary";
import { applyNcmPlaylistSubscribeCacheUpdate } from "./ncmPlaylistSummaryCache";
import { OnlineAlbumDetailRoute } from "./details/OnlineAlbumDetailRoute";
import { OnlineArtistDetailRoute } from "./details/OnlineArtistDetailRoute";
import { OnlineDailySongsRoute } from "./details/OnlineDailySongsRoute";
import { OnlineStandalonePlaylistDetailRoute } from "./details/OnlineStandalonePlaylistDetailRoute";
import { OnlineVideoDetailRoute } from "./details/OnlineVideoDetailRoute";
import type { DiscoverTab } from "../../shared/ui/navigation";

const api = createApiClient();

interface NeteasePageProps {
  mode: NeteasePageMode;
  selectedPlaylistId?: number | null;
  onSelectedPlaylistChange?: (playlistId: number | null) => void;
  onNavigate?: (page: "recommend" | "discover" | "search" | "radio") => void;
  onNavigateToRecommend?: () => void;
  onNavigateToDiscover?: (tab: string) => void;
  onDiscoverTabChange?: (tab: DiscoverTab) => void;
  onNavigateToDailySongs?: () => void;
  onNavigateToArtistDetail?: (artist: FeedCardItem) => void;
  onNavigateToRadioDetail?: (radio: FeedCardItem) => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  onNavigateToMv?: (track: OnlineTrackItem) => void;
  onNavigateToAlbumDetail?: (album: FeedCardItem) => void;
  onNavigateToPlaylistDetail?: (playlist: OnlinePlaylistSummary) => void;
  onNavigateToVideoDetail?: (video: FeedCardItem) => void;
  dailySongsRequest?: { version: number };
  videoDetailRequest?: { video: FeedCardItem | null; version: number };
  discoverTabRequest?: { tab: DiscoverTab; version: number };
  likedCollectionTabRequest?: { tab: "playlists" | "albums" | "artists"; version: number };
  onLikedCollectionTabChange?: (tab: "playlists" | "albums" | "artists") => void;
  artistDetailRequest?: { artist: FeedCardItem | null; version: number };
  albumDetailRequest?: { album: FeedCardItem | null; version: number };
  playlistDetailRequest?: { playlist: OnlinePlaylistSummary | null; version: number };
  radioSubscribeEvent?: RadioSubscribeEvent | null;
  onRequireNcmLogin: () => void;
}

export function NeteasePage(props: NeteasePageProps) {
  const { t } = useTranslation();
  const accountStore = useNcmAccount();
  const playbackContext = usePlayback();
  const { query: globalQuery, submitNonce } = useUISearch();

  const [isLoginBusy] = createSignal<boolean>(false);
  const [, setFeedback] = createSignal<Feedback>(createInitialFeedback(t));

  const loginProfile = createMemo<NcmProfile | null>(() => {
    const acct = accountStore.activeAccount();
    if (!acct) return null;
    return { userId: acct.userId, nickname: acct.nickname };
  });

  const setRawFeedback = createFeedbackSetter(setFeedback);
  const readErrorMessage = createErrorMessageReader(t);

  const onlinePlayback = createPlaybackController({
    api,
    t,
    onRegisterPlayback: playbackContext.registerNcmPlayback,
    onStateRefresh: playbackContext.refreshState,
    setFeedback: setRawFeedback
  });
  const onlineSearch = createOnlineSearchController({
    api,
    t,
    setFeedback: setRawFeedback,
    readErrorMessage
  });

  const isDiscoverMode = () => props.mode === "discover";

  const handlePlaylistSubscribeChange = (
    playlist: OnlinePlaylistSummary,
    subscribed: boolean
  ) => {
    const profile = loginProfile();
    if (!profile) return;
    applyNcmPlaylistSubscribeCacheUpdate(profile.userId, playlist, subscribed);
  };

  createEffect(
    on(
      submitNonce,
      () => {
        props.onNavigate?.("search");
        void onlineSearch.runSearch(globalQuery());
      },
      { defer: true }
    )
  );

  return (
    <div class={`panel panel-page online-page${props.mode === "recommend" ? " is-recommend-page" : ""}${isDiscoverMode() ? " is-discover-page" : ""}`}>
      <Switch>
        <Match when={props.mode === "recommend"}>
          <RecommendMode
            loginProfile={loginProfile}
            onSelectedPlaylistChange={props.onSelectedPlaylistChange}
            onNavigateToDiscover={props.onNavigateToDiscover}
            onNavigateToDailySongs={props.onNavigateToDailySongs}
            onNavigateToRadioDetail={props.onNavigateToRadioDetail}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
            onNavigateToMv={props.onNavigateToMv}
            onNavigateToArtistDetail={props.onNavigateToArtistDetail}
            onNavigateToAlbumDetail={props.onNavigateToAlbumDetail}
            onNavigateToPlaylistDetail={props.onNavigateToPlaylistDetail}
            onNavigateToVideoDetail={props.onNavigateToVideoDetail}
            setFeedback={setRawFeedback}
            playback={onlinePlayback}
          />
        </Match>
        <Match when={props.mode === "discover"}>
          <DiscoverMode
            loginProfile={loginProfile}
            discoverTabRequest={props.discoverTabRequest}
            onDiscoverTabChange={props.onDiscoverTabChange}
            onNavigateToRadioDetail={props.onNavigateToRadioDetail}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
            onNavigateToMv={props.onNavigateToMv}
            onNavigateToDailySongs={props.onNavigateToDailySongs}
            onNavigateToArtistDetail={props.onNavigateToArtistDetail}
            onNavigateToAlbumDetail={props.onNavigateToAlbumDetail}
            onNavigateToPlaylistDetail={props.onNavigateToPlaylistDetail}
            onNavigateToVideoDetail={props.onNavigateToVideoDetail}
            onSelectedPlaylistChange={props.onSelectedPlaylistChange}
            setFeedback={setRawFeedback}
            playback={onlinePlayback}
          />
        </Match>
        <Match when={props.mode === "search"}>
          <OnlineSearchMode
            loginProfile={loginProfile}
            search={onlineSearch}
            onNavigateToRadioDetail={props.onNavigateToRadioDetail}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
            onNavigateToMv={props.onNavigateToMv}
            onNavigateToArtistDetail={props.onNavigateToArtistDetail}
            onNavigateToAlbumDetail={props.onNavigateToAlbumDetail}
            onNavigateToPlaylistDetail={props.onNavigateToPlaylistDetail}
            onNavigateToVideoDetail={props.onNavigateToVideoDetail}
            onSelectedPlaylistChange={props.onSelectedPlaylistChange}
            setFeedback={setRawFeedback}
            playback={onlinePlayback}
          />
        </Match>
        <Match when={props.mode === "daily-songs"}>
          <OnlineDailySongsRoute
            request={props.dailySongsRequest}
            loginProfile={loginProfile}
            setFeedback={setRawFeedback}
            playback={onlinePlayback}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
            onNavigateToMv={props.onNavigateToMv}
          />
        </Match>
        <Match when={props.mode === "artist-detail"}>
          <OnlineArtistDetailRoute
            request={props.artistDetailRequest}
            loginProfile={loginProfile}
            setFeedback={setRawFeedback}
            playback={onlinePlayback}
            onNavigateToAlbumDetail={props.onNavigateToAlbumDetail}
            onNavigateToVideoDetail={props.onNavigateToVideoDetail}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
          />
        </Match>
        <Match when={props.mode === "album-detail"}>
          <OnlineAlbumDetailRoute
            request={props.albumDetailRequest}
            loginProfile={loginProfile}
            setFeedback={setRawFeedback}
            playback={onlinePlayback}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
          />
        </Match>
        <Match when={props.mode === "playlist-detail"}>
          <OnlineStandalonePlaylistDetailRoute
            request={props.playlistDetailRequest}
            loginProfile={loginProfile}
            setFeedback={setRawFeedback}
            playback={onlinePlayback}
            onSelectedPlaylistChange={props.onSelectedPlaylistChange}
            onPlaylistSubscribeChange={handlePlaylistSubscribeChange}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
            onNavigateToMv={props.onNavigateToMv}
          />
        </Match>
        <Match when={props.mode === "video-detail"}>
          <OnlineVideoDetailRoute
            request={props.videoDetailRequest}
            onNavigateToArtistDetail={props.onNavigateToArtistDetail}
          />
        </Match>
        <Match when={props.mode === "liked-songs"}>
          <LikedSongsMode
            loginProfile={loginProfile}
            isLoginBusy={isLoginBusy}
            onBeginLogin={props.onRequireNcmLogin}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
            onNavigateToMv={props.onNavigateToMv}
            setFeedback={setRawFeedback}
            playback={onlinePlayback}
          />
        </Match>
        <Match when={props.mode === "liked"}>
          <LikedCollectionMode
            loginProfile={loginProfile}
            isLoginBusy={isLoginBusy}
            onBeginLogin={props.onRequireNcmLogin}
            tabRequest={props.likedCollectionTabRequest}
            onTabChange={props.onLikedCollectionTabChange}
            setFeedback={setRawFeedback}
            playback={onlinePlayback}
            onNavigateToArtistDetail={props.onNavigateToArtistDetail}
            onNavigateToRadioDetail={props.onNavigateToRadioDetail}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
            onNavigateToMv={props.onNavigateToMv}
            onNavigateToAlbumDetail={props.onNavigateToAlbumDetail}
            onNavigateToPlaylistDetail={props.onNavigateToPlaylistDetail}
            onNavigateToVideoDetail={props.onNavigateToVideoDetail}
            radioSubscribeEvent={props.radioSubscribeEvent}
          />
        </Match>
        <Match when={props.mode === "created-playlists" || props.mode === "collected-playlists"}>
          <UserPlaylistsMode
            kind={props.mode as "created-playlists" | "collected-playlists"}
            loginProfile={loginProfile}
            isLoginBusy={isLoginBusy}
            onBeginLogin={props.onRequireNcmLogin}
            selectedPlaylistId={props.selectedPlaylistId ?? null}
            onSelectedPlaylistChange={props.onSelectedPlaylistChange}
            onStaleSelectedPlaylist={() => {
              props.onSelectedPlaylistChange?.(null);
              props.onNavigateToRecommend?.();
            }}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
            onNavigateToMv={props.onNavigateToMv}
            onNavigateToPlaylistDetail={props.onNavigateToPlaylistDetail}
            setFeedback={setRawFeedback}
            playback={onlinePlayback}
          />
        </Match>
      </Switch>

    </div>
  );
}

import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { createApiClient } from "../../shared/api/client";
import {
  playlistTrackAll,
  search,
  songDetail,
  songUrlV1,
  userPlaylist
} from "../../shared/api/ncm";
import { useTranslation } from "../../shared/i18n";
import { IconPlayCircle, IconRefresh } from "../../components/icons";
import { LoginModal } from "../../components/LoginModal";
import { MediaList, type MediaListItem } from "../../components/media/MediaList";
import { PageHeader } from "../../components/page/PageHeader";
import { SegmentedTabs } from "../../components/page/SegmentedTabs";
import { useNcmAccount } from "../../shared/state/NcmAccountContext";
import { readSongDetailSupplement, type NcmTrackReference } from "./ncmPlayback";

const api = createApiClient();
const SEARCH_LIMIT = 30;
const PLAYLIST_TRACK_LIMIT = 200;

type NeteasePageMode = "recommend" | "discover" | "created-playlists" | "collected-playlists";
type SearchTab = "songs" | "playlists";

interface NcmProfile {
  userId: number;
  nickname: string | null;
}

interface Feedback {
  tone: "neutral" | "success" | "error";
  message: string;
}

interface OnlineTrackItem extends MediaListItem {
  songId: number;
}

interface OnlinePlaylistSummary {
  id: number;
  name: string;
  creator: string | null;
  coverUrl: string | null;
  trackCount: number | null;
  subscribed: boolean;
}

interface NeteasePageProps {
  mode: NeteasePageMode;
  onStateRefresh: () => Promise<void>;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
  onRegisterPlayback: (track: NcmTrackReference) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? value : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const readString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const readArtists = (value: unknown): string | null => {
  const names = asArray(value)
    .map((item) => readString(asRecord(item)?.name))
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(", ") : null;
};

const adaptTrack = (value: unknown): OnlineTrackItem | null => {
  const item = asRecord(value);
  if (!item) return null;
  const songId = readNumber(item.id);
  const title = readString(item.name);
  if (songId === null || title === null) return null;
  const durationMs = readNumber(item.dt);
  const album = readString(asRecord(item.al)?.name) ?? readString(item.album);
  const artist =
    readArtists(item.ar) ??
    readArtists(item.artists) ??
    readString(asRecord(item.artist)?.name);
  return {
    id: `ncm-song-${songId}`,
    songId,
    source_path: `https://music.163.com/#/song?id=${songId}`,
    title,
    artist,
    album,
    duration_secs: durationMs === null ? null : durationMs / 1000
  };
};

const adaptPlaylist = (value: unknown): OnlinePlaylistSummary | null => {
  const item = asRecord(value);
  if (!item) return null;
  const id = readNumber(item.id);
  const name = readString(item.name);
  if (id === null || name === null) return null;
  return {
    id,
    name,
    creator: readString(asRecord(item.creator)?.nickname),
    coverUrl: readString(item.coverImgUrl),
    trackCount: readNumber(item.trackCount),
    subscribed: readBoolean(item.subscribed) ?? false
  };
};

const readSearchTracks = (payload: unknown): OnlineTrackItem[] => {
  const result = asRecord(asRecord(payload)?.result);
  return asArray(result?.songs).map(adaptTrack).filter((item): item is OnlineTrackItem => item !== null);
};

const readSearchPlaylists = (payload: unknown): OnlinePlaylistSummary[] => {
  const result = asRecord(asRecord(payload)?.result);
  return asArray(result?.playlists).map(adaptPlaylist).filter((item): item is OnlinePlaylistSummary => item !== null);
};

const readUserPlaylists = (payload: unknown): OnlinePlaylistSummary[] =>
  asArray(asRecord(payload)?.playlist).map(adaptPlaylist).filter((item): item is OnlinePlaylistSummary => item !== null);

const readPlaylistTracks = (payload: unknown): OnlineTrackItem[] => {
  const root = asRecord(payload);
  const songs = asArray(root?.songs);
  if (songs.length > 0) return songs.map(adaptTrack).filter((item): item is OnlineTrackItem => item !== null);
  const playlist = asRecord(root?.playlist);
  return asArray(playlist?.tracks).map(adaptTrack).filter((item): item is OnlineTrackItem => item !== null);
};

const readSongUrl = (payload: unknown): string | null => {
  const root = asRecord(payload);
  const first = asRecord(asArray(root?.data)[0]);
  return readString(first?.url);
};

export function NeteasePage(props: NeteasePageProps) {
  const { t } = useTranslation();
  const accountStore = useNcmAccount();
  const [isCheckingLogin, setIsCheckingLogin] = createSignal(false);
  const [isLoginBusy, setIsLoginBusy] = createSignal(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = createSignal(false);
  const [feedback, setFeedback] = createSignal<Feedback>({ tone: "neutral", message: t("ncm.feedback.initial") });
  const [searchTab, setSearchTab] = createSignal<SearchTab>("songs");
  const [searchQuery, setSearchQuery] = createSignal("");
  const [isSearching, setIsSearching] = createSignal(false);
  const [songResults, setSongResults] = createSignal<OnlineTrackItem[]>([]);
  const [playlistResults, setPlaylistResults] = createSignal<OnlinePlaylistSummary[]>([]);
  const [userPlaylistsState, setUserPlaylistsState] = createSignal<OnlinePlaylistSummary[]>([]);
  const [isLoadingUserPlaylists, setIsLoadingUserPlaylists] = createSignal(false);
  const [selectedPlaylist, setSelectedPlaylist] = createSignal<OnlinePlaylistSummary | null>(null);
  const [playlistTracksState, setPlaylistTracksState] = createSignal<OnlineTrackItem[]>([]);
  const [isLoadingPlaylistTracks, setIsLoadingPlaylistTracks] = createSignal(false);

  const loginProfile = createMemo<NcmProfile | null>(() => {
    const acct = accountStore.activeAccount();
    if (!acct) return null;
    return { userId: acct.userId, nickname: acct.nickname };
  });

  const readErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : t("common.error.requestFailed");

  const setRawFeedback = (tone: Feedback["tone"], message: string) => setFeedback({ tone, message });

  const pageTitle = () =>
    props.mode === "recommend"
      ? t("ncm.title.recommend")
      : props.mode === "discover"
        ? t("ncm.title.discover")
        : props.mode === "created-playlists"
          ? t("ncm.title.createdPlaylists")
          : t("ncm.title.collectedPlaylists");

  const pageSubtitle = () =>
    props.mode === "recommend" || props.mode === "discover"
      ? t("ncm.subtitle.search")
      : t("ncm.subtitle.playlists");

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

  const beginLogin = () => {
    setIsLoginModalOpen(true);
  };

  const handleRefreshLogin = async () => {
    setIsLoginBusy(true);
    try {
      if (loginProfile()) {
        await accountStore.refreshActive();
        setRawFeedback("success", t("ncm.feedback.loginRefreshed"));
      }
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsLoginBusy(false);
    }
  };

  const handleLogout = async () => {
    setIsLoginBusy(true);
    try {
      await accountStore.logoutActive();
      setUserPlaylistsState([]);
      setSelectedPlaylist(null);
      setPlaylistTracksState([]);
      setRawFeedback("success", t("ncm.feedback.loggedOut"));
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsLoginBusy(false);
    }
  };

  const registerAndResolveTrack = async (item: OnlineTrackItem): Promise<string> => {
    const [songUrlResponse, detailResponse] = await Promise.all([
      songUrlV1({ id: item.songId, level: "exhigh" }),
      songDetail(item.songId)
    ]);
    const url = readSongUrl(songUrlResponse);
    if (!url) throw new Error(t("ncm.error.songUrlUnavailable"));
    const detail = readSongDetailSupplement(detailResponse, item.songId);
    props.onRegisterPlayback({
      songId: item.songId,
      streamUrl: url,
      sourcePageUrl: item.source_path,
      title: detail?.title ?? item.title,
      artist: detail?.artist ?? item.artist,
      album: detail?.album ?? item.album,
      coverUrl: detail?.coverUrl ?? null,
      durationSecs: item.duration_secs
    });
    return url;
  };

  const playOnlineTrack = async (item: OnlineTrackItem) => {
    try {
      const url = await registerAndResolveTrack(item);
      await api.load(url);
      await props.onStateRefresh();
      setRawFeedback("success", t("ncm.feedback.trackLoaded", { title: item.title ?? item.songId }));
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    }
  };

  const enqueueOnlineTrack = async (item: OnlineTrackItem) => {
    try {
      const url = await registerAndResolveTrack(item);
      await api.enqueueTrack(url);
      setRawFeedback("success", t("ncm.feedback.trackQueued", { title: item.title ?? item.songId }));
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    }
  };

  const loadPlaylistTracks = async (playlist: OnlinePlaylistSummary) => {
    setSelectedPlaylist(playlist);
    setIsLoadingPlaylistTracks(true);
    try {
      const response = await playlistTrackAll({ id: playlist.id, limit: PLAYLIST_TRACK_LIMIT });
      setPlaylistTracksState(readPlaylistTracks(response));
    } catch (error) {
      setPlaylistTracksState([]);
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsLoadingPlaylistTracks(false);
    }
  };

  const handleSearch = async () => {
    const query = searchQuery().trim();
    if (!query) {
      setRawFeedback("error", t("ncm.error.emptySearch"));
      return;
    }
    setIsSearching(true);
    setSelectedPlaylist(null);
    setPlaylistTracksState([]);
    try {
      const response = await search({
        keywords: query,
        type: searchTab() === "songs" ? 1 : 1000,
        limit: SEARCH_LIMIT
      });
      if (searchTab() === "songs") {
        setSongResults(readSearchTracks(response));
        setPlaylistResults([]);
      } else {
        setPlaylistResults(readSearchPlaylists(response));
        setSongResults([]);
      }
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsSearching(false);
    }
  };

  createEffect(() => {
    const profile = loginProfile();
    const mode = props.mode;
    if ((mode !== "created-playlists" && mode !== "collected-playlists") || profile === null) return;
    let cancelled = false;
    const run = async () => {
      setIsLoadingUserPlaylists(true);
      try {
        const response = await userPlaylist({ uid: profile.userId, limit: 100 });
        if (cancelled) return;
        const allPlaylists = readUserPlaylists(response);
        setUserPlaylistsState(allPlaylists.filter((item) => mode === "created-playlists" ? !item.subscribed : item.subscribed));
      } catch (error) {
        if (!cancelled) {
          setUserPlaylistsState([]);
          setRawFeedback("error", readErrorMessage(error));
        }
      } finally {
        if (!cancelled) setIsLoadingUserPlaylists(false);
      }
    };
    void run();
    onCleanup(() => {
      cancelled = true;
    });
  });

  const loginStatusText = () => {
    if (isCheckingLogin()) return t("ncm.login.status.checking");
    const profile = loginProfile();
    if (profile) return t("ncm.login.status.loggedIn", { name: profile.nickname ?? profile.userId });
    return t("ncm.login.status.loggedOut");
  };

  const playlistCards = () =>
    props.mode === "created-playlists" || props.mode === "collected-playlists"
      ? userPlaylistsState()
      : playlistResults();

  const playlistEmptyText = () =>
    props.mode === "created-playlists" || props.mode === "collected-playlists"
      ? t("ncm.empty.noUserPlaylists")
      : t("ncm.empty.noPlaylists");

  const searchTabs = createMemo(() => [
    { value: "songs", label: t("ncm.tabs.songs") },
    { value: "playlists", label: t("ncm.tabs.playlists") }
  ]);

  const PlaylistGrid = () => (
    <div class="online-playlist-grid">
      <Show when={playlistCards().length > 0} fallback={<div class="panel-note">{playlistEmptyText()}</div>}>
        <For each={playlistCards()}>
          {(playlist) => (
            <button
              type="button"
              class={`online-playlist-card${selectedPlaylist()?.id === playlist.id ? " is-active" : ""}`}
              onClick={() => void loadPlaylistTracks(playlist)}
            >
              <div class="online-playlist-art">
                <Show when={playlist.coverUrl} fallback={<span>{playlist.name.slice(0, 1)}</span>}>
                  {(coverUrl) => <img src={coverUrl()} alt="" />}
                </Show>
              </div>
              <div class="online-playlist-copy">
                <strong>{playlist.name}</strong>
                <span>{t("ncm.playlist.meta", {
                  count: playlist.trackCount ?? 0,
                  creator: playlist.creator ?? t("ncm.playlist.creatorUnknown")
                })}</span>
              </div>
            </button>
          )}
        </For>
      </Show>
    </div>
  );

  const PlaylistTracks = () => (
    <Show when={selectedPlaylist()}>
      {(playlist) => (
        <div class="online-playlist-tracks">
          <h3>{playlist().name}</h3>
          <MediaList
            items={playlistTracksState()}
            currentSourcePath={props.currentTrackPath}
            currentSongId={props.currentSongId}
            isPlayingNow={props.isPlaying}
            onPlay={(item) => void playOnlineTrack(item)}
            onEnqueue={(item) => void enqueueOnlineTrack(item)}
            isLoading={isLoadingPlaylistTracks()}
            emptyState={<div class="panel-note">{t("ncm.empty.noTracks")}</div>}
          />
        </div>
      )}
    </Show>
  );

  return (
    <div class="panel panel-page online-page">
      <PageHeader
        title={pageTitle()}
        meta={
          <>
            <span class="page-header-meta-line">{pageSubtitle()}</span>
            <span class="page-header-meta-line">{loginStatusText()}</span>
          </>
        }
        actions={
          <>
            <button type="button" class="primary-button page-action" onClick={beginLogin} disabled={isLoginBusy()}>
              <IconPlayCircle />
              {t("ncm.login.action.qr")}
            </button>
            <button type="button" class="ghost-button page-action" onClick={() => void handleRefreshLogin()} disabled={isCheckingLogin() || isLoginBusy()}>
              <IconRefresh />
              {t("ncm.login.action.refresh")}
            </button>
            <button type="button" class="ghost-button page-action" onClick={() => void handleLogout()} disabled={isLoginBusy() || loginProfile() === null}>
              {t("ncm.login.action.logout")}
            </button>
          </>
        }
        tabs={
          props.mode === "recommend" || props.mode === "discover" ? (
            <SegmentedTabs
              value={searchTab()}
              onChange={(next) => setSearchTab(next as SearchTab)}
              items={searchTabs()}
              ariaLabel={t("ncm.tabs.aria")}
            />
          ) : undefined
        }
      />

      <section class="online-login-card">
        <div class="status-stack">
          <strong>{t("ncm.login.title")}</strong>
          <span class="status-line">{loginStatusText()}</span>
          <Show when={feedback().message}>
            <span class={feedback().tone === "error" ? "status-error" : "status-line"}>{feedback().message}</span>
          </Show>
        </div>
      </section>

      <LoginModal open={isLoginModalOpen()} onClose={() => setIsLoginModalOpen(false)} />

      <Show when={props.mode === "recommend" || props.mode === "discover"}>
        <form
          class="online-search-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSearch();
          }}
        >
          <input
            type="search"
            class="text-input"
            value={searchQuery()}
            onInput={(event) => setSearchQuery(event.currentTarget.value)}
            placeholder={t("ncm.search.placeholder")}
          />
          <button type="submit" class="primary-button" disabled={isSearching()}>
            {isSearching() ? t("ncm.search.searching") : t("ncm.search.action")}
          </button>
        </form>

        <Show
          when={searchTab() === "songs"}
          fallback={
            <div class="online-playlist-layout">
              <PlaylistGrid />
              <PlaylistTracks />
            </div>
          }
        >
          <MediaList
            items={songResults()}
            currentSourcePath={props.currentTrackPath}
            currentSongId={props.currentSongId}
            isPlayingNow={props.isPlaying}
            onPlay={(item) => void playOnlineTrack(item)}
            onEnqueue={(item) => void enqueueOnlineTrack(item)}
            emptyState={<div class="panel-note">{searchQuery().trim() ? t("ncm.empty.noSongs") : t("ncm.empty.searchPrompt")}</div>}
          />
        </Show>
      </Show>

      <Show when={props.mode === "created-playlists" || props.mode === "collected-playlists"}>
        <div class="online-playlist-layout">
          <Show when={loginProfile() !== null} fallback={<div class="panel-note">{t("ncm.empty.loginRequired")}</div>}>
            <Show when={playlistCards().length > 0} fallback={<div class="panel-note">{isLoadingUserPlaylists() ? t("ncm.playlist.loading") : playlistEmptyText()}</div>}>
              <PlaylistGrid />
            </Show>
            <PlaylistTracks />
          </Show>
        </div>
      </Show>
    </div>
  );
}

import { For, Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import { AlbumCard } from "../../../components/AlbumCard";
import { IconPlayCircle } from "../../../components/icons";
import { PageHeader } from "../../../components/page/PageHeader";
import { useTranslation } from "../../../shared/i18n";
import { createApiClient } from "../../../shared/api/client";
import { useUISettings } from "../../../shared/state/useUISettings";
import { NaiveP } from "../../../shared/ui/naive";
import {
  type OnlinePlaylistSummary
} from "../ncmPlaylistSummary";
import {
  applyNcmPlaylistSubscribeCacheUpdate,
  loadNcmUserPlaylistsByModeCached,
  subscribeNcmUserPlaylistGroups
} from "../ncmPlaylistSummaryCache";
import { OnlinePlaylistDetailRoute } from "../details/OnlinePlaylistDetailRoute";
import {
  createErrorMessageReader,
  createLoginStatusText,
  type FeedbackSetter
} from "../shared/feedback";
import type { PlaybackController } from "../shared/playback";
import type { NcmProfile, OnlineTrackItem } from "../shared/types";
import { createDetailViewReporter, type OnlineDetailViewReporterProps } from "../shared/detailViewReporter";
import { useDetailNavigation } from "../shared/useDetailNavigation";

export type UserPlaylistsKind = "created-playlists" | "collected-playlists";

const api = createApiClient();

export interface UserPlaylistsModeProps extends OnlineDetailViewReporterProps {
  kind: UserPlaylistsKind;
  loginProfile: Accessor<NcmProfile | null>;
  isCheckingLogin: Accessor<boolean>;
  isLoginBusy: Accessor<boolean>;
  onBeginLogin: () => void;
  onLogout: () => void | Promise<void>;
  selectedPlaylistId: number | null;
  onSelectedPlaylistChange?: (playlistId: number | null) => void;
  onStaleSelectedPlaylist?: () => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  setFeedback: FeedbackSetter;
  playback: PlaybackController;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
}

export function UserPlaylistsMode(props: UserPlaylistsModeProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();

  const [userPlaylistsState, setUserPlaylistsState] = createSignal<OnlinePlaylistSummary[]>([]);
  const [isLoadingUserPlaylists, setIsLoadingUserPlaylists] = createSignal(false);

  const detailNav = useDetailNavigation({
    t,
    loginProfile: props.loginProfile,
    playback: props.playback,
    setFeedback: props.setFeedback,
    onSelectedPlaylistChange: props.onSelectedPlaylistChange,
    onPlaylistSubscribeChange: (playlist, subscribed) => {
      const profile = props.loginProfile();
      if (profile) {
        applyNcmPlaylistSubscribeCacheUpdate(profile.userId, playlist, subscribed);
      }
      if (props.kind !== "collected-playlists") return;
      setUserPlaylistsState((current) => {
        if (!subscribed) {
          return current.filter((item) => item.id !== playlist.id);
        }
        return current.some((item) => item.id === playlist.id) ? current : [playlist, ...current];
      });
    }
  });

  const pageTitle = () =>
    props.kind === "created-playlists"
      ? t("ncm.title.createdPlaylists")
      : t("ncm.title.collectedPlaylists");

  const pageSubtitle = () => t("ncm.subtitle.playlists");

  const loginStatusText = createLoginStatusText(t, props.isCheckingLogin, props.loginProfile);

  const readErrorMessage = createErrorMessageReader(t);
  const hasDetailView = () => detailNav.selectedPlaylist() !== null;

  createDetailViewReporter(hasDetailView, props.onDetailViewChange);

  createEffect(on(props.loginProfile, (profile, prev) => {
    if (prev !== undefined && prev !== null && profile === null) {
      setUserPlaylistsState([]);
    }
  }, { defer: true }));

  createEffect(() => {
    const profile = props.loginProfile();
    const kind = props.kind;
    if (profile === null) return;
    const unsubscribe = subscribeNcmUserPlaylistGroups(profile.userId, (groups) => {
      setUserPlaylistsState(kind === "created-playlists" ? groups.created : groups.collected);
    });
    let cancelled = false;
    const run = async () => {
      setIsLoadingUserPlaylists(true);
      try {
        const playlists = await loadNcmUserPlaylistsByModeCached(api, profile.userId, kind);
        if (cancelled) return;
        setUserPlaylistsState(playlists);
      } catch (error) {
        if (!cancelled) {
          setUserPlaylistsState([]);
          props.setFeedback("error", readErrorMessage(error));
        }
      } finally {
        if (!cancelled) setIsLoadingUserPlaylists(false);
      }
    };
    void run();
    onCleanup(() => {
      cancelled = true;
      unsubscribe();
    });
  });

  createEffect(() => {
    const playlistId = props.selectedPlaylistId ?? null;
    if (playlistId === null) {
      detailNav.setSelectedPlaylist(null);
      detailNav.setPlaylistTracksState([]);
      return;
    }

    const matchedPlaylist = userPlaylistsState().find((item) => item.id === playlistId) ?? null;
    if (!matchedPlaylist) {
      if (!isLoadingUserPlaylists()) {
        props.onStaleSelectedPlaylist?.();
      }
      return;
    }

    if (
      detailNav.selectedPlaylist()?.id === playlistId &&
      detailNav.playlistTracksState().length > 0
    ) {
      return;
    }

    void detailNav.loadPlaylistTracks(matchedPlaylist);
  });

  createEffect(() => {
    if (isLoadingUserPlaylists()) {
      return;
    }

    const playlistId = props.selectedPlaylistId ?? null;
    if (playlistId !== null) {
      return;
    }

    if (detailNav.selectedPlaylist() === null) {
      return;
    }

    detailNav.setSelectedPlaylist(null);
    detailNav.setPlaylistTracksState([]);
  });

  createEffect(() => {
    if (isLoadingUserPlaylists()) {
      return;
    }

    if ((props.selectedPlaylistId ?? null) !== null || detailNav.selectedPlaylist() !== null) {
      return;
    }

    const firstPlaylist = userPlaylistsState()[0] ?? null;
    if (!firstPlaylist) {
      return;
    }

    void detailNav.loadPlaylistTracks(firstPlaylist);
  });

  const playlistEmptyText = () => t("ncm.empty.noUserPlaylists");

  return (
    <>
      <Show when={!detailNav.selectedPlaylist()}>
        <PageHeader
          title={pageTitle()}
          meta={
            <>
              <span class="page-header-meta-line">{pageSubtitle()}</span>
              <span class="page-header-meta-line">{loginStatusText()}</span>
            </>
          }
          actions={
            props.loginProfile() === null ? (
              <button
                type="button"
                class="primary-button page-action"
                onClick={props.onBeginLogin}
                disabled={props.isLoginBusy()}
              >
                <IconPlayCircle />
                {t("ncm.login.action.qr")}
              </button>
            ) : (
              <button
                type="button"
                class="ghost-button page-action"
                onClick={() => void props.onLogout()}
                disabled={props.isLoginBusy()}
              >
                {t("ncm.login.action.logout")}
              </button>
            )
          }
        />
      </Show>
      <Show when={props.loginProfile() !== null} fallback={<NaiveP class="panel-note">{t("ncm.empty.loginRequired")}</NaiveP>}>
      <Show
        when={detailNav.selectedPlaylist()}
        fallback={
          <Show
            when={userPlaylistsState().length > 0}
            fallback={
              <NaiveP class="panel-note">
                {isLoadingUserPlaylists() ? t("ncm.playlist.loading") : playlistEmptyText()}
              </NaiveP>
            }
          >
            <section class="playlist-grid-section">
              <div class="album-grid content-fade-in">
                <For each={userPlaylistsState()}>
                  {(playlist) => (
                    <AlbumCard
                      title={playlist.name}
                      subtitle={t("ncm.playlist.meta", {
                        count: playlist.trackCount ?? 0,
                        creator: playlist.creator ?? t("ncm.playlist.creatorUnknown")
                      })}
                      coverUrl={playlist.coverUrl}
                      coverVisible={!uiSettings.hiddenCovers.playlist}
                      size="md"
                      active={detailNav.selectedPlaylist()?.id === playlist.id}
                      onClick={() => void detailNav.loadPlaylistTracks(playlist)}
                    />
                  )}
                </For>
              </div>
            </section>
          </Show>
        }
      >
        <OnlinePlaylistDetailRoute
          detailNav={detailNav}
          subtitleText={pageTitle()}
          loginProfile={props.loginProfile()}
          setFeedback={props.setFeedback}
          playback={props.playback}
          currentTrackPath={props.currentTrackPath}
          currentSongId={props.currentSongId}
          isPlaying={props.isPlaying}
          onNavigateToSongWiki={props.onNavigateToSongWiki}
        />
      </Show>
    </Show>
    </>
  );
}

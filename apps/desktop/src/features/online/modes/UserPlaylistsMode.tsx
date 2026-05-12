import { For, Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import { AlbumCard } from "../../../components/AlbumCard";
import { IconPlayCircle } from "../../../components/icons";
import { PageHeader } from "../../../components/page/PageHeader";
import { useTranslation } from "../../../shared/i18n";
import { createApiClient } from "../../../shared/api/client";
import { useUISettings } from "../../../shared/state/useUISettings";
import type { OnlinePlaylistSummary } from "../ncmPlaylistSummary";
import { PlaylistDetail } from "../details/PlaylistDetail";
import type { PlaybackController } from "../shared/playback";
import type { Feedback, NcmProfile } from "../shared/types";
import { useDetailNavigation } from "../shared/useDetailNavigation";

export type UserPlaylistsKind = "created-playlists" | "collected-playlists";

const api = createApiClient();

export interface UserPlaylistsModeProps {
  kind: UserPlaylistsKind;
  loginProfile: Accessor<NcmProfile | null>;
  isCheckingLogin: Accessor<boolean>;
  isLoginBusy: Accessor<boolean>;
  onBeginLogin: () => void;
  onLogout: () => void | Promise<void>;
  selectedPlaylistId: number | null;
  onSelectedPlaylistChange?: (playlistId: number | null) => void;
  setFeedback: (tone: Feedback["tone"], message: string) => void;
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
    onSelectedPlaylistChange: props.onSelectedPlaylistChange
  });

  const pageTitle = () =>
    props.kind === "created-playlists"
      ? t("ncm.title.createdPlaylists")
      : t("ncm.title.collectedPlaylists");

  const pageSubtitle = () => t("ncm.subtitle.playlists");

  const loginStatusText = () => {
    if (props.isCheckingLogin()) return t("ncm.login.status.checking");
    const profile = props.loginProfile();
    if (profile) return t("ncm.login.status.loggedIn", { name: profile.nickname ?? profile.userId });
    return t("ncm.login.status.loggedOut");
  };

  const readErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : t("common.error.requestFailed");

  createEffect(on(props.loginProfile, (profile, prev) => {
    if (prev !== undefined && prev !== null && profile === null) {
      setUserPlaylistsState([]);
    }
  }, { defer: true }));

  createEffect(() => {
    const profile = props.loginProfile();
    const kind = props.kind;
    if (profile === null) return;
    let cancelled = false;
    const run = async () => {
      setIsLoadingUserPlaylists(true);
      try {
        const playlists = await api.listNcmUserPlaylists({
          uid: profile.userId,
          limit: 100,
          mode: kind
        });
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
      <Show when={props.loginProfile() !== null} fallback={<div class="panel-note">{t("ncm.empty.loginRequired")}</div>}>
      <Show
        when={detailNav.selectedPlaylist()}
        fallback={
          <Show
            when={userPlaylistsState().length > 0}
            fallback={
              <div class="panel-note">
                {isLoadingUserPlaylists() ? t("ncm.playlist.loading") : playlistEmptyText()}
              </div>
            }
          >
            <section class="playlist-grid-section">
              <div class="album-grid">
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
    </Show>
    </>
  );
}

import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import { IconPlayCircle } from "../../../components/icons";
import { PageHeader } from "../../../components/page/PageHeader";
import { createApiClient } from "../../../shared/api/client";
import { useTranslation } from "../../../shared/i18n";
import { PlaylistDetail } from "../details/PlaylistDetail";
import type { OnlinePlaylistSummary } from "../ncmPlaylistSummary";
import type { PlaybackController } from "../shared/playback";
import type { Feedback, NcmProfile } from "../shared/types";
import { useDetailNavigation } from "../shared/useDetailNavigation";

const api = createApiClient();

export interface LikedSongsModeProps {
  loginProfile: Accessor<NcmProfile | null>;
  isCheckingLogin: Accessor<boolean>;
  isLoginBusy: Accessor<boolean>;
  onBeginLogin: () => void;
  setFeedback: (tone: Feedback["tone"], message: string) => void;
  playback: PlaybackController;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
}

export function LikedSongsMode(props: LikedSongsModeProps) {
  const { t } = useTranslation();

  const [isLoadingLikedPlaylist, setIsLoadingLikedPlaylist] = createSignal<boolean>(false);
  const [loadedUserId, setLoadedUserId] = createSignal<number | null>(null);

  const detailNav = useDetailNavigation({
    t,
    loginProfile: props.loginProfile,
    playback: props.playback,
    setFeedback: props.setFeedback
  });

  const readErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : t("common.error.requestFailed");

  const loginStatusText = () => {
    if (props.isCheckingLogin()) return t("ncm.login.status.checking");
    const profile = props.loginProfile();
    if (profile) return t("ncm.login.status.loggedIn", { name: profile.nickname ?? profile.userId });
    return t("ncm.login.status.loggedOut");
  };

  const likedTrackLimit = (playlist: OnlinePlaylistSummary): number | undefined =>
    playlist.trackCount !== null && playlist.trackCount > 0 ? playlist.trackCount : undefined;

  createEffect(() => {
    const profile = props.loginProfile();
    if (profile === null) {
      setLoadedUserId(null);
      detailNav.setSelectedPlaylist(null);
      detailNav.setPlaylistTracksState([]);
      return;
    }

    if (loadedUserId() === profile.userId) {
      return;
    }

    let cancelled = false;
    const run = async () => {
      setIsLoadingLikedPlaylist(true);
      try {
        const playlists = await api.listNcmUserPlaylists({
          uid: profile.userId,
          limit: 1
        });
        if (cancelled) return;
        const likedPlaylist = playlists[0] ?? null;
        if (likedPlaylist === null) {
          detailNav.setSelectedPlaylist(null);
          detailNav.setPlaylistTracksState([]);
          setLoadedUserId(profile.userId);
          return;
        }
        setLoadedUserId(profile.userId);
        await detailNav.loadPlaylistTracks(likedPlaylist, {
          limit: likedTrackLimit(likedPlaylist)
        });
      } catch (error) {
        if (!cancelled) {
          detailNav.setSelectedPlaylist(null);
          detailNav.setPlaylistTracksState([]);
          setLoadedUserId(null);
          props.setFeedback("error", readErrorMessage(error));
        }
      } finally {
        if (!cancelled) setIsLoadingLikedPlaylist(false);
      }
    };
    void run();
    onCleanup(() => {
      cancelled = true;
    });
  });

  return (
    <>
      <Show when={props.loginProfile() === null}>
        <PageHeader
          title={t("ncm.liked.title")}
          meta={
            <>
              <span class="page-header-meta-line">{t("ncm.liked.description")}</span>
              <span class="page-header-meta-line">{loginStatusText()}</span>
            </>
          }
          actions={
            <button
              type="button"
              class="primary-button page-action"
              onClick={props.onBeginLogin}
              disabled={props.isLoginBusy()}
            >
              <IconPlayCircle />
              {t("ncm.login.action.qr")}
            </button>
          }
        />
      </Show>
      <Show when={props.loginProfile() !== null} fallback={<div class="panel-note">{t("ncm.empty.loginRequired")}</div>}>
        <Show
          when={detailNav.selectedPlaylist()}
          fallback={
            <div class="panel-note">
              {isLoadingLikedPlaylist() || detailNav.isLoadingPlaylistTracks()
                ? t("ncm.playlist.loading")
                : t("ncm.liked.empty")}
            </div>
          }
        >
          <PlaylistDetail
            playlist={detailNav.selectedPlaylist()}
            tracks={detailNav.filteredPlaylistTracks()}
            trackCount={detailNav.playlistTrackCount()}
            metaText={detailNav.playlistMetaText()}
            subtitleText={t("ncm.liked.eyebrow", {
              name: props.loginProfile()?.nickname ?? props.loginProfile()?.userId ?? ""
            })}
            isLoadingTracks={detailNav.isLoadingPlaylistTracks()}
            isScrolled={detailNav.isPlaylistDetailScrolled()}
            filter={detailNav.playlistFilter()}
            detailTab={detailNav.playlistDetailTab()}
            setFilter={detailNav.setPlaylistFilter}
            setDetailTab={detailNav.setPlaylistDetailTab}
            onBack={() => undefined}
            onPlayAll={detailNav.playAllPlaylistTracks}
            onScroll={detailNav.handlePlaylistTrackScroll}
            showBackButton={false}
            showCommentsTab={false}
            emptyStateText={t("ncm.liked.empty")}
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

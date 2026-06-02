import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import { IconPlayCircle } from "../../../components/icons";
import { PageHeader } from "../../../components/page/PageHeader";
import { createApiClient } from "../../../shared/api/client";
import { useTranslation } from "../../../shared/i18n";
import { NaiveP } from "../../../shared/ui/naive";
import { OnlineLikedPlaylistDetailRoute } from "../details/OnlineLikedPlaylistDetailRoute";
import type { OnlinePlaylistSummary } from "../ncmPlaylistSummary";
import { getNcmLikedPlaylistCached } from "../ncmPlaylistSummaryCache";
import {
  createErrorMessageReader,
  createLoginStatusText,
  type FeedbackSetter
} from "../shared/feedback";
import type { PlaybackController } from "../shared/playback";
import type { NcmProfile, OnlineTrackItem } from "../shared/types";
import { createDetailViewReporter, type OnlineDetailViewReporterProps } from "../shared/detailViewReporter";
import { useDetailNavigation } from "../shared/useDetailNavigation";

const api = createApiClient();

export interface LikedSongsModeProps extends OnlineDetailViewReporterProps {
  loginProfile: Accessor<NcmProfile | null>;
  isCheckingLogin: Accessor<boolean>;
  isLoginBusy: Accessor<boolean>;
  onBeginLogin: () => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  setFeedback: FeedbackSetter;
  playback: PlaybackController;
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

  const readErrorMessage = createErrorMessageReader(t);

  const loginStatusText = createLoginStatusText(t, props.isCheckingLogin, props.loginProfile);
  const hasDetailView = () => detailNav.selectedPlaylist() !== null;

  createDetailViewReporter(hasDetailView, props.onDetailViewChange);

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
        const likedPlaylist = await getNcmLikedPlaylistCached(api, profile.userId);
        if (cancelled) return;
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
      <Show when={props.loginProfile() !== null} fallback={<NaiveP class="panel-note">{t("ncm.empty.loginRequired")}</NaiveP>}>
        <Show
          when={detailNav.selectedPlaylist()}
          fallback={
            <NaiveP class="panel-note">
              {isLoadingLikedPlaylist() || detailNav.isLoadingPlaylistTracks()
                ? t("ncm.playlist.loading")
                : t("ncm.liked.empty")}
            </NaiveP>
          }
        >
          <OnlineLikedPlaylistDetailRoute
            detailNav={detailNav}
            loginProfile={props.loginProfile()}
            setFeedback={props.setFeedback}
            playback={props.playback}
            onRefresh={(playlist) => detailNav.loadPlaylistTracks(playlist, {
              limit: likedTrackLimit(playlist),
              forceRefresh: true
            })}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
          />
        </Show>
      </Show>
    </>
  );
}

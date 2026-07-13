import { For, Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import { AlbumCard } from "../../../components/AlbumCard";
import { IconPlayCircle } from "../../../components/icons";
import { PageHeader } from "../../../components/page/PageHeader";
import { PageToolbarButton } from "../../../components/page/PageToolbarButton";
import { useTranslation } from "../../../shared/i18n";
import { createApiClient } from "../../../shared/api/client";
import { useUISettings } from "../../../shared/state/useUISettings";
import { NaiveP } from "../../../shared/ui/naive";
import {
  type OnlinePlaylistSummary
} from "../ncmPlaylistSummary";
import {
  loadNcmUserPlaylistsByModeCached,
  subscribeNcmUserPlaylistGroups
} from "../ncmPlaylistSummaryCache";
import {
  createErrorMessageReader,
  type FeedbackSetter
} from "../shared/feedback";
import type { PlaybackController } from "../shared/playback";
import type { NcmProfile, OnlineTrackItem } from "../shared/types";
import type { OnlineDetailViewReporterProps } from "../shared/detailViewReporter";

export type UserPlaylistsKind = "created-playlists" | "collected-playlists";

const api = createApiClient();

export interface UserPlaylistsModeProps extends OnlineDetailViewReporterProps {
  kind: UserPlaylistsKind;
  loginProfile: Accessor<NcmProfile | null>;
  isLoginBusy: Accessor<boolean>;
  onBeginLogin: () => void;
  selectedPlaylistId: number | null;
  onSelectedPlaylistChange?: (playlistId: number | null) => void;
  onStaleSelectedPlaylist?: () => void;
  onNavigateToPlaylistDetail?: (playlist: OnlinePlaylistSummary) => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  onNavigateToMv?: (track: OnlineTrackItem) => void;
  setFeedback: FeedbackSetter;
  playback: PlaybackController;
}

export function UserPlaylistsMode(props: UserPlaylistsModeProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();

  const [userPlaylistsState, setUserPlaylistsState] = createSignal<OnlinePlaylistSummary[]>([]);
  const [isLoadingUserPlaylists, setIsLoadingUserPlaylists] = createSignal(false);

  const pageTitle = () =>
    props.kind === "created-playlists"
      ? t("ncm.title.createdPlaylists")
      : t("ncm.title.collectedPlaylists");

  const pageSubtitle = () => t("ncm.subtitle.playlists");

  const readErrorMessage = createErrorMessageReader(t);
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
    if (isLoadingUserPlaylists()) {
      return;
    }

    const playlistId = props.selectedPlaylistId ?? null;
    if (playlistId === null) {
      return;
    }

    if (!userPlaylistsState().some((item) => item.id === playlistId)) {
      props.onStaleSelectedPlaylist?.();
    }
  });

  const playlistEmptyText = () => t("ncm.empty.noUserPlaylists");

  return (
    <>
      <PageHeader
        title={pageTitle()}
        meta={
          <span class="page-header-meta-line">{pageSubtitle()}</span>
        }
        actions={
          <Show when={props.loginProfile() === null}>
            <PageToolbarButton
              variant="primary"
              onClick={props.onBeginLogin}
              disabled={props.isLoginBusy()}
            >
              <IconPlayCircle />
              {t("ncm.login.action.qr")}
            </PageToolbarButton>
          </Show>
        }
      />
      <Show when={props.loginProfile() !== null} fallback={<NaiveP class="panel-note">{t("ncm.empty.loginRequired")}</NaiveP>}>
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
                    active={(props.selectedPlaylistId ?? null) === playlist.id}
                    onClick={() => props.onNavigateToPlaylistDetail?.(playlist)}
                  />
                )}
              </For>
            </div>
          </section>
        </Show>
      </Show>
    </>
  );
}

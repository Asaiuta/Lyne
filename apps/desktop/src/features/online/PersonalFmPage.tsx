import { Show, createMemo, createSignal, onMount, createEffect, onCleanup } from "solid-js";
import {
  IconAlbum,
  IconArtist,
  IconMusic,
  IconPause,
  IconPlay,
  IconRefresh,
  IconSkipNext,
  IconSparkle,
  IconThumbDown
} from "../../components/icons";
import type { MediaContextAction } from "../../components/media/mediaContextActions";
import { SImage } from "../../components/SImage";
import { createApiClient } from "../../shared/api/client";
import { usePlayback } from "../../app/PlaybackContext";
import { useTranslation } from "../../shared/i18n";
import { useNcmAccount } from "../../shared/state/NcmAccountContext";
import { useUISettings } from "../../shared/state/useUISettings";
import { NaiveH2, NaiveH3 } from "../../shared/ui/naive";
import { NcmMediaList } from "./NcmMediaList";
import {
  createErrorMessageReader,
  createFeedbackSetter,
  createInitialFeedback
} from "./shared/feedback";
import { createPlaybackController } from "./shared/playback";
import type { Feedback, OnlineTrackItem } from "./shared/types";

const api = createApiClient();

interface PersonalFmPageProps {
  onRequireNcmLogin: () => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  reloadTick?: number;
}

export function PersonalFmPage(props: PersonalFmPageProps) {
  const { t } = useTranslation();
  const accountStore = useNcmAccount();
  const uiSettings = useUISettings();
  const playbackContext = usePlayback();
  const readErrorMessage = createErrorMessageReader(t);
  const [tracks, setTracks] = createSignal<OnlineTrackItem[]>([]);
  const [isLoading, setIsLoading] = createSignal<boolean>(false);
  const [feedback, setFeedback] = createSignal<Feedback>(createInitialFeedback(t));

  const setRawFeedback = createFeedbackSetter(setFeedback);
  const playback = createPlaybackController({
    api,
    t,
    onRegisterPlayback: playbackContext.registerNcmPlayback,
    onStateRefresh: playbackContext.refreshState,
    setFeedback: setRawFeedback
  });

  const activeAccount = createMemo(() => accountStore.activeAccount());
  const currentFmTrack = createMemo<OnlineTrackItem | null>(() => {
    const songId = playbackContext.currentSongId();
    return songId === null ? tracks()[0] ?? null : tracks().find((item) => item.songId === songId) ?? tracks()[0] ?? null;
  });
  const isCurrentFmTrackPlaying = createMemo<boolean>(() => {
    const songId = playbackContext.currentSongId();
    return playbackContext.isPlaying() && songId !== null && tracks().some((item) => item.songId === songId);
  });
  const coverUrl = createMemo<string | null>(() => currentFmTrack()?.artworkUrl ?? tracks()[0]?.artworkUrl ?? null);
  const heroTitle = createMemo<string>(() => currentFmTrack()?.title ?? t("ncm.fm.preview.title"));
  const heroArtist = createMemo<string>(() => currentFmTrack()?.artist ?? t("ncm.fm.preview.artist"));
  const heroAlbum = createMemo<string>(() => currentFmTrack()?.album ?? t("ncm.fm.preview.album"));

  let loadVersion = 0;
  let activeLoadAbortController: AbortController | null = null;

  const loadTracks = async (options: { autoplay?: boolean } = {}) => {
    if (!activeAccount()) {
      activeLoadAbortController?.abort();
      setTracks([]);
      return;
    }
    const requestVersion = loadVersion + 1;
    loadVersion = requestVersion;
    activeLoadAbortController?.abort();
    const abortController = new AbortController();
    activeLoadAbortController = abortController;
    setIsLoading(true);
    try {
      const nextTracks = await api.listNcmPersonalFmTracks({ signal: abortController.signal });
      if (requestVersion !== loadVersion || abortController.signal.aborted) return;
      setTracks(nextTracks);
      if (nextTracks.length === 0) {
        setRawFeedback("error", t("ncm.fm.feedback.empty"));
        return;
      }
      setRawFeedback("neutral", t("ncm.feedback.initial"));
      if (options.autoplay === true) {
        await playTracks(nextTracks);
      }
    } catch (error) {
      if (requestVersion !== loadVersion || abortController.signal.aborted) return;
      setRawFeedback("error", readErrorMessage(error));
      setTracks([]);
    } finally {
      if (requestVersion === loadVersion) {
        activeLoadAbortController = null;
        setIsLoading(false);
      }
    }
  };

  const playTracks = async (items: readonly OnlineTrackItem[] = tracks()) => {
    if (items.length === 0) {
      setRawFeedback("error", t("ncm.fm.feedback.empty"));
      return;
    }
    await playback.playAll(items);
    setRawFeedback("success", t("ncm.fm.feedback.started", { count: items.length }));
  };

  const handlePlayPause = async () => {
    if (isCurrentFmTrackPlaying()) {
      await playbackContext.pause();
      return;
    }
    if (tracks().length === 0) {
      await loadTracks({ autoplay: true });
      return;
    }
    await playTracks();
  };

  const handleNextBatch = async () => {
    await loadTracks({ autoplay: true });
  };

  const dislikeTrack = async (item: OnlineTrackItem | null) => {
    if (!item) return;
    try {
      await api.trashNcmPersonalFmTrack(item.songId);
      setTracks((current) => current.filter((track) => track.songId !== item.songId));
      setRawFeedback("success", t("ncm.fm.feedback.disliked"));
      if (playbackContext.currentSongId() === item.songId) {
        await playbackContext.skipNext();
      }
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    }
  };

  const handleContextAction = (action: MediaContextAction, item: OnlineTrackItem) => {
    if (action === "daily-dislike") {
      void dislikeTrack(item);
      return;
    }
    if (action === "song-wiki") {
      props.onNavigateToSongWiki?.(item);
      return;
    }
    if (action === "mv") {
      // TODO: Navigate to MV page
      return;
    }
    if (action === "copy-song-info") {
      // TODO: Implement copy song info
      return;
    }
  };

  onMount(() => {
    void loadTracks();
  });

  onCleanup(() => {
    loadVersion += 1;
    activeLoadAbortController?.abort();
  });

  createEffect((prev: number | undefined) => {
    const tick = props.reloadTick ?? 0;
    if (prev !== undefined && tick !== prev) {
      void loadTracks({ autoplay: true });
    }
    return tick;
  });

  return (
    <section class="panel panel-page online-page personal-fm-page">
      <Show
        when={activeAccount()}
        fallback={
          <section class="online-login-card">
            <div class="status-stack">
              <strong>{t("ncm.fm.title")}</strong>
              <span class="status-line">{t("ncm.radio.loginRequired")}</span>
            </div>
            <button type="button" class="primary-button" onClick={props.onRequireNcmLogin}>
              {t("ncm.login.action.qr")}
            </button>
          </section>
        }
      >
        <div class="personal-fm-shell">
          <section class={`personal-fm-hero${uiSettings.hiddenCovers.personalFM ? " is-cover-hidden" : ""}`}>
            <Show when={!uiSettings.hiddenCovers.personalFM}>
              <div class="personal-fm-cover-stack" aria-hidden="true">
                <Show when={coverUrl()} fallback={<span><IconSparkle /></span>}>
                  {(image) => (
                    <>
                      <SImage
                        src={image()}
                        alt=""
                        class="personal-fm-cover-blur"
                        observeVisibility={false}
                        shape="circle"
                        aspect="square"
                        ariaHidden="true"
                      />
                      <SImage
                        src={image()}
                        alt=""
                        class="personal-fm-cover-main"
                        observeVisibility={false}
                        shape="circle"
                        aspect="square"
                      />
                    </>
                  )}
                </Show>
              </div>
            </Show>
            <div class="personal-fm-copy">
              <NaiveH2>{heroTitle()}</NaiveH2>
              <div class="personal-fm-meta">
                <span>
                  <IconArtist />
                  <span>{heroArtist()}</span>
                </span>
                <span>
                  <IconAlbum />
                  <span>{heroAlbum()}</span>
                </span>
              </div>
              <div class="personal-fm-actions">
                <button
                  type="button"
                  class="primary-button personal-fm-play"
                  onClick={() => void handlePlayPause()}
                  disabled={isLoading()}
                >
                  <Show when={isCurrentFmTrackPlaying()} fallback={<IconPlay />}>
                    <IconPause />
                  </Show>
                  <span>{isCurrentFmTrackPlaying() ? t("player.aria.pause") : t("player.aria.play")}</span>
                </button>
                <button
                  type="button"
                  class="ghost-button personal-fm-icon-button"
                  onClick={() => void handleNextBatch()}
                  disabled={isLoading()}
                  aria-label={t("player.aria.next")}
                  title={t("player.aria.next")}
                >
                  <IconSkipNext />
                </button>
                <button
                  type="button"
                  class="ghost-button personal-fm-icon-button"
                  onClick={() => void dislikeTrack(currentFmTrack())}
                  disabled={isLoading() || currentFmTrack() === null}
                  aria-label={t("ncm.fm.aria.dislike")}
                  title={t("ncm.fm.aria.dislike")}
                >
                  <IconThumbDown />
                </button>
                <button
                  type="button"
                  class="ghost-button personal-fm-icon-button"
                  onClick={() => void loadTracks()}
                  disabled={isLoading()}
                  aria-label={t("ncm.cloud.refresh")}
                  title={t("ncm.cloud.refresh")}
                >
                  <IconRefresh />
                </button>
              </div>
              <span class="personal-fm-eyebrow">
                <IconMusic />
                {t("ncm.fm.title")}
              </span>
            </div>
          </section>

          <section class="personal-fm-list">
            <div class="song-wiki-section-title">
              <NaiveH3>{t("ncm.fm.queue")}</NaiveH3>
            </div>
            <NcmMediaList
              items={tracks()}
              rowHeight={74}
              currentSourcePath={playbackContext.currentTrackPath()}
              currentSongId={playbackContext.currentSongId()}
              isPlayingNow={playbackContext.isPlaying()}
              onPlay={(item) => void playback.playOnlineTrack(item)}
              onDoubleClick={(item) => void playback.playOnlineTrack(item)}
              onEnqueue={(item) => void playback.enqueueOnlineTrack(item)}
              onContextAction={handleContextAction}
              contextActions={[
                "play",
                "enqueue",
                "add-to-playlist",
                "mv",
                "view-comments",
                "daily-dislike",
                "search",
                "copy-name",
                "copy-id",
                "copy-song-info",
                "share-link",
                "music-tag-editor",
                "song-wiki"
              ]}
              isLoading={isLoading()}
              emptyState={<div class="panel-note">{isLoading() ? t("ncm.radio.loading") : t("ncm.fm.feedback.empty")}</div>}
            />
          </section>

          <Show when={feedback().message && feedback().message !== t("ncm.feedback.initial")}>
            <div class={feedback().tone === "error" ? "personal-fm-feedback status-error" : "personal-fm-feedback status-line"}>
              {feedback().message}
            </div>
          </Show>
        </div>
      </Show>
    </section>
  );
}

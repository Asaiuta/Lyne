import { Show, createMemo, createSignal, onMount, createEffect } from "solid-js";
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
import { MediaList, type MediaContextAction } from "../../components/media/MediaList";
import { createApiClient } from "../../shared/api/client";
import { useTranslation } from "../../shared/i18n";
import { useNcmAccount } from "../../shared/state/NcmAccountContext";
import { useUISettings } from "../../shared/state/useUISettings";
import type { NcmTrackReference } from "./ncmPlayback";
import {
  createErrorMessageReader,
  createFeedbackSetter,
  createInitialFeedback
} from "./shared/feedback";
import { createPlaybackController } from "./shared/playback";
import type { Feedback, OnlineTrackItem } from "./shared/types";

const api = createApiClient();

interface PersonalFmPageProps {
  onStateRefresh: (expectedPath?: string | null) => Promise<void>;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
  onPlay: () => Promise<void>;
  onPause: () => Promise<void>;
  onSkipNext: () => Promise<void> | undefined;
  onRegisterPlayback: (track: NcmTrackReference) => void;
  onRequireNcmLogin: () => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  reloadTick?: number;
}

export function PersonalFmPage(props: PersonalFmPageProps) {
  const { t } = useTranslation();
  const accountStore = useNcmAccount();
  const uiSettings = useUISettings();
  const readErrorMessage = createErrorMessageReader(t);
  const [tracks, setTracks] = createSignal<OnlineTrackItem[]>([]);
  const [isLoading, setIsLoading] = createSignal<boolean>(false);
  const [feedback, setFeedback] = createSignal<Feedback>(createInitialFeedback(t));

  const setRawFeedback = createFeedbackSetter(setFeedback);
  const playback = createPlaybackController({
    api,
    t,
    onRegisterPlayback: props.onRegisterPlayback,
    onStateRefresh: props.onStateRefresh,
    setFeedback: setRawFeedback
  });

  const activeAccount = createMemo(() => accountStore.activeAccount());
  const currentFmTrack = createMemo<OnlineTrackItem | null>(() => {
    const songId = props.currentSongId;
    return songId === null ? tracks()[0] ?? null : tracks().find((item) => item.songId === songId) ?? tracks()[0] ?? null;
  });
  const coverUrl = createMemo<string | null>(() => currentFmTrack()?.artworkUrl ?? tracks()[0]?.artworkUrl ?? null);
  const heroTitle = createMemo<string>(() => currentFmTrack()?.title ?? t("ncm.fm.preview.title"));
  const heroArtist = createMemo<string>(() => currentFmTrack()?.artist ?? t("ncm.fm.preview.artist"));
  const heroAlbum = createMemo<string>(() => currentFmTrack()?.album ?? t("ncm.fm.preview.album"));

  const loadTracks = async (options: { autoplay?: boolean } = {}) => {
    if (!activeAccount()) {
      setTracks([]);
      return;
    }
    setIsLoading(true);
    try {
      const nextTracks = await api.listNcmPersonalFmTracks();
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
      setRawFeedback("error", readErrorMessage(error));
      setTracks([]);
    } finally {
      setIsLoading(false);
    }
  };

  const playTracks = async (items: readonly OnlineTrackItem[] = tracks()) => {
    const [first, ...rest] = items;
    if (!first) {
      setRawFeedback("error", t("ncm.fm.feedback.empty"));
      return;
    }
    await playback.playOnlineTrack(first);
    for (const item of rest) {
      await playback.enqueueOnlineTrack(item);
    }
    setRawFeedback("success", t("ncm.fm.feedback.started", { count: items.length }));
  };

  const handlePlayPause = async () => {
    if (props.isPlaying && props.currentSongId !== null && tracks().some((item) => item.songId === props.currentSongId)) {
      await props.onPause();
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
      if (props.currentSongId === item.songId) {
        await props.onSkipNext();
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
    }
  };

  onMount(() => {
    void loadTracks();
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
                      <img class="personal-fm-cover-blur" src={image()} alt="" />
                      <img class="personal-fm-cover-main" src={image()} alt="" />
                    </>
                  )}
                </Show>
              </div>
            </Show>
            <div class="personal-fm-copy">
              <h2>{heroTitle()}</h2>
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
                  <Show when={props.isPlaying && props.currentSongId !== null && tracks().some((item) => item.songId === props.currentSongId)} fallback={<IconPlay />}>
                    <IconPause />
                  </Show>
                  <span>{props.isPlaying ? t("player.aria.pause") : t("player.aria.play")}</span>
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
              <h3>{t("ncm.fm.queue")}</h3>
            </div>
            <MediaList
              items={tracks()}
              currentSourcePath={props.currentTrackPath}
              currentSongId={props.currentSongId}
              isPlayingNow={props.isPlaying}
              onPlay={(item) => void playback.playOnlineTrack(item)}
              onDoubleClick={(item) => void playback.playOnlineTrack(item)}
              onEnqueue={(item) => void playback.enqueueOnlineTrack(item)}
              onContextAction={handleContextAction}
              contextActions={[
                "play",
                "enqueue",
                "daily-dislike",
                "search",
                "copy-name",
                "copy-id",
                "share-link",
                "song-wiki",
                "view-comments"
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

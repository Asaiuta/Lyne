import { Show, createEffect, createMemo, createSignal, onMount } from "solid-js";
import { createApiClient } from "../../shared/api/client";
import { ncmSongPageUrl } from "../../shared/api/ncm/urls";
import type { PlaybackHistoryEntry } from "../../shared/api/types";
import { useTranslation } from "../../shared/i18n";
import type { TranslationKey } from "../../shared/i18n";
import { IconDelete, IconPlayCircle } from "../../components/icons";
import { MediaList, type MediaContextAction, type MediaListItem } from "../../components/media/MediaList";
import { resolveArtworkUrl } from "../../shared/ui/artwork";
import type { NcmTrackReference } from "../online/ncmPlayback";
import { createPlaybackController } from "../online/shared/playback";
import type { Feedback as OnlineFeedback, OnlineTrackItem } from "../online/shared/types";

const api = createApiClient();
const HISTORY_LIMIT = 500;

interface HistoryPageProps {
  refreshVersion: number;
  onStateRefresh: (expectedPath?: string | null) => Promise<void>;
  currentTrackPath: string | null;
  currentMediaId: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
  onRegisterPlayback: (track: NcmTrackReference) => void;
}

interface Feedback {
  tone: "neutral" | "success" | "error";
  message: string;
}

type HistorySongItem = MediaListItem & {
  source_path: string;
  playbackPath: string;
  ncm_source_page_url: string | null;
  eventAtEpochSecs: number;
};

const displayNameFromSourcePath = (sourcePath: string): string => {
  const normalized = sourcePath
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\/i, "")
    .replace(/\\/g, "/");
  const trimmed = normalized.replace(/\/+$/, "");
  return trimmed.split("/").filter(Boolean).pop() ?? sourcePath;
};

const toHistorySongItems = (entries: PlaybackHistoryEntry[]): HistorySongItem[] => {
  const seen = new Set<string>();
  return entries.reduce<HistorySongItem[]>((items, entry) => {
    const identity = entry.ncm_song_id ? `ncm:${entry.ncm_song_id}` : entry.source_path;
    if (!entry.source_path || seen.has(identity)) {
      return items;
    }
    seen.add(identity);
    items.push({
      id: identity,
      media_id: entry.media_id,
      source_path: entry.ncm_song_id
        ? entry.ncm_source_page_url ?? ncmSongPageUrl(entry.ncm_song_id)
        : entry.source_path,
      playbackPath: entry.source_path,
      ncm_source_page_url: entry.ncm_source_page_url,
      title: entry.title ?? displayNameFromSourcePath(entry.source_path),
      artist: entry.artist,
      album: entry.album,
      duration_secs: entry.duration_secs,
      songId: entry.ncm_song_id ?? undefined,
      size_bytes: null,
      artworkUrl: resolveArtworkUrl({
        externalArtworkUrl: entry.external_artwork_url,
        mediaId: entry.media_id,
        hasCoverArt: entry.has_cover_art,
        urls: api
      }),
      eventAtEpochSecs: entry.event_at_epoch_secs
    });
    return items;
  }, []);
};

const toOnlineTrackItem = (item: HistorySongItem): OnlineTrackItem | null => {
  if (!item.songId) {
    return null;
  }
  return {
    ...item,
    source_path: item.ncm_source_page_url ?? ncmSongPageUrl(item.songId),
    songId: item.songId
  };
};

export function HistoryPage(props: HistoryPageProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = createSignal<PlaybackHistoryEntry[]>([]);
  const [isFetching, setIsFetching] = createSignal<boolean>(false);
  const [isSubmitting, setIsSubmitting] = createSignal<boolean>(false);
  const [feedbackKey, setFeedbackKey] = createSignal<TranslationKey | null>("history.feedback.initial");
  const [feedback, setFeedback] = createSignal<Feedback>({
    tone: "neutral",
    message: t("history.feedback.initial")
  });
  let lastSeenRefreshVersion: number | null = null;

  const readErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : t("common.error.requestFailed");

  const setOnlineFeedback = (tone: OnlineFeedback["tone"], message: string) => {
    setFeedbackKey(null);
    setFeedback({ tone, message });
  };

  const onlinePlayback = createPlaybackController({
    api,
    t,
    onRegisterPlayback: props.onRegisterPlayback,
    onStateRefresh: props.onStateRefresh,
    setFeedback: setOnlineFeedback
  });

  createEffect(() => {
    const key = feedbackKey();
    if (key) {
      setFeedback((current) => ({ ...current, message: t(key) }));
    }
  });

  const setKeyedFeedback = (tone: Feedback["tone"], key: TranslationKey) => {
    setFeedbackKey(key);
    setFeedback({ tone, message: t(key) });
  };

  const setRawFeedback = (tone: Feedback["tone"], message: string) => {
    setFeedbackKey(null);
    setFeedback({ tone, message });
  };

  const refresh = async () => {
    setIsFetching(true);
    try {
      const list = await api.getPlaybackHistory(HISTORY_LIMIT);
      setEntries(list);
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsFetching(false);
    }
  };

  onMount(() => {
    void refresh();
  });

  createEffect(() => {
    const refreshVersion = props.refreshVersion;
    if (lastSeenRefreshVersion === null) {
      lastSeenRefreshVersion = refreshVersion;
      return;
    }
    if (refreshVersion === lastSeenRefreshVersion) {
      return;
    }
    lastSeenRefreshVersion = refreshVersion;
    void refresh();
  });

  const historySongs = createMemo<HistorySongItem[]>(() => toHistorySongItems(entries()));

  const playHistoryItem = async (item: HistorySongItem) => {
    const onlineItem = toOnlineTrackItem(item);
    if (onlineItem) {
      await onlinePlayback.playOnlineTrack(onlineItem);
      return;
    }
    await api.load(item.playbackPath, { autoplay: true });
    await props.onStateRefresh(item.playbackPath);
  };

  const enqueueHistoryItem = async (item: HistorySongItem) => {
    const onlineItem = toOnlineTrackItem(item);
    if (onlineItem) {
      await onlinePlayback.enqueueOnlineTrack(onlineItem);
      return;
    }
    await api.enqueueTrack(item.playbackPath);
  };

  const handlePlay = async (item: HistorySongItem) => {
    setIsSubmitting(true);
    setKeyedFeedback("neutral", "history.feedback.initial");
    try {
      await playHistoryItem(item);
      setKeyedFeedback("neutral", "history.feedback.initial");
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEnqueue = async (item: HistorySongItem) => {
    setIsSubmitting(true);
    setKeyedFeedback("neutral", "history.feedback.initial");
    try {
      await enqueueHistoryItem(item);
      setKeyedFeedback("neutral", "history.feedback.initial");
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePlayAll = async () => {
    const songs = historySongs();
    const first = songs[0];
    if (!first) return;
    setIsSubmitting(true);
    setKeyedFeedback("neutral", "history.feedback.initial");
    try {
      await playHistoryItem(first);
      for (const item of songs.slice(1)) {
        await enqueueHistoryItem(item);
      }
      setKeyedFeedback("neutral", "history.feedback.initial");
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleContextAction = (action: MediaContextAction) => {
    if (action === "copy-name") {
      setKeyedFeedback("success", "media.copyName.success");
    } else if (action === "copy-path") {
      setKeyedFeedback("success", "media.copy.success");
    }
  };

  const isBusy = () => isFetching() || isSubmitting();

  return (
    <section class="panel panel-history panel-page">
      <header class="history-page-head">
        <div class="history-page-title">
          <h1>{t("history.title")}</h1>
          <span class="history-page-size">{t("history.subtitle", { count: historySongs().length })}</span>
        </div>
        <div class="history-page-menu">
          <button
            type="button"
            class="primary-button page-action history-page-play"
            onClick={() => void handlePlayAll()}
            disabled={historySongs().length === 0 || isBusy()}
          >
            <IconPlayCircle />
            <span>{t("history.action.play")}</span>
          </button>
          <button
            type="button"
            class="ghost-button page-action history-page-clear"
            disabled
            title={t("history.action.clearUnavailable")}
          >
            <IconDelete />
            <span>{t("history.action.clear")}</span>
          </button>
        </div>
      </header>

      <div class="history-page-list">
        <Show when={historySongs().length > 0} fallback={<div class="history-page-empty status-line">{t("history.empty")}</div>}>
          <MediaList
            items={historySongs()}
            currentSourcePath={props.currentTrackPath}
            currentMediaId={props.currentMediaId}
            currentSongId={props.currentSongId}
            isPlayingNow={props.isPlaying}
            onPlay={(item) => void handlePlay(item)}
            onEnqueue={(item) => void handleEnqueue(item)}
            onContextAction={handleContextAction}
            isLoading={isFetching()}
            emptyState={t("history.empty")}
            hideSize
          />
        </Show>
      </div>

      <Show when={feedback().message && feedback().message !== t("history.feedback.initial")}>
        <div class={feedback().tone === "error" ? "history-page-feedback status-error" : "history-page-feedback status-line"}>{feedback().message}</div>
      </Show>
    </section>
  );
}

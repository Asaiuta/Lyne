import { Show, createEffect, createMemo, createSignal, onMount } from "solid-js";
import { createApiClient } from "../../shared/api/client";
import type { PlaybackHistoryEntry } from "../../shared/api/types";
import { useTranslation } from "../../shared/i18n";
import type { TranslationKey } from "../../shared/i18n";
import { IconDelete, IconPlayCircle } from "../../components/icons";
import { MediaList, type MediaContextAction, type MediaListItem } from "../../components/media/MediaList";

const api = createApiClient();
const HISTORY_LIMIT = 500;

interface HistoryPageProps {
  onStateRefresh: () => Promise<void>;
}

interface Feedback {
  tone: "neutral" | "success" | "error";
  message: string;
}

type HistorySongItem = MediaListItem & {
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
    if (!entry.source_path || seen.has(entry.source_path)) {
      return items;
    }
    seen.add(entry.source_path);
    items.push({
      id: entry.media_id ?? entry.source_path,
      source_path: entry.source_path,
      title: displayNameFromSourcePath(entry.source_path),
      artist: null,
      album: null,
      duration_secs: null,
      size_bytes: null,
      artworkUrl: entry.media_id ? api.getCoverArtUrl(entry.media_id) : null,
      eventAtEpochSecs: entry.event_at_epoch_secs
    });
    return items;
  }, []);
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

  const readErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : t("common.error.requestFailed");

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

  const historySongs = createMemo<HistorySongItem[]>(() => toHistorySongItems(entries()));

  const handlePlay = async (item: HistorySongItem) => {
    setIsSubmitting(true);
    setRawFeedback("neutral", t("history.feedback.playing", { path: item.source_path }));
    try {
      await api.load(item.source_path, { autoplay: true });
      await props.onStateRefresh();
      setRawFeedback("success", t("history.feedback.reloaded", { path: item.source_path }));
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
    setRawFeedback("neutral", t("history.feedback.playing", { path: first.source_path }));
    try {
      await api.replaceQueue(songs.map((item) => item.source_path));
      await api.playFromQueue();
      await props.onStateRefresh();
      setKeyedFeedback("success", "history.feedback.started");
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleContextAction = (action: MediaContextAction) => {
    if (action === "copy-path") {
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
            onPlay={(item) => void handlePlay(item)}
            onEnqueue={(item) => void api.enqueueTrack(item.source_path)}
            onContextAction={handleContextAction}
            isLoading={isFetching()}
            emptyState={t("history.empty")}
            hideSize
          />
        </Show>
      </div>

      <div class={feedback().tone === "error" ? "history-page-feedback status-error" : "history-page-feedback status-line"}>{feedback().message}</div>
    </section>
  );
}

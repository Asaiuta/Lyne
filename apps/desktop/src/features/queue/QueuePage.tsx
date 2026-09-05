import { For, Show, createEffect, createSignal, onMount } from "solid-js";
import { IconDeleteFilled, IconPlayFilled } from "../../components/icons";
import { createApiClient } from "../../shared/api/client";
import type { QueueEntry, QueueStatus, RequestState } from "../../shared/api/types";
import { useTranslation } from "../../shared/i18n";
import { NaiveButton, NaiveInput } from "../../shared/ui/naive";
import type { TranslationKey } from "../../shared/i18n";
import "../../shared/styles/pages/queue.css";

const api = createApiClient();

interface QueuePageProps {
  currentTrackPath: string | null;
  preloadRequested: boolean;
  onPreloadCleared: () => void;
  onStateRefresh: (expectedPath?: string | null) => Promise<void>;
}

interface QueueFeedback {
  tone: "neutral" | "success" | "error";
  message: string;
}

const trimPath = (value: string) => value.trim();

export function QueuePage(props: QueuePageProps) {
  const { t } = useTranslation();
  const [loadPath, setLoadPath] = createSignal("");
  const [nextPath, setNextPath] = createSignal("");
  const [enqueuePath, setEnqueuePath] = createSignal("");
  const [entries, setEntries] = createSignal<QueueEntry[]>([]);
  const [queueState, setQueueState] = createSignal<RequestState<QueueStatus>>({ status: "idle" });
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [feedbackKey, setFeedbackKey] = createSignal<TranslationKey | null>("queue.feedback.initial");
  const [feedback, setFeedback] = createSignal<QueueFeedback>({
    tone: "neutral",
    message: t("queue.feedback.initial")
  });

  const readErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : t("common.error.requestFailed");

  createEffect(() => {
    const key = feedbackKey();
    if (key) {
      setFeedback((current) => ({ ...current, message: t(key) }));
    }
  });

  const refresh = async () => {
    try {
      const [list, status] = await Promise.all([api.getPersistentQueue(), api.getQueueStatus()]);
      setEntries(list);
      setQueueState({ status: "success", data: status });
    } catch (error) {
      setQueueState({ status: "error", error: readErrorMessage(error) });
    }
  };

  onMount(() => {
    setQueueState((current) => (current.status === "idle" ? { status: "loading" } : current));
    void refresh();
  });

  createEffect(() => {
    props.currentTrackPath;
    props.preloadRequested;
    void refresh();
  });

  const setKeyedFeedback = (tone: QueueFeedback["tone"], key: TranslationKey) => {
    setFeedbackKey(key);
    setFeedback({ tone, message: t(key) });
  };

  const setRawFeedback = (tone: QueueFeedback["tone"], message: string) => {
    setFeedbackKey(null);
    setFeedback({ tone, message });
  };

  const runWithFeedback = async (
    action: () => Promise<void>,
    pendingKey: TranslationKey,
    successKey: TranslationKey
  ) => {
    setIsSubmitting(true);
    setKeyedFeedback("neutral", pendingKey);
    try {
      await action();
      setKeyedFeedback("success", successKey);
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLoad = async () => {
    const path = trimPath(loadPath());
    if (!path) {
      setKeyedFeedback("error", "queue.error.emptyLoad");
      return;
    }
    await runWithFeedback(
      async () => {
        await api.load(path);
        await Promise.all([props.onStateRefresh(path), refresh()]);
        setLoadPath("");
      },
      "queue.feedback.loadingTrack",
      "queue.feedback.loaded"
    );
  };

  const handleQueueNext = async () => {
    const path = trimPath(nextPath());
    if (!path) {
      setKeyedFeedback("error", "queue.error.emptyNext");
      return;
    }
    await runWithFeedback(
      async () => {
        await api.queueNext(path);
        await refresh();
        setNextPath("");
      },
      "queue.feedback.preparing",
      "queue.feedback.nextQueued"
    );
  };

  const handleCancelPreload = async () => {
    await runWithFeedback(
      async () => {
        await api.cancelPreload();
        props.onPreloadCleared();
        await refresh();
      },
      "queue.feedback.canceling",
      "queue.feedback.canceled"
    );
  };

  const handleEnqueue = async () => {
    const path = trimPath(enqueuePath());
    if (!path) {
      setKeyedFeedback("error", "queue.error.emptyEnqueue");
      return;
    }
    await runWithFeedback(
      async () => {
        const list = await api.enqueueTrack(path);
        setEntries(list);
        setEnqueuePath("");
      },
      "queue.feedback.adding",
      "queue.feedback.added"
    );
  };

  const handlePlay = async (entry: QueueEntry) => {
    setIsSubmitting(true);
    setKeyedFeedback("neutral", "queue.feedback.initial");
    try {
      await api.playFromQueue({ entryId: entry.entry_id, sourcePath: entry.source_path });
      await Promise.all([props.onStateRefresh(entry.source_path), refresh()]);
      setKeyedFeedback("neutral", "queue.feedback.initial");
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemove = async (entry: QueueEntry) => {
    await runWithFeedback(
      async () => {
        const list = await api.removeQueueEntry(entry.entry_id);
        setEntries(list);
      },
      "queue.feedback.removing",
      "queue.feedback.removed"
    );
  };

  const handleClear = async () => {
    if (entries().length === 0) return;
    await runWithFeedback(
      async () => {
        await api.clearPersistentQueue();
        setEntries([]);
      },
      "queue.feedback.clearing",
      "queue.feedback.cleared"
    );
  };

  const resolvedCurrentTrack = () =>
    queueData()?.current_track_path ?? props.currentTrackPath;
  const queueData = () => {
    const state = queueState();
    return state.status === "success" ? state.data : null;
  };
  const queueError = () => {
    const state = queueState();
    return state.status === "error" ? state.error : null;
  };
  const pendingTrack = () => queueData()?.pending_track_path ?? null;
  const canCancel = () =>
    queueData()
      ? Boolean(
          queueData()?.needs_preload ||
          queueData()?.pending_ready ||
          queueData()?.is_preload_canceling
        )
      : props.preloadRequested;
  const countKey = (): TranslationKey =>
    entries().length === 1 ? "queue.persistent.count.one" : "queue.persistent.count.other";
  const preloadStatusKey = (): TranslationKey =>
    queueData()?.pending_ready
      ? "queue.status.preload.ready"
      : queueData()?.needs_preload
        ? "queue.status.preload.requested"
        : "queue.status.preload.idle";

  return (
    <section class="panel panel-queue">
      <div class="panel-header">
        <h2>{t("queue.title")}</h2>
        <span class="panel-meta">{t("queue.subtitle")}</span>
      </div>

      <div class="queue-form-group">
        <label class="field-label" for="load-path">{t("queue.load.label")}</label>
        <NaiveInput
          id="load-path"
          class="queue-input"
          type="text"
          value={loadPath()}
          onUpdateValue={setLoadPath}
          placeholder={t("queue.load.placeholder")}
        />
        <NaiveButton
          class="queue-command-button"
          round
          secondary
          size="medium"
          strong
          onClick={() => void handleLoad()}
          disabled={isSubmitting()}
        >
          {t("queue.load.button")}
        </NaiveButton>
      </div>

      <div class="queue-form-group">
        <label class="field-label" for="next-path">{t("queue.next.label")}</label>
        <NaiveInput
          id="next-path"
          class="queue-input"
          type="text"
          value={nextPath()}
          onUpdateValue={setNextPath}
          placeholder={t("queue.next.placeholder")}
        />
        <div class="button-row">
          <NaiveButton
            class="queue-command-button"
            round
            secondary
            size="medium"
            strong
            onClick={() => void handleQueueNext()}
            disabled={isSubmitting()}
          >
            {t("queue.next.button")}
          </NaiveButton>
          <NaiveButton
            class="queue-command-button"
            round
            secondary
            size="medium"
            strong
            onClick={() => void handleCancelPreload()}
            disabled={isSubmitting() || !canCancel()}
          >
            {t("queue.cancel.button")}
          </NaiveButton>
        </div>
      </div>

      <div class="queue-form-group">
        <div class="panel-subheader">
          <span class="field-label">{t("queue.persistent.title")}</span>
          <span class="panel-meta">{t(countKey(), { count: entries().length })}</span>
        </div>
        <Show when={entries().length > 0} fallback={<div class="status-line">{t("queue.persistent.empty")}</div>}>
          <ul class="queue-list">
            <For each={entries()}>
              {(entry) => {
                const isCurrent = () => entry.source_path === resolvedCurrentTrack();
                return (
                  <li class={`queue-item${isCurrent() ? " is-current" : ""}`}>
                    <div class="queue-item-meta">
                      <span class="queue-item-path" title={entry.source_path}>{entry.source_path}</span>
                      <span class="queue-item-status">
                        {isCurrent() ? t("queue.entry.nowPlaying") : entry.status}
                      </span>
                    </div>
                    <div class="queue-item-actions">
                      <NaiveButton
                        ariaLabel={t("queue.entry.play")}
                        title={t("queue.entry.play")}
                        class="queue-row-action"
                        round
                        secondary
                        size="medium"
                        onClick={() => void handlePlay(entry)}
                        disabled={isSubmitting() || isCurrent()}
                      >
                        <IconPlayFilled />
                      </NaiveButton>
                      <NaiveButton
                        ariaLabel={t("queue.entry.remove")}
                        title={t("queue.entry.remove")}
                        class="queue-row-action"
                        round
                        secondary
                        size="medium"
                        onClick={() => void handleRemove(entry)}
                        disabled={isSubmitting()}
                      >
                        <IconDeleteFilled />
                      </NaiveButton>
                    </div>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
        <NaiveInput
          class="queue-input"
          type="text"
          value={enqueuePath()}
          onUpdateValue={setEnqueuePath}
          placeholder={t("queue.persistent.placeholder")}
        />
        <div class="button-row">
          <NaiveButton
            class="queue-command-button"
            round
            secondary
            size="medium"
            strong
            onClick={() => void handleEnqueue()}
            disabled={isSubmitting()}
          >
            {t("queue.persistent.add")}
          </NaiveButton>
          <NaiveButton
            class="queue-command-button"
            round
            secondary
            size="medium"
            strong
            onClick={() => void handleClear()}
            disabled={isSubmitting() || entries().length === 0}
          >
            {t("queue.persistent.clear")}
          </NaiveButton>
        </div>
      </div>

      <div class="status-stack">
        <div class="status-line">
          {resolvedCurrentTrack()
            ? t("queue.status.current", { path: resolvedCurrentTrack() ?? "" })
            : t("queue.status.noTrack")}
        </div>
        <Show when={feedback().message && feedback().message !== t("queue.feedback.initial")}>
          <div class={feedback().tone === "error" ? "status-error" : "status-line"}>{feedback().message}</div>
        </Show>
        <Show when={queueError()}>
          {(error) => <div class="status-error">{error()}</div>}
        </Show>
        <Show when={queueData()}>
          <div class="status-line">
            {pendingTrack() ? t("queue.status.next", { path: pendingTrack() ?? "" }) : t("queue.status.noNext")}
          </div>
          <div class="status-line">{t(preloadStatusKey())}</div>
          <Show when={queueData()?.is_preload_canceling}>
            <div class="status-line">{t("queue.status.cancelSignal")}</div>
          </Show>
        </Show>
      </div>
    </section>
  );
}

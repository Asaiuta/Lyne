import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { IconClose, IconDelete, IconMusic, IconRefresh } from "../../components/icons";
import {
  displayNameFromSourcePath,
  isMediaListItemCurrent,
  type MediaListItem
} from "../../components/media/MediaList";
import type { QueueEntry } from "../../shared/api/types";
import { useTranslation } from "../../shared/i18n";
import {
  QUEUE_ROW_HEIGHT_PX,
  resolveQueueVisibleRange
} from "./queueVirtualization";

interface QueueDrawerProps {
  open: boolean;
  entries: readonly QueueEntry[];
  currentTrackPath: string | null;
  currentMediaId: string | null;
  onClose: () => void;
  onPlayEntry: (entryId: number) => Promise<void>;
  onRemoveEntry: (entryId: number) => Promise<void>;
  onClear: () => Promise<void>;
}

interface QueueDrawerItem extends MediaListItem {
  entryId: number;
  positionIndex: number;
  status: string;
  addedAtEpochSecs: number;
  updatedAtEpochSecs: number;
}

const firstText = (...values: Array<string | null | undefined>): string | null => {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
};

const adaptQueueEntry = (entry: QueueEntry): QueueDrawerItem => ({
  id: String(entry.entry_id),
  entryId: entry.entry_id,
  positionIndex: entry.position_index,
  source_path: entry.source_path,
  media_id: entry.media_id,
  title: entry.title,
  artist: entry.artist,
  album: entry.album,
  duration_secs: entry.duration_secs,
  artworkUrl: entry.external_artwork_url,
  status: entry.status,
  addedAtEpochSecs: entry.added_at_epoch_secs,
  updatedAtEpochSecs: entry.updated_at_epoch_secs
});

const queueItemTitle = (item: QueueDrawerItem): string =>
  firstText(item.title, displayNameFromSourcePath(item.source_path ?? item.id)) ?? item.source_path ?? item.id;

const queueItemDetail = (item: QueueDrawerItem): string => {
  const parts = [item.artist, item.album].map((value) => value?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(" - ") : item.source_path ?? item.status;
};

export function QueueDrawer(props: QueueDrawerProps) {
  const { t } = useTranslation();
  const [busyEntryId, setBusyEntryId] = createSignal<number | null>(null);
  const [clearing, setClearing] = createSignal(false);
  const [scrollTop, setScrollTop] = createSignal<number>(0);
  const [viewportHeight, setViewportHeight] = createSignal<number>(0);
  let bodyRef: HTMLDivElement | undefined;
  let scrollFrame = 0;
  let pendingScrollTop = 0;

  const commitPendingScrollTop = () => {
    scrollFrame = 0;
    setScrollTop((current) => (current === pendingScrollTop ? current : pendingScrollTop));
  };

  const scheduleScrollTop = (nextScrollTop: number) => {
    pendingScrollTop = nextScrollTop;
    if (scrollFrame !== 0) return;
    if (typeof window === "undefined") {
      commitPendingScrollTop();
      return;
    }
    scrollFrame = window.requestAnimationFrame(commitPendingScrollTop);
  };

  createEffect(() => {
    if (!props.open || typeof window === "undefined") return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
  });

  createEffect(() => {
    if (!props.open || typeof window === "undefined") return;
    const updateViewportHeight = () => setViewportHeight(bodyRef?.clientHeight ?? 0);
    queueMicrotask(updateViewportHeight);
    window.addEventListener("resize", updateViewportHeight);
    onCleanup(() => window.removeEventListener("resize", updateViewportHeight));
  });

  onCleanup(() => {
    if (scrollFrame !== 0 && typeof window !== "undefined") {
      window.cancelAnimationFrame(scrollFrame);
    }
  });

  const queueItems = createMemo<QueueDrawerItem[]>(() => props.entries.map(adaptQueueEntry));
  const countKey = createMemo(() =>
    props.entries.length === 1 ? "queue.persistent.count.one" : "queue.persistent.count.other"
  );
  const currentIndex = createMemo(() =>
    queueItems().findIndex((item) =>
      isMediaListItemCurrent(item, {
        sourcePath: props.currentTrackPath,
        mediaId: props.currentMediaId
      })
    )
  );
  const isCurrent = (item: QueueDrawerItem) =>
    isMediaListItemCurrent(item, {
      sourcePath: props.currentTrackPath,
      mediaId: props.currentMediaId
    });

  const virtualRange = createMemo((previous: { start: number; end: number }) => {
    const next = resolveQueueVisibleRange({
      totalItems: queueItems().length,
      scrollTop: scrollTop(),
      viewportHeight: viewportHeight()
    });
    return previous.start === next.start && previous.end === next.end ? previous : next;
  }, { start: 0, end: 0 });
  const visibleEntries = createMemo(() => {
    const range = virtualRange();
    return queueItems().slice(range.start, range.end).map((item, offset) => ({
      item,
      index: range.start + offset
    }));
  });
  const listHeight = () => `${queueItems().length * QUEUE_ROW_HEIGHT_PX}px`;

  const scrollToCurrent = () => {
    const index = currentIndex();
    if (index < 0) return;
    bodyRef?.scrollTo({
      top: Math.max(0, index * QUEUE_ROW_HEIGHT_PX - (viewportHeight() - QUEUE_ROW_HEIGHT_PX) / 2),
      behavior: "smooth"
    });
  };

  const handlePlay = async (item: QueueDrawerItem) => {
    if (isCurrent(item)) return;
    setBusyEntryId(item.entryId);
    try {
      await props.onPlayEntry(item.entryId);
      props.onClose();
    } finally {
      setBusyEntryId(null);
    }
  };

  const handleRemove = async (item: QueueDrawerItem) => {
    setBusyEntryId(item.entryId);
    try {
      await props.onRemoveEntry(item.entryId);
    } finally {
      setBusyEntryId(null);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      await props.onClear();
    } finally {
      setClearing(false);
    }
  };

  return (
    <Show when={props.open && typeof document !== "undefined"}>
      <Portal mount={document.body}>
        <div
          class="queue-drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) props.onClose();
          }}
        >
          <aside class="queue-drawer" role="dialog" aria-modal="true" aria-label={t("queue.title")}>
            <header class="queue-drawer-header">
              <div class="queue-drawer-title-group">
                <h2>{t("queue.title")}</h2>
                <span>{t(countKey(), { count: props.entries.length })}</span>
              </div>
              <button
                type="button"
                class="queue-drawer-icon-button"
                onClick={props.onClose}
                aria-label={t("queue.drawer.close")}
                title={t("queue.drawer.close")}
              >
                <IconClose />
              </button>
            </header>

            <div
              ref={bodyRef}
              class="queue-drawer-body"
              onScroll={(event) => scheduleScrollTop(event.currentTarget.scrollTop)}
            >
              <Show
                when={props.entries.length > 0}
                fallback={<div class="queue-drawer-empty">{t("queue.persistent.empty")}</div>}
              >
                <ul class="queue-drawer-list" style={{ height: listHeight() }}>
                  <For each={visibleEntries()}>
                    {(item) => {
                      const queueItem = item.item;
                      const index = () => item.index;
                      const active = () => isCurrent(queueItem);
                      const disabled = () => busyEntryId() !== null || clearing();
                      return (
                        <li style={{ transform: `translateY(${index() * QUEUE_ROW_HEIGHT_PX}px)` }}>
                          <div class={`queue-drawer-item${active() ? " is-current" : ""}`}>
                            <button
                              type="button"
                              class="queue-drawer-item-main"
                              onClick={() => void handlePlay(queueItem)}
                              disabled={disabled() || active()}
                            >
                              <span class={`queue-drawer-index${index() + 1 > 9999 ? " is-big" : ""}`}>
                                <Show when={active()} fallback={index() + 1}>
                                  <IconMusic />
                                </Show>
                              </span>
                              <span class="queue-drawer-copy">
                                <span class="queue-drawer-name" title={queueItem.source_path ?? queueItemTitle(queueItem)}>
                                  {queueItemTitle(queueItem)}
                                </span>
                                <span class="queue-drawer-path" title={queueItem.source_path ?? queueItemDetail(queueItem)}>
                                  {queueItemDetail(queueItem)}
                                </span>
                              </span>
                            </button>
                            <button
                              type="button"
                              class="queue-drawer-remove"
                              onClick={() => void handleRemove(queueItem)}
                              disabled={disabled()}
                              aria-label={t("queue.entry.remove")}
                              title={t("queue.entry.remove")}
                            >
                              <IconDelete />
                            </button>
                          </div>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </Show>
            </div>

            <footer class="queue-drawer-footer">
              <button
                type="button"
                class="queue-drawer-footer-button"
                onClick={() => void handleClear()}
                disabled={props.entries.length === 0 || clearing()}
              >
                <IconDelete />
                <span>{t("queue.persistent.clear")}</span>
              </button>
              <button
                type="button"
                class="queue-drawer-footer-button"
                onClick={scrollToCurrent}
                disabled={currentIndex() < 0}
              >
                <IconRefresh />
                <span>{t("queue.drawer.current")}</span>
              </button>
            </footer>
          </aside>
        </div>
      </Portal>
    </Show>
  );
}

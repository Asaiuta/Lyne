import { Show, createEffect, createMemo, createSignal, onMount } from "solid-js";
import { createApiClient } from "../../shared/api/client";
import type { LibraryRoot, MediaItem } from "../../shared/api/types";
import { useTranslation } from "../../shared/i18n";
import type { TranslationKey } from "../../shared/i18n";
import { useUISearch } from "../../shared/state/UISearchContext";
import {
  IconAlbum,
  IconArtist,
  IconFolder,
  IconList,
  IconMusic,
  IconPlayCircle,
  IconRefresh,
  IconSearch,
  IconStorage
} from "../../components/icons";
import { MediaList, type MediaContextAction, type MediaListItem } from "../../components/media/MediaList";
import { SegmentedTabs } from "../../components/page/SegmentedTabs";
import { ManageRootsModal } from "./ManageRootsModal";

const api = createApiClient();
const PAGE_SIZE = 100;

type LibraryTab = "songs" | "artists" | "albums" | "folders";

interface LibraryPageProps {
  onStateRefresh: () => Promise<void>;
  currentTrackPath: string | null;
  isPlaying: boolean;
}

interface Feedback {
  tone: "neutral" | "success" | "error";
  message: string;
}

type LibraryListItem = MediaItem & MediaListItem;

const adaptItem = (item: MediaItem): LibraryListItem => ({
  ...item,
  id: item.media_id,
  artworkUrl: item.has_cover_art ? api.getCoverArtUrl(item.media_id) : null
});

const matchesSearch = (item: MediaItem, query: string) => {
  if (!query) return true;
  const haystacks = [item.title, item.artist, item.album, item.source_path];
  return haystacks.some((value) => value?.toLowerCase().includes(query));
};

export function LibraryPage(props: LibraryPageProps) {
  const { t } = useTranslation();
  const { query: globalQuery } = useUISearch();
  const [roots, setRoots] = createSignal<LibraryRoot[]>([]);
  const [items, setItems] = createSignal<MediaItem[]>([]);
  const [limit, setLimit] = createSignal(PAGE_SIZE);
  const [reachedEnd, setReachedEnd] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<LibraryTab>("songs");
  const [localQuery, setLocalQuery] = createSignal<string>("");
  const [manageOpen, setManageOpen] = createSignal(false);
  const [isFetching, setIsFetching] = createSignal(false);
  const [isScanning, setIsScanning] = createSignal(false);
  const [feedbackKey, setFeedbackKey] = createSignal<TranslationKey | null>("library.feedback.initial");
  const [feedback, setFeedback] = createSignal<Feedback>({
    tone: "neutral",
    message: t("library.feedback.initial")
  });

  const readErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : t("common.error.requestFailed");

  const formatScanTimestamp = (epochSecs: number | null) => {
    if (epochSecs === null) return t("library.timestamp.never");
    const date = new Date(epochSecs * 1000);
    if (Number.isNaN(date.getTime())) return t("library.timestamp.never");
    return date.toLocaleString();
  };

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

  const refreshRoots = async () => {
    try {
      const list = await api.getLibraryRoots();
      setRoots(list);
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    }
  };

  const fetchItems = async (nextLimit = limit()) => {
    setIsFetching(true);
    try {
      const list = await api.getMediaItems(nextLimit);
      setItems(list);
      setReachedEnd(list.length < nextLimit);
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsFetching(false);
    }
  };

  onMount(() => {
    void refreshRoots();
    void fetchItems();
  });

  createEffect(() => {
    const nextLimit = limit();
    void fetchItems(nextLimit);
  });

  const adaptedItems = createMemo(() => items().map(adaptItem));
  const activeQueries = createMemo<string[]>(() =>
    [globalQuery(), localQuery()]
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0)
  );
  const filteredItems = createMemo(() => {
    const queries = activeQueries();
    if (queries.length === 0) return adaptedItems();
    return adaptedItems().filter((item) => queries.every((query) => matchesSearch(item, query)));
  });

  const handleScan = async (path: string, display: string) => {
    if (!path) {
      setKeyedFeedback("error", "library.feedback.emptyPath");
      return;
    }
    setIsScanning(true);
    setRawFeedback("neutral", t("library.feedback.scanning", { path }));
    try {
      const result = await api.scanLibraryRoot(path, display ? display : undefined);
      await Promise.all([refreshRoots(), fetchItems(limit())]);
      setRawFeedback("success", t("library.feedback.scanComplete", {
        scanned: result.scanned_files,
        indexed: result.indexed_files
      }));
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsScanning(false);
    }
  };

  const handleRescan = async (root: LibraryRoot) => {
    setIsScanning(true);
    setRawFeedback("neutral", t("library.feedback.rescanning", { name: root.display_name }));
    try {
      const result = await api.scanLibraryRoot(root.source_path, root.display_name, root.source_key ?? undefined);
      await Promise.all([refreshRoots(), fetchItems(limit())]);
      setRawFeedback("success", t("library.feedback.rescanComplete", {
        scanned: result.scanned_files,
        indexed: result.indexed_files
      }));
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsScanning(false);
    }
  };

  const handleLoadMore = () => {
    if (reachedEnd() || isFetching()) return;
    setLimit((prev) => prev + PAGE_SIZE);
  };

  const handlePlay = async (item: LibraryListItem) => {
    try {
      await api.load(item.source_path, { autoplay: true });
      await props.onStateRefresh();
      setRawFeedback("success", t("library.feedback.playing", { title: item.title ?? item.source_path }));
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    }
  };

  const handleEnqueue = async (item: LibraryListItem) => {
    try {
      await api.enqueueTrack(item.source_path);
      setRawFeedback("success", t("library.feedback.added", { title: item.title ?? item.source_path }));
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    }
  };

  const handleContextAction = (action: MediaContextAction) => {
    if (action === "copy-path") {
      setRawFeedback("success", t("media.copy.success"));
    }
  };

  const handlePlayAll = () => {
    const first = filteredItems()[0];
    if (first) void handlePlay(first);
  };

  const handleRefresh = () => {
    void refreshRoots();
    void fetchItems(limit());
  };

  const subtitleKey = (): TranslationKey =>
    reachedEnd() ? "library.subtitle.complete" : "library.subtitle.more";

  const visibleSizeGb = createMemo<number>(() => {
    const totalBytes = filteredItems().reduce((total, item) => total + (item.size_bytes ?? 0), 0);
    return Number((totalBytes / (1024 * 1024 * 1024)).toFixed(2));
  });

  const tabItems = () => [
    { value: "songs", label: t("library.tabs.songs") },
    { value: "artists", label: t("library.tabs.artists") },
    { value: "albums", label: t("library.tabs.albums") },
    { value: "folders", label: t("library.tabs.folders") }
  ];

  return (
    <section class="panel panel-library panel-page">
      <header class="local-library-head">
        <div class="local-library-title">
          <h1>{t("library.title")}</h1>
          <div class="local-library-status" aria-label={t(subtitleKey(), { count: filteredItems().length })}>
            <span class="local-library-status-item">
              <IconMusic />
              <span>{t("library.status.songCount", { count: filteredItems().length })}</span>
            </span>
            <span class="local-library-status-item">
              <IconStorage />
              <span>{visibleSizeGb().toFixed(2)} GB</span>
            </span>
          </div>
        </div>
        <div class="local-library-menu">
          <div class="local-library-menu-left">
            <button type="button" class="primary-button page-action local-library-play" onClick={handlePlayAll} disabled={filteredItems().length === 0 || isFetching()}>
              <IconPlayCircle />
              <span>{t("library.action.playAll")}</span>
            </button>
            <button type="button" class="ghost-button page-action local-library-circle" onClick={handleRefresh} disabled={isFetching() || isScanning()} aria-label={t("library.action.refresh")} title={t("library.action.refresh")}>
              <IconRefresh />
            </button>
            <button type="button" class="ghost-button page-action local-library-circle" onClick={() => setManageOpen(true)} aria-label={t("library.action.manageRoots")} title={t("library.action.manageRoots")}>
              <IconList />
            </button>
          </div>
          <div class="local-library-menu-right">
            <label class="local-library-search">
              <IconSearch />
              <input
                value={localQuery()}
                placeholder={t("library.tracks.fuzzySearch")}
                autocomplete="off"
                onInput={(event) => setLocalQuery(event.currentTarget.value)}
              />
            </label>
            <SegmentedTabs
              value={activeTab()}
              onChange={(next) => setActiveTab(next as LibraryTab)}
              items={tabItems()}
              ariaLabel={t("library.title")}
            />
          </div>
        </div>
      </header>

      <div class="local-library-router">
        <Show when={activeTab() === "songs"}>
          <Show
            when={filteredItems().length > 0}
            fallback={<div class="status-line">{items().length === 0 ? t("library.tracks.emptyAll") : t("library.tracks.emptyFilter")}</div>}
          >
            <MediaList
              items={filteredItems()}
              currentSourcePath={props.currentTrackPath}
              isPlayingNow={props.isPlaying}
              onPlay={(item) => void handlePlay(item)}
              onEnqueue={(item) => void handleEnqueue(item)}
              onContextAction={handleContextAction}
              isLoading={isFetching()}
              emptyState={t("library.tracks.emptyAll")}
            />
          </Show>
          <Show when={!reachedEnd()}>
            <div class="button-row">
              <button type="button" class="ghost-button" onClick={handleLoadMore} disabled={isFetching()}>
                {isFetching() ? t("library.tracks.loading") : t("library.tracks.loadMore")}
              </button>
            </div>
          </Show>
        </Show>

        <Show when={activeTab() === "artists"}>
          <div class="empty-tab" role="status">
            <span class="empty-tab-icon" aria-hidden="true"><IconArtist /></span>
            <span>{t("library.tabs.placeholder.artists")}</span>
          </div>
        </Show>
        <Show when={activeTab() === "albums"}>
          <div class="empty-tab" role="status">
            <span class="empty-tab-icon" aria-hidden="true"><IconAlbum /></span>
            <span>{t("library.tabs.placeholder.albums")}</span>
          </div>
        </Show>
        <Show when={activeTab() === "folders"}>
          <div class="empty-tab" role="status">
            <span class="empty-tab-icon" aria-hidden="true"><IconFolder /></span>
            <span>{t("library.tabs.placeholder.folders")}</span>
          </div>
        </Show>
      </div>

      <div class={feedback().tone === "error" ? "local-library-feedback status-error" : "local-library-feedback status-line"}>{feedback().message}</div>

      <ManageRootsModal
        open={manageOpen()}
        onClose={() => setManageOpen(false)}
        roots={roots()}
        isScanning={isScanning()}
        onAddRoot={handleScan}
        onRescan={handleRescan}
        formatScanTimestamp={formatScanTimestamp}
      />
    </section>
  );
}

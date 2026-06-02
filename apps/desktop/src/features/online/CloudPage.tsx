import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { MediaContextAction } from "../../components/media/mediaContextActions";
import {
  IconCloud,
  IconList,
  IconMusic,
  IconPlay,
  IconRefresh,
  IconSearch,
  IconStorage
} from "../../components/icons";
import { createApiClient } from "../../shared/api/client";
import { usePlayback } from "../../app/PlaybackContext";
import { useTranslation } from "../../shared/i18n";
import { useNcmAccount } from "../../shared/state/NcmAccountContext";
import { NaiveDropdown, NaiveH2, type NaiveDropdownOption } from "../../shared/ui/naive";
import { CloudMatchModal } from "./details/CloudMatchModal";
import { DailySongsBatchModal } from "./details/DailySongsBatchModal";
import {
  createErrorMessageReader,
  createFeedbackSetter,
  createInitialFeedback
} from "./shared/feedback";
import { createPlaybackController } from "./shared/playback";
import type { Feedback, OnlineTrackItem } from "./shared/types";
import { NcmMediaList } from "./NcmMediaList";

const api = createApiClient();
const CLOUD_PAGE_LIMIT = 500;
const BYTES_PER_GB = 1024 ** 3;
const CLOUD_SEARCH_DEBOUNCE_MS = 300;

interface CloudCacheSnapshot {
  userId: number;
  tracks: OnlineTrackItem[];
  totalCount: number;
  sizeBytes: number;
  maxSizeBytes: number;
}

interface CloudLoadOptions {
  force?: boolean;
}

let cloudCache: CloudCacheSnapshot | null = null;

interface CloudPageProps {
  onRequireNcmLogin: () => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
}

const formatGb = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0";
  return (bytes / BYTES_PER_GB).toFixed(bytes >= BYTES_PER_GB * 10 ? 0 : 2);
};

const normalizeSearchText = (value: string | null | undefined): string =>
  value?.trim().toLowerCase() ?? "";

const fuzzyTextScore = (value: string | null | undefined, query: string): number => {
  const text = normalizeSearchText(value);
  if (!text || !query) return 0;
  const exactIndex = text.indexOf(query);
  if (exactIndex >= 0) {
    return 100 - Math.min(exactIndex, 40);
  }

  let score = 0;
  let cursor = 0;
  let previousMatch = -1;
  for (const char of query) {
    const matchIndex = text.indexOf(char, cursor);
    if (matchIndex < 0) return 0;
    score += previousMatch >= 0 && matchIndex === previousMatch + 1 ? 12 : 5;
    previousMatch = matchIndex;
    cursor = matchIndex + 1;
  }
  return score;
};

const cloudFuzzyScore = (item: OnlineTrackItem, query: string): number => {
  const fields = [
    { value: item.title, weight: 0.5 },
    { value: item.artist, weight: 0.3 },
    { value: item.album, weight: 0.15 },
    { value: item.source_path, weight: 0.05 }
  ];
  return fields.reduce((score, field) => score + fuzzyTextScore(field.value, query) * field.weight, 0);
};

const fuzzySearchCloudTracks = (
  items: readonly OnlineTrackItem[],
  query: string
): OnlineTrackItem[] =>
  items
    .map((item, index) => ({ item, index, score: cloudFuzzyScore(item, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);

export function CloudPage(props: CloudPageProps) {
  const { t } = useTranslation();
  const accountStore = useNcmAccount();
  const playbackContext = usePlayback();
  const [tracks, setTracks] = createSignal<OnlineTrackItem[]>([]);
  const [totalCount, setTotalCount] = createSignal<number>(0);
  const [sizeBytes, setSizeBytes] = createSignal<number>(0);
  const [maxSizeBytes, setMaxSizeBytes] = createSignal<number>(0);
  const [loadedCount, setLoadedCount] = createSignal<number>(0);
  const [searchValue, setSearchValue] = createSignal<string>("");
  const [debouncedSearchValue, setDebouncedSearchValue] = createSignal<string>("");
  const [isLoading, setIsLoading] = createSignal<boolean>(false);
  const [menuOpen, setMenuOpen] = createSignal<boolean>(false);
  const [batchOpen, setBatchOpen] = createSignal<boolean>(false);
  const [matchItem, setMatchItem] = createSignal<OnlineTrackItem | null>(null);
  const [feedback, setFeedback] = createSignal<Feedback>(createInitialFeedback(t));

  const setRawFeedback = createFeedbackSetter(setFeedback);
  const readErrorMessage = createErrorMessageReader(t);

  const playback = createPlaybackController({
    api,
    t,
    onRegisterPlayback: playbackContext.registerNcmPlayback,
    onStateRefresh: playbackContext.refreshState,
    setFeedback: setRawFeedback
  });

  const activeAccount = createMemo(() => accountStore.activeAccount());
  const showInitialLoading = createMemo<boolean>(() => tracks().length === 0 && isLoading());
  let cloudRequestVersion = 0;
  const storagePercent = createMemo<number>(() => {
    const max = maxSizeBytes();
    if (max <= 0) return 0;
    return Math.min(100, Math.max(0, (sizeBytes() / max) * 100));
  });
  const filteredTracks = createMemo<OnlineTrackItem[]>(() => {
    const query = debouncedSearchValue().trim().toLowerCase();
    if (!query) return tracks();
    return fuzzySearchCloudTracks(tracks(), query);
  });
  const loadingProgress = createMemo<{ loaded: number; total: number }>(() => {
    const loaded = isLoading() ? loadedCount() : tracks().length;
    return {
      loaded,
      total: totalCount() || loaded
    };
  });

  const resetCloudState = () => {
    setTracks([]);
    setTotalCount(0);
    setSizeBytes(0);
    setMaxSizeBytes(0);
    setLoadedCount(0);
  };

  const applyCloudSnapshot = (snapshot: CloudCacheSnapshot) => {
    setTracks(snapshot.tracks);
    setTotalCount(snapshot.totalCount);
    setSizeBytes(snapshot.sizeBytes);
    setMaxSizeBytes(snapshot.maxSizeBytes);
    setLoadedCount(snapshot.tracks.length);
  };

  const loadCloudTracks = async (
    isCancelled: () => boolean = () => false,
    options: CloudLoadOptions = {}
  ) => {
    const account = activeAccount();
    if (!account) {
      cloudRequestVersion += 1;
      setIsLoading(false);
      resetCloudState();
      return;
    }

    const cached = cloudCache?.userId === account.userId ? cloudCache : null;
    if (!options.force && cached !== null) {
      applyCloudSnapshot(cached);
      setRawFeedback("neutral", t("ncm.feedback.initial"));
      return;
    }

    const requestVersion = cloudRequestVersion + 1;
    cloudRequestVersion = requestVersion;
    const isStale = () => isCancelled() || requestVersion !== cloudRequestVersion;

    if (cached === null) {
      resetCloudState();
    } else {
      setLoadedCount(0);
    }
    setIsLoading(true);
    try {
      const allTracks: OnlineTrackItem[] = [];
      let offset = 0;
      let count = 0;
      let nextSizeBytes = cached?.sizeBytes ?? 0;
      let nextMaxSizeBytes = cached?.maxSizeBytes ?? 0;
      do {
        const page = await api.listNcmCloudTracks({
          limit: CLOUD_PAGE_LIMIT,
          offset
        });
        if (isStale()) return;
        count = page.count;
        nextSizeBytes = page.sizeBytes;
        nextMaxSizeBytes = page.maxSizeBytes;
        setTotalCount(page.count);
        setSizeBytes(page.sizeBytes);
        setMaxSizeBytes(page.maxSizeBytes);
        allTracks.push(...page.tracks);
        setLoadedCount(allTracks.length);
        offset += CLOUD_PAGE_LIMIT;
        if (page.tracks.length === 0) break;
      } while (offset < count);
      if (isStale()) return;

      const nextSnapshot: CloudCacheSnapshot = {
        userId: account.userId,
        tracks: allTracks,
        totalCount: count || allTracks.length,
        sizeBytes: nextSizeBytes,
        maxSizeBytes: nextMaxSizeBytes
      };
      cloudCache = nextSnapshot;
      applyCloudSnapshot(nextSnapshot);
      setRawFeedback("neutral", t("ncm.feedback.initial"));
    } catch (error) {
      if (isStale()) return;
      if (cached === null) {
        resetCloudState();
      } else {
        applyCloudSnapshot(cached);
      }
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      if (!isStale()) setIsLoading(false);
    }
  };

  createEffect(() => {
    const account = activeAccount();
    if (!account) {
      cloudRequestVersion += 1;
      setIsLoading(false);
      resetCloudState();
      return;
    }
    let cancelled = false;
    void loadCloudTracks(() => cancelled);
    onCleanup(() => {
      cancelled = true;
    });
  });

  const menuItems = (): readonly NaiveDropdownOption[] => [
    { key: "batch", label: t("ncm.cloud.batch"), icon: <IconList /> }
  ];

  const handleMenuSelect = (key: string) => {
    if (key === "batch") {
      setBatchOpen(true);
    }
  };

  createEffect(() => {
    const nextSearchValue = searchValue().trim();
    const timer = setTimeout(() => setDebouncedSearchValue(nextSearchValue), CLOUD_SEARCH_DEBOUNCE_MS);
    onCleanup(() => clearTimeout(timer));
  });

  const playTrackContext = async (item: OnlineTrackItem, contextItems: readonly OnlineTrackItem[]) => {
    const startIndex = contextItems.findIndex((candidate) => candidate.id === item.id);
    if (startIndex >= 0) {
      await playback.playAll(contextItems, { startIndex });
      return;
    }
    await playback.playOnlineTrack(item);
  };

  const playAll = async () => {
    await playback.playAll(filteredTracks());
  };

  const handleTrackDoubleClick = (item: OnlineTrackItem) => {
    if (debouncedSearchValue().trim()) {
      void playback.queueNextOnlineTrack(item);
      return;
    }
    void playTrackContext(item, filteredTracks());
  };

  const deleteCloudTrack = async (item: OnlineTrackItem) => {
    const title = item.title ?? String(item.songId);
    if (typeof window !== "undefined" && !window.confirm(t("ncm.cloud.deleteConfirm", { title }))) {
      return;
    }
    try {
      await api.deleteNcmCloudTrack(item.songId);
      setTracks((current) => current.filter((track) => track.songId !== item.songId));
      setLoadedCount((count) => Math.max(0, count - 1));
      setTotalCount((count) => Math.max(0, count - 1));
      const cache = cloudCache;
      if (cache !== null && cache.userId === activeAccount()?.userId) {
        cloudCache = {
          ...cache,
          tracks: cache.tracks.filter((track) => track.songId !== item.songId),
          totalCount: Math.max(0, cache.totalCount - 1)
        };
      }
      setRawFeedback("success", t("ncm.cloud.deleted", { title }));
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    }
  };

  const handleContextAction = (action: MediaContextAction, item: OnlineTrackItem) => {
    if (action === "cloud-match") {
      setMatchItem(item);
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
    if (action === "cloud-import") {
      // TODO: Implement cloud import
      return;
    }
    if (action === "download") {
      // TODO: Implement download — developer mode only
      return;
    }
    if (action === "copy-song-info") {
      // TODO: Implement copy song info
      return;
    }
    if (action === "delete-from-cloud" || action === "delete") {
      void deleteCloudTrack(item);
    }
  };

  const handleCloudMatched = async () => {
    await loadCloudTracks(() => false, { force: true });
    setRawFeedback("success", t("ncm.cloud.match.success"));
  };

  return (
    <div class="panel panel-page online-page cloud-page">
      <Show
        when={activeAccount()}
        fallback={
          <>
            <section class="cloud-title">
              <NaiveH2>{t("ncm.cloud.title")}</NaiveH2>
            </section>
            <section class="online-login-card">
              <div class="status-stack">
                <strong>{t("ncm.login.title")}</strong>
                <span class="status-line">{t("ncm.cloud.loginRequired")}</span>
              </div>
              <button type="button" class="primary-button" onClick={props.onRequireNcmLogin}>
                {t("ncm.login.action.qr")}
              </button>
            </section>
          </>
        }
      >
        <section class="cloud-title">
          <NaiveH2>{t("ncm.cloud.title")}</NaiveH2>
          <div class="cloud-status">
            <span class="cloud-status-item">
              <IconMusic />
              {t("ncm.cloud.trackCount", { count: totalCount() || tracks().length })}
            </span>
            <span class="cloud-status-item cloud-storage">
              <IconStorage />
              <span class="cloud-storage-bar" aria-hidden="true">
                <span style={{ width: `${storagePercent()}%` }} />
              </span>
              <span class="cloud-storage-text">
                {t("ncm.cloud.storage", {
                  size: formatGb(sizeBytes()),
                  max: formatGb(maxSizeBytes())
                })}
              </span>
            </span>
          </div>
        </section>

        <section class="cloud-toolbar">
          <div class="playlist-detail-menu-left">
            <button
              type="button"
              class="primary-button playlist-detail-play"
              onClick={() => void playAll()}
              disabled={isLoading() || filteredTracks().length === 0}
            >
              <IconPlay />
              {showInitialLoading()
                ? t("ncm.cloud.loadingProgress", {
                    loaded: loadingProgress().loaded,
                    total: loadingProgress().total
                  })
                : t("ncm.cloud.play")}
            </button>
            <button
              type="button"
              class="ghost-button playlist-detail-icon-button"
              onClick={() => void loadCloudTracks(() => false, { force: true })}
              disabled={isLoading()}
              title={t("ncm.cloud.refresh")}
              aria-label={t("ncm.cloud.refresh")}
            >
              <IconRefresh />
            </button>
            <NaiveDropdown
              options={menuItems()}
              triggerMode="click"
              placement="bottom-start"
              gutter={8}
              open={menuOpen()}
              onOpenChange={setMenuOpen}
              onSelect={(option) => handleMenuSelect(option.key)}
              ariaLabel={t("ncm.cloud.batch")}
            >
              <button
                type="button"
                class="ghost-button playlist-detail-icon-button"
                title={t("ncm.cloud.batch")}
                aria-label={t("ncm.cloud.batch")}
                aria-haspopup="menu"
                aria-expanded={menuOpen()}
              >
                <IconList />
              </button>
            </NaiveDropdown>
          </div>
          <Show when={tracks().length > 0}>
            <label class="playlist-detail-search cloud-search">
              <IconSearch />
              <input
                value={searchValue()}
                onInput={(event) => setSearchValue(event.currentTarget.value)}
                placeholder={t("ncm.cloud.searchPlaceholder")}
              />
            </label>
          </Show>
        </section>

        <NcmMediaList
          items={filteredTracks()}
          currentSourcePath={playbackContext.currentTrackPath()}
          currentSongId={playbackContext.currentSongId()}
          isPlayingNow={playbackContext.isPlaying()}
          onPlay={(item) => void playback.playOnlineTrack(item)}
          onDoubleClick={handleTrackDoubleClick}
          onEnqueue={(item) => void playback.enqueueOnlineTrack(item)}
          onContextAction={handleContextAction}
          contextActions={[
            "play",
            "enqueue",
            "add-to-playlist",
            "mv",
            "view-comments",
            "search",
            "copy-name",
            "copy-id",
            "copy-song-info",
            "share-link",
            "music-tag-editor",
            "cloud-import",
            "cloud-match",
            "song-wiki",
            "download",
            "delete-from-cloud"
          ]}
          deleteActionLabel={t("ncm.cloud.deleteAction")}
          isLoading={isLoading()}
          emptyState={
            <div class="online-search-empty">
              <IconCloud />
              <strong>
                {showInitialLoading()
                  ? t("ncm.cloud.loadingProgress", {
                      loaded: loadingProgress().loaded,
                      total: loadingProgress().total
                    })
                  : searchValue().trim()
                  ? t("ncm.cloud.searchEmptyTitle")
                  : t("ncm.cloud.emptyTitle")}
              </strong>
              <span>
                {showInitialLoading()
                  ? t("ncm.playlist.loading")
                  : searchValue().trim()
                  ? t("ncm.cloud.searchEmptyDescription", { query: searchValue().trim() })
                  : t("ncm.cloud.emptyDescription")}
              </span>
            </div>
          }
        />

        <DailySongsBatchModal
          open={batchOpen()}
          title={t("library.batch.title")}
          items={tracks()}
          loginProfile={activeAccount()}
          playback={playback}
          setFeedback={setRawFeedback}
          onClose={() => setBatchOpen(false)}
        />

        <CloudMatchModal
          open={matchItem() !== null}
          item={matchItem()}
          userId={activeAccount()?.userId ?? null}
          setFeedback={setRawFeedback}
          onClose={() => setMatchItem(null)}
          onMatched={handleCloudMatched}
        />

        <Show when={feedback().message && feedback().message !== t("ncm.feedback.initial")}>
          <section class="online-login-card">
            <div class="status-stack">
              <strong>{t("ncm.cloud.title")}</strong>
              <span class={feedback().tone === "error" ? "status-error" : "status-line"}>
                {feedback().message}
              </span>
            </div>
          </section>
        </Show>
      </Show>
    </div>
  );
}

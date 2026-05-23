import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { ContextMenu, type ContextMenuItem } from "../../components/media/ContextMenu";
import { MediaList, type MediaContextAction } from "../../components/media/MediaList";
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
import { useTranslation } from "../../shared/i18n";
import { useNcmAccount } from "../../shared/state/NcmAccountContext";
import { CloudMatchModal } from "./details/CloudMatchModal";
import { DailySongsBatchModal } from "./details/DailySongsBatchModal";
import type { NcmTrackReference } from "./ncmPlayback";
import {
  createErrorMessageReader,
  createFeedbackSetter,
  createInitialFeedback
} from "./shared/feedback";
import { createPlaybackController } from "./shared/playback";
import type { Feedback, OnlineTrackItem } from "./shared/types";

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

let cloudCache: CloudCacheSnapshot | null = null;

interface CloudPageProps {
  onStateRefresh: (expectedPath?: string | null) => Promise<void>;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
  onRegisterPlayback: (track: NcmTrackReference) => void;
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
  const [tracks, setTracks] = createSignal<OnlineTrackItem[]>([]);
  const [totalCount, setTotalCount] = createSignal<number>(0);
  const [sizeBytes, setSizeBytes] = createSignal<number>(0);
  const [maxSizeBytes, setMaxSizeBytes] = createSignal<number>(0);
  const [searchValue, setSearchValue] = createSignal<string>("");
  const [debouncedSearchValue, setDebouncedSearchValue] = createSignal<string>("");
  const [isLoading, setIsLoading] = createSignal<boolean>(false);
  const [menuOpen, setMenuOpen] = createSignal<boolean>(false);
  const [menuPosition, setMenuPosition] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });
  const [batchOpen, setBatchOpen] = createSignal<boolean>(false);
  const [matchItem, setMatchItem] = createSignal<OnlineTrackItem | null>(null);
  const [feedback, setFeedback] = createSignal<Feedback>(createInitialFeedback(t));

  const setRawFeedback = createFeedbackSetter(setFeedback);
  const readErrorMessage = createErrorMessageReader(t);

  const playback = createPlaybackController({
    api,
    t,
    onRegisterPlayback: props.onRegisterPlayback,
    onStateRefresh: props.onStateRefresh,
    setFeedback: setRawFeedback
  });

  const activeAccount = createMemo(() => accountStore.activeAccount());
  const showInitialLoading = createMemo<boolean>(() => tracks().length === 0 && isLoading());
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

  const loadCloudTracks = async (isCancelled: () => boolean = () => false) => {
    const account = activeAccount();
    if (!account) {
      setTracks([]);
      setTotalCount(0);
      setSizeBytes(0);
      setMaxSizeBytes(0);
      return;
    }

    setIsLoading(true);
    try {
      const allTracks: OnlineTrackItem[] = [];
      let offset = 0;
      let count = 0;
      do {
        const page = await api.listNcmCloudTracks({
          limit: CLOUD_PAGE_LIMIT,
          offset
        });
        if (isCancelled()) return;
        count = page.count;
        setTotalCount(page.count);
        setSizeBytes(page.sizeBytes);
        setMaxSizeBytes(page.maxSizeBytes);
        allTracks.push(...page.tracks);
        setTracks([...allTracks]);
        offset += CLOUD_PAGE_LIMIT;
      } while (offset < count);
      cloudCache = {
        userId: account.userId,
        tracks: allTracks,
        totalCount: count,
        sizeBytes: sizeBytes(),
        maxSizeBytes: maxSizeBytes()
      };
      setRawFeedback("neutral", t("ncm.feedback.initial"));
    } catch (error) {
      if (isCancelled()) return;
      setTracks([]);
      setTotalCount(0);
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      if (!isCancelled()) setIsLoading(false);
    }
  };

  createEffect(() => {
    const account = activeAccount();
    if (!account) {
      setTracks([]);
      setTotalCount(0);
      setSizeBytes(0);
      setMaxSizeBytes(0);
      return;
    }
    if (cloudCache?.userId === account.userId) {
      setTracks(cloudCache.tracks);
      setTotalCount(cloudCache.totalCount);
      setSizeBytes(cloudCache.sizeBytes);
      setMaxSizeBytes(cloudCache.maxSizeBytes);
    }
    let cancelled = false;
    void loadCloudTracks(() => cancelled);
    onCleanup(() => {
      cancelled = true;
    });
  });

  const menuItems = (): ContextMenuItem[] => [
    { key: "batch", label: t("ncm.cloud.batch"), icon: <IconList /> }
  ];

  const openMenu = (event: MouseEvent & { currentTarget: HTMLButtonElement }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({ x: rect.left, y: rect.bottom + 8 });
    setMenuOpen(true);
  };

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
    const [first, ...rest] = (startIndex >= 0 ? contextItems.slice(startIndex) : [item]);
    if (!first) return;
    await playback.playOnlineTrack(first);
    for (const restItem of rest) {
      await playback.enqueueOnlineTrack(restItem);
    }
  };

  const playAll = async () => {
    const [first, ...rest] = filteredTracks();
    if (!first) return;
    await playback.playOnlineTrack(first);
    for (const item of rest) {
      await playback.enqueueOnlineTrack(item);
    }
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
    if (action === "delete-from-cloud" || action === "delete") {
      void deleteCloudTrack(item);
    }
  };

  const handleCloudMatched = async () => {
    cloudCache = null;
    await loadCloudTracks();
    setRawFeedback("success", t("ncm.cloud.match.success"));
  };

  return (
    <div class="panel panel-page online-page cloud-page">
      <Show
        when={activeAccount()}
        fallback={
          <>
            <section class="cloud-title">
              <h2>{t("ncm.cloud.title")}</h2>
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
          <h2>{t("ncm.cloud.title")}</h2>
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
                    loaded: tracks().length,
                    total: totalCount()
                  })
                : t("ncm.cloud.play")}
            </button>
            <button
              type="button"
              class="ghost-button playlist-detail-icon-button"
              onClick={() => void loadCloudTracks()}
              disabled={isLoading()}
              title={t("ncm.cloud.refresh")}
              aria-label={t("ncm.cloud.refresh")}
            >
              <IconRefresh />
            </button>
            <button
              type="button"
              class="ghost-button playlist-detail-icon-button"
              onClick={openMenu}
              title={t("ncm.cloud.batch")}
              aria-label={t("ncm.cloud.batch")}
            >
              <IconList />
            </button>
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

        <ContextMenu
          open={menuOpen()}
          x={menuPosition().x}
          y={menuPosition().y}
          items={menuItems()}
          onSelect={handleMenuSelect}
          onClose={() => setMenuOpen(false)}
        />

        <MediaList
          items={filteredTracks()}
          currentSourcePath={props.currentTrackPath}
          currentSongId={props.currentSongId}
          isPlayingNow={props.isPlaying}
          onPlay={(item) => void playback.playOnlineTrack(item)}
          onDoubleClick={handleTrackDoubleClick}
          onEnqueue={(item) => void playback.enqueueOnlineTrack(item)}
          onContextAction={handleContextAction}
          contextActions={[
            "play",
            "enqueue",
            "search",
            "copy-name",
            "copy-id",
            "share-link",
            "song-wiki",
            "view-comments",
            "cloud-match",
            "delete-from-cloud"
          ]}
          deleteActionLabel={t("ncm.cloud.deleteAction")}
          isLoading={isLoading()}
          emptyState={
            <div class="online-search-empty">
              <IconCloud />
              <strong>
                {searchValue().trim()
                  ? t("ncm.cloud.searchEmptyTitle")
                  : t("ncm.cloud.emptyTitle")}
              </strong>
              <span>
                {searchValue().trim()
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

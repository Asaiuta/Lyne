import type { ActivePage } from "../ui/navigation";
import { ACTIVE_PAGES, isPlaylistPage } from "../ui/navigation";
import {
  browserUISettingsRuntime,
  persistUISetting,
  type UISettingsRuntime
} from "./uiSettingsStorage";

export const NAVIGATION_STATE_STORAGE_KEY = "ui.nav.state";
export const NAVIGATION_SCROLL_STORAGE_KEY = "ui.nav.scroll";

export type PersistedLikedCollectionTab = "playlists" | "albums" | "artists";

export interface NavigationStateSnapshot {
  readonly activePage: ActivePage;
  readonly selectedPlaylistId: number | null;
  readonly discoverTab: string;
  readonly likedCollectionTab: PersistedLikedCollectionTab;
}

export interface NavigationScrollSnapshot {
  readonly positions: Readonly<Record<string, number>>;
}

export interface NavigationPersistenceRuntime {
  readonly runtime?: UISettingsRuntime;
}

const DEFAULT_NAVIGATION_STATE: NavigationStateSnapshot = {
  activePage: "recommend",
  selectedPlaylistId: null,
  discoverTab: "playlists",
  likedCollectionTab: "playlists"
};

const VALID_ACTIVE_PAGES = new Set<ActivePage>(ACTIVE_PAGES);
const VALID_LIKED_COLLECTION_TABS = new Set<PersistedLikedCollectionTab>([
  "playlists",
  "albums",
  "artists"
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRuntime = (options?: NavigationPersistenceRuntime): UISettingsRuntime =>
  options?.runtime ?? browserUISettingsRuntime();

const reportReadError = (
  runtime: UISettingsRuntime,
  key: string,
  reason: string
): void => {
  runtime.reportReadError?.(key, reason);
};

const readStorageValue = (
  runtime: UISettingsRuntime,
  key: string
): string | null => {
  try {
    return runtime.storage.getItem(key);
  } catch {
    reportReadError(runtime, key, "storage_unavailable");
    return null;
  }
};

export const normalizeNavigationStateSnapshot = (
  value: unknown
): NavigationStateSnapshot => {
  if (!isRecord(value)) {
    return DEFAULT_NAVIGATION_STATE;
  }

  const activePage = VALID_ACTIVE_PAGES.has(value.activePage as ActivePage)
    ? (value.activePage as ActivePage)
    : DEFAULT_NAVIGATION_STATE.activePage;
  const selectedPlaylistId =
    typeof value.selectedPlaylistId === "number" &&
    Number.isInteger(value.selectedPlaylistId) &&
    value.selectedPlaylistId > 0 &&
    isPlaylistPage(activePage)
      ? value.selectedPlaylistId
      : null;
  const discoverTab =
    typeof value.discoverTab === "string" && value.discoverTab.trim().length > 0
      ? value.discoverTab
      : DEFAULT_NAVIGATION_STATE.discoverTab;
  const likedCollectionTab = VALID_LIKED_COLLECTION_TABS.has(
    value.likedCollectionTab as PersistedLikedCollectionTab
  )
    ? (value.likedCollectionTab as PersistedLikedCollectionTab)
    : DEFAULT_NAVIGATION_STATE.likedCollectionTab;

  return {
    activePage,
    selectedPlaylistId,
    discoverTab,
    likedCollectionTab
  };
};

export const readNavigationStateSnapshot = (
  options?: NavigationPersistenceRuntime
): NavigationStateSnapshot => {
  const runtime = readRuntime(options);
  const raw = readStorageValue(runtime, NAVIGATION_STATE_STORAGE_KEY);
  if (!raw) return DEFAULT_NAVIGATION_STATE;

  try {
    return normalizeNavigationStateSnapshot(JSON.parse(raw) as unknown);
  } catch {
    reportReadError(runtime, NAVIGATION_STATE_STORAGE_KEY, "invalid_json");
    return DEFAULT_NAVIGATION_STATE;
  }
};

export const persistNavigationStateSnapshot = (
  snapshot: NavigationStateSnapshot,
  options?: NavigationPersistenceRuntime
): boolean =>
  persistUISetting(
    NAVIGATION_STATE_STORAGE_KEY,
    JSON.stringify(normalizeNavigationStateSnapshot(snapshot)),
    readRuntime(options)
  );

export const readNavigationScrollPosition = (
  key: string,
  options?: NavigationPersistenceRuntime
): number => {
  if (!key) return 0;
  const runtime = readRuntime(options);
  const raw = readStorageValue(runtime, NAVIGATION_SCROLL_STORAGE_KEY);
  if (!raw) return 0;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.positions)) {
      reportReadError(runtime, NAVIGATION_SCROLL_STORAGE_KEY, "invalid_value");
      return 0;
    }
    const value = parsed.positions[key];
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : 0;
  } catch {
    reportReadError(runtime, NAVIGATION_SCROLL_STORAGE_KEY, "invalid_json");
    return 0;
  }
};

export const persistNavigationScrollPosition = (
  key: string,
  scrollTop: number,
  options?: NavigationPersistenceRuntime
): boolean => {
  if (!key) return false;
  const runtime = readRuntime(options);
  const raw = readStorageValue(runtime, NAVIGATION_SCROLL_STORAGE_KEY);
  let positions: Record<string, number> = {};

  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed) && isRecord(parsed.positions)) {
        positions = Object.fromEntries(
          Object.entries(parsed.positions).filter((entry): entry is [string, number] => {
            const [, value] = entry;
            return typeof value === "number" && Number.isFinite(value) && value > 0;
          })
        );
      }
    } catch {
      reportReadError(runtime, NAVIGATION_SCROLL_STORAGE_KEY, "invalid_json");
    }
  }

  const nextScrollTop = Math.max(0, Math.floor(scrollTop));
  if (nextScrollTop > 0) {
    positions[key] = nextScrollTop;
  } else {
    delete positions[key];
  }

  return persistUISetting(
    NAVIGATION_SCROLL_STORAGE_KEY,
    JSON.stringify({ positions } satisfies NavigationScrollSnapshot),
    runtime
  );
};

import {
  DEFAULT_LIBRARY_DESTINATION,
  isOnlineOnlyPage,
  libraryDestinationsEqual,
  normalizeOfflineLibraryDestination,
  type NavigationLocation
} from "../shared/ui/navigation";

export interface NavigationHistoryState {
  readonly entries: readonly NavigationLocation[];
  readonly index: number;
}

export const navigationLocationsEqual = (
  left: NavigationLocation,
  right: NavigationLocation
): boolean =>
  left.page === right.page &&
  libraryDestinationsEqual(left.libraryDestination, right.libraryDestination);

export const createNavigationHistory = (
  initial: NavigationLocation
): NavigationHistoryState => ({
  entries: [initial],
  index: 0
});

export const pushNavigationLocation = (
  state: NavigationHistoryState,
  location: NavigationLocation
): NavigationHistoryState => {
  const current = state.entries[state.index];
  if (current && navigationLocationsEqual(current, location)) return state;

  const nextEntries = [...state.entries.slice(0, state.index + 1), location];
  return { entries: nextEntries, index: nextEntries.length - 1 };
};

export const replaceNavigationLocation = (
  state: NavigationHistoryState,
  location: NavigationLocation
): NavigationHistoryState => {
  if (state.entries.length === 0) return createNavigationHistory(location);
  const replacedEntries = state.entries.map((entry, index) =>
    index === state.index ? location : entry
  );
  const dedupedEntries: NavigationLocation[] = [];
  let dedupedIndex = 0;
  replacedEntries.forEach((entry, index) => {
    const previous = dedupedEntries[dedupedEntries.length - 1];
    if (!previous || !navigationLocationsEqual(previous, entry)) {
      dedupedEntries.push(entry);
    }
    if (index <= state.index) {
      dedupedIndex = dedupedEntries.length - 1;
    }
  });
  return { entries: dedupedEntries, index: dedupedIndex };
};

export const moveNavigationHistory = (
  state: NavigationHistoryState,
  delta: -1 | 1
): NavigationHistoryState => {
  const nextIndex = state.index + delta;
  if (nextIndex < 0 || nextIndex >= state.entries.length) return state;
  return { entries: state.entries, index: nextIndex };
};

const normalizeOfflineLocation = (location: NavigationLocation): NavigationLocation => ({
  page: location.page,
  libraryDestination: normalizeOfflineLibraryDestination(location.libraryDestination)
});

const dedupeAdjacentLocations = (
  entries: readonly NavigationLocation[]
): readonly NavigationLocation[] =>
  entries.reduce<NavigationLocation[]>((result, entry) => {
    const previous = result[result.length - 1];
    if (!previous || !navigationLocationsEqual(previous, entry)) result.push(entry);
    return result;
  }, []);

export const enterOfflineNavigation = (
  state: NavigationHistoryState
): NavigationHistoryState => {
  const current = state.entries[state.index];
  const fallback: NavigationLocation = {
    page: "library",
    libraryDestination: DEFAULT_LIBRARY_DESTINATION
  };
  if (!current) return createNavigationHistory(fallback);

  const currentDestination = normalizeOfflineLibraryDestination(current.libraryDestination);
  const currentRequiresFallback =
    isOnlineOnlyPage(current.page) ||
    (current.page === "library" &&
      !libraryDestinationsEqual(current.libraryDestination, currentDestination));

  const retainedPrefix = state.entries
    .slice(0, state.index + (currentRequiresFallback ? 0 : 1))
    .filter((entry) => !isOnlineOnlyPage(entry.page))
    .map(normalizeOfflineLocation);
  const target = currentRequiresFallback ? fallback : normalizeOfflineLocation(current);
  const nextEntries = dedupeAdjacentLocations([...retainedPrefix, target]);

  return {
    entries: nextEntries.length > 0 ? nextEntries : [fallback],
    index: Math.max(0, nextEntries.length - 1)
  };
};

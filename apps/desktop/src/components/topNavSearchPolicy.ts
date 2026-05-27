export interface SearchEntryPanelInput {
  readonly enableSearchKeyword: boolean;
  readonly ncmSearchEntryEnabled: boolean;
  readonly query: string;
  readonly showHotSearch: boolean;
}

export interface SearchEntryLoadInput extends SearchEntryPanelInput {
  readonly defaultKeywordLoaded: boolean;
  readonly hotSearchLoaded: boolean;
  readonly isLoading: boolean;
  readonly panelOpen: boolean;
}

export interface SearchSuggestionInput {
  readonly enableSearchKeyword: boolean;
  readonly ncmSearchEntryEnabled: boolean;
  readonly panelOpen: boolean;
  readonly query: string;
}

export function shouldShowSearchEntryPanel(input: SearchEntryPanelInput): boolean {
  return (
    input.ncmSearchEntryEnabled &&
    input.query.trim().length === 0 &&
    (input.enableSearchKeyword || input.showHotSearch)
  );
}

export function shouldLoadDefaultKeyword(input: SearchEntryLoadInput): boolean {
  return (
    shouldShowSearchEntryPanel(input) &&
    input.panelOpen &&
    input.enableSearchKeyword &&
    !input.defaultKeywordLoaded &&
    !input.isLoading
  );
}

export function shouldLoadHotSearches(input: SearchEntryLoadInput): boolean {
  return (
    shouldShowSearchEntryPanel(input) &&
    input.panelOpen &&
    input.showHotSearch &&
    !input.hotSearchLoaded &&
    !input.isLoading
  );
}

export function shouldLoadSearchSuggestions(input: SearchSuggestionInput): boolean {
  return (
    input.ncmSearchEntryEnabled &&
    input.panelOpen &&
    input.enableSearchKeyword &&
    input.query.trim().length > 0
  );
}

export function searchFallbackKeyword(
  realKeyword: string | null | undefined,
  enableSearchKeyword: boolean
): string | null {
  if (!enableSearchKeyword) {
    return null;
  }

  const trimmed = realKeyword?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function visibleHotSearchItems<T>(
  items: readonly T[],
  options: { readonly limit: number; readonly showHotSearch: boolean }
): readonly T[] {
  if (!options.showHotSearch) {
    return [];
  }

  return items.slice(0, options.limit);
}

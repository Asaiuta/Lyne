import assert from "node:assert/strict";
import test from "node:test";
import {
  searchFallbackKeyword,
  shouldLoadDefaultKeyword,
  shouldLoadHotSearches,
  shouldLoadSearchSuggestions,
  shouldShowSearchEntryPanel,
  visibleHotSearchItems
} from "./topNavSearchPolicy";

test("search entry panel follows online search feature switches", () => {
  assert.equal(
    shouldShowSearchEntryPanel({
      enableSearchKeyword: false,
      ncmSearchEntryEnabled: true,
      query: "",
      showHotSearch: false
    }),
    false
  );
  assert.equal(
    shouldShowSearchEntryPanel({
      enableSearchKeyword: false,
      ncmSearchEntryEnabled: true,
      query: "",
      showHotSearch: true
    }),
    true
  );
});

test("default keyword and hot-search requests are independently gated", () => {
  const base = {
    enableSearchKeyword: true,
    ncmSearchEntryEnabled: true,
    query: "",
    showHotSearch: false,
    defaultKeywordLoaded: false,
    hotSearchLoaded: false,
    isLoading: false,
    panelOpen: true
  };

  assert.equal(shouldLoadDefaultKeyword(base), true);
  assert.equal(shouldLoadHotSearches(base), false);
  assert.equal(shouldLoadHotSearches({ ...base, showHotSearch: true }), true);
});

test("suggestions and fallback keyword are disabled by enableSearchKeyword", () => {
  assert.equal(
    shouldLoadSearchSuggestions({
      enableSearchKeyword: false,
      ncmSearchEntryEnabled: true,
      panelOpen: true,
      query: "hello"
    }),
    false
  );
  assert.equal(searchFallbackKeyword(" hello ", false), null);
  assert.equal(searchFallbackKeyword(" hello ", true), "hello");
});

test("hot search visibility returns an empty list when disabled", () => {
  assert.deepEqual(visibleHotSearchItems([1, 2, 3], { limit: 2, showHotSearch: false }), []);
  assert.deepEqual(visibleHotSearchItems([1, 2, 3], { limit: 2, showHotSearch: true }), [1, 2]);
});

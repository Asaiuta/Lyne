import assert from "node:assert/strict";
import test from "node:test";
import libraryPageSource from "../../features/library/LibraryPage.tsx?raw";
import cloudPageSource from "../../features/online/CloudPage.tsx?raw";
import albumDetailSource from "../../features/online/details/AlbumDetail.tsx?raw";
import playlistDetailSource from "../../features/online/details/PlaylistDetail.tsx?raw";
import naiveStyles from "../../shared/ui/naive/styles.css?raw";
import pageSearchStyles from "../../shared/styles/pages/page-search.css?raw";
import tokens from "../../shared/styles/tokens.css?raw";
import pageSearchSource from "./PageSearchInput.tsx?raw";

const searchSurfaces = [
  ["local library", libraryPageSource],
  ["cloud", cloudPageSource],
  ["album detail", albumDetailSource],
  ["playlist detail", playlistDetailSource]
] as const;

test("page search reuses the SPlayer-aligned Naive input contract", () => {
  for (const pattern of [
    /<NaiveInput\b/,
    /type="text"/,
    /clearable/,
    /round/,
    /autocomplete="off"/,
    /inputProps=\{\{ role: "searchbox" \}\}/,
    /prefix=\{<IconSearch \/>\}/
  ]) {
    assert.equal(pattern.test(pageSearchSource), true);
  }
});

test("every fuzzy-search page uses the shared search input", () => {
  for (const [name, source] of searchSurfaces) {
    assert.equal(/<PageSearchInput\b/.test(source), true, `${name} must use PageSearchInput`);
    assert.equal(
      /<label class="(?:local-library-search|playlist-detail-search|ncm-detail-search)"/.test(source),
      false,
      `${name} must not restore a handwritten search shell`
    );
  }
});

test("page search delegates its visual color states to Naive input tokens", () => {
  assert.equal(/--n-color:\s*var\(--naive-input-color\);/.test(naiveStyles), true);
  assert.equal(/--naive-input-color:\s*var\(--surface-4\);/.test(tokens), true);
  assert.equal(
    /--naive-input-color:\s*color-mix\(in oklch, var\(--surface-2\)/.test(tokens),
    false
  );
  assert.equal(/background(?:-color)?\s*:/.test(pageSearchStyles), false);
  assert.equal(/width:\s*130px;/.test(pageSearchStyles), true);
  assert.equal(/\.page-search-input\.n-input--focus\s*\{[^}]*width:\s*200px;/s.test(pageSearchStyles), true);
});

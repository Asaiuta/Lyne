import assert from "node:assert/strict";
import test from "node:test";
import routeTransitionSource from "./RouteContentTransition.tsx?raw";
import librarySource from "../features/library/LibraryPage.tsx?raw";
import artistSource from "../features/online/details/ArtistDetail.tsx?raw";
import discoverSource from "../features/online/modes/DiscoverMode.tsx?raw";
import likedSource from "../features/online/modes/LikedCollectionMode.tsx?raw";
import searchSource from "../features/online/modes/SearchMode.tsx?raw";
import downloadSource from "../features/download/DownloadPage.tsx?raw";
import streamingSource from "../features/streaming/StreamingPage.tsx?raw";

const assertMatches = (
  source: string,
  pattern: RegExp,
  message?: string
): void => {
  assert.equal(pattern.test(source), true, message);
};

const assertDoesNotMatch = (
  source: string,
  pattern: RegExp,
  message?: string
): void => {
  assert.equal(pattern.test(source), false, message);
};

test("all SPlayer-style internal routes use the shared motion lifecycle", () => {
  const migratedRoutes = [
    ["artist-content", artistSource],
    ["discover-content", discoverSource],
    ["download-content", downloadSource],
    ["liked-content", likedSource],
    ["search-content", searchSource],
    ["streaming-content", streamingSource]
  ] as const;

  assertMatches(routeTransitionSource, /<KeyedOutInTransition\b/);
  assertMatches(
    routeTransitionSource,
    /routeContentTransitionName\(props\.animation\)/
  );

  for (const [scope, source] of migratedRoutes) {
    assertMatches(source, /<RouteContentTransition\b/);
    assertMatches(source, new RegExp(`motionScope="${scope}"`));
  }

  assertMatches(librarySource, /<KeyedOutInTransition\b/);
  assertMatches(librarySource, /motionScope="library-content"/);
});

test("animated route bodies render from displayed state rather than the next target", () => {
  assertMatches(
    discoverSource,
    /props\.discoverTabRequest\?\.version[\s\S]*setDiscoverTab\(normalizeDiscoverTab\(props\.discoverTabRequest\?\.tab\)\)/
  );
  assertMatches(discoverSource, /displayedDiscoverTab\(\) === "playlists"/);
  assertDoesNotMatch(discoverSource, /<Show when=\{discoverTab\(\) ===/);

  assertMatches(likedSource, /displayedCollectionTab\(\) === "playlists"/);
  assertDoesNotMatch(likedSource, /<Match when=\{activeTab\(\) ===/);

  assertMatches(searchSource, /displayedSearchTab\(\) === "songs"/);
  assertDoesNotMatch(searchSource, /<Match when=\{props\.searchTab ===/);

  assertMatches(downloadSource, /displayedDownloadTab\(\) === "downloaded"/);
  assertMatches(
    streamingSource,
    /data-streaming-tab=\{displayedStreamingTab\(\)\}/
  );

  assertMatches(artistSource, /displayedDetailTab\(\) === "songs"/);
  assert.equal(
    (artistSource.match(/<Show when=\{detailTab\(\) === "songs"\}>/g) ?? []).length,
    1,
    "only the stable hero action may read the target artist tab"
  );
});

test("liked collection loading feedback remains owned by each displayed branch", () => {
  assertDoesNotMatch(likedSource, /activeTabLoading|activeCollectionLoading/);
  assertMatches(likedSource, /loadState\(\)\[tab\] === "loading"/);
  assertMatches(likedSource, /loadState\(\)\.playlists === "loading"/);
});

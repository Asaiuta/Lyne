import assert from "node:assert/strict";
import test from "node:test";

import segmentedTabsCss from "../components/segmented-tabs.css?raw";
import categoryModalCss from "../modals/category-modal.css?raw";
import loginCss from "../modals/login.css?raw";
import shellLayoutCss from "../shell/layout.css?raw";
import shellOverridesCss from "../shell/unlayered-overrides.css?raw";
import auxiliaryCss from "./auxiliary.css?raw";
import playlistDetailCss from "./playlist-detail.css?raw";
import ncmDetailsCss from "./ncm-details.css?raw";
import ncmCommentsCss from "./ncm-comments.css?raw";
import onlineDiscoverCss from "./online-discover.css?raw";
import radioCss from "./radio.css?raw";
import naiveCss from "../../ui/naive/styles.css?raw";
import segmentedTabsSource from "../../../components/page/SegmentedTabs.tsx?raw";
import loginModalSource from "../../../components/LoginModal.tsx?raw";
import downloadPageSource from "../../../features/download/DownloadPage.tsx?raw";
import streamingPageSource from "../../../features/streaming/StreamingPage.tsx?raw";
import neteaseRadioSource from "../../../features/online/NeteaseRadioPage.tsx?raw";
import discoverModeSource from "../../../features/online/modes/DiscoverMode.tsx?raw";
import discoverShowcasesSource from "../../../features/online/modes/discoverShowcases.tsx?raw";
import ncmListDetailSource from "../../../features/online/details/NcmListDetail.tsx?raw";
import albumDetailSource from "../../../features/online/details/AlbumDetail.tsx?raw";
import playlistDetailSource from "../../../features/online/details/PlaylistDetail.tsx?raw";
import artistDetailSource from "../../../features/online/details/ArtistDetail.tsx?raw";
import resourceCommentsSource from "../../../features/online/details/ResourceCommentsPanel.tsx?raw";
import videoDetailSource from "../../../features/online/details/VideoDetail.tsx?raw";
import onlinePlaylistDetailRouteSource from "../../../features/online/details/OnlinePlaylistDetailRoute.tsx?raw";
import onlineLikedPlaylistDetailRouteSource from "../../../features/online/details/OnlineLikedPlaylistDetailRoute.tsx?raw";
import playlistDetailNavigationSource from "../../../features/online/shared/detailNavigation/playlistDetailNavigation.ts?raw";
import useDetailNavigationSource from "../../../features/online/shared/useDetailNavigation.ts?raw";

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const shellCss = `${shellLayoutCss}\n${shellOverridesCss}`;

function readRule(css: string, selector: string): string {
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  const matchingRules: string[] = [];
  for (const match of stripComments(css).matchAll(rulePattern)) {
    const selectors = match[1]
      .split(",")
      .map((candidate) => candidate.trim())
      .filter(Boolean);
    if (selectors.includes(selector)) matchingRules.push(match[2]);
  }
  if (matchingRules.length > 0) return matchingRules.join("\n");
  throw new Error(`CSS rule not found: ${selector}`);
}

function readNaiveTabsTag(source: string, className: string): string {
  for (const match of source.matchAll(/<NaiveTabs\b[\s\S]*?\/>/g)) {
    if (new RegExp(`class="${className}"`).test(match[0])) return match[0];
  }
  throw new Error(`NaiveTabs consumer not found: ${className}`);
}

test("SegmentedTabs owns its adapter styles and maps variants into Naive variables", () => {
  assert.equal(
    /import "\.\.\/\.\.\/shared\/styles\/components\/segmented-tabs\.css";/.test(
      segmentedTabsSource
    ),
    true
  );
  assert.equal(/\.segmented-tabs\b/.test(stripComments(shellCss)), false);

  const rootRule = readRule(segmentedTabsCss, ".naive-tabs.n-tabs.segmented-tabs");
  assert.equal(/--n-color-segment:\s*var\(--segmented-surface\);/.test(rootRule), true);
  assert.equal(/--n-tab-color-segment:\s*var\(--segmented-active-bg\);/.test(rootRule), true);
  assert.equal(/--n-tab-text-color:\s*var\(--segmented-text-color\);/.test(rootRule), true);
  assert.equal(/--n-tab-text-color-hover:\s*var\(--segmented-hover-color\);/.test(rootRule), true);
  assert.equal(/--n-tab-text-color-active:\s*var\(--segmented-active-color\);/.test(rootRule), true);
  assert.equal(/--n-tab-border-radius:\s*var\(--radius-pill\);/.test(rootRule), true);
  assert.equal(/--n-tabs-rail-outline:\s*var\(--segmented-outline\);/.test(rootRule), true);
  assert.equal(/width:\s*max-content;/.test(rootRule), true);
  assert.equal(
    /\.naive-tabs\.n-tabs\.segmented-tabs\.segmented-tabs--surface\s*\{/.test(
      segmentedTabsCss
    ),
    true
  );
  assert.equal(
    /\.naive-tabs\.n-tabs\.segmented-tabs\.segmented-tabs--tonal\s*\{/.test(
      segmentedTabsCss
    ),
    true
  );
  assert.equal(/size="medium"/.test(segmentedTabsSource), true);

  const tabRule = readRule(
    segmentedTabsCss,
    ".naive-tabs.n-tabs.segmented-tabs .segmented-tab"
  );
  assert.equal(/height:\s*var\(--segmented-tab-height,\s*auto\);/.test(tabRule), true);
  assert.equal(/min-height:\s*var\(--segmented-tab-min-height,\s*0\);/.test(tabRule), true);
  assert.equal(/(?:^|;)\s*(?:color|background(?:-color)?|opacity|transition)\s*:/.test(tabRule), false);
  assert.equal(/\.segmented-tab:(?:hover|disabled)|\.segmented-tab\.is-active/.test(segmentedTabsCss), false);

  const countRule = readRule(segmentedTabsCss, ".segmented-tab-count");
  assert.equal(/margin-left:\s*2px;/.test(countRule), true);
  assert.equal(/font-size:\s*0\.86em;/.test(countRule), true);
  assert.equal(/line-height:\s*1;/.test(countRule), true);
  assert.equal(/transform:\s*translateY\(-4px\);/.test(countRule), true);

  assert.equal(/\.segmented-tabs-rail\b/.test(segmentedTabsCss), false);
  assert.equal(/railClass="segmented-tabs-rail"/.test(segmentedTabsSource), false);

  const nativeRailRule = readRule(
    naiveCss,
    ".naive-tabs.n-tabs--segment-type .n-tabs-rail"
  );
  assert.equal(/outline:\s*var\(--n-tabs-rail-outline\);/.test(nativeRailRule), true);

  const compactRule = readRule(
    segmentedTabsCss,
    ".naive-tabs.n-tabs.segmented-tabs.segmented-tabs--compact"
  );
  assert.equal(/--segmented-tab-height:\s*26px;/.test(compactRule), true);
  assert.equal(/--segmented-tab-min-height:\s*26px;/.test(compactRule), true);
  assert.equal(/height:\s*32px;/.test(compactRule), true);
  assert.equal(/min-height:\s*32px;/.test(compactRule), true);

  assert.equal(
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.n-tabs-capsule\s*,\s*\.naive-tabs\.n-tabs\.n-tabs--segment-type\.segmented-tabs\s+\.n-tabs-tab\s*\{[^}]*transition:\s*none;/.test(
      segmentedTabsCss
    ),
    true
  );
  assert.equal(
    /@media\s*\(max-width:\s*720px\)[\s\S]*?\.segmented-tabs--compact\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*0;/.test(
      segmentedTabsCss
    ),
    true
  );
});

test("direct NaiveTabs consumers stay inventoried at their route boundaries", () => {
  const consumers: ReadonlyArray<readonly [string, string, string]> = [
    ["download", downloadPageSource, "tabs"],
    ["streaming", streamingPageSource, "streaming-tabs"],
    ["discover primary", discoverModeSource, "discover-primary-tabs"],
    ["discover category modal", discoverModeSource, "cat-modal-tab-rail"],
    ["discover mini", discoverShowcasesSource, "online-discover-mini-tabs"],
    ["radio category", neteaseRadioSource, "radio-category-tabs"],
    ["login", loginModalSource, "login-modal-tabs"]
  ];

  for (const [name, source, className] of consumers) {
    const tag = readNaiveTabsTag(source, className);
    assert.equal(/\btype="segment"/.test(tag), true, name);
  }
});

test("direct segment consumers leave Naive tab internals to the facade", () => {
  const routeStyles = [
    auxiliaryCss,
    categoryModalCss,
    loginCss,
    onlineDiscoverCss,
    radioCss
  ];
  for (const css of routeStyles) {
    assert.equal(
      /\.n-tabs-(?:rail|capsule|tab)(?=[\s.:[,{])/.test(stripComments(css)),
      false
    );
  }

  const auxiliaryTabsRule = readRule(auxiliaryCss, ".auxiliary-page-menu .n-tabs");
  assert.equal(
    /--n-tabs-rail-outline:\s*1px solid var\(--n-tab-color-segment\);/.test(
      auxiliaryTabsRule
    ),
    true
  );

  const discoverMiniTabsRule = readRule(
    onlineDiscoverCss,
    ".online-discover-mini-tabs.n-tabs"
  );
  assert.equal(/width:\s*140px;/.test(discoverMiniTabsRule), true);
  assert.equal(/height:\s*40px;/.test(discoverMiniTabsRule), true);
  assert.equal(
    /--n-tabs-rail-outline:\s*1px solid var\(--n-tab-color-segment\);/.test(
      discoverMiniTabsRule
    ),
    true
  );
  assert.equal(/align-items\s*:/.test(discoverMiniTabsRule), false);
});

test("radio category follows SPlayer back-title-full-width-tab order", () => {
  const branchStart = neteaseRadioSource.indexOf('<div class="radio-category-view">');
  const branchEnd = neteaseRadioSource.indexOf("</div>", branchStart);
  assert.equal(branchStart !== -1, true);
  assert.equal(branchEnd !== -1, true);

  const branch = neteaseRadioSource.slice(branchStart, branchEnd);
  const backIndex = branch.indexOf('class="radio-category-back-button"');
  const titleIndex = branch.indexOf('class="radio-category-title"');
  const tabsIndex = branch.indexOf('class="radio-category-tabs"');
  assert.equal(backIndex >= 0 && backIndex < titleIndex && titleIndex < tabsIndex, true);

  const backTagStart = branch.lastIndexOf("<NaiveButton", backIndex);
  const backTagEnd = branch.indexOf("</NaiveButton>", backTagStart);
  const backComponent = branch.slice(backTagStart, backTagEnd);
  assert.equal(backTagStart >= 0 && backTagEnd > backTagStart, true);
  assert.equal(/\bround\b/.test(backComponent), true);
  assert.equal(/\bsecondary\b/.test(backComponent), true);
  assert.equal(/size="medium"/.test(backComponent), true);
  assert.equal(/\bstrong\b/.test(backComponent), true);
  assert.equal(/<PageToolbarButton\b[\s\S]*?class="radio-category-back-button"/.test(branch), false);

  const tabsRule = readRule(radioCss, ".radio-category-tabs");
  assert.equal(/width:\s*100%;/.test(tabsRule), true);
  assert.equal(/min-width:\s*0;/.test(tabsRule), true);
  assert.equal(/\.radio-category-tabs\s+\.n-tabs-(?:rail|capsule)/.test(radioCss), false);
  assert.equal(/140px/.test(tabsRule), false);
  assert.equal(/grid-template-columns/.test(tabsRule), false);
});

test("radio landing reuses the SPlayer grid and H3 prefix contracts", () => {
  assert.equal(
    /<PageHeader\s+title=\{t\("ncm\.radio\.title"\)\}\s+meta=\{<span>\{t\("ncm\.radio\.meta"\)\}<\/span>\}\s*\/>/.test(
      neteaseRadioSource
    ),
    false
  );
  assert.equal(/<NaiveGrid\b/.test(neteaseRadioSource), true);
  assert.equal(/cols="3 400:4 600:5 800:6 1000:7"/.test(neteaseRadioSource), true);
  assert.equal(/collapsed=\{!categoriesExpanded\(\)\}/.test(neteaseRadioSource), true);
  assert.equal(/<NaiveGridItem[^>]*\bsuffix\b>/.test(neteaseRadioSource), true);
  assert.equal(/\{\(\{ overflow \}\) => \(/.test(neteaseRadioSource), true);
  assert.equal(
    /<NaiveH3 class="radio-section-title" prefix="bar">\s*\{t\("ncm\.radio\.section\.hot"\)\}/.test(
      neteaseRadioSource
    ),
    true
  );

  const homeRule = readRule(radioCss, ".radio-home-view");
  assert.equal(/display:\s*flex;/.test(homeRule), true);
  assert.equal(/flex-direction:\s*column;/.test(homeRule), true);

  assert.equal(/\.radio-category-grid[^{}]*\{[^}]*grid-template-columns:/.test(radioCss), false);
  assert.equal(/\.radio-category-grid[^{}]*nth-of-type/.test(radioCss), false);
  assert.equal(/\.radio-section-title::before/.test(radioCss), false);

  const suffixCardRule = readRule(radioCss, ".radio-category-card--toggle");
  assert.equal(/padding-inline:\s*8px;/.test(suffixCardRule), true);

  const sectionTitleRule = readRule(radioCss, ".radio-section-title");
  assert.equal(/font-size:\s*18px;/.test(sectionTitleRule), true);
  assert.equal(/font-weight:\s*500;/.test(sectionTitleRule), true);
  assert.equal(/line-height:\s*1\.6;/.test(sectionTitleRule), true);
  assert.equal(/padding:/.test(sectionTitleRule), false);

  const radioRecommendationRule = readRule(radioCss, ".radio-page .radio-rec");
  assert.equal(/padding:\s*0;/.test(radioRecommendationRule), true);

  const coverGridRule = readRule(radioCss, ".radio-rec .album-grid");
  assert.equal(/padding-inline:\s*4px;/.test(coverGridRule), true);

  const headingBarRule = readRule(naiveCss, ".naive-heading--bar");
  assert.equal(/--naive-heading-prefix-width:\s*12px;/.test(headingBarRule), true);
  assert.equal(/--naive-heading-bar-width:\s*3px;/.test(headingBarRule), true);
  assert.equal(/padding-left:\s*var\(--naive-heading-prefix-width\);/.test(headingBarRule), true);

  const headingPrefixRule = readRule(naiveCss, ".naive-heading-prefix");
  assert.equal(/top:\s*0;/.test(headingPrefixRule), true);
  assert.equal(/bottom:\s*0;/.test(headingPrefixRule), true);
  assert.equal(/width:\s*var\(--naive-heading-bar-width\);/.test(headingPrefixRule), true);
});

test("radio category title and segment geometry reuse the NaiveUI facade", () => {
  const categoryTitleRule = readRule(radioCss, ".radio-category-title");
  assert.equal(/margin:\s*16px 0 20px;/.test(categoryTitleRule), true);
  assert.equal(/font-size:\s*36px;/.test(categoryTitleRule), true);
  assert.equal(/font-family:/.test(categoryTitleRule), false);
  assert.equal(/line-height:\s*1\.6;/.test(categoryTitleRule), true);

  const categoryResultsRule = readRule(radioCss, ".radio-page .radio-category-results");
  assert.equal(/padding-top:\s*40px;/.test(categoryResultsRule), true);
  assert.equal(/padding-inline:\s*0;/.test(categoryResultsRule), true);
  assert.equal(/padding-bottom:\s*0;/.test(categoryResultsRule), true);

  const tabsNavRule = readRule(naiveCss, ".naive-tabs .n-tabs-nav");
  assert.equal(/line-height:\s*1\.5;/.test(tabsNavRule), true);
});

test("radio route and nested detail components own their respective styles", () => {
  assert.equal(
    /import "\.\.\/\.\.\/shared\/styles\/pages\/radio\.css";/.test(
      neteaseRadioSource
    ),
    true
  );
  assert.equal(
    /import "\.\.\/\.\.\/shared\/styles\/pages\/ncm-details\.css";/.test(
      neteaseRadioSource
    ),
    false
  );
  assert.equal(
    /import "\.\.\/\.\.\/shared\/styles\/pages\/ncm-comments\.css";/.test(
      neteaseRadioSource
    ),
    false
  );
  assert.equal(
    /import "\.\.\/\.\.\/\.\.\/shared\/styles\/pages\/ncm-details\.css";/.test(
      ncmListDetailSource
    ),
    true
  );
  assert.equal(
    /import "\.\.\/\.\.\/\.\.\/shared\/styles\/pages\/ncm-comments\.css";/.test(
      resourceCommentsSource
    ),
    true
  );
});

test("radio detail uses one shared page scroll contract for header and mobile tabs", () => {
  assert.equal(/<PageSurface\b[\s\S]*?class="radio-detail-view"/.test(neteaseRadioSource), true);
  assert.equal(/<PageStickyHeader\s+threshold=\{10\}>/.test(neteaseRadioSource), true);
  assert.equal(/<PageBody\s+class="radio-detail-body">/.test(neteaseRadioSource), true);
  assert.equal(/compact=\{compact\(\)\}/.test(neteaseRadioSource), true);
  assert.equal(
    /class="radio-detail-tabs radio-detail-tabs--mobile"[\s\S]*?density=\{compact\(\)\s*\?\s*"compact"\s*:\s*"regular"\}/.test(
      neteaseRadioSource
    ),
    true
  );
  assert.equal(/\bpageScrollRoot\b/.test(neteaseRadioSource), true);
  assert.equal(/isRadioListScrolled|handleRadioTrackScroll|onScroll=\{handleRadioTrackScroll\}/.test(neteaseRadioSource), false);

  const detailPageRule = readRule(radioCss, ".radio-page.is-radio-detail-view");
  assert.equal(/height:\s*100%;/.test(detailPageRule), true);
  assert.equal(/min-height:\s*0;/.test(detailPageRule), true);

  const detailBodyListRule = readRule(radioCss, ".radio-detail-body > .media-list-table");
  assert.equal(/flex:\s*1 1 auto;/.test(detailBodyListRule), true);
  assert.equal(/height:\s*auto;/.test(detailBodyListRule), true);
  assert.equal(/min-height:\s*0;/.test(detailBodyListRule), true);
});

test("detail consumers use shared density without repainting Naive chrome", () => {
  const radioDetailRule = readRule(radioCss, ".radio-detail-tabs");
  assert.equal(
    /--segmented-outline:\s*1px solid var\(--n-tab-color-segment\);/.test(radioDetailRule),
    true
  );
  assert.equal(/width:\s*200px;/.test(radioDetailRule), true);

  const ncmDetailRule = readRule(ncmDetailsCss, ".ncm-list-detail-tabs");
  assert.equal(/width:\s*200px;/.test(ncmDetailRule), true);
  assert.equal(/--segmented-outline:/.test(ncmDetailRule), true);

  const playlistRule = readRule(playlistDetailCss, ".playlist-detail-tabs");
  assert.equal(/width:\s*200px;/.test(playlistRule), true);
  assert.equal(/--segmented-outline:/.test(playlistRule), true);
  assert.equal(/(?:^|[;\s])(?:height|min-height|border-radius|transition)\s*:/.test(playlistRule), false);

  assert.equal(/\.radio-detail-tabs\s+\.n-tabs-(?:rail|capsule)/.test(radioCss), false);
  assert.equal(/\.ncm-list-detail-tabs\s+\.n-tabs-(?:rail|capsule)/.test(ncmDetailsCss), false);
  assert.equal(/\.playlist-detail-tabs\s+\.n-tabs-(?:rail|capsule)/.test(playlistDetailCss), false);
  assert.equal(/\.ncm-list-detail-tabs\s+\.segmented-tab\s*\{/.test(ncmDetailsCss), false);
  assert.equal(/\.playlist-detail-tabs\s+\.segmented-tab\s*\{/.test(playlistDetailCss), false);
  assert.equal(/\.ncm-list-detail-tabs\s+\.segmented-tab-count\s*\{/.test(ncmDetailsCss), false);
  assert.equal(/\.playlist-detail-tabs\s+\.segmented-tab-count\s*\{/.test(playlistDetailCss), false);
  assert.equal(/--segmented-(?:gap|padding):/.test(ncmDetailsCss), false);
  assert.equal(/--segmented-(?:gap|padding):/.test(ncmCommentsCss), false);
  assert.equal(
    /--segmented-tab-(?:height|min-height)\s*:/.test(
      [radioCss, ncmDetailsCss, ncmCommentsCss, playlistDetailCss].join("\n")
    ),
    false
  );

  assert.equal(/density=\{props\.compact\s*\?\s*"compact"\s*:\s*"regular"\}/.test(ncmListDetailSource), true);
  assert.equal(/density=\{compact\(\)\s*\?\s*"compact"\s*:\s*"regular"\}/.test(albumDetailSource), true);
  assert.equal(/density=\{compact\(\)\s*\?\s*"compact"\s*:\s*"regular"\}/.test(playlistDetailSource), true);
  assert.equal(/density="compact"/.test(artistDetailSource), true);
  assert.equal(/density="compact"/.test(resourceCommentsSource), true);
  assert.equal(/density="compact"/.test(videoDetailSource), true);
});

test("playlist detail has one PageStickyHeader compact-state owner", () => {
  assert.equal(/<PageStickyHeader\s+threshold=\{10\}>/.test(playlistDetailSource), true);
  assert.equal(/<PageBody\s+offset\s+class="playlist-detail-body">/.test(playlistDetailSource), true);
  assert.equal(
    /density=\{compact\(\)\s*\?\s*"compact"\s*:\s*"regular"\}/.test(
      playlistDetailSource
    ),
    true
  );

  const playlistScrollSources = [
    playlistDetailSource,
    onlinePlaylistDetailRouteSource,
    onlineLikedPlaylistDetailRouteSource,
    playlistDetailNavigationSource,
    useDetailNavigationSource
  ].join("\n");
  assert.equal(/isPlaylistDetailScrolled|handlePlaylistTrackScroll/.test(playlistScrollSources), false);
  assert.equal(/\bisScrolled\s*[:=]|\bonScroll\s*[:=]/.test(playlistScrollSources), false);
});

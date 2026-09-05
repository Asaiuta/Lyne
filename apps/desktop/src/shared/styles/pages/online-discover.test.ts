import assert from "node:assert/strict";
import test from "node:test";

import categoryModalCss from "../modals/category-modal.css?raw";
import settingsCss from "../modals/category-load-settings.css?raw";
import contextMenuCss from "./context-menu.css?raw";
import albumGridCss from "./album-grid.css?raw";
import mediaListCss from "./media-list.css?raw";
import onlineCatalogCardsCss from "./online-catalog-cards.css?raw";
import onlineDiscoverCss from "./online-discover.css?raw";
import pageActionsCss from "./page-actions.css?raw";
import sharedFeedbackCss from "./shared-feedback.css?raw";
import tokensCss from "../tokens.css?raw";
import naiveCss from "../../ui/naive/styles.css?raw";
import naiveDisplaySource from "../../ui/naive/display.tsx?raw";
import discoverModeSource from "../../../features/online/modes/DiscoverMode.tsx?raw";
import discoverShowcasesSource from "../../../features/online/modes/discoverShowcases.tsx?raw";
import coverGridSkeletonSource from "../../../components/page/CoverGridSkeleton.tsx?raw";
import artistDetailSource from "../../../features/online/details/ArtistDetail.tsx?raw";

function readRule(css: string, selector: string): string {
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  const matchingRules: string[] = [];
  for (const match of css.matchAll(rulePattern)) {
    const selectors = match[1]
      .split(",")
      .map((candidate) => candidate.trim());
    if (selectors.includes(selector)) {
      matchingRules.push(match[2]);
    }
  }
  if (matchingRules.length > 0) return matchingRules.join("\n");
  throw new Error(`CSS rule not found: ${selector}`);
}

function assertNeutralControlRule(css: string, selector: string): void {
  const rule = readRule(css, selector);
  assert.equal(
    /var\(--(?:accent\b|color-primary|naive-primary|theme-primary)|primary-color/.test(rule),
    false,
    selector
  );
}

function assertDoesNotOverrideSegmentBackground(css: string, selector: string): void {
  const rule = readRule(css, selector);
  assert.equal(/--n-(?:tab-)?color-segment\s*:/.test(rule), false, selector);
}

test("discover category and filter controls stay neutral instead of primary red", () => {
  [
    ".online-discover-cat-button",
    ".online-discover-cat-button:hover",
    ".online-discover-cat-button:active",
    ".online-discover-cat-button:focus-visible",
    ".online-discover-cat-button::before",
    ".online-discover-cat-button:hover::before",
    ".online-discover-cat-button:active::before",
    ".online-discover-filter-menu button:hover",
    ".online-discover-filter-menu button:focus-visible",
    ".online-discover-filter-menu button.is-active"
  ].forEach((selector) => assertNeutralControlRule(onlineDiscoverCss, selector));

  assert.equal(
    /--online-discover-entry-bg:\s*var\(--naive-tabs-color-segment\);/.test(
      readRule(onlineDiscoverCss, ".online-page.is-discover-page")
    ),
    true
  );
  assert.equal(
    /--online-discover-entry-capsule-bg:\s*color-mix\(in oklch, var\(--naive-tabs-color-segment\) 90%, var\(--text\) 6%\);/.test(
      readRule(onlineDiscoverCss, ".online-page.is-discover-page")
    ),
    true
  );
  assert.equal(
    /background:\s*var\(--online-discover-entry-bg\);/.test(
      readRule(onlineDiscoverCss, ".online-discover-cat-button")
    ),
    true
  );
  assert.equal(
    /box-shadow:\s*var\(--online-discover-entry-shadow/.test(
      readRule(onlineDiscoverCss, ".online-discover-cat-button")
    ),
    false
  );
  assert.equal(
    /background:\s*var\(--online-discover-entry-capsule-bg\);/.test(
      readRule(onlineDiscoverCss, ".online-discover-cat-button::before")
    ),
    true
  );
  assert.equal(
    /background:\s*var\(--online-discover-entry-bg-hover\);/.test(
      readRule(onlineDiscoverCss, ".online-discover-cat-button:hover")
    ),
    true
  );
  assert.equal(
    /background:\s*var\(--online-discover-entry-capsule-bg-hover\);/.test(
      readRule(onlineDiscoverCss, ".online-discover-cat-button:hover::before")
    ),
    true
  );
  assert.equal(
    /background:\s*var\(--online-discover-entry-bg-active\);/.test(
      readRule(onlineDiscoverCss, ".online-discover-cat-button:active")
    ),
    true
  );
  assert.equal(
    /background:\s*var\(--online-discover-entry-capsule-bg-active\);/.test(
      readRule(onlineDiscoverCss, ".online-discover-cat-button:active::before")
    ),
    true
  );
  assert.equal(
    /background:\s*var\(--online-discover-control-bg-active\);/.test(
      readRule(onlineDiscoverCss, ".online-discover-filter-menu button.is-active")
    ),
    true
  );
  assert.equal(
    /box-shadow:\s*var\(--online-discover-entry-shadow/.test(
      readRule(onlineDiscoverCss, ".online-discover-cat-button:hover")
    ),
    false
  );
});

test("discover tab and card interaction states stay neutral instead of primary red", () => {
  [
    ".online-discover-mini-tabs.n-tabs",
    ".online-toplist-card:hover",
    ".online-toplist-card:focus-visible",
    ".online-toplist-card:active"
  ].forEach((selector) => assertNeutralControlRule(onlineDiscoverCss, selector));
  [
    ".media-sort-radio.n-radio",
    ".media-list-float-button"
  ].forEach((selector) => assertNeutralControlRule(mediaListCss, selector));
  [
    ".online-catalog-context .album-card:hover",
    ".online-catalog-context .album-card.is-cover-hidden",
    ".online-catalog-context .album-card.is-cover-hidden:hover"
  ].forEach((selector) => assertNeutralControlRule(onlineCatalogCardsCss, selector));

  const miniTabsRule = readRule(onlineDiscoverCss, ".online-discover-mini-tabs.n-tabs");
  assert.equal(
    /--n-tabs-rail-outline:\s*1px solid var\(--n-tab-color-segment\);/.test(
      miniTabsRule
    ),
    true
  );
  assert.equal(/width:\s*140px;/.test(miniTabsRule), true);
  assert.equal(/height:\s*40px;/.test(miniTabsRule), true);
  assert.equal(/align-items\s*:/.test(miniTabsRule), false);
  assertDoesNotOverrideSegmentBackground(onlineDiscoverCss, ".online-discover-mini-tabs.n-tabs");

  for (const css of [onlineDiscoverCss, categoryModalCss]) {
    assert.equal(/\.n-tabs-(?:rail|capsule|tab)(?=[\s.:[,{])/.test(css), false);
  }
  assert.equal(/\.discover-primary-tabs\b/.test(onlineDiscoverCss), false);
});

test("official toplists use the SPlayer card structure and container-responsive Naive grid", () => {
  assert.equal(
    /cols="1 600:2 1000:3"\s*xGap=\{20\}\s*yGap=\{20\}/.test(
      discoverShowcasesSource
    ),
    true
  );
  assert.equal(/<NaiveGridItem>/.test(discoverShowcasesSource), true);
  assert.equal(/Array\.from\(\{ length: 4 \}/.test(discoverShowcasesSource), true);
  assert.equal(/\.online-toplist-grid\s*\{/.test(onlineDiscoverCss), false);

  const cardStart = discoverShowcasesSource.indexOf("function OfficialToplistCard");
  const skeletonStart = discoverShowcasesSource.indexOf("function OfficialToplistSkeleton");
  assert.equal(cardStart >= 0, true);
  assert.equal(skeletonStart >= 0, true);
  const cardSource = discoverShowcasesSource.slice(cardStart, skeletonStart);
  assert.equal(
    /online-toplist-title-row[\s\S]*online-toplist-content-row[\s\S]*online-toplist-cover[\s\S]*online-toplist-songs/.test(
      cardSource
    ),
    true
  );

  const cardRule = readRule(onlineDiscoverCss, ".online-toplist-card");
  assert.equal(/height:\s*160px;/.test(cardRule), true);
  assert.equal(/border:\s*1px solid var\(--naive-border-color\);/.test(cardRule), true);
  assert.equal(/background:\s*var\(--naive-card-color\);/.test(cardRule), true);
  assert.equal(/var\(--border-faint\)/.test(cardRule), false);
  assert.equal(/\.online-toplist-card\.is-cover-hidden\b/.test(onlineDiscoverCss), false);

  const coverRule = readRule(onlineDiscoverCss, ".online-toplist-cover");
  assert.equal(/height:\s*100%;/.test(coverRule), true);
  assert.equal(/aspect-ratio:\s*1 \/ 1;/.test(coverRule), true);
  assert.equal(/128px/.test(coverRule), false);
  assert.equal(
    /content:\s*"-";/.test(
      readRule(onlineDiscoverCss, ".online-toplist-song small::before")
    ),
    true
  );
});

test("Discover browse routes own their first-content rhythm without doubling the page gap", () => {
  assert.equal(
    /gap:\s*0;/.test(
      readRule(
        onlineDiscoverCss,
        ".online-page.is-discover-page:has(.online-discover-view)"
      )
    ),
    true
  );

  [
    ".online-page.is-discover-page:has(.online-discover-view) .online-discover-playlists > .online-discover-menu",
    ".online-page.is-discover-page:has(.online-discover-view) .online-discover-artists > .online-discover-filter-menu:first-child",
    ".online-page.is-discover-page:has(.online-discover-view) .online-discover-new > .online-discover-menu",
    ".online-page.is-discover-page:has(.online-discover-view) .online-discover-videos > .online-discover-menu:first-child"
  ].forEach((selector) => {
    assert.equal(/margin-top:\s*20px;/.test(readRule(onlineDiscoverCss, selector)), true);
  });
});

test("Discover toplist headings use the shared titled divider rhythm", () => {
  assert.equal(
    /<NaiveDivider class="online-discover-divider">/.test(discoverShowcasesSource),
    true
  );
  assert.equal(
    /<NaiveDivider class="online-discover-divider online-discover-divider--selected">/.test(
      discoverShowcasesSource
    ),
    true
  );
  assert.equal(/::before|::after/.test(onlineDiscoverCss), true);
  assert.equal(/\.online-discover-divider::(?:before|after)/.test(onlineDiscoverCss), false);

  const dividerRule = readRule(naiveCss, ".naive-divider");
  const titledDividerRule = readRule(naiveCss, ".naive-divider--titled");
  const titleRule = readRule(naiveCss, ".naive-divider-title");
  const lineRule = readRule(naiveCss, ".naive-divider-line");
  assert.equal(/margin-top:\s*24px;/.test(titledDividerRule), true);
  assert.equal(/margin-bottom:\s*24px;/.test(titledDividerRule), true);
  assert.equal(/font-size:\s*16px;/.test(dividerRule), true);
  assert.equal(/line-height:\s*1\.6;/.test(dividerRule), true);
  assert.equal(/--n-font-weight:\s*500;/.test(dividerRule), true);
  assert.equal(/--n-color:\s*var\(--naive-divider-color\);/.test(dividerRule), true);
  assert.equal(/--n-text-color:\s*var\(--naive-text-color-1\);/.test(dividerRule), true);
  assert.equal(
    /font-weight:\s*var\(--n-font-weight\);/.test(titleRule),
    true
  );
  assert.equal(/line-height\s*:/.test(titleRule), false);
  assert.equal(/background:\s*var\(--n-color\);/.test(lineRule), true);
  assert.equal(/flex\s*:/.test(lineRule), false);
  assert.equal(
    /<div class="naive-divider-title n-divider__title">/.test(naiveDisplaySource),
    true
  );
  assert.equal(
    /<div class="naive-divider-line naive-divider-line--left n-divider__line n-divider__line--left" \/>/.test(
      naiveDisplaySource
    ),
    true
  );
  assert.equal(/--naive-text-color-1-default:\s*rgb\(31 34 37\);/.test(tokensCss), true);
  assert.equal(/--naive-divider-color-default:\s*rgb\(239 239 245\);/.test(tokensCss), true);
  assert.equal(
    /--naive-text-color-1-default:\s*rgb\(255 255 255 \/ 0\.9\);/.test(tokensCss),
    true
  );
  assert.equal(
    /--naive-divider-color-default:\s*rgb\(255 255 255 \/ 0\.09\);/.test(tokensCss),
    true
  );
  const globalColorRemoved = /\[data-theme-global-color="true"\]/.test(tokensCss);
  assert.equal(globalColorRemoved, false, "global color block was removed");
  assert.equal(
    /--naive-text-color-1:\s*var\(--naive-text-color-1-default\);/.test(tokensCss),
    true
  );
  assert.equal(
    /--naive-divider-color:\s*var\(--naive-divider-color-default\);/.test(tokensCss),
    true
  );
  assert.equal(/--naive-text-color-1:\s*var\(--text\);/.test(tokensCss), false);
  assert.equal(/--naive-divider-color:\s*var\(--border-overlay\);/.test(tokensCss), false);
  assert.equal(
    /margin-bottom:\s*0;/.test(
      readRule(onlineDiscoverCss, ".online-discover-divider--selected")
    ),
    true
  );
});

test("Discover CoverList grids keep the same SPlayer insets while loading and loaded", () => {
  const coverListRule = readRule(albumGridCss, ".cover-list-grid");
  assert.equal(/width:\s*100%;/.test(coverListRule), true);
  assert.equal(/padding:\s*20px 4px;/.test(coverListRule), true);

  const skeletonRule = readRule(sharedFeedbackCss, ".skeleton-card");
  assert.equal(/padding:\s*20px 4px;/.test(skeletonRule), false);
  assert.equal(/\.skeleton-grid\s*\{/.test(sharedFeedbackCss), false);
  assert.equal(
    /class="album-grid cover-list-grid skeleton-grid"/.test(coverGridSkeletonSource),
    true
  );

  const toplistStart = discoverShowcasesSource.indexOf("export function DiscoverToplistShowcase");
  const nextShowcase = discoverShowcasesSource.indexOf(
    "export interface DiscoverNewShowcaseProps",
    toplistStart
  );
  assert.equal(toplistStart >= 0 && nextShowcase > toplistStart, true);
  const toplistSource = discoverShowcasesSource.slice(toplistStart, nextShowcase);
  assert.equal(
    /online-discover-divider--selected[\s\S]*<CoverGridSkeleton count=\{12\}[\s\S]*class="album-grid cover-list-grid content-fade-in"/.test(
      toplistSource
    ),
    true
  );

  for (const className of [
    "album-grid cover-list-grid content-fade-in",
    "album-grid cover-list-grid online-discover-video-grid content-fade-in",
    "album-grid cover-list-grid"
  ]) {
    assert.equal(discoverShowcasesSource.includes(`class="${className}"`), true, className);
  }
});

test("shared divider consumers override placement without repainting the line", () => {
  const contextDividerRule = readRule(contextMenuCss, ".context-menu-divider");
  const sortDividerRule = readRule(mediaListCss, ".media-sort-divider");
  assert.equal(/height:\s*1px;/.test(contextDividerRule), true);
  assert.equal(/margin:\s*4px 0;/.test(contextDividerRule), true);
  assert.equal(/(?:background|color)\s*:/.test(contextDividerRule), false);
  assert.equal(/width:\s*1px;/.test(sortDividerRule), true);
  assert.equal(/height:\s*auto;/.test(sortDividerRule), true);
  assert.equal(/margin:\s*0 12px;/.test(sortDividerRule), true);
  assert.equal(/align-self:\s*stretch;/.test(sortDividerRule), true);
  assert.equal(/(?:background|color)\s*:/.test(sortDividerRule), false);
});

test("discover category modal tags stay neutral instead of primary red", () => {
  [
    ".cat-modal-close:hover",
    ".cat-modal-close:focus-visible",
    ".cat-modal-tag:hover",
    ".cat-modal-tag:focus-visible",
    ".cat-modal-tag.is-active"
  ].forEach((selector) => assertNeutralControlRule(categoryModalCss, selector));

  assert.equal(
    /background:\s*var\(--cat-modal-control-bg-active\);/.test(
      readRule(categoryModalCss, ".cat-modal-tag.is-active")
    ),
    true
  );
});

test("Discover owns category-modal styles and reuses shared load-more placement on cold entry", () => {
  assert.equal(
    /import "\.\.\/\.\.\/\.\.\/shared\/styles\/modals\/category-modal\.css";/.test(
      discoverModeSource
    ),
    true
  );
  assert.equal(/\.cat-modal(?:\b|-)/.test(categoryModalCss), true);
  assert.equal(/\.load-more-button-row\s*\{/.test(pageActionsCss), true);
  assert.equal(/class="load-more-button-row"/.test(discoverShowcasesSource), true);
  assert.equal(/class="load-more-button-row"/.test(artistDetailSource), true);
  assert.equal(/\.online-discover-load-more\b/.test(onlineDiscoverCss), false);
  assert.equal(/\.cat-modal(?:\b|-)/.test(settingsCss), false);
  assert.equal(/\.online-discover-load-more\b/.test(settingsCss), false);
});

test("Discover reuses static catalog responses across route remounts", () => {
  assert.equal(
    /import \{ cacheFetch \} from "\.\.\/\.\.\/\.\.\/shared\/state\/cacheFetch";/.test(
      discoverModeSource
    ),
    true
  );
  assert.equal(
    /cacheFetch\(\s*"ncm\.discover\.playlist-categories"/.test(
      discoverModeSource
    ),
    true
  );
  assert.equal(
    /cacheFetch\(\s*"ncm\.discover\.toplists"/.test(discoverModeSource),
    true
  );
  assert.equal(/safeLoadDiscover\(loadDiscoverToplists, \[\]\)/.test(discoverModeSource), true);
  assert.equal(/await loadDiscoverPlaylistCategories\(\)/.test(discoverModeSource), true);
});

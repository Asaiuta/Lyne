import assert from "node:assert/strict";
import test from "node:test";

import categoryModalCss from "../modals/category-load-settings.css?raw";
import onlineDiscoverCss from "./online-discover.css?raw";

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
    ".online-discover-mini-tabs .n-tabs-rail",
    ".online-page.is-discover-page .page-header-tabs .discover-primary-tabs.n-tabs",
    ".media-sort-radio.n-radio",
    ".media-list-float-button",
    ".online-discover-section .album-card:hover",
    ".ncm-home-feed .album-card:hover",
    ".online-discover-section .album-card.is-cover-hidden",
    ".ncm-home-feed .album-card.is-cover-hidden",
    ".online-discover-section .album-card.is-cover-hidden:hover",
    ".ncm-home-feed .album-card.is-cover-hidden:hover",
    ".online-toplist-card:hover",
    ".online-toplist-card:focus-visible",
    ".online-toplist-card:active"
  ].forEach((selector) => assertNeutralControlRule(onlineDiscoverCss, selector));

  assert.equal(
    /--n-bar-color:\s*var\(--online-discover-control-border-hover\);/.test(
      readRule(onlineDiscoverCss, ".online-discover-mini-tabs.n-tabs")
    ),
    true
  );
  assert.equal(
    /outline\s*:/.test(readRule(onlineDiscoverCss, ".online-discover-mini-tabs .n-tabs-rail")),
    false
  );
  assert.equal(
    /--n-bar-color:\s*var\(--online-discover-control-border-hover\);/.test(
      readRule(
        onlineDiscoverCss,
        ".online-page.is-discover-page .page-header-tabs .discover-primary-tabs.n-tabs"
      )
    ),
    true
  );
  [
    ".online-discover-mini-tabs.n-tabs",
    ".online-page.is-discover-page .page-header-tabs .discover-primary-tabs.n-tabs"
  ].forEach((selector) => assertDoesNotOverrideSegmentBackground(onlineDiscoverCss, selector));
});

test("discover category modal tags stay neutral instead of primary red", () => {
  [
    ".cat-modal-close:hover",
    ".cat-modal-close:focus-visible",
    ".cat-modal-tab-rail.n-tabs",
    ".cat-modal-tab-rail .n-tabs-rail",
    ".cat-modal-tab-rail .n-tabs-tab:focus-visible",
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
  assertDoesNotOverrideSegmentBackground(categoryModalCss, ".cat-modal-tab-rail.n-tabs");
});

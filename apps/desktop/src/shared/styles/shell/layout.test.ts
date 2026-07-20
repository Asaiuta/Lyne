import assert from "node:assert/strict";
import test from "node:test";

import sidebarSource from "../../../app/Sidebar.tsx?raw";
import naiveSidebarSource from "../../ui/naive/sidebar.tsx?raw";
import layoutCss from "./layout.css?raw";
import unlayeredOverridesCss from "./unlayered-overrides.css?raw";

function readRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{([^}]*)\\}`, "m").exec(
    layoutCss
  );
  if (match === null) throw new Error(`CSS rule not found: ${selector}`);
  return match[1];
}

function readLastRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [
    ...layoutCss.matchAll(
      new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{([^}]*)\\}`, "gm")
    )
  ];
  const match = matches[matches.length - 1];
  if (match === undefined) throw new Error(`CSS rule not found: ${selector}`);
  return match[1];
}

test("sidebar geometry uses one owner-only token with a bounded WAAPI driver", () => {
  assert.equal(
    /@property\s+--sidebar-inline-size\s*\{[\s\S]*?syntax:\s*"<length>";[\s\S]*?inherits:\s*false;/.test(
      layoutCss
    ),
    true
  );

  const sidebarRule = readRule(".sidebar");
  assert.equal(
    /transition:[\s\S]*?--sidebar-inline-size\s+var\(--motion-duration-spatial\)/.test(
      sidebarRule
    ),
    true
  );
  assert.equal(/min-height:\s*0;/.test(sidebarRule), true);
  assert.equal(/\b(?:width|min-width|max-width)\s+var\(--motion-duration-spatial\)/.test(sidebarRule), false);

  const waapiRule = readRule(".sidebar.is-waapi-geometry");
  assert.equal(
    /transition-property:\s*color,\s*border-color,\s*transform,\s*background-color;/.test(
      waapiRule
    ),
    true,
    "the active WAAPI driver must remove only the duplicate CSS geometry transition"
  );
  assert.equal(/--sidebar-inline-size/.test(waapiRule), false);
  assert.equal(
    /createSidebarGeometryMotionForElement\([\s\S]*?collapseLifecycle\.requestSettle\(generation, targetCollapsed\)/.test(
      sidebarSource
    ),
    true,
    "the transient geometry animation must settle through the existing generation lifecycle"
  );
  assert.equal(
    /geometryMotion\.animateTo\(generation, nextCollapsed\)/.test(sidebarSource),
    true
  );

  for (const selector of [
    ".sidebar-scrollbar",
    ".sidebar-content",
    ".sidebar-brand",
    ".sidebar-scroll",
    ".sidebar-menu",
    ".sidebar-section-header",
    ".sidebar-nav-item",
    ".sidebar-playlist-item"
  ]) {
    const rule = readRule(selector);
    assert.equal(
      /width:\s*100%;/.test(rule),
      true,
      `${selector} must follow its containing block`
    );
    assert.equal(
      /min-width:\s*0;/.test(rule),
      true,
      `${selector} must allow intrinsic content to shrink`
    );
    assert.equal(
      /max-width:\s*100%;/.test(rule),
      true,
      `${selector} must remain within the geometry owner`
    );
    assert.equal(
      /\b(?:width|min-width|max-width)\s+var\(--motion-duration-spatial\)/.test(rule),
      false,
      `${selector} must not start an independent geometry transition`
    );
  }

  assert.equal(
    [...layoutCss.matchAll(/(?:width|min-width|max-width):\s*var\(--sidebar-inline-size\);/g)]
      .length,
    3,
    "only the sidebar owner may consume the animated inline-size token"
  );
});

test("sidebar menu rows keep NaiveButton as the single hover geometry owner", () => {
  assert.equal(
    /<NaiveButton[\s\S]*class=\{`sidebar-nav-button sidebar-nav-item\$\{activeClass\(props\.active\)\}`\}[\s\S]*<span class="sidebar-nav-icon"/.test(
      naiveSidebarSource
    ),
    true,
    "navigation rows must put the menu item surface on the NaiveButton root"
  );
  assert.equal(
    /<NaiveButton[\s\S]*class=\{`sidebar-playlist-button sidebar-playlist-item\$\{activeClass\(props\.active\)\}\$\{hiddenCoverClass\(\)\}`\}[\s\S]*<Show/.test(
      naiveSidebarSource
    ),
    true,
    "playlist rows must put the menu item surface on the NaiveButton root"
  );
  assert.equal(/<span class=\{`sidebar-nav-item/.test(naiveSidebarSource), false);
  assert.equal(/<span class=\{`sidebar-playlist-item/.test(naiveSidebarSource), false);
  assert.equal(
    /<button[^>]*class="[^"]*sidebar-playlist-group-collapsed-button/.test(sidebarSource),
    false,
    "collapsed playlist entries must use the same NaiveButton facade"
  );

  for (const selector of [".sidebar-nav-item::before", ".sidebar-playlist-item::before"]) {
    const rule = readRule(selector);
    assert.equal(/inset:\s*0\s+8px;/.test(rule), true);
  }
  for (const selector of [".sidebar-nav-item", ".sidebar-playlist-item"]) {
    const rule = readRule(selector);
    assert.equal(/padding-left\s+var\(--motion-duration-spatial\)/.test(rule), true);
  }

  assert.equal(
    /\.naive-button\.sidebar-nav-item:is\(:hover, :focus-visible, :active\):not\(:disabled\)\s*\{[^}]*color:\s*var\(--text\);[^}]*background:\s*transparent;/s.test(
      layoutCss
    ),
    true,
    "NMenu-style rows must override the NaiveButton accent text state"
  );
  assert.equal(
    /\.naive-button\.sidebar-playlist-item:is\(:hover, :focus-visible, :active\):not\(:disabled\)\s*\{[^}]*color:\s*var\(--text\);[^}]*background:\s*transparent;/s.test(
      layoutCss
    ),
    true,
    "playlist rows must stay on the same neutral menu color matrix"
  );
  assert.equal(
    /\.sidebar-(?:nav|playlist)-item:is\(:hover, :focus-visible, :active\)::before\s*\{[^}]*var\(--sidebar-item-hover-bg\)/s.test(
      layoutCss
    ),
    true
  );
  assert.equal(
    /\.sidebar-playlist-item\s*\{[^}]*transition:[^}]*transform/.test(layoutCss),
    false,
    "playlist hover must not reserve or animate a geometry transform"
  );
});

test("sidebar section actions share one Naive hover and geometry contract", () => {
  assert.equal(
    /const SIDEBAR_SECTION_ACTION_BUTTON = \{[\s\S]*?variant: "tertiary",[\s\S]*?size: "tiny",[\s\S]*?round: true,[\s\S]*?secondary: true,[\s\S]*?strong: true[\s\S]*?satisfies NaivePopselectTriggerButtonProps;/.test(
      naiveSidebarSource
    ),
    true
  );
  assert.equal(
    /props\.variant === "section"\s*\? SIDEBAR_SECTION_ACTION_BUTTON/.test(
      naiveSidebarSource
    ),
    true,
    "the create button must use the same contract as the source trigger"
  );
  assert.equal(
    /triggerButton=\{SIDEBAR_SECTION_ACTION_BUTTON\}/.test(naiveSidebarSource),
    true,
    "the Popselect trigger must use the shared section action contract"
  );

  const sectionActionRule = readRule(".sidebar-section-action-icon");
  assert.equal(/width:\s*36px;/.test(sectionActionRule), true);
  assert.equal(/min-width:\s*36px;/.test(sectionActionRule), true);
  assert.equal(/height:\s*22px;/.test(sectionActionRule), true);
  assert.equal(/min-height:\s*22px;/.test(sectionActionRule), true);
  assert.equal(/(?:background|border-color|box-shadow)\s*:/.test(sectionActionRule), false);
  assert.equal(
    /\.sidebar-section-action-icon(?::hover|\.is-open)/.test(
      `${layoutCss}\n${unlayeredOverridesCss}`
    ),
    false,
    "hover and open state surfaces must stay owned by the shared Naive variant"
  );

  const sectionToggleRule = readRule(".sidebar-section-toggle");
  assert.equal(/position:\s*absolute;/.test(sectionToggleRule), true);
  assert.equal(/inset:\s*0;/.test(sectionToggleRule), true);
  assert.equal(/width:\s*100%;/.test(sectionToggleRule), true);
  assert.equal(/height:\s*100%;/.test(sectionToggleRule), true);
  assert.equal(/border:\s*0;/.test(sectionToggleRule), true);
  assert.equal(/background:\s*transparent;/.test(sectionToggleRule), true);
  assert.equal(
    /\.sidebar-section-header:hover \.sidebar-section-toggle::before,[\s\S]*?background:\s*var\(--sidebar-item-hover-bg\);/.test(
      layoutCss
    ),
    true,
    "playlist disclosure must reuse the NMenu row hover surface"
  );
  assert.equal(/\.sidebar-section-toggle:hover\s*\{/.test(layoutCss), false);
  assert.equal(
    /class=\{`sidebar-section-toggle\$\{sectionCollapsed\(\) \? " is-collapsed" : ""\}`\}[\s\S]*?aria-expanded=\{!sectionCollapsed\(\)\}/.test(
      sidebarSource
    ),
    true
  );
});

test("sidebar expansion paints shell geometry before restoring managed playlist content", () => {
  const shellStart = sidebarSource.indexOf(
    "setExpansionShellContentMounted(collapsePresentation().expandedContentMounted)"
  );
  const lifecycleStart = sidebarSource.indexOf(
    "const generation = collapseLifecycle.beginTransition",
    shellStart
  );
  assert.equal(shellStart >= 0 && lifecycleStart > shellStart, true);
  assert.equal(
    /scheduleExpansionContentReveal[\s\S]*?scheduleCollapseFrame\(\(\) => \{[\s\S]*?scheduleCollapseFrame\(\(\) => \{[\s\S]*?setExpansionShellContentMounted\(null\)/.test(
      sidebarSource
    ),
    true,
    "managed playlist content must return after the shell has received one paint opportunity"
  );
  assert.equal(
    /expandedContentMounted:\s*shellContentMounted,[\s\S]*?expandedContentVisible:\s*false,[\s\S]*?compactContentVisible:\s*true,[\s\S]*?motionActive:\s*presentation\.motionActive/.test(
      sidebarSource
    ),
    true,
    "the shell-only frame must keep motion guards active without mounting cold content"
  );
  assert.equal(/cancelPendingExpansionReveal\(\);[\s\S]*?geometryMotion\?\.dispose\(\)/.test(sidebarSource), true);
});

test("collapsed sidebar nav icons share the rail center without resizing", () => {
  const sidebarRule = readRule(".sidebar");
  assert.equal(/--sidebar-nav-icon-size:\s*22px;/.test(sidebarRule), true);
  assert.equal(
    /--sidebar-collapsed-item-indent:\s*calc\(\s*\(var\(--sidebar-width-collapsed\)\s*-\s*var\(--sidebar-nav-icon-size\)\)\s*\/\s*2\s*\);/.test(
      sidebarRule
    ),
    true,
    "collapsed indent must derive from the rail and icon sizes"
  );

  const iconRule = readRule(".sidebar-nav-icon");
  assert.equal(/width:\s*var\(--sidebar-nav-icon-size\);/.test(iconRule), true);
  assert.equal(/min-width:\s*var\(--sidebar-nav-icon-size\);/.test(iconRule), true);
  assert.equal(/height:\s*var\(--sidebar-nav-icon-size\);/.test(iconRule), true);
  const svgRule = readRule(".sidebar-nav-icon svg");
  assert.equal(/width:\s*var\(--sidebar-nav-icon-size\);/.test(svgRule), true);
  assert.equal(/height:\s*var\(--sidebar-nav-icon-size\);/.test(svgRule), true);

  const navItemRule = readRule(".sidebar-nav-item");
  assert.equal(
    /padding-left\s+var\(--motion-duration-spatial\)/.test(navItemRule),
    true
  );
  assert.equal(
    /padding-right\s+var\(--motion-duration-spatial\)/.test(navItemRule),
    true,
    "the local-playlist action reserve must collapse on the same motion cadence"
  );

  const collapsedRule = readRule(".sidebar.is-collapsed .sidebar-nav-item");
  assert.equal(/padding-right:\s*18px;/.test(collapsedRule), true);
  assert.equal(
    /padding-left:\s*var\(--sidebar-collapsed-item-indent\);/.test(collapsedRule),
    true
  );

  const responsiveRule = readRule(".sidebar .sidebar-nav-item");
  assert.equal(/justify-content:\s*flex-start;/.test(responsiveRule), true);
  assert.equal(
    /padding:\s*0\s+18px\s+0\s+var\(--sidebar-collapsed-item-indent\);/.test(
      responsiveRule
    ),
    true
  );
  assert.equal(
    /\.sidebar\s+\.sidebar-scroll\s*\{[^}]*padding-inline:\s*8px;/.test(layoutCss),
    false,
    "the responsive scroll container must not shift a full-width nav row"
  );
});

test("sidebar motion lifecycle suppresses transient main-content hover retargeting", () => {
  assert.equal(
    /\.app-body:has\(> \.sidebar\.is-collapse-motion-active\) \.app-main\s*\{[\s\S]*?pointer-events:\s*none;/.test(
      layoutCss
    ),
    true
  );
  assert.equal(
    /const COLLAPSE_TRANSITION_PROPERTY = "--sidebar-inline-size";/.test(sidebarSource),
    true
  );
  assert.equal(
    /if \(event\.type === "transitioncancel"\) \{\s*return;\s*\}/.test(sidebarSource),
    true,
    "a cancelled older transition must not settle the latest target"
  );
  assert.equal(
    /collapseLifecycle\.requestSettle\(completedGeneration, collapsed\(\)\)/.test(
      sidebarSource
    ),
    true,
    "only the current transition generation may request settlement"
  );
  assert.equal(
    /const generation = collapseLifecycle\.beginTransition\([\s\S]*?runningCollapseGeneration = generation;/.test(
      sidebarSource
    ),
    true,
    "the click generation must be known even when transitionrun is not delivered"
  );
});

test("sidebar rail keeps one semantic control and a finite pointer corridor", () => {
  const toggleRule = readLastRule(".sidebar-rail-toggle");
  const corridorRule = readRule(".sidebar-rail-toggle-motion-hit-corridor");
  const activeCorridorRule = readRule(
    ".sidebar.is-collapse-motion-active\n    .sidebar-rail-toggle-motion-hit-corridor"
  );

  assert.equal(/z-index:\s*4;/.test(toggleRule), true);
  assert.equal(/z-index:\s*3;/.test(corridorRule), true);
  assert.equal(/top:\s*calc\(50% - 22px\);/.test(corridorRule), true);
  assert.equal(
    /left:\s*calc\(var\(--sidebar-width-collapsed\) - 4px\);/.test(corridorRule),
    true
  );
  assert.equal(/height:\s*44px;/.test(corridorRule), true);
  assert.equal(/pointer-events:\s*none;/.test(corridorRule), true);
  assert.equal(/pointer-events:\s*auto;/.test(activeCorridorRule), true);
  assert.equal(
    /const handleCollapseToggle = \(\): void => \{\s*if \(forceCollapsedNarrow\(\)\) return;/.test(
      sidebarSource
    ),
    true,
    "the transient corridor must preserve the responsive disabled-toggle contract"
  );

  assert.equal(
    /<button[\s\S]*?class="sidebar-rail-toggle"[\s\S]*?aria-expanded=\{!collapsed\(\)\}/.test(
      sidebarSource
    ),
    true
  );
  assert.equal(
    /class="sidebar-rail-toggle-motion-hit-corridor"[\s\S]*?aria-hidden="true"[\s\S]*?onClick=\{handleCollapseToggle\}/.test(
      sidebarSource
    ),
    true
  );
  const corridorStart = sidebarSource.indexOf(
    'class="sidebar-rail-toggle-motion-hit-corridor"'
  );
  const corridorEnd = sidebarSource.indexOf("/>", corridorStart);
  const corridorSource = sidebarSource.slice(corridorStart, corridorEnd);
  assert.equal(/\b(?:role|tabindex|tabIndex)=/.test(corridorSource), false);
});

test("sidebar playlist content uses retained expanded and stable compact variants", () => {
  assert.equal(/data-collapse-phase=\{collapsePhase\(\)\}/.test(sidebarSource), true);
  assert.equal(
    /class="sidebar-playlist-expanded-content"[\s\S]*?hidden=\{!collapsePresentation\(\)\.expandedContentVisible\}[\s\S]*?aria-hidden=\{!collapsePresentation\(\)\.expandedContentVisible\}[\s\S]*?inert=\{!collapsePresentation\(\)\.expandedContentVisible\}/.test(
      sidebarSource
    ),
    true
  );
  assert.equal(
    /class="sidebar-playlist-compact-content"[\s\S]*?hidden=\{!collapsePresentation\(\)\.compactContentVisible\}[\s\S]*?renderCollapsedPlaylistGroup\(groupKey\)/.test(
      sidebarSource
    ),
    true
  );

  const hiddenVariantRule = readRule(
    ".sidebar-playlist-expanded-content[hidden],\n  .sidebar-playlist-compact-content[hidden]"
  );
  assert.equal(/display:\s*none;/.test(hiddenVariantRule), true);

  const playlistCopyRule = readRule(".sidebar-playlist-copy");
  assert.equal(
    /transition:\s*opacity\s+var\(--motion-duration-spatial\)/.test(playlistCopyRule),
    true,
    "the leak fix must preserve the playlist copy fade"
  );
});

test("offline local playlists keep a normal nav entry outside the managed body", () => {
  const start = sidebarSource.indexOf("const renderOfflineLocalPlaylistGroup");
  const end = sidebarSource.indexOf("const renderPlaylistGroup", start);
  assert.equal(start >= 0 && end > start, true);
  const offlineGroupSource = sidebarSource.slice(start, end);

  assert.equal(/<SidebarNavButton[\s\S]*routeKey="library:local-playlists"/.test(offlineGroupSource), true);
  assert.equal(/expanded=\{!sectionCollapsed\(\)\}/.test(offlineGroupSource), true);
  assert.equal(
    /active=\{\(collapsed\(\) \|\| sectionCollapsed\(\)\) && hasActivePlaylist\(\)\}/.test(
      offlineGroupSource
    ),
    true
  );
  assert.equal(/renderPlaylistBody\("created", true\)/.test(offlineGroupSource), true);
  assert.equal(/renderCollapsedPlaylistGroup/.test(offlineGroupSource), false);
  assert.equal(
    /<span[\s\S]*?class=\{`sidebar-local-playlists-toggle[\s\S]*?aria-hidden="true"/.test(
      offlineGroupSource
    ),
    true,
    "the local-playlist chevron must be a row-owned indicator, not a third button state"
  );
  assert.equal(
    /<button[\s\S]*?sidebar-local-playlists-toggle/.test(offlineGroupSource),
    false
  );
  assert.equal(/onClick=\{\(\) => toggleSection\("created"\)\}/.test(offlineGroupSource), true);
  assert.equal(
    /handleOfflinePlaylistGroupActivate[\s\S]*?forceCollapsedNarrow\(\)[\s\S]*?handleCollapseToggle/.test(
      sidebarSource
    ),
    true,
    "a collapsed user rail must expand before exposing the playlist body"
  );

  const actionsRule = readRule(".sidebar-local-playlists-actions");
  assert.equal(
    /transition:\s*opacity\s+var\(--motion-duration-spatial\)\s+var\(--motion-ease-decelerate\)/.test(
      actionsRule
    ),
    true
  );
  const collapsedActionsRule = readRule(".sidebar.is-collapsed .sidebar-local-playlists-actions");
  assert.equal(/opacity:\s*0;/.test(collapsedActionsRule), true);
  assert.equal(/pointer-events:\s*none;/.test(collapsedActionsRule), true);
  const collapsedBodyRule = readRule(
    ".sidebar.is-collapsed .sidebar-local-playlists-body .sidebar-section-body"
  );
  assert.equal(/opacity:\s*0;/.test(collapsedBodyRule), true);
  assert.equal(
    /@keyframes\s+sidebar-local-playlists-body-expand[\s\S]*?grid-template-rows:\s*0fr[\s\S]*?grid-template-rows:\s*1fr/.test(
      layoutCss
    ),
    true
  );
  assert.equal(
    /sidebar\.is-collapse-motion-active:not\(\.is-collapsed\)[\s\S]*?sidebar-local-playlists-body[\s\S]*?animation:\s*sidebar-local-playlists-body-expand\s+var\(--motion-duration-spatial\)/.test(
      layoutCss
    ),
    true,
    "expanding from a retained body must have an explicit zero-to-full entry trajectory"
  );

  const playlistItemRule = readRule(".sidebar-playlist-item");
  assert.equal(/gap:\s*12px;/.test(playlistItemRule), true);
  assert.equal(/min-height:\s*50px;/.test(playlistItemRule), true);
  const coverlessItemRule = readRule(".sidebar-playlist-item.is-cover-hidden");
  assert.equal(
    /min-height:\s*var\(--sidebar-item-height\);/.test(coverlessItemRule),
    true
  );
  const playlistCoverRule = readRule(".sidebar-playlist-cover");
  assert.equal(/width:\s*34px;/.test(playlistCoverRule), true);
  assert.equal(/height:\s*34px;/.test(playlistCoverRule), true);
  const playlistNameRule = readRule(".sidebar-playlist-name");
  assert.equal(/font-size:\s*13px;/.test(playlistNameRule), true);

  const playlistEntryRule = readRule(
    ".sidebar-local-playlists-body .sidebar-playlist-entry"
  );
  assert.equal(/content-visibility:\s*auto;/.test(playlistEntryRule), true);
  assert.equal(
    /contain-intrinsic-size:\s*var\(--sidebar-item-height\);/.test(playlistEntryRule),
    true
  );
  const coveredEntryRule = readRule(
    ".sidebar-local-playlists-body .sidebar-playlist-entry.is-cover-visible"
  );
  assert.equal(/contain-intrinsic-size:\s*50px;/.test(coveredEntryRule), true);
  assert.equal(
    /const playlistEntryClass = \(\): string =>[\s\S]*?sidebar-playlist-entry/.test(
      sidebarSource
    ),
    true
  );

  const localPlaylistListRule = readRule(
    ".sidebar-local-playlists-body .sidebar-playlist-list"
  );
  assert.equal(/width:\s*var\(--sidebar-width\);/.test(localPlaylistListRule), true);
  assert.equal(/min-width:\s*var\(--sidebar-width\);/.test(localPlaylistListRule), true);
  assert.equal(/max-width:\s*var\(--sidebar-width\);/.test(localPlaylistListRule), true);
  assert.equal(
    /contain:\s*(?:layout|paint)/.test(localPlaylistListRule),
    false,
    "the fixed second-level width must not add the rejected containment candidate"
  );
});

test("sidebar brand text collapses without snapping its used width", () => {
  const productRule = readRule(".sidebar-brand-product");
  assert.equal(
    /transition:[\s\S]*?max-width\s+var\(--motion-duration-spatial\)/.test(productRule),
    true
  );

  const collapsedProductRule = readRule(".sidebar.is-collapsed .sidebar-brand-product");
  assert.equal(
    /(?:^|;)\s*width\s*:\s*0(?:px)?\s*(?:;|$)/.test(collapsedProductRule),
    false,
    "collapsed brand text must not bypass its max-width transition"
  );
  assert.equal(
    /(?:^|;)\s*max-width\s*:\s*0(?:px)?\s*(?:;|$)/.test(collapsedProductRule),
    true
  );
});

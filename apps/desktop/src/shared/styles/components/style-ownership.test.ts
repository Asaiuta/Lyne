import assert from "node:assert/strict";
import test from "node:test";

import modalSource from "../../../components/Modal.tsx?raw";
import createPlaylistModalSource from "../../../components/CreatePlaylistModal.tsx?raw";
import loginModalSource from "../../../components/LoginModal.tsx?raw";
import panelErrorBoundarySource from "../../../components/PanelErrorBoundary.tsx?raw";
import albumCardSource from "../../../components/AlbumCard.tsx?raw";
import horizontalCardRowSource from "../../../components/HorizontalCardRow.tsx?raw";
import skeletonSource from "../../../components/page/Skeleton.tsx?raw";
import coverGridSkeletonSource from "../../../components/page/CoverGridSkeleton.tsx?raw";
import pageHeaderSource from "../../../components/page/PageHeader.tsx?raw";
import pageSectionHeadingSource from "../../../components/page/PageSectionHeading.tsx?raw";
import copyLyricsModalSource from "../../../components/player/CopyLyricsModal.tsx?raw";
import ncmCommentsModalSource from "../../../features/online/NcmCommentsModal.tsx?raw";
import queueDrawerSource from "../../../features/queue/QueueDrawer.tsx?raw";
import queuePageSource from "../../../features/queue/QueuePage.tsx?raw";
import libraryActionModalsSource from "../../../features/library/LibraryActionModals.tsx?raw";
import settingsPageSource from "../../../features/settings/SettingsPage.tsx?raw";
import cloudPageSource from "../../../features/online/CloudPage.tsx?raw";
import neteasePageSource from "../../../features/online/NeteasePage.tsx?raw";
import neteaseHomeFeedSource from "../../../features/online/NeteaseHomeFeed.tsx?raw";
import neteaseRadioSource from "../../../features/online/NeteaseRadioPage.tsx?raw";
import personalFmSource from "../../../features/online/PersonalFmPage.tsx?raw";
import songWikiSource from "../../../features/online/SongWikiPage.tsx?raw";
import mediaListSource from "../../../components/media/MediaList.tsx?raw";
import albumDetailSource from "../../../features/online/details/AlbumDetail.tsx?raw";
import artistDetailSource from "../../../features/online/details/ArtistDetail.tsx?raw";
import cloudMatchModalSource from "../../../features/online/details/CloudMatchModal.tsx?raw";
import dailySongsBatchModalSource from "../../../features/online/details/DailySongsBatchModal.tsx?raw";
import dailySongsDetailSource from "../../../features/online/details/DailySongsDetail.tsx?raw";
import ncmListDetailSource from "../../../features/online/details/NcmListDetail.tsx?raw";
import playlistDetailSource from "../../../features/online/details/PlaylistDetail.tsx?raw";
import resourceCommentsSource from "../../../features/online/details/ResourceCommentsPanel.tsx?raw";
import updatePlaylistModalSource from "../../../features/online/details/UpdatePlaylistModal.tsx?raw";
import videoDetailSource from "../../../features/online/details/VideoDetail.tsx?raw";
import discoverModeSource from "../../../features/online/modes/DiscoverMode.tsx?raw";
import discoverShowcasesSource from "../../../features/online/modes/discoverShowcases.tsx?raw";
import likedCollectionSource from "../../../features/online/modes/LikedCollectionMode.tsx?raw";
import recommendModeSource from "../../../features/online/modes/RecommendMode.tsx?raw";
import searchModeSource from "../../../features/online/modes/SearchMode.tsx?raw";
import modalEntryCss from "./modals.css?raw";
import shellEntryCss from "./shell.css?raw";
import globalCss from "../global.css?raw";
import modalBaseCss from "../modals/base.css?raw";
import categoryModalCss from "../modals/category-modal.css?raw";
import settingsModalCss from "../modals/category-load-settings.css?raw";
import historyCss from "../pages/history.css?raw";
import localLibraryCss from "../pages/local-library.css?raw";
import mediaListCss from "../pages/media-list.css?raw";
import ncmAlbumDetailCss from "../pages/ncm-album-detail.css?raw";
import ncmArtistDetailCss from "../pages/ncm-artist-detail.css?raw";
import ncmCommentsCss from "../pages/ncm-comments.css?raw";
import ncmDailyDetailCss from "../pages/ncm-daily-detail.css?raw";
import ncmDetailsCss from "../pages/ncm-details.css?raw";
import ncmVideoDetailCss from "../pages/ncm-video-detail.css?raw";
import onlineCatalogCardsCss from "../pages/online-catalog-cards.css?raw";
import onlineDiscoverCss from "../pages/online-discover.css?raw";
import onlineSearchCss from "../pages/online-search.css?raw";
import likedCollectionCss from "../pages/liked-collection.css?raw";
import playlistDetailCss from "../pages/playlist-detail.css?raw";
import pageActionsCss from "../pages/page-actions.css?raw";
import panelErrorBoundaryCss from "./panel-error-boundary.css?raw";
import songWikiCss from "../pages/song-wiki.css?raw";
import queueCss from "../pages/queue.css?raw";
import playerPopoversCss from "../player/popovers.css?raw";
import playerProgressCss from "../player/progress.css?raw";
import playerUtilityCss from "../player/utility.css?raw";
import shellLayoutCss from "../shell/layout.css?raw";
import shellOverridesCss from "../shell/unlayered-overrides.css?raw";
import transitionsCss from "../transitions.css?raw";
import naiveStylesCss from "../../ui/naive/styles.css?raw";

const shellCss = `${shellLayoutCss}\n${shellOverridesCss}`;

test("generic Modal loads only its base shell styles", () => {
  assert.equal(/import "\.\.\/shared\/styles\/components\/modals\.css";/.test(modalSource), true);
  assert.equal(
    modalEntryCss.trim(),
    '@import "../modals/base.css" layer(components);'
  );
  assert.equal(/media-comments|copy-lyrics/.test(modalBaseCss), false);
});

test("modal, card, and settings style families are imported by their render owners", () => {
  const ownershipContracts: ReadonlyArray<readonly [string, RegExp]> = [
    [queueDrawerSource, /import "\.\.\/\.\.\/shared\/styles\/components\/queue-drawer\.css";/],
    [loginModalSource, /import "\.\.\/shared\/styles\/components\/login-modal\.css";/],
    [albumCardSource, /import "\.\.\/shared\/styles\/components\/content-cards\.css";/],
    [horizontalCardRowSource, /import "\.\.\/shared\/styles\/components\/content-cards\.css";/],
    [coverGridSkeletonSource, /import "\.\.\/\.\.\/shared\/styles\/components\/content-cards\.css";/],
    [coverGridSkeletonSource, /import "\.\.\/\.\.\/shared\/styles\/pages\/album-grid\.css";/],
    [ncmCommentsModalSource, /import "\.\.\/\.\.\/shared\/styles\/components\/ncm-comments-modal\.css";/],
    [copyLyricsModalSource, /import "\.\.\/\.\.\/shared\/styles\/components\/copy-lyrics-modal\.css";/],
    [settingsPageSource, /import "\.\.\/\.\.\/shared\/styles\/modals\/category-load-settings\.css";/],
    [discoverModeSource, /import "\.\.\/\.\.\/\.\.\/shared\/styles\/modals\/category-modal\.css";/]
  ];

  for (const [source, importPattern] of ownershipContracts) {
    assert.equal(importPattern.test(source), true, importPattern.source);
  }

  assert.equal(/content-cards\.css|album-grid\.css/.test(skeletonSource), false);
});

test("shared page and queue surfaces import their own style owners", () => {
  assert.equal(/import "\.\.\/\.\.\/shared\/styles\/components\/page-header\.css";/.test(pageHeaderSource), true);
  assert.equal(/import "\.\.\/\.\.\/shared\/styles\/pages\/queue\.css";/.test(queuePageSource), true);
  assert.equal(/import "\.\.\/\.\.\/shared\/styles\/pages\/settings\.css";/.test(settingsPageSource), true);
  assert.equal(/queue-form-group|queue-input/.test(queuePageSource), true);
  assert.equal(/settings-group|class="text-input"/.test(queuePageSource), false);
  assert.equal(/import "\.\.\/shared\/styles\/components\/panel-error-boundary\.css";/.test(panelErrorBoundarySource), true);
  assert.equal(/\.panel-error-boundary\b/.test(panelErrorBoundaryCss), true);
  assert.equal(/\.panel-error-boundary\b/.test(ncmCommentsCss), false);
});

test("playlist modal forms reuse NaiveForm without borrowing create-playlist selectors", () => {
  const formSources = [
    createPlaylistModalSource,
    cloudMatchModalSource,
    updatePlaylistModalSource
  ];

  for (const source of formSources) {
    assert.equal(/<NaiveForm\b/.test(source), true);
    assert.equal(/<NaiveFormItem\b/.test(source), true);
    assert.equal(
      /create-playlist-(?:modal|field|switch|description|feedback|submit)/.test(source),
      false
    );
  }

  assert.equal(
    /import "\.\.\/\.\.\/\.\.\/shared\/styles\/components\/ncm-cloud-match-modal\.css";/.test(
      cloudMatchModalSource
    ),
    true
  );
  assert.equal(
    /import "\.\.\/\.\.\/\.\.\/shared\/styles\/components\/ncm-update-playlist-modal\.css";/.test(
      updatePlaylistModalSource
    ),
    true
  );
  assert.equal(/\.create-playlist-(?:modal|field|switch|description|feedback|submit)\b/.test(shellCss), false);
});

test("batch selection and online modal styles stay with their render owners", () => {
  assert.equal(
    /import "\.\.\/\.\.\/shared\/styles\/components\/selection-action-modals\.css";/.test(
      libraryActionModalsSource
    ),
    true
  );
  assert.equal(
    /import "\.\.\/\.\.\/\.\.\/shared\/styles\/components\/selection-action-modals\.css";/.test(
      dailySongsBatchModalSource
    ),
    true
  );
  assert.equal(
    /import "\.\.\/\.\.\/\.\.\/shared\/styles\/components\/ncm-daily-batch-modal\.css";/.test(
      dailySongsBatchModalSource
    ),
    true
  );

  assert.equal(
    /\.ncm-(?:daily-batch|cloud-match|update-playlist)-|\.playlist-detail-/.test(
      localLibraryCss
    ),
    false
  );
});

test("online route styles are imported by their render owners", () => {
  const ownershipContracts: ReadonlyArray<readonly [string, RegExp]> = [
    [neteasePageSource, /import "\.\.\/\.\.\/shared\/styles\/pages\/online-page\.css";/],
    [cloudPageSource, /import "\.\.\/\.\.\/shared\/styles\/pages\/cloud\.css";/],
    [cloudPageSource, /import "\.\.\/\.\.\/shared\/styles\/pages\/online-shared\.css";/],
    [neteaseRadioSource, /import "\.\.\/\.\.\/shared\/styles\/pages\/radio\.css";/],
    [neteaseRadioSource, /import "\.\.\/\.\.\/shared\/styles\/pages\/online-catalog-cards\.css";/],
    [personalFmSource, /import "\.\.\/\.\.\/shared\/styles\/pages\/online-shared\.css";/],
    [recommendModeSource, /import "\.\.\/\.\.\/\.\.\/shared\/styles\/pages\/online-recommend\.css";/],
    [discoverModeSource, /import "\.\.\/\.\.\/\.\.\/shared\/styles\/pages\/online-discover\.css";/],
    [discoverModeSource, /import "\.\.\/\.\.\/\.\.\/shared\/styles\/pages\/online-catalog-cards\.css";/],
    [searchModeSource, /import "\.\.\/\.\.\/\.\.\/shared\/styles\/pages\/online-search\.css";/],
    [searchModeSource, /import "\.\.\/\.\.\/\.\.\/shared\/styles\/pages\/online-shared\.css";/],
    [likedCollectionSource, /import "\.\.\/\.\.\/\.\.\/shared\/styles\/pages\/liked-collection\.css";/],
    [neteaseHomeFeedSource, /import "\.\.\/\.\.\/shared\/styles\/pages\/ncm-home\.css";/],
    [neteaseHomeFeedSource, /import "\.\.\/\.\.\/shared\/styles\/pages\/online-catalog-cards\.css";/]
  ];

  for (const [source, importPattern] of ownershipContracts) {
    assert.equal(importPattern.test(source), true, importPattern.source);
  }

  const routeSources = [
    neteasePageSource,
    cloudPageSource,
    neteaseRadioSource,
    personalFmSource,
    recommendModeSource,
    discoverModeSource,
    searchModeSource,
    likedCollectionSource,
    neteaseHomeFeedSource
  ].join("\n");
  assert.equal(/online-pages\.css|cloud-search-liked-radio\.css/.test(routeSources), false);
});

test("online empty states use the shared semantic class", () => {
  assert.equal(/class="online-empty-state"/.test(cloudPageSource), true);
  assert.equal(/class="online-empty-state"/.test(searchModeSource), true);
  assert.equal(/online-search-empty/.test([cloudPageSource, searchModeSource].join("\n")), false);
});

test("detail and comment styles are imported below the route boundary", () => {
  const detailContracts: ReadonlyArray<readonly [string, RegExp]> = [
    [ncmListDetailSource, /import "\.\.\/\.\.\/\.\.\/shared\/styles\/pages\/ncm-details\.css";/],
    [albumDetailSource, /import "\.\.\/\.\.\/\.\.\/shared\/styles\/pages\/ncm-details\.css";/],
    [artistDetailSource, /import "\.\.\/\.\.\/\.\.\/shared\/styles\/pages\/ncm-details\.css";/],
    [dailySongsDetailSource, /import "\.\.\/\.\.\/\.\.\/shared\/styles\/pages\/ncm-details\.css";/],
    [videoDetailSource, /import "\.\.\/\.\.\/\.\.\/shared\/styles\/pages\/ncm-details\.css";/],
    [playlistDetailSource, /import "\.\.\/\.\.\/\.\.\/shared\/styles\/pages\/ncm-details\.css";/],
    [playlistDetailSource, /import "\.\.\/\.\.\/\.\.\/shared\/styles\/pages\/playlist-detail\.css";/],
    [resourceCommentsSource, /import "\.\.\/\.\.\/\.\.\/shared\/styles\/pages\/ncm-comments\.css";/]
  ];

  for (const [source, importPattern] of detailContracts) {
    assert.equal(importPattern.test(source), true, importPattern.source);
  }
  assert.equal(/pages\/ncm-(?:details|comments)\.css/.test(neteaseRadioSource), false);
});

test("detail private styles stay with the detail that renders them", () => {
  const ownerImports: ReadonlyArray<readonly [string, RegExp]> = [
    [dailySongsDetailSource, /import "\.\.\/\.\.\/\.\.\/shared\/styles\/pages\/ncm-daily-detail\.css";/],
    [artistDetailSource, /import "\.\.\/\.\.\/\.\.\/shared\/styles\/pages\/ncm-artist-detail\.css";/],
    [albumDetailSource, /import "\.\.\/\.\.\/\.\.\/shared\/styles\/pages\/ncm-album-detail\.css";/],
    [videoDetailSource, /import "\.\.\/\.\.\/\.\.\/shared\/styles\/pages\/ncm-video-detail\.css";/]
  ];

  for (const [source, importPattern] of ownerImports) {
    assert.equal(importPattern.test(source), true, importPattern.source);
  }

  assert.equal(/\.ncm-(?:daily|artist|album|video)-/.test(ncmDetailsCss), false);
  assert.equal(/\.ncm-artist-subscribe\b/.test(ncmDetailsCss), false);
  assert.equal(/\.ncm-(?:artist|album|video)-/.test(ncmDailyDetailCss), false);
  assert.equal(/\.ncm-(?:daily|album|video)-/.test(ncmArtistDetailCss), false);
  assert.equal(/\.ncm-(?:daily|artist|video)-/.test(ncmAlbumDetailCss), false);
  assert.equal(/\.ncm-(?:daily|artist|album)-/.test(ncmVideoDetailCss), false);
  assert.equal(/\.ncm-video-/.test(ncmCommentsCss), false);
  assert.equal(/ncm-detail-surface|ncm-detail-back/.test(
    [albumDetailSource, artistDetailSource, dailySongsDetailSource, videoDetailSource].join("\n")
  ), true);
});

test("cross-route style boundaries do not regress through legacy selectors", () => {
  const shellSources = `${shellEntryCss}\n${shellLayoutCss}\n${shellOverridesCss}`;
  assert.equal(/actions\.css|settings\.css|online-pages|cloud-search-liked-radio/.test(shellEntryCss), false);
  assert.equal(/\.ncm-|\.online-(?:search|discover|empty)|\.media-list-|\.queue-form-group|\.settings-search|\.modal-card/.test(shellSources), false);
  assert.equal(/queue-|library-(?:page|playlist|track)/.test(historyCss), false);
  assert.equal(/\.settings-group\b|\.text-input\b/.test(queueCss), false);
  assert.equal(/\.settings-|\.cat-modal|\.modal-card|\.top-nav-|\.context-menu|\.player-progress-tooltip|\.command-error-toast/.test(playerPopoversCss), false);
  assert.equal(/floating-layer-enter/.test(transitionsCss), true);
});

test("shared reduced-motion rules are owned by the rendered surface", () => {
  assert.equal(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.n-popover\.n-popover-shared[\s\S]*\.n-dropdown\.n-dropdown-menu/.test(naiveStylesCss), true);
  assert.equal(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.player-progress-tooltip/.test(playerProgressCss), true);
  assert.equal(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.command-error-toast/.test(playerUtilityCss), true);
  assert.equal(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.cat-modal/.test(categoryModalCss), true);
  assert.equal(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.modal-card/.test(modalBaseCss), true);
  assert.equal(/@keyframes settings-slide-up-fade-in/.test(settingsModalCss), true);
  assert.equal(/@keyframes (?:settings-)?slide-up-fade-in/.test(globalCss), false);
});

test("shared and route CSS do not borrow another feature's private selectors", () => {
  assert.equal(/playlist-detail-/.test(cloudPageSource), false);
  assert.equal(/online-search-card-grid--videos/.test(discoverShowcasesSource), false);
  assert.equal(/online-discover-video-grid/.test(discoverShowcasesSource), true);
  assert.equal(/online-discover-section/.test(neteaseRadioSource), false);
  assert.equal(/online-catalog-context/.test(neteaseRadioSource), true);
  assert.equal(/\.online-playlist-/.test(playlistDetailCss), false);
  assert.equal(/\.online-playlist-/.test(shellCss), false);
  assert.equal(/\.online-playlist-/.test(shellOverridesCss), false);
  assert.equal(/\.ncm-home-feed|\.media-sort-|\.media-list-float-/.test(onlineDiscoverCss), false);
  assert.equal(/\.online-catalog-context\s+\.album-card/.test(onlineCatalogCardsCss), true);
  assert.equal(/\.(?:danger-button|empty-tab(?:-icon)?)\b/.test(localLibraryCss), false);
  assert.equal(/\.row-action\b/.test(mediaListCss), false);
});

test("shared page headings preserve the native prefixed H3 contract", () => {
  assert.equal(
    /import "\.\.\/\.\.\/shared\/styles\/components\/page-section-heading\.css";/.test(
      pageSectionHeadingSource
    ),
    true
  );
  assert.equal(/<NaiveH3[^>]*\bprefix="bar"/.test(pageSectionHeadingSource), true);
  assert.equal(/<PageSectionHeading\b/.test(songWikiSource), true);
  assert.equal(/<PageSectionHeading\b/.test(personalFmSource), true);
  assert.equal(/song-wiki-section-title/.test([songWikiSource, personalFmSource, songWikiCss].join("\n")), false);
});

test("load-more placement and catalog card tokens have shared semantic owners", () => {
  assert.equal(/class="load-more-button-row"/.test(discoverShowcasesSource), true);
  assert.equal(/class="load-more-button-row"/.test(artistDetailSource), true);
  assert.equal(/\.load-more-button-row\s*\{/.test(pageActionsCss), true);
  assert.equal(/\.online-discover-load-more\b/.test(onlineDiscoverCss), false);
  assert.equal(/--online-discover-card-/.test(onlineDiscoverCss), false);
  assert.equal(/--online-discover-/.test(onlineCatalogCardsCss), false);
});

test("MediaList owns the sort popover and floating tools it renders", () => {
  assert.equal(/import "\.\.\/\.\.\/shared\/styles\/pages\/media-list\.css";/.test(mediaListSource), true);
  assert.equal(/\.media-sort-popover\b/.test(mediaListCss), true);
  assert.equal(/\.media-list-float-tools\b/.test(mediaListCss), true);
});

test("responsive route tabs reuse the shared segmented fallback contract", () => {
  assert.equal(/<SegmentedTabs\b/.test(searchModeSource), true);
  assert.equal(/<SegmentedTabs\b/.test(likedCollectionSource), true);
  assert.equal(/<NaiveTabs\b/.test(searchModeSource), false);
  assert.equal(/<NaiveTabs\b/.test(likedCollectionSource), false);
  assert.equal(/naive-tabs-select|\.n-tabs\s*\{[^}]*display:\s*none/.test(onlineSearchCss), false);
  assert.equal(/naive-tabs-select|\.n-tabs\s*\{[^}]*display:\s*none/.test(likedCollectionCss), false);
});

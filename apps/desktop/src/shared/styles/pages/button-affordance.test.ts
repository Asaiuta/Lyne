import assert from "node:assert/strict";
import test from "node:test";

import loginModalSource from "../../../components/LoginModal.tsx?raw";
import topNavSource from "../../../components/TopNav.tsx?raw";
import windowControlsSource from "../../../components/WindowControls.tsx?raw";
import pageBackButtonSource from "../../../components/page/PageBackButton.tsx?raw";
import loadMoreButtonSource from "../../../components/page/LoadMoreButton.tsx?raw";
import albumDetailSource from "../../../features/online/details/AlbumDetail.tsx?raw";
import artistDetailSource from "../../../features/online/details/ArtistDetail.tsx?raw";
import dailySongsDetailSource from "../../../features/online/details/DailySongsDetail.tsx?raw";
import playlistDetailSource from "../../../features/online/details/PlaylistDetail.tsx?raw";
import resourceCommentsSource from "../../../features/online/details/ResourceCommentsPanel.tsx?raw";
import videoDetailSource from "../../../features/online/details/VideoDetail.tsx?raw";
import discoverShowcasesSource from "../../../features/online/modes/discoverShowcases.tsx?raw";
import neteaseRadioSource from "../../../features/online/NeteaseRadioPage.tsx?raw";
import personalFmSource from "../../../features/online/PersonalFmPage.tsx?raw";
import songWikiSource from "../../../features/online/SongWikiPage.tsx?raw";
import queuePageSource from "../../../features/queue/QueuePage.tsx?raw";
import loginCss from "../modals/login.css?raw";
import categoryLoadCss from "../modals/category-load-settings.css?raw";
import ncmCommentsCss from "./ncm-comments.css?raw";
import ncmDetailsCss from "./ncm-details.css?raw";
import playlistDetailCss from "./playlist-detail.css?raw";
import pageActionsCss from "./page-actions.css?raw";
import personalFmCss from "./personal-fm.css?raw";
import shellActionsCss from "../shell/actions.css?raw";
import shellLayoutCss from "../shell/layout.css?raw";
import naiveButtonCss from "../../ui/naive/styles.css?raw";

const targetSources = [
  albumDetailSource,
  artistDetailSource,
  dailySongsDetailSource,
  discoverShowcasesSource,
  neteaseRadioSource,
  personalFmSource,
  playlistDetailSource,
  queuePageSource,
  resourceCommentsSource,
  songWikiSource,
  videoDetailSource
] as const;

test("NaiveButton exposes the SPlayer size and state matrix", () => {
  assert.equal(/--n-button-height:\s*34px;/.test(naiveButtonCss), true);
  assert.equal(/--n-button-padding-round:\s*0 18px;/.test(naiveButtonCss), true);
  assert.equal(/--n-button-icon-size:\s*18px;/.test(naiveButtonCss), true);
  assert.equal(/\.naive-button\s*\{[\s\S]*?border:\s*0;/.test(naiveButtonCss), true);
  assert.equal(
    /\.naive-button\.is-secondary\s*\{[\s\S]*?border-color:\s*transparent;/.test(
      naiveButtonCss
    ),
    true
  );
  assert.equal(
    /\.naive-button\.is-secondary:hover:not\(:disabled\)[\s\S]*?var\(--naive-button-color-2-hover\)/.test(
      naiveButtonCss
    ),
    true
  );
  assert.equal(
    /\.naive-button\.is-secondary:active:not\(:disabled\)[\s\S]*?var\(--naive-button-color-2-pressed\)/.test(
      naiveButtonCss
    ),
    true
  );
  assert.equal(/\.naive-button:disabled\s*\{[\s\S]*?opacity:\s*0\.38;/.test(naiveButtonCss), true);
  assert.equal(
    /\.naive-button--large\s*\{[\s\S]*?--n-button-height:\s*40px;/.test(
      naiveButtonCss
    ),
    true
  );
  assert.equal(/\.naive-button\.is-circle\s*\{[\s\S]*?width:\s*var\(--n-button-height\);/.test(naiveButtonCss), true);
  assert.equal(
    /\.naive-button\.is-tertiary:hover:not\(:disabled\)[\s\S]*?color:\s*var\(--naive-text-color-2\);[\s\S]*?background:\s*var\(--naive-button-color-2-hover\);/.test(
      naiveButtonCss
    ),
    true
  );
  assert.equal(
    /\.naive-button--tertiary\.is-secondary:hover:not\(:disabled\)[\s\S]*?color:\s*var\(--naive-text-color-3\);/.test(
      naiveButtonCss
    ),
    true
  );
});

test("top nav icon actions use the neutral Naive tertiary circle contract", () => {
  assert.equal((topNavSource.match(/<NaiveButton\b/g) ?? []).length, 3);
  assert.equal((topNavSource.match(/class="top-nav-icon-button"[\s\S]*?circle[\s\S]*?tertiary/g) ?? []).length, 3);
  const topNavRule = /\.top-nav-icon-button\s*\{([^}]*)\}/.exec(shellLayoutCss)?.[1] ?? "";
  assert.equal(/--n-button-height:\s*40px;/.test(topNavRule), true);
  assert.equal(/--n-button-icon-size:\s*18px;/.test(topNavRule), true);
  assert.equal(/color-primary-tonal-08/.test(topNavRule), false);
  assert.equal(/\.top-nav-icon-button:hover/.test(shellLayoutCss), false);
});

test("window controls use the same neutral Naive tertiary circle contract", () => {
  assert.equal((windowControlsSource.match(/<NaiveButton\b/g) ?? []).length, 3);
  assert.equal(
    (windowControlsSource.match(/class="window-control-button[\s\S]*?circle[\s\S]*?tertiary/g) ?? []).length,
    3
  );
  assert.equal(/dataNoDrag/.test(windowControlsSource), true);
  assert.equal(/\.window-control-button:hover/.test(shellLayoutCss), false);
  assert.equal(/\.window-control-button\.is-close:hover/.test(shellLayoutCss), false);
});

test("login cancel uses the reference Naive secondary action", () => {
  assert.equal(
    /class="login-modal-cancel"[\s\S]*?round[\s\S]*?secondary[\s\S]*?size="medium"[\s\S]*?strong/.test(
      loginModalSource
    ),
    true
  );
  const cancelRule = loginCss.match(/\.login-modal-cancel\s*\{([^}]*)\}/)?.[1];
  assert.equal(Boolean(cancelRule), true, "login cancel layout rule must exist");
  assert.equal(/(?:padding|border|background|font-size)/.test(cancelRule ?? ""), false);
});

test("back and load-more controls stay on shared semantic facades", () => {
  assert.equal(/ariaLabel={props\.ariaLabel}/.test(pageBackButtonSource), true);
  assert.equal(/title={props\.title \?\? props\.ariaLabel}/.test(pageBackButtonSource), true);
  assert.equal(/round[\s\S]*?secondary[\s\S]*?size="large"/.test(pageBackButtonSource), true);
  assert.equal(/<NaiveButton/.test(loadMoreButtonSource), true);
  assert.equal(/disabled={props\.disabled \|\| props\.loading}/.test(loadMoreButtonSource), true);
  assert.equal(/load-more-button-spinner/.test(loadMoreButtonSource), true);
  assert.equal(/<LoadMoreButton/.test(discoverShowcasesSource), true);
  assert.equal(/function LoadMoreButton/.test(discoverShowcasesSource), false);
});

test("queue row actions remain icon-only and named", () => {
  assert.equal(/IconPlayFilled/.test(queuePageSource), true);
  assert.equal(/IconDeleteFilled/.test(queuePageSource), true);
  assert.equal(/ariaLabel={t\("queue\.entry\.play"\)}/.test(queuePageSource), true);
  assert.equal(/ariaLabel={t\("queue\.entry\.remove"\)}/.test(queuePageSource), true);
  assert.equal((queuePageSource.match(/class="queue-command-button"/g) ?? []).length, 5);
  assert.equal(/primary-button/.test(queuePageSource), false);
});

test("migrated affordance surfaces contain no ghost-button contract", () => {
  for (const source of targetSources) {
    assert.equal(/ghost-button/.test(source), false);
  }
  for (const css of [
    categoryLoadCss,
    loginCss,
    ncmCommentsCss,
    ncmDetailsCss,
    pageActionsCss,
    playlistDetailCss,
    shellActionsCss
  ]) {
    assert.equal(/ghost-button/.test(css), false);
  }
  assert.equal(/\.(?:primary-button|page-action)\b/.test(shellActionsCss), false);
  assert.equal(
    /personal-fm-(?:play|icon-button):hover[^\{]*\{[^}]*transform\s*:/s.test(
      personalFmCss
    ),
    false
  );
  assert.equal(/primary-button/.test(personalFmSource), false);
  assert.equal(
    /<NaiveButton[\s\S]*?circle[\s\S]*?secondary[\s\S]*?class="personal-fm-play"/.test(
      personalFmSource
    ),
    true
  );
});

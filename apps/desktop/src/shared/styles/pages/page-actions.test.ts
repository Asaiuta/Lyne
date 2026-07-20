import assert from "node:assert/strict";
import test from "node:test";

import downloadPageSource from "../../../features/download/DownloadPage.tsx?raw";
import historyPageSource from "../../../features/history/HistoryPage.tsx?raw";
import libraryPageSource from "../../../features/library/LibraryPage.tsx?raw";
import libraryPlaylistsSource from "../../../features/library/LibraryPlaylistsView.tsx?raw";
import pageActionsCss from "./page-actions.css?raw";

const toolbarSurfaces = [
  ["download", downloadPageSource],
  ["history", historyPageSource],
  ["library", libraryPageSource],
  ["library playlists", libraryPlaylistsSource]
] as const;

const referenceIconSurfaces = [
  ["library", libraryPageSource, ["IconPlayFilled", "IconRefreshFilled", "IconDeleteFilled", "IconFormatListFilled"]],
  ["history", historyPageSource, ["IconPlayFilled", "IconDeleteFilled"]],
  ["download", downloadPageSource, ["IconPlayFilled", "IconRefreshFilled"]]
] as const;

test("page toolbar buttons keep the shared SPlayer state matrix", () => {
  assert.equal(/button\.page-toolbar-button\s*\{[\s\S]*?height:\s*40px;/.test(pageActionsCss), true);
  assert.equal(/button\.page-toolbar-button\.page-toolbar-button--primary\s*\{[\s\S]*?16%/.test(pageActionsCss), true);
  assert.equal(/page-toolbar-button\.page-toolbar-button--primary:hover:not\(:disabled\)[\s\S]*?22%/.test(pageActionsCss), true);
  assert.equal(/page-toolbar-button\.page-toolbar-button--primary:active:not\(:disabled\)[\s\S]*?28%/.test(pageActionsCss), true);
  assert.equal(/button\.page-toolbar-button\.page-toolbar-button--icon\s*\{[\s\S]*?width:\s*40px;/.test(pageActionsCss), true);
  assert.equal(/rgb\(46 51 56 \/ 0\.05\)/.test(pageActionsCss), true);
  assert.equal(/rgb\(46 51 56 \/ 0\.09\)/.test(pageActionsCss), true);
  assert.equal(/rgb\(46 51 56 \/ 0\.13\)/.test(pageActionsCss), true);
  assert.equal(/box-shadow:\s*none;/.test(pageActionsCss), true);
});

test("matching page action surfaces use the shared toolbar button contract", () => {
  for (const [name, source] of toolbarSurfaces) {
    assert.equal(
      /<PageToolbarButton\b/.test(source),
      true,
      `${name} must use PageToolbarButton`
    );
  }
});

test("toolbar surfaces keep the reference filled icon assets", () => {
  for (const [name, source, icons] of referenceIconSurfaces) {
    for (const icon of icons) {
      assert.equal(
        new RegExp(`<${icon}\\s*/>`).test(source),
        true,
        `${name} must use ${icon}`
      );
    }
  }
});

test("left toolbar menus stay edge-aligned with bottom-start placement", () => {
  assert.equal(
    /placement="bottom-start"/.test(libraryPageSource),
    true,
    "library menu must stay left aligned"
  );
});

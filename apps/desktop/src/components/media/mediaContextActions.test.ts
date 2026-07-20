import assert from "node:assert/strict";
import test from "node:test";
import type { TranslationKey } from "../../shared/i18n";
import type { UISettings } from "../../shared/state/uiSettingsModel";
import {
  createMediaContextMenuItems,
  DEFAULT_MEDIA_CONTEXT_ACTIONS,
  hasVisibleMediaContextActions
} from "./mediaContextActions";
import type { MediaContextAction } from "./mediaContextActions";

const baseContextMenuOptions = {
  play: true,
  playNext: true,
  addToPlaylist: true,
  mv: true,
  dislike: true,
  more: true,
  copyName: true,
  musicTagEditor: true,
  cloudImport: true,
  deleteFromPlaylist: true,
  deleteFromCloud: true,
  deleteFromLocal: true,
  openFolder: true,
  cloudMatch: true,
  wiki: true,
  search: true,
  download: true,
  deleteFromLibrary: true,
  delete: true
};

const settings = (
  overrides: {
    useOnlineService?: boolean;
    contextMenuOptions?: Partial<typeof baseContextMenuOptions>;
  } = {}
): UISettings => ({
  useOnlineService: overrides.useOnlineService ?? true,
  contextMenuOptions: {
    ...baseContextMenuOptions,
    ...overrides.contextMenuOptions
  }
}) as UISettings;

const labels = (key: TranslationKey): string => key;

const keysOf = (actions: readonly MediaContextAction[], target: { songId?: number; mvId?: number | null } | null) =>
  createMediaContextMenuItems({
    actionSet: new Set(actions),
    settings: settings(),
    target,
    t: labels,
    renderIcons: false
  }).map((item) => item.key);

test("context menu uses action descriptors to hide song-only actions without a song id", () => {
  assert.deepEqual(
    keysOf(["play", "copy-id", "share-link", "view-comments", "mv"], null),
    ["play"]
  );
});

test("context menu hides online actions while preserving local actions offline", () => {
  const menu = createMediaContextMenuItems({
    actionSet: new Set(["play", "view-comments", "search", "copy-name", "copy-path"]),
    settings: settings({ useOnlineService: false }),
    target: { songId: 42 },
    t: labels,
    renderIcons: false
  });
  const actionableItems = menu.filter((item) => !item.divider);

  assert.deepEqual(actionableItems.map((item) => item.key), ["play", "more", "copy-path"]);
  assert.deepEqual(
    actionableItems.find((item) => item.key === "more")?.children?.map((item) => item.key),
    ["copy-name"]
  );
});

test("context menu keeps submenu dividers only between visible children", () => {
  const menu = createMediaContextMenuItems({
    actionSet: new Set(["copy-name", "music-tag-editor"]),
    settings: settings({ contextMenuOptions: { musicTagEditor: false } }),
    target: null,
    t: labels,
    renderIcons: false
  });

  assert.equal(menu.length, 1);
  assert.equal(menu[0]?.key, "more");
  assert.deepEqual(menu[0]?.children?.map((item) => item.key), ["copy-name"]);
});

test("context menu preserves dynamic delete labels in the descriptor-built item", () => {
  const menu = createMediaContextMenuItems({
    actionSet: new Set(["delete"]),
    settings: settings(),
    target: null,
    t: labels,
    deleteActionLabel: "Remove from queue",
    renderIcons: false
  });

  assert.equal(menu[0]?.key, "delete");
  assert.equal(menu[0]?.label, "Remove from queue");
});

test("default context actions have at least one visible action for regular songs", () => {
  assert.equal(
    hasVisibleMediaContextActions(
      new Set(DEFAULT_MEDIA_CONTEXT_ACTIONS),
      settings(),
      { songId: 42 }
    ),
    true
  );
});

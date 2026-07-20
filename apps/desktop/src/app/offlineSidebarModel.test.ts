import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SIDEBAR_HIDDEN_ITEMS } from "../shared/state/uiSettingsModel";
import {
  OFFLINE_SIDEBAR_BLOCKS,
  isOfflineSidebarBlockActive,
  visibleOfflineSidebarBlocks
} from "./offlineSidebarModel";

test("offline sidebar blocks keep the approved stable order", () => {
  assert.deepEqual(
    OFFLINE_SIDEBAR_BLOCKS.map((block) =>
      block.kind === "library"
        ? block.tab
        : block.kind === "local-playlists"
          ? "local-playlists"
          : block.page
    ),
    ["songs", "local-playlists", "albums", "artists", "folders", "recent"]
  );
});

test("empty data cannot hide offline blocks", () => {
  assert.equal(visibleOfflineSidebarBlocks(DEFAULT_SIDEBAR_HIDDEN_ITEMS).length, 6);
});

test("each explicit visibility setting hides only its own block", () => {
  for (const block of OFFLINE_SIDEBAR_BLOCKS) {
    const hiddenItems = { ...DEFAULT_SIDEBAR_HIDDEN_ITEMS, [block.settingKey]: true };
    const visible = visibleOfflineSidebarBlocks(hiddenItems);
    assert.equal(visible.length, 5);
    assert.equal(visible.includes(block), false);
  }
});

test("static active state follows the shared library destination", () => {
  const albums = OFFLINE_SIDEBAR_BLOCKS.find(
    (block) => block.kind === "library" && block.tab === "albums"
  );
  assert.equal(albums === undefined, false);
  if (!albums) throw new Error("albums sidebar block missing");
  assert.equal(
    isOfflineSidebarBlockActive(
      albums,
      "library",
      { kind: "tab", tab: "albums" }
    ),
    true
  );
  assert.equal(
    isOfflineSidebarBlockActive(
      albums,
      "library",
      { kind: "playlist", playlistId: "local-42" }
    ),
    false
  );
});

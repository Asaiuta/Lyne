import assert from "node:assert/strict";
import test from "node:test";
import type { LibraryListItem } from "./libraryViewTypes";
import { createLibraryVisibleRowsStore } from "./libraryVisibleRowsStore";

const row = (id: string, title: string): LibraryListItem => ({
  id,
  title,
  artist: null,
  album: null,
  duration_secs: null,
  artworkUrl: null
});

test("visible row store keeps only the latest worker window in worker order", () => {
  const store = createLibraryVisibleRowsStore();

  store.replace([row("a", "A"), row("b", "B")]);
  store.replace([row("b", "B updated"), row("c", "C")]);

  assert.deepEqual(store.rows().map((item) => item.id), ["b", "c"]);
  assert.equal(store.rows()[0]?.title, "B updated");
});

test("visible row store patches future tag fields without changing row identity", () => {
  const store = createLibraryVisibleRowsStore();
  store.replace([row("a", "Before")]);
  const original = store.rows()[0];

  assert.equal(store.patch("a", { title: "After", artist: "Artist" }), true);
  assert.equal(store.patch("missing", { title: "Ignored" }), false);
  assert.equal(store.rows()[0], original);
  assert.equal(store.rows()[0]?.title, "After");
  assert.equal(store.rows()[0]?.artist, "Artist");
});

test("visible row store clear removes the current identity window", () => {
  const store = createLibraryVisibleRowsStore();
  store.replace([row("a", "A")]);

  store.clear();

  assert.deepEqual(store.rows(), []);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { LibraryFolderSummary, LibraryTrackSummary } from "../../shared/api/types";
import { handleLibraryWorkerRequest } from "./libraryWorker";
import type { LibraryWorkerResponse } from "./libraryWorkerProtocol";

const folder = (key: string, path: string, count: number): LibraryFolderSummary => ({
  key,
  label: path.split(/[\\/]/).pop() ?? path,
  path,
  count
});

const track = (
  trackKey: number,
  title: string,
  folderKey: string,
  sizeBytes: number
): LibraryTrackSummary => ({
  track_key: trackKey,
  media_id: `media-${trackKey}`,
  title,
  artist: trackKey % 2 === 0 ? "Even Artist" : "Odd Artist",
  album: trackKey <= 2 ? "First Album" : "Second Album",
  track_number: trackKey,
  file_name: `${title}.flac`,
  folder_key: folderKey,
  folder_label: folderKey,
  duration_secs: 100 + trackKey,
  sample_rate: 44100,
  bitrate_bps: null,
  bits_per_sample: 16,
  has_cover_art: false,
  external_artwork_url: null,
  size_bytes: sizeBytes,
  added_at_epoch_secs: trackKey,
  updated_at_epoch_secs: trackKey
});

const expectType = <T extends LibraryWorkerResponse["type"]>(
  response: LibraryWorkerResponse,
  type: T
): Extract<LibraryWorkerResponse, { type: T }> => {
  assert.equal(response.type, type);
  return response as Extract<LibraryWorkerResponse, { type: T }>;
};

test("library worker returns sliced rows with the loaded range", () => {
  const folders = [
    folder("D:/Music/A", "D:/Music/A", 2),
    folder("D:/Music/B", "D:/Music/B", 2)
  ];
  const tracks = [
    track(1, "Alpha", "D:/Music/A", 10),
    track(2, "Bravo", "D:/Music/A", 20),
    track(3, "Charlie", "D:/Music/B", 30),
    track(4, "Delta", "D:/Music/B", 40)
  ];

  expectType(handleLibraryWorkerRequest({
    type: "INIT",
    requestId: 1,
    tracks,
    folders
  }), "READY");

  const response = expectType(handleLibraryWorkerRequest({
    type: "VIEW",
    requestId: 2,
    queries: [],
    folderPath: null,
    sort: { field: "title", order: "desc" },
    range: { start: 1, end: 3 }
  }), "VIEW_RESULT");

  assert.deepEqual(response.range, { start: 1, end: 3 });
  assert.deepEqual(response.rows.map((row) => row.title), ["Charlie", "Bravo"]);
  assert.equal(response.total, 4);
  assert.equal(response.totalSizeBytes, 100);
});

test("library worker filters by query and folder path for ordered media ids", () => {
  const folders = [
    folder("D:/Music/A", "D:/Music/A", 2),
    folder("D:/Music/B", "D:/Music/B", 2)
  ];
  const tracks = [
    track(1, "Alpha", "D:/Music/A", 10),
    track(2, "Bravo", "D:/Music/A", 20),
    track(3, "Charlie", "D:/Music/B", 30),
    track(4, "Another", "D:/Music/B", 40)
  ];

  expectType(handleLibraryWorkerRequest({
    type: "INIT",
    requestId: 3,
    tracks,
    folders
  }), "READY");

  const response = expectType(handleLibraryWorkerRequest({
    type: "MEDIA_IDS",
    requestId: 4,
    queries: ["a"],
    folderPath: "D:/Music/B",
    sort: { field: "filename", order: "asc" }
  }), "MEDIA_IDS_RESULT");

  assert.deepEqual(response.mediaIds, ["media-4", "media-3"]);
});

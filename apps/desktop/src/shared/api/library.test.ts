import assert from "node:assert/strict";
import test from "node:test";
import { createLibraryApiClient } from "./library";

test("replaceQueueFromMediaIds posts displayed media ids and requested start media id", async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  const api = createLibraryApiClient({
    requestJson: async (path, init) => {
      calls.push({
        path,
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      return {
        status: "success",
        state: {},
        queued_count: 3
      };
    }
  });

  const result = await api.replaceQueueFromMediaIds({
    mediaIds: ["media-a", "media-b", "media-c"],
    startMediaId: "media-b"
  });

  assert.deepEqual(calls, [
    {
      path: "/domain/library/queue_from_media_ids",
      body: {
        media_ids: ["media-a", "media-b", "media-c"],
        start_media_id: "media-b"
      }
    }
  ]);
  assert.equal(result.queuedCount, 3);
});

test("getLibraryTrackView posts view query and parses lightweight response", async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  const api = createLibraryApiClient({
    requestJson: async (path, init) => {
      calls.push({
        path,
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      return {
        status: "success",
        revision: "2:100",
        library_total_count: 2,
        library_total_size_bytes: 300,
        total_count: 1,
        total_size_bytes: 100,
        folders: [{ key: "folder", label: "Music", path: "D:/Music", count: 1 }],
        rows: [
          {
            track_key: 1,
            media_id: "d:/music/a.flac",
            title: "A",
            artist: null,
            album: null,
            track_number: null,
            file_name: "a.flac",
            folder_key: "folder",
            folder_label: "Music",
            duration_secs: 120,
            sample_rate: null,
            bitrate_bps: null,
            bits_per_sample: null,
            has_cover_art: false,
            external_artwork_url: null,
            size_bytes: 100,
            added_at_epoch_secs: 10,
            updated_at_epoch_secs: 20
          }
        ],
        media_ids: ["d:/music/a.flac"]
      };
    }
  });

  const result = await api.getLibraryTrackView({
    queries: ["a"],
    folderPath: "D:/Music",
    sort: { field: "title", order: "asc" },
    range: { start: 0, end: 80 },
    includeMediaIds: true
  });

  assert.deepEqual(calls, [
    {
      path: "/domain/library/view",
      body: {
        queries: ["a"],
        folder_path: "D:/Music",
        sort: { field: "title", order: "asc" },
        range: { start: 0, end: 80 },
        include_media_ids: true
      }
    }
  ]);
  assert.equal(result.total_count, 1);
  assert.equal(result.rows[0].file_name, "a.flac");
  assert.deepEqual(result.media_ids, ["d:/music/a.flac"]);
});

test("getLibraryTrackGroups posts group query and parses selected rows", async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  const api = createLibraryApiClient({
    requestJson: async (path, init) => {
      calls.push({
        path,
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      return {
        status: "success",
        revision: "3:120",
        library_total_count: 3,
        library_total_size_bytes: 600,
        total_count: 2,
        total_size_bytes: 300,
        folders: [{ key: "folder", label: "Music", path: "D:/Music", count: 2 }],
        groups: [
          {
            key: "Ada",
            label: "Ada",
            count: 2,
            artwork_track_key: 1,
            has_cover_art: true,
            external_artwork_url: null
          }
        ],
        selected_group_key: "Ada",
        rows: [
          {
            track_key: 1,
            media_id: "d:/music/a.flac",
            title: "A",
            artist: "Ada",
            album: "First",
            track_number: null,
            file_name: "a.flac",
            folder_key: "folder",
            folder_label: "Music",
            duration_secs: 120,
            sample_rate: null,
            bitrate_bps: null,
            bits_per_sample: null,
            has_cover_art: true,
            external_artwork_url: null,
            size_bytes: 100,
            added_at_epoch_secs: 10,
            updated_at_epoch_secs: 20
          }
        ]
      };
    }
  });

  const result = await api.getLibraryTrackGroups({
    kind: "artists",
    queries: ["ada"],
    folderPath: "D:/Music",
    sort: { field: "title", order: "asc" },
    selectedGroupKey: "Ada"
  });

  assert.deepEqual(calls, [
    {
      path: "/domain/library/groups",
      body: {
        kind: "artists",
        queries: ["ada"],
        folder_path: "D:/Music",
        sort: { field: "title", order: "asc" },
        selected_group_key: "Ada"
      }
    }
  ]);
  assert.equal(result.groups[0].count, 2);
  assert.equal(result.selected_group_key, "Ada");
  assert.equal(result.rows[0].artist, "Ada");
});

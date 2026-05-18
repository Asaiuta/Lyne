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

import assert from "node:assert/strict";
import test from "node:test";
import { createPlaybackApiClient } from "./playback";
import type { ApiEnvelope } from "./types";

test("playback API sends volume as a realtime control command", async () => {
  const requests: Array<{ path: string; body: unknown }> = [];
  const client = createPlaybackApiClient({
    requestEnvelope: async (path, init): Promise<ApiEnvelope> => {
      requests.push({
        path,
        body: JSON.parse(String(init?.body ?? "{}"))
      });
      return { status: "success", message: "Volume set" };
    }
  });

  await client.setVolume(0.42);

  assert.deepEqual(requests, [
    {
      path: "/volume",
      body: {
        volume: 0.42
      }
    }
  ]);
});

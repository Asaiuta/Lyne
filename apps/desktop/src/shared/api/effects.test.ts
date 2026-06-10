import assert from "node:assert/strict";
import test from "node:test";
import { createEffectsApiClient } from "./effects";
import type { ApiEnvelope } from "./types";

test("effects API sends EQ updates as realtime control commands", async () => {
  const requests: Array<{ path: string; body: unknown }> = [];
  const client = createEffectsApiClient({
    requestEnvelope: async (path, init): Promise<ApiEnvelope> => {
      requests.push({
        path,
        body: JSON.parse(String(init?.body ?? "{}"))
      });
      return { status: "success", message: "EQ updated" };
    },
    requestJson: async () => ({ status: "success" })
  });

  await client.setEq({ bands: { "31": 1.5 }, enabled: true });

  assert.deepEqual(requests, [
    {
      path: "/set_eq",
      body: {
        bands: { "31": 1.5 },
        enabled: true
      }
    }
  ]);
});

test("effects API set commands accept status-only responses", async () => {
  const requests: Array<{ path: string; body: unknown }> = [];
  const client = createEffectsApiClient({
    requestEnvelope: async (): Promise<ApiEnvelope> => ({ status: "success", message: null }),
    requestJson: async (path, init) => {
      requests.push({
        path,
        body: JSON.parse(String(init?.body ?? "{}"))
      });
      return { status: "success", message: "updated" };
    }
  });

  await client.setCrossfeed({ enabled: true, mix: 0.35 });
  await client.setSaturation({ enabled: true, drive: 0.5 });
  await client.setDynamicLoudness({ enabled: true, strength: 0.6 });

  assert.deepEqual(requests, [
    { path: "/set_crossfeed", body: { enabled: true, mix: 0.35 } },
    { path: "/set_saturation", body: { enabled: true, drive: 0.5 } },
    { path: "/set_dynamic_loudness", body: { enabled: true, strength: 0.6 } }
  ]);
});

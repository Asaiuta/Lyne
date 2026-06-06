import assert from "node:assert/strict";
import test from "node:test";
import { createSettingsApiClient } from "./settings";
import type { PersistentSettings } from "./types";

const persistentSettingsFixture = (
  overrides: Partial<PersistentSettings> = {}
): PersistentSettings => ({
  volume: 0.7,
  device_id: null,
  exclusive_mode: false,
  eq_type: "IIR",
  eq_bands: null,
  fir_taps: 1023,
  dither_enabled: true,
  output_bits: 24,
  noise_shaper_curve: "Lipshitz5",
  loudness_enabled: true,
  loudness_mode: "track",
  target_lufs: -12,
  preamp_db: 0,
  saturation_enabled: false,
  saturation_drive: 0.5,
  saturation_mix: 1,
  crossfeed_enabled: false,
  crossfeed_mix: 0.3,
  dynamic_loudness_enabled: false,
  dynamic_loudness_strength: 0.5,
  target_samplerate: null,
  resample_quality: "hq",
  use_cache: false,
  preemptive_resample: true,
  streaming_first_buffer: false,
  streaming_full_buffer_limit_mib: 256,
  use_next_prefetch: true,
  ...overrides
});

const assertRejects = async (
  action: () => Promise<unknown>,
  messagePattern: RegExp
): Promise<void> => {
  let rejected = false;
  try {
    await action();
  } catch (error) {
    rejected = true;
    const message = error instanceof Error ? error.message : String(error);
    assert.equal(messagePattern.test(message), true, message);
  }
  assert.equal(rejected, true);
};

test("settings API parses streaming buffer fields", async () => {
  const client = createSettingsApiClient({
    requestJson: async () => ({
      status: "success",
      settings: persistentSettingsFixture({
        streaming_first_buffer: true,
        streaming_full_buffer_limit_mib: 128
      })
    })
  });

  const settings = await client.getSettings();

  assert.equal(settings.streaming_first_buffer, true);
  assert.equal(settings.streaming_full_buffer_limit_mib, 128);
});

test("settings API rejects invalid streaming buffer payloads", async () => {
  const client = createSettingsApiClient({
    requestJson: async () => ({
      status: "success",
      settings: {
        ...persistentSettingsFixture(),
        streaming_full_buffer_limit_mib: 128.5
      }
    })
  });

  await assertRejects(() => client.getSettings(), /Invalid settings payload/);
});

test("settings API saves streaming buffer updates", async () => {
  let savedBody: unknown = null;
  const client = createSettingsApiClient({
    requestJson: async (_path, init) => {
      savedBody = JSON.parse(String(init?.body ?? "{}"));
      return { status: "success" };
    }
  });

  await client.saveSettings({
    streaming_first_buffer: true,
    streaming_full_buffer_limit_mib: 0
  });

  assert.deepEqual(savedBody, {
    settings: {
      streaming_first_buffer: true,
      streaming_full_buffer_limit_mib: 0
    }
  });
});

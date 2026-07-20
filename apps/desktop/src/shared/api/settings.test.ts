import assert from "node:assert/strict";
import test from "node:test";
import { AudioSettingsConflictError, createSettingsApiClient } from "./settings";
import { ApiHttpError } from "./transport";
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
  streaming_pcm_window_limit_mib: 256,
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
        streaming_pcm_window_limit_mib: 128
      })
    })
  });

  const settings = await client.getSettings();

  assert.equal(settings.streaming_first_buffer, true);
  assert.equal(settings.streaming_pcm_window_limit_mib, 128);
});

test("settings API rejects invalid streaming buffer payloads", async () => {
  const client = createSettingsApiClient({
    requestJson: async () => ({
      status: "success",
      settings: {
        ...persistentSettingsFixture(),
        streaming_pcm_window_limit_mib: 128.5
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
    streaming_pcm_window_limit_mib: 0
  });

  assert.deepEqual(savedBody, {
    settings: {
      streaming_first_buffer: true,
      streaming_pcm_window_limit_mib: 0
    }
  });
});

test("settings API parses a versioned desired/effective snapshot", async () => {
  const settings = persistentSettingsFixture({ volume: 0.35 });
  const client = createSettingsApiClient({
    requestJson: async () => ({
      status: "success",
      snapshot: {
        revision: 4,
        state_revision: 6,
        desired: settings,
        effective: settings,
        apply_status: {
          volume: { state: "applied", revision: 4 }
        }
      }
    })
  });

  const snapshot = await client.getAudioSettings();

  assert.equal(snapshot.revision, 4);
  assert.equal(snapshot.state_revision, 6);
  assert.equal(snapshot.desired.volume, 0.35);
  assert.equal(snapshot.apply_status.volume?.state, "applied");
  assert.equal(snapshot.active_preview, null);
});

test("settings API sends preview and commit revision contracts", async () => {
  const requests: Array<{ path: string; body: unknown }> = [];
  const settings = persistentSettingsFixture();
  const snapshot = {
    revision: 3,
    state_revision: 5,
    desired: settings,
    effective: settings,
    apply_status: {}
  };
  const client = createSettingsApiClient({
    requestJson: async (path, init) => {
      requests.push({ path, body: JSON.parse(String(init?.body ?? "{}")) });
      if (path.endsWith("/preview")) {
        return {
          status: "success",
          accepted: true,
          session_id: "playerbar",
          seq: 7,
          snapshot
        };
      }
      return { status: "success", snapshot };
    }
  });

  await client.previewAudioSettings("playerbar", 7, { volume: 0.2 });
  await client.commitAudioSettings(2, { volume: 0.2 }, "playerbar");

  assert.deepEqual(requests, [
    {
      path: "/audio_settings/preview",
      body: { session_id: "playerbar", seq: 7, settings: { volume: 0.2 } }
    },
    {
      path: "/audio_settings/commit",
      body: {
        base_revision: 2,
        settings: { volume: 0.2 },
        preview_session_id: "playerbar"
      }
    }
  ]);
});

test("settings API preserves the current snapshot on an HTTP conflict", async () => {
  const current = persistentSettingsFixture({ volume: 0.35 });
  const client = createSettingsApiClient({
    requestJson: async () => {
      throw new ApiHttpError(409, "volume conflict", {
        status: "error",
        message: "volume conflict",
        conflicting_fields: ["volume"],
        snapshot: {
          revision: 5,
          state_revision: 8,
          desired: current,
          effective: current,
          apply_status: {}
        }
      });
    }
  });

  let captured: unknown = null;
  try {
    await client.commitAudioSettings(3, { volume: 0.8 });
  } catch (error) {
    captured = error;
  }

  assert.equal(captured instanceof AudioSettingsConflictError, true);
  const conflict = captured as AudioSettingsConflictError;
  assert.deepEqual(conflict.conflictingFields, ["volume"]);
  assert.equal(conflict.snapshot.revision, 5);
  assert.equal(conflict.snapshot.desired.volume, 0.35);
});

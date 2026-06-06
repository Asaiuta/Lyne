import assert from "node:assert/strict";
import test from "node:test";
import type { PersistentSettings } from "../../../shared/api/types";
import {
  AUDIO_ENGINE_BOOLEAN_ITEMS,
  AUDIO_ENGINE_TEXT_ITEMS,
  EQ_BAND_KEYS,
  audioEngineFormFromSettings,
  defaultAudioEngineForm,
  eqBandsForSettingsUpdate,
  readAudioEngineFormScalarValue
} from "./audioEngineSettingsModel";

const persistentSettingsFixture = (overrides: Partial<PersistentSettings> = {}): PersistentSettings => ({
  volume: 0.82,
  device_id: 12,
  exclusive_mode: true,
  eq_type: "FIR",
  eq_bands: {
    "31": 1.5,
    "62": -2,
    "16000": 4
  },
  fir_taps: 2047,
  dither_enabled: false,
  output_bits: 32,
  noise_shaper_curve: "ImprovedE9",
  loudness_enabled: false,
  loudness_mode: "album",
  target_lufs: -14,
  preamp_db: -1.5,
  saturation_enabled: true,
  saturation_drive: 0.8,
  saturation_mix: 0.6,
  crossfeed_enabled: true,
  crossfeed_mix: 0.45,
  dynamic_loudness_enabled: true,
  dynamic_loudness_strength: 0.7,
  target_samplerate: 96000,
  resample_quality: "uhq",
  use_cache: true,
  preemptive_resample: false,
  streaming_first_buffer: true,
  streaming_full_buffer_limit_mib: 128,
  use_next_prefetch: false,
  ...overrides
});

test("audio engine form defaults come from one descriptor table", () => {
  const form = defaultAudioEngineForm();

  assert.equal(form.deviceId, "");
  assert.equal(form.exclusiveMode, false);
  assert.equal(form.volume, "0.7");
  assert.equal(form.firTaps, "1023");
  assert.equal(form.outputBits, "24");
  assert.equal(form.noiseShaperCurve, "Lipshitz5");
  assert.equal(form.targetSamplerate, "");
  assert.equal(form.preemptiveResample, true);
  assert.equal(form.streamingFirstBuffer, false);
  assert.equal(form.streamingFullBufferLimitMib, "256");
  assert.deepEqual(Object.keys(form.eqBands), [...EQ_BAND_KEYS]);
  assert.equal(Object.values(form.eqBands).every((value) => value === 0), true);
});

test("audio engine form maps persistent settings through descriptors", () => {
  const settings = persistentSettingsFixture();
  const form = audioEngineFormFromSettings(settings);

  assert.equal(form.deviceId, "12");
  assert.equal(form.exclusiveMode, true);
  assert.equal(form.volume, "0.82");
  assert.equal(form.eqType, "FIR");
  assert.equal(form.firTaps, "2047");
  assert.equal(form.outputBits, "32");
  assert.equal(form.targetSamplerate, "96000");
  assert.equal(form.saturationMix, "0.6");
  assert.equal(form.preemptiveResample, false);
  assert.equal(form.streamingFirstBuffer, true);
  assert.equal(form.streamingFullBufferLimitMib, "128");
  assert.equal(form.eqBands["31"], 1.5);
  assert.equal(form.eqBands["62"], -2);
  assert.equal(form.eqBands["125"], 0);
  assert.equal(form.eqBands["16000"], 4);
});

test("audio engine rollback reads the same descriptor defaults and settings values", () => {
  const settings = persistentSettingsFixture({
    device_id: null,
    fir_taps: null,
    target_samplerate: null
  });

  assert.equal(readAudioEngineFormScalarValue(settings, "deviceId"), "");
  assert.equal(readAudioEngineFormScalarValue(settings, "firTaps"), "");
  assert.equal(readAudioEngineFormScalarValue(settings, "targetSamplerate"), "");
  assert.equal(readAudioEngineFormScalarValue(null, "volume"), "0.7");
  assert.equal(readAudioEngineFormScalarValue(undefined, "preemptiveResample"), true);
  assert.equal(readAudioEngineFormScalarValue(undefined, "streamingFullBufferLimitMib"), "256");
});

test("audio engine item descriptors keep rendered ids tied to form and patch fields", () => {
  assert.deepEqual(AUDIO_ENGINE_BOOLEAN_ITEMS.dither, {
    id: "dither",
    formField: "ditherEnabled",
    settingsField: "dither_enabled"
  });
  assert.deepEqual(AUDIO_ENGINE_TEXT_ITEMS.saturationMix, {
    id: "saturationMix",
    labelKey: "settings.saturation.mix",
    formField: "saturationMix",
    settingsField: "saturation_mix",
    parser: {
      kind: "rangedNumber",
      fieldLabelKey: "settings.field.saturationMix",
      min: 0,
      max: 1
    },
    disabledWhen: "saturationDisabled"
  });
  assert.deepEqual(AUDIO_ENGINE_BOOLEAN_ITEMS.streamingFirstBuffer, {
    id: "streamingFirstBuffer",
    formField: "streamingFirstBuffer",
    settingsField: "streaming_first_buffer"
  });
  assert.deepEqual(AUDIO_ENGINE_TEXT_ITEMS.streamingFullBufferLimitMib, {
    id: "streamingFullBufferLimitMib",
    labelKey: "settings.streamingFullBufferLimitMib",
    formField: "streamingFullBufferLimitMib",
    settingsField: "streaming_full_buffer_limit_mib",
    parser: {
      kind: "rangedInteger",
      fieldLabelKey: "settings.field.streamingFullBufferLimitMib",
      min: 0,
      max: 4096
    }
  });
});

test("audio engine EQ update payload preserves the canonical band order", () => {
  const form = audioEngineFormFromSettings(persistentSettingsFixture());
  const update = eqBandsForSettingsUpdate(form.eqBands);

  assert.deepEqual(Object.keys(update), [...EQ_BAND_KEYS]);
  assert.equal(update["31"], 1.5);
  assert.equal(update["125"], 0);
});

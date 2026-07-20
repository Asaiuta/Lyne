import assert from "node:assert/strict";
import test from "node:test";
import { AudioSettingsConflictError } from "../api/settings";
import type {
  AudioSettingsSnapshot,
  PersistentSettings,
  PlayerState
} from "../api/types";
import {
  applyEffectiveAudioSettingsToPlayerState,
  createAudioSettingsStore,
  type AudioSettingsApi
} from "./audioSettingsStore";

const settings = (volume: number): PersistentSettings => ({
  volume,
  device_id: null,
  exclusive_mode: false,
  eq_type: "IIR",
  eq_bands: null,
  fir_taps: 1023,
  dither_enabled: false,
  output_bits: 24,
  noise_shaper_curve: "Lipshitz5",
  loudness_enabled: false,
  loudness_mode: "ReplayGainTrack",
  target_lufs: -16,
  preamp_db: 0,
  saturation_enabled: false,
  saturation_drive: 0,
  saturation_mix: 0,
  crossfeed_enabled: false,
  crossfeed_mix: 0,
  dynamic_loudness_enabled: false,
  dynamic_loudness_strength: 0,
  target_samplerate: null,
  resample_quality: "High",
  use_cache: true,
  preemptive_resample: false,
  streaming_first_buffer: false,
  streaming_pcm_window_limit_mib: 256,
  use_next_prefetch: true
});

const snapshot = (
  revision: number,
  volume: number,
  stateRevision = revision
): AudioSettingsSnapshot => ({
  revision,
  state_revision: stateRevision,
  desired: settings(volume),
  effective: settings(volume),
  apply_status: {},
  active_preview: null
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};

const captureRejection = async (action: () => Promise<unknown>): Promise<unknown> => {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to reject");
};

test("same-revision refresh replies cannot replace a newer request generation", async () => {
  const first = deferred<AudioSettingsSnapshot>();
  const second = deferred<AudioSettingsSnapshot>();
  let request = 0;
  const api = {
    getAudioSettings: () => (request++ === 0 ? first.promise : second.promise)
  } as unknown as AudioSettingsApi;
  const store = createAudioSettingsStore(api);

  const firstRequest = store.refresh();
  const secondRequest = store.refresh();
  second.resolve(snapshot(0, 0.4));
  await secondRequest;
  first.resolve(snapshot(0, 0.9));
  await firstRequest;

  assert.equal(store.effective()?.volume, 0.4);
});

test("out-of-order preview replies keep the newest sequence", async () => {
  const first = deferred<ReturnType<typeof previewResult>>();
  const second = deferred<ReturnType<typeof previewResult>>();
  const api = {
    previewAudioSettings: (_sessionId: string, seq: number) =>
      seq === 1 ? first.promise : second.promise
  } as unknown as AudioSettingsApi;
  const store = createAudioSettingsStore(api);

  const firstRequest = store.preview("playerbar", 1, { volume: 0.8 });
  const secondRequest = store.preview("playerbar", 2, { volume: 0.2 });
  second.resolve(previewResult("playerbar", 2, 0.2));
  await secondRequest;
  first.resolve(previewResult("playerbar", 1, 0.8));
  await firstRequest;

  assert.equal(store.effective()?.volume, 0.2);
});

test("server state revision orders previews across different sessions", async () => {
  const first = deferred<ReturnType<typeof previewResult>>();
  const second = deferred<ReturnType<typeof previewResult>>();
  const api = {
    previewAudioSettings: (sessionId: string) =>
      sessionId === "first" ? first.promise : second.promise
  } as unknown as AudioSettingsApi;
  const store = createAudioSettingsStore(api);

  const firstRequest = store.preview("first", 1, { volume: 0.8 });
  const secondRequest = store.preview("second", 1, { volume: 0.2 });
  second.resolve(previewResult("second", 1, 0.2, 1));
  await secondRequest;
  first.resolve(previewResult("first", 1, 0.8, 2));
  await firstRequest;

  assert.equal(store.effective()?.volume, 0.8);
  assert.equal(store.snapshot()?.state_revision, 2);
});

test("reserved preview intent prevents an in-flight older preview from replacing local intent", async () => {
  const pending = deferred<ReturnType<typeof previewResult>>();
  const api = {
    previewAudioSettings: async () => pending.promise
  } as unknown as AudioSettingsApi;
  const store = createAudioSettingsStore(api);

  const request = store.preview("playerbar", 1, { volume: 0.8 });
  store.reservePreview("playerbar", 2);
  pending.resolve(previewResult("playerbar", 1, 0.8, 1));
  await request;

  assert.equal(store.snapshot(), null);
});

test("conflict snapshots become current without losing the typed conflict", async () => {
  const conflictSnapshot = snapshot(3, 0.35);
  const api = {
    getAudioSettings: async () => snapshot(2, 0.5),
    commitAudioSettings: async () => {
      throw new AudioSettingsConflictError("volume conflict", ["volume"], conflictSnapshot);
    }
  } as unknown as AudioSettingsApi;
  const store = createAudioSettingsStore(api);
  await store.refresh();

  const error = await captureRejection(() =>
    store.commit({ volume: 0.8 }, { baseRevision: 1 })
  );
  assert.equal(error instanceof AudioSettingsConflictError, true);
  assert.equal(store.snapshot()?.revision, 3);
  assert.equal(store.desired()?.volume, 0.35);
});

test("player-state audio mirrors are projected from the effective snapshot", () => {
  const player = {
    volume: 0.9,
    output_bits: 16,
    resample_quality: "Low"
  } as PlayerState;
  const effective = settings(0.25);
  effective.output_bits = 32;
  effective.resample_quality = "VeryHigh";

  const projected = applyEffectiveAudioSettingsToPlayerState(player, effective);

  assert.equal(projected.volume, 0.25);
  assert.equal(projected.output_bits, 32);
  assert.equal(projected.resample_quality, "VeryHigh");
});

function previewResult(sessionId: string, seq: number, volume: number, stateRevision = seq) {
  return {
    accepted: true,
    sessionId,
    seq,
    snapshot: snapshot(0, volume, stateRevision)
  };
}

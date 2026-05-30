import assert from "node:assert/strict";
import test from "node:test";
import type { Setter } from "solid-js";
import type { ApiClient } from "../shared/api/client";
import type { PlayerState } from "../shared/api/types";
import { usePlaybackCommands } from "./usePlaybackCommands";

const setter = <T>(initial: T, write: (value: T) => void): Setter<T> => {
  let current = initial;
  return ((value?: T | ((prev: T) => T)) => {
    const next =
      typeof value === "function" ? (value as (prev: T) => T)(current) : (value as T);
    current = next;
    write(next);
    return current;
  }) as Setter<T>;
};

const playerState = (overrides: Partial<PlayerState> = {}): PlayerState => ({
  is_playing: false,
  is_paused: true,
  is_loading: false,
  duration: 240,
  current_time: 0,
  file_path: "C:/Music/song.flac",
  ncm_song_id: null,
  ncm_source_page_url: null,
  volume: 0.8,
  device_id: null,
  exclusive_mode: false,
  eq_type: "flat",
  dither_enabled: false,
  replaygain_enabled: false,
  loudness_enabled: false,
  loudness_mode: "off",
  target_lufs: -16,
  preamp_db: 0,
  rg_track_gain: null,
  rg_album_gain: null,
  rg_track_peak: null,
  rg_album_peak: null,
  saturation_enabled: false,
  saturation_drive: 0,
  saturation_mix: 0,
  crossfeed_enabled: false,
  crossfeed_mix: 0,
  dynamic_loudness_enabled: false,
  dynamic_loudness_strength: 0,
  dynamic_loudness_factor: 0,
  output_bits: 24,
  noise_shaper_curve: "none",
  target_samplerate: null,
  resample_quality: "medium",
  use_cache: true,
  preemptive_resample: false,
  title: "Title",
  artist: null,
  album: null,
  track_number: null,
  disc_number: null,
  genre: null,
  year: null,
  has_cover_art: false,
  external_artwork_url: null,
  media_id: null,
  repeat_mode: "off",
  shuffle_mode: "off",
  ...overrides
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("volume preview sends real-time command without refreshing global player state", async () => {
  const calls = {
    setVolume: [] as number[],
    applied: [] as PlayerState[],
    patches: [] as Array<Partial<PlayerState>>,
    refreshes: 0,
    errors: [] as Array<string | null>,
    livePositions: [] as Array<number | null>
  };
  const api = {
    setVolume: async (volume: number) => {
      calls.setVolume.push(volume);
      return playerState({ volume });
    }
  } as Pick<ApiClient, "setVolume"> as ApiClient;

  const commands = usePlaybackCommands({
    api,
    repeatMode: () => "off",
    shuffleMode: () => "off",
    applyPlayerState: (next) => calls.applied.push(next),
    patchPlayerState: (patch) => calls.patches.push(patch as Partial<PlayerState>),
    refreshState: async () => {
      calls.refreshes += 1;
    },
    setCommandError: setter<string | null>(null, (value) => calls.errors.push(value)),
    setLivePosition: setter<number | null>(null, (value) => calls.livePositions.push(value))
  });

  await commands.handleVolumePreview(0.42);
  await tick();

  assert.deepEqual(calls.setVolume, [0.42]);
  assert.deepEqual(calls.patches, []);
  assert.deepEqual(calls.applied, []);
  assert.equal(calls.refreshes, 0);
  assert.deepEqual(calls.livePositions, []);
});

test("volume commit patches only the volume field without applying the returned player snapshot", async () => {
  const calls = {
    setVolume: [] as number[],
    applied: [] as PlayerState[],
    patches: [] as Array<Partial<PlayerState>>,
    refreshes: 0,
    errors: [] as Array<string | null>,
    livePositions: [] as Array<number | null>
  };
  const api = {
    setVolume: async (volume: number) => {
      calls.setVolume.push(volume);
      return playerState({ volume, title: "Server snapshot" });
    }
  } as Pick<ApiClient, "setVolume"> as ApiClient;

  const commands = usePlaybackCommands({
    api,
    repeatMode: () => "off",
    shuffleMode: () => "off",
    applyPlayerState: (next) => calls.applied.push(next),
    patchPlayerState: (patch) => calls.patches.push(patch as Partial<PlayerState>),
    refreshState: async () => {
      calls.refreshes += 1;
    },
    setCommandError: setter<string | null>(null, (value) => calls.errors.push(value)),
    setLivePosition: setter<number | null>(null, (value) => calls.livePositions.push(value))
  });

  await commands.handleVolumeChange(0.37);
  await tick();

  assert.deepEqual(calls.setVolume, [0.37]);
  assert.deepEqual(calls.patches, [{ volume: 0.37 }]);
  assert.deepEqual(calls.applied, []);
  assert.equal(calls.refreshes, 0);
});

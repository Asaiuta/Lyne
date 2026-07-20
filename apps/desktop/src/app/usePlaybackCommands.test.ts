import assert from "node:assert/strict";
import test from "node:test";
import type { Setter } from "solid-js";
import type { ApiClient } from "../shared/api/client";
import type {
  AudioSettingsPreviewPatch,
  AudioSettingsSnapshot,
  PersistentSettingsUpdate,
  PlayerState
} from "../shared/api/types";
import type {
  AudioSettingsCommitOptions,
  AudioSettingsStore
} from "../shared/state/audioSettingsStore";
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

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
};

interface AudioSettingsCalls {
  previews: Array<{ sessionId: string; seq: number; volume: number }>;
  commits: Array<{
    patch: PersistentSettingsUpdate;
    options: AudioSettingsCommitOptions | undefined;
  }>;
}

const audioSettingsStub = (calls: AudioSettingsCalls): AudioSettingsStore => {
  const current = { revision: 7, state_revision: 7 } as AudioSettingsSnapshot;
  return {
    snapshot: () => current,
    reservePreview: () => undefined,
    preview: async (sessionId: string, seq: number, patch: AudioSettingsPreviewPatch) => {
      calls.previews.push({ sessionId, seq, volume: patch.volume ?? -1 });
      return { accepted: true, sessionId, seq, snapshot: current };
    },
    commit: async (
      patch: PersistentSettingsUpdate,
      options?: AudioSettingsCommitOptions
    ) => {
      calls.commits.push({ patch, options });
      return current;
    },
    cancelPreview: async () => current
  } as unknown as AudioSettingsStore;
};

test("volume preview sends realtime command without refreshing global player state", async () => {
  const calls = {
    previews: [] as AudioSettingsCalls["previews"],
    commits: [] as AudioSettingsCalls["commits"],
    applied: [] as PlayerState[],
    patches: [] as Array<Partial<PlayerState>>,
    refreshes: 0,
    errors: [] as Array<string | null>,
    livePositions: [] as Array<number | null>
  };
  const api = {} as ApiClient;

  const commands = usePlaybackCommands({
    api,
    audioSettings: audioSettingsStub(calls),
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

  assert.equal(calls.previews.length, 1);
  assert.equal(calls.previews[0]?.volume, 0.42);
  assert.equal(calls.previews[0]?.seq, 1);
  assert.deepEqual(calls.commits, []);
  assert.deepEqual(calls.patches, []);
  assert.deepEqual(calls.applied, []);
  assert.equal(calls.refreshes, 0);
  assert.deepEqual(calls.livePositions, []);
});

test("volume commit patches only the volume field after sending the realtime command", async () => {
  const calls = {
    previews: [] as AudioSettingsCalls["previews"],
    commits: [] as AudioSettingsCalls["commits"],
    applied: [] as PlayerState[],
    patches: [] as Array<Partial<PlayerState>>,
    refreshes: 0,
    errors: [] as Array<string | null>,
    livePositions: [] as Array<number | null>
  };
  const api = {} as ApiClient;

  const commands = usePlaybackCommands({
    api,
    audioSettings: audioSettingsStub(calls),
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

  assert.deepEqual(calls.previews, []);
  assert.deepEqual(calls.commits.map((call) => call.patch), [{ volume: 0.37 }]);
  assert.equal(calls.commits[0]?.options?.baseRevision, 7);
  assert.deepEqual(calls.patches, []);
  assert.deepEqual(calls.applied, []);
  assert.equal(calls.refreshes, 0);
});

test("volume wheel steps preview immediately and debounce to one durable commit", async () => {
  const calls = {
    previews: [] as AudioSettingsCalls["previews"],
    commits: [] as AudioSettingsCalls["commits"],
    applied: [] as PlayerState[],
    patches: [] as Array<Partial<PlayerState>>,
    refreshes: 0,
    errors: [] as Array<string | null>,
    livePositions: [] as Array<number | null>
  };
  const commands = usePlaybackCommands({
    api: {} as ApiClient,
    audioSettings: audioSettingsStub(calls),
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

  await commands.handleVolumeStep(0.6);
  await commands.handleVolumeStep(0.55);
  await tick();

  assert.equal(calls.previews[calls.previews.length - 1]?.volume, 0.55);
  assert.deepEqual(calls.commits, []);

  await new Promise<void>((resolve) => setTimeout(resolve, 220));
  assert.deepEqual(calls.commits.map((call) => call.patch), [{ volume: 0.55 }]);
});

test("a superseded failed volume commit still cancels its preview session", async () => {
  const current = { revision: 7, state_revision: 7 } as AudioSettingsSnapshot;
  const failedCommit = deferred<AudioSettingsSnapshot>();
  const previews: Array<{ sessionId: string; seq: number }> = [];
  const cancellations: string[] = [];
  let commitCount = 0;
  const audioSettings = {
    snapshot: () => current,
    reservePreview: () => undefined,
    preview: async (sessionId: string, seq: number) => {
      previews.push({ sessionId, seq });
      return { accepted: true, sessionId, seq, snapshot: current };
    },
    commit: async () => {
      commitCount += 1;
      return commitCount === 1 ? failedCommit.promise : current;
    },
    cancelPreview: async (sessionId: string) => {
      cancellations.push(sessionId);
      return current;
    }
  } as unknown as AudioSettingsStore;
  const errors: Array<string | null> = [];
  const commands = usePlaybackCommands({
    api: {} as ApiClient,
    audioSettings,
    repeatMode: () => "off",
    shuffleMode: () => "off",
    applyPlayerState: () => undefined,
    patchPlayerState: () => undefined,
    refreshState: async () => undefined,
    setCommandError: setter<string | null>(null, (value) => errors.push(value)),
    setLivePosition: setter<number | null>(null, () => undefined)
  });

  await commands.handleVolumePreview(0.4);
  await tick();
  const firstSessionId = previews[0]?.sessionId;
  assert.equal(typeof firstSessionId, "string");

  await commands.handleVolumeChange(0.4);
  await commands.handleVolumePreview(0.6);
  failedCommit.reject(new Error("commit failed"));
  await tick();
  await tick();

  assert.deepEqual(cancellations, [firstSessionId]);
  assert.equal(previews[previews.length - 1]?.sessionId === firstSessionId, false);
  assert.equal(errors.includes("commit failed"), false);
});

test("a preview queued behind an owned commit captures the post-commit base revision", async () => {
  let current = { revision: 7, state_revision: 7 } as AudioSettingsSnapshot;
  const commits: Array<AudioSettingsCommitOptions | undefined> = [];
  const audioSettings = {
    snapshot: () => current,
    reservePreview: () => undefined,
    preview: async (sessionId: string, seq: number) => ({
      accepted: true,
      sessionId,
      seq,
      snapshot: current
    }),
    commit: async (
      _patch: PersistentSettingsUpdate,
      options?: AudioSettingsCommitOptions
    ) => {
      commits.push(options);
      if (commits.length === 1) {
        current = { revision: 8, state_revision: 8 } as AudioSettingsSnapshot;
      }
      return current;
    },
    cancelPreview: async () => current
  } as unknown as AudioSettingsStore;
  const commands = usePlaybackCommands({
    api: {} as ApiClient,
    audioSettings,
    repeatMode: () => "off",
    shuffleMode: () => "off",
    applyPlayerState: () => undefined,
    patchPlayerState: () => undefined,
    refreshState: async () => undefined,
    setCommandError: setter<string | null>(null, () => undefined),
    setLivePosition: setter<number | null>(null, () => undefined)
  });

  await commands.handleVolumeChange(0.4);
  await commands.handleVolumePreview(0.3);
  await tick();
  await commands.handleVolumeChange(0.3);
  await tick();

  assert.equal(commits[0]?.baseRevision, 7);
  assert.equal(commits[1]?.baseRevision, 8);
});

test("play command syncs the returned authoritative playback position", async () => {
  const calls = {
    previews: [] as AudioSettingsCalls["previews"],
    commits: [] as AudioSettingsCalls["commits"],
    applied: [] as PlayerState[],
    patches: [] as Array<Partial<PlayerState>>,
    refreshes: 0,
    errors: [] as Array<string | null>,
    livePositions: [] as Array<number | null>
  };
  const api = {
    play: async () => playerState({ is_playing: true, is_paused: false, current_time: 18.5 })
  } as Pick<ApiClient, "play"> as ApiClient;

  const commands = usePlaybackCommands({
    api,
    audioSettings: audioSettingsStub(calls),
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

  await commands.handlePlay();

  assert.equal(calls.applied.length, 1);
  assert.deepEqual(calls.patches, []);
  assert.deepEqual(calls.livePositions, [18.5]);
});

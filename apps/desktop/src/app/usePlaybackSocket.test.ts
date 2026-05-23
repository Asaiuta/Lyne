import assert from "node:assert/strict";
import test from "node:test";
import type { Setter } from "solid-js";
import type { PlayerState, RequestState } from "../shared/api/types";
import { applyPlaybackSocketEvent } from "./usePlaybackSocket";

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

const createDeps = (state: RequestState<PlayerState>) => {
  const calls = {
    patches: [] as Array<Partial<PlayerState>>,
    applied: [] as PlayerState[],
    spectrum: [] as number[][],
    loadingProgress: [] as Array<number | null>,
    wsStatus: [] as string[],
    preloadRequested: [] as boolean[],
    livePosition: [] as Array<number | null>,
    refreshes: [] as Array<string | null | undefined>,
    queueRefreshCount: 0,
    historyCount: 0,
    acceptSpectrum: true,
    suppressRemotePosition: false
  };

  return {
    calls,
    deps: {
      state: () => state,
      patchPlayerState: (
        patch:
          | Partial<PlayerState>
          | ((current: PlayerState) => Partial<PlayerState> | PlayerState | null)
      ) => {
        const base = state.status === "success" ? state.data : playerState();
        const next = typeof patch === "function" ? patch(base) : patch;
        if (next) calls.patches.push(next);
      },
      applyPlayerState: (next: PlayerState) => calls.applied.push(next),
      setSpectrum: setter<number[]>([], (value) => calls.spectrum.push(value)),
      setLoadingProgress: setter<number | null>(null, (value) =>
        calls.loadingProgress.push(value)
      ),
      setWsStatus: setter<"connected" | "connecting" | "disconnected">(
        "connecting",
        (value) => calls.wsStatus.push(value)
      ),
      setPreloadRequested: setter<boolean>(false, (value) =>
        calls.preloadRequested.push(value)
      ),
      setLivePosition: setter<number | null>(null, (value) =>
        calls.livePosition.push(value)
      ),
      shouldAcceptSpectrum: () => calls.acceptSpectrum,
      shouldSuppressRemotePosition: () => calls.suppressRemotePosition,
      noteSocketActivity: () => undefined,
      scheduleRefresh: (expectedPath?: string | null) => calls.refreshes.push(expectedPath),
      refreshQueueForCurrentSurface: () => {
        calls.queueRefreshCount += 1;
      },
      notifyPlaybackHistoryChanged: () => {
        calls.historyCount += 1;
      }
    } satisfies Parameters<typeof applyPlaybackSocketEvent>[1]
  };
};

test("track_changed applies a complete player snapshot and refreshes queue surface", () => {
  const { calls, deps } = createDeps({
    status: "success",
    data: playerState({ title: "Old" })
  });

  applyPlaybackSocketEvent(
    {
      type: "track_changed",
      file_path: "C:/Music/next.flac",
      duration: 180,
      media_id: "media-2",
      ncm_song_id: 456,
      ncm_source_page_url: "https://music.163.com/#/song?id=456",
      title: "Next",
      artist: "Artist",
      album: "Album",
      has_cover_art: true,
      external_artwork_url: "https://img.example/next.jpg"
    },
    deps
  );

  assert.equal(calls.applied.length, 1);
  assert.equal(calls.applied[0]?.file_path, "C:/Music/next.flac");
  assert.equal(calls.applied[0]?.title, "Next");
  assert.deepEqual(calls.preloadRequested, [false]);
  assert.deepEqual(calls.livePosition, [0]);
  assert.deepEqual(calls.refreshes, ["C:/Music/next.flac"]);
  assert.equal(calls.queueRefreshCount, 1);
});

test("track_changed schedules refresh when there is no base player state", () => {
  const { calls, deps } = createDeps({ status: "idle" });

  applyPlaybackSocketEvent(
    {
      type: "track_changed",
      file_path: "C:/Music/late.flac",
      duration: 180,
      media_id: null,
      ncm_song_id: null,
      ncm_source_page_url: null,
      title: null,
      artist: null,
      album: null,
      has_cover_art: false,
      external_artwork_url: null
    },
    deps
  );

  assert.equal(calls.applied.length, 0);
  assert.deepEqual(calls.refreshes, ["C:/Music/late.flac"]);
});

test("load_complete refreshes against the completed track path", () => {
  const { calls, deps } = createDeps({
    status: "success",
    data: playerState({ file_path: "C:/Music/first.flac" })
  });

  applyPlaybackSocketEvent(
    { type: "load_complete", file_path: "C:/Music/later.flac", duration: 180 },
    deps
  );

  assert.deepEqual(calls.patches, [
    {
      file_path: "C:/Music/later.flac",
      duration: 180,
      current_time: 0,
      is_loading: false
    }
  ]);
  assert.deepEqual(calls.refreshes, ["C:/Music/later.flac"]);
});

test("position events are ignored while local seek suppression is active", () => {
  const { calls, deps } = createDeps({
    status: "success",
    data: playerState()
  });
  calls.suppressRemotePosition = true;

  applyPlaybackSocketEvent(
    { type: "position", position: 42, timestamp: 1000 },
    deps
  );

  assert.equal(calls.patches.length, 0);
  assert.deepEqual(calls.livePosition, []);
});

test("spectrum_data only writes when the spectrum surface is visible", () => {
  const { calls, deps } = createDeps({ status: "idle" });

  calls.acceptSpectrum = false;
  applyPlaybackSocketEvent({ type: "spectrum_data", data: [0.1, 0.2] }, deps);

  calls.acceptSpectrum = true;
  applyPlaybackSocketEvent({ type: "spectrum_data", data: [0.3, 0.4] }, deps);

  assert.deepEqual(calls.spectrum, [[0.3, 0.4]]);
});

test("playback_history_updated notifies history consumers", () => {
  const { calls, deps } = createDeps({ status: "idle" });

  applyPlaybackSocketEvent(
    { type: "playback_history_updated", timestamp: 1000 },
    deps
  );

  assert.equal(calls.historyCount, 1);
});

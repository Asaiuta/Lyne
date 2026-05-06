import { createEffect, onCleanup, untrack } from "solid-js";
import type { Accessor } from "solid-js";
import { scrobble } from "../../shared/api/ncm";
import { useNcmAccount } from "../../shared/state/NcmAccountContext";
import type { NcmTrackReference } from "./ncmPlayback";

/**
 * Wall-clock listening time threshold (ms) below which NCM rejects scrobbles.
 * Matches the comment in `apps/desktop/src/shared/api/ncm/user.ts` and the
 * upstream `ncm-api-rs` behaviour. We deliberately do not scale by track
 * duration — a 60s podcast clip listened for 25s should not scrobble either.
 */
const SCROBBLE_MIN_LISTEN_MS = 30_000;

interface ScrobbleEffectOptions {
  /**
   * Memo of the currently-loaded NCM track reference. `undefined` means the
   * loaded file is not an NCM track (local library, WebDAV, etc.) and must
   * never trigger a scrobble.
   */
  currentTrackRef: Accessor<NcmTrackReference | undefined>;
  /**
   * Memo of the engine's playing state (`PlayerState.is_playing`). Note this
   * lags real ws transport events by up to ~300 ms because App.tsx debounces
   * REST refreshes — the resulting accumulator drift is negligible relative
   * to the 30 s scrobble threshold.
   */
  isPlaying: Accessor<boolean>;
}

/**
 * Drive the NCM `/scrobble` endpoint from playback events.
 *
 * Strategy: maintain a wall-clock accumulator for the currently-tracked NCM
 * songId. Start/stop the accumulator on `isPlaying` transitions; flush
 * (and optionally scrobble) when the songId changes, when the user logs out,
 * or when this hook is disposed.
 *
 * Why wall-clock and not playback-position deltas: positions can jump on
 * seek, gapless transitions, and resampling restarts. Wall-clock ms while
 * `is_playing === true` is the cleanest proxy for "user heard this", and
 * NCM only checks the listened seconds threshold, not exact playback
 * trajectory.
 *
 * Must be called from inside a component rendered under `<NcmAccountProvider>`.
 */
export function useNcmScrobbleEffect(options: ScrobbleEffectOptions): void {
  const accountStore = useNcmAccount();

  // Internal mutable state — not reactive on purpose. Solid effects below
  // drive transitions, but the actual counter is a plain closure variable to
  // avoid spurious re-renders and to keep timing arithmetic simple.
  let trackedSongId: number | null = null;
  let accumulatedMs = 0;
  let playStartedAt: number | null = null;

  const isWriteCapableLogin = (): boolean => {
    const acct = accountStore.activeAccount();
    // Read-only UID accounts have an empty cookie — scrobbling those would
    // either be rejected by upstream or attributed to a phantom session.
    return acct !== null && acct.cookie.length > 0;
  };

  const startSegment = (): void => {
    if (playStartedAt !== null) return;
    playStartedAt = Date.now();
  };

  const stopSegment = (): void => {
    if (playStartedAt === null) return;
    accumulatedMs += Date.now() - playStartedAt;
    playStartedAt = null;
  };

  const flushAndReset = (nextSongId: number | null): void => {
    stopSegment();
    if (
      trackedSongId !== null &&
      accumulatedMs >= SCROBBLE_MIN_LISTEN_MS &&
      // `untrack` keeps the calling effect from subscribing to the account
      // store — flush should fire on songId or play/pause transitions, not
      // every time activeAccount mutates (vipType refresh, signin patch, …).
      untrack(isWriteCapableLogin)
    ) {
      const songId = trackedSongId;
      const seconds = Math.round(accumulatedMs / 1000);
      // Fire-and-forget. Scrobble failures must never disrupt playback or
      // surface to the user — NCM occasionally rejects with code -2/-100
      // for replays or stale sessions, both of which are recoverable on
      // the next track.
      void scrobble({ id: songId, sourceid: "", time: seconds }).catch(() => {});
    }

    trackedSongId = nextSongId;
    accumulatedMs = 0;
    playStartedAt = null;

    // If a new track is taking over while playback is already running, start
    // its segment immediately — the `isPlaying` effect won't re-fire because
    // the boolean hasn't changed. `untrack` again keeps this read out of the
    // calling effect's dependency set.
    if (nextSongId !== null && untrack(options.isPlaying)) {
      startSegment();
    }
  };

  // Track-change effect: flush whenever the active NCM songId changes.
  // Non-NCM tracks set songId=null, which still flushes the previous NCM
  // track if eligible.
  createEffect(() => {
    const ref = options.currentTrackRef();
    const songId = ref?.songId ?? null;
    if (songId === trackedSongId) return;
    flushAndReset(songId);
  });

  // Play/pause effect: open or close the wall-clock segment.
  createEffect(() => {
    if (options.isPlaying()) {
      startSegment();
    } else {
      stopSegment();
    }
  });

  // Final flush on unmount so a clean app close still credits the listen.
  onCleanup(() => {
    flushAndReset(null);
  });
}

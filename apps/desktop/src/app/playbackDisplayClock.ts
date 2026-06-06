import { createEffect, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type { PlayerState } from "../shared/api/types";

export interface PlaybackDisplayClockRuntime {
  now: () => number;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
}

export interface PlaybackDisplayClockSource {
  livePosition: number | null;
  playerPosition: number | null;
  duration: number | null;
  isPlaying: boolean;
  trackKey: string | null;
}

export interface PlaybackDisplayClockAnchor {
  position: number | null;
  observedAtMs: number;
  isPlaying: boolean;
  duration: number | null;
}

interface UsePlaybackDisplayClockOptions {
  livePosition: Accessor<number | null>;
  player: Accessor<PlayerState | null>;
  runtime?: PlaybackDisplayClockRuntime;
}

const browserPlaybackDisplayClockRuntime: PlaybackDisplayClockRuntime = {
  now: () => {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  },
  requestFrame: (callback) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      return window.requestAnimationFrame(callback);
    }
    return window.setTimeout(() => callback(browserPlaybackDisplayClockRuntime.now()), 16);
  },
  cancelFrame: (id) => {
    if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(id);
      return;
    }
    window.clearTimeout(id);
  }
};

const finitePositionOrNull = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const finiteDurationOrNull = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

export const clampPlaybackDisplayPosition = (
  position: number,
  duration: number | null
): number => {
  const lowerBounded = Math.max(0, Number.isFinite(position) ? position : 0);
  return duration === null ? lowerBounded : Math.min(lowerBounded, duration);
};

export const resolvePlaybackDisplayPosition = (
  anchor: PlaybackDisplayClockAnchor | null,
  nowMs: number
): number | null => {
  if (anchor === null || anchor.position === null) {
    return null;
  }
  const elapsedSeconds = anchor.isPlaying
    ? Math.max(0, nowMs - anchor.observedAtMs) / 1000
    : 0;
  return clampPlaybackDisplayPosition(anchor.position + elapsedSeconds, anchor.duration);
};

const sameNullableNumber = (left: number | null, right: number | null): boolean =>
  left === right || (left !== null && right !== null && Object.is(left, right));

export const resolvePlaybackDisplayAnchorPosition = (
  source: PlaybackDisplayClockSource,
  previousSource: PlaybackDisplayClockSource | null,
  fallbackPosition: number | null
): number | null => {
  const livePosition = finitePositionOrNull(source.livePosition);
  const playerPosition = finitePositionOrNull(source.playerPosition);
  const fallback = finitePositionOrNull(fallbackPosition);

  if (previousSource === null) {
    return source.isPlaying
      ? livePosition ?? playerPosition
      : playerPosition ?? livePosition;
  }

  if (source.trackKey !== previousSource.trackKey) {
    return playerPosition ?? livePosition ?? 0;
  }

  if (!sameNullableNumber(livePosition, finitePositionOrNull(previousSource.livePosition))) {
    return livePosition ?? playerPosition ?? fallback;
  }

  if (!sameNullableNumber(playerPosition, finitePositionOrNull(previousSource.playerPosition))) {
    return playerPosition ?? livePosition ?? fallback;
  }

  if (source.isPlaying !== previousSource.isPlaying) {
    return fallback ?? playerPosition ?? livePosition ?? 0;
  }

  return fallback ?? livePosition ?? playerPosition;
};

const readPlaybackDisplayClockSource = (
  livePosition: number | null,
  player: PlayerState | null
): PlaybackDisplayClockSource => ({
  livePosition: finitePositionOrNull(livePosition),
  playerPosition: finitePositionOrNull(player?.current_time),
  duration: finiteDurationOrNull(player?.duration),
  isPlaying: player?.is_playing === true,
  trackKey: player?.media_id ?? player?.file_path ?? null
});

export function usePlaybackDisplayClock(
  options: UsePlaybackDisplayClockOptions
): Accessor<number | null> {
  const runtime = options.runtime ?? browserPlaybackDisplayClockRuntime;
  const [displayPosition, setDisplayPosition] = createSignal<number | null>(null);
  let previousSource: PlaybackDisplayClockSource | null = null;
  let anchor: PlaybackDisplayClockAnchor | null = null;
  let frameId: number | null = null;

  const stopFrame = () => {
    if (frameId === null) {
      return;
    }
    runtime.cancelFrame(frameId);
    frameId = null;
  };

  const scheduleFrame = () => {
    if (frameId !== null) {
      return;
    }
    frameId = runtime.requestFrame(() => {
      frameId = null;
      setDisplayPosition(resolvePlaybackDisplayPosition(anchor, runtime.now()));
      if (anchor?.isPlaying === true && anchor.position !== null) {
        scheduleFrame();
      }
    });
  };

  createEffect(() => {
    const source = readPlaybackDisplayClockSource(options.livePosition(), options.player());
    const nowMs = runtime.now();
    const fallbackPosition = resolvePlaybackDisplayPosition(anchor, nowMs);
    const position = resolvePlaybackDisplayAnchorPosition(
      source,
      previousSource,
      fallbackPosition
    );
    const duration = finiteDurationOrNull(source.duration);

    previousSource = source;
    anchor = {
      position: position === null ? null : clampPlaybackDisplayPosition(position, duration),
      observedAtMs: nowMs,
      isPlaying: source.isPlaying,
      duration
    };

    stopFrame();
    setDisplayPosition(resolvePlaybackDisplayPosition(anchor, nowMs));
    if (source.isPlaying && anchor.position !== null) {
      scheduleFrame();
    }

    onCleanup(stopFrame);
  });

  return displayPosition;
}

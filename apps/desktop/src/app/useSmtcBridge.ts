import { createEffect, createMemo, on, onCleanup, untrack } from "solid-js";
import type { Accessor } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  SMTC_TIMELINE_INTERVAL_MS,
  hasSmtcTrack,
  isValidSmtcSeekPosition,
  normalizeSmtcCoverUrl,
  normalizeSmtcDurationSec,
  shouldPushSmtcTransition,
  shouldRouteSmtcControl,
  smtcMetadataKey,
  type SmtcMetadataSnapshot
} from "./smtcPolicy";

/** Rust → main window: media-key/control action forwarded from the system
 *  media controls. Must match `SMTC_CONTROL_EVENT` in `src-tauri/src/smtc.rs`. */
export const SMTC_CONTROL_EVENT = "smtc:control";

export type SmtcControlAction = "play" | "pause" | "toggle" | "next" | "previous" | "seek";

export interface SmtcControlPayload {
  action: SmtcControlAction;
  /** For seek: the absolute target position in SECONDS. */
  positionSec?: number;
}

export interface SmtcBridgeOptions {
  enabled: Accessor<boolean>;
  title: Accessor<string>;
  artist: Accessor<string | null>;
  album: Accessor<string | null>;
  coverUrl: Accessor<string | null>;
  durationSec: Accessor<number | null>;
  isPlaying: Accessor<boolean>;
  position: Accessor<number | null>;
  play: () => void;
  pause: () => void;
  skipNext: () => void;
  skipPrevious: () => void;
  seek: (positionSec: number) => void;
}

const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Pushes track metadata and playback status to the Rust SMTC module and
 *  routes forwarded media keys back to the existing playback handlers.
 *
 *  Same bridge-push model as `useDesktopLyricBridge`: the Tauri process has
 *  no WS client, so the renderer is the single data source. */
export function useSmtcBridge(options: SmtcBridgeOptions): void {
  if (!isTauri()) return;

  const buildMetadata = (): SmtcMetadataSnapshot => ({
    title: options.title(),
    artist: options.artist(),
    album: options.album(),
    coverUrl: normalizeSmtcCoverUrl(options.coverUrl()),
    durationSec: normalizeSmtcDurationSec(options.durationSec())
  });

  const pushMetadata = async () => {
    const metadata = untrack(buildMetadata);
    if (!hasSmtcTrack(metadata.title)) return;
    await invoke("smtc_update_metadata", { metadata });
  };

  const pushPlayback = async () => {
    await invoke("smtc_update_playback", {
      playing: untrack(options.isPlaying),
      positionSec: untrack(options.position)
    });
  };

  // Registration follows the setting (mount run included): enabling registers
  // the controls with the main window's HWND and re-pushes the current
  // snapshot; disabling drops the Rust-side MediaControls entirely, so the
  // system flyout entry disappears with no residual resources. Awaiting the
  // toggle before re-pushing matters — updates sent while the worker is still
  // registering are dropped as benign races.
  createEffect(
    on(
      () => options.enabled(),
      (enabled) => {
        void (async () => {
          try {
            await invoke("smtc_set_enabled", { enabled });
            if (enabled) {
              await pushMetadata();
              await pushPlayback();
            }
          } catch (error) {
            console.warn("Failed to toggle system media controls", error);
          }
        })();
      }
    )
  );

  // Metadata push on track identity change ONLY. The memo dedupes recomputes
  // to genuine key changes, and the key deliberately reads no position signal
  // — per-frame position updates must never reach an invoke. The mount run is
  // deferred because the registration effect above pushes the initial state.
  const metadataKey = createMemo(() => smtcMetadataKey(buildMetadata()));
  createEffect(
    on(
      metadataKey,
      () => {
        if (!untrack(options.enabled)) return;
        void pushMetadata();
        // Track changes reset the position without a play/pause transition
        // (skip next/previous keeps playing); refresh the timeline alongside
        // the metadata so the system scrubber does not lag up to a full
        // interval behind.
        void pushPlayback();
      },
      { defer: true }
    )
  );

  // Immediate status+timeline push on play/pause transitions ONLY. Track just
  // the play/pause signal: `pushPlayback` reads the playback position, a
  // per-animation-frame signal — tracking it here would re-run this effect
  // (and invoke IPC) ~60x/s. `on` runs the callback untracked; the explicit
  // `untrack` reads inside the push helpers document that position reads must
  // stay outside the dependency set.
  createEffect(
    on(
      () => options.isPlaying(),
      (playing, previousPlaying) => {
        if (!shouldPushSmtcTransition(untrack(options.enabled), previousPlaying, playing)) return;
        void pushPlayback();
      },
      { defer: true }
    )
  );

  // Coarse timeline refresh while playing; the system flyout interpolates
  // between updates, so this stays far from per-frame cadence.
  createEffect(() => {
    if (!options.enabled() || !options.isPlaying()) return;
    const timer = setInterval(() => {
      void pushPlayback();
    }, SMTC_TIMELINE_INTERVAL_MS);
    onCleanup(() => clearInterval(timer));
  });

  const routeControl = (payload: SmtcControlPayload) => {
    if (!shouldRouteSmtcControl(options.enabled())) return;
    switch (payload.action) {
      case "play":
        options.play();
        break;
      case "pause":
        options.pause();
        break;
      case "toggle":
        if (options.isPlaying()) {
          options.pause();
        } else {
          options.play();
        }
        break;
      case "next":
        options.skipNext();
        break;
      case "previous":
        options.skipPrevious();
        break;
      case "seek":
        if (isValidSmtcSeekPosition(payload.positionSec)) {
          options.seek(payload.positionSec);
        }
        break;
      default:
        break;
    }
  };

  const controlUnlisten = listen<SmtcControlPayload>(SMTC_CONTROL_EVENT, (event) =>
    routeControl(event.payload)
  );
  onCleanup(() => {
    void controlUnlisten.then((off) => off());
  });
}

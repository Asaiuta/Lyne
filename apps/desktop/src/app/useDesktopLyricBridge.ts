import { createEffect, createSignal, on, onCleanup, untrack } from "solid-js";
import type { Accessor } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import type { LyricLine } from "../shared/api/lyrics";
import type { DesktopLyricPosition } from "../shared/state/uiSettingsModel";
import { shouldEmitTransitionTick } from "../features/desktop-lyric/desktopLyricPolicy";
import {
  DEFAULT_DESKTOP_LYRIC_CONFIG,
  DESKTOP_LYRIC_EVENT,
  type DesktopLyricConfig,
  type DesktopLyricControlPayload,
  type DesktopLyricTickPayload,
  type DesktopLyricTrackPayload
} from "../features/desktop-lyric/types";

/** How often the main window pushes a playback position tick to the overlay. */
const TICK_INTERVAL_MS = 500;

export interface DesktopLyricBridgeOptions {
  title: Accessor<string>;
  artist: Accessor<string | null>;
  songId: Accessor<number | null>;
  lyrics: Accessor<readonly LyricLine[]>;
  isPlaying: Accessor<boolean>;
  position: Accessor<number | null>;
  fontSize: Accessor<number>;
  doubleLine: Accessor<boolean>;
  lyricPosition: Accessor<DesktopLyricPosition>;
  playedColor: Accessor<string>;
  showWordLyrics: Accessor<boolean>;
  showTranslation: Accessor<boolean>;
  showPlayInfo: Accessor<boolean>;
  play: () => void;
  pause: () => void;
  skipNext: () => void;
  skipPrevious: () => void;
  openSettings: () => void;
  focusMain: () => void;
}

export interface DesktopLyricBridge {
  active: Accessor<boolean>;
  toggle: () => void;
}

const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function useDesktopLyricBridge(options: DesktopLyricBridgeOptions): DesktopLyricBridge {
  const [active, setActive] = createSignal(false);
  const [locked, setLocked] = createSignal(false);

  const buildConfig = (): DesktopLyricConfig => ({
    ...DEFAULT_DESKTOP_LYRIC_CONFIG,
    fontSize: options.fontSize(),
    doubleLine: options.doubleLine(),
    position: options.lyricPosition(),
    playedColor: options.playedColor(),
    showWordLyrics: options.showWordLyrics(),
    showTranslation: options.showTranslation(),
    showPlayInfo: options.showPlayInfo(),
    locked: locked()
  });

  const buildTrack = (): DesktopLyricTrackPayload => ({
    title: options.title(),
    artist: options.artist(),
    songId: options.songId(),
    lines: options.lyrics().map((line) => ({ ...line })),
    config: buildConfig()
  });

  const buildTick = (): DesktopLyricTickPayload => ({
    position: options.position() ?? 0,
    playing: options.isPlaying()
  });

  const emitTrack = () => {
    void emitTo("desktop-lyric", DESKTOP_LYRIC_EVENT.track, buildTrack());
  };

  const emitTick = () => {
    void emitTo("desktop-lyric", DESKTOP_LYRIC_EVENT.tick, buildTick());
  };

  const open = async () => {
    try {
      await invoke("open_desktop_lyric");
      setActive(true);
    } catch (error) {
      console.warn("Failed to open desktop lyric", error);
    }
  };

  const close = async () => {
    try {
      await invoke("close_desktop_lyric");
    } catch (error) {
      console.warn("Failed to close desktop lyric", error);
    }
    // Reset lock so a re-open is always interactive — Tauri click-through has no
    // mouse-forwarding, so a locked overlay can only be unlocked by reopening.
    setLocked(false);
    setActive(false);
  };

  const toggle = () => {
    if (!isTauri()) return;
    if (active()) {
      void close();
    } else {
      void open();
    }
  };

  const routeControl = (payload: DesktopLyricControlPayload) => {
    switch (payload.action) {
      case "play":
        options.play();
        break;
      case "pause":
        options.pause();
        break;
      case "next":
        options.skipNext();
        break;
      case "prev":
        options.skipPrevious();
        break;
      case "openMain":
        options.focusMain();
        break;
      case "openSettings":
        options.openSettings();
        break;
      case "close":
        void close();
        break;
      case "toggleLock":
        setLocked(payload.locked ?? !locked());
        break;
      default:
        break;
    }
  };

  if (isTauri()) {
    // Seed `active` from reality: after a main-window reload (dev HMR, webview
    // recovery) the overlay may still be open while this signal restarts at
    // false, which would silently stop ticks and desync the toggle. Setting it
    // re-runs the active-gated effects below (track push + interval).
    void invoke<boolean>("desktop_lyric_is_open")
      .then((open) => {
        if (open) setActive(true);
      })
      .catch(() => {
        /* probe failure: keep the default inactive state */
      });

    // Push a fresh track payload whenever metadata, lyrics, or config changes
    // while the overlay is open (activation itself also re-runs this effect,
    // so a freshly-seeded `active` gets the current track pushed).
    createEffect(() => {
      if (!active()) return;
      void emitTo("desktop-lyric", DESKTOP_LYRIC_EVENT.track, buildTrack());
    });

    // Push an immediate tick on play/pause transitions for snappy sync.
    // Track ONLY the play/pause signal: `buildTick()` reads the playback
    // position, a per-animation-frame signal — tracking it here would re-run
    // this effect (and emit IPC) ~60x/s, defeating TICK_INTERVAL_MS and the
    // overlay's drift re-anchoring. `on` runs the callback untracked; the
    // explicit `untrack` calls document that position reads must stay
    // outside the dependency set.
    createEffect(
      on(
        () => options.isPlaying(),
        (playing, previousPlaying) => {
          if (!shouldEmitTransitionTick(untrack(active), previousPlaying, playing)) return;
          void emitTo("desktop-lyric", DESKTOP_LYRIC_EVENT.tick, untrack(buildTick));
        },
        { defer: true }
      )
    );

    // Steady position ticks while the overlay is open.
    createEffect(() => {
      if (!active()) return;
      const timer = setInterval(emitTick, TICK_INTERVAL_MS);
      onCleanup(() => clearInterval(timer));
    });

    // Overlay → main control + ready handshake.
    const controlUnlisten = listen<DesktopLyricControlPayload>(
      DESKTOP_LYRIC_EVENT.control,
      (event) => routeControl(event.payload)
    );
    const readyUnlisten = listen(DESKTOP_LYRIC_EVENT.ready, () => {
      setActive(true);
      emitTrack();
      emitTick();
    });

    onCleanup(() => {
      void controlUnlisten.then((off) => off());
      void readyUnlisten.then((off) => off());
    });
  }

  return { active, toggle };
}

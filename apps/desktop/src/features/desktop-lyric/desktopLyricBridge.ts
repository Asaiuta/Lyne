import { invoke } from "@tauri-apps/api/core";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktopLyricRectVisible, type DesktopLyricRect } from "./desktopLyricPolicy";
import {
  DESKTOP_LYRIC_EVENT,
  type DesktopLyricControlAction,
  type DesktopLyricTickPayload,
  type DesktopLyricTrackPayload
} from "./types";

/** Overlay-side bridge: talks to the main window over Tauri events/commands. */

export const onDesktopLyricTrack = (
  handler: (payload: DesktopLyricTrackPayload) => void
): Promise<UnlistenFn> =>
  listen<DesktopLyricTrackPayload>(DESKTOP_LYRIC_EVENT.track, (event) => handler(event.payload));

export const onDesktopLyricTick = (
  handler: (payload: DesktopLyricTickPayload) => void
): Promise<UnlistenFn> =>
  listen<DesktopLyricTickPayload>(DESKTOP_LYRIC_EVENT.tick, (event) => handler(event.payload));

export const emitDesktopLyricReady = (): Promise<void> =>
  emitTo("main", DESKTOP_LYRIC_EVENT.ready, {});

export const emitDesktopLyricControl = (
  action: DesktopLyricControlAction,
  locked?: boolean
): Promise<void> =>
  emitTo("main", DESKTOP_LYRIC_EVENT.control, { action, locked });

export const setDesktopLyricLocked = async (locked: boolean): Promise<void> => {
  try {
    await invoke("set_desktop_lyric_locked", { locked });
  } catch (error) {
    console.warn("Failed to set desktop lyric lock", error);
  }
};

/** Close this overlay window directly.
 *  Fallback for when the main window is already gone: the `close` control emit
 *  then has no listener, and without this the frameless always-on-top overlay
 *  would be unclosable. The main-window listener tolerates a close request for
 *  an already-closed overlay, so calling both is safe. */
export const closeDesktopLyricWindow = async (): Promise<void> => {
  try {
    await getCurrentWindow().close();
  } catch (error) {
    console.warn("Failed to close desktop lyric window", error);
  }
};

export const startDesktopLyricDrag = async (): Promise<void> => {
  try {
    await getCurrentWindow().startDragging();
  } catch (error) {
    console.warn("Failed to start desktop lyric drag", error);
  }
};

/** Window position persistence (localStorage is shared across same-origin windows).
 *  Size is derived from font, so only the position is persisted. */
const BOUNDS_STORAGE_KEY = "desktop-lyric.bounds";

interface StoredPosition {
  x: number;
  y: number;
}

const readStoredPosition = (): StoredPosition | null => {
  try {
    const raw = localStorage.getItem(BOUNDS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPosition>;
    if (typeof parsed.x === "number" && typeof parsed.y === "number") {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    /* ignore malformed persistence */
  }
  return null;
};

/** Restore the overlay's last saved position on startup.
 *  Positions that no longer intersect any connected monitor (monitor removed,
 *  resolution changed) are discarded so the overlay falls back to its default
 *  centered spawn instead of being parked permanently off-screen. */
export const restoreDesktopLyricBounds = async (): Promise<void> => {
  const position = readStoredPosition();
  if (!position) return;
  try {
    const win = getCurrentWindow();
    const [monitors, size] = await Promise.all([availableMonitors(), win.outerSize()]);
    const rect: DesktopLyricRect = {
      x: Math.round(position.x),
      y: Math.round(position.y),
      width: size.width,
      height: size.height
    };
    const monitorRects: DesktopLyricRect[] = monitors.map((monitor) => ({
      x: monitor.position.x,
      y: monitor.position.y,
      width: monitor.size.width,
      height: monitor.size.height
    }));
    if (monitorRects.length > 0 && !isDesktopLyricRectVisible(rect, monitorRects)) {
      localStorage.removeItem(BOUNDS_STORAGE_KEY);
      return;
    }
    await win.setPosition(new PhysicalPosition(rect.x, rect.y));
  } catch (error) {
    console.warn("Failed to restore desktop lyric position", error);
  }
};

/** Persist position on move; returns an unlisten cleanup. */
export const watchDesktopLyricBounds = async (): Promise<() => void> => {
  const win = getCurrentWindow();
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const save = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void win
        .outerPosition()
        .then((pos) => {
          localStorage.setItem(BOUNDS_STORAGE_KEY, JSON.stringify({ x: pos.x, y: pos.y }));
        })
        .catch(() => {
          /* best-effort persistence */
        });
    }, 300);
  };

  const offMoved = await win.onMoved(save);
  return () => {
    if (saveTimer) clearTimeout(saveTimer);
    offMoved();
  };
};

/** Resize the overlay height to fit the configured font (SPlayer-style). */
export const fitDesktopLyricHeight = async (
  fontSize: number,
  doubleLine: boolean
): Promise<void> => {
  try {
    const win = getCurrentWindow();
    const [scale, size] = await Promise.all([win.scaleFactor(), win.innerSize()]);
    const logicalWidth = size.width / scale;
    // Header chrome + one (or two) lines of text with breathing room.
    const chrome = 60;
    const body = doubleLine ? fontSize * 1.5 + fontSize * 0.85 * 1.4 : fontSize * 1.8;
    const target = Math.round(Math.min(460, Math.max(120, chrome + body)));
    const currentLogicalHeight = size.height / scale;
    if (Math.abs(currentLogicalHeight - target) > 4) {
      await win.setSize(new LogicalSize(Math.round(logicalWidth), target));
    }
  } catch (error) {
    console.warn("Failed to fit desktop lyric height", error);
  }
};


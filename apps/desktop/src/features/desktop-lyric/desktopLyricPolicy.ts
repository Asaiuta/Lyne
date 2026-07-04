/** Framework-free decision logic for the desktop-lyric bridge.
 *
 *  Kept free of Solid/Tauri imports so it can be unit-tested under the node
 *  test harness (which resolves Solid to its server build, where effects are
 *  inert and hooks cannot be mounted).
 */

/** Decide whether a play/pause change should emit an immediate,
 *  out-of-interval tick to the overlay.
 *
 *  This is the decision path of the transition effect in
 *  `useDesktopLyricBridge`. That effect tracks ONLY the play/pause signal
 *  (via Solid's `on(...)`), so position-only updates never reach this
 *  function — steady-state position flow stays on the 500ms interval.
 *
 *  `previousPlaying` is `undefined` on the first observed change (with
 *  `on(..., { defer: true })` there is no recorded prior input yet); treat
 *  that as a real transition so the first play/pause after mount still syncs.
 */
export const shouldEmitTransitionTick = (
  active: boolean,
  previousPlaying: boolean | undefined,
  playing: boolean
): boolean => active && previousPlaying !== playing;

/** Axis-aligned rectangle in physical pixels. */
export interface DesktopLyricRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Minimum overlap (physical px) the overlay must keep with some monitor for a
 *  stored position to be considered reachable by the user. */
export const MIN_VISIBLE_PX = 40;

/** Whether the overlay rect is visible enough on at least one monitor.
 *  Used to reject stale stored positions after monitor removal or resolution
 *  changes — a frameless skip-taskbar window parked off-screen would otherwise
 *  be permanently unreachable. */
export const isDesktopLyricRectVisible = (
  rect: DesktopLyricRect,
  monitors: readonly DesktopLyricRect[]
): boolean =>
  monitors.some((monitor) => {
    const overlapX =
      Math.min(rect.x + rect.width, monitor.x + monitor.width) - Math.max(rect.x, monitor.x);
    const overlapY =
      Math.min(rect.y + rect.height, monitor.y + monitor.height) - Math.max(rect.y, monitor.y);
    return overlapX >= MIN_VISIBLE_PX && overlapY >= MIN_VISIBLE_PX;
  });

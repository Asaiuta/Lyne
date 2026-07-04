/** Framework-free decision logic for the SMTC bridge.
 *
 *  Kept free of Solid/Tauri imports so it can be unit-tested under the node
 *  test harness (which resolves Solid to its server build, where effects are
 *  inert and hooks cannot be mounted). `useSmtcBridge` owns the reactive
 *  wiring; every emit/no-emit gating decision lives here.
 */

/** How often the bridge refreshes the SMTC timeline while playing. The system
 *  flyout interpolates between updates, so a coarse cadence is enough — the
 *  playback position is a per-animation-frame signal and must never drive
 *  per-frame invokes. */
export const SMTC_TIMELINE_INTERVAL_MS = 5000;

/** Metadata snapshot pushed to the Rust `smtc_update_metadata` command. */
export interface SmtcMetadataSnapshot {
  title: string;
  artist: string | null;
  album: string | null;
  coverUrl: string | null;
  durationSec: number | null;
}

/** Identity key for metadata pushes: SMTC re-pushes are keyed on this tuple
 *  and nothing else — playback position is deliberately absent, so position
 *  frames can never produce a metadata re-emit. Late supplement enrichment
 *  (NCM title/cover resolving after the track starts) changes the key and
 *  re-pushes, which is intended. */
export const smtcMetadataKey = (snapshot: SmtcMetadataSnapshot): string =>
  [
    snapshot.title,
    snapshot.artist ?? "",
    snapshot.album ?? "",
    snapshot.coverUrl ?? "",
    snapshot.durationSec === null ? "" : String(snapshot.durationSec)
  ].join("\u0000");

/** Whether the snapshot denotes a real loaded track. `fullPlayerTitle` falls
 *  back to the file path and finally ""; an empty title means nothing is
 *  loaded, and pushing empty metadata would blank the system flyout. */
export const hasSmtcTrack = (title: string): boolean => title.trim().length > 0;

/** SMTC fetches cover thumbnails itself with NO request headers, so only
 *  self-contained absolute URLs are usable: http(s) with the token embedded
 *  as a query parameter (the api client's `getCoverArtUrl` already does this)
 *  or remote NCM artwork; `file://` is loaded from disk by souvlaki.
 *  Webview-relative fallbacks like `/images/song.jpg` are meaningless outside
 *  the renderer and must be dropped rather than pushed. */
export const normalizeSmtcCoverUrl = (coverUrl: string | null): string | null => {
  if (!coverUrl) return null;
  const trimmed = coverUrl.trim();
  return /^(https?|file):\/\//i.test(trimmed) ? trimmed : null;
};

/** The engine reports duration 0 while it is still unknown; a zero-length
 *  SMTC timeline renders as a broken scrubber, so treat it as absent. */
export const normalizeSmtcDurationSec = (durationSec: number | null): number | null =>
  durationSec !== null && Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null;

/** Decide whether a play/pause change should push an immediate,
 *  out-of-interval playback update.
 *
 *  Same contract as the desktop-lyric `shouldEmitTransitionTick`: the effect
 *  tracks ONLY the play/pause signal (via Solid's `on(...)`), but its source
 *  derives from the player-state object, which can notify without the boolean
 *  changing — so this function must reject equal-value runs itself.
 *  `previousPlaying` is `undefined` on the first observed change (with
 *  `on(..., { defer: true })` there is no recorded prior input yet); treat
 *  that as a real transition. */
export const shouldPushSmtcTransition = (
  enabled: boolean,
  previousPlaying: boolean | undefined,
  playing: boolean
): boolean => enabled && previousPlaying !== playing;

/** Whether a control action forwarded from the system should be routed to the
 *  playback handlers. A stale event can arrive just after the user disables
 *  the feature (the Rust teardown races the last WinRT callback). */
export const shouldRouteSmtcControl = (enabled: boolean): boolean => enabled;

/** Whether a seek action's payload is usable as an absolute position. */
export const isValidSmtcSeekPosition = (positionSec: unknown): positionSec is number =>
  typeof positionSec === "number" && Number.isFinite(positionSec) && positionSec >= 0;

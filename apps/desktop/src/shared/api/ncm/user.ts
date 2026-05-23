/**
 * Phase 9 user-data-chain + activity wrappers.
 *
 * Each endpoint maps 1-to-1 to a backend dispatch arm in
 * `src/server/netease.rs` (see `phase9_identity_routes_resolve_to_dispatch_keys`
 * test for the canonical path-to-method mapping).
 *
 * Parameter key names below match the backend's `query.get("...")` lookups in
 * the upstream `ncm-api-rs` crate exactly. Renaming them (even to camelCase)
 * will silently drop values into the void — keep them in sync.
 */

import { requestNcm, type NcmResponseEnvelope } from "./base";

export interface NcmAccountInfo {
  /** NCM account record. `null` when the session has no logged-in user. */
  account?: Record<string, unknown> | null;
  /** Profile snapshot for the logged-in user (nickname, avatar, etc.). */
  profile?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface NcmUserDetailData {
  profile?: Record<string, unknown> | null;
  level?: number;
  listenSongs?: number;
  [key: string]: unknown;
}

export interface NcmUserSubcountData {
  /** Self-created playlists (includes the implicit "我喜欢的音乐" list). */
  createdPlaylistCount?: number;
  /** Subscribed (collected) playlists. */
  subPlaylistCount?: number;
  albumCount?: number;
  artistCount?: number;
  mvCount?: number;
  djRadioCount?: number;
  newProgramCount?: number;
  /** Some envelopes use `playlistCount` instead of `createdPlaylistCount`. */
  playlistCount?: number;
  [key: string]: unknown;
}

export interface NcmUserLevelData {
  /** Current level (0-10). */
  level?: number;
  /** Cumulative listen count contributing to leveling. */
  listenSongs?: number;
  /** Distance to the next level threshold. */
  nextPlayCount?: number;
  nextLoginCount?: number;
  nowLoginCount?: number;
  nowPlayCount?: number;
  [key: string]: unknown;
}

export interface NcmLikelistData {
  /** Song IDs the user has liked. */
  ids?: number[];
  checkPoint?: number;
  [key: string]: unknown;
}

export interface NcmCollectionSublistParams {
  limit?: number;
  offset?: number;
}

/**
 * Parameters for `/scrobble`.
 * Backend keys (lowercase, see `ncm-api-rs/src/api/scrobble.rs`):
 *  - `id`: track ID being reported.
 *  - `sourceid`: ID of the playlist / album the track was played from. Empty string when unknown.
 *  - `time`: seconds the user listened (rounded to int). NCM rejects scrobbles below ~30s.
 */
export interface NcmScrobbleParams {
  id: number;
  sourceid?: string | number;
  time?: number;
}

/**
 * Current user's NCM account + profile snapshot.
 * Backend route: `/user/account` → `user_account`.
 */
export const userAccount = (): Promise<NcmResponseEnvelope<NcmAccountInfo>> =>
  requestNcm<NcmAccountInfo>("user/account", {
    method: "POST",
    noCache: true
  });

/**
 * Detailed profile for an arbitrary user (level, listen count, location, etc.).
 * Backend route: `/user/detail` → `user_detail`.
 */
export const userDetail = (
  uid: number,
  options: { suppressActiveCookie?: boolean } = {}
): Promise<NcmResponseEnvelope<NcmUserDetailData>> =>
  requestNcm<NcmUserDetailData>("user/detail", {
    method: "POST",
    data: { uid },
    cookieOverride: options.suppressActiveCookie ? "" : undefined,
    noCache: true
  });

/**
 * Subscription counts (created vs collected playlists, artists, MVs, DJ radios).
 * Used to power "我的" page badges. Cookie required.
 * Backend route: `/user/subcount` → `user_subcount`.
 */
export const userSubcount = (): Promise<NcmResponseEnvelope<NcmUserSubcountData>> =>
  requestNcm<NcmUserSubcountData>("user/subcount", {
    method: "POST",
    noCache: true
  });

/**
 * Logged-in user's level/exp curve.
 * Backend route: `/user/level` → `user_level`.
 */
export const userLevel = (): Promise<NcmResponseEnvelope<NcmUserLevelData>> =>
  requestNcm<NcmUserLevelData>("user/level", {
    method: "POST",
    noCache: true
  });

/**
 * Liked-songs ID list for the given user.
 * Use this to power "favorite" indicators on track lists.
 * Backend route: `/likelist` → `likelist`.
 */
export const userLikelist = (uid: number): Promise<NcmResponseEnvelope<NcmLikelistData>> =>
  requestNcm<NcmLikelistData>("likelist", {
    method: "POST",
    data: { uid },
    noCache: true
  });

export const userAlbumSublist = (
  params: NcmCollectionSublistParams = {}
): Promise<NcmResponseEnvelope> =>
  requestNcm("album/sublist", {
    method: "POST",
    data: params,
    noCache: true
  });

export const userArtistSublist = (
  params: NcmCollectionSublistParams = {}
): Promise<NcmResponseEnvelope> =>
  requestNcm("artist/sublist", {
    method: "POST",
    data: params,
    noCache: true
  });

export const userMvSublist = (
  params: NcmCollectionSublistParams = {}
): Promise<NcmResponseEnvelope> =>
  requestNcm("mv/sublist", {
    method: "POST",
    data: params,
    noCache: true
  });

export const userDjSublist = (
  params: NcmCollectionSublistParams = {}
): Promise<NcmResponseEnvelope> =>
  requestNcm("dj/sublist", {
    method: "POST",
    data: params,
    noCache: true
  });

/**
 * Like or unlike a song.
 * @param id - NCM song ID
 * @param like - `true` to like, `false` to unlike
 * Backend route: `/like` → `like`.
 */
export const likeSong = (id: number, like: boolean = true): Promise<NcmResponseEnvelope> =>
  requestNcm("like", {
    method: "POST",
    data: { id, like },
    noCache: true
  });

/**
 * Daily sign-in. `type` 0 = mobile (default, awards more points), 1 = PC.
 * Backend route: `/daily_signin` → `daily_signin`.
 *
 * Note the backend route uses underscore (matches the upstream NeteaseCloudMusicApi
 * convention); `/daily/signin` is NOT wired.
 */
export const dailySignin = (type: 0 | 1 = 0): Promise<NcmResponseEnvelope> =>
  requestNcm("daily_signin", {
    method: "POST",
    data: { type },
    noCache: true
  });

/**
 * Listen-tracking ("打卡") report. Call this when a song reaches "playend"
 * (~95% complete or stopped after ≥30s). Used to drive the level-up curve.
 * Backend route: `/scrobble` → `scrobble`.
 */
export const scrobble = (params: NcmScrobbleParams): Promise<NcmResponseEnvelope> =>
  requestNcm("scrobble", {
    method: "POST",
    data: {
      id: params.id,
      ...(params.sourceid === undefined ? {} : { sourceid: params.sourceid }),
      ...(params.time === undefined ? {} : { time: params.time })
    },
    noCache: true
  });

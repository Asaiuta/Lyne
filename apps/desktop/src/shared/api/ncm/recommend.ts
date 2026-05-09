/**
 * Home-feed (recommend page) wrappers.
 *
 * Each endpoint maps 1-to-1 to a backend dispatch arm in
 * `src/server/netease.rs` (see `home_feed_routes_resolve_to_dispatch_keys`
 * test for the canonical path-to-method mapping).
 *
 * Response shapes are deliberately loose (`Record<string, unknown>`) — the
 * UI layer narrows fields it consumes. Adding strict types here would
 * couple us to upstream NeteaseCloudMusicApi shape drift.
 */

import { requestNcm, type NcmResponseEnvelope } from "./base";

export interface NcmPersonalizedParams {
  /** Page size. Server caps at 30 for `/personalized`. */
  limit?: number;
}

export interface NcmTopArtistsParams {
  limit?: number;
  offset?: number;
}

export interface NcmAlbumNewestParams {
  /** Locale filter — `ALL`, `ZH`, `EA`, `KR`, `JP`. Defaults to ALL upstream. */
  area?: string;
  limit?: number;
  offset?: number;
}

export interface NcmArtistListParams {
  /** -1 all, 1 male, 2 female, 3 group. */
  type?: number;
  /** -1 all, 7 CN, 96 western, 8 JP, 16 KR, 0 other. */
  area?: number;
  initial?: number | string;
  limit?: number;
  offset?: number;
}

export interface NcmTopSongParams {
  /** 0 all, 7 CN, 96 western, 16 KR, 8 JP. */
  type?: 0 | 7 | 96 | 16 | 8;
}

export interface NcmMvFirstParams {
  /** Locale filter — `内地`, `港台`, `欧美`, `日本`, `韩国`. */
  area?: string;
  limit?: number;
}

/** Recommended playlists (anonymous-friendly). Backend: `/personalized` → `personalized`. */
export const personalized = (params: NcmPersonalizedParams = {}): Promise<NcmResponseEnvelope> =>
  requestNcm("personalized", {
    method: "POST",
    data: { ...(params.limit === undefined ? {} : { limit: params.limit }) },
    noCache: true
  });

/** Recommended new songs. Backend: `/personalized/newsong` → `personalized_newsong`. */
export const personalizedNewsong = (
  params: NcmPersonalizedParams = {}
): Promise<NcmResponseEnvelope> =>
  requestNcm("personalized/newsong", {
    method: "POST",
    data: { ...(params.limit === undefined ? {} : { limit: params.limit }) },
    noCache: true
  });

/** Recommended MVs. Backend: `/personalized/mv` → `personalized_mv`. */
export const personalizedMv = (): Promise<NcmResponseEnvelope> =>
  requestNcm("personalized/mv", {
    method: "POST",
    noCache: true
  });

/** Recommended DJ programs (podcasts). Backend: `/personalized/djprogram` → `personalized_djprogram`. */
export const personalizedDjprogram = (): Promise<NcmResponseEnvelope> =>
  requestNcm("personalized/djprogram", {
    method: "POST",
    noCache: true
  });

/**
 * Daily-recommended playlists (cookie required — keyed off listening history).
 * Backend: `/recommend/resource` → `recommend_resource`.
 */
export const recommendResource = (): Promise<NcmResponseEnvelope> =>
  requestNcm("recommend/resource", {
    method: "POST",
    noCache: true
  });

/**
 * Daily-recommended tracks (cookie required — refreshes at midnight CST).
 * Returns `{ data: { dailySongs: [...] } }`.
 * Backend: `/recommend/songs` → `recommend_songs`.
 */
export const recommendSongs = (): Promise<NcmResponseEnvelope> =>
  requestNcm("recommend/songs", {
    method: "POST",
    noCache: true
  });

/** Private FM next song (cookie required). Backend: `/personal_fm` → `personal_fm`. */
export const personalFm = (): Promise<NcmResponseEnvelope> =>
  requestNcm("personal_fm", {
    method: "POST",
    noCache: true
  });

/** Top artists (anonymous). Backend: `/top/artists` → `top_artists`. */
export const topArtists = (
  params: NcmTopArtistsParams = {}
): Promise<NcmResponseEnvelope> =>
  requestNcm("top/artists", {
    method: "POST",
    data: {
      ...(params.limit === undefined ? {} : { limit: params.limit }),
      ...(params.offset === undefined ? {} : { offset: params.offset })
    },
    noCache: true
  });

/** Newest albums (anonymous). Backend: `/album/newest` → `album_newest`. */
export const albumNewest = (
  params: NcmAlbumNewestParams = {}
): Promise<NcmResponseEnvelope> =>
  requestNcm("album/newest", {
    method: "POST",
    data: {
      ...(params.area === undefined ? {} : { area: params.area }),
      ...(params.limit === undefined ? {} : { limit: params.limit }),
      ...(params.offset === undefined ? {} : { offset: params.offset })
    },
    noCache: true
  });

/** New albums, same source as SPlayer `newAlbumsAll`. */
export const albumNew = (
  params: NcmAlbumNewestParams = {}
): Promise<NcmResponseEnvelope> =>
  requestNcm("album/new", {
    method: "POST",
    data: {
      ...(params.area === undefined ? {} : { area: params.area }),
      ...(params.limit === undefined ? {} : { limit: params.limit }),
      ...(params.offset === undefined ? {} : { offset: params.offset })
    },
    noCache: true
  });

/** Artist list, same source as SPlayer `artistTypeList`. */
export const artistList = (
  params: NcmArtistListParams = {}
): Promise<NcmResponseEnvelope> =>
  requestNcm("artist/list", {
    method: "POST",
    data: {
      ...(params.type === undefined ? {} : { type: params.type }),
      ...(params.area === undefined ? {} : { area: params.area }),
      ...(params.initial === undefined ? {} : { initial: params.initial }),
      ...(params.limit === undefined ? {} : { limit: params.limit }),
      ...(params.offset === undefined ? {} : { offset: params.offset })
    },
    noCache: true
  });

/** New song express, same source as SPlayer `newSongs`. */
export const topSong = (params: NcmTopSongParams = {}): Promise<NcmResponseEnvelope> =>
  requestNcm("top/song", {
    method: "POST",
    data: { ...(params.type === undefined ? {} : { type: params.type }) },
    noCache: true
  });

/** Personalised DJ recommendation (cookie required). Backend: `/dj/personalize/recommend` → `dj_personalize_recommend`. */
export const djPersonalizeRecommend = (): Promise<NcmResponseEnvelope> =>
  requestNcm("dj/personalize/recommend", {
    method: "POST",
    noCache: true
  });

/** General DJ radio recommendation (anonymous). Backend: `/dj/recommend` → `dj_recommend`. */
export const djRecommend = (): Promise<NcmResponseEnvelope> =>
  requestNcm("dj/recommend", {
    method: "POST",
    noCache: true
  });

/** Featured / first-row MV (anonymous). Backend: `/mv/first` → `mv_first`. */
export const mvFirst = (params: NcmMvFirstParams = {}): Promise<NcmResponseEnvelope> =>
  requestNcm("mv/first", {
    method: "POST",
    data: {
      ...(params.area === undefined ? {} : { area: params.area }),
      ...(params.limit === undefined ? {} : { limit: params.limit })
    },
    noCache: true
  });

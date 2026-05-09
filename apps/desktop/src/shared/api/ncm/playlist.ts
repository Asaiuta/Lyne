import { requestNcm, type NcmResponseEnvelope } from "./base";

export interface NcmPlaylistDetailParams {
  id: number;
  s?: number;
}

export interface NcmPlaylistTracksParams {
  id: number;
  limit?: number;
  offset?: number;
}

export interface NcmUserPlaylistParams {
  uid: number;
  limit?: number;
  offset?: number;
}

export interface NcmTopPlaylistParams {
  cat?: string;
  order?: "hot" | "new";
  limit?: number;
  offset?: number;
  before?: number;
}

export const playlistDetail = (params: NcmPlaylistDetailParams): Promise<NcmResponseEnvelope> =>
  requestNcm("playlist/detail", {
    method: "POST",
    data: params,
    noCache: true
  });

export const playlistDetailDynamic = (id: number): Promise<NcmResponseEnvelope> =>
  requestNcm("playlist/detail/dynamic", {
    method: "POST",
    data: { id },
    noCache: true
  });

export const playlistTracks = (params: NcmPlaylistTracksParams): Promise<NcmResponseEnvelope> =>
  requestNcm("playlist/tracks", {
    method: "POST",
    data: params,
    noCache: true
  });

export const playlistTrackAll = (params: NcmPlaylistTracksParams): Promise<NcmResponseEnvelope> =>
  requestNcm("playlist/track/all", {
    method: "POST",
    data: params,
    noCache: true
  });

export const userPlaylist = (params: NcmUserPlaylistParams): Promise<NcmResponseEnvelope> =>
  requestNcm("user/playlist", {
    method: "POST",
    data: params,
    noCache: true
  });

/** Playlist square, same source as SPlayer `allCatlistPlaylist(..., hq=false)`. */
export const topPlaylist = (params: NcmTopPlaylistParams = {}): Promise<NcmResponseEnvelope> =>
  requestNcm("top/playlist", {
    method: "POST",
    data: {
      ...(params.cat === undefined ? {} : { cat: params.cat }),
      ...(params.order === undefined ? {} : { order: params.order }),
      ...(params.limit === undefined ? {} : { limit: params.limit }),
      ...(params.offset === undefined ? {} : { offset: params.offset })
    },
    noCache: true
  });

/** Featured playlist square, same source as SPlayer `allCatlistPlaylist(..., hq=true)`. */
export const topPlaylistHighquality = (params: NcmTopPlaylistParams = {}): Promise<NcmResponseEnvelope> =>
  requestNcm("top/playlist/highquality", {
    method: "POST",
    data: {
      ...(params.cat === undefined ? {} : { cat: params.cat }),
      ...(params.limit === undefined ? {} : { limit: params.limit }),
      ...(params.before === undefined ? {} : { before: params.before })
    },
    noCache: true
  });

/** Playlist category list. */
export const playlistCatlist = (hq = false): Promise<NcmResponseEnvelope> =>
  requestNcm(hq ? "playlist/highquality/tags" : "playlist/catlist", {
    method: "POST",
    data: { timestamp: Date.now() },
    noCache: true
  });

/** All toplist summaries, same source as SPlayer `topPlaylist(true)`. */
export const toplistDetail = (): Promise<NcmResponseEnvelope> =>
  requestNcm("toplist/detail", {
    method: "POST",
    noCache: true
  });

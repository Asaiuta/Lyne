import { requestNcm, type NcmResponseEnvelope } from "./base";

export interface NcmSearchParams {
  keywords: string;
  type?: number;
  limit?: number;
  offset?: number;
}

export const search = (params: NcmSearchParams): Promise<NcmResponseEnvelope> =>
  requestNcm("search", {
    method: "POST",
    data: params,
    noCache: true
  });

export const cloudsearch = (params: NcmSearchParams): Promise<NcmResponseEnvelope> =>
  requestNcm("cloudsearch", {
    method: "POST",
    data: params,
    noCache: true
  });

export const searchDefault = (): Promise<NcmResponseEnvelope> =>
  requestNcm("search/default", {
    method: "POST",
    noCache: true
  });

export const searchHot = (): Promise<NcmResponseEnvelope> =>
  requestNcm("search/hot", {
    method: "POST",
    noCache: true
  });

export const searchHotDetail = (): Promise<NcmResponseEnvelope> =>
  requestNcm("search/hot/detail", {
    method: "POST",
    noCache: true
  });

export const searchSuggest = (keywords: string): Promise<NcmResponseEnvelope> =>
  requestNcm("search/suggest", {
    method: "POST",
    data: { keywords },
    noCache: true
  });

export const searchSuggestPc = (keywords: string): Promise<NcmResponseEnvelope> =>
  requestNcm("search/suggest/pc", {
    method: "POST",
    data: { keywords },
    noCache: true
  });

export const searchMultimatch = (keywords: string): Promise<NcmResponseEnvelope> =>
  requestNcm("search/multimatch", {
    method: "POST",
    data: { keywords },
    noCache: true
  });

export const songDetail = (ids: number | number[]): Promise<NcmResponseEnvelope> =>
  requestNcm("song/detail", {
    method: "POST",
    data: {
      ids: Array.isArray(ids) ? ids.join(",") : String(ids)
    },
    noCache: true
  });

export const songMusicDetail = (id: number): Promise<NcmResponseEnvelope> =>
  requestNcm("song/music/detail", {
    method: "POST",
    data: { id },
    noCache: true
  });

export const checkMusic = (id: number, br?: number): Promise<NcmResponseEnvelope> =>
  requestNcm("check/music", {
    method: "POST",
    data: {
      id,
      ...(br === undefined ? {} : { br })
    },
    noCache: true
  });

export const lyric = (id: number): Promise<NcmResponseEnvelope> =>
  requestNcm("lyric", {
    method: "POST",
    data: { id },
    noCache: true
  });

export const lyricNew = (id: number): Promise<NcmResponseEnvelope> =>
  requestNcm("lyric/new", {
    method: "POST",
    data: { id },
    noCache: true
  });

export const album = (id: number): Promise<NcmResponseEnvelope> =>
  requestNcm("album", {
    method: "POST",
    data: { id },
    noCache: true
  });

export const albumDetail = (id: number): Promise<NcmResponseEnvelope> =>
  requestNcm("album/detail", {
    method: "POST",
    data: { id },
    noCache: true
  });

export const albumDetailDynamic = (id: number): Promise<NcmResponseEnvelope> =>
  requestNcm("album/detail/dynamic", {
    method: "POST",
    data: { id },
    noCache: true
  });

export const albumSub = (id: number, subscribe: boolean): Promise<NcmResponseEnvelope> =>
  requestNcm("album/sub", {
    method: "POST",
    data: {
      id,
      t: subscribe ? 1 : 2,
      timestamp: Date.now()
    },
    noCache: true
  });

export const artistDetail = (id: number): Promise<NcmResponseEnvelope> =>
  requestNcm("artist/detail", {
    method: "POST",
    data: { id },
    noCache: true
  });

export const artistSub = (id: number, subscribe: boolean): Promise<NcmResponseEnvelope> =>
  requestNcm("artist/sub", {
    method: "POST",
    data: {
      id,
      t: subscribe ? 1 : 2,
      timestamp: Date.now()
    },
    noCache: true
  });

export const artists = (id: number): Promise<NcmResponseEnvelope> =>
  requestNcm("artists", {
    method: "POST",
    data: { id },
    noCache: true
  });

export interface NcmArtistResourcePageParams {
  id: number;
  limit?: number;
  offset?: number;
}

export interface NcmArtistSongsParams extends NcmArtistResourcePageParams {
  order?: "hot" | "time";
}

export const artistSongs = (params: NcmArtistSongsParams): Promise<NcmResponseEnvelope> =>
  requestNcm("artist/songs", {
    method: "POST",
    data: {
      id: params.id,
      ...(params.limit === undefined ? {} : { limit: params.limit }),
      ...(params.offset === undefined ? {} : { offset: params.offset }),
      ...(params.order === undefined ? {} : { order: params.order })
    },
    noCache: true
  });

export const artistAlbum = (params: NcmArtistResourcePageParams): Promise<NcmResponseEnvelope> =>
  requestNcm("artist/album", {
    method: "POST",
    data: {
      id: params.id,
      ...(params.limit === undefined ? {} : { limit: params.limit }),
      ...(params.offset === undefined ? {} : { offset: params.offset })
    },
    noCache: true
  });

export const artistMv = (params: NcmArtistResourcePageParams): Promise<NcmResponseEnvelope> =>
  requestNcm("artist/mv", {
    method: "POST",
    data: {
      id: params.id,
      ...(params.limit === undefined ? {} : { limit: params.limit }),
      ...(params.offset === undefined ? {} : { offset: params.offset })
    },
    noCache: true
  });

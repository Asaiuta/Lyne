import { requestNcm, type NcmResponseEnvelope } from "./base";

export interface NcmSongUrlParams {
  id?: number;
  ids?: number[];
  br?: number;
  level?: string;
  encodeType?: string;
}

const songIdPayload = (params: NcmSongUrlParams) => {
  if (Array.isArray(params.ids) && params.ids.length > 0) {
    return { ids: params.ids.join(",") };
  }
  if (typeof params.id === "number") {
    return { id: params.id };
  }
  throw new Error("song URL request requires `id` or `ids`");
};

const SONG_URL_CACHE_LIMIT = 200;
const songUrlCache = new Map<string, Promise<NcmResponseEnvelope>>();

const songUrlCacheKey = (params: NcmSongUrlParams): string =>
  JSON.stringify({
    id: params.id ?? null,
    ids: params.ids ?? null,
    br: params.br ?? null
  });

const rememberSongUrlRequest = (
  key: string,
  request: Promise<NcmResponseEnvelope>
): Promise<NcmResponseEnvelope> => {
  if (songUrlCache.size >= SONG_URL_CACHE_LIMIT) {
    const oldestKey = songUrlCache.keys().next().value as string | undefined;
    if (oldestKey !== undefined) {
      songUrlCache.delete(oldestKey);
    }
  }
  const cachedRequest = request.catch((error: unknown) => {
    if (songUrlCache.get(key) === cachedRequest) {
      songUrlCache.delete(key);
    }
    throw error;
  });
  songUrlCache.set(key, cachedRequest);
  return cachedRequest;
};

export const songUrl = (params: NcmSongUrlParams): Promise<NcmResponseEnvelope> => {
  const key = songUrlCacheKey(params);
  const cached = songUrlCache.get(key);
  if (cached) return cached;
  return rememberSongUrlRequest(key, requestNcm("song/url", {
    method: "POST",
    data: {
      ...songIdPayload(params),
      ...(params.br === undefined ? {} : { br: params.br })
    },
    noCache: true
  }));
};

export const songUrlV1 = (params: NcmSongUrlParams): Promise<NcmResponseEnvelope> =>
  requestNcm("song/url/v1", {
    method: "POST",
    data: {
      ...songIdPayload(params),
      ...(params.level === undefined ? {} : { level: params.level }),
      ...(params.encodeType === undefined ? {} : { encodeType: params.encodeType })
    },
    noCache: true
  });

export const songUrlNcmget = (id: number, br?: number): Promise<NcmResponseEnvelope> =>
  requestNcm("song/url/ncmget", {
    method: "POST",
    data: {
      id,
      ...(br === undefined ? {} : { br })
    },
    noCache: true
  });

export const songUrlMatch = (id: number): Promise<NcmResponseEnvelope> =>
  requestNcm("song/url/match", {
    method: "POST",
    data: { id },
    noCache: true
  });

export const songWikiSummary = (id: number): Promise<NcmResponseEnvelope> =>
  requestNcm("song/wiki/summary", {
    method: "POST",
    data: { id },
    noCache: true
  });

export const songSheetList = (id: number): Promise<NcmResponseEnvelope> =>
  requestNcm("sheet/list", {
    method: "POST",
    data: { id },
    noCache: true
  });

export const songSheetPreview = (id: number): Promise<NcmResponseEnvelope> =>
  requestNcm("sheet/preview", {
    method: "POST",
    data: { id },
    noCache: true
  });

export const songFirstListenInfo = (id: number): Promise<NcmResponseEnvelope> =>
  requestNcm("music/first/listen/info", {
    method: "POST",
    data: { id },
    noCache: true
  });

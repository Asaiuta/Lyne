import { requestNcm, type NcmResponseEnvelope } from "./base";

export interface NcmRadioToplistParams {
  type?: "new" | "hot";
  limit?: number;
  offset?: number;
}

export interface NcmRadioCategoryParams {
  cateId: number;
  limit?: number;
  offset?: number;
}

export interface NcmRadioDetailParams {
  rid: number;
}

export interface NcmRadioProgramParams {
  rid: number;
  limit?: number;
  offset?: number;
}

export interface NcmRadioProgramDetailParams {
  id: number;
}

export const radioCatList = (): Promise<NcmResponseEnvelope> =>
  requestNcm("dj/catelist", {
    method: "POST",
    noCache: true
  });

export const radioCategoryRecommend = (): Promise<NcmResponseEnvelope> =>
  requestNcm("dj/category/recommend", {
    method: "POST",
    noCache: true
  });

export const radioToplist = (params: NcmRadioToplistParams = {}): Promise<NcmResponseEnvelope> =>
  requestNcm("dj/toplist", {
    method: "POST",
    data: {
      type: params.type ?? "hot",
      ...(params.limit === undefined ? {} : { limit: params.limit }),
      ...(params.offset === undefined ? {} : { offset: params.offset })
    },
    noCache: true
  });

export const radioCategoryHot = (params: NcmRadioCategoryParams): Promise<NcmResponseEnvelope> =>
  requestNcm("dj/radio/hot", {
    method: "POST",
    data: {
      cateId: params.cateId,
      ...(params.limit === undefined ? {} : { limit: params.limit }),
      ...(params.offset === undefined ? {} : { offset: params.offset })
    },
    noCache: true
  });

export const radioRecommendType = (type: number): Promise<NcmResponseEnvelope> =>
  requestNcm("dj/recommend/type", {
    method: "POST",
    data: { type },
    noCache: true
  });

export const radioDetail = (params: NcmRadioDetailParams): Promise<NcmResponseEnvelope> =>
  requestNcm("dj/detail", {
    method: "POST",
    data: { rid: params.rid },
    noCache: true
  });

export const radioPrograms = (params: NcmRadioProgramParams): Promise<NcmResponseEnvelope> =>
  requestNcm("dj/program", {
    method: "POST",
    data: {
      rid: params.rid,
      ...(params.limit === undefined ? {} : { limit: params.limit }),
      ...(params.offset === undefined ? {} : { offset: params.offset })
    },
    noCache: true
  });

export const radioProgramDetail = (params: NcmRadioProgramDetailParams): Promise<NcmResponseEnvelope> =>
  requestNcm("dj/program/detail", {
    method: "POST",
    data: { id: params.id },
    noCache: true
  });

export const radioSub = (rid: number, subscribe: boolean): Promise<NcmResponseEnvelope> =>
  requestNcm("dj/sub", {
    method: "POST",
    data: {
      rid,
      t: subscribe ? 1 : 0,
      timestamp: Date.now()
    },
    noCache: true
  });

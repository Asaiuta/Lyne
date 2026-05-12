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

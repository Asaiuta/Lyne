import { requestNcm, type NcmResponseEnvelope } from "./base";

export interface NcmMvDetailParams {
  mvid: number;
}

export interface NcmMvUrlParams {
  id: number;
  r?: number;
}

export interface NcmVideoDetailParams {
  id: string | number;
}

export interface NcmVideoUrlParams {
  id: string | number;
  r?: number;
}

export type NcmMvArea = "全部" | "内地" | "港台" | "欧美" | "日本" | "韩国";
export type NcmMvType = "全部" | "官方版" | "原生" | "现场版" | "网易出品";
export type NcmMvOrder = "上升最快" | "最热" | "最新";

export interface NcmMvAllParams {
  area?: NcmMvArea;
  type?: NcmMvType;
  order?: NcmMvOrder;
  limit?: number;
  offset?: number;
}

export const mvAll = (params: NcmMvAllParams = {}): Promise<NcmResponseEnvelope> =>
  requestNcm("mv/all", {
    method: "POST",
    data: {
      ...(params.area === undefined ? {} : { area: params.area }),
      ...(params.type === undefined ? {} : { type: params.type }),
      ...(params.order === undefined ? {} : { order: params.order }),
      ...(params.limit === undefined ? {} : { limit: params.limit }),
      ...(params.offset === undefined ? {} : { offset: params.offset })
    },
    noCache: true
  });

export const mvDetail = (params: NcmMvDetailParams): Promise<NcmResponseEnvelope> =>
  requestNcm("mv/detail", {
    method: "POST",
    data: { mvid: params.mvid },
    noCache: true
  });

export const mvDetailInfo = (params: NcmMvDetailParams): Promise<NcmResponseEnvelope> =>
  requestNcm("mv/detail/info", {
    method: "POST",
    data: { mvid: params.mvid },
    noCache: true
  });

export const mvUrl = (params: NcmMvUrlParams): Promise<NcmResponseEnvelope> =>
  requestNcm("mv/url", {
    method: "POST",
    data: {
      id: params.id,
      ...(params.r === undefined ? {} : { r: params.r })
    },
    noCache: true
  });

export const videoDetail = (params: NcmVideoDetailParams): Promise<NcmResponseEnvelope> =>
  requestNcm("video/detail", {
    method: "POST",
    data: { id: params.id },
    noCache: true
  });

export const videoDetailInfo = (params: NcmVideoDetailParams): Promise<NcmResponseEnvelope> =>
  requestNcm("video/detail/info", {
    method: "POST",
    data: { vid: params.id },
    noCache: true
  });

export const videoUrl = (params: NcmVideoUrlParams): Promise<NcmResponseEnvelope> =>
  requestNcm("video/url", {
    method: "POST",
    data: {
      id: params.id,
      ...(params.r === undefined ? {} : { r: params.r, res: params.r })
    },
    noCache: true
  });

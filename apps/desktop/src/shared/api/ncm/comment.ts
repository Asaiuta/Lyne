import { requestNcm, type NcmResponseEnvelope } from "./base";

export interface NcmSongComment {
  commentId: number;
  content: string;
  time: number | null;
  likedCount: number;
  liked: boolean;
  beReplied: NcmSongCommentReply | null;
  ip: {
    raw: string | null;
    location: string | null;
  } | null;
  user: {
    userId: number | null;
    nickname: string;
    avatarUrl: string | null;
  };
}

export interface NcmSongCommentReply {
  content: string;
  user: {
    userId: number | null;
    nickname: string;
    avatarUrl: string | null;
  };
}

export interface NcmSongCommentsPayload {
  total: number;
  hotComments: NcmSongComment[];
  comments: NcmSongComment[];
  hasMore: boolean;
}

export type NcmResourceCommentType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type NcmResourceCommentSort = 1 | 2 | 3;
export type NcmCommentLikeAction = 1 | 2;

export interface NcmCommentHugListPayload {
  total: number;
  count: number;
  hugComments: readonly unknown[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const readCommentContainer = (envelope: NcmResponseEnvelope): Record<string, unknown> => {
  if (isRecord(envelope.data)) return envelope.data;
  return envelope;
};

const readCommentReply = (value: unknown): NcmSongCommentReply | null => {
  const reply = Array.isArray(value) ? value.find(isRecord) : null;
  if (!reply) return null;
  const content = readString(reply.content);
  if (content === null) return null;

  const user = isRecord(reply.user) ? reply.user : null;
  return {
    content,
    user: {
      userId: readNumber(user?.userId),
      nickname: readString(user?.nickname) ?? "-",
      avatarUrl: readString(user?.avatarUrl)
    }
  };
};

const readCommentIp = (
  value: Record<string, unknown>
): NcmSongComment["ip"] => {
  const ipLocation = isRecord(value.ipLocation) ? value.ipLocation : null;
  const raw = readString(value.ip);
  const location =
    readString(value.location) ??
    readString(ipLocation?.location) ??
    readString(ipLocation?.ipLocation);
  if (raw === null && location === null) return null;
  return { raw, location };
};

const readComment = (value: unknown): NcmSongComment | null => {
  if (!isRecord(value)) {
    return null;
  }

  const user = isRecord(value.user) ? value.user : null;
  const commentId = readNumber(value.commentId);
  const content = readString(value.content);
  if (commentId === null || content === null) {
    return null;
  }

  return {
    commentId,
    content,
    time: readNumber(value.time),
    likedCount: readNumber(value.likedCount) ?? 0,
    liked: readBoolean(value.liked) ?? false,
    beReplied: readCommentReply(value.beReplied),
    ip: readCommentIp(value),
    user: {
      userId: readNumber(user?.userId),
      nickname: readString(user?.nickname) ?? "-",
      avatarUrl: readString(user?.avatarUrl)
    }
  };
};

const readComments = (value: unknown): NcmSongComment[] =>
  Array.isArray(value)
    ? value.map(readComment).filter((comment): comment is NcmSongComment => comment !== null)
    : [];

export const readSongCommentsPayload = (
  envelope: NcmResponseEnvelope
): NcmSongCommentsPayload => ({
  total: readNumber(envelope.total) ?? 0,
  hotComments: readComments(envelope.hotComments),
  comments: readComments(envelope.comments),
  hasMore: readBoolean(envelope.more) ?? readBoolean(envelope.hasMore) ?? false
});

export const readResourceCommentsPayload = (
  envelope: NcmResponseEnvelope
): NcmSongCommentsPayload => {
  const data = readCommentContainer(envelope);
  const hotComments = readComments(data.hotComments);
  const comments = readComments(data.comments);
  return {
    total: readNumber(data.total) ?? readNumber(data.totalCount) ?? readNumber(envelope.total) ?? 0,
    hotComments: hotComments.length > 0 ? hotComments : readComments(envelope.hotComments),
    comments: comments.length > 0 ? comments : readComments(envelope.comments),
    hasMore: readBoolean(data.more) ?? readBoolean(data.hasMore) ?? false
  };
};

export const readCommentHugListPayload = (
  envelope: NcmResponseEnvelope
): NcmCommentHugListPayload => {
  const data = readCommentContainer(envelope);
  const hugComments = Array.isArray(data.hugComments) ? data.hugComments : [];
  return {
    total: readNumber(data.total) ?? 0,
    count: readNumber(data.count) ?? 0,
    hugComments
  };
};

export const songComments = (
  id: number | string,
  limit = 20,
  offset = 0
): Promise<NcmResponseEnvelope> =>
  requestNcm("comment/music", {
    method: "POST",
    data: { id, limit, offset },
    noCache: true
  });

export const resourceComments = (
  id: number | string,
  type: NcmResourceCommentType,
  pageNo = 1,
  pageSize = 20,
  sortType: NcmResourceCommentSort = 2,
  cursor?: number
): Promise<NcmResponseEnvelope> =>
  requestNcm("comment/new", {
    method: "POST",
    data: {
      id,
      type,
      pageNo,
      pageSize,
      sortType,
      timestamp: Date.now(),
      ...(cursor === undefined ? {} : { cursor })
    },
    noCache: true
  });

export const resourceHotComments = (
  id: number | string,
  type: NcmResourceCommentType,
  limit = 20,
  offset = 0,
  before?: number
): Promise<NcmResponseEnvelope> =>
  requestNcm("comment/hot", {
    method: "POST",
    data: {
      id,
      type,
      limit,
      offset,
      ...(before === undefined ? {} : { before })
    },
    noCache: true
  });

export const commentLike = (
  resourceId: number | string,
  commentId: number,
  type: NcmResourceCommentType,
  action: NcmCommentLikeAction
): Promise<NcmResponseEnvelope> =>
  requestNcm("comment/like", {
    method: "POST",
    data: {
      id: resourceId,
      cid: commentId,
      type,
      t: action,
      timestamp: Date.now()
    },
    noCache: true
  });

export const hugComment = (
  userId: number,
  commentId: number,
  resourceId: number | string,
  type: NcmResourceCommentType
): Promise<NcmResponseEnvelope> =>
  requestNcm("hug/comment", {
    method: "POST",
    data: {
      uid: userId,
      cid: commentId,
      sid: resourceId,
      type,
      timestamp: Date.now()
    },
    noCache: true
  });

export const commentHugList = (
  userId: number,
  commentId: number,
  resourceId: number | string,
  type: NcmResourceCommentType,
  page = 1,
  cursor = -1,
  idCursor = -1,
  pageSize = 100
): Promise<NcmResponseEnvelope> =>
  requestNcm("comment/hug/list", {
    method: "POST",
    data: {
      uid: userId,
      cid: commentId,
      sid: resourceId,
      type,
      page,
      cursor,
      idCursor,
      pageSize,
      timestamp: Date.now()
    },
    noCache: true
  });

import { firstNonEmpty } from "./controllerHelpers";

export interface CoverResolutionRequest {
  key: string;
  coverUrl: string | null;
}

export interface CoverResolutionSupplement {
  requestKey: string;
  coverUrl: string | null;
}

export const resolveCurrentCoverUrl = (
  request: CoverResolutionRequest | null,
  supplement: CoverResolutionSupplement | null,
  currentPlayerCoverUrl: string | null,
  localCoverUrl: string | null
): string | null => {
  const currentSupplementCover =
    supplement && supplement.requestKey === request?.key ? supplement.coverUrl : null;
  return firstNonEmpty(currentSupplementCover, request?.coverUrl, currentPlayerCoverUrl, localCoverUrl);
};

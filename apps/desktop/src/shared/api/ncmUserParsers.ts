import { isInteger, isRecord, parseStatus } from "./ncmParserUtils";

export const parseNcmLikelistIdsResponse = (value: unknown): number[] => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM likelist response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load NCM likelist");
  }
  if (!Array.isArray(value.ids)) {
    throw new Error("Invalid NCM likelist payload");
  }
  const ids = value.ids.filter(isInteger);
  if (ids.length !== value.ids.length) {
    throw new Error("Invalid NCM likelist payload");
  }
  return ids;
};

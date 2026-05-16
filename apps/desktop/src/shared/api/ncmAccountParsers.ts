import type { NcmAccountState, NcmAccountSummary } from "./ncmDomainTypes";
import {
  isBoolean,
  isInteger,
  isNullableInteger,
  isNullableString,
  isRecord,
  parseStatus
} from "./ncmParserUtils";

const parseNcmAccountSummary = (value: unknown): NcmAccountSummary | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isInteger(value.user_id) ||
    !isNullableString(value.nickname) ||
    !isNullableString(value.avatar_url) ||
    !isBoolean(value.has_cookie) ||
    !isNullableInteger(value.vip_type) ||
    !isNullableInteger(value.level) ||
    !isNullableInteger(value.signin_at_ms) ||
    !isInteger(value.added_at_ms) ||
    !isInteger(value.refreshed_at_ms)
  ) {
    return null;
  }

  if ("cookie" in value) {
    throw new Error("Invalid NCM account payload");
  }

  return {
    userId: value.user_id,
    nickname: value.nickname,
    avatarUrl: value.avatar_url,
    hasCookie: value.has_cookie,
    vipType: value.vip_type,
    level: value.level,
    signinAt: value.signin_at_ms,
    addedAt: value.added_at_ms,
    refreshedAt: value.refreshed_at_ms
  };
};

export const parseNcmAccountStateResponse = (value: unknown): NcmAccountState => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM account response shape");
  }

  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to read NCM accounts");
  }

  if (!Array.isArray(value.accounts) || !isNullableInteger(value.active_user_id)) {
    throw new Error("Invalid NCM account payload");
  }
  const accounts = value.accounts.map(parseNcmAccountSummary);
  if (accounts.some((account) => account === null)) {
    throw new Error("Invalid NCM account payload");
  }

  return {
    accounts: accounts as NcmAccountSummary[],
    activeUserId: value.active_user_id
  };
};

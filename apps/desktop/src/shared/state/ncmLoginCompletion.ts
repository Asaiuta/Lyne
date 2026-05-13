import type { NcmAccountUpsertInput } from "../api/client";
import { getLoginStatusWithCookie } from "../api/ncm";
import { buildNcmAccountFromStatus } from "./NcmAccountContext";

export interface CompleteNcmLoginOptions {
  cookie: string;
  primaryEnvelope?: unknown;
  upsertAccount: (account: NcmAccountUpsertInput) => Promise<void>;
}

export const completeNcmLogin = async ({
  cookie,
  primaryEnvelope,
  upsertAccount
}: CompleteNcmLoginOptions): Promise<NcmAccountUpsertInput | null> => {
  const trimmedCookie = cookie.trim();
  if (!trimmedCookie) return null;

  const inlineAccount = primaryEnvelope
    ? buildNcmAccountFromStatus(primaryEnvelope, trimmedCookie)
    : null;
  const account =
    inlineAccount ??
    buildNcmAccountFromStatus(await getLoginStatusWithCookie(trimmedCookie), trimmedCookie);

  if (!account) return null;
  await upsertAccount(account);
  return account;
};

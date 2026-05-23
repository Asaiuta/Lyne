import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onMount,
  useContext
} from "solid-js";
import type { Accessor, JSX } from "solid-js";
import {
  createApiClient,
  type NcmAccountState,
  type NcmAccountSummary,
  type NcmAccountUpsertInput
} from "../api/client";
import {
  getLoginStatus,
  type NcmAccountInfo,
  type NcmResponseEnvelope
} from "../api/ncm";

const LEGACY_STORAGE_KEY = "audio.ncm.accounts.v1";

export interface NcmAccount {
  userId: number;
  nickname: string | null;
  avatarUrl: string | null;
  hasCookie: boolean;
  vipType: number | null;
  level: number | null;
  signinAt: number | null;
  addedAt: number;
  refreshedAt: number;
}

export type NcmAccountInput = NcmAccountUpsertInput;

export interface NcmAccountContextValue {
  userList: Accessor<NcmAccount[]>;
  activeAccount: Accessor<NcmAccount | null>;
  isBusy: Accessor<boolean>;
  upsertAccount: (account: NcmAccountInput) => Promise<void>;
  removeAccount: (userId: number) => Promise<void>;
  switchActive: (userId: number) => Promise<void>;
  refreshActive: () => Promise<void>;
  ensureActiveLoginValid: () => Promise<boolean>;
  patchActiveAccount: (patch: Partial<NcmAccount>) => void;
  logoutActive: () => Promise<void>;
}

interface ProfileSnapshot {
  userId: number | null;
  nickname: string | null;
  avatarUrl: string | null;
  vipType: number | null;
}

interface LegacyPersistedAccount extends NcmAccount {
  cookie: string;
}

interface LegacyPersistedState {
  version: 1;
  userList: LegacyPersistedAccount[];
  activeUserId: number | null;
}

const accountApi = createApiClient();
const NcmAccountContext = createContext<NcmAccountContextValue | null>(null);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const readProfileSnapshot = (
  envelope: NcmResponseEnvelope<NcmAccountInfo> | unknown
): ProfileSnapshot | null => {
  const root = isRecord(envelope) ? envelope : null;
  if (!root) return null;
  const data = isRecord(root.data) ? root.data : root;
  const profile = isRecord(data.profile) ? data.profile : null;
  const account = isRecord(data.account) ? data.account : null;

  const userId = readNumber(profile?.userId) ?? readNumber(account?.id);
  if (userId === null) return null;

  return {
    userId,
    nickname: readString(profile?.nickname) ?? readString(account?.userName),
    avatarUrl: readString(profile?.avatarUrl),
    vipType: readNumber(profile?.vipType) ?? readNumber(account?.vipType)
  };
};

const toAccount = (summary: NcmAccountSummary): NcmAccount => ({
  userId: summary.userId,
  nickname: summary.nickname,
  avatarUrl: summary.avatarUrl,
  hasCookie: summary.hasCookie,
  vipType: summary.vipType,
  level: summary.level,
  signinAt: summary.signinAt,
  addedAt: summary.addedAt,
  refreshedAt: summary.refreshedAt
});

const startOfLocalDayMs = (nowMs: number): number => {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const isLegacyPersistedState = (value: unknown): value is LegacyPersistedState => {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.userList)) return false;
  for (const entry of value.userList) {
    if (!isRecord(entry)) return false;
    if (typeof entry.userId !== "number" || typeof entry.cookie !== "string") return false;
  }
  return value.activeUserId === null || typeof value.activeUserId === "number";
};

const readLegacyPersistedState = (): LegacyPersistedState | null => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isLegacyPersistedState(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const clearLegacyPersistedState = (): void => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
};

export function NcmAccountProvider(props: { children: JSX.Element }) {
  const [userList, setUserList] = createSignal<NcmAccount[]>([]);
  const [activeUserId, setActiveUserId] = createSignal<number | null>(null);
  const [isBusy, setIsBusy] = createSignal(false);
  const [hydrated, setHydrated] = createSignal(false);

  const applyAccountState = (state: NcmAccountState): void => {
    setUserList(state.accounts.map(toAccount));
    setActiveUserId(state.activeUserId);
  };

  const hydrateAccounts = async (): Promise<void> => {
    setIsBusy(true);
    try {
      let state = await accountApi.getNcmAccounts();
      const legacy = readLegacyPersistedState();
      if (legacy && legacy.userList.length > 0) {
        for (const account of legacy.userList) {
          state = await accountApi.upsertNcmAccount({
            userId: account.userId,
            nickname: account.nickname,
            avatarUrl: account.avatarUrl,
            cookie: account.cookie,
            vipType: account.vipType,
            level: account.level,
            signinAt: account.signinAt
          });
        }
        if (
          legacy.activeUserId !== null &&
          legacy.userList.some((account) => account.userId === legacy.activeUserId)
        ) {
          state = await accountApi.setActiveNcmAccount(legacy.activeUserId);
        }
        clearLegacyPersistedState();
      }
      applyAccountState(state);
    } catch (error) {
      console.warn("[NcmAccountContext] hydrate failed; clearing account state", error);
      applyAccountState({ accounts: [], activeUserId: null });
    } finally {
      setHydrated(true);
      setIsBusy(false);
    }
  };

  onMount(() => {
    void hydrateAccounts();
  });

  const activeAccount = createMemo<NcmAccount | null>(() => {
    const id = activeUserId();
    if (id === null) return null;
    return userList().find((user) => user.userId === id) ?? null;
  });

  const inFlightSignins = new Set<number>();
  createEffect(() => {
    if (!hydrated()) return;
    const acct = activeAccount();
    if (!acct || !acct.hasCookie) return;
    if (inFlightSignins.has(acct.userId)) return;

    const todayStart = startOfLocalDayMs(Date.now());
    if (acct.signinAt !== null && acct.signinAt >= todayStart) return;

    inFlightSignins.add(acct.userId);
    const targetId = acct.userId;
    void (async () => {
      try {
        const state = await accountApi.dailySigninActiveNcmAccount();
        applyAccountState(state);
      } catch (error) {
        console.warn("[NcmAccountContext] daily signin failed", { userId: targetId, error });
      } finally {
        inFlightSignins.delete(targetId);
      }
    })();
  });

  const upsertAccount = async (account: NcmAccountInput): Promise<void> => {
    setIsBusy(true);
    try {
      const state = await accountApi.upsertNcmAccount(account);
      applyAccountState(state);
    } finally {
      setIsBusy(false);
    }
  };

  const removeAccount = async (userId: number): Promise<void> => {
    setIsBusy(true);
    try {
      const state = await accountApi.deleteNcmAccount(userId);
      applyAccountState(state);
    } finally {
      setIsBusy(false);
    }
  };

  const switchActive = async (userId: number): Promise<void> => {
    setIsBusy(true);
    try {
      const state = await accountApi.setActiveNcmAccount(userId);
      applyAccountState(state);
    } finally {
      setIsBusy(false);
    }
  };

  const refreshActive = async (): Promise<void> => {
    setIsBusy(true);
    try {
      const state = await accountApi.refreshActiveNcmAccount();
      applyAccountState(state);
    } finally {
      setIsBusy(false);
    }
  };

  const ensureActiveLoginValid = async (): Promise<boolean> => {
    const account = activeAccount();
    if (!account || !account.hasCookie) return true;
    setIsBusy(true);
    try {
      const snapshot = readProfileSnapshot(await getLoginStatus());
      if (!snapshot || snapshot.userId !== account.userId) {
        const state = await accountApi.clearActiveNcmAccount();
        applyAccountState(state);
        return false;
      }
      const state = await accountApi.refreshActiveNcmAccount();
      const refreshed = state.accounts.find((item) => item.userId === account.userId);
      const isStillActive = state.activeUserId === account.userId && refreshed?.hasCookie === true;
      applyAccountState(isStillActive ? state : { ...state, activeUserId: null });
      return isStillActive;
    } catch (error) {
      console.warn("[NcmAccountContext] active login validation failed", error);
      try {
        const state = await accountApi.clearActiveNcmAccount();
        applyAccountState(state);
      } catch (logoutError) {
        console.warn("[NcmAccountContext] failed to clear expired active login", logoutError);
        applyAccountState({ accounts: userList().map((item) => ({ ...item })), activeUserId: null });
      }
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const patchActiveAccount = (patch: Partial<NcmAccount>): void => {
    const id = activeUserId();
    if (id === null) return;
    setUserList((prev) => prev.map((user) => (user.userId === id ? { ...user, ...patch } : user)));
  };

  const logoutActive = async (): Promise<void> => {
    setIsBusy(true);
    try {
      const state = await accountApi.logoutActiveNcmAccount();
      applyAccountState(state);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <NcmAccountContext.Provider
      value={{
        userList,
        activeAccount,
        isBusy,
        upsertAccount,
        removeAccount,
        switchActive,
        refreshActive,
        ensureActiveLoginValid,
        patchActiveAccount,
        logoutActive
      }}
    >
      {props.children}
    </NcmAccountContext.Provider>
  );
}

export function useNcmAccount(): NcmAccountContextValue {
  const ctx = useContext(NcmAccountContext);
  if (!ctx) {
    throw new Error("useNcmAccount must be used within NcmAccountProvider");
  }
  return ctx;
}

export const buildNcmAccountFromStatus = (
  envelope: unknown,
  cookie: string
): NcmAccountInput | null => {
  const snapshot = readProfileSnapshot(envelope);
  if (!snapshot || snapshot.userId === null) return null;
  return {
    userId: snapshot.userId,
    nickname: snapshot.nickname,
    avatarUrl: snapshot.avatarUrl,
    cookie,
    vipType: snapshot.vipType,
    level: null,
    signinAt: null
  };
};

export const probeLoginStatus = async (): Promise<ProfileSnapshot | null> => {
  const response = await getLoginStatus();
  return readProfileSnapshot(response);
};

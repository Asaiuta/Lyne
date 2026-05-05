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
  getLoginStatus,
  logout as logoutApi,
  refreshLogin,
  setActiveNcmCookie,
  userAccount,
  type NcmAccountInfo,
  type NcmResponseEnvelope
} from "../api/ncm";

/**
 * Multi-account state for NCM. Persisted in localStorage so users keep their
 * accounts (and the matching session cookies) across launches.
 *
 * Architecture:
 *  - One signal owns the user list + active id; a memo derives the active account.
 *  - One effect persists `(userList, activeUserId)` to localStorage.
 *  - One effect mirrors `activeAccount().cookie` into the api/ncm/base.ts
 *    module-level slot so every NCM request carries that cookie.
 *
 * Backend mechanism: the proxy's `apply_query_overrides` lifts a `cookie`
 * field out of the request body/query into `Query.cookie`, which overrides
 * the HTTP Cookie header — see `src/server/netease.rs`.
 */

const STORAGE_KEY = "audio.ncm.accounts.v1";

export interface NcmAccount {
  userId: number;
  nickname: string | null;
  avatarUrl: string | null;
  /**
   * Full session cookie string (concatenated with "; ") that authenticates
   * this account against NCM, e.g. `"MUSIC_U=...; MUSIC_A_T=...; __csrf=..."`.
   * Treat as opaque and never log.
   */
  cookie: string;
  /** NCM VIP tier (10/11/100/...). `null` until first refresh. */
  vipType: number | null;
  /** Player level (0-10). `null` until first refresh. */
  level: number | null;
  /** Unix ms of last successful daily sign-in. `null` = never signed in here. */
  signinAt: number | null;
  /** Unix ms when this account was first added. */
  addedAt: number;
  /** Unix ms of the last successful `refreshActive` round-trip. */
  refreshedAt: number;
}

interface PersistedState {
  version: 1;
  userList: NcmAccount[];
  activeUserId: number | null;
}

export interface NcmAccountContextValue {
  userList: Accessor<NcmAccount[]>;
  activeAccount: Accessor<NcmAccount | null>;
  isBusy: Accessor<boolean>;
  /**
   * Add or replace an account by `userId` and make it active. Use this from
   * login flows (QR / phone / cookie / UID) once the cookie has been captured.
   */
  upsertAccount: (account: NcmAccount) => void;
  /** Drop an account from the list. If it was active, the active slot clears. */
  removeAccount: (userId: number) => void;
  /**
   * Switch to a different stored account. Re-injects the cookie reactively
   * (via the cookie sync effect), then validates with `/login/refresh` +
   * `/user/account` to pick up fresh profile data. Throws if `userId` is unknown.
   */
  switchActive: (userId: number) => Promise<void>;
  /** Re-pull `/login/refresh` + `/user/account` and update the active account. */
  refreshActive: () => Promise<void>;
  /** Shallow-merge a patch into the active account record. No-op if no active. */
  patchActiveAccount: (patch: Partial<NcmAccount>) => void;
  /**
   * Best-effort logout: hits NCM's `/logout`, then drops the active account
   * from the list. Network failures don't block local cleanup.
   */
  logoutActive: () => Promise<void>;
}

const NcmAccountContext = createContext<NcmAccountContextValue | null>(null);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

interface ProfileSnapshot {
  userId: number | null;
  nickname: string | null;
  avatarUrl: string | null;
  vipType: number | null;
}

/**
 * Extract the userId / nickname / avatar / vip from a `/user/account` or
 * `/login/status` envelope. Both responses share the
 * `{ account: {...}, profile: {...} }` shape, with NCM occasionally putting
 * the same data under a `data` wrapper — handle both.
 */
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

const isPersistedState = (value: unknown): value is PersistedState => {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  if (!Array.isArray(value.userList)) return false;
  for (const entry of value.userList) {
    if (!isRecord(entry)) return false;
    if (typeof entry.userId !== "number") return false;
    if (typeof entry.cookie !== "string") return false;
  }
  if (value.activeUserId !== null && typeof value.activeUserId !== "number") {
    return false;
  }
  return true;
};

const readPersistedState = (): PersistedState | null => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isPersistedState(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const writePersistedState = (state: PersistedState): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded / SecurityError — degrade silently rather than crashing the app.
  }
};

export function NcmAccountProvider(props: { children: JSX.Element }) {
  const [userList, setUserList] = createSignal<NcmAccount[]>([]);
  const [activeUserId, setActiveUserId] = createSignal<number | null>(null);
  const [isBusy, setIsBusy] = createSignal(false);
  const [hydrated, setHydrated] = createSignal(false);

  onMount(() => {
    const persisted = readPersistedState();
    if (persisted) {
      setUserList(persisted.userList);
      setActiveUserId(persisted.activeUserId);
    }
    setHydrated(true);
  });

  const activeAccount = createMemo<NcmAccount | null>(() => {
    const id = activeUserId();
    if (id === null) return null;
    return userList().find((user) => user.userId === id) ?? null;
  });

  // Persist to localStorage on every change — but only after hydration so we
  // don't blow away saved state with the empty default before onMount fires.
  createEffect(() => {
    if (!hydrated()) return;
    writePersistedState({
      version: 1,
      userList: userList(),
      activeUserId: activeUserId()
    });
  });

  // Mirror the active cookie into the api/ncm/base.ts injection slot so every
  // subsequent `requestNcm(...)` carries the right session.
  createEffect(() => {
    const acct = activeAccount();
    setActiveNcmCookie(acct?.cookie ?? null);
  });

  const upsertAccount = (account: NcmAccount): void => {
    setUserList((prev) => {
      const filtered = prev.filter((u) => u.userId !== account.userId);
      return [...filtered, account];
    });
    setActiveUserId(account.userId);
  };

  const removeAccount = (userId: number): void => {
    setUserList((prev) => prev.filter((u) => u.userId !== userId));
    setActiveUserId((current) => (current === userId ? null : current));
  };

  const patchActiveAccount = (patch: Partial<NcmAccount>): void => {
    const id = activeUserId();
    if (id === null) return;
    setUserList((prev) => prev.map((u) => (u.userId === id ? { ...u, ...patch } : u)));
  };

  /** Pull fresh `/user/account` and merge profile fields into `userId`. */
  const refreshProfileFor = async (userId: number): Promise<void> => {
    const accountResp = await userAccount();
    const snapshot = readProfileSnapshot(accountResp);
    if (!snapshot || snapshot.userId !== userId) return;
    const now = Date.now();
    setUserList((prev) =>
      prev.map((u) =>
        u.userId === userId
          ? {
              ...u,
              nickname: snapshot.nickname ?? u.nickname,
              avatarUrl: snapshot.avatarUrl ?? u.avatarUrl,
              vipType: snapshot.vipType ?? u.vipType,
              refreshedAt: now
            }
          : u
      )
    );
  };

  const switchActive = async (userId: number): Promise<void> => {
    const target = userList().find((u) => u.userId === userId);
    if (!target) {
      throw new Error(`No NCM account stored for userId=${userId}`);
    }
    setIsBusy(true);
    try {
      // Cookie sync effect picks this up synchronously on the next tick.
      setActiveUserId(userId);
      // Best-effort revalidation; if the cookie expired, /login/refresh will
      // throw — caller can decide whether to wipe the entry.
      await refreshLogin();
      await refreshProfileFor(userId);
    } finally {
      setIsBusy(false);
    }
  };

  const refreshActive = async (): Promise<void> => {
    const acct = activeAccount();
    if (!acct) return;
    setIsBusy(true);
    try {
      // /login/refresh is idempotent and updates the server-side session;
      // /user/account gives us the latest profile snapshot. If /login/refresh
      // fails, the cookie may be stale — surface to the caller.
      await refreshLogin();
      await refreshProfileFor(acct.userId);
    } finally {
      setIsBusy(false);
    }
  };

  const logoutActive = async (): Promise<void> => {
    const id = activeUserId();
    if (id === null) return;
    setIsBusy(true);
    try {
      try {
        await logoutApi();
      } catch {
        // Tolerate /logout failures — local state must clear regardless so
        // the user isn't trapped on a "stuck" account.
      }
      setUserList((prev) => prev.filter((u) => u.userId !== id));
      setActiveUserId(null);
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

/**
 * Convenience helper for login flows: build an `NcmAccount` from a
 * `/login/status` or `/user/account` envelope plus the captured cookie string.
 * Returns `null` if the envelope doesn't carry a userId.
 */
export const buildNcmAccountFromStatus = (
  envelope: unknown,
  cookie: string
): NcmAccount | null => {
  const snapshot = readProfileSnapshot(envelope);
  if (!snapshot || snapshot.userId === null) return null;
  const now = Date.now();
  return {
    userId: snapshot.userId,
    nickname: snapshot.nickname,
    avatarUrl: snapshot.avatarUrl,
    cookie,
    vipType: snapshot.vipType,
    level: null,
    signinAt: null,
    addedAt: now,
    refreshedAt: now
  };
};

/**
 * Probe the current session via `/login/status`. Useful for cookie-paste
 * login flows where we want to confirm the cookie is valid before storing.
 * Returns the parsed snapshot or `null` if not logged in.
 */
export const probeLoginStatus = async (): Promise<ProfileSnapshot | null> => {
  const response = await getLoginStatus();
  return readProfileSnapshot(response);
};

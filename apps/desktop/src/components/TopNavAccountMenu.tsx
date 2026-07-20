import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import {
  readUserSubcountData,
  userSubcount,
  type NcmUserSubcountData
} from "../shared/api/ncm/user";
import { useTranslation } from "../shared/i18n";
import { useNcmAccount, type NcmAccount } from "../shared/state/NcmAccountContext";
import { NaivePopover } from "../shared/ui/naive";
import { SImage } from "./SImage";
import {
  IconAlbum,
  IconArtist,
  IconChevronDown,
  IconClose,
  IconPlus,
  IconPlaylist,
  IconPower,
  IconRefresh
} from "./icons";

export type TopNavAccountCollectionTab = "playlists" | "albums" | "artists";

interface TopNavAccountMenuProps {
  onRequireNcmLogin: (options?: { disableUid?: boolean }) => void;
  onNavigateToLikedCollectionTab: (tab: TopNavAccountCollectionTab) => void;
}

const MAX_NCM_ACCOUNTS = 3;

const readPositiveCount = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
};

const hasVipType = (vipType: number | null | undefined): boolean =>
  typeof vipType === "number" && vipType !== 0;

export function TopNavAccountMenu(props: TopNavAccountMenuProps) {
  const { t } = useTranslation();
  const accountStore = useNcmAccount();
  const account = createMemo(() => accountStore.activeAccount());
  const accountName = createMemo(() => account()?.nickname ?? t("nav.account.guest"));
  const accountAvatar = createMemo(() => account()?.avatarUrl ?? null);
  const isUidMode = createMemo(() => {
    const current = account();
    return current !== null && !current.hasCookie;
  });
  const [accountMenuOpen, setAccountMenuOpen] = createSignal(false);
  const [accountMenuFeedback, setAccountMenuFeedback] = createSignal<string | null>(null);
  const [accountStats, setAccountStats] = createSignal<NcmUserSubcountData>({});
  const [accountStatsUserId, setAccountStatsUserId] = createSignal<number | null>(null);
  const [isLoadingAccountStats, setIsLoadingAccountStats] = createSignal(false);
  const [validatedAccountUserId, setValidatedAccountUserId] = createSignal<number | null>(null);

  const accountOtherAccounts = createMemo(() => {
    const currentId = account()?.userId ?? null;
    return accountStore.userList().filter((item) => item.userId !== currentId);
  });

  const accountStatItems = createMemo(() => {
    const stats = accountStats();
    const playlistCount =
      readPositiveCount(stats.playlistCount) ||
      readPositiveCount(stats.createdPlaylistCount) + readPositiveCount(stats.subPlaylistCount);
    return [
      {
        key: "playlists" as const,
        label: t("ncm.collection.tabs.playlists"),
        value: playlistCount,
        icon: IconPlaylist
      },
      {
        key: "albums" as const,
        label: t("ncm.collection.tabs.albums"),
        value: readPositiveCount(stats.albumCount),
        icon: IconAlbum
      },
      {
        key: "artists" as const,
        label: t("ncm.collection.tabs.artists"),
        value: readPositiveCount(stats.artistCount),
        icon: IconArtist
      }
    ];
  });

  const resetAccountStats = () => {
    setAccountStats({});
    setAccountStatsUserId(null);
  };

  const loadAccountStats = async () => {
    const current = account();
    if (!current || !current.hasCookie || accountStatsUserId() === current.userId) return;
    setIsLoadingAccountStats(true);
    try {
      setAccountStats(readUserSubcountData(await userSubcount()));
      setAccountStatsUserId(current.userId);
    } catch (error) {
      console.warn("[TopNavAccountMenu] failed to load account stats", error);
      setAccountStats({});
      setAccountStatsUserId(current.userId);
    } finally {
      setIsLoadingAccountStats(false);
    }
  };

  const handleExpiredActiveLogin = () => {
    resetAccountStats();
    setAccountMenuOpen(false);
    setAccountMenuFeedback(t("nav.account.expired"));
    props.onRequireNcmLogin();
  };

  const validateActiveLogin = async (): Promise<boolean> => {
    const current = account();
    if (!current || !current.hasCookie) return true;
    const ok = await accountStore.ensureActiveLoginValid();
    if (!ok) {
      handleExpiredActiveLogin();
    }
    return ok;
  };

  const handleAccountClick = async () => {
    if (account() === null) {
      props.onRequireNcmLogin();
      return;
    }
    if (!(await validateActiveLogin())) return;
    setAccountMenuFeedback(null);
    setAccountMenuOpen((open) => !open);
  };

  const handleNavigateToCollectionTab = (tab: TopNavAccountCollectionTab) => {
    setAccountMenuOpen(false);
    props.onNavigateToLikedCollectionTab(tab);
  };

  const handleSwitchAccount = async (userId: number) => {
    setAccountMenuFeedback(null);
    try {
      await accountStore.switchActive(userId);
      resetAccountStats();
      setAccountMenuOpen(false);
    } catch (error) {
      setAccountMenuFeedback(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRemoveAccount = async (userId: number) => {
    setAccountMenuFeedback(null);
    try {
      await accountStore.removeAccount(userId);
    } catch (error) {
      setAccountMenuFeedback(error instanceof Error ? error.message : String(error));
    }
  };

  const handleAddAccount = () => {
    if (accountStore.userList().length >= MAX_NCM_ACCOUNTS) {
      setAccountMenuFeedback(t("nav.account.maxAccounts", { count: MAX_NCM_ACCOUNTS }));
      return;
    }
    setAccountMenuOpen(false);
    props.onRequireNcmLogin({ disableUid: true });
  };

  const handleRefreshAccount = async () => {
    setAccountMenuFeedback(null);
    try {
      await accountStore.refreshActive();
      resetAccountStats();
      void loadAccountStats();
    } catch (error) {
      setAccountMenuFeedback(error instanceof Error ? error.message : String(error));
    }
  };

  const handleLogout = async () => {
    const current = account();
    if (!current) {
      props.onRequireNcmLogin();
      return;
    }
    if (typeof window !== "undefined" && !window.confirm(t("nav.account.logoutConfirm"))) {
      return;
    }
    setAccountMenuFeedback(null);
    try {
      await accountStore.logoutActive();
      resetAccountStats();
      setAccountMenuOpen(false);
    } catch (error) {
      setAccountMenuFeedback(error instanceof Error ? error.message : String(error));
    }
  };

  createEffect(() => {
    if (!accountMenuOpen()) return;
    void loadAccountStats();
  });

  createEffect(() => {
    const current = account();
    if (!current || !current.hasCookie) {
      setValidatedAccountUserId(null);
      return;
    }
    if (validatedAccountUserId() === current.userId) return;
    setValidatedAccountUserId(current.userId);
    void validateActiveLogin();
  });

  createEffect(() => {
    const currentId = account()?.userId ?? null;
    if (accountStatsUserId() !== null && accountStatsUserId() !== currentId) {
      resetAccountStats();
    }
    if (currentId === null) {
      setAccountMenuOpen(false);
    }
  });

  return (
    <div class="top-nav-account-wrap">
      <NaivePopover
        triggerMode="manual"
        placement="bottom-end"
        gutter={8}
        showArrow={false}
        raw
        open={accountMenuOpen()}
        onOpenChange={setAccountMenuOpen}
        class="top-nav-account-popover"
        rootClass="top-nav-account-popover-trigger"
        ariaLabel={t("nav.account.aria", { name: accountName() })}
        role="dialog"
        trigger={
          <button
            type="button"
            class={`top-nav-account${accountMenuOpen() ? " is-open" : ""}`}
            data-no-drag
            aria-haspopup="dialog"
            aria-expanded={accountMenuOpen()}
            aria-label={t("nav.account.aria", { name: accountName() })}
            onClick={handleAccountClick}
          >
            <span class="top-nav-account-avatar" aria-hidden="true">
              <Show when={accountAvatar()} fallback={<IconArtist />}>
                {(avatar) => <SImage src={avatar()} alt="" observeVisibility={false} shape="circle" aspect="square" />}
              </Show>
            </span>
            <span class="top-nav-account-copy">
              <span class="top-nav-account-name">{accountName()}</span>
            </span>
            <Show when={hasVipType(account()?.vipType)}>
              <span class="top-nav-account-vip">VIP</span>
            </Show>
            <span class="top-nav-account-badge">
              <IconChevronDown />
            </span>
          </button>
        }
      >
        <Show when={account()}>
        {(current) => (
          <AccountDropdown
            current={current()}
            isBusy={accountStore.isBusy()}
            isUidMode={isUidMode()}
            isLoadingStats={isLoadingAccountStats()}
            stats={accountStatItems()}
            otherAccounts={accountOtherAccounts()}
            feedback={accountMenuFeedback()}
            onNavigateToCollectionTab={handleNavigateToCollectionTab}
            onSwitchAccount={handleSwitchAccount}
            onRemoveAccount={handleRemoveAccount}
            onAddAccount={handleAddAccount}
            onRefreshAccount={handleRefreshAccount}
            onLogout={handleLogout}
          />
        )}
        </Show>
      </NaivePopover>
    </div>
  );
}

interface AccountDropdownProps {
  current: NcmAccount;
  isBusy: boolean;
  isUidMode: boolean;
  isLoadingStats: boolean;
  stats: ReadonlyArray<{
    key: TopNavAccountCollectionTab;
    label: string;
    value: number;
    icon: typeof IconPlaylist;
  }>;
  otherAccounts: readonly NcmAccount[];
  feedback: string | null;
  onNavigateToCollectionTab: (tab: TopNavAccountCollectionTab) => void;
  onSwitchAccount: (userId: number) => Promise<void>;
  onRemoveAccount: (userId: number) => Promise<void>;
  onAddAccount: () => void;
  onRefreshAccount: () => Promise<void>;
  onLogout: () => Promise<void>;
}

function AccountDropdown(props: AccountDropdownProps) {
  const { t } = useTranslation();

  return (
    <div class="top-nav-account-menu" data-no-drag>
      <section class="top-nav-account-menu-profile">
        <span class="top-nav-account-menu-name">{props.current.nickname ?? t("nav.account.unknown")}</span>
        <div class="top-nav-account-menu-tags">
          <span class="top-nav-account-menu-level">Lv.{props.current.level ?? 0}</span>
          <Show when={hasVipType(props.current.vipType)}>
            <span class="top-nav-account-menu-vip">VIP</span>
          </Show>
        </div>
      </section>

      <div class="top-nav-account-menu-divider" />

      <Show
        when={!props.isUidMode}
        fallback={
          <section class="top-nav-account-uid-note">
            <strong>{t("nav.account.uidMode")}</strong>
            <span>{t("nav.account.uidModeHint")}</span>
          </section>
        }
      >
        <section class="top-nav-account-stats" aria-label={t("nav.account.stats")}>
          <For each={props.stats}>
            {(item) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  class="top-nav-account-stat"
                  onClick={() => props.onNavigateToCollectionTab(item.key)}
                  disabled={props.isLoadingStats}
                >
                  <Icon />
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </button>
              );
            }}
          </For>
        </section>
      </Show>

      <Show when={!props.isUidMode}>
        <div class="top-nav-account-menu-divider" />
        <section class="top-nav-account-switch">
          <span class="top-nav-account-section-title">{t("nav.account.switchTitle")}</span>
          <Show
            when={props.otherAccounts.length > 0}
            fallback={<span class="top-nav-account-empty">{t("nav.account.noOtherAccounts")}</span>}
          >
            <For each={props.otherAccounts}>
              {(item) => (
                <div class="top-nav-account-switch-item">
                  <button
                    type="button"
                    class="top-nav-account-switch-main"
                    onClick={() => void props.onSwitchAccount(item.userId)}
                    disabled={props.isBusy}
                  >
                    <span class="top-nav-account-switch-avatar" aria-hidden="true">
                      <Show when={item.avatarUrl} fallback={<IconArtist />}>
                        {(avatar) => <SImage src={avatar()} alt="" observeVisibility={false} shape="circle" aspect="square" />}
                      </Show>
                    </span>
                    <span class="top-nav-account-switch-name">{item.nickname ?? item.userId}</span>
                  </button>
                  <button
                    type="button"
                    class="top-nav-account-delete"
                    aria-label={t("nav.account.removeAccount", {
                      name: item.nickname ?? item.userId
                    })}
                    onClick={() => void props.onRemoveAccount(item.userId)}
                    disabled={props.isBusy}
                  >
                    <IconClose />
                  </button>
                </div>
              )}
            </For>
          </Show>
          <button
            type="button"
            class="top-nav-account-add"
            onClick={props.onAddAccount}
            disabled={props.isBusy}
          >
            <IconPlus />
            {t("nav.account.addAccount")}
          </button>
        </section>
      </Show>

      <Show when={props.feedback}>
        {(message) => <div class="top-nav-account-feedback">{message()}</div>}
      </Show>

      <div class="top-nav-account-menu-divider" />
      <div class="top-nav-account-actions">
        <button
          type="button"
          class="top-nav-account-action"
          onClick={() => void props.onRefreshAccount()}
          disabled={props.isBusy || props.isUidMode}
        >
          <IconRefresh />
          {t("nav.account.refresh")}
        </button>
        <button
          type="button"
          class="top-nav-account-action is-danger"
          onClick={() => void props.onLogout()}
          disabled={props.isBusy}
        >
          <IconPower />
          {t("ncm.login.action.logout")}
        </button>
      </div>
    </div>
  );
}

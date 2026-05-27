import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import type { ActivePage } from "../shared/ui/navigation";
import { isOnlineOnlyPage } from "../shared/ui/navigation";
import type { ApiClient } from "../shared/api/client";
import type { LocalPlaylist, ShuffleMode } from "../shared/api/types";
import { useNcmAccount } from "../shared/state/NcmAccountContext";
import { useUISettings, type SidebarHiddenItemKey } from "../shared/state/useUISettings";
import { useTranslation } from "../shared/i18n";
import { resolveArtworkUrl } from "../shared/ui/artwork";
import {
  SidebarIconButton,
  SidebarNavButton,
  SidebarPopselect,
  SidebarPlaylistItem,
  type NaiveSidebarPopselectOption,
  type NaiveSidebarIconComponent
} from "../shared/ui/naive";
import { CreatePlaylistModal } from "./CreatePlaylistModal";
import { SImage } from "./SImage";
import type { OnlinePlaylistSummary, UserPlaylistMode } from "../features/online/ncmPlaylistSummary";
import {
  loadNcmUserPlaylistGroupsCached,
  refreshNcmUserPlaylistGroupsCache,
  subscribeNcmUserPlaylistGroups
} from "../features/online/ncmPlaylistSummaryCache";
import {
  loadLocalPlaylistsCached,
  refreshLocalPlaylistsCache,
  subscribeLocalPlaylists
} from "../features/library/localPlaylistSummaryCache";
import {
  IconChevronDown,
  IconCheckmark,
  IconCloud,
  IconFolder,
  IconLogo,
  IconPlaylist,
  IconQueueAdd,
  IconRefresh,
  IconSPlayerAdd,
  IconSPlayerDiscover,
  IconSPlayerFavorite,
  IconSPlayerHeartBit,
  IconSPlayerHistory,
  IconSPlayerHome,
  IconSPlayerMenu,
  IconSPlayerRadio,
  IconSPlayerRecord,
  IconSPlayerStar
} from "./icons";

type IconComponent = NaiveSidebarIconComponent;

interface NavItem {
  key: ActivePage;
  icon: IconComponent;
  labelKey: string;
}

interface NavGroup {
  key: "online" | "mine";
  items: readonly NavItem[];
}

type PlaylistGroupKey = "created" | "collected";

const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  {
    key: "online",
    items: [
      { key: "recommend", icon: IconSPlayerHome, labelKey: "sidebar.nav.recommend.label" },
      { key: "discover", icon: IconSPlayerDiscover, labelKey: "sidebar.nav.discover.label" },
      { key: "personal-fm", icon: IconSPlayerRadio, labelKey: "sidebar.nav.personalFm.label" },
      { key: "radio", icon: IconSPlayerRecord, labelKey: "sidebar.nav.radio.label" }
    ]
  },
  {
    key: "mine",
    items: [
      { key: "liked-songs", icon: IconSPlayerFavorite, labelKey: "sidebar.nav.likedSongs.label" },
      { key: "liked", icon: IconSPlayerStar, labelKey: "sidebar.nav.liked.label" },
      { key: "cloud", icon: IconCloud, labelKey: "sidebar.nav.cloud.label" },
      { key: "download", icon: IconQueueAdd, labelKey: "sidebar.nav.download.label" },
      { key: "streaming", icon: IconPlaylist, labelKey: "sidebar.nav.streaming.label" },
      { key: "library", icon: IconFolder, labelKey: "sidebar.nav.library.label" },
      { key: "recent", icon: IconSPlayerHistory, labelKey: "sidebar.nav.recent.label" }
    ]
  }
];

const STORAGE_KEY = "ui.sidebar.collapsed";
const SECTIONS_STORAGE_KEY = "ui.sidebar.collapsedSections";
const NARROW_BREAKPOINT_PX = 980;
const LOGIN_REQUIRED_PAGES = new Set<ActivePage>([
  "personal-fm",
  "liked-songs",
  "liked",
  "cloud",
  "created-playlists",
  "collected-playlists"
]);

type CreatedPlaylistSource = "online" | "local";
type SidebarPage = Exclude<ActivePage, "song-wiki">;

const CREATED_PLAYLIST_SOURCE_OPTIONS: ReadonlyArray<{
  value: CreatedPlaylistSource;
  labelKey: "sidebar.playlist.online" | "sidebar.playlist.local";
}> = [
  { value: "online", labelKey: "sidebar.playlist.online" },
  { value: "local", labelKey: "sidebar.playlist.local" }
];

const SIDEBAR_SETTING_KEY_BY_PAGE: Record<SidebarPage, SidebarHiddenItemKey> = {
  recommend: "recommend",
  discover: "discover",
  "personal-fm": "personalFm",
  radio: "radio",
  "liked-songs": "likedSongs",
  liked: "liked",
  cloud: "cloud",
  download: "download",
  streaming: "streaming",
  library: "library",
  recent: "recent",
  "created-playlists": "createdPlaylists",
  "collected-playlists": "collectedPlaylists"
};

const hasSidebarSetting = (page: ActivePage): page is SidebarPage =>
  page in SIDEBAR_SETTING_KEY_BY_PAGE;

const readSidebarStorage = (key: string): string | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.warn("[Sidebar] failed to read persisted layout", error);
    return null;
  }
};

const writeSidebarStorage = (key: string, value: string): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn("[Sidebar] failed to persist layout", error);
  }
};

const readPersistedCollapse = (): boolean => {
  return readSidebarStorage(STORAGE_KEY) === "1";
};

const readPersistedCollapsedSections = (): Set<string> => {
  try {
    const raw = readSidebarStorage(SECTIONS_STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    console.warn("[Sidebar] failed to parse persisted sections");
  }
  return new Set();
};

const isNarrowViewport = (): boolean => {
  if (typeof window === "undefined") return false;
  return window.innerWidth < NARROW_BREAKPOINT_PX;
};

const isTauriRuntime = (): boolean => {
  if (typeof window === "undefined") return false;
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
};

interface SidebarProps {
  api: ApiClient;
  activePage: ActivePage;
  onChange: (page: ActivePage) => void;
  selectedPlaylistId?: number | null;
  onSelectPlaylist?: (page: UserPlaylistMode, playlistId: number) => void;
  onSelectLocalPlaylist?: (playlistId: string) => void;
  isNcmLoggedIn: boolean;
  onRequireNcmLogin: () => void;
  onRefreshPersonalFm?: () => void;
  onStartHeartbeat?: () => void;
  shuffleMode?: ShuffleMode;
}

export function Sidebar(props: SidebarProps) {
  const { t, td } = useTranslation();
  const uiSettings = useUISettings();
  const accountStore = useNcmAccount();
  const [collapsedPersisted, setCollapsedPersisted] = createSignal(readPersistedCollapse());
  const [forceCollapsedNarrow, setForceCollapsedNarrow] = createSignal(isNarrowViewport());
  const [collapsedSections, setCollapsedSections] = createSignal(readPersistedCollapsedSections());
  const [createdPlaylists, setCreatedPlaylists] = createSignal<OnlinePlaylistSummary[]>([]);
  const [collectedPlaylists, setCollectedPlaylists] = createSignal<OnlinePlaylistSummary[]>([]);
  const [localPlaylists, setLocalPlaylists] = createSignal<LocalPlaylist[]>([]);
  const [createdPlaylistSource, setCreatedPlaylistSource] =
    createSignal<CreatedPlaylistSource>("online");
  const [selectedLocalPlaylistId, setSelectedLocalPlaylistId] = createSignal<string | null>(null);
  const [createPlaylistOpen, setCreatePlaylistOpen] = createSignal<boolean>(false);
  const [createSourceMenuOpen, setCreateSourceMenuOpen] = createSignal<boolean>(false);

  const readErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : t("common.error.requestFailed");

  createEffect(() => {
    writeSidebarStorage(STORAGE_KEY, collapsedPersisted() ? "1" : "0");
  });

  onMount(() => {
    const unsubscribe = subscribeLocalPlaylists(setLocalPlaylists);
    void loadLocalPlaylistsCached(props.api)
      .then(setLocalPlaylists)
      .catch((error) => {
        setLocalPlaylists([]);
        console.warn("[Sidebar] failed to load local playlists", readErrorMessage(error));
      });
    onCleanup(unsubscribe);
  });

  createEffect(() => {
    writeSidebarStorage(SECTIONS_STORAGE_KEY, JSON.stringify([...collapsedSections()]));
  });

  onMount(() => {
    if (typeof window === "undefined") return;
    const handler = () => setForceCollapsedNarrow(isNarrowViewport());
    window.addEventListener("resize", handler);
    onCleanup(() => window.removeEventListener("resize", handler));
  });

  const loadUserPlaylists = async (userId: number) => {
    const groups = await loadNcmUserPlaylistGroupsCached(props.api, userId);
    return [groups.created, groups.collected] as const;
  };

  createEffect(() => {
    const activeAccount = accountStore.activeAccount();
    if (!activeAccount) {
      setCreatedPlaylists([]);
      setCollectedPlaylists([]);
      setCreatePlaylistOpen(false);
      return;
    }

    let cancelled = false;
    const unsubscribe = subscribeNcmUserPlaylistGroups(activeAccount.userId, (groups) => {
      setCreatedPlaylists(groups.created);
      setCollectedPlaylists(groups.collected);
    });
    void (async () => {
      try {
        const [created, collected] = await loadUserPlaylists(activeAccount.userId);
        if (cancelled) return;
        setCreatedPlaylists(created);
        setCollectedPlaylists(collected);
      } catch (error) {
        if (cancelled) return;
        setCreatedPlaylists([]);
        setCollectedPlaylists([]);
        console.warn("[Sidebar] failed to load playlists", readErrorMessage(error));
      }
    })();

    onCleanup(() => {
      cancelled = true;
      unsubscribe();
    });
  });

  const toggleSection = (key: PlaylistGroupKey) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const collapsed = () => collapsedPersisted() || forceCollapsedNarrow();
  const className = () => `sidebar${collapsed() ? " is-collapsed" : ""}`;
  const toggleAria = () =>
    collapsedPersisted() ? t("sidebar.aria.expand") : t("sidebar.aria.collapse");
  const isPageHidden = (page: SidebarPage): boolean =>
    uiSettings.sidebarHiddenItems[SIDEBAR_SETTING_KEY_BY_PAGE[page]];
  const isItemHidden = (item: NavItem): boolean =>
    hasSidebarSetting(item.key) && isPageHidden(item.key);
  const isItemAllowed = (item: NavItem): boolean => {
    if (!uiSettings.useOnlineService && isOnlineOnlyPage(item.key)) return false;
    switch (item.key) {
      case "personal-fm":
      case "cloud":
        return props.isNcmLoggedIn;
      case "download":
      case "streaming":
        return false;
      case "library":
        return isTauriRuntime();
      default:
        return true;
    }
  };
  const visibleNavGroups = createMemo<ReadonlyArray<NavGroup>>(() =>
    NAV_GROUPS.filter((group) => uiSettings.useOnlineService || group.key !== "online")
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => !isItemHidden(item) && isItemAllowed(item))
      }))
      .filter((group) => group.items.length > 0)
  );
  const showCreatedPlaylistGroup = (): boolean =>
    !isPageHidden("created-playlists") &&
    (uiSettings.useOnlineService || createdPlaylistSource() === "local" || localPlaylists().length > 0);
  const showCollectedPlaylistGroup = (): boolean =>
    uiSettings.useOnlineService && !isPageHidden("collected-playlists");
  const showPlaylistDivider = (): boolean =>
    !collapsed() && (showCreatedPlaylistGroup() || showCollectedPlaylistGroup());
  const playlistItemsForGroup = (groupKey: PlaylistGroupKey): OnlinePlaylistSummary[] =>
    groupKey === "created" ? createdPlaylists() : collectedPlaylists();
  const localPlaylistCover = (playlist: LocalPlaylist): string | null =>
    resolveArtworkUrl({
      externalArtworkUrl: playlist.cover_external_artwork_url,
      mediaId: playlist.cover_media_id,
      hasCoverArt: playlist.cover_has_cover_art,
      urls: props.api
    });
  const canOpenPage = (page: ActivePage): boolean => {
    if (props.isNcmLoggedIn || !LOGIN_REQUIRED_PAGES.has(page)) return true;
    props.onRequireNcmLogin();
    return false;
  };
  const handleNavItemClick = (page: ActivePage) => {
    if (!canOpenPage(page)) return;
    props.onChange(page);
  };
  const handlePlaylistSelect = (page: UserPlaylistMode, playlistId: number) => {
    if (!canOpenPage(page)) return;
    setSelectedLocalPlaylistId(null);
    props.onSelectPlaylist?.(page, playlistId);
  };
  const handleLocalPlaylistSelect = (playlistId: string) => {
    setSelectedLocalPlaylistId(playlistId);
    props.onSelectLocalPlaylist?.(playlistId);
  };
  const handleCreatePlaylistClick = () => {
    if (createdPlaylistSource() === "online" && !props.isNcmLoggedIn) {
      props.onRequireNcmLogin();
      return;
    }
    setCreatePlaylistOpen(true);
  };
  const handleBrandActivate = () => {
    props.onChange(uiSettings.useOnlineService ? "recommend" : "library");
  };
  const handlePlaylistCreated = async (mode: CreatedPlaylistSource) => {
    if (mode === "local") {
      setLocalPlaylists(await refreshLocalPlaylistsCache(props.api));
      return;
    }

    const activeAccount = accountStore.activeAccount();
    if (!activeAccount) return;
    const groups = await refreshNcmUserPlaylistGroupsCache(props.api, activeAccount.userId);
    setCreatedPlaylists(groups.created);
    setCollectedPlaylists(groups.collected);
  };
  const showOnlineCreatedPlaylists = () => createdPlaylistSource() === "online";
  const createdSectionTitle = () =>
    createdPlaylistSource() === "local"
      ? t("sidebar.playlist.local")
      : t("sidebar.section.createdPlaylists");
  const createdPlaylistSourceOptions = createMemo<
    ReadonlyArray<NaiveSidebarPopselectOption<CreatedPlaylistSource>>
  >(() =>
    CREATED_PLAYLIST_SOURCE_OPTIONS.map((option) => ({
      value: option.value,
      label: td(option.labelKey)
    }))
  );

  const renderNavItem = (item: NavItem): JSX.Element => {
    const Icon = item.icon;
    const isActive = () => item.key === props.activePage;
    const label = () => td(item.labelKey);
    const badgeCount = () => (item.key === "download" ? 0 : 0);
    const showFmRefresh = () =>
      item.key === "personal-fm" && !collapsed() && props.isNcmLoggedIn;
    const showHeartMode = () =>
      item.key === "liked-songs" && !collapsed() && !uiSettings.sidebarHiddenItems.heartbeatMode;
    const isHeartActive = () => props.shuffleMode === "heartbeat";
    const handleFmRefresh = (event: MouseEvent) => {
      event.stopPropagation();
      props.onRefreshPersonalFm?.();
    };
    const handleHeartMode = (event: MouseEvent) => {
      event.stopPropagation();
      if (!props.isNcmLoggedIn) {
        props.onRequireNcmLogin();
        return;
      }
      props.onStartHeartbeat?.();
    };

    return (
      <li class="sidebar-nav-entry">
        <SidebarNavButton
          icon={Icon}
          label={label()}
          active={isActive()}
          collapsed={collapsed()}
          routeKey={item.key}
          badgeCount={badgeCount()}
          onClick={() => handleNavItemClick(item.key)}
        />
        <Show when={showFmRefresh()}>
          <SidebarIconButton
            icon={IconRefresh}
            label={td("sidebar.nav.personalFm.refresh")}
            variant="nav"
            onClick={handleFmRefresh}
          />
        </Show>
        <Show when={showHeartMode()}>
          <SidebarIconButton
            icon={IconSPlayerHeartBit}
            label={td("sidebar.nav.likedSongs.heartMode")}
            variant="nav"
            class="sidebar-nav-action--heart"
            active={isHeartActive()}
            pressed={isHeartActive()}
            onClick={handleHeartMode}
          />
        </Show>
      </li>
    );
  };

  const renderNavList = (items: readonly NavItem[]): JSX.Element => (
    <ul class="sidebar-nav">
      <For each={items}>{renderNavItem}</For>
    </ul>
  );

  const renderPlaylistHeader = (groupKey: PlaylistGroupKey): JSX.Element => {
    const sectionCollapsed = () => collapsedSections().has(groupKey);
    const title = () =>
      groupKey === "created" ? createdSectionTitle() : t("sidebar.section.collectedPlaylists");

    return (
      <div class="sidebar-section-header">
        <div class="sidebar-user-list">
          <span class="sidebar-section-label">{title()}</span>
          <Show when={groupKey === "created"}>
            <div class="sidebar-section-header-actions">
              <SidebarPopselect
                label={td("sidebar.playlist.source")}
                open={createSourceMenuOpen()}
                value={createdPlaylistSource()}
                options={createdPlaylistSourceOptions()}
                triggerIcon={IconSPlayerMenu}
                checkIcon={IconCheckmark}
                onOpenChange={setCreateSourceMenuOpen}
                onChange={setCreatedPlaylistSource}
              />
              <SidebarIconButton
                icon={IconSPlayerAdd}
                label={td("sidebar.playlist.create")}
                variant="section"
                onClick={(event) => {
                  event.stopPropagation();
                  handleCreatePlaylistClick();
                }}
              />
            </div>
          </Show>
        </div>
        <button
          type="button"
          class={`sidebar-section-toggle${sectionCollapsed() ? " is-collapsed" : ""}`}
          onClick={() => toggleSection(groupKey)}
          aria-label={sectionCollapsed() ? "Expand" : "Collapse"}
        >
          <IconChevronDown />
        </button>
      </div>
    );
  };

  const renderOnlinePlaylistItems = (groupKey: PlaylistGroupKey): JSX.Element => {
    const page: UserPlaylistMode =
      groupKey === "created" ? "created-playlists" : "collected-playlists";

    return (
      <ul class="sidebar-playlist-list">
        <For each={playlistItemsForGroup(groupKey)}>
          {(playlist) => {
            const isActive = () =>
              props.activePage === page && (props.selectedPlaylistId ?? null) === playlist.id;

            return (
              <li>
                <SidebarPlaylistItem
                  label={playlist.name}
                  active={isActive()}
                  showCover={uiSettings.menuShowCover}
                  icon={IconPlaylist}
                  onClick={() => handlePlaylistSelect(page, playlist.id)}
                  cover={
                    <Show when={playlist.coverUrl} fallback={<span>{playlist.name.slice(0, 1)}</span>}>
                      {(coverUrl) => (
                        <SImage
                          src={coverUrl()}
                          alt=""
                          observeVisibility={true}
                          shape="rect"
                          aspect="square"
                        />
                      )}
                    </Show>
                  }
                />
              </li>
            );
          }}
        </For>
      </ul>
    );
  };

  const renderLocalPlaylistItems = (): JSX.Element => (
    <ul class="sidebar-playlist-list">
      <For each={localPlaylists()}>
        {(playlist) => {
          const coverUrl = () => localPlaylistCover(playlist);
          const isActive = () =>
            props.activePage === "library" && selectedLocalPlaylistId() === playlist.playlist_id;

          return (
            <li>
              <SidebarPlaylistItem
                label={playlist.name}
                active={isActive()}
                showCover={uiSettings.menuShowCover}
                icon={IconPlaylist}
                onClick={() => handleLocalPlaylistSelect(playlist.playlist_id)}
                cover={
                  <Show when={coverUrl()} fallback={<span>{playlist.name.slice(0, 1)}</span>}>
                    {(url) => (
                      <SImage
                        src={url()}
                        alt=""
                        observeVisibility={true}
                        shape="rect"
                        aspect="square"
                      />
                    )}
                  </Show>
                }
              />
            </li>
          );
        }}
      </For>
    </ul>
  );

  const renderPlaylistBody = (groupKey: PlaylistGroupKey): JSX.Element => {
    const sectionCollapsed = () => collapsedSections().has(groupKey);
    const showOnlineList = () =>
      groupKey === "collected" || (groupKey === "created" && showOnlineCreatedPlaylists());

    return (
      <div class={`sidebar-section-body${sectionCollapsed() ? " is-collapsed" : ""}`}>
        <div class="sidebar-section-body-inner">
          <Show when={showOnlineList()}>{renderOnlinePlaylistItems(groupKey)}</Show>
          <Show when={groupKey === "created" && !showOnlineCreatedPlaylists()}>
            {renderLocalPlaylistItems()}
          </Show>
        </div>
      </div>
    );
  };

  const renderCollapsedPlaylistGroup = (groupKey: PlaylistGroupKey): JSX.Element => {
    const Icon = groupKey === "created" ? IconPlaylist : IconSPlayerStar;
    const label = () =>
      groupKey === "created" ? createdSectionTitle() : t("sidebar.section.collectedPlaylists");

    return (
      <button
        type="button"
        class="sidebar-nav-button sidebar-playlist-group-collapsed-button"
        title={label()}
        onClick={() => toggleSection(groupKey)}
      >
        <span class="sidebar-nav-item sidebar-playlist-group-collapsed">
          <span class="sidebar-nav-icon" aria-hidden="true">
            <Icon />
          </span>
        </span>
      </button>
    );
  };

  return (
    <nav class={className()} aria-label={t("sidebar.aria.primary")}>
      <div class="sidebar-scrollbar">
        <div class="sidebar-content">
          <button
            type="button"
            class="sidebar-brand"
            aria-label={t("sidebar.brand.product")}
            onClick={handleBrandActivate}
          >
            <span class="sidebar-brand-logo" aria-hidden="true">
              <IconLogo />
            </span>
            <span class="sidebar-brand-product">{t("sidebar.brand.product")}</span>
          </button>

          <div class="sidebar-scroll">
            <div class="sidebar-menu">
              <For each={visibleNavGroups()}>
                {(group, index) => (
                  <>
                    <Show when={index() > 0 && !collapsed()}>
                      <div class="sidebar-menu-divider" role="separator" aria-hidden="true" />
                    </Show>
                    {renderNavList(group.items)}
                  </>
                )}
              </For>

              <Show when={showPlaylistDivider()}>
                <div class="sidebar-menu-divider" role="separator" aria-hidden="true" />
              </Show>

              <Show when={showCreatedPlaylistGroup()}>
                <div class="sidebar-playlist-group sidebar-playlist-group--created">
                  <Show when={!collapsed()} fallback={renderCollapsedPlaylistGroup("created")}>
                    {renderPlaylistHeader("created")}
                    {renderPlaylistBody("created")}
                  </Show>
                </div>
              </Show>

              <Show when={showCollectedPlaylistGroup()}>
                <div class="sidebar-playlist-group sidebar-playlist-group--collected">
                  <Show when={!collapsed()} fallback={renderCollapsedPlaylistGroup("collected")}>
                    {renderPlaylistHeader("collected")}
                    {renderPlaylistBody("collected")}
                  </Show>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>
      <button
        type="button"
        class="sidebar-rail-toggle"
        onClick={() => setCollapsedPersisted((current) => !current)}
        aria-label={toggleAria()}
        title={toggleAria()}
        disabled={forceCollapsedNarrow()}
      />
      <CreatePlaylistModal
        api={props.api}
        open={createPlaylistOpen()}
        mode={createdPlaylistSource()}
        onClose={() => setCreatePlaylistOpen(false)}
        onCreated={handlePlaylistCreated}
      />
    </nav>
  );
}

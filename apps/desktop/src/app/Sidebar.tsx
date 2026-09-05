import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import type { ActivePage, LibraryDestination } from "../shared/ui/navigation";
import { isOnlineOnlyPage } from "../shared/ui/navigation";
import type { ApiClient } from "../shared/api/client";
import type { LocalPlaylist, ShuffleMode } from "../shared/api/types";
import { useNcmAccount } from "../shared/state/NcmAccountContext";
import type { SidebarHiddenItemKey } from "../shared/state/uiSettingsModel";
import { useUISettings } from "../shared/state/useUISettings";
import {
  persistUISettingField,
  readUISettingField
} from "../shared/state/uiSettingsStorage";
import { useTranslation } from "../shared/i18n";
import { resolveArtworkUrl } from "../shared/ui/artwork";
import { scheduleIdlePreload } from "../shared/ui/idlePreload";
import {
  NaiveButton,
  SidebarIconButton,
  SidebarNavButton,
  SidebarPopselect,
  SidebarPlaylistItem,
  type NaiveSidebarPopselectOption,
  type NaiveSidebarIconComponent
} from "../shared/ui/naive";
import { CreatePlaylistModal } from "../components/CreatePlaylistModal";
import { SImage } from "../components/SImage";
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
  IconAlbum,
  IconArtist,
  IconCloud,
  IconFolder,
  IconLogo,
  IconPlaylist,
  IconQueueAdd,
  IconRefresh,
  IconAddFilled,
  IconDiscoverFilled,
  IconFavoriteFilled,
  IconHeartbeatFilled,
  IconHistoryFilled,
  IconHomeFilled,
  IconMenuFilled,
  IconMusic,
  IconRadioFilled,
  IconRecordFilled,
  IconStarFilled
} from "../components/icons";
import {
  isOfflineSidebarBlockActive,
  visibleOfflineSidebarBlocks,
  type OfflineSidebarBlock
} from "./offlineSidebarModel";
import {
  SIDEBAR_COLLAPSED_CONTENT_IDLE_TIMING,
  createSidebarCollapseLifecycle,
  initialSidebarCollapsePhase,
  sidebarCollapsePresentation,
  type SidebarCollapsePhase,
  type SidebarCollapsePresentation
} from "./sidebarCollapseLifecycle";
import {
  createSidebarGeometryMotionForElement,
  type SidebarGeometryMotion
} from "./sidebarGeometryMotion";

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
      { key: "recommend", icon: IconHomeFilled, labelKey: "sidebar.nav.recommend.label" },
      { key: "discover", icon: IconDiscoverFilled, labelKey: "sidebar.nav.discover.label" },
      { key: "personal-fm", icon: IconRadioFilled, labelKey: "sidebar.nav.personalFm.label" },
      { key: "radio", icon: IconRecordFilled, labelKey: "sidebar.nav.radio.label" }
    ]
  },
  {
    key: "mine",
    items: [
      { key: "liked-songs", icon: IconFavoriteFilled, labelKey: "sidebar.nav.likedSongs.label" },
      { key: "liked", icon: IconStarFilled, labelKey: "sidebar.nav.liked.label" },
      { key: "cloud", icon: IconCloud, labelKey: "sidebar.nav.cloud.label" },
      { key: "download", icon: IconQueueAdd, labelKey: "sidebar.nav.download.label" },
      { key: "streaming", icon: IconPlaylist, labelKey: "sidebar.nav.streaming.label" },
      { key: "library", icon: IconFolder, labelKey: "sidebar.nav.library.label" },
      { key: "recent", icon: IconHistoryFilled, labelKey: "sidebar.nav.recent.label" }
    ]
  }
];

const COLLAPSE_TRANSITION_PROPERTY = "--sidebar-inline-size";
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
type SidebarPage = Exclude<
  ActivePage,
  | "song-wiki"
  | "search"
  | "album-detail"
  | "playlist-detail"
  | "daily-songs"
  | "artist-detail"
  | "video-detail"
  | "radio-detail"
>;

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
  libraryDestination: LibraryDestination;
  onChange: (page: ActivePage) => void;
  onSelectLibraryDestination: (destination: LibraryDestination) => void;
  selectedPlaylistId?: number | null;
  onSelectPlaylist?: (page: UserPlaylistMode, playlist: OnlinePlaylistSummary) => void;
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
  const initialCollapsedPersisted = readUISettingField("sidebarCollapsed");
  const initialForceCollapsedNarrow = isNarrowViewport();
  const [collapsedPersisted, setCollapsedPersisted] =
    createSignal<boolean>(initialCollapsedPersisted);
  const [forceCollapsedNarrow, setForceCollapsedNarrow] =
    createSignal<boolean>(initialForceCollapsedNarrow);
  const initialCollapsed = initialCollapsedPersisted || initialForceCollapsedNarrow;
  const [collapsePhase, setCollapsePhase] = createSignal<SidebarCollapsePhase>(
    initialSidebarCollapsePhase(initialCollapsed)
  );
  const [expansionShellContentMounted, setExpansionShellContentMounted] =
    createSignal<boolean | null>(null);
  const collapsePresentation = createMemo<SidebarCollapsePresentation>(() => {
    const presentation = sidebarCollapsePresentation(collapsePhase());
    const shellContentMounted = expansionShellContentMounted();
    if (shellContentMounted === null) return presentation;
    return {
      expandedContentMounted: shellContentMounted,
      expandedContentVisible: false,
      compactContentVisible: true,
      motionActive: presentation.motionActive
    };
  });
  const [waapiGeometryEnabled, setWaapiGeometryEnabled] = createSignal<boolean>(false);
  let sidebarElement: HTMLElement | undefined;
  let geometryMotion: SidebarGeometryMotion | null = null;
  let runningCollapseGeneration: number | null = null;
  let cancelExpansionContentReveal: (() => void) | undefined;
  const scheduleCollapseFrame = (callback: () => void): (() => void) => {
    if (typeof window === "undefined") {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) callback();
      });
      return () => {
        cancelled = true;
      };
    }
    const handle = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(handle);
  };
  const collapseLifecycle = createSidebarCollapseLifecycle({
    initialCollapsed,
    onPhaseChange: setCollapsePhase,
    scheduleFrame: scheduleCollapseFrame,
    scheduleDelay: (callback, delayMs) => {
      if (typeof window === "undefined") return () => {};
      const handle = window.setTimeout(callback, delayMs);
      return () => window.clearTimeout(handle);
    },
    scheduleIdle: (callback) =>
      scheduleIdlePreload(callback, SIDEBAR_COLLAPSED_CONTENT_IDLE_TIMING)
  });
  const cancelPendingExpansionReveal = (): void => {
    cancelExpansionContentReveal?.();
    cancelExpansionContentReveal = undefined;
  };
  const scheduleExpansionContentReveal = (generation: number): void => {
    let cancelFirstFrame: (() => void) | undefined;
    let cancelSecondFrame: (() => void) | undefined;
    cancelFirstFrame = scheduleCollapseFrame(() => {
      cancelFirstFrame = undefined;
      cancelSecondFrame = scheduleCollapseFrame(() => {
        cancelSecondFrame = undefined;
        cancelExpansionContentReveal = undefined;
        if (collapseLifecycle.currentGeneration() !== generation) return;
        setExpansionShellContentMounted(null);
      });
    });
    cancelExpansionContentReveal = () => {
      cancelFirstFrame?.();
      cancelSecondFrame?.();
    };
  };
  const beginCollapseMotion = (nextCollapsed: boolean): number => {
    const reducedMotion =
      typeof window === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const expectedGeneration = collapseLifecycle.currentGeneration() + 1;
    cancelPendingExpansionReveal();
    if (!nextCollapsed && !reducedMotion) {
      setExpansionShellContentMounted(collapsePresentation().expandedContentMounted);
    } else {
      setExpansionShellContentMounted(null);
    }
    const generation = collapseLifecycle.beginTransition(nextCollapsed, reducedMotion);
    runningCollapseGeneration = generation;
    if (geometryMotion !== null && !reducedMotion) {
      geometryMotion.animateTo(generation, nextCollapsed);
    } else {
      geometryMotion?.cancel();
    }
    if (!nextCollapsed && !reducedMotion && generation === expectedGeneration) {
      scheduleExpansionContentReveal(generation);
    } else if (generation !== expectedGeneration) {
      setExpansionShellContentMounted(null);
    }
    return generation;
  };
  const [collapsedSections, setCollapsedSections] = createSignal(
    new Set(readUISettingField("sidebarCollapsedSections"))
  );
  const [createdPlaylists, setCreatedPlaylists] = createSignal<OnlinePlaylistSummary[]>([]);
  const [collectedPlaylists, setCollectedPlaylists] = createSignal<OnlinePlaylistSummary[]>([]);
  const [localPlaylists, setLocalPlaylists] = createSignal<LocalPlaylist[]>([]);
  const [createdPlaylistSource, setCreatedPlaylistSource] =
    createSignal<CreatedPlaylistSource>("online");
  const [createPlaylistOpen, setCreatePlaylistOpen] = createSignal<boolean>(false);
  const [createSourceMenuOpen, setCreateSourceMenuOpen] = createSignal<boolean>(false);

  const readErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : t("common.error.requestFailed");

  onMount(() => {
    if (sidebarElement === undefined) return;
    const motion = createSidebarGeometryMotionForElement(
      sidebarElement,
      (generation, targetCollapsed) => {
        if (runningCollapseGeneration === generation) runningCollapseGeneration = null;
        collapseLifecycle.requestSettle(generation, targetCollapsed);
      }
    );
    if (motion === null) return;
    geometryMotion = motion;
    setWaapiGeometryEnabled(true);
  });

  createEffect(() => {
    persistUISettingField("sidebarCollapsed", collapsedPersisted());
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
    persistUISettingField("sidebarCollapsedSections", [...collapsedSections()]);
  });

  onMount(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      const nextForceCollapsed = isNarrowViewport();
      const previousForceCollapsed = forceCollapsedNarrow();
      if (nextForceCollapsed === previousForceCollapsed) return;

      const previousCollapsed = previousForceCollapsed || collapsedPersisted();
      const nextCollapsed = nextForceCollapsed || collapsedPersisted();
      if (previousCollapsed !== nextCollapsed) {
        beginCollapseMotion(nextCollapsed);
      }
      setForceCollapsedNarrow(nextForceCollapsed);
    };
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

  const expandSection = (key: PlaylistGroupKey): void => {
    setCollapsedSections((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const collapsed = () => collapsedPersisted() || forceCollapsedNarrow();
  const className = () =>
    `sidebar${waapiGeometryEnabled() ? " is-waapi-geometry" : ""}${collapsed() ? " is-collapsed" : ""}${collapsePresentation().motionActive ? " is-collapse-motion-active" : ""}`;
  const toggleAria = () =>
    collapsedPersisted() ? t("sidebar.aria.expand") : t("sidebar.aria.collapse");

  const collapseTargetReached = (sidebar: HTMLElement): boolean => {
    const style = window.getComputedStyle(sidebar);
    const targetToken = collapsed() ? "--sidebar-width-collapsed" : "--sidebar-width";
    const targetWidth = Number.parseFloat(style.getPropertyValue(targetToken));
    if (!Number.isFinite(targetWidth)) return false;
    return Math.abs(sidebar.getBoundingClientRect().width - targetWidth) <= 0.75;
  };

  const handleCollapseTransitionEvent = (event: TransitionEvent): void => {
    if (waapiGeometryEnabled()) return;
    if (
      event.target !== event.currentTarget ||
      event.propertyName !== COLLAPSE_TRANSITION_PROPERTY
    ) {
      return;
    }
    if (event.type === "transitionrun") {
      runningCollapseGeneration = collapseLifecycle.currentGeneration();
      return;
    }
    if (event.type === "transitioncancel") {
      return;
    }
    if (event.type === "transitionend" && runningCollapseGeneration !== null) {
      const sidebar = event.currentTarget;
      if (!(sidebar instanceof HTMLElement) || !collapseTargetReached(sidebar)) return;
      const completedGeneration = runningCollapseGeneration;
      runningCollapseGeneration = null;
      collapseLifecycle.requestSettle(completedGeneration, collapsed());
    }
  };

  const handleCollapseToggle = (): void => {
    if (forceCollapsedNarrow()) return;
    const nextCollapsed = !collapsedPersisted();
    beginCollapseMotion(nextCollapsed);
    setCollapsedPersisted(nextCollapsed);
  };

  const handleOfflinePlaylistGroupActivate = (): void => {
    if (!collapsed()) {
      toggleSection("created");
      return;
    }
    expandSection("created");
    if (forceCollapsedNarrow()) {
      // The responsive rail owns the width below the breakpoint; remember the
      // user's intent and let the resize lifecycle perform the visual expand.
      if (collapsedPersisted()) setCollapsedPersisted(false);
      return;
    }
    if (collapsedPersisted()) handleCollapseToggle();
  };

  onCleanup(() => {
    cancelPendingExpansionReveal();
    geometryMotion?.dispose();
    collapseLifecycle.dispose();
  });

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
    showCreatedPlaylistGroup() || showCollectedPlaylistGroup();
  const playlistItemsForGroup = (groupKey: PlaylistGroupKey): OnlinePlaylistSummary[] =>
    groupKey === "created" ? createdPlaylists() : collectedPlaylists();
  const localPlaylistCover = (playlist: LocalPlaylist): string | null =>
    resolveArtworkUrl({
      externalArtworkUrl: playlist.cover_external_artwork_url,
      mediaId: playlist.cover_media_id,
      hasCoverArt: playlist.cover_has_cover_art,
      urls: props.api
    });
  const playlistEntryClass = (): string =>
    `sidebar-playlist-entry${uiSettings.menuShowCover ? " is-cover-visible" : " is-cover-hidden"}`;
  const canOpenPage = (page: ActivePage): boolean => {
    if (props.isNcmLoggedIn || !LOGIN_REQUIRED_PAGES.has(page)) return true;
    props.onRequireNcmLogin();
    return false;
  };
  const handleNavItemClick = (page: ActivePage) => {
    if (!canOpenPage(page)) return;
    props.onChange(page);
  };
  const handlePlaylistSelect = (page: UserPlaylistMode, playlist: OnlinePlaylistSummary) => {
    if (!canOpenPage(page)) return;
    props.onSelectPlaylist?.(page, playlist);
  };
  const handleLocalPlaylistSelect = (playlistId: string) => {
    props.onSelectLocalPlaylist?.(playlistId);
  };
  const effectiveCreatedPlaylistSource = (): CreatedPlaylistSource =>
    uiSettings.useOnlineService ? createdPlaylistSource() : "local";
  const handleCreatePlaylistClick = () => {
    if (effectiveCreatedPlaylistSource() === "online" && !props.isNcmLoggedIn) {
      props.onRequireNcmLogin();
      return;
    }
    setCreatePlaylistOpen(true);
  };
  const handleBrandActivate = () => {
    if (uiSettings.useOnlineService) {
      props.onChange("recommend");
      return;
    }
    props.onSelectLibraryDestination({ kind: "tab", tab: "songs" });
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
  const showOnlineCreatedPlaylists = () => effectiveCreatedPlaylistSource() === "online";
  const createdSectionTitle = () =>
    effectiveCreatedPlaylistSource() === "local"
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
            icon={IconHeartbeatFilled}
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
    const sectionToggleLabel = () =>
      `${sectionCollapsed() ? t("sidebar.aria.expand") : t("sidebar.aria.collapse")} ${title()}`;

    return (
      <div class="sidebar-section-header">
        <div class="sidebar-user-list">
          <span class="sidebar-section-label">{title()}</span>
          <Show when={groupKey === "created"}>
            <div class="sidebar-section-header-actions">
              <Show when={uiSettings.useOnlineService}>
                <SidebarPopselect
                  label={td("sidebar.playlist.source")}
                  open={createSourceMenuOpen()}
                  value={createdPlaylistSource()}
                  options={createdPlaylistSourceOptions()}
                  triggerIcon={IconMenuFilled}
                  checkIcon={IconCheckmark}
                  onOpenChange={setCreateSourceMenuOpen}
                  onChange={setCreatedPlaylistSource}
                />
              </Show>
              <SidebarIconButton
                icon={IconAddFilled}
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
          aria-label={sectionToggleLabel()}
          aria-expanded={!sectionCollapsed()}
          title={sectionToggleLabel()}
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
              (props.activePage === page || props.activePage === "playlist-detail") &&
              (props.selectedPlaylistId ?? null) === playlist.id;

            return (
              <li class={playlistEntryClass()}>
                <SidebarPlaylistItem
                  label={playlist.name}
                  active={isActive()}
                  showCover={uiSettings.menuShowCover}
                  icon={IconPlaylist}
                  onClick={() => handlePlaylistSelect(page, playlist)}
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
            props.activePage === "library" &&
            props.libraryDestination.kind === "playlist" &&
            props.libraryDestination.playlistId === playlist.playlist_id;

          return (
            <li class={playlistEntryClass()}>
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

  const renderPlaylistBody = (
    groupKey: PlaylistGroupKey,
    collapseWithSidebar = false
  ): JSX.Element => {
    const sectionCollapsed = () => collapsedSections().has(groupKey);
    const bodyCollapsed = () => sectionCollapsed() || (collapseWithSidebar && collapsed());
    const showOnlineList = () =>
      groupKey === "collected" || (groupKey === "created" && showOnlineCreatedPlaylists());

    return (
      <div class={`sidebar-section-body${bodyCollapsed() ? " is-collapsed" : ""}`}>
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
    const Icon = groupKey === "created" ? IconPlaylist : IconStarFilled;
    const label = () =>
      groupKey === "created" ? createdSectionTitle() : t("sidebar.section.collectedPlaylists");
    const isActive = () =>
      groupKey === "created" &&
      effectiveCreatedPlaylistSource() === "local" &&
      props.activePage === "library" &&
      props.libraryDestination.kind === "playlist";

    return (
      <NaiveButton
        class={`sidebar-nav-button sidebar-nav-item sidebar-playlist-group-collapsed-button sidebar-playlist-group-collapsed${isActive() ? " is-active" : ""}`}
        ariaLabel={label()}
        title={label()}
        onClick={() => toggleSection(groupKey)}
      >
        <span class="sidebar-nav-icon" aria-hidden="true">
          <Icon />
        </span>
      </NaiveButton>
    );
  };

  const renderOfflineLocalPlaylistGroup = (): JSX.Element => {
    const sectionCollapsed = () => collapsedSections().has("created");
    const hasActivePlaylist = () =>
      props.activePage === "library" && props.libraryDestination.kind === "playlist";

    return (
      <div class="sidebar-playlist-group sidebar-playlist-group--created sidebar-local-playlists-group">
        <ul class="sidebar-nav">
          <li class="sidebar-nav-entry sidebar-local-playlists-entry">
            <SidebarNavButton
              icon={IconPlaylist}
              label={createdSectionTitle()}
              active={(collapsed() || sectionCollapsed()) && hasActivePlaylist()}
              collapsed={collapsed()}
              expanded={!sectionCollapsed()}
              routeKey="library:local-playlists"
              onClick={handleOfflinePlaylistGroupActivate}
            />
            <div
              class="sidebar-local-playlists-actions"
              aria-hidden={collapsed()}
              inert={collapsed()}
              onClick={() => toggleSection("created")}
            >
              <SidebarIconButton
                icon={IconAddFilled}
                label={td("sidebar.playlist.create")}
                variant="section"
                class="sidebar-local-playlists-create"
                onClick={(event) => {
                  event.stopPropagation();
                  handleCreatePlaylistClick();
                }}
              />
              <span
                class={`sidebar-local-playlists-toggle${sectionCollapsed() ? " is-collapsed" : ""}`}
                aria-hidden="true"
              >
                <IconChevronDown />
              </span>
            </div>
          </li>
        </ul>
        <Show when={collapsePresentation().expandedContentMounted}>
          <div
            class="sidebar-playlist-expanded-content sidebar-local-playlists-body"
            hidden={!collapsePresentation().expandedContentVisible}
            aria-hidden={!collapsePresentation().expandedContentVisible}
            inert={!collapsePresentation().expandedContentVisible}
          >
            {renderPlaylistBody("created", true)}
          </div>
        </Show>
      </div>
    );
  };

  const renderPlaylistGroup = (groupKey: PlaylistGroupKey): JSX.Element => (
    <div class={`sidebar-playlist-group sidebar-playlist-group--${groupKey}`}>
      <Show when={collapsePresentation().expandedContentMounted}>
        <div
          class="sidebar-playlist-expanded-content"
          hidden={!collapsePresentation().expandedContentVisible}
          aria-hidden={!collapsePresentation().expandedContentVisible}
          inert={!collapsePresentation().expandedContentVisible}
        >
          {renderPlaylistHeader(groupKey)}
          {renderPlaylistBody(groupKey)}
        </div>
      </Show>
      <div
        class="sidebar-playlist-compact-content"
        hidden={!collapsePresentation().compactContentVisible}
        aria-hidden={!collapsed()}
        inert={!collapsed()}
      >
        {renderCollapsedPlaylistGroup(groupKey)}
      </div>
    </div>
  );

  const offlineBlockIcon = (block: Exclude<OfflineSidebarBlock, { kind: "local-playlists" }>) => {
    switch (block.icon) {
      case "music":
        return IconMusic;
      case "album":
        return IconAlbum;
      case "artist":
        return IconArtist;
      case "folder":
        return IconFolder;
      case "recent":
        return IconHistoryFilled;
      default: {
        const _exhaustive: never = block;
        return _exhaustive;
      }
    }
  };

  const renderOfflineBlock = (block: OfflineSidebarBlock): JSX.Element => {
    if (block.kind === "local-playlists") return renderOfflineLocalPlaylistGroup();

    const Icon = offlineBlockIcon(block);
    const label = () => td(block.labelKey);
    const handleClick = () => {
      if (block.kind === "page") {
        props.onChange(block.page);
        return;
      }
      props.onSelectLibraryDestination({ kind: "tab", tab: block.tab });
    };

    return (
      <ul class="sidebar-nav">
        <li class="sidebar-nav-entry">
          <SidebarNavButton
            icon={Icon}
            label={label()}
            active={isOfflineSidebarBlockActive(
              block,
              props.activePage,
              props.libraryDestination
            )}
            collapsed={collapsed()}
            routeKey={block.kind === "page" ? block.page : `library:${block.tab}`}
            onClick={handleClick}
          />
        </li>
      </ul>
    );
  };

  return (
    <nav
      ref={(element) => {
        sidebarElement = element;
      }}
      class={className()}
      aria-label={t("sidebar.aria.primary")}
      data-collapse-phase={collapsePhase()}
      onTransitionRun={handleCollapseTransitionEvent}
      onTransitionEnd={handleCollapseTransitionEvent}
      onTransitionCancel={handleCollapseTransitionEvent}
    >
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
              <Show
                when={uiSettings.useOnlineService}
                fallback={
                  <For each={visibleOfflineSidebarBlocks(uiSettings.sidebarHiddenItems)}>
                    {renderOfflineBlock}
                  </For>
                }
              >
                <For each={visibleNavGroups()}>
                  {(group, index) => (
                    <>
                      <Show when={index() > 0}>
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
                  {renderPlaylistGroup("created")}
                </Show>

                <Show when={showCollectedPlaylistGroup()}>
                  {renderPlaylistGroup("collected")}
                </Show>
              </Show>
            </div>
          </div>
        </div>
      </div>
      <button
        type="button"
        class="sidebar-rail-toggle"
        onClick={handleCollapseToggle}
        aria-label={toggleAria()}
        aria-expanded={!collapsed()}
        title={toggleAria()}
        disabled={forceCollapsedNarrow()}
      />
      <div
        class="sidebar-rail-toggle-motion-hit-corridor"
        aria-hidden="true"
        onPointerDown={(event) => event.preventDefault()}
        onClick={handleCollapseToggle}
      />
      <CreatePlaylistModal
        api={props.api}
        open={createPlaylistOpen()}
        mode={effectiveCreatedPlaylistSource()}
        onClose={() => setCreatePlaylistOpen(false)}
        onCreated={handlePlaylistCreated}
      />
    </nav>
  );
}

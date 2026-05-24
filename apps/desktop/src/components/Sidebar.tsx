import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { Component, JSX } from "solid-js";
import type { ActivePage } from "../shared/ui/navigation";
import { isOnlineOnlyPage } from "../shared/ui/navigation";
import type { ApiClient } from "../shared/api/client";
import type { LocalPlaylist, ShuffleMode } from "../shared/api/types";
import { useNcmAccount } from "../shared/state/NcmAccountContext";
import { useUISettings, type SidebarHiddenItemKey } from "../shared/state/useUISettings";
import { useTranslation } from "../shared/i18n";
import { resolveArtworkUrl } from "../shared/ui/artwork";
import { useDismissibleOverlay } from "../shared/ui/useDismissibleOverlay";
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
  IconCloud,
  IconCollapse,
  IconCompass,
  IconExpand,
  IconFolder,
  IconHeart,
  IconHeartBit,
  IconHistory,
  IconList,
  IconLogo,
  IconPlus,
  IconPlaylist,
  IconQueueAdd,
  IconRefresh,
  IconSparkle,
  IconStar,
  IconVolumeHigh
} from "./icons";

type IconComponent = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

interface NavItem {
  key: ActivePage;
  icon: IconComponent;
  labelKey: string;
}

interface NavSection {
  key: string;
  labelKey: string;
  items: readonly NavItem[];
  collapsible?: boolean;
}

const SECTIONS: ReadonlyArray<NavSection> = [
  {
    key: "online",
    labelKey: "sidebar.section.onlineMusic",
    items: [
      { key: "recommend", icon: IconSparkle, labelKey: "sidebar.nav.recommend.label" },
      { key: "discover", icon: IconCompass, labelKey: "sidebar.nav.discover.label" },
      { key: "personal-fm", icon: IconRefresh, labelKey: "sidebar.nav.personalFm.label" },
      { key: "radio", icon: IconVolumeHigh, labelKey: "sidebar.nav.radio.label" }
    ]
  },
  {
    key: "mine",
    labelKey: "sidebar.section.myMusic",
    items: [
      { key: "liked-songs", icon: IconHeart, labelKey: "sidebar.nav.likedSongs.label" },
      { key: "liked", icon: IconHeart, labelKey: "sidebar.nav.liked.label" },
      { key: "cloud", icon: IconCloud, labelKey: "sidebar.nav.cloud.label" },
      { key: "download", icon: IconQueueAdd, labelKey: "sidebar.nav.download.label" },
      { key: "streaming", icon: IconPlaylist, labelKey: "sidebar.nav.streaming.label" },
      { key: "library", icon: IconFolder, labelKey: "sidebar.nav.library.label" },
      { key: "recent", icon: IconHistory, labelKey: "sidebar.nav.recent.label" }
    ]
  },
  {
    key: "created",
    labelKey: "sidebar.section.createdPlaylists",
    collapsible: true,
    items: [
      {
        key: "created-playlists",
        icon: IconPlaylist,
        labelKey: "sidebar.section.createdPlaylists"
      }
    ]
  },
  {
    key: "collected",
    labelKey: "sidebar.section.collectedPlaylists",
    collapsible: true,
    items: [
      {
        key: "collected-playlists",
        icon: IconStar,
        labelKey: "sidebar.section.collectedPlaylists"
      }
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
  let createSourceMenuRef: HTMLDivElement | undefined;

  const readErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : t("common.error.requestFailed");

  useDismissibleOverlay(createSourceMenuOpen, {
    isInside: (target) => !!createSourceMenuRef && createSourceMenuRef.contains(target),
    onDismiss: () => setCreateSourceMenuOpen(false)
  });

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

  const toggleSection = (key: string) => {
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
  const isItemHidden = (item: NavItem): boolean =>
    hasSidebarSetting(item.key) && uiSettings.sidebarHiddenItems[SIDEBAR_SETTING_KEY_BY_PAGE[item.key]];
  const isItemAllowed = (item: NavItem): boolean =>
    uiSettings.useOnlineService || !isOnlineOnlyPage(item.key);
  const isSectionAllowed = (sectionKey: string): boolean => {
    if (uiSettings.useOnlineService) return true;
    return sectionKey !== "online" && sectionKey !== "created" && sectionKey !== "collected";
  };
  const visibleSections = createMemo<ReadonlyArray<NavSection>>(() =>
    SECTIONS.filter((section) => isSectionAllowed(section.key))
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => !isItemHidden(item) && isItemAllowed(item))
      }))
      .filter((section) => section.items.length > 0)
  );
  const playlistItemsForSection = (sectionKey: string): OnlinePlaylistSummary[] =>
    sectionKey === "created" ? createdPlaylists() : sectionKey === "collected" ? collectedPlaylists() : [];
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

  return (
    <nav class={className()} aria-label={t("sidebar.aria.primary")}>
      <button type="button" class="sidebar-brand" onClick={() => props.onChange(uiSettings.useOnlineService ? "recommend" : "library")}>
        <span class="sidebar-brand-logo" aria-hidden="true">
          <IconLogo />
        </span>
        <span class="sidebar-brand-product">{t("sidebar.brand.product")}</span>
      </button>

      <div class="sidebar-scroll">
        <div class="sidebar-sections">
          <For each={visibleSections()}>
            {(section) => {
              const sectionCollapsed = () => collapsedSections().has(section.key);
              const sectionLabel = () => td(section.labelKey);

              return (
                <div class={`sidebar-section sidebar-section--${section.key}`}>
                  <Show when={!collapsed()}>
                    <div class="sidebar-section-header">
                      <span class="sidebar-section-label">
                        {section.key === "created" ? createdSectionTitle() : sectionLabel()}
                      </span>
                      <div class="sidebar-section-header-actions">
                        <Show when={section.key === "created"}>
                          <div class="sidebar-playlist-source-menu" ref={createSourceMenuRef}>
                            <button
                              type="button"
                              class={`sidebar-section-action-icon sidebar-playlist-source-trigger${createSourceMenuOpen() ? " is-open" : ""}`}
                              aria-label={td("sidebar.playlist.source")}
                              aria-haspopup="menu"
                              aria-expanded={createSourceMenuOpen()}
                              title={td("sidebar.playlist.source")}
                              onClick={(event) => {
                                event.stopPropagation();
                                setCreateSourceMenuOpen((open) => !open);
                              }}
                            >
                              <IconList />
                            </button>
                            <Show when={createSourceMenuOpen()}>
                              <div
                                class="sidebar-playlist-source-popover"
                                role="menu"
                                aria-label={td("sidebar.playlist.source")}
                              >
                                <For each={CREATED_PLAYLIST_SOURCE_OPTIONS}>
                                  {(option) => {
                                    const isActive = () => createdPlaylistSource() === option.value;
                                    return (
                                      <button
                                        type="button"
                                        class={`sidebar-playlist-source-option${isActive() ? " is-active" : ""}`}
                                        role="menuitemradio"
                                        aria-checked={isActive()}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setCreatedPlaylistSource(option.value);
                                          setCreateSourceMenuOpen(false);
                                        }}
                                      >
                                        {td(option.labelKey)}
                                      </button>
                                    );
                                  }}
                                </For>
                              </div>
                            </Show>
                          </div>
                          <button
                            type="button"
                            class="sidebar-section-action-icon"
                            aria-label={td("sidebar.playlist.create")}
                            title={td("sidebar.playlist.create")}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleCreatePlaylistClick();
                            }}
                          >
                            <IconPlus />
                          </button>
                        </Show>
                        <Show when={section.collapsible}>
                          <button
                            type="button"
                            class={`sidebar-section-toggle${sectionCollapsed() ? " is-collapsed" : ""}`}
                            onClick={() => toggleSection(section.key)}
                            aria-label={sectionCollapsed() ? "Expand" : "Collapse"}
                          >
                            <IconChevronDown />
                          </button>
                        </Show>
                      </div>
                    </div>
                  </Show>

                  <Show when={section.items.length > 0}>
                    <div class={`sidebar-section-body${sectionCollapsed() ? " is-collapsed" : ""}`}>
                      <div class="sidebar-section-body-inner">
                        <Show when={collapsed() || (section.key !== "created" && section.key !== "collected")}>
                          <ul class="sidebar-nav">
                            <For each={section.items}>
                              {(item) => {
                                const Icon = item.icon;
                                const isActive = () => item.key === props.activePage;
                                const label = () => td(item.labelKey);
                                const badgeCount = () =>
                                  item.key === "download" ? 0 : 0;
                                const showFmRefresh = () =>
                                  item.key === "personal-fm" && !collapsed() && props.isNcmLoggedIn;
                                const handleFmRefresh = (event: MouseEvent) => {
                                  event.stopPropagation();
                                  props.onRefreshPersonalFm?.();
                                };
                                const showHeartMode = () =>
                                  item.key === "liked-songs" && !collapsed() && props.isNcmLoggedIn;
                                const isHeartActive = () => props.shuffleMode === "heartbeat";
                                const handleHeartMode = (event: MouseEvent) => {
                                  event.stopPropagation();
                                  props.onStartHeartbeat?.();
                                };
                                return (
                                  <li>
                                    <button
                                      type="button"
                                      class={`sidebar-nav-item${isActive() ? " is-active" : ""}`}
                                      data-perf-route-key={item.key}
                                      onClick={() => handleNavItemClick(item.key)}
                                      aria-current={isActive() ? "page" : undefined}
                                      title={collapsed() ? label() : undefined}
                                    >
                                      <span class="sidebar-nav-icon" aria-hidden="true">
                                        <Icon />
                                      </span>
                                      <Show when={!collapsed()}>
                                        <span class="sidebar-nav-label">{label()}</span>
                                      </Show>
                                      <Show when={showFmRefresh()}>
                                        <span
                                          role="button"
                                          tabindex="0"
                                          class="sidebar-nav-action"
                                          aria-label={td("sidebar.nav.personalFm.refresh")}
                                          title={td("sidebar.nav.personalFm.refresh")}
                                          onClick={handleFmRefresh}
                                          onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                              event.preventDefault();
                                              handleFmRefresh(event as unknown as MouseEvent);
                                            }
                                          }}
                                        >
                                          <IconRefresh />
                                        </span>
                                      </Show>
                                      <Show when={showHeartMode()}>
                                        <span
                                          role="button"
                                          tabindex="0"
                                          class={`sidebar-nav-action sidebar-nav-action--heart${isHeartActive() ? " is-active" : ""}`}
                                          aria-label={td("sidebar.nav.likedSongs.heartMode")}
                                          aria-pressed={isHeartActive()}
                                          title={td("sidebar.nav.likedSongs.heartMode")}
                                          onClick={handleHeartMode}
                                          onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                              event.preventDefault();
                                              handleHeartMode(event as unknown as MouseEvent);
                                            }
                                          }}
                                        >
                                          <IconHeartBit />
                                        </span>
                                      </Show>
                                      <Show when={badgeCount() > 0}>
                                        <span class="sidebar-nav-badge" aria-label={String(badgeCount())}>
                                          {badgeCount()}
                                        </span>
                                      </Show>
                                    </button>
                                  </li>
                                );
                              }}
                            </For>
                          </ul>
                        </Show>

                        <Show when={!collapsed() && (section.key === "created" || section.key === "collected")}>
                          <Show
                            when={
                              playlistItemsForSection(section.key).length > 0 &&
                              (section.key !== "created" || showOnlineCreatedPlaylists())
                            }
                          >
                            <ul class="sidebar-playlist-list">
                              <For each={playlistItemsForSection(section.key)}>
                                {(playlist) => {
                                  const page =
                                    section.key === "created"
                                      ? ("created-playlists" as const)
                                      : ("collected-playlists" as const);
                                  const isActive = () =>
                                    props.activePage === page &&
                                    (props.selectedPlaylistId ?? null) === playlist.id;

                                  return (
                                    <li>
                                      <button
                                        type="button"
                                        class={`sidebar-playlist-item${isActive() ? " is-active" : ""}${uiSettings.menuShowCover ? "" : " is-cover-hidden"}`}
                                        onClick={() => handlePlaylistSelect(page, playlist.id)}
                                        title={playlist.name}
                                      >
                                        <Show when={uiSettings.menuShowCover}>
                                          <div class="sidebar-playlist-cover" aria-hidden="true">
                                            <Show
                                              when={playlist.coverUrl}
                                              fallback={<span>{playlist.name.slice(0, 1)}</span>}
                                            >
                                              {(coverUrl) => <SImage src={coverUrl()} alt="" observeVisibility={true} shape="rect" aspect="square" />}
                                            </Show>
                                          </div>
                                        </Show>
                                        <div class="sidebar-playlist-copy">
                                          <span class="sidebar-playlist-name">{playlist.name}</span>
                                        </div>
                                      </button>
                                    </li>
                                  );
                                }}
                              </For>
                            </ul>
                          </Show>
                          <Show when={section.key === "created" && !showOnlineCreatedPlaylists()}>
                            <Show when={localPlaylists().length > 0}>
                              <ul class="sidebar-playlist-list">
                                <For each={localPlaylists()}>
                                  {(playlist) => {
                                    const coverUrl = () => localPlaylistCover(playlist);
                                    const isActive = () =>
                                      props.activePage === "library" &&
                                      selectedLocalPlaylistId() === playlist.playlist_id;

                                    return (
                                      <li>
                                        <button
                                          type="button"
                                          class={`sidebar-playlist-item${isActive() ? " is-active" : ""}${uiSettings.menuShowCover ? "" : " is-cover-hidden"}`}
                                          onClick={() => handleLocalPlaylistSelect(playlist.playlist_id)}
                                          title={playlist.name}
                                        >
                                          <Show when={uiSettings.menuShowCover}>
                                            <div class="sidebar-playlist-cover" aria-hidden="true">
                                              <Show when={coverUrl()} fallback={<span>{playlist.name.slice(0, 1)}</span>}>
                                                {(url) => <SImage src={url()} alt="" observeVisibility={true} shape="rect" aspect="square" />}
                                              </Show>
                                            </div>
                                          </Show>
                                          <div class="sidebar-playlist-copy">
                                            <span class="sidebar-playlist-name">{playlist.name}</span>
                                          </div>
                                        </button>
                                      </li>
                                    );
                                  }}
                                </For>
                              </ul>
                            </Show>
                          </Show>
                        </Show>
                      </div>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </div>
      <button
        type="button"
        class="sidebar-rail-toggle"
        onClick={() => setCollapsedPersisted((current) => !current)}
        aria-label={toggleAria()}
        title={toggleAria()}
        disabled={forceCollapsedNarrow()}
      >
        {collapsedPersisted() ? <IconExpand /> : <IconCollapse />}
      </button>
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

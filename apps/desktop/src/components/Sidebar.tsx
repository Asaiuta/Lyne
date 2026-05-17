import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { Component, JSX } from "solid-js";
import type { ActivePage } from "../shared/ui/navigation";
import type { ApiClient } from "../shared/api/client";
import { useNcmAccount } from "../shared/state/NcmAccountContext";
import { useUISettings, type SidebarHiddenItemKey } from "../shared/state/useUISettings";
import { useTranslation } from "../shared/i18n";
import { CreatePlaylistModal } from "./CreatePlaylistModal";
import {
  type OnlinePlaylistSummary,
  type UserPlaylistMode
} from "../features/online/ncmPlaylistSummary";
import {
  IconChevronDown,
  IconCloud,
  IconCollapse,
  IconCompass,
  IconExpand,
  IconFolder,
  IconHeart,
  IconHistory,
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

const SIDEBAR_SETTING_KEY_BY_PAGE: Record<ActivePage, SidebarHiddenItemKey> = {
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
  isNcmLoggedIn: boolean;
  onRequireNcmLogin: () => void;
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
  const [createPlaylistOpen, setCreatePlaylistOpen] = createSignal<boolean>(false);

  const readErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : t("common.error.requestFailed");

  createEffect(() => {
    writeSidebarStorage(STORAGE_KEY, collapsedPersisted() ? "1" : "0");
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
    return Promise.all([
      props.api.listNcmUserPlaylists({
        uid: userId,
        limit: 100,
        mode: "created-playlists"
      }),
      props.api.listNcmUserPlaylists({
        uid: userId,
        limit: 100,
        mode: "collected-playlists"
      })
    ]);
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
    uiSettings.sidebarHiddenItems[SIDEBAR_SETTING_KEY_BY_PAGE[item.key]];
  const visibleSections = createMemo<ReadonlyArray<NavSection>>(() =>
    SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => !isItemHidden(item))
    })).filter((section) => section.items.length > 0)
  );
  const playlistItemsForSection = (sectionKey: string): OnlinePlaylistSummary[] =>
    sectionKey === "created" ? createdPlaylists() : sectionKey === "collected" ? collectedPlaylists() : [];
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
    props.onSelectPlaylist?.(page, playlistId);
  };
  const handleCreatePlaylistClick = () => {
    if (!props.isNcmLoggedIn) {
      props.onRequireNcmLogin();
      return;
    }
    setCreatePlaylistOpen(true);
  };
  const handlePlaylistCreated = async () => {
    const activeAccount = accountStore.activeAccount();
    if (!activeAccount) return;
    const [created, collected] = await loadUserPlaylists(activeAccount.userId);
    setCreatedPlaylists(created);
    setCollectedPlaylists(collected);
  };

  return (
    <nav class={className()} aria-label={t("sidebar.aria.primary")}>
      <button type="button" class="sidebar-brand" onClick={() => props.onChange("recommend")}>
        <span class="sidebar-brand-logo" aria-hidden="true">
          <IconLogo />
        </span>
        <Show when={!collapsed()}>
          <span class="sidebar-brand-product">{t("sidebar.brand.product")}</span>
        </Show>
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
                      <span class="sidebar-section-label">{sectionLabel()}</span>
                      <div class="sidebar-section-header-actions">
                        <Show when={section.key === "created"}>
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
                        <ul class="sidebar-nav">
                          <For each={section.items}>
                            {(item) => {
                              const Icon = item.icon;
                              const isActive = () => item.key === props.activePage;
                              const label = () => td(item.labelKey);
                              return (
                                <li>
                                  <button
                                    type="button"
                                    class={`sidebar-nav-item${isActive() ? " is-active" : ""}`}
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
                                  </button>
                                </li>
                              );
                            }}
                          </For>
                        </ul>

                        <Show when={!collapsed() && (section.key === "created" || section.key === "collected")}>
                          <Show when={playlistItemsForSection(section.key).length > 0}>
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
                                              {(coverUrl) => <img src={coverUrl()} alt="" />}
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
        open={createPlaylistOpen()}
        onClose={() => setCreatePlaylistOpen(false)}
        onCreated={handlePlaylistCreated}
      />
    </nav>
  );
}

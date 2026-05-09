import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { Component, JSX } from "solid-js";
import type { ActivePage } from "../shared/ui/navigation";
import { userPlaylist } from "../shared/api/ncm";
import { useNcmAccount } from "../shared/state/NcmAccountContext";
import { useTranslation } from "../shared/i18n";
import {
  filterUserPlaylists,
  readUserPlaylists,
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
  IconQueue,
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
      { key: "liked", icon: IconHeart, labelKey: "sidebar.nav.liked.label" },
      { key: "cloud", icon: IconCloud, labelKey: "sidebar.nav.cloud.label" },
      { key: "download", icon: IconQueueAdd, labelKey: "sidebar.nav.download.label" },
      { key: "streaming", icon: IconPlaylist, labelKey: "sidebar.nav.streaming.label" },
      { key: "library", icon: IconFolder, labelKey: "sidebar.nav.library.label" },
      { key: "recent", icon: IconHistory, labelKey: "sidebar.nav.recent.label" },
      { key: "queue", icon: IconQueue, labelKey: "sidebar.nav.queue.label" }
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
const NARROW_BREAKPOINT = 980;

const readPersistedCollapse = (): boolean => {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
};

const readPersistedCollapsedSections = (): Set<string> => {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(SECTIONS_STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // ignore malformed storage
  }
  return new Set();
};

const isNarrowViewport = (): boolean => {
  if (typeof window === "undefined") return false;
  return window.innerWidth < NARROW_BREAKPOINT;
};

interface SidebarProps {
  activePage: ActivePage;
  onChange: (page: ActivePage) => void;
  onRefresh: () => void;
  selectedPlaylistId?: number | null;
  onSelectPlaylist?: (page: UserPlaylistMode, playlistId: number) => void;
}

export function Sidebar(props: SidebarProps) {
  void props.onRefresh;
  const { t, td } = useTranslation();
  const accountStore = useNcmAccount();
  const [collapsedPersisted, setCollapsedPersisted] = createSignal(readPersistedCollapse());
  const [forceCollapsedNarrow, setForceCollapsedNarrow] = createSignal(isNarrowViewport());
  const [collapsedSections, setCollapsedSections] = createSignal(readPersistedCollapsedSections());
  const [createdPlaylists, setCreatedPlaylists] = createSignal<OnlinePlaylistSummary[]>([]);
  const [collectedPlaylists, setCollectedPlaylists] = createSignal<OnlinePlaylistSummary[]>([]);

  const readErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : t("common.error.requestFailed");

  createEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, collapsedPersisted() ? "1" : "0");
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify([...collapsedSections()]));
  });

  onMount(() => {
    if (typeof window === "undefined") return;
    const handler = () => setForceCollapsedNarrow(isNarrowViewport());
    window.addEventListener("resize", handler);
    onCleanup(() => window.removeEventListener("resize", handler));
  });

  createEffect(() => {
    const activeAccount = accountStore.activeAccount();
    if (!activeAccount) {
      setCreatedPlaylists([]);
      setCollectedPlaylists([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await userPlaylist({ uid: activeAccount.userId, limit: 100 });
        if (cancelled) return;
        const playlists = readUserPlaylists(response);
        setCreatedPlaylists(filterUserPlaylists(playlists, "created-playlists"));
        setCollectedPlaylists(filterUserPlaylists(playlists, "collected-playlists"));
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
  const ToggleIcon = () => (collapsedPersisted() ? IconExpand : IconCollapse);
  const playlistItemsForSection = (sectionKey: string): OnlinePlaylistSummary[] =>
    sectionKey === "created" ? createdPlaylists() : sectionKey === "collected" ? collectedPlaylists() : [];
  const handlePlaylistSelect = (page: UserPlaylistMode, playlistId: number) => {
    props.onSelectPlaylist?.(page, playlistId);
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
          <For each={SECTIONS}>
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
                                    onClick={() => props.onChange(item.key)}
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
                                        class={`sidebar-playlist-item${isActive() ? " is-active" : ""}`}
                                        onClick={() => handlePlaylistSelect(page, playlist.id)}
                                        title={playlist.name}
                                      >
                                        <div class="sidebar-playlist-cover" aria-hidden="true">
                                          <Show
                                            when={playlist.coverUrl}
                                            fallback={<span>{playlist.name.slice(0, 1)}</span>}
                                          >
                                            {(coverUrl) => <img src={coverUrl()} alt="" />}
                                          </Show>
                                        </div>
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
        {(() => {
          const Icon = ToggleIcon();
          return <Icon />;
        })()}
      </button>
    </nav>
  );
}

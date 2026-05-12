import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import type { Accessor, Component, JSX } from "solid-js";
import { AlbumCard } from "../../../components/AlbumCard";
import {
  IconAlbum,
  IconArtist,
  IconHeart,
  IconPlayCircle,
  IconPlaylist,
  IconVolumeHigh
} from "../../../components/icons";
import { SegmentedTabs } from "../../../components/page/SegmentedTabs";
import { createApiClient } from "../../../shared/api/client";
import { useTranslation, type TranslationKey } from "../../../shared/i18n";
import { userSubcount, type NcmUserSubcountData } from "../../../shared/api/ncm/user";
import { useUISettings } from "../../../shared/state/useUISettings";
import type { OnlinePlaylistSummary } from "../ncmPlaylistSummary";
import { PlaylistDetail } from "../details/PlaylistDetail";
import type { Feedback, NcmProfile } from "../shared/types";
import type { PlaybackController } from "../shared/playback";
import { useDetailNavigation } from "../shared/useDetailNavigation";

type CollectionTab = "playlists" | "albums" | "artists" | "videos" | "radios";
type PlaylistScope = "created" | "collected";

interface CollectionStat {
  key: CollectionTab;
  labelKey: TranslationKey;
  count: number;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
}

interface LikedCollectionModeProps {
  loginProfile: Accessor<NcmProfile | null>;
  isCheckingLogin: Accessor<boolean>;
  isLoginBusy: Accessor<boolean>;
  onBeginLogin: () => void;
  onLogout: () => void | Promise<void>;
  onSelectedPlaylistChange?: (playlistId: number | null) => void;
  setFeedback: (tone: Feedback["tone"], message: string) => void;
  playback: PlaybackController;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
}

const api = createApiClient();

const collectionTabs: Array<{ value: CollectionTab; labelKey: TranslationKey }> = [
  { value: "playlists", labelKey: "ncm.collection.tabs.playlists" },
  { value: "albums", labelKey: "ncm.collection.tabs.albums" },
  { value: "artists", labelKey: "ncm.collection.tabs.artists" },
  { value: "videos", labelKey: "ncm.collection.tabs.videos" },
  { value: "radios", labelKey: "ncm.collection.tabs.radios" }
];

const readSubcountData = (payload: unknown): NcmUserSubcountData => {
  if (typeof payload !== "object" || payload === null) return {};
  const record = payload as { data?: unknown };
  if (typeof record.data === "object" && record.data !== null) {
    return record.data as NcmUserSubcountData;
  }
  return payload as NcmUserSubcountData;
};

const positiveCount = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

export function LikedCollectionMode(props: LikedCollectionModeProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const [activeTab, setActiveTab] = createSignal<CollectionTab>("playlists");
  const [playlistScope, setPlaylistScope] = createSignal<PlaylistScope>("created");
  const [createdPlaylists, setCreatedPlaylists] = createSignal<OnlinePlaylistSummary[]>([]);
  const [collectedPlaylists, setCollectedPlaylists] = createSignal<OnlinePlaylistSummary[]>([]);
  const [subcount, setSubcount] = createSignal<NcmUserSubcountData>({});
  const [isLoadingPlaylists, setIsLoadingPlaylists] = createSignal(false);

  const detailNav = useDetailNavigation({
    t,
    loginProfile: props.loginProfile,
    playback: props.playback,
    setFeedback: props.setFeedback,
    onSelectedPlaylistChange: props.onSelectedPlaylistChange
  });

  const readErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : t("common.error.requestFailed");

  const visibleCreatedPlaylists = createMemo(() => createdPlaylists().slice(1));
  const currentPlaylists = createMemo(() =>
    playlistScope() === "created" ? visibleCreatedPlaylists() : collectedPlaylists()
  );

  const totalPlaylistCount = createMemo(() => {
    const fromSubcount =
      positiveCount(subcount().playlistCount) ||
      positiveCount(subcount().createdPlaylistCount) + positiveCount(subcount().subPlaylistCount);
    return fromSubcount || visibleCreatedPlaylists().length + collectedPlaylists().length;
  });

  const stats = createMemo<CollectionStat[]>(() => [
    {
      key: "playlists",
      labelKey: "ncm.collection.status.playlists",
      count: totalPlaylistCount(),
      icon: IconPlaylist
    },
    {
      key: "albums",
      labelKey: "ncm.collection.status.albums",
      count: positiveCount(subcount().albumCount),
      icon: IconAlbum
    },
    {
      key: "artists",
      labelKey: "ncm.collection.status.artists",
      count: positiveCount(subcount().artistCount),
      icon: IconArtist
    },
    {
      key: "videos",
      labelKey: "ncm.collection.status.videos",
      count: positiveCount(subcount().mvCount),
      icon: IconPlayCircle
    },
    {
      key: "radios",
      labelKey: "ncm.collection.status.radios",
      count: positiveCount(subcount().djRadioCount),
      icon: IconVolumeHigh
    }
  ]);

  const loginStatusText = () => {
    if (props.isCheckingLogin()) return t("ncm.login.status.checking");
    const profile = props.loginProfile();
    if (profile) return t("ncm.login.status.loggedIn", { name: profile.nickname ?? profile.userId });
    return t("ncm.login.status.loggedOut");
  };

  createEffect(on(props.loginProfile, (profile, prev) => {
    if (prev !== undefined && prev !== null && profile === null) {
      setCreatedPlaylists([]);
      setCollectedPlaylists([]);
      setSubcount({});
      detailNav.setSelectedPlaylist(null);
      detailNav.setPlaylistTracksState([]);
    }
  }, { defer: true }));

  createEffect(() => {
    const profile = props.loginProfile();
    if (profile === null) return;

    let cancelled = false;
    const run = async () => {
      setIsLoadingPlaylists(true);
      try {
        const [created, collected, countEnvelope] = await Promise.all([
          api.listNcmUserPlaylists({ uid: profile.userId, limit: 100, mode: "created-playlists" }),
          api.listNcmUserPlaylists({ uid: profile.userId, limit: 100, mode: "collected-playlists" }),
          userSubcount().catch(() => null)
        ]);
        if (cancelled) return;
        setCreatedPlaylists(created);
        setCollectedPlaylists(collected);
        setSubcount(countEnvelope === null ? {} : readSubcountData(countEnvelope));
      } catch (error) {
        if (!cancelled) {
          setCreatedPlaylists([]);
          setCollectedPlaylists([]);
          setSubcount({});
          props.setFeedback("error", readErrorMessage(error));
        }
      } finally {
        if (!cancelled) setIsLoadingPlaylists(false);
      }
    };

    void run();
    onCleanup(() => {
      cancelled = true;
    });
  });

  const handlePlaylistClick = (playlist: OnlinePlaylistSummary) => {
    props.onSelectedPlaylistChange?.(playlist.id);
    void detailNav.loadPlaylistTracks(playlist);
  };

  const unsupportedCount = () => stats().find((item) => item.key === activeTab())?.count ?? 0;
  const unsupportedName = () => collectionTabs.find((item) => item.value === activeTab())?.labelKey ?? "ncm.collection.tabs.playlists";

  return (
    <>
      <Show when={!detailNav.selectedPlaylist()}>
        <section class="liked-collection">
          <header class="liked-collection-head">
            <div class="liked-collection-title">
              <h1>{t("ncm.collection.title")}</h1>
              <div class="liked-collection-status" aria-label={loginStatusText()}>
                <For each={stats()}>
                  {(item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        type="button"
                        class={`liked-collection-status-item${activeTab() === item.key ? " is-active" : ""}`}
                        onClick={() => setActiveTab(item.key)}
                      >
                        <Icon />
                        <span>{t(item.labelKey, { count: item.count })}</span>
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>
            <Show
              when={props.loginProfile() === null}
              fallback={
                <button
                  type="button"
                  class="ghost-button page-action"
                  onClick={() => void props.onLogout()}
                  disabled={props.isLoginBusy()}
                >
                  {t("ncm.login.action.logout")}
                </button>
              }
            >
              <button
                type="button"
                class="primary-button page-action"
                onClick={props.onBeginLogin}
                disabled={props.isLoginBusy()}
              >
                <IconHeart />
                {t("ncm.login.action.qr")}
              </button>
            </Show>
          </header>

          <Show when={props.loginProfile() !== null} fallback={<div class="panel-note">{t("ncm.empty.loginRequired")}</div>}>
            <SegmentedTabs
              value={activeTab()}
              onChange={(next) => setActiveTab(next as CollectionTab)}
              items={collectionTabs.map((item) => ({ value: item.value, label: t(item.labelKey) }))}
              ariaLabel={t("ncm.collection.title")}
            />

            <Switch>
              <Match when={activeTab() === "playlists"}>
                <section class="liked-collection-playlists">
                  <div class="liked-collection-filter">
                    <For
                      each={[
                        { value: "created" as const, label: t("ncm.collection.playlistFilter.created") },
                        { value: "collected" as const, label: t("ncm.collection.playlistFilter.collected") }
                      ]}
                    >
                      {(item) => (
                        <button
                          type="button"
                          class={`liked-collection-chip${playlistScope() === item.value ? " is-active" : ""}`}
                          onClick={() => setPlaylistScope(item.value)}
                        >
                          {item.label}
                        </button>
                      )}
                    </For>
                  </div>
                  <Show
                    when={currentPlaylists().length > 0}
                    fallback={
                      <div class="panel-note">
                        {isLoadingPlaylists() ? t("ncm.playlist.loading") : t("ncm.empty.noUserPlaylists")}
                      </div>
                    }
                  >
                    <div class="album-grid">
                      <For each={currentPlaylists()}>
                        {(playlist) => (
                          <AlbumCard
                            title={playlist.name}
                            subtitle={t("ncm.playlist.meta", {
                              count: playlist.trackCount ?? 0,
                              creator: playlist.creator ?? t("ncm.playlist.creatorUnknown")
                            })}
                            coverUrl={playlist.coverUrl}
                            coverVisible={!uiSettings.hiddenCovers.playlist}
                            size="md"
                            active={detailNav.selectedPlaylist()?.id === playlist.id}
                            onClick={() => handlePlaylistClick(playlist)}
                          />
                        )}
                      </For>
                    </div>
                  </Show>
                </section>
              </Match>
              <Match when={activeTab() !== "playlists"}>
                <div class="liked-collection-unavailable">
                  <h2>{t("ncm.collection.unsupported.title", { name: t(unsupportedName()) })}</h2>
                  <p>{t("ncm.collection.unsupported.body", { count: unsupportedCount() })}</p>
                </div>
              </Match>
            </Switch>
          </Show>
        </section>
      </Show>

      <Show when={detailNav.selectedPlaylist()}>
        <PlaylistDetail
          playlist={detailNav.selectedPlaylist()}
          tracks={detailNav.filteredPlaylistTracks()}
          trackCount={detailNav.playlistTrackCount()}
          metaText={detailNav.playlistMetaText()}
          subtitleText={t("ncm.collection.title")}
          isLoadingTracks={detailNav.isLoadingPlaylistTracks()}
          isScrolled={detailNav.isPlaylistDetailScrolled()}
          filter={detailNav.playlistFilter()}
          detailTab={detailNav.playlistDetailTab()}
          setFilter={detailNav.setPlaylistFilter}
          setDetailTab={detailNav.setPlaylistDetailTab}
          onBack={detailNav.handleBackToPlaylists}
          onPlayAll={detailNav.playAllPlaylistTracks}
          onScroll={detailNav.handlePlaylistTrackScroll}
          playback={props.playback}
          currentTrackPath={props.currentTrackPath}
          currentSongId={props.currentSongId}
          isPlaying={props.isPlaying}
        />
      </Show>
    </>
  );
}

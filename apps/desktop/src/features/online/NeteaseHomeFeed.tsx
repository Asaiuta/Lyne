import { For, Show, createMemo, createResource } from "solid-js";
import { AlbumCard } from "../../components/AlbumCard";
import { DailySongsCard, type DailySongsCardCover } from "../../components/DailySongsCard";
import { HorizontalCardRow } from "../../components/HorizontalCardRow";
import { IconAlbum, IconArtist, IconPause, IconPlay, IconPlaylist, IconSkipNext } from "../../components/icons";
import {
  albumNewest,
  personalFm,
  personalized,
  personalizedDjprogram,
  personalizedMv,
  playlistDetail,
  recommendResource,
  recommendSongs,
  songDetail,
  topArtists,
  userLikelist
} from "../../shared/api/ncm";
import { useTranslation } from "../../shared/i18n";
import { cacheFetch } from "../../shared/state/cacheFetch";
import { useUISettings, type HomeSectionKey } from "../../shared/state/useUISettings";
import type { OnlinePlaylistSummary } from "./ncmPlaylistSummary";

interface FeedCardItem {
  id: number;
  title: string;
  subtitle: string | null;
  coverUrl: string | null;
  playCount: number | null;
  description: string | null;
}

interface PersonalFmPreview {
  title: string;
  artist: string | null;
  album: string | null;
  coverUrl: string | null;
}

type DiscoverTab = "playlists" | "toplists" | "artists" | "new";

interface NeteaseHomeFeedProps {
  isLoggedIn: boolean;
  userId: number | null;
  onSelectPlaylist: (playlist: OnlinePlaylistSummary) => void;
  onSelectDailySongs?: () => void;
  onSelectLikedSongs?: () => void;
  onPlayPersonalFm?: () => void;
  onSelectAlbum?: (album: FeedCardItem) => void;
  onSelectArtist?: (artist: FeedCardItem) => void;
  onNavigateToDiscover?: (tab: DiscoverTab) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? value : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readArtistNames = (value: unknown): string | null => {
  const names = asArray(value)
    .map((item) => readString(asRecord(item)?.name))
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(", ") : null;
};

const readPersonalizedPlaylists = (payload: unknown): FeedCardItem[] =>
  asArray(asRecord(payload)?.result)
    .map((value): FeedCardItem | null => {
      const item = asRecord(value);
      if (!item) return null;
      const id = readNumber(item.id);
      const name = readString(item.name);
      if (id === null || name === null) return null;
      const creator = readString(asRecord(item.creator)?.nickname);
      const copywriter = readString(item.copywriter);
      return {
        id,
        title: name,
        subtitle: creator ?? copywriter,
        coverUrl: readString(item.picUrl),
        playCount: readNumber(item.playCount),
        description: readString(item.copywriter) ?? readString(item.description)
      };
    })
    .filter((value): value is FeedCardItem => value !== null);

const readRecommendResource = (payload: unknown): FeedCardItem[] =>
  asArray(asRecord(payload)?.recommend)
    .map((value): FeedCardItem | null => {
      const item = asRecord(value);
      if (!item) return null;
      const id = readNumber(item.id);
      const name = readString(item.name);
      if (id === null || name === null) return null;
      return {
        id,
        title: name,
        subtitle: readString(asRecord(item.creator)?.nickname),
        coverUrl: readString(item.picUrl),
        playCount: readNumber(item.playcount) ?? readNumber(item.playCount),
        description: readString(item.copywriter) ?? readString(item.description)
      };
    })
    .filter((value): value is FeedCardItem => value !== null);

const readNewestAlbums = (payload: unknown): FeedCardItem[] =>
  asArray(asRecord(payload)?.albums)
    .map((value): FeedCardItem | null => {
      const item = asRecord(value);
      if (!item) return null;
      const id = readNumber(item.id);
      const name = readString(item.name);
      if (id === null || name === null) return null;
      const artistName =
        readString(asRecord(item.artist)?.name) ?? readArtistNames(item.artists);
      return {
        id,
        title: name,
        subtitle: artistName,
        coverUrl: readString(item.picUrl),
        playCount: null,
        description: readString(item.description)
      };
    })
    .filter((value): value is FeedCardItem => value !== null);

const readTopArtists = (payload: unknown): FeedCardItem[] =>
  asArray(asRecord(payload)?.artists)
    .map((value): FeedCardItem | null => {
      const item = asRecord(value);
      if (!item) return null;
      const id = readNumber(item.id);
      const name = readString(item.name);
      if (id === null || name === null) return null;
      return {
        id,
        title: name,
        subtitle: null,
        coverUrl: readString(item.picUrl) ?? readString(item.img1v1Url),
        playCount: null,
        description: null
      };
    })
    .filter((value): value is FeedCardItem => value !== null);

const readPersonalizedMvs = (payload: unknown): FeedCardItem[] =>
  asArray(asRecord(payload)?.result)
    .map((value): FeedCardItem | null => {
      const item = asRecord(value);
      if (!item) return null;
      const id = readNumber(item.id);
      const name = readString(item.name);
      if (id === null || name === null) return null;
      const artist = readString(item.artistName) ?? readArtistNames(item.artists);
      return {
        id,
        title: name,
        subtitle: artist,
        coverUrl: readString(item.picUrl) ?? readString(item.cover),
        playCount: readNumber(item.playCount),
        description: readString(item.copywriter) ?? readString(item.description)
      };
    })
    .filter((value): value is FeedCardItem => value !== null);

const readPersonalizedDjs = (payload: unknown): FeedCardItem[] =>
  asArray(asRecord(payload)?.result)
    .map((value): FeedCardItem | null => {
      const item = asRecord(value);
      if (!item) return null;
      const id = readNumber(item.id);
      const name = readString(item.name);
      if (id === null || name === null) return null;
      return {
        id,
        title: name,
        subtitle: readString(item.copywriter) ?? readString(item.description),
        coverUrl: readString(item.picUrl),
        playCount: readNumber(item.playCount),
        description: readString(item.copywriter) ?? readString(item.description)
      };
    })
    .filter((value): value is FeedCardItem => value !== null);

const readDailySongsCovers = (payload: unknown): DailySongsCardCover[] => {
  const data = asRecord(asRecord(payload)?.data);
  return asArray(data?.dailySongs)
    .map((value): DailySongsCardCover | null => {
      const item = asRecord(value);
      if (!item) return null;
      const id = readNumber(item.id);
      if (id === null) return null;
      const cover =
        readString(asRecord(item.al)?.picUrl) ??
        readString(item.picUrl) ??
        readString(asRecord(item.album)?.picUrl);
      return { id, url: cover };
    })
    .filter((value): value is DailySongsCardCover => value !== null);
};

const readLikelistIds = (payload: unknown): number[] => {
  const data = asRecord(asRecord(payload)?.data) ?? asRecord(payload);
  return asArray(data?.ids)
    .map((value) => readNumber(value))
    .filter((id): id is number => id !== null);
};

const readSongDetailCovers = (payload: unknown): DailySongsCardCover[] =>
  asArray(asRecord(payload)?.songs)
    .map((value): DailySongsCardCover | null => {
      const item = asRecord(value);
      if (!item) return null;
      const id = readNumber(item.id);
      if (id === null) return null;
      const cover =
        readString(asRecord(item.al)?.picUrl) ??
        readString(item.picUrl) ??
        readString(asRecord(item.album)?.picUrl);
      return { id, url: cover };
    })
    .filter((value): value is DailySongsCardCover => value !== null);

const readPersonalFmCovers = (payload: unknown): DailySongsCardCover[] =>
  asArray(asRecord(payload)?.data)
    .map((value): DailySongsCardCover | null => {
      const item = asRecord(value);
      if (!item) return null;
      const id = readNumber(item.id);
      if (id === null) return null;
      const cover =
        readString(asRecord(item.album)?.picUrl) ??
        readString(asRecord(item.al)?.picUrl) ??
        readString(item.picUrl);
      return { id, url: cover };
    })
    .filter((value): value is DailySongsCardCover => value !== null);

const readPersonalFmPreview = (payload: unknown): PersonalFmPreview[] =>
  asArray(asRecord(payload)?.data)
    .slice(0, 1)
    .map((value): PersonalFmPreview | null => {
      const item = asRecord(value);
      if (!item) return null;
      const title = readString(item.name);
      if (title === null) return null;
      const albumRecord = asRecord(item.album) ?? asRecord(item.al);
      return {
        title,
        artist: readArtistNames(item.artists) ?? readArtistNames(item.ar),
        album: readString(albumRecord?.name),
        coverUrl: readString(albumRecord?.picUrl) ?? readString(item.picUrl)
      };
    })
    .filter((value): value is PersonalFmPreview => value !== null);

const RADAR_PLAYLIST_IDS = [
  3136952023, // 私人雷达
  8402996200, // 会员雷达
  5320167908, // 时光雷达
  5327906368, // 乐迷雷达
  5362359247, // 宝藏雷达
  5300458264, // 新歌雷达
  5341776086  // 神秘雷达
];

const readRadarPlaylist = (payload: unknown): FeedCardItem | null => {
  const playlist = asRecord(asRecord(payload)?.playlist);
  if (!playlist) return null;
  const id = readNumber(playlist.id);
  const name = readString(playlist.name);
  if (id === null || name === null) return null;
  return {
    id,
    title: name,
    subtitle: readString(asRecord(playlist.creator)?.nickname),
    coverUrl: readString(playlist.coverImgUrl),
    playCount: readNumber(playlist.playCount),
    description: readString(playlist.description)
  };
};

const RADAR_TTL = 30 * 60 * 1000;
const DEFAULT_TTL = 10 * 60 * 1000;

const safeFetch = async <T,>(
  load: () => Promise<unknown>,
  read: (raw: unknown) => T[],
  cacheKey?: string,
  ttl?: number
): Promise<T[]> => {
  try {
    const fetcher = async () => {
      const raw = await load();
      return read(raw);
    };
    return cacheKey ? cacheFetch(cacheKey, fetcher, ttl ?? DEFAULT_TTL) : fetcher();
  } catch (error) {
    console.warn("[NeteaseHomeFeed] section fetch failed", error);
    return [];
  }
};

export function NeteaseHomeFeed(props: NeteaseHomeFeedProps) {
  const { t } = useTranslation();

  const [dailyPicks] = createResource(
    () => props.isLoggedIn,
    (isLoggedIn) =>
      isLoggedIn
        ? safeFetch(() => recommendResource(), readRecommendResource, "ncm.home.dailyPicks")
        : Promise.resolve([] as FeedCardItem[])
  );

  const [dailySongsCovers] = createResource(
    () => props.isLoggedIn,
    (isLoggedIn) =>
      isLoggedIn
        ? safeFetch(() => recommendSongs(), readDailySongsCovers)
        : Promise.resolve([] as DailySongsCardCover[])
  );

  const dailySongsCoverPreview = createMemo<DailySongsCardCover[]>(() => {
    const all = dailySongsCovers() ?? [];
    return all.filter((cover) => cover.url !== null).slice(0, 3);
  });

  const [likedSongsCovers] = createResource(
    () => (props.isLoggedIn && props.userId !== null ? props.userId : null),
    async (uid) => {
      if (uid === null) return [] as DailySongsCardCover[];
      const ids = await safeFetch(() => userLikelist(uid), readLikelistIds);
      if (ids.length === 0) return [] as DailySongsCardCover[];
      return safeFetch(() => songDetail(ids.slice(0, 9)), readSongDetailCovers);
    }
  );

  const likedSongsCoverPreview = createMemo<DailySongsCardCover[]>(() => {
    const all = likedSongsCovers() ?? [];
    return all.filter((cover) => cover.url !== null).slice(0, 3);
  });

  const [personalFmCovers] = createResource(
    () => props.isLoggedIn,
    (isLoggedIn) =>
      isLoggedIn
        ? safeFetch(() => personalFm(), readPersonalFmCovers)
        : Promise.resolve([] as DailySongsCardCover[])
  );

  const personalFmCoverPreview = createMemo<DailySongsCardCover[]>(() => {
    const all = personalFmCovers() ?? [];
    return all.filter((cover) => cover.url !== null).slice(0, 3);
  });

  const [personalFmPreview] = createResource(
    () => props.isLoggedIn,
    (isLoggedIn) =>
      isLoggedIn
        ? safeFetch(() => personalFm(), readPersonalFmPreview).then((items) => items[0] ?? null)
        : Promise.resolve(null as PersonalFmPreview | null)
  );

  const [radarPlaylists] = createResource(() =>
    cacheFetch("ncm.home.radar", () =>
      Promise.allSettled(
        RADAR_PLAYLIST_IDS.map((id) => playlistDetail({ id }))
      ).then((results) => {
        const items: FeedCardItem[] = [];
        for (const r of results) {
          if (r.status === "fulfilled") {
            const item = readRadarPlaylist(r.value);
            if (item) items.push(item);
          }
        }
        return items;
      }),
      RADAR_TTL
    )
  );

  const [recommendedPlaylists] = createResource(() =>
    safeFetch(
      () => personalized({ limit: 21 }),
      (raw) =>
        readPersonalizedPlaylists(raw).filter(
          (item) => !item.title.includes("雷达")
        ),
      "ncm.home.playlists"
    )
  );
  const [newAlbums] = createResource(() =>
    safeFetch(() => albumNewest({ limit: 12 }), readNewestAlbums, "ncm.home.albums")
  );
  const [featuredArtists] = createResource(() =>
    safeFetch(() => topArtists({ limit: 10 }), readTopArtists, "ncm.home.artists")
  );
  const [recommendedMvs] = createResource(() =>
    safeFetch(() => personalizedMv(), readPersonalizedMvs, "ncm.home.mvs")
  );
  const [podcasts] = createResource(() =>
    safeFetch(() => personalizedDjprogram(), readPersonalizedDjs, "ncm.home.podcasts")
  );

  const handlePlaylist = (item: FeedCardItem) =>
    props.onSelectPlaylist({
      id: item.id,
      name: item.title,
      creator: item.subtitle,
      coverUrl: item.coverUrl,
      trackCount: null,
      subscribed: false
    });

  const personalFmTitle = createMemo(() => personalFmPreview()?.title ?? t("ncm.fm.preview.title"));
  const personalFmArtist = createMemo(() => personalFmPreview()?.artist ?? t("ncm.fm.preview.artist"));
  const personalFmAlbum = createMemo(() => personalFmPreview()?.album ?? t("ncm.fm.preview.album"));
  const personalFmCoverUrl = createMemo(() => personalFmPreview()?.coverUrl ?? personalFmCoverPreview()[0]?.url ?? null);

  const uiSettings = useUISettings();

  const visibleSections = createMemo<HomeSectionKey[]>(() => {
    const sections = uiSettings.homeSections;
    return [...sections]
      .filter((s) => s.visible)
      .sort((a, b) => a.order - b.order)
      .map((s) => s.key);
  });

  const renderSection = (key: HomeSectionKey) => {
    switch (key) {
      case "dailyPicks":
        return (
          <Show when={(dailyPicks() ?? []).length > 0}>
            <HorizontalCardRow title={t("ncm.home.section.dailyPicks")}>
              <For each={dailyPicks() ?? []}>
                {(item) => (
                  <AlbumCard
                    title={item.title}
                    subtitle={item.subtitle}
                    coverUrl={item.coverUrl}
                    playCount={item.playCount}
                    description={item.description}
                    onClick={() => handlePlaylist(item)}
                  />
                )}
              </For>
            </HorizontalCardRow>
          </Show>
        );
      case "playlists":
        return (
          <Show when={(recommendedPlaylists() ?? []).length > 0}>
            <HorizontalCardRow title={t(props.isLoggedIn ? "ncm.home.section.personalPlaylists" : "ncm.home.section.recommendedPlaylists")}>
              <For each={recommendedPlaylists() ?? []}>
                {(item) => (
                  <AlbumCard
                    title={item.title}
                    subtitle={item.subtitle}
                    coverUrl={item.coverUrl}
                    playCount={item.playCount}
                    description={item.description}
                    onClick={() => handlePlaylist(item)}
                  />
                )}
              </For>
            </HorizontalCardRow>
          </Show>
        );
      case "radar":
        return (
          <Show when={(radarPlaylists() ?? []).length > 0}>
            <HorizontalCardRow title={t("ncm.home.section.radar")}>
              <For each={radarPlaylists() ?? []}>
                {(item) => (
                  <AlbumCard
                    title={item.title}
                    subtitle={item.subtitle}
                    coverUrl={item.coverUrl}
                    playCount={item.playCount}
                    description={item.description}
                    onClick={() => handlePlaylist(item)}
                  />
                )}
              </For>
            </HorizontalCardRow>
          </Show>
        );
      case "artists":
        return (
          <Show when={(featuredArtists() ?? []).length > 0}>
            <HorizontalCardRow class="card-row-artists" title={t("ncm.home.section.topArtists")} onTitleClick={() => props.onNavigateToDiscover?.("artists")}>
              <For each={featuredArtists() ?? []}>
                {(item) => (
                  <AlbumCard
                    title={item.title}
                    coverUrl={item.coverUrl}
                    shape="round"
                    size="sm"
                    onClick={() => props.onSelectArtist?.(item)}
                  />
                )}
              </For>
            </HorizontalCardRow>
          </Show>
        );
      case "mvs":
        return (
          <Show when={(recommendedMvs() ?? []).length > 0}>
            <HorizontalCardRow title={t("ncm.home.section.recommendedMv")}>
              <For each={recommendedMvs() ?? []}>
                {(item) => (
                  <AlbumCard
                    title={item.title}
                    subtitle={item.subtitle}
                    coverUrl={item.coverUrl}
                    playCount={item.playCount}
                    description={item.description}
                    onClick={() => window.open(`https://music.163.com/#/mv?id=${item.id}`, "_blank")}
                  />
                )}
              </For>
            </HorizontalCardRow>
          </Show>
        );
      case "podcasts":
        return (
          <Show when={(podcasts() ?? []).length > 0}>
            <HorizontalCardRow title={t("ncm.home.section.podcasts")}>
              <For each={podcasts() ?? []}>
                {(item) => (
                  <AlbumCard
                    title={item.title}
                    subtitle={item.subtitle}
                    coverUrl={item.coverUrl}
                    playCount={item.playCount}
                    description={item.description}
                    onClick={() => window.open(`https://music.163.com/#/program?id=${item.id}`, "_blank")}
                  />
                )}
              </For>
            </HorizontalCardRow>
          </Show>
        );
      case "albums":
        return (
          <Show when={(newAlbums() ?? []).length > 0}>
            <HorizontalCardRow title={t("ncm.home.section.newAlbums")} onTitleClick={() => props.onNavigateToDiscover?.("new")}>
              <For each={newAlbums() ?? []}>
                {(item) => (
                  <AlbumCard
                    title={item.title}
                    subtitle={item.subtitle}
                    coverUrl={item.coverUrl}
                    description={item.description}
                    onClick={() => props.onSelectAlbum?.(item)}
                  />
                )}
              </For>
            </HorizontalCardRow>
          </Show>
        );
    }
  };

  return (
    <div class="ncm-home-feed">
      <Show when={props.isLoggedIn && (props.onSelectDailySongs || props.onSelectLikedSongs || props.onPlayPersonalFm)}>
        <div class="ncm-home-feed-main-rec">
          <div class="ncm-home-feed-main-rec-list">
            <Show when={props.onSelectDailySongs}>
              <DailySongsCard
                title={t("ncm.daily.title")}
                description={t("ncm.daily.description")}
                covers={dailySongsCoverPreview()}
                variant="daily"
                onClick={() => props.onSelectDailySongs?.()}
              />
            </Show>
            <Show when={props.onSelectLikedSongs}>
              <DailySongsCard
                title={t("ncm.liked.title")}
                description={t("ncm.liked.description")}
                covers={likedSongsCoverPreview()}
                variant="liked"
                onClick={() => props.onSelectLikedSongs?.()}
              />
            </Show>
          </div>
          <Show when={props.onPlayPersonalFm}>
            <button type="button" class="ncm-home-feed-fm-card" onClick={() => props.onPlayPersonalFm?.()}>
              <Show when={personalFmCoverUrl()}>
                {(coverUrl) => (
                  <>
                    <img class="ncm-home-feed-fm-card-blur" src={coverUrl()} alt="" loading="lazy" />
                    <img class="ncm-home-feed-fm-card-cover" src={coverUrl()} alt="" loading="lazy" />
                  </>
                )}
              </Show>
              <div class="ncm-home-feed-fm-card-copy">
                <strong class="ncm-home-feed-fm-card-title">{personalFmTitle()}</strong>
                <Show when={personalFmArtist()}>
                  {(artist) => (
                    <span class="ncm-home-feed-fm-card-meta">
                      <IconArtist />
                      {artist()}
                    </span>
                  )}
                </Show>
                <Show when={personalFmAlbum()}>
                  {(album) => (
                    <span class="ncm-home-feed-fm-card-meta">
                      <IconAlbum />
                      {album()}
                    </span>
                  )}
                </Show>
                <div class="ncm-home-feed-fm-card-controls" aria-hidden="true">
                  <span class="ncm-home-feed-fm-card-control ncm-home-feed-fm-card-control--primary">
                    <IconPause />
                  </span>
                  <span class="ncm-home-feed-fm-card-control">
                    <IconPlay />
                  </span>
                  <span class="ncm-home-feed-fm-card-control">
                    <IconSkipNext />
                  </span>
                </div>
                <span class="ncm-home-feed-fm-card-badge">
                  <IconPlaylist />
                  {t("ncm.fm.title")}
                </span>
              </div>
            </button>
          </Show>
        </div>
      </Show>

      <For each={visibleSections()}>
        {(key) => renderSection(key)}
      </For>
    </div>
  );
}

import { For, Show, createEffect, createMemo, createResource, createSignal, on, onCleanup, onMount } from "solid-js";
import { createApiClient } from "../../shared/api/client";
import { STORAGE_KEYS } from "../../shared/state/useUISettings";
import {
  album,
  albumNew,
  artists,
  artistList,
  personalFm,
  playlistCatlist,
  playlistTrackAll,
  recommendSongs,
  search,
  songDetail,
  songUrlV1,
  topPlaylist,
  topPlaylistHighquality,
  topSong,
  toplistDetail,
  userLikelist,
  userPlaylist
} from "../../shared/api/ncm";
import { useTranslation } from "../../shared/i18n";
import type { TranslationKey } from "../../shared/i18n";
import { AlbumCard } from "../../components/AlbumCard";
import {
  IconChevronLeft,
  IconDots,
  IconList,
  IconMusic,
  IconPlay,
  IconPlayCircle,
  IconSearch
} from "../../components/icons";
import { LoginModal } from "../../components/LoginModal";
import { MediaList, type MediaListItem } from "../../components/media/MediaList";
import { PageHeader } from "../../components/page/PageHeader";
import { SegmentedTabs } from "../../components/page/SegmentedTabs";
import { useNcmAccount } from "../../shared/state/NcmAccountContext";
import { useUISearch } from "../../shared/state/UISearchContext";
import {
  filterUserPlaylists,
  readSearchPlaylists,
  readUserPlaylists,
  type OnlinePlaylistSummary
} from "./ncmPlaylistSummary";
import { readSongDetailSupplement, type NcmTrackReference } from "./ncmPlayback";
import { NeteaseHomeFeed } from "./NeteaseHomeFeed";

const api = createApiClient();
const SEARCH_LIMIT = 30;
const PLAYLIST_TRACK_LIMIT = 200;
const LIKED_SONGS_DETAIL_LIMIT = 100;
const DISCOVER_PAGE_LIMIT = 50;

type NeteasePageMode = "recommend" | "discover" | "created-playlists" | "collected-playlists";
type SearchTab = "songs" | "playlists";
type DiscoverTab = "playlists" | "toplists" | "artists" | "new";
type DiscoverPlaylistKind = "normal" | "hq";
type DiscoverNewKind = "albums" | "songs";

interface DiscoverArtistInitial {
  key: number | string;
  label: TranslationKey | string;
}

interface DiscoverArtistArea {
  labelKey: TranslationKey;
  type: number;
  area: number;
}

interface DiscoverNewArea {
  labelKey: TranslationKey;
  albumArea: "ALL" | "ZH" | "EA" | "KR" | "JP";
  songType: 0 | 7 | 96 | 16 | 8;
}

const ARTIST_INITIALS: readonly DiscoverArtistInitial[] = [
  { key: -1, label: "ncm.discover.artists.hot" },
  ...Array.from({ length: 26 }, (_, index) => {
    const letter = String.fromCharCode(index + 65);
    return { key: letter, label: letter };
  }),
  { key: 0, label: "#" }
];

const ARTIST_AREAS: readonly DiscoverArtistArea[] = [
  { labelKey: "common.all", type: -1, area: -1 },
  { labelKey: "ncm.discover.artists.cn", type: -1, area: 7 },
  { labelKey: "ncm.discover.artists.cnMale", type: 1, area: 7 },
  { labelKey: "ncm.discover.artists.cnFemale", type: 2, area: 7 },
  { labelKey: "ncm.discover.artists.cnGroup", type: 3, area: 7 },
  { labelKey: "ncm.discover.artists.western", type: -1, area: 96 },
  { labelKey: "ncm.discover.artists.westernMale", type: 1, area: 96 },
  { labelKey: "ncm.discover.artists.westernFemale", type: 2, area: 96 },
  { labelKey: "ncm.discover.artists.westernGroup", type: 3, area: 96 },
  { labelKey: "ncm.discover.artists.jp", type: -1, area: 8 },
  { labelKey: "ncm.discover.artists.jpMale", type: 1, area: 8 },
  { labelKey: "ncm.discover.artists.jpFemale", type: 2, area: 8 },
  { labelKey: "ncm.discover.artists.jpGroup", type: 3, area: 8 },
  { labelKey: "ncm.discover.artists.kr", type: -1, area: 16 },
  { labelKey: "ncm.discover.artists.krMale", type: 1, area: 16 },
  { labelKey: "ncm.discover.artists.krFemale", type: 2, area: 16 },
  { labelKey: "ncm.discover.artists.krGroup", type: 3, area: 16 },
  { labelKey: "ncm.discover.artists.other", type: -1, area: 0 }
];

const NEW_AREAS: readonly DiscoverNewArea[] = [
  { labelKey: "common.all", albumArea: "ALL", songType: 0 },
  { labelKey: "ncm.discover.artists.cn", albumArea: "ZH", songType: 7 },
  { labelKey: "ncm.discover.artists.western", albumArea: "EA", songType: 96 },
  { labelKey: "ncm.discover.artists.kr", albumArea: "KR", songType: 16 },
  { labelKey: "ncm.discover.artists.jp", albumArea: "JP", songType: 8 }
];

interface NcmProfile {
  userId: number;
  nickname: string | null;
}

interface Feedback {
  tone: "neutral" | "success" | "error";
  message: string;
}

interface OnlineTrackItem extends MediaListItem {
  songId: number;
}

interface DiscoverCardItem {
  id: number;
  title: string;
  subtitle: string | null;
  coverUrl: string | null;
}

interface DiscoverToplistTrack {
  title: string;
  artist: string | null;
}

interface DiscoverToplistItem extends DiscoverCardItem {
  description: string | null;
  tracks: DiscoverToplistTrack[];
  isOfficial: boolean;
}

interface FeedCardItem {
  id: number;
  title: string;
  subtitle: string | null;
  coverUrl: string | null;
  playCount: number | null;
  description: string | null;
}

interface NeteasePageProps {
  mode: NeteasePageMode;
  onStateRefresh: () => Promise<void>;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
  onRegisterPlayback: (track: NcmTrackReference) => void;
  selectedPlaylistId?: number | null;
  onSelectedPlaylistChange?: (playlistId: number | null) => void;
  onNavigate?: (page: "recommend" | "discover") => void;
  onNavigateToDiscover?: (tab: string) => void;
  discoverTabRequest?: { tab: string; version: number };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? value : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const readString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const isTranslationKey = (value: string): value is TranslationKey => value.startsWith("ncm.") || value.startsWith("common.");

const readArtists = (value: unknown): string | null => {
  const names = asArray(value)
    .map((item) => readString(asRecord(item)?.name))
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(", ") : null;
};

const adaptTrack = (value: unknown): OnlineTrackItem | null => {
  const item = asRecord(value);
  if (!item) return null;
  const songId = readNumber(item.id);
  const title = readString(item.name);
  if (songId === null || title === null) return null;
  const durationMs = readNumber(item.dt);
  const album = readString(asRecord(item.al)?.name) ?? readString(item.album);
  const artist =
    readArtists(item.ar) ??
    readArtists(item.artists) ??
    readString(asRecord(item.artist)?.name);
  return {
    id: `ncm-song-${songId}`,
    songId,
    source_path: `https://music.163.com/#/song?id=${songId}`,
    title,
    artist,
    album,
    duration_secs: durationMs === null ? null : durationMs / 1000,
    artworkUrl: readString(asRecord(item.al)?.picUrl) ?? readString(item.picUrl)
  };
};

const readSearchTracks = (payload: unknown): OnlineTrackItem[] => {
  const result = asRecord(asRecord(payload)?.result);
  return asArray(result?.songs).map(adaptTrack).filter((item): item is OnlineTrackItem => item !== null);
};

const readPlaylistTracks = (payload: unknown): OnlineTrackItem[] => {
  const root = asRecord(payload);
  const songs = asArray(root?.songs);
  if (songs.length > 0) return songs.map(adaptTrack).filter((item): item is OnlineTrackItem => item !== null);
  const playlist = asRecord(root?.playlist);
  return asArray(playlist?.tracks).map(adaptTrack).filter((item): item is OnlineTrackItem => item !== null);
};

const readDailySongs = (payload: unknown): OnlineTrackItem[] => {
  const data = asRecord(asRecord(payload)?.data);
  return asArray(data?.dailySongs)
    .map(adaptTrack)
    .filter((item): item is OnlineTrackItem => item !== null);
};

const readLikelistIds = (payload: unknown): number[] => {
  const data = asRecord(asRecord(payload)?.data) ?? asRecord(payload);
  return asArray(data?.ids)
    .map((value) => readNumber(value))
    .filter((id): id is number => id !== null);
};

const readSongDetailTracks = (payload: unknown): OnlineTrackItem[] =>
  asArray(asRecord(payload)?.songs)
    .map(adaptTrack)
    .filter((item): item is OnlineTrackItem => item !== null);

const readPersonalFmTracks = (payload: unknown): OnlineTrackItem[] =>
  asArray(asRecord(payload)?.data)
    .map((value) => {
      const item = asRecord(value);
      if (!item) return null;
      const rebuilt: Record<string, unknown> = { ...item };
      const album = asRecord(item.album);
      if (album && rebuilt.al === undefined) {
        rebuilt.al = album;
      }
      const artists = asArray(item.artists);
      if (artists.length > 0 && rebuilt.ar === undefined) {
        rebuilt.ar = artists;
      }
      const duration = readNumber(item.duration);
      if (duration !== null && rebuilt.dt === undefined) {
        rebuilt.dt = duration;
      }
      return adaptTrack(rebuilt);
    })
    .filter((item): item is OnlineTrackItem => item !== null);

const readAlbumTracks = (payload: unknown): OnlineTrackItem[] => {
  const root = asRecord(payload);
  return asArray(root?.songs)
    .map(adaptTrack)
    .filter((item): item is OnlineTrackItem => item !== null);
};

const readArtistTracks = (payload: unknown): OnlineTrackItem[] => {
  const root = asRecord(payload);
  return asArray(root?.hotSongs)
    .map(adaptTrack)
    .filter((item): item is OnlineTrackItem => item !== null);
};

const readDiscoverPlaylists = (payload: unknown): DiscoverCardItem[] =>
  asArray(asRecord(payload)?.playlists ?? asRecord(payload)?.result)
    .map((value): DiscoverCardItem | null => {
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
        coverUrl: readString(item.coverImgUrl) ?? readString(item.picUrl)
      };
    })
    .filter((item): item is DiscoverCardItem => item !== null);

const readDiscoverArtists = (payload: unknown): DiscoverCardItem[] =>
  asArray(asRecord(payload)?.artists)
    .map((value): DiscoverCardItem | null => {
      const item = asRecord(value);
      if (!item) return null;
      const id = readNumber(item.id);
      const name = readString(item.name);
      if (id === null || name === null) return null;
      return {
        id,
        title: name,
        subtitle: null,
        coverUrl: readString(item.picUrl) ?? readString(item.img1v1Url)
      };
    })
    .filter((item): item is DiscoverCardItem => item !== null);

const readToplistTrack = (value: unknown): DiscoverToplistTrack | null => {
  const item = asRecord(value);
  if (!item) return null;
  const title = readString(item.first) ?? readString(item.name);
  if (title === null) return null;
  return {
    title,
    artist: readString(item.second) ?? readArtists(item.ar) ?? readArtists(item.artists)
  };
};

const readDiscoverToplists = (payload: unknown): DiscoverToplistItem[] =>
  asArray(asRecord(payload)?.list)
    .map((value): DiscoverToplistItem | null => {
      const item = asRecord(value);
      if (!item) return null;
      const id = readNumber(item.id);
      const name = readString(item.name);
      if (id === null || name === null) return null;
      return {
        id,
        title: name,
        subtitle: readString(item.updateTip),
        description: readString(item.description),
        coverUrl: readString(item.coverImgUrl) ?? readString(item.picUrl),
        tracks: asArray(item.tracks).map(readToplistTrack).filter((track): track is DiscoverToplistTrack => track !== null),
        isOfficial: readString(item.ToplistType) !== null
      };
    })
    .filter((item): item is DiscoverToplistItem => item !== null);

const readDiscoverAlbums = (payload: unknown): DiscoverCardItem[] =>
  asArray(asRecord(payload)?.albums)
    .map((value): DiscoverCardItem | null => {
      const item = asRecord(value);
      if (!item) return null;
      const id = readNumber(item.id);
      const name = readString(item.name);
      if (id === null || name === null) return null;
      const artistName =
        readString(asRecord(item.artist)?.name) ??
        readArtists(item.artists) ??
        readArtists(item.ar);
      return {
        id,
        title: name,
        subtitle: artistName,
        coverUrl: readString(item.picUrl)
      };
    })
    .filter((item): item is DiscoverCardItem => item !== null);

const readPersonalizedSongs = (payload: unknown): OnlineTrackItem[] =>
  asArray(asRecord(payload)?.data ?? asRecord(payload)?.result)
    .map((value) => {
      const item = asRecord(value);
      if (!item) return null;
      const song = asRecord(item.song) ?? item;
      const rebuilt: Record<string, unknown> = { ...song };
      if (rebuilt.id === undefined) {
        rebuilt.id = readNumber(item.id);
      }
      if (rebuilt.name === undefined) {
        rebuilt.name = readString(item.name);
      }
      if (rebuilt.picUrl === undefined) {
        rebuilt.picUrl = readString(item.picUrl);
      }
      const album = asRecord(song.al) ?? asRecord(song.album);
      if (album && rebuilt.al === undefined) {
        rebuilt.al = album;
      }
      const artists = asArray(song.ar).length > 0 ? asArray(song.ar) : asArray(song.artists);
      if (artists.length > 0 && rebuilt.ar === undefined) {
        rebuilt.ar = artists;
      }
      const duration = readNumber(song.dt) ?? readNumber(song.duration);
      if (duration !== null && rebuilt.dt === undefined) {
        rebuilt.dt = duration;
      }
      return adaptTrack(rebuilt);
    })
    .filter((item): item is OnlineTrackItem => item !== null);

const readSongUrl = (payload: unknown): string | null => {
  const root = asRecord(payload);
  const first = asRecord(asArray(root?.data)[0]);
  return readString(first?.url);
};

const safeDiscoverFetch = async <T,>(
  load: () => Promise<unknown>,
  read: (raw: unknown) => T[]
): Promise<T[]> => {
  try {
    const raw = await load();
    return read(raw);
  } catch (error) {
    console.warn("[NeteasePage] discover fetch failed", error);
    return [];
  }
};

export function NeteasePage(props: NeteasePageProps) {
  const { t } = useTranslation();
  const accountStore = useNcmAccount();
  const {
    query: globalQuery,
    submitNonce
  } = useUISearch();
  const [isCheckingLogin, setIsCheckingLogin] = createSignal(false);
  const [isLoginBusy, setIsLoginBusy] = createSignal(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = createSignal(false);
  const [feedback, setFeedback] = createSignal<Feedback>({ tone: "neutral", message: t("ncm.feedback.initial") });
  const [searchTab, setSearchTab] = createSignal<SearchTab>("songs");
  const [discoverTab, setDiscoverTab] = createSignal<DiscoverTab>("playlists");
  const [isSearching, setIsSearching] = createSignal(false);
  const [songResults, setSongResults] = createSignal<OnlineTrackItem[]>([]);
  const [playlistResults, setPlaylistResults] = createSignal<OnlinePlaylistSummary[]>([]);
  const [userPlaylistsState, setUserPlaylistsState] = createSignal<OnlinePlaylistSummary[]>([]);
  const [isLoadingUserPlaylists, setIsLoadingUserPlaylists] = createSignal(false);
  const [selectedPlaylist, setSelectedPlaylist] = createSignal<OnlinePlaylistSummary | null>(null);
  const [playlistTracksState, setPlaylistTracksState] = createSignal<OnlineTrackItem[]>([]);
  const [isLoadingPlaylistTracks, setIsLoadingPlaylistTracks] = createSignal(false);
  const [playlistDetailTab, setPlaylistDetailTab] = createSignal<"songs" | "comments">("songs");
  const [playlistFilter, setPlaylistFilter] = createSignal<string>("");
  const [isPlaylistDetailScrolled, setIsPlaylistDetailScrolled] = createSignal(false);
  const [selectedDailySongs, setSelectedDailySongs] = createSignal(false);
  const [dailySongsState, setDailySongsState] = createSignal<OnlineTrackItem[]>([]);
  const [isLoadingDailySongs, setIsLoadingDailySongs] = createSignal(false);
  const [selectedLikedSongs, setSelectedLikedSongs] = createSignal(false);
  const [likedSongsState, setLikedSongsState] = createSignal<OnlineTrackItem[]>([]);
  const [likedSongsTotal, setLikedSongsTotal] = createSignal(0);
  const [isLoadingLikedSongs, setIsLoadingLikedSongs] = createSignal(false);
  const [isPlayingPersonalFm, setIsPlayingPersonalFm] = createSignal(false);
  const [selectedAlbum, setSelectedAlbum] = createSignal<FeedCardItem | null>(null);
  const [albumTracksState, setAlbumTracksState] = createSignal<OnlineTrackItem[]>([]);
  const [isLoadingAlbumTracks, setIsLoadingAlbumTracks] = createSignal(false);
  const [selectedArtist, setSelectedArtist] = createSignal<FeedCardItem | null>(null);
  const [artistTracksState, setArtistTracksState] = createSignal<OnlineTrackItem[]>([]);
  const [isLoadingArtistTracks, setIsLoadingArtistTracks] = createSignal(false);
  const [pendingDiscoverSearch, setPendingDiscoverSearch] = createSignal(false);
  const [discoverPlaylistKind, setDiscoverPlaylistKind] = createSignal<DiscoverPlaylistKind>("normal");
  const [discoverArtistInitial, setDiscoverArtistInitial] = createSignal<number | string>(-1);
  const [discoverArtistAreaIndex, setDiscoverArtistAreaIndex] = createSignal<number>(0);
  const [discoverNewKind, setDiscoverNewKind] = createSignal<DiscoverNewKind>("albums");
  const [discoverNewAreaIndex, setDiscoverNewAreaIndex] = createSignal<number>(0);

  // ── playlist category state ──
  const [catName, setCatName] = createSignal("全部歌单");
  const [catModalOpen, setCatModalOpen] = createSignal(false);
  interface CatEntry { name: string; category: number; hot: boolean }
  const [catTypes, setCatTypes] = createSignal<Record<number, string>>({});
  const [catEntries, setCatEntries] = createSignal<CatEntry[]>([]);
  const [hqCatNames, setHqCatNames] = createSignal<Set<string>>(new Set());

  // ── playlist load-more state ──
  const [playlistOffset, setPlaylistOffset] = createSignal(0);
  const [allPlaylists, setAllPlaylists] = createSignal<DiscoverCardItem[]>([]);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = createSignal(false);
  const [hasMorePlaylists, setHasMorePlaylists] = createSignal(true);

  // ── album load-more state ──
  const [albumOffset, setAlbumOffset] = createSignal(0);
  const [allAlbums, setAllAlbums] = createSignal<DiscoverCardItem[]>([]);
  const [isLoadingAlbums, setIsLoadingAlbums] = createSignal(false);
  const [hasMoreAlbums, setHasMoreAlbums] = createSignal(true);

  const loginProfile = createMemo<NcmProfile | null>(() => {
    const acct = accountStore.activeAccount();
    if (!acct) return null;
    return { userId: acct.userId, nickname: acct.nickname };
  });
  const isRecommendMode = () => props.mode === "recommend";
  const isDiscoverMode = () => props.mode === "discover";
  const isSearchMode = () => isRecommendMode() || isDiscoverMode();

  // ── playlist fetch ──
  const fetchPlaylists = async (reset = false) => {
    const offset = reset ? 0 : playlistOffset();
    setIsLoadingPlaylists(true);
    try {
      const kind = discoverPlaylistKind();
      const cat = catName();
      const raw = await safeDiscoverFetch(
        () =>
          kind === "hq"
            ? topPlaylistHighquality({ cat, limit: DISCOVER_PAGE_LIMIT, before: offset > 0 ? allPlaylists()[allPlaylists().length - 1]?.id : undefined })
            : topPlaylist({ cat, order: "hot", limit: DISCOVER_PAGE_LIMIT, offset }),
        readDiscoverPlaylists
      );
      if (reset) {
        setAllPlaylists(raw);
        setPlaylistOffset(0);
      } else {
        setAllPlaylists((prev) => [...prev, ...raw]);
      }
      setHasMorePlaylists(raw.length >= DISCOVER_PAGE_LIMIT);
    } catch {
      if (reset) setAllPlaylists([]);
    } finally {
      setIsLoadingPlaylists(false);
    }
  };

  // ── album fetch ──
  const fetchAlbums = async (reset = false) => {
    const offset = reset ? 0 : albumOffset();
    setIsLoadingAlbums(true);
    try {
      const area = selectedNewArea().albumArea;
      const raw = await safeDiscoverFetch(
        () => albumNew({ area, limit: DISCOVER_PAGE_LIMIT, offset }),
        readDiscoverAlbums
      );
      if (reset) {
        setAllAlbums(raw);
        setAlbumOffset(0);
      } else {
        setAllAlbums((prev) => [...prev, ...raw]);
      }
      setHasMoreAlbums(raw.length >= DISCOVER_PAGE_LIMIT);
    } catch {
      if (reset) setAllAlbums([]);
    } finally {
      setIsLoadingAlbums(false);
    }
  };

  // Reset playlists when catName or kind changes
  createEffect(on(
    () => [catName(), discoverPlaylistKind()] as const,
    () => { setPlaylistOffset(0); void fetchPlaylists(true); },
    { defer: true }
  ));

  // Reset albums when area changes
  createEffect(on(
    () => selectedNewArea().albumArea,
    () => { setAlbumOffset(0); void fetchAlbums(true); },
    { defer: true }
  ));
  const [discoverToplists] = createResource(() =>
    safeDiscoverFetch(() => toplistDetail(), readDiscoverToplists)
  );
  const selectedArtistArea = createMemo(() => ARTIST_AREAS[discoverArtistAreaIndex()] ?? ARTIST_AREAS[0]);
  const [discoverArtists] = createResource(
    () => ({
      initial: discoverArtistInitial(),
      type: selectedArtistArea().type,
      area: selectedArtistArea().area
    }),
    (query) =>
      safeDiscoverFetch(
        () =>
          artistList({
            type: query.type,
            area: query.area,
            initial: query.initial,
            limit: DISCOVER_PAGE_LIMIT,
            offset: 0
          }),
        readDiscoverArtists
      )
  );
  const selectedNewArea = createMemo(() => NEW_AREAS[discoverNewAreaIndex()] ?? NEW_AREAS[0]);
  const [discoverSongs] = createResource(
    () => selectedNewArea().songType,
    (type) => safeDiscoverFetch(() => topSong({ type }), readPersonalizedSongs)
  );

  const hasSearchResults = () => songResults().length > 0 || playlistResults().length > 0;
  const shouldShowDiscoverResults = () => isDiscoverMode() && (isSearching() || hasSearchResults());

  const readErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : t("common.error.requestFailed");

  const setRawFeedback = (tone: Feedback["tone"], message: string) => setFeedback({ tone, message });

  const pageTitle = () =>
    props.mode === "recommend"
      ? t("ncm.title.recommend")
      : props.mode === "discover"
        ? t("ncm.title.discover")
        : props.mode === "created-playlists"
          ? t("ncm.title.createdPlaylists")
          : t("ncm.title.collectedPlaylists");

  const pageSubtitle = () =>
    props.mode === "recommend" || props.mode === "discover"
      ? t("ncm.subtitle.search")
      : t("ncm.subtitle.playlists");

  const recommendGreeting = createMemo(() => {
    const hour = new Date().getHours();
    if (hour < 6) return t("ncm.home.greeting.lateNight");
    if (hour < 9) return t("ncm.home.greeting.earlyMorning");
    if (hour < 12) return t("ncm.home.greeting.morning");
    if (hour < 14) return t("ncm.home.greeting.noon");
    if (hour < 17) return t("ncm.home.greeting.afternoon");
    if (hour < 19) return t("ncm.home.greeting.dusk");
    if (hour < 22) return t("ncm.home.greeting.evening");
    return t("ncm.home.greeting.lateNight");
  });

  const refreshLoginStatus = async () => {
    setIsCheckingLogin(true);
    try {
      const profile = loginProfile();
      if (profile) {
        setRawFeedback(
          "success",
          t("ncm.feedback.loggedIn", { name: profile.nickname ?? profile.userId })
        );
      }
    } finally {
      setIsCheckingLogin(false);
    }
  };

  onMount(async () => {
    void refreshLoginStatus();
    try {
      const [catsRes, hqRes] = await Promise.all([playlistCatlist(), playlistCatlist(true)]);
      setCatTypes(asRecord(catsRes)?.categories as Record<number, string> ?? {});
      setCatEntries(
        asArray(asRecord(catsRes)?.sub).map((s: unknown) => {
          const item = asRecord(s);
          return { name: readString(item?.name) ?? "", category: readNumber(item?.category) ?? 0, hot: !!item?.hot };
        }).filter((e) => e.name !== "")
      );
      setHqCatNames(new Set(asArray(asRecord(hqRes)?.tags).map((t: unknown) => readString(asRecord(t)?.name)).filter((n): n is string => Boolean(n))));
    } catch {}
  });

  const beginLogin = () => {
    setIsLoginModalOpen(true);
  };

  const handleLogout = async () => {
    setIsLoginBusy(true);
    try {
      await accountStore.logoutActive();
      setUserPlaylistsState([]);
      setSelectedPlaylist(null);
      setPlaylistTracksState([]);
      setSelectedDailySongs(false);
      setDailySongsState([]);
      setSelectedLikedSongs(false);
      setLikedSongsState([]);
      setLikedSongsTotal(0);
      props.onSelectedPlaylistChange?.(null);
      setRawFeedback("success", t("ncm.feedback.loggedOut"));
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsLoginBusy(false);
    }
  };

  const registerAndResolveTrack = async (item: OnlineTrackItem): Promise<string> => {
    const songLevel = (() => {
      try { return localStorage.getItem(STORAGE_KEYS.ncmSongLevel) ?? "exhigh"; }
      catch { return "exhigh"; }
    })();
    const [songUrlResponse, detailResponse] = await Promise.all([
      songUrlV1({ id: item.songId, level: songLevel }),
      songDetail(item.songId)
    ]);
    const url = readSongUrl(songUrlResponse);
    if (!url) throw new Error(t("ncm.error.songUrlUnavailable"));
    const detail = readSongDetailSupplement(detailResponse, item.songId);
    props.onRegisterPlayback({
      songId: item.songId,
      streamUrl: url,
      sourcePageUrl: item.source_path,
      title: detail?.title ?? item.title,
      artist: detail?.artist ?? item.artist,
      album: detail?.album ?? item.album,
      coverUrl: detail?.coverUrl ?? null,
      durationSecs: item.duration_secs
    });
    return url;
  };

  const playOnlineTrack = async (item: OnlineTrackItem) => {
    try {
      const url = await registerAndResolveTrack(item);
      await api.load(url);
      await props.onStateRefresh();
      setRawFeedback("success", t("ncm.feedback.trackLoaded", { title: item.title ?? item.songId }));
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    }
  };

  const enqueueOnlineTrack = async (item: OnlineTrackItem) => {
    try {
      const url = await registerAndResolveTrack(item);
      await api.enqueueTrack(url);
      setRawFeedback("success", t("ncm.feedback.trackQueued", { title: item.title ?? item.songId }));
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    }
  };

  const loadPlaylistTracks = async (playlist: OnlinePlaylistSummary) => {
    setSelectedDailySongs(false);
    setSelectedLikedSongs(false);
    setSelectedAlbum(null);
    setAlbumTracksState([]);
    setSelectedArtist(null);
    setArtistTracksState([]);
    setSelectedPlaylist(playlist);
    setPlaylistDetailTab("songs");
    setPlaylistFilter("");
    setIsPlaylistDetailScrolled(false);
    props.onSelectedPlaylistChange?.(playlist.id);
    setIsLoadingPlaylistTracks(true);
    try {
      const response = await playlistTrackAll({ id: playlist.id, limit: PLAYLIST_TRACK_LIMIT });
      setPlaylistTracksState(readPlaylistTracks(response));
    } catch (error) {
      setPlaylistTracksState([]);
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsLoadingPlaylistTracks(false);
    }
  };

  const loadDailySongsList = async () => {
    setIsLoadingDailySongs(true);
    try {
      const response = await recommendSongs();
      setDailySongsState(readDailySongs(response));
    } catch (error) {
      setDailySongsState([]);
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsLoadingDailySongs(false);
    }
  };

  const clearAllDetailViews = () => {
    setSelectedPlaylist(null);
    setPlaylistTracksState([]);
    setSelectedDailySongs(false);
    setSelectedLikedSongs(false);
    setSelectedAlbum(null);
    setAlbumTracksState([]);
    setSelectedArtist(null);
    setArtistTracksState([]);
    props.onSelectedPlaylistChange?.(null);
  };

  const enterDailySongs = () => {
    clearAllDetailViews();
    setSelectedDailySongs(true);
    void loadDailySongsList();
  };

  const exitDailySongs = () => {
    setSelectedDailySongs(false);
  };

  const loadLikedSongsList = async () => {
    const profile = loginProfile();
    if (!profile) return;
    setIsLoadingLikedSongs(true);
    try {
      const idsResponse = await userLikelist(profile.userId);
      const ids = readLikelistIds(idsResponse);
      setLikedSongsTotal(ids.length);
      if (ids.length === 0) {
        setLikedSongsState([]);
        return;
      }
      const detailResponse = await songDetail(ids.slice(0, LIKED_SONGS_DETAIL_LIMIT));
      setLikedSongsState(readSongDetailTracks(detailResponse));
    } catch (error) {
      setLikedSongsState([]);
      setLikedSongsTotal(0);
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsLoadingLikedSongs(false);
    }
  };

  const enterLikedSongs = () => {
    clearAllDetailViews();
    setSelectedLikedSongs(true);
    void loadLikedSongsList();
  };

  const exitLikedSongs = () => {
    setSelectedLikedSongs(false);
  };

  const loadAlbumTracks = async (albumItem: FeedCardItem) => {
    clearAllDetailViews();
    setSelectedAlbum(albumItem);
    setIsLoadingAlbumTracks(true);
    try {
      const response = await album(albumItem.id);
      setAlbumTracksState(readAlbumTracks(response));
    } catch (error) {
      setAlbumTracksState([]);
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsLoadingAlbumTracks(false);
    }
  };

  const exitAlbum = () => {
    setSelectedAlbum(null);
    setAlbumTracksState([]);
  };

  const loadArtistTracks = async (artistItem: FeedCardItem) => {
    clearAllDetailViews();
    setSelectedArtist(artistItem);
    setIsLoadingArtistTracks(true);
    try {
      const response = await artists(artistItem.id);
      setArtistTracksState(readArtistTracks(response));
    } catch (error) {
      setArtistTracksState([]);
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsLoadingArtistTracks(false);
    }
  };

  const exitArtist = () => {
    setSelectedArtist(null);
    setArtistTracksState([]);
  };

  const handleNavigateToDiscover = (tab: string) => {
    clearAllDetailViews();
    props.onNavigateToDiscover?.(tab);
  };

  const playPersonalFmRadio = async () => {
    if (isPlayingPersonalFm()) return;
    setIsPlayingPersonalFm(true);
    try {
      const response = await personalFm();
      const tracks = readPersonalFmTracks(response);
      if (tracks.length === 0) {
        setRawFeedback("error", t("ncm.fm.feedback.empty"));
        return;
      }
      const [first, ...rest] = tracks;
      await playOnlineTrack(first);
      for (const track of rest) {
        await enqueueOnlineTrack(track);
      }
      setRawFeedback("success", t("ncm.fm.feedback.started", { count: tracks.length }));
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsPlayingPersonalFm(false);
    }
  };

  const runSearch = async () => {
    const query = globalQuery().trim();
    if (!query) {
      setRawFeedback("error", t("ncm.error.emptySearch"));
      return;
    }
    setIsSearching(true);
    setSelectedPlaylist(null);
    setPlaylistTracksState([]);
    setSelectedDailySongs(false);
    setSelectedLikedSongs(false);
    props.onSelectedPlaylistChange?.(null);
    try {
      const response = await search({
        keywords: query,
        type: searchTab() === "songs" ? 1 : 1000,
        limit: SEARCH_LIMIT
      });
      if (searchTab() === "songs") {
        setSongResults(readSearchTracks(response));
        setPlaylistResults([]);
      } else {
        const playlists = readSearchPlaylists(response);
        setPlaylistResults(playlists);
        setSongResults([]);
        if (playlists.length > 0) {
          void loadPlaylistTracks(playlists[0]);
        }
      }
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsSearching(false);
    }
  };

  createEffect(
    on(submitNonce, () => {
      if (!isSearchMode() || !globalQuery().trim()) {
        return;
      }

      if (isRecommendMode()) {
        setPendingDiscoverSearch(true);
        props.onNavigate?.("discover");
        return;
      }

      void runSearch();
    })
  );

  createEffect(
    on(
      () => props.mode,
      (mode) => {
        if (mode !== "discover") {
          return;
        }
        if (pendingDiscoverSearch() && globalQuery().trim()) {
          setPendingDiscoverSearch(false);
          void runSearch();
        }
      }
    )
  );

  createEffect(
    on(
      () => props.discoverTabRequest?.version,
      (version) => {
        if (version === undefined || version === 0) return;
        const tab = props.discoverTabRequest?.tab;
        if (tab && isDiscoverMode()) {
          setDiscoverTab(tab as DiscoverTab);
        }
      }
    )
  );

  createEffect(() => {
    const profile = loginProfile();
    const mode = props.mode;
    if ((mode !== "created-playlists" && mode !== "collected-playlists") || profile === null) return;
    let cancelled = false;
    const run = async () => {
      setIsLoadingUserPlaylists(true);
      try {
        const response = await userPlaylist({ uid: profile.userId, limit: 100 });
        if (cancelled) return;
        const allPlaylists = readUserPlaylists(response);
        setUserPlaylistsState(filterUserPlaylists(allPlaylists, mode));
      } catch (error) {
        if (!cancelled) {
          setUserPlaylistsState([]);
          setRawFeedback("error", readErrorMessage(error));
        }
      } finally {
        if (!cancelled) setIsLoadingUserPlaylists(false);
      }
    };
    void run();
    onCleanup(() => {
      cancelled = true;
    });
  });

  const loginStatusText = () => {
    if (isCheckingLogin()) return t("ncm.login.status.checking");
    const profile = loginProfile();
    if (profile) return t("ncm.login.status.loggedIn", { name: profile.nickname ?? profile.userId });
    return t("ncm.login.status.loggedOut");
  };

  const playlistCards = () =>
    props.mode === "created-playlists" || props.mode === "collected-playlists"
      ? userPlaylistsState()
      : playlistResults();

  const playlistEmptyText = () =>
    props.mode === "created-playlists" || props.mode === "collected-playlists"
      ? t("ncm.empty.noUserPlaylists")
      : t("ncm.empty.noPlaylists");

  const searchTabs = createMemo(() => [
    { value: "songs", label: t("ncm.tabs.songs") },
    { value: "playlists", label: t("ncm.tabs.playlists") }
  ]);
  const discoverTabs = createMemo(() => [
    { value: "playlists", label: t("ncm.discover.tab.playlists") },
    { value: "toplists", label: t("ncm.discover.tab.toplists") },
    { value: "artists", label: t("ncm.discover.tab.artists") },
    { value: "new", label: t("ncm.discover.tab.new") }
  ]);
  const discoverSectionTitle = createMemo(() => {
    const tab = discoverTab();
    switch (tab) {
      case "playlists":
        return t("ncm.discover.section.playlists");
      case "toplists":
        return t("ncm.discover.section.toplists");
      case "artists":
        return t("ncm.discover.section.artists");
      case "new":
        return t("ncm.discover.section.new");
      default: {
        const _exhaustive: never = tab;
        return _exhaustive;
      }
    }
  });
  const discoverSectionSubtitle = createMemo(() => {
    const tab = discoverTab();
    switch (tab) {
      case "playlists":
        return t("ncm.discover.subtitle.playlists");
      case "toplists":
        return t("ncm.discover.subtitle.toplists");
      case "artists":
        return t("ncm.discover.subtitle.artists");
      case "new":
        return t("ncm.discover.subtitle.new");
      default: {
        const _exhaustive: never = tab;
        return _exhaustive;
      }
    }
  });

  createEffect(() => {
    const playlistId = props.selectedPlaylistId ?? null;
    const isUserPlaylistMode =
      props.mode === "created-playlists" || props.mode === "collected-playlists";

    if (isUserPlaylistMode && playlistId === null) {
      setSelectedPlaylist(null);
      setPlaylistTracksState([]);
      return;
    }

    if (playlistId === null) {
      return;
    }

    const matchedPlaylist = playlistCards().find((item) => item.id === playlistId) ?? null;
    if (!matchedPlaylist) {
      return;
    }

    if (selectedPlaylist()?.id === playlistId && playlistTracksState().length > 0) {
      return;
    }

    void loadPlaylistTracks(matchedPlaylist);
  });

  createEffect(() => {
    const isUserPlaylistMode =
      props.mode === "created-playlists" || props.mode === "collected-playlists";
    if (!isUserPlaylistMode || isLoadingUserPlaylists()) {
      return;
    }

    const playlistId = props.selectedPlaylistId ?? null;
    if (playlistId !== null) {
      return;
    }

    if (selectedPlaylist() === null) {
      return;
    }

    setSelectedPlaylist(null);
    setPlaylistTracksState([]);
  });

  createEffect(() => {
    const isUserPlaylistMode =
      props.mode === "created-playlists" || props.mode === "collected-playlists";
    if (!isUserPlaylistMode || isLoadingUserPlaylists()) {
      return;
    }

    if ((props.selectedPlaylistId ?? null) !== null || selectedPlaylist() !== null) {
      return;
    }

    const firstPlaylist = playlistCards()[0] ?? null;
    if (!firstPlaylist) {
      return;
    }

    void loadPlaylistTracks(firstPlaylist);
  });

  const PlaylistGrid = () => (
    <section class="playlist-grid-section">
      <Show when={playlistCards().length > 0} fallback={<div class="panel-note">{playlistEmptyText()}</div>}>
        <div class="album-grid">
          <For each={playlistCards()}>
            {(playlist) => (
              <AlbumCard
                title={playlist.name}
                subtitle={t("ncm.playlist.meta", {
                  count: playlist.trackCount ?? 0,
                  creator: playlist.creator ?? t("ncm.playlist.creatorUnknown")
                })}
                coverUrl={playlist.coverUrl}
                size="md"
                active={selectedPlaylist()?.id === playlist.id}
                onClick={() => void loadPlaylistTracks(playlist)}
              />
            )}
          </For>
        </div>
      </Show>
    </section>
  );

  const handleBackToPlaylists = () => {
    setSelectedPlaylist(null);
    setPlaylistTracksState([]);
    setPlaylistDetailTab("songs");
    setPlaylistFilter("");
    setIsPlaylistDetailScrolled(false);
    props.onSelectedPlaylistChange?.(null);
  };

  const filteredPlaylistTracks = createMemo<OnlineTrackItem[]>(() => {
    const query = playlistFilter().trim().toLowerCase();
    if (!query) return playlistTracksState();
    return playlistTracksState().filter((item) =>
      [item.title, item.artist, item.album]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query))
    );
  });

  const playlistTrackCount = createMemo<number>(() =>
    selectedPlaylist()?.trackCount ?? playlistTracksState().length
  );

  const playlistMetaText = () => {
    const playlist = selectedPlaylist();
    return t("ncm.playlist.meta", {
      count: playlistTrackCount(),
      creator: playlist?.creator ?? t("ncm.playlist.creatorUnknown")
    });
  };

  const playAllPlaylistTracks = async () => {
    const [first, ...rest] = filteredPlaylistTracks();
    if (!first) return;
    await playOnlineTrack(first);
    for (const item of rest) {
      await enqueueOnlineTrack(item);
    }
  };

  const handlePlaylistTrackScroll = (event: Event) => {
    const target = event.currentTarget as HTMLElement;
    setIsPlaylistDetailScrolled(target.scrollTop > 10);
  };

  const PlaylistTracks = () => (
    <Show when={selectedPlaylist()}>
      {(playlist) => (
        <section class="playlist-detail">
          <div class={`playlist-detail-shell${isPlaylistDetailScrolled() ? " is-small" : ""}`}>
            <header class="playlist-detail-head">
              <div class="playlist-detail-art" aria-hidden="true">
                <Show when={playlist().coverUrl} fallback={<span>{playlist().name.slice(0, 1)}</span>}>
                  {(coverUrl) => (
                    <>
                      <img class="playlist-detail-art-img" src={coverUrl()} alt="" />
                      <img class="playlist-detail-art-shadow" src={coverUrl()} alt="" />
                    </>
                  )}
                </Show>
                <div class="playlist-detail-art-mask" />
              </div>
              <div class="playlist-detail-copy">
                <h2 title={playlist().name}>{playlist().name}</h2>
                <div class="playlist-detail-collapse">
                  <p class="playlist-detail-desc">{pageTitle()}</p>
                  <div class="playlist-detail-meta">
                    <span>
                      <IconMusic />
                      {playlistMetaText()}
                    </span>
                  </div>
                </div>
                <div class="playlist-detail-menu">
                  <div class="playlist-detail-menu-left">
                    <button
                      type="button"
                      class="primary-button playlist-detail-play"
                      onClick={() => void playAllPlaylistTracks()}
                      disabled={filteredPlaylistTracks().length === 0 || isLoadingPlaylistTracks()}
                    >
                      <IconPlay />
                      {isLoadingPlaylistTracks() ? t("ncm.playlist.loading") : t("ncm.playlist.play")}
                    </button>
                    <button
                      type="button"
                      class="ghost-button playlist-detail-back"
                      onClick={handleBackToPlaylists}
                    >
                      <IconChevronLeft />
                      {t("ncm.playlist.backToList")}
                    </button>
                    <button
                      type="button"
                      class="ghost-button playlist-detail-more"
                      aria-label={t("ncm.playlist.more")}
                      title={t("ncm.playlist.more")}
                    >
                      <IconList />
                    </button>
                  </div>
                  <div class="playlist-detail-menu-right">
                    <label class="playlist-detail-search">
                      <IconSearch />
                      <input
                        type="search"
                        value={playlistFilter()}
                        placeholder={t("ncm.playlist.search")}
                        onInput={(event) => setPlaylistFilter(event.currentTarget.value)}
                      />
                    </label>
                    <div class="playlist-detail-tabs" role="tablist" aria-label={t("ncm.playlist.tabs.aria")}>
                      <button
                        type="button"
                        class={playlistDetailTab() === "songs" ? "is-active" : ""}
                        role="tab"
                        aria-selected={playlistDetailTab() === "songs"}
                        onClick={() => setPlaylistDetailTab("songs")}
                      >
                        {t("ncm.playlist.tab.songs")}
                        <span>{playlistTrackCount()}</span>
                      </button>
                      <button
                        type="button"
                        class={playlistDetailTab() === "comments" ? "is-active" : ""}
                        role="tab"
                        aria-selected={playlistDetailTab() === "comments"}
                        onClick={() => setPlaylistDetailTab("comments")}
                      >
                        {t("ncm.playlist.tab.comments")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </header>
            <Show
              when={playlistDetailTab() === "songs"}
              fallback={
                <div class="playlist-detail-comments">
                  <IconDots />
                  <span>{t("ncm.playlist.commentsPlaceholder")}</span>
                </div>
              }
            >
              <MediaList
                items={filteredPlaylistTracks()}
                currentSourcePath={props.currentTrackPath}
                currentSongId={props.currentSongId}
                isPlayingNow={props.isPlaying}
                onPlay={(item) => void playOnlineTrack(item)}
                onEnqueue={(item) => void enqueueOnlineTrack(item)}
                onScroll={handlePlaylistTrackScroll}
                isLoading={isLoadingPlaylistTracks()}
                emptyState={<div class="panel-note">{t("ncm.empty.noTracks")}</div>}
              />
            </Show>
          </div>
        </section>
      )}
    </Show>
  );

  const PlaylistBrowserCard = (props: {
    playlist: OnlinePlaylistSummary;
    active: boolean;
    onSelect: () => void;
  }) => (
    <button
      type="button"
      class={`online-playlist-card${props.active ? " is-active" : ""}`}
      onClick={props.onSelect}
    >
      <div class="online-playlist-art" aria-hidden="true">
        <Show when={props.playlist.coverUrl} fallback={<span>{props.playlist.name.slice(0, 1)}</span>}>
          {(coverUrl) => <img src={coverUrl()} alt="" loading="lazy" />}
        </Show>
      </div>
      <div class="online-playlist-copy">
        <strong>{props.playlist.name}</strong>
        <span>
          {t("ncm.playlist.meta", {
            count: props.playlist.trackCount ?? 0,
            creator: props.playlist.creator ?? t("ncm.playlist.creatorUnknown")
          })}
        </span>
      </div>
    </button>
  );

  const SearchPlaylistLayout = () => (
    <section class="online-result-panel">
      <div class="online-result-panel-head">
        <div class="online-result-panel-copy">
          <strong>{t("ncm.results.playlists")}</strong>
          <span>{discoverSectionSubtitle()}</span>
        </div>
      </div>
      <Show
        when={playlistResults().length > 0}
        fallback={
          <div class="online-search-empty">
            <strong>
              {globalQuery().trim() ? t("ncm.empty.noPlaylists") : t("ncm.empty.searchPrompt")}
            </strong>
            <span>
              {globalQuery().trim()
                ? t("ncm.empty.searchPromptHint.discover")
                : t("ncm.empty.searchPromptHint.discover")}
            </span>
          </div>
        }
      >
        <div class="online-playlist-layout is-search-results">
          <aside class="online-playlist-browser">
            <div class="online-playlist-browser-head">
              <div class="online-playlist-browser-copy">
                <strong>{t("ncm.results.playlists")}</strong>
                <span>{t("ncm.playlist.browserCount", { count: playlistResults().length })}</span>
              </div>
            </div>
            <div class="online-playlist-grid">
              <For each={playlistResults()}>
                {(playlist) => (
                  <PlaylistBrowserCard
                    playlist={playlist}
                    active={selectedPlaylist()?.id === playlist.id}
                    onSelect={() => void loadPlaylistTracks(playlist)}
                  />
                )}
              </For>
            </div>
          </aside>
          <section class="online-playlist-tracks">
            <Show
              when={selectedPlaylist()}
              fallback={<div class="online-search-empty"><strong>{t("ncm.discover.search.selectPlaylist")}</strong></div>}
            >
              {(playlist) => (
                <>
                  <header class="online-playlist-tracks-head">
                    <div class="online-playlist-tracks-art" aria-hidden="true">
                      <Show when={playlist().coverUrl} fallback={<span>{playlist().name.slice(0, 1)}</span>}>
                        {(coverUrl) => <img src={coverUrl()} alt="" loading="lazy" />}
                      </Show>
                    </div>
                    <div class="online-playlist-tracks-copy">
                      <span class="online-playlist-tracks-eyebrow">{t("ncm.discover.search.playlistEyebrow")}</span>
                      <h3>{playlist().name}</h3>
                      <p>
                        {t("ncm.playlist.meta", {
                          count: playlist().trackCount ?? 0,
                          creator: playlist().creator ?? t("ncm.playlist.creatorUnknown")
                        })}
                      </p>
                    </div>
                  </header>
                  <MediaList
                    items={playlistTracksState()}
                    currentSourcePath={props.currentTrackPath}
                    currentSongId={props.currentSongId}
                    isPlayingNow={props.isPlaying}
                    onPlay={(item) => void playOnlineTrack(item)}
                    onEnqueue={(item) => void enqueueOnlineTrack(item)}
                    isLoading={isLoadingPlaylistTracks()}
                    emptyState={<div class="panel-note">{t("ncm.empty.noTracks")}</div>}
                  />
                </>
              )}
            </Show>
          </section>
        </div>
      </Show>
    </section>
  );

  const hasHqPlaylist = createMemo(() => {
    if (hqCatNames().size === 0) return false;
    if (catName() === "全部歌单") return true;
    return hqCatNames().has(catName());
  });

  const catTypesList = createMemo(() => {
    const types = catTypes();
    return Object.entries(types).map(([key, label]) => ({ key: Number(key), label }));
  });

  const DiscoverPlaylistShowcase = () => (
    <section class="online-discover-section online-discover-playlists">
      <div class="online-discover-menu">
        <button type="button" class="online-discover-cat-button" onClick={() => setCatModalOpen(true)}>
          {catName()}
          <span aria-hidden="true">›</span>
        </button>
        <Show when={hasHqPlaylist()}>
          <div class="online-discover-mini-tabs">
            <button
              type="button"
              class={discoverPlaylistKind() === "normal" ? "is-active" : ""}
              onClick={() => setDiscoverPlaylistKind("normal")}
            >
              {t("ncm.discover.playlists.recommend")}
            </button>
            <button
              type="button"
              class={discoverPlaylistKind() === "hq" ? "is-active" : ""}
              onClick={() => setDiscoverPlaylistKind("hq")}
            >
              {t("ncm.discover.playlists.hq")}
            </button>
          </div>
        </Show>
      </div>
      <div class="online-result-panel-head">
        <div class="online-result-panel-copy">
          <strong>{discoverSectionTitle()}</strong>
          <span>{discoverSectionSubtitle()}</span>
        </div>
      </div>
      <Show when={allPlaylists().length > 0} fallback={<div class="panel-note">{isLoadingPlaylists() ? t("ncm.playlist.loading") : t("ncm.home.empty")}</div>}>
        <div class="album-grid">
          <For each={allPlaylists()}>
            {(item) => (
              <AlbumCard
                title={item.title}
                subtitle={item.subtitle}
                coverUrl={item.coverUrl}
                onClick={() =>
                  void loadPlaylistTracks({
                    id: item.id,
                    name: item.title,
                    creator: item.subtitle,
                    coverUrl: item.coverUrl,
                    trackCount: null,
                    subscribed: false
                  })
                }
              />
            )}
          </For>
        </div>
      </Show>
      <Show when={hasMorePlaylists() && allPlaylists().length > 0}>
        <div class="online-discover-load-more">
          <button
            type="button"
            class="ghost-button"
            disabled={isLoadingPlaylists()}
            onClick={() => { setPlaylistOffset((o) => o + DISCOVER_PAGE_LIMIT); void fetchPlaylists(false); }}
          >
            {isLoadingPlaylists() ? t("ncm.playlist.loading") : t("ncm.discover.loadMore")}
          </button>
        </div>
      </Show>
    </section>
  );

  const DiscoverArtistShowcase = () => (
    <section class="online-discover-section online-discover-artists">
      <div class="online-discover-filter-menu">
        <For each={ARTIST_INITIALS}>
          {(item) => (
            <button
              type="button"
              class={discoverArtistInitial() === item.key ? "is-active" : ""}
              onClick={() => setDiscoverArtistInitial(item.key)}
            >
              {isTranslationKey(item.label) ? t(item.label) : item.label}
            </button>
          )}
        </For>
      </div>
      <div class="online-discover-filter-menu online-discover-filter-menu--category">
        <For each={ARTIST_AREAS}>
          {(item, index) => (
            <button
              type="button"
              class={discoverArtistAreaIndex() === index() ? "is-active" : ""}
              onClick={() => setDiscoverArtistAreaIndex(index())}
            >
              {t(item.labelKey)}
            </button>
          )}
        </For>
      </div>
      <div class="online-result-panel-head">
        <div class="online-result-panel-copy">
          <strong>{discoverSectionTitle()}</strong>
          <span>{discoverSectionSubtitle()}</span>
        </div>
      </div>
      <Show when={(discoverArtists() ?? []).length > 0} fallback={<div class="panel-note">{t("ncm.home.empty")}</div>}>
        <div class="album-grid">
          <For each={discoverArtists() ?? []}>
            {(item) => (
              <AlbumCard title={item.title} subtitle={item.subtitle} coverUrl={item.coverUrl} shape="round" size="sm" />
            )}
          </For>
        </div>
      </Show>
    </section>
  );

  const DiscoverToplistShowcase = () => {
    const officialItems = () => (discoverToplists() ?? []).filter((item) => item.isOfficial);
    const selectedItems = () => (discoverToplists() ?? []).filter((item) => !item.isOfficial);

    return (
      <section class="online-discover-section online-discover-toplists">
        <div class="online-discover-divider"><span>{t("ncm.discover.toplists.official")}</span></div>
        <Show when={officialItems().length > 0} fallback={<div class="panel-note">{t("ncm.home.empty")}</div>}>
          <div class="online-toplist-grid">
            <For each={officialItems()}>
              {(item) => (
                <button
                  type="button"
                  class="online-toplist-card"
                  onClick={() =>
                    void loadPlaylistTracks({
                      id: item.id,
                      name: item.title,
                      creator: item.subtitle,
                      coverUrl: item.coverUrl,
                      trackCount: null,
                      subscribed: false
                    })
                  }
                >
                  <div class="online-toplist-cover" aria-hidden="true">
                    <Show when={item.coverUrl} fallback={<span>{item.title.slice(0, 1)}</span>}>
                      {(coverUrl) => <img src={coverUrl()} alt="" loading="lazy" />}
                    </Show>
                  </div>
                  <div class="online-toplist-copy">
                    <strong>{item.title}</strong>
                    <Show when={item.subtitle}>
                      {(subtitle) => <span class="online-toplist-desc">{subtitle()}</span>}
                    </Show>
                    <div class="online-toplist-songs">
                      <For each={item.tracks.slice(0, 3)}>
                        {(track, index) => (
                          <span class="online-toplist-song">
                            <span>{index() + 1}. {track.title}</span>
                            <small>{track.artist ?? ""}</small>
                          </span>
                        )}
                      </For>
                    </div>
                  </div>
                </button>
              )}
            </For>
          </div>
        </Show>

        <div class="online-discover-divider"><span>{t("ncm.discover.toplists.selected")}</span></div>
        <Show when={selectedItems().length > 0} fallback={<div class="panel-note">{t("ncm.home.empty")}</div>}>
          <div class="album-grid">
            <For each={selectedItems()}>
              {(item) => (
                <AlbumCard
                  title={item.title}
                  subtitle={item.subtitle ?? item.description}
                  coverUrl={item.coverUrl}
                  onClick={() =>
                    void loadPlaylistTracks({
                      id: item.id,
                      name: item.title,
                      creator: item.subtitle,
                      coverUrl: item.coverUrl,
                      trackCount: null,
                      subscribed: false
                    })
                  }
                />
              )}
            </For>
          </div>
        </Show>
      </section>
    );
  };

  const DiscoverNewShowcase = () => (
    <section class="online-discover-section online-discover-new">
      <div class="online-discover-menu">
        <div class="online-discover-filter-menu">
          <button
            type="button"
            class={discoverNewKind() === "albums" ? "is-active" : ""}
            onClick={() => setDiscoverNewKind("albums")}
          >
            {t("ncm.discover.new.albums")}
          </button>
          <button
            type="button"
            class={discoverNewKind() === "songs" ? "is-active" : ""}
            onClick={() => setDiscoverNewKind("songs")}
          >
            {t("ncm.discover.new.songs")}
          </button>
        </div>
        <div class="online-discover-filter-menu">
          <For each={NEW_AREAS}>
            {(item, index) => (
              <button
                type="button"
                class={discoverNewAreaIndex() === index() ? "is-active" : ""}
                onClick={() => setDiscoverNewAreaIndex(index())}
              >
                {t(item.labelKey)}
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="online-result-panel-head">
        <div class="online-result-panel-copy">
          <strong>{discoverSectionTitle()}</strong>
          <span>{discoverSectionSubtitle()}</span>
        </div>
      </div>
      <Show when={allAlbums().length > 0 || (discoverSongs() ?? []).length > 0} fallback={<div class="panel-note">{isLoadingAlbums() ? t("ncm.playlist.loading") : t("ncm.home.empty")}</div>}>
        <Show when={discoverNewKind() === "albums"} fallback={
          <div class="online-discover-card-stack">
            <MediaList
              items={(discoverSongs() ?? []).slice(0, 50)}
              currentSourcePath={props.currentTrackPath}
              currentSongId={props.currentSongId}
              isPlayingNow={props.isPlaying}
              onPlay={(item) => void playOnlineTrack(item)}
              onEnqueue={(item) => void enqueueOnlineTrack(item)}
              emptyState={<div class="panel-note">{t("ncm.empty.noSongs")}</div>}
            />
          </div>
        }>
          <div class="online-discover-card-stack">
            <div class="album-grid">
              <For each={allAlbums()}>
                {(item) => <AlbumCard title={item.title} subtitle={item.subtitle} coverUrl={item.coverUrl} />}
              </For>
            </div>
            <Show when={hasMoreAlbums()}>
              <div class="online-discover-load-more">
                <button
                  type="button"
                  class="ghost-button"
                  disabled={isLoadingAlbums()}
                  onClick={() => { setAlbumOffset((o) => o + DISCOVER_PAGE_LIMIT); void fetchAlbums(false); }}
                >
                  {isLoadingAlbums() ? t("ncm.playlist.loading") : t("ncm.discover.loadMore")}
                </button>
              </div>
            </Show>
          </div>
        </Show>
      </Show>
    </section>
  );

  const DailySongsDetail = () => {
    const eyebrow = () => {
      const profile = loginProfile();
      return profile
        ? t("ncm.daily.eyebrow", { name: profile.nickname ?? profile.userId })
        : t("ncm.daily.eyebrowAnonymous");
    };
    return (
      <section class="ncm-daily-detail">
        <button
          type="button"
          class="ghost-button ncm-daily-detail-back"
          onClick={exitDailySongs}
        >
          <IconChevronLeft />
          {t("ncm.daily.backToFeed")}
        </button>
        <header class="ncm-daily-detail-hero">
          <span class="ncm-daily-detail-eyebrow">{eyebrow()}</span>
          <h2>{t("ncm.daily.title")}</h2>
          <p class="ncm-daily-detail-meta">
            {dailySongsState().length > 0
              ? t("ncm.daily.metaCount", { count: dailySongsState().length })
              : t("ncm.daily.description")}
          </p>
        </header>
        <MediaList
          items={dailySongsState()}
          currentSourcePath={props.currentTrackPath}
          currentSongId={props.currentSongId}
          isPlayingNow={props.isPlaying}
          onPlay={(item) => void playOnlineTrack(item)}
          onEnqueue={(item) => void enqueueOnlineTrack(item)}
          isLoading={isLoadingDailySongs()}
          emptyState={<div class="panel-note">{t("ncm.daily.empty")}</div>}
        />
      </section>
    );
  };

  const LikedSongsDetail = () => {
    const eyebrow = () => {
      const profile = loginProfile();
      return profile
        ? t("ncm.liked.eyebrow", { name: profile.nickname ?? profile.userId })
        : t("ncm.liked.eyebrowAnonymous");
    };
    return (
      <section class="ncm-daily-detail">
        <button
          type="button"
          class="ghost-button ncm-daily-detail-back"
          onClick={exitLikedSongs}
        >
          <IconChevronLeft />
          {t("ncm.liked.backToFeed")}
        </button>
        <header class="ncm-daily-detail-hero">
          <span class="ncm-daily-detail-eyebrow">{eyebrow()}</span>
          <h2>{t("ncm.liked.title")}</h2>
          <p class="ncm-daily-detail-meta">
            {likedSongsTotal() > 0
              ? t("ncm.liked.metaCount", { count: likedSongsTotal() })
              : t("ncm.liked.description")}
          </p>
        </header>
        <MediaList
          items={likedSongsState()}
          currentSourcePath={props.currentTrackPath}
          currentSongId={props.currentSongId}
          isPlayingNow={props.isPlaying}
          onPlay={(item) => void playOnlineTrack(item)}
          onEnqueue={(item) => void enqueueOnlineTrack(item)}
          isLoading={isLoadingLikedSongs()}
          emptyState={<div class="panel-note">{t("ncm.liked.empty")}</div>}
        />
      </section>
    );
  };

  const AlbumDetail = () => {
    const album = selectedAlbum();
    if (!album) return null;
    return (
      <section class="ncm-daily-detail">
        <button
          type="button"
          class="ghost-button ncm-daily-detail-back"
          onClick={exitAlbum}
        >
          <IconChevronLeft />
          {t("ncm.album.backToFeed")}
        </button>
        <header class="ncm-daily-detail-hero">
          <Show when={album.coverUrl}>
            {(url) => <img class="ncm-detail-hero-cover" src={url()} alt="" />}
          </Show>
          <h2>{album.title}</h2>
          <p class="ncm-daily-detail-meta">
            {album.subtitle ?? ""}
            {albumTracksState().length > 0
              ? ` · ${t("ncm.album.metaCount", { count: albumTracksState().length })}`
              : ""}
          </p>
        </header>
        <MediaList
          items={albumTracksState()}
          currentSourcePath={props.currentTrackPath}
          currentSongId={props.currentSongId}
          isPlayingNow={props.isPlaying}
          onPlay={(item) => void playOnlineTrack(item)}
          onEnqueue={(item) => void enqueueOnlineTrack(item)}
          isLoading={isLoadingAlbumTracks()}
          emptyState={<div class="panel-note">{t("ncm.album.empty")}</div>}
        />
      </section>
    );
  };

  const ArtistDetail = () => {
    const artist = selectedArtist();
    if (!artist) return null;
    return (
      <section class="ncm-daily-detail">
        <button
          type="button"
          class="ghost-button ncm-daily-detail-back"
          onClick={exitArtist}
        >
          <IconChevronLeft />
          {t("ncm.artist.backToFeed")}
        </button>
        <header class="ncm-daily-detail-hero">
          <Show when={artist.coverUrl}>
            {(url) => <img class="ncm-detail-hero-cover ncm-detail-hero-cover--round" src={url()} alt="" />}
          </Show>
          <h2>{artist.title}</h2>
          <p class="ncm-daily-detail-meta">
            {artistTracksState().length > 0
              ? t("ncm.artist.metaCount", { count: artistTracksState().length })
              : ""}
          </p>
        </header>
        <MediaList
          items={artistTracksState()}
          currentSourcePath={props.currentTrackPath}
          currentSongId={props.currentSongId}
          isPlayingNow={props.isPlaying}
          onPlay={(item) => void playOnlineTrack(item)}
          onEnqueue={(item) => void enqueueOnlineTrack(item)}
          isLoading={isLoadingArtistTracks()}
          emptyState={<div class="panel-note">{t("ncm.artist.empty")}</div>}
        />
      </section>
    );
  };

  const SongsResultPanel = () => (
    <section class="online-result-panel">
      <div class="online-result-panel-head">
        <div class="online-result-panel-copy">
          <strong>{searchTab() === "songs" ? t("ncm.results.songs") : t("ncm.results.playlists")}</strong>
          <span>
            {globalQuery().trim()
              ? t("ncm.results.keyword", { keyword: globalQuery().trim() })
              : props.mode === "recommend"
                ? t("ncm.results.idle.recommend")
                : t("ncm.results.idle.discover")}
          </span>
        </div>
      </div>

      <MediaList
        items={songResults()}
        currentSourcePath={props.currentTrackPath}
        currentSongId={props.currentSongId}
        isPlayingNow={props.isPlaying}
        onPlay={(item) => void playOnlineTrack(item)}
        onEnqueue={(item) => void enqueueOnlineTrack(item)}
        emptyState={
          <div class="online-search-empty">
            <strong>
              {globalQuery().trim() ? t("ncm.empty.noSongs") : t("ncm.empty.searchPrompt")}
            </strong>
            <span>
              {globalQuery().trim()
                ? t("ncm.empty.noSongsHint")
                : props.mode === "recommend"
                  ? t("ncm.empty.searchPromptHint.recommend")
                  : t("ncm.empty.searchPromptHint.discover")}
            </span>
          </div>
        }
      />
    </section>
  );

  return (
    <div class={`panel panel-page online-page${isDiscoverMode() ? " is-discover-page" : ""}`}>
      <Show when={!selectedPlaylist()}>
        <PageHeader
          title={isRecommendMode() ? recommendGreeting() : pageTitle()}
          meta={
            isRecommendMode() ? undefined : isDiscoverMode() ? (
              undefined
            ) : (
              <>
                <span class="page-header-meta-line">{pageSubtitle()}</span>
                <span class="page-header-meta-line">{loginStatusText()}</span>
              </>
            )
          }
          actions={
            isRecommendMode() || isDiscoverMode()
              ? undefined
              : loginProfile() === null ? (
                  <button type="button" class="primary-button page-action" onClick={beginLogin} disabled={isLoginBusy()}>
                    <IconPlayCircle />
                    {t("ncm.login.action.qr")}
                  </button>
                ) : (
                  <button
                    type="button"
                    class="ghost-button page-action"
                    onClick={() => void handleLogout()}
                    disabled={isLoginBusy()}
                  >
                    {t("ncm.login.action.logout")}
                  </button>
                )
          }
          tabs={
            isDiscoverMode() ? (
              <SegmentedTabs
                value={discoverTab()}
                onChange={(next) => setDiscoverTab(next as DiscoverTab)}
                items={discoverTabs()}
                ariaLabel={t("ncm.discover.tabs.aria")}
              />
            ) : isSearchMode() && !isRecommendMode() ? (
              <SegmentedTabs
                value={searchTab()}
                onChange={(next) => setSearchTab(next as SearchTab)}
                items={searchTabs()}
                ariaLabel={t("ncm.tabs.aria")}
              />
            ) : undefined
          }
        />
      </Show>

      <Show when={isRecommendMode()}>
        <p class="online-recommend-subtitle">{t("ncm.home.welcome")}</p>
      </Show>

      <Show when={feedback().message && feedback().message !== t("ncm.feedback.initial")}>
        <section class="online-login-card">
          <div class="status-stack">
            <strong>{t("ncm.login.title")}</strong>
            <span class="status-line">{loginStatusText()}</span>
            <span class={feedback().tone === "error" ? "status-error" : "status-line"}>{feedback().message}</span>
          </div>
        </section>
      </Show>

      <LoginModal open={isLoginModalOpen()} onClose={() => setIsLoginModalOpen(false)} />

      {/* Category selection modal */}
      <Show when={catModalOpen()}>
        <div class="cat-modal-overlay" onClick={() => setCatModalOpen(false)}>
          <div class="cat-modal" onClick={(e) => e.stopPropagation()}>
            <div class="cat-modal-header">
              <strong>{t("ncm.discover.cat.title")}</strong>
              <button
                type="button"
                class={`cat-modal-tag${catName() === "全部歌单" ? " is-active" : ""}`}
                onClick={() => { setCatName("全部歌单"); setCatModalOpen(false); }}
              >
                {t("ncm.discover.cat.all")}
              </button>
            </div>
            <div class="cat-modal-tabs">
              <For each={catTypesList()}>
                {(typeItem) => (
                  <div class="cat-modal-group">
                    <div class="cat-modal-group-label">{typeItem.label}</div>
                    <div class="cat-modal-tags">
                      <For each={catEntries().filter((c) => c.category === typeItem.key)}>
                        {(cat) => (
                          <button
                            type="button"
                            class={`cat-modal-tag${catName() === cat.name ? " is-active" : ""}`}
                            onClick={() => { setCatName(cat.name); setCatModalOpen(false); }}
                          >
                            {cat.hot ? <span class="cat-modal-hot" aria-hidden="true" /> : null}
                            {cat.name}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>

      <Show when={isSearchMode()}>
        <Show
          when={selectedDailySongs()}
          fallback={
            <Show
              when={selectedLikedSongs()}
              fallback={
                <Show
                  when={selectedAlbum()}
                  fallback={
                    <Show
                      when={selectedArtist()}
                      fallback={
                        <Show
                          when={selectedPlaylist()}
                          fallback={
                            <Show
                              when={isRecommendMode()}
                              fallback={
                                <>
                                  <div class="online-discover-view">
                                    <Show when={discoverTab() === "playlists"}>
                                      <DiscoverPlaylistShowcase />
                                    </Show>
                                    <Show when={discoverTab() === "toplists"}>
                                      <DiscoverToplistShowcase />
                                    </Show>
                                    <Show when={discoverTab() === "artists"}>
                                      <DiscoverArtistShowcase />
                                    </Show>
                                    <Show when={discoverTab() === "new"}>
                                      <DiscoverNewShowcase />
                                    </Show>
                                    <Show when={shouldShowDiscoverResults()}>
                                      <Show when={searchTab() === "songs"} fallback={<SearchPlaylistLayout />}>
                                        <SongsResultPanel />
                                      </Show>
                                    </Show>
                                  </div>
                                </>
                              }
                            >
                              <section class="online-recommend-stage">
                                <NeteaseHomeFeed
                                  isLoggedIn={loginProfile() !== null}
                                  userId={loginProfile()?.userId ?? null}
                                  onSelectPlaylist={(playlist) => void loadPlaylistTracks(playlist)}
                                  onSelectDailySongs={enterDailySongs}
                                  onSelectLikedSongs={enterLikedSongs}
                                  onPlayPersonalFm={() => void playPersonalFmRadio()}
                                  onSelectAlbum={(item) => void loadAlbumTracks(item)}
                                  onSelectArtist={(item) => void loadArtistTracks(item)}
                                  onNavigateToDiscover={(tab) => handleNavigateToDiscover(tab)}
                                />
                              </section>
                            </Show>
                          }
                        >
                          <PlaylistTracks />
                        </Show>
                      }
                    >
                      <ArtistDetail />
                    </Show>
                  }
                >
                  <AlbumDetail />
                </Show>
              }
            >
              <LikedSongsDetail />
            </Show>
          }
        >
          <DailySongsDetail />
        </Show>
      </Show>

      <Show when={props.mode === "created-playlists" || props.mode === "collected-playlists"}>
        <Show when={loginProfile() !== null} fallback={<div class="panel-note">{t("ncm.empty.loginRequired")}</div>}>
          <Show when={selectedPlaylist()} fallback={
            <Show when={playlistCards().length > 0} fallback={<div class="panel-note">{isLoadingUserPlaylists() ? t("ncm.playlist.loading") : playlistEmptyText()}</div>}>
              <PlaylistGrid />
            </Show>
          }>
            <PlaylistTracks />
          </Show>
        </Show>
      </Show>
    </div>
  );
}

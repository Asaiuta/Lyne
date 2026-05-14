import { parseCurrentLyricsResponse } from "./lyrics";
import type {
  GetNcmHomeFeedInput,
  ListNcmCloudTracksInput,
  ListNcmDiscoverAlbumsInput,
  ListNcmDiscoverArtistsInput,
  ListNcmDiscoverPlaylistsInput,
  ListNcmDiscoverSongsInput,
  ListNcmPlaylistTracksInput,
  ListNcmUserPlaylistsInput,
  NcmAccountState,
  NcmAccountSummary,
  NcmAccountUpsertInput,
  NcmCloudTracksPage,
  NcmDiscoverCard,
  NcmDiscoverCardsPage,
  NcmDiscoverPlaylistCategories,
  NcmDiscoverPlaylistCategoryEntry,
  NcmDiscoverToplist,
  NcmDiscoverToplistTrack,
  NcmHomeFeed,
  NcmHomeFeedCard,
  NcmHomeFeedError,
  NcmHomePersonalFmPreview,
  NcmHomeTrackCover,
  NcmPlaylistSummary,
  NcmTrackPlaybackResult,
  NcmTrackQueueResult,
  NcmTrackSummary,
  ResolveNcmTrackInput,
  ResolvedNcmTrack,
  ResolvedNcmTrackSupplement,
  SearchNcmTracksInput
} from "./ncmDomainTypes";
import type { PlayerState, QueueEntry } from "./types";

export interface NcmApiClient {
  resolveNcmTrack: (input: ResolveNcmTrackInput) => Promise<ResolvedNcmTrack>;
  playNcmTrack: (input: ResolveNcmTrackInput) => Promise<NcmTrackPlaybackResult>;
  enqueueNcmTrack: (input: ResolveNcmTrackInput) => Promise<NcmTrackQueueResult>;
  resolveNcmTrackSupplement: (songId: number) => Promise<ResolvedNcmTrackSupplement>;
  getNcmAccounts: () => Promise<NcmAccountState>;
  upsertNcmAccount: (input: NcmAccountUpsertInput) => Promise<NcmAccountState>;
  setActiveNcmAccount: (userId: number) => Promise<NcmAccountState>;
  refreshActiveNcmAccount: () => Promise<NcmAccountState>;
  logoutActiveNcmAccount: () => Promise<NcmAccountState>;
  dailySigninActiveNcmAccount: () => Promise<NcmAccountState>;
  deleteNcmAccount: (userId: number) => Promise<NcmAccountState>;
  listNcmUserPlaylists: (input: ListNcmUserPlaylistsInput) => Promise<NcmPlaylistSummary[]>;
  searchNcmTracks: (input: SearchNcmTracksInput) => Promise<NcmTrackSummary[]>;
  searchNcmPlaylists: (input: SearchNcmTracksInput) => Promise<NcmPlaylistSummary[]>;
  listNcmPlaylistTracks: (input: ListNcmPlaylistTracksInput) => Promise<NcmTrackSummary[]>;
  listNcmDailySongTracks: () => Promise<NcmTrackSummary[]>;
  listNcmSongDetailTracks: (ids: number[]) => Promise<NcmTrackSummary[]>;
  listNcmPersonalFmTracks: () => Promise<NcmTrackSummary[]>;
  trashNcmPersonalFmTrack: (songId: number) => Promise<void>;
  listNcmAlbumTracks: (id: number) => Promise<NcmTrackSummary[]>;
  listNcmArtistTracks: (id: number) => Promise<NcmTrackSummary[]>;
  getNcmLikelistIds: (uid: number) => Promise<number[]>;
  listNcmCloudTracks: (input: ListNcmCloudTracksInput) => Promise<NcmCloudTracksPage>;
  deleteNcmCloudTrack: (songId: number) => Promise<void>;
  getNcmHomeFeed: (input?: GetNcmHomeFeedInput) => Promise<NcmHomeFeed>;
  listNcmDiscoverPlaylists: (input: ListNcmDiscoverPlaylistsInput) => Promise<NcmDiscoverCardsPage>;
  listNcmDiscoverAlbums: (input: ListNcmDiscoverAlbumsInput) => Promise<NcmDiscoverCardsPage>;
  listNcmDiscoverArtists: (input: ListNcmDiscoverArtistsInput) => Promise<NcmDiscoverCard[]>;
  listNcmDiscoverToplists: () => Promise<NcmDiscoverToplist[]>;
  listNcmDiscoverSongs: (input: ListNcmDiscoverSongsInput) => Promise<NcmTrackSummary[]>;
  getNcmDiscoverPlaylistCategories: () => Promise<NcmDiscoverPlaylistCategories>;
}

export type NcmRequestJson = (path: string, init?: RequestInit) => Promise<unknown>;

export interface NcmApiTransport {
  requestJson: NcmRequestJson;
  parsePlayerState: (value: unknown) => PlayerState | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isInteger = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value);

const isString = (value: unknown): value is string => typeof value === "string";

const isNullableString = (value: unknown): value is string | null =>
  value === null || isString(value);

const isNullableNumber = (value: unknown): value is number | null =>
  value === null || isNumber(value);

const isNullableInteger = (value: unknown): value is number | null =>
  value === null || isInteger(value);

const isStringRecord = (value: unknown): value is Record<string, string> => {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(isString);
};

const parseStatus = (value: unknown): "success" | "error" => {
  if (value === "success" || value === "error") {
    return value;
  }
  throw new Error("Invalid NCM response status");
};

const parseStatusMessage = (value: unknown) => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM response shape");
  }

  return {
    status: parseStatus(value.status),
    message: typeof value.message === "string" ? value.message : null
  };
};

const parseResolvedNcmTrack = (value: unknown, errorMessage: string): ResolvedNcmTrack => {
  if (!isRecord(value)) {
    throw new Error(errorMessage);
  }

  if (
    !isInteger(value.song_id) ||
    !isString(value.stream_url) ||
    !isString(value.source_page_url) ||
    !isNullableString(value.title) ||
    !isNullableString(value.artist) ||
    !isNullableString(value.album) ||
    !isNullableString(value.cover_url) ||
    !isNullableNumber(value.duration_secs)
  ) {
    throw new Error(errorMessage);
  }

  return {
    songId: value.song_id,
    streamUrl: value.stream_url,
    sourcePageUrl: value.source_page_url,
    title: value.title,
    artist: value.artist,
    album: value.album,
    coverUrl: value.cover_url,
    durationSecs: value.duration_secs
  };
};

const parseResolvedNcmTrackResponse = (value: unknown): ResolvedNcmTrack => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM track response shape");
  }

  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to resolve NCM track");
  }

  return parseResolvedNcmTrack(value.track, "Invalid NCM track payload");
};

const parseNcmTrackPlaybackResponse = (
  value: unknown,
  parsePlayerState: (value: unknown) => PlayerState | null
): NcmTrackPlaybackResult => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM playback response shape");
  }

  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to play NCM track");
  }

  const track = parseResolvedNcmTrack(value.track, "Invalid NCM playback track payload");
  const state = parsePlayerState(value.state);
  if (!state) {
    throw new Error("Invalid NCM playback state payload");
  }

  return { track, state };
};

const parseNcmTrackQueueResponse = (value: unknown): NcmTrackQueueResult => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM queue response shape");
  }

  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to enqueue NCM track");
  }

  const track = parseResolvedNcmTrack(value.track, "Invalid NCM queue track payload");
  if (!Array.isArray(value.queue)) {
    throw new Error("Invalid NCM queue payload");
  }

  return { track, queue: value.queue as QueueEntry[] };
};

const parseResolvedNcmTrackSupplementResponse = (value: unknown): ResolvedNcmTrackSupplement => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM supplement response shape");
  }

  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to resolve NCM supplement");
  }

  const supplement = isRecord(value.supplement) ? value.supplement : null;
  if (
    !supplement ||
    !isInteger(supplement.song_id) ||
    !isNullableString(supplement.title) ||
    !isNullableString(supplement.artist) ||
    !isNullableString(supplement.album) ||
    !isNullableString(supplement.cover_url) ||
    !Array.isArray(supplement.lyrics) ||
    !isNullableString(supplement.detail_error) ||
    !isNullableString(supplement.lyrics_error)
  ) {
    throw new Error("Invalid NCM supplement payload");
  }

  const lyrics = parseCurrentLyricsResponse({
    status: "success",
    lyrics: supplement.lyrics,
    source: null
  }).lyrics;

  return {
    songId: supplement.song_id,
    title: supplement.title,
    artist: supplement.artist,
    album: supplement.album,
    coverUrl: supplement.cover_url,
    lyrics,
    detailError: supplement.detail_error,
    lyricsError: supplement.lyrics_error
  };
};

const parseNcmAccountSummary = (value: unknown): NcmAccountSummary | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isInteger(value.user_id) ||
    !isNullableString(value.nickname) ||
    !isNullableString(value.avatar_url) ||
    !isBoolean(value.has_cookie) ||
    !isNullableInteger(value.vip_type) ||
    !isNullableInteger(value.level) ||
    !isNullableInteger(value.signin_at_ms) ||
    !isInteger(value.added_at_ms) ||
    !isInteger(value.refreshed_at_ms)
  ) {
    return null;
  }

  if ("cookie" in value) {
    throw new Error("Invalid NCM account payload");
  }

  return {
    userId: value.user_id,
    nickname: value.nickname,
    avatarUrl: value.avatar_url,
    hasCookie: value.has_cookie,
    vipType: value.vip_type,
    level: value.level,
    signinAt: value.signin_at_ms,
    addedAt: value.added_at_ms,
    refreshedAt: value.refreshed_at_ms
  };
};

const parseNcmAccountStateResponse = (value: unknown): NcmAccountState => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM account response shape");
  }

  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to read NCM accounts");
  }

  if (!Array.isArray(value.accounts) || !isNullableInteger(value.active_user_id)) {
    throw new Error("Invalid NCM account payload");
  }
  const accounts = value.accounts.map(parseNcmAccountSummary);
  if (accounts.some((account) => account === null)) {
    throw new Error("Invalid NCM account payload");
  }

  return {
    accounts: accounts as NcmAccountSummary[],
    activeUserId: value.active_user_id
  };
};

const parseNcmPlaylistSummary = (value: unknown): NcmPlaylistSummary | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isInteger(value.id) ||
    !isString(value.name) ||
    !isNullableString(value.creator) ||
    !isNullableString(value.cover_url) ||
    !isNullableInteger(value.track_count) ||
    !isBoolean(value.subscribed)
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    creator: value.creator,
    coverUrl: value.cover_url,
    trackCount: value.track_count,
    subscribed: value.subscribed
  };
};

const parseNcmUserPlaylistsResponse = (value: unknown): NcmPlaylistSummary[] => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM playlists response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load NCM playlists");
  }
  if (!Array.isArray(value.playlists)) {
    throw new Error("Invalid NCM playlists payload");
  }
  const playlists = value.playlists.map(parseNcmPlaylistSummary);
  if (playlists.some((playlist) => playlist === null)) {
    throw new Error("Invalid NCM playlists payload");
  }
  return playlists as NcmPlaylistSummary[];
};

const parseNcmTrackSummary = (value: unknown): NcmTrackSummary | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isString(value.id) ||
    !isInteger(value.song_id) ||
    !isString(value.source_path) ||
    !isNullableString(value.title) ||
    !isNullableString(value.artist) ||
    !isNullableString(value.album) ||
    !isNullableNumber(value.duration_secs) ||
    !isNullableString(value.artwork_url)
  ) {
    return null;
  }
  return {
    id: value.id,
    songId: value.song_id,
    source_path: value.source_path,
    title: value.title,
    artist: value.artist,
    album: value.album,
    duration_secs: value.duration_secs,
    artworkUrl: value.artwork_url,
    size_bytes: isNullableInteger(value.size_bytes) ? value.size_bytes : null
  };
};

const parseNcmTracksResponse = (value: unknown): NcmTrackSummary[] => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM tracks response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load NCM tracks");
  }
  if (!Array.isArray(value.tracks)) {
    throw new Error("Invalid NCM tracks payload");
  }
  const tracks = value.tracks.map(parseNcmTrackSummary);
  if (tracks.some((track) => track === null)) {
    throw new Error("Invalid NCM tracks payload");
  }
  return tracks as NcmTrackSummary[];
};

const parseNcmCloudTracksResponse = (value: unknown): NcmCloudTracksPage => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM cloud response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load NCM cloud tracks");
  }
  if (
    !Array.isArray(value.tracks) ||
    !isInteger(value.count) ||
    !isInteger(value.size_bytes) ||
    !isInteger(value.max_size_bytes)
  ) {
    throw new Error("Invalid NCM cloud payload");
  }
  const tracks = value.tracks.map(parseNcmTrackSummary);
  if (tracks.some((track) => track === null)) {
    throw new Error("Invalid NCM cloud payload");
  }
  return {
    tracks: tracks as NcmTrackSummary[],
    count: value.count,
    sizeBytes: value.size_bytes,
    maxSizeBytes: value.max_size_bytes
  };
};

const parseNcmHomeFeedCard = (value: unknown): NcmHomeFeedCard | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isInteger(value.id) ||
    !isString(value.title) ||
    !isNullableString(value.subtitle) ||
    !isNullableString(value.cover_url) ||
    !isNullableNumber(value.play_count) ||
    !isNullableString(value.description)
  ) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    subtitle: value.subtitle,
    coverUrl: value.cover_url,
    playCount: value.play_count,
    description: value.description
  };
};

const parseNcmHomeTrackCover = (value: unknown): NcmHomeTrackCover | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (!isInteger(value.id) || !isNullableString(value.url)) {
    return null;
  }
  return {
    id: value.id,
    url: value.url
  };
};

const parseNcmHomePersonalFmPreview = (value: unknown): NcmHomePersonalFmPreview | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isString(value.title) ||
    !isNullableString(value.artist) ||
    !isNullableString(value.album) ||
    !isNullableString(value.cover_url)
  ) {
    return null;
  }
  return {
    title: value.title,
    artist: value.artist,
    album: value.album,
    coverUrl: value.cover_url
  };
};

const parseNcmHomeFeedError = (value: unknown): NcmHomeFeedError | null => {
  if (!isRecord(value) || !isString(value.section) || !isString(value.message)) {
    return null;
  }
  return {
    section: value.section,
    message: value.message
  };
};

const parseArray = <T>(
  value: unknown,
  parse: (item: unknown) => T | null,
  errorMessage: string
): T[] => {
  if (!Array.isArray(value)) {
    throw new Error(errorMessage);
  }
  const parsed = value.map(parse);
  if (parsed.some((item) => item === null)) {
    throw new Error(errorMessage);
  }
  return parsed as T[];
};

const parseStringItem = (value: unknown): string | null =>
  isString(value) ? value : null;

const parseNcmDiscoverCard = (value: unknown): NcmDiscoverCard | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isInteger(value.id) ||
    !isString(value.title) ||
    !isNullableString(value.subtitle) ||
    !isNullableString(value.cover_url) ||
    !isNullableInteger(value.cursor)
  ) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    subtitle: value.subtitle,
    coverUrl: value.cover_url,
    cursor: value.cursor
  };
};

const parseNcmDiscoverCardsPageResponse = (value: unknown): NcmDiscoverCardsPage => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM discover cards response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load NCM discover cards");
  }
  if (!isBoolean(value.has_more)) {
    throw new Error("Invalid NCM discover cards payload");
  }
  return {
    items: parseArray(value.items, parseNcmDiscoverCard, "Invalid NCM discover cards payload"),
    hasMore: value.has_more
  };
};

const parseNcmDiscoverCardsResponse = (value: unknown): NcmDiscoverCard[] => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM discover cards response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load NCM discover cards");
  }
  return parseArray(value.items, parseNcmDiscoverCard, "Invalid NCM discover cards payload");
};

const parseNcmDiscoverToplistTrack = (value: unknown): NcmDiscoverToplistTrack | null => {
  if (!isRecord(value) || !isString(value.title) || !isNullableString(value.artist)) {
    return null;
  }
  return {
    title: value.title,
    artist: value.artist
  };
};

const parseNcmDiscoverToplist = (value: unknown): NcmDiscoverToplist | null => {
  const card = parseNcmDiscoverCard(value);
  if (!card || !isRecord(value) || !isNullableString(value.description) || !isBoolean(value.is_official)) {
    return null;
  }
  return {
    ...card,
    description: value.description,
    tracks: parseArray(value.tracks, parseNcmDiscoverToplistTrack, "Invalid NCM discover toplist tracks payload"),
    isOfficial: value.is_official
  };
};

const parseNcmDiscoverToplistsResponse = (value: unknown): NcmDiscoverToplist[] => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM discover toplists response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load NCM discover toplists");
  }
  return parseArray(value.toplists, parseNcmDiscoverToplist, "Invalid NCM discover toplists payload");
};

const parseNcmDiscoverPlaylistCategoryEntry = (value: unknown): NcmDiscoverPlaylistCategoryEntry | null => {
  if (!isRecord(value) || !isString(value.name) || !isInteger(value.category) || !isBoolean(value.hot)) {
    return null;
  }
  return {
    name: value.name,
    category: value.category,
    hot: value.hot
  };
};

const parseNcmDiscoverPlaylistCategoriesResponse = (value: unknown): NcmDiscoverPlaylistCategories => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM discover categories response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load NCM discover categories");
  }
  const categories = isRecord(value.categories) ? value.categories : null;
  if (!categories || !isStringRecord(categories.categories)) {
    throw new Error("Invalid NCM discover categories payload");
  }
  return {
    categories: categories.categories as Record<number, string>,
    entries: parseArray(categories.entries, parseNcmDiscoverPlaylistCategoryEntry, "Invalid NCM discover category entries payload"),
    hqNames: parseArray(categories.hq_names, parseStringItem, "Invalid NCM discover highquality tags payload")
  };
};

const parseNcmHomeFeedResponse = (value: unknown): NcmHomeFeed => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM home feed response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load NCM home feed");
  }
  const feed = isRecord(value.feed) ? value.feed : null;
  if (!feed) {
    throw new Error("Invalid NCM home feed payload");
  }
  const personalFmPreview =
    feed.personal_fm_preview === null
      ? null
      : parseNcmHomePersonalFmPreview(feed.personal_fm_preview);
  if (personalFmPreview === null && feed.personal_fm_preview !== null) {
    throw new Error("Invalid NCM home feed personal FM payload");
  }
  return {
    dailyPicks: parseArray(feed.daily_picks, parseNcmHomeFeedCard, "Invalid NCM home feed daily picks payload"),
    dailySongCovers: parseArray(feed.daily_song_covers, parseNcmHomeTrackCover, "Invalid NCM home feed daily song covers payload"),
    likedSongCovers: parseArray(feed.liked_song_covers, parseNcmHomeTrackCover, "Invalid NCM home feed liked song covers payload"),
    personalFmCovers: parseArray(feed.personal_fm_covers, parseNcmHomeTrackCover, "Invalid NCM home feed personal FM covers payload"),
    personalFmPreview,
    radarPlaylists: parseArray(feed.radar_playlists, parseNcmHomeFeedCard, "Invalid NCM home feed radar payload"),
    recommendedPlaylists: parseArray(feed.recommended_playlists, parseNcmHomeFeedCard, "Invalid NCM home feed playlists payload"),
    newAlbums: parseArray(feed.new_albums, parseNcmHomeFeedCard, "Invalid NCM home feed albums payload"),
    featuredArtists: parseArray(feed.featured_artists, parseNcmHomeFeedCard, "Invalid NCM home feed artists payload"),
    recommendedMvs: parseArray(feed.recommended_mvs, parseNcmHomeFeedCard, "Invalid NCM home feed MVs payload"),
    podcasts: parseArray(feed.podcasts, parseNcmHomeFeedCard, "Invalid NCM home feed podcasts payload"),
    errors: parseArray(feed.errors, parseNcmHomeFeedError, "Invalid NCM home feed errors payload")
  };
};

const parseNcmLikelistIdsResponse = (value: unknown): number[] => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM likelist response shape");
  }
  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to load NCM likelist");
  }
  if (!Array.isArray(value.ids)) {
    throw new Error("Invalid NCM likelist payload");
  }
  const ids = value.ids.filter(isInteger);
  if (ids.length !== value.ids.length) {
    throw new Error("Invalid NCM likelist payload");
  }
  return ids;
};

const buildResolveNcmTrackBody = (input: ResolveNcmTrackInput) => ({
  song_id: input.songId,
  level: input.level ?? null,
  source_page_url: input.sourcePageUrl,
  title: input.title ?? null,
  artist: input.artist ?? null,
  album: input.album ?? null,
  duration_secs: input.durationSecs ?? null,
  artwork_url: input.artworkUrl ?? null
});

const postJson = (body?: object): RequestInit => ({
  method: "POST",
  ...(body ? { body: JSON.stringify(body) } : {})
});

export const createNcmApiClient = (transport: NcmApiTransport): NcmApiClient => ({
  resolveNcmTrack: async (input) =>
    parseResolvedNcmTrackResponse(
      await transport.requestJson("/domain/ncm/track/resolve", postJson(buildResolveNcmTrackBody(input)))
    ),
  playNcmTrack: async (input) =>
    parseNcmTrackPlaybackResponse(
      await transport.requestJson("/domain/ncm/track/play", postJson(buildResolveNcmTrackBody(input))),
      transport.parsePlayerState
    ),
  enqueueNcmTrack: async (input) =>
    parseNcmTrackQueueResponse(
      await transport.requestJson("/domain/ncm/track/enqueue", postJson(buildResolveNcmTrackBody(input)))
    ),
  resolveNcmTrackSupplement: async (songId) =>
    parseResolvedNcmTrackSupplementResponse(
      await transport.requestJson("/domain/ncm/track/supplement", postJson({ song_id: songId }))
    ),
  getNcmAccounts: async () => parseNcmAccountStateResponse(await transport.requestJson("/domain/ncm/accounts")),
  upsertNcmAccount: async (input) =>
    parseNcmAccountStateResponse(
      await transport.requestJson(
        "/domain/ncm/accounts",
        postJson({
          user_id: input.userId,
          nickname: input.nickname ?? null,
          avatar_url: input.avatarUrl ?? null,
          cookie: input.cookie,
          vip_type: input.vipType ?? null,
          level: input.level ?? null,
          signin_at_ms: input.signinAt ?? null
        })
      )
    ),
  setActiveNcmAccount: async (userId) =>
    parseNcmAccountStateResponse(
      await transport.requestJson("/domain/ncm/accounts/active", postJson({ user_id: userId }))
    ),
  refreshActiveNcmAccount: async () =>
    parseNcmAccountStateResponse(await transport.requestJson("/domain/ncm/accounts/refresh", postJson())),
  logoutActiveNcmAccount: async () =>
    parseNcmAccountStateResponse(await transport.requestJson("/domain/ncm/accounts/logout", postJson())),
  dailySigninActiveNcmAccount: async () =>
    parseNcmAccountStateResponse(await transport.requestJson("/domain/ncm/accounts/daily_signin", postJson())),
  deleteNcmAccount: async (userId) =>
    parseNcmAccountStateResponse(
      await transport.requestJson(`/domain/ncm/accounts/${userId}`, {
        method: "DELETE"
      })
    ),
  listNcmUserPlaylists: async (input) =>
    parseNcmUserPlaylistsResponse(
      await transport.requestJson(
        "/domain/ncm/user/playlists",
        postJson({
          uid: input.uid,
          limit: input.limit ?? null,
          offset: input.offset ?? null,
          mode: input.mode ?? null
        })
      )
    ),
  searchNcmTracks: async (input) =>
    parseNcmTracksResponse(
      await transport.requestJson(
        "/domain/ncm/search/tracks",
        postJson({
          keywords: input.keywords,
          limit: input.limit ?? null,
          offset: input.offset ?? null
        })
      )
    ),
  searchNcmPlaylists: async (input) =>
    parseNcmUserPlaylistsResponse(
      await transport.requestJson(
        "/domain/ncm/search/playlists",
        postJson({
          keywords: input.keywords,
          limit: input.limit ?? null,
          offset: input.offset ?? null
        })
      )
    ),
  listNcmPlaylistTracks: async (input) =>
    parseNcmTracksResponse(
      await transport.requestJson(
        "/domain/ncm/playlist/tracks",
        postJson({
          id: input.id,
          limit: input.limit ?? null,
          offset: input.offset ?? null
        })
      )
    ),
  listNcmDailySongTracks: async () =>
    parseNcmTracksResponse(await transport.requestJson("/domain/ncm/recommend/songs/tracks", postJson())),
  listNcmSongDetailTracks: async (ids) =>
    parseNcmTracksResponse(await transport.requestJson("/domain/ncm/song/details/tracks", postJson({ ids }))),
  listNcmPersonalFmTracks: async () =>
    parseNcmTracksResponse(await transport.requestJson("/domain/ncm/personal_fm/tracks", postJson())),
  trashNcmPersonalFmTrack: async (songId) => {
    const response = parseStatusMessage(
      await transport.requestJson("/domain/ncm/personal_fm/trash", postJson({ song_id: songId }))
    );
    if (response.status === "error") {
      throw new Error(response.message ?? "Failed to dislike Personal FM track");
    }
  },
  listNcmAlbumTracks: async (id) =>
    parseNcmTracksResponse(await transport.requestJson("/domain/ncm/album/tracks", postJson({ id }))),
  listNcmArtistTracks: async (id) =>
    parseNcmTracksResponse(await transport.requestJson("/domain/ncm/artist/tracks", postJson({ id }))),
  getNcmLikelistIds: async (uid) =>
    parseNcmLikelistIdsResponse(await transport.requestJson("/domain/ncm/user/likelist", postJson({ uid }))),
  listNcmCloudTracks: async (input) =>
    parseNcmCloudTracksResponse(
      await transport.requestJson(
        "/domain/ncm/user/cloud",
        postJson({
          limit: input.limit ?? null,
          offset: input.offset ?? null
        })
      )
    ),
  deleteNcmCloudTrack: async (songId) => {
    const response = parseStatusMessage(
      await transport.requestJson("/domain/ncm/user/cloud/delete", postJson({ song_id: songId }))
    );
    if (response.status === "error") {
      throw new Error(response.message ?? "Failed to delete NCM cloud track");
    }
  },
  getNcmHomeFeed: async (input) =>
    parseNcmHomeFeedResponse(
      await transport.requestJson(
        "/domain/ncm/home_feed",
        postJson({
          user_id: input?.userId ?? null
        })
      )
    ),
  listNcmDiscoverPlaylists: async (input) =>
    parseNcmDiscoverCardsPageResponse(
      await transport.requestJson(
        "/domain/ncm/discover/playlists",
        postJson({
          cat: input.cat,
          kind: input.kind,
          limit: input.limit ?? null,
          offset: input.offset ?? null,
          before: input.before ?? null
        })
      )
    ),
  listNcmDiscoverAlbums: async (input) =>
    parseNcmDiscoverCardsPageResponse(
      await transport.requestJson(
        "/domain/ncm/discover/albums",
        postJson({
          area: input.area,
          limit: input.limit ?? null,
          offset: input.offset ?? null
        })
      )
    ),
  listNcmDiscoverArtists: async (input) =>
    parseNcmDiscoverCardsResponse(
      await transport.requestJson(
        "/domain/ncm/discover/artists",
        postJson({
          type: input.type,
          area: input.area,
          initial: input.initial,
          limit: input.limit ?? null,
          offset: input.offset ?? null
        })
      )
    ),
  listNcmDiscoverToplists: async () =>
    parseNcmDiscoverToplistsResponse(await transport.requestJson("/domain/ncm/discover/toplists", postJson())),
  listNcmDiscoverSongs: async (input) =>
    parseNcmTracksResponse(
      await transport.requestJson("/domain/ncm/discover/songs", postJson({ type: input.type }))
    ),
  getNcmDiscoverPlaylistCategories: async () =>
    parseNcmDiscoverPlaylistCategoriesResponse(
      await transport.requestJson("/domain/ncm/discover/playlist_categories", postJson())
    )
});

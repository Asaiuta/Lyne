import type {
  ApiClient,
  GetNcmHomeFeedInput,
  ListNcmCloudTracksInput,
  ListNcmDiscoverAlbumsInput,
  ListNcmDiscoverArtistsInput,
  ListNcmDiscoverPlaylistsInput,
  ListNcmDiscoverSongsInput,
  ListNcmPlaylistTracksInput,
  ListNcmUserPlaylistsInput,
  NcmAccountState,
  NcmAccountUpsertInput,
  NcmCloudTracksPage,
  NcmDiscoverAlbumArea,
  NcmDiscoverCard,
  NcmDiscoverCardsPage,
  NcmDiscoverPlaylistCategories,
  NcmDiscoverPlaylistKind,
  NcmDiscoverSongType,
  NcmDiscoverToplist,
  NcmHomeFeed,
  NcmPlaylistSummary,
  NcmTrackPlaybackResult,
  NcmTrackQueueResult,
  NcmTrackSummary,
  NcmUserPlaylistMode,
  ResolveNcmTrackInput,
  ResolvedNcmTrack,
  ResolvedNcmTrackSupplement,
  SearchNcmTracksInput
} from "./client";
import type { ApiStatus } from "./types";
import type { NcmResponseEnvelope } from "./ncm/base";

type Equal<Actual, Expected> =
  (<T>() => T extends Actual ? 1 : 2) extends
  (<T>() => T extends Expected ? 1 : 2)
    ? true
    : false;

type Expect<T extends true> = T;

export type NcmApiMethodContract = [
  Expect<Equal<ApiClient["resolveNcmTrack"], (input: ResolveNcmTrackInput) => Promise<ResolvedNcmTrack>>>,
  Expect<Equal<ApiClient["playNcmTrack"], (input: ResolveNcmTrackInput) => Promise<NcmTrackPlaybackResult>>>,
  Expect<Equal<ApiClient["enqueueNcmTrack"], (input: ResolveNcmTrackInput) => Promise<NcmTrackQueueResult>>>,
  Expect<Equal<ApiClient["resolveNcmTrackSupplement"], (songId: number) => Promise<ResolvedNcmTrackSupplement>>>,
  Expect<Equal<ApiClient["getNcmAccounts"], () => Promise<NcmAccountState>>>,
  Expect<Equal<ApiClient["upsertNcmAccount"], (input: NcmAccountUpsertInput) => Promise<NcmAccountState>>>,
  Expect<Equal<ApiClient["setActiveNcmAccount"], (userId: number) => Promise<NcmAccountState>>>,
  Expect<Equal<ApiClient["refreshActiveNcmAccount"], () => Promise<NcmAccountState>>>,
  Expect<Equal<ApiClient["logoutActiveNcmAccount"], () => Promise<NcmAccountState>>>,
  Expect<Equal<ApiClient["dailySigninActiveNcmAccount"], () => Promise<NcmAccountState>>>,
  Expect<Equal<ApiClient["deleteNcmAccount"], (userId: number) => Promise<NcmAccountState>>>,
  Expect<Equal<ApiClient["listNcmUserPlaylists"], (input: ListNcmUserPlaylistsInput) => Promise<NcmPlaylistSummary[]>>>,
  Expect<Equal<ApiClient["searchNcmTracks"], (input: SearchNcmTracksInput) => Promise<NcmTrackSummary[]>>>,
  Expect<Equal<ApiClient["searchNcmPlaylists"], (input: SearchNcmTracksInput) => Promise<NcmPlaylistSummary[]>>>,
  Expect<Equal<ApiClient["listNcmPlaylistTracks"], (input: ListNcmPlaylistTracksInput) => Promise<NcmTrackSummary[]>>>,
  Expect<Equal<ApiClient["listNcmDailySongTracks"], () => Promise<NcmTrackSummary[]>>>,
  Expect<Equal<ApiClient["listNcmSongDetailTracks"], (ids: number[]) => Promise<NcmTrackSummary[]>>>,
  Expect<Equal<ApiClient["listNcmPersonalFmTracks"], () => Promise<NcmTrackSummary[]>>>,
  Expect<Equal<ApiClient["trashNcmPersonalFmTrack"], (songId: number) => Promise<void>>>,
  Expect<Equal<ApiClient["listNcmAlbumTracks"], (id: number) => Promise<NcmTrackSummary[]>>>,
  Expect<Equal<ApiClient["listNcmArtistTracks"], (id: number) => Promise<NcmTrackSummary[]>>>,
  Expect<Equal<ApiClient["getNcmLikelistIds"], (uid: number) => Promise<number[]>>>,
  Expect<Equal<ApiClient["listNcmCloudTracks"], (input: ListNcmCloudTracksInput) => Promise<NcmCloudTracksPage>>>,
  Expect<Equal<ApiClient["deleteNcmCloudTrack"], (songId: number) => Promise<void>>>,
  Expect<Equal<ApiClient["getNcmHomeFeed"], (input?: GetNcmHomeFeedInput) => Promise<NcmHomeFeed>>>,
  Expect<Equal<ApiClient["listNcmDiscoverPlaylists"], (input: ListNcmDiscoverPlaylistsInput) => Promise<NcmDiscoverCardsPage>>>,
  Expect<Equal<ApiClient["listNcmDiscoverAlbums"], (input: ListNcmDiscoverAlbumsInput) => Promise<NcmDiscoverCardsPage>>>,
  Expect<Equal<ApiClient["listNcmDiscoverArtists"], (input: ListNcmDiscoverArtistsInput) => Promise<NcmDiscoverCard[]>>>,
  Expect<Equal<ApiClient["listNcmDiscoverToplists"], () => Promise<NcmDiscoverToplist[]>>>,
  Expect<Equal<ApiClient["listNcmDiscoverSongs"], (input: ListNcmDiscoverSongsInput) => Promise<NcmTrackSummary[]>>>,
  Expect<Equal<ApiClient["getNcmDiscoverPlaylistCategories"], () => Promise<NcmDiscoverPlaylistCategories>>>
];

export type NcmApiValueContract = [
  Expect<Equal<NcmUserPlaylistMode, "created-playlists" | "collected-playlists">>,
  Expect<Equal<NcmDiscoverPlaylistKind, "normal" | "hq">>,
  Expect<Equal<NcmDiscoverAlbumArea, "ALL" | "ZH" | "EA" | "KR" | "JP">>,
  Expect<Equal<NcmDiscoverSongType, 0 | 7 | 96 | 16 | 8>>
];

type DomainNcmSuccessEnvelope<Payload> = {
  status: Extract<ApiStatus, "success">;
} & Payload;

type DomainNcmErrorEnvelope = {
  status: Extract<ApiStatus, "error">;
  message: string;
};

export const rawNcmProxyWireFixtures = {
  qrAuthorized: {
    code: 803,
    nickname: "Ada",
    avatarUrl: "https://example.test/avatar.jpg",
    cookie: "MUSIC_U=secret"
  },
  rateLimited: {
    code: 503,
    msg: "slow down"
  }
} satisfies Record<string, NcmResponseEnvelope>;

export const domainNcmWireFixtures = {
  tracksSuccess: {
    status: "success",
    tracks: [
      {
        id: "ncm-song-42",
        songId: 42,
        source_path: "https://music.163.com/#/song?id=42",
        title: "Needle",
        artist: "Ada",
        album: null,
        duration_secs: 180,
        artworkUrl: "https://example.test/cover.jpg",
        size_bytes: null
      }
    ]
  },
  accountStateSuccess: {
    status: "success",
    accounts: [
      {
        userId: 42,
        nickname: "Ada",
        avatarUrl: null,
        hasCookie: true,
        vipType: 11,
        level: 8,
        signinAt: null,
        addedAt: 1710000000000,
        refreshedAt: 1710000000001
      }
    ],
    activeUserId: 42
  },
  upstreamError: {
    status: "error",
    message: "login required"
  }
} satisfies {
  tracksSuccess: DomainNcmSuccessEnvelope<{ tracks: NcmTrackSummary[] }>;
  accountStateSuccess: DomainNcmSuccessEnvelope<NcmAccountState>;
  upstreamError: DomainNcmErrorEnvelope;
};

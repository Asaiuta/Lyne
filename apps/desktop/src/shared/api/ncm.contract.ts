import type {
  ApiClient,
  GetNcmHomeFeedInput,
  ListNcmArtistTracksInput,
  ListNcmCloudTracksInput,
  ListNcmDiscoverAlbumsInput,
  ListNcmDiscoverArtistsInput,
  ListNcmDiscoverPlaylistsInput,
  ListNcmDiscoverSongsInput,
  ListNcmPlaylistTracksInput,
  ListNcmUserPlaylistsInput,
  MatchNcmCloudTrackInput,
  NcmAccountState,
  NcmAccountUpsertInput,
  NcmCloudTracksPage,
  NcmDailySongDislikeResult,
  NcmDailySongsResult,
  NcmDiscoverAlbumArea,
  NcmDiscoverCard,
  NcmDiscoverCardsPage,
  NcmDiscoverPlaylistCategories,
  NcmDiscoverPlaylistKind,
  NcmDiscoverSongType,
  NcmDiscoverToplist,
  NcmHomeFeed,
  NcmPlaylistSummary,
  NcmPlaylistTracksUpdateResult,
  NcmTrackPlaybackResult,
  NcmTrackQueueResult,
  NcmTracksPage,
  NcmTrackSummary,
  NcmUserPlaylistMode,
  ResolveNcmTrackInput,
  ResolvedNcmTrack,
  ResolvedNcmTrackSupplement,
  SearchNcmTracksInput,
  UpdateNcmPlaylistTracksInput
} from "./client";
import type { ApiStatus } from "./types";
import type { NcmResponseEnvelope } from "./ncm/base";
import type {
  ConfigureOptimizationsInput,
  ConfigureOutputBitsInput,
  CrossfeedResponse,
  DynamicLoudnessResponse,
  EffectsApiClient,
  NoiseShaperResponse,
  SaturationResponse,
  SetCrossfeedInput,
  SetDynamicLoudnessInput,
  SetEqInput,
  SetEqTypeInput,
  SetNoiseShaperCurveInput,
  SetSaturationInput,
  StatusMessageResponse
} from "./effects";
import type { PlayerState } from "./types";

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
  Expect<
    Equal<
      ApiClient["resolveNcmTrackSupplement"],
      (songId: number, options?: { dynamicCover?: boolean }) => Promise<ResolvedNcmTrackSupplement>
    >
  >,
  Expect<Equal<ApiClient["getNcmAccounts"], () => Promise<NcmAccountState>>>,
  Expect<Equal<ApiClient["upsertNcmAccount"], (input: NcmAccountUpsertInput) => Promise<NcmAccountState>>>,
  Expect<Equal<ApiClient["setActiveNcmAccount"], (userId: number) => Promise<NcmAccountState>>>,
  Expect<Equal<ApiClient["refreshActiveNcmAccount"], () => Promise<NcmAccountState>>>,
  Expect<Equal<ApiClient["logoutActiveNcmAccount"], () => Promise<NcmAccountState>>>,
  Expect<Equal<ApiClient["clearActiveNcmAccount"], () => Promise<NcmAccountState>>>,
  Expect<Equal<ApiClient["dailySigninActiveNcmAccount"], () => Promise<NcmAccountState>>>,
  Expect<Equal<ApiClient["deleteNcmAccount"], (userId: number) => Promise<NcmAccountState>>>,
  Expect<Equal<ApiClient["listNcmUserPlaylists"], (input: ListNcmUserPlaylistsInput) => Promise<NcmPlaylistSummary[]>>>,
  Expect<Equal<ApiClient["searchNcmTracks"], (input: SearchNcmTracksInput) => Promise<NcmTrackSummary[]>>>,
  Expect<Equal<ApiClient["searchNcmPlaylists"], (input: SearchNcmTracksInput) => Promise<NcmPlaylistSummary[]>>>,
  Expect<Equal<ApiClient["getNcmPlaylistDetail"], (id: number) => Promise<NcmPlaylistSummary>>>,
  Expect<Equal<ApiClient["listNcmPlaylistTracks"], (input: ListNcmPlaylistTracksInput) => Promise<NcmTrackSummary[]>>>,
  Expect<Equal<ApiClient["updateNcmPlaylistTracks"], (input: UpdateNcmPlaylistTracksInput) => Promise<NcmPlaylistTracksUpdateResult>>>,
  Expect<Equal<ApiClient["getNcmDailySongs"], () => Promise<NcmDailySongsResult>>>,
  Expect<Equal<ApiClient["listNcmDailySongTracks"], () => Promise<NcmTrackSummary[]>>>,
  Expect<Equal<ApiClient["dislikeNcmDailySong"], (songId: number) => Promise<NcmDailySongDislikeResult>>>,
  Expect<Equal<ApiClient["listNcmSongDetailTracks"], (ids: number[]) => Promise<NcmTrackSummary[]>>>,
  Expect<Equal<ApiClient["listNcmPersonalFmTracks"], () => Promise<NcmTrackSummary[]>>>,
  Expect<Equal<ApiClient["trashNcmPersonalFmTrack"], (songId: number) => Promise<void>>>,
  Expect<Equal<ApiClient["listNcmAlbumTracks"], (id: number) => Promise<NcmTrackSummary[]>>>,
  Expect<Equal<ApiClient["listNcmArtistTracks"], (input: ListNcmArtistTracksInput) => Promise<NcmTracksPage>>>,
  Expect<Equal<ApiClient["getNcmLikelistIds"], (uid: number) => Promise<number[]>>>,
  Expect<Equal<ApiClient["listNcmCloudTracks"], (input: ListNcmCloudTracksInput) => Promise<NcmCloudTracksPage>>>,
  Expect<Equal<ApiClient["deleteNcmCloudTrack"], (songId: number) => Promise<void>>>,
  Expect<Equal<ApiClient["matchNcmCloudTrack"], (input: MatchNcmCloudTrackInput) => Promise<void>>>,
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

export type EffectsApiMethodContract = [
  Expect<Equal<Pick<ApiClient, keyof EffectsApiClient>, EffectsApiClient>>,
  Expect<Equal<ApiClient["setEq"], (input: SetEqInput) => Promise<PlayerState>>>,
  Expect<Equal<ApiClient["setEqType"], (input: SetEqTypeInput) => Promise<StatusMessageResponse>>>,
  Expect<Equal<ApiClient["configureOptimizations"], (input: ConfigureOptimizationsInput) => Promise<PlayerState>>>,
  Expect<Equal<ApiClient["getCrossfeed"], () => Promise<CrossfeedResponse>>>,
  Expect<Equal<ApiClient["setCrossfeed"], (input: SetCrossfeedInput) => Promise<CrossfeedResponse>>>,
  Expect<Equal<ApiClient["getSaturation"], () => Promise<SaturationResponse>>>,
  Expect<Equal<ApiClient["setSaturation"], (input: SetSaturationInput) => Promise<SaturationResponse>>>,
  Expect<Equal<ApiClient["getDynamicLoudness"], () => Promise<DynamicLoudnessResponse>>>,
  Expect<Equal<ApiClient["setDynamicLoudness"], (input: SetDynamicLoudnessInput) => Promise<DynamicLoudnessResponse>>>,
  Expect<Equal<ApiClient["getNoiseShaperCurve"], () => Promise<NoiseShaperResponse>>>,
  Expect<Equal<ApiClient["setNoiseShaperCurve"], (input: SetNoiseShaperCurveInput) => Promise<NoiseShaperResponse>>>,
  Expect<Equal<ApiClient["configureOutputBits"], (input: ConfigureOutputBitsInput) => Promise<StatusMessageResponse>>>
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
        size_bytes: null,
        qualityLabel: "SQ",
        privilegeTag: "VIP",
        explicit: true,
        originalTag: "原",
        mvId: 123,
        isCloud: false
      }
    ]
  },
  dailyDislikeSuccess: {
    status: "success",
    track: null
  },
  playlistDetailSuccess: {
    status: "success",
    playlist: {
      id: 42,
      name: "Late Night Mix",
      userId: 7,
      creatorId: 7,
      creator: "Ada",
      coverUrl: "https://example.test/playlist.jpg",
      trackCount: 12,
      playCount: 345,
      description: "A quiet playlist",
      tags: ["jazz"],
      createTime: 1710000000000,
      updateTime: 1710000001000,
      privacy: 0,
      subscribed: false
    }
  },
  playlistTrackUpdateSuccess: {
    status: "success",
    updated_count: 2
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
  dailyDislikeSuccess: DomainNcmSuccessEnvelope<{ track: NcmTrackSummary | null }>;
  playlistDetailSuccess: DomainNcmSuccessEnvelope<{ playlist: NcmPlaylistSummary }>;
  playlistTrackUpdateSuccess: DomainNcmSuccessEnvelope<{ updated_count: number }>;
  accountStateSuccess: DomainNcmSuccessEnvelope<NcmAccountState>;
  upstreamError: DomainNcmErrorEnvelope;
};

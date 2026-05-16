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
  NcmAccountUpsertInput,
  NcmCloudTracksPage,
  NcmDiscoverCard,
  NcmDiscoverCardsPage,
  NcmDiscoverPlaylistCategories,
  NcmDiscoverToplist,
  NcmHomeFeed,
  NcmPlaylistSummary,
  NcmTrackPlaybackResult,
  NcmTrackQueueResult,
  NcmTrackSummary,
  ResolveNcmTrackInput,
  ResolvedNcmTrack,
  ResolvedNcmTrackSupplement,
  SearchNcmTracksInput
} from "./ncmDomainTypes";
import {
  parseNcmAccountStateResponse,
  parseNcmCloudTracksResponse,
  parseNcmDiscoverCardsPageResponse,
  parseNcmDiscoverCardsResponse,
  parseNcmDiscoverPlaylistCategoriesResponse,
  parseNcmDiscoverToplistsResponse,
  parseNcmHomeFeedResponse,
  parseNcmLikelistIdsResponse,
  parseNcmTrackPlaybackResponse,
  parseNcmTrackQueueResponse,
  parseNcmTracksResponse,
  parseNcmUserPlaylistsResponse,
  parseResolvedNcmTrackResponse,
  parseResolvedNcmTrackSupplementResponse,
  parseStatusMessage
} from "./ncmParsers";
import { buildResolveNcmTrackBody, postJson } from "./ncmRequests";
import type { PlayerState } from "./types";

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

import type {
  GetNcmHomeFeedInput,
  ListNcmCloudTracksInput,
  ListNcmDiscoverAlbumsInput,
  ListNcmDiscoverArtistsInput,
  ListNcmDiscoverPlaylistsInput,
  ListNcmDiscoverSongsInput,
  ListNcmArtistTracksInput,
  ListNcmHeartbeatTracksInput,
  ListNcmPlaylistTracksInput,
  ListNcmUserPlaylistsInput,
  MatchNcmCloudTrackInput,
  NcmAccountState,
  NcmAccountUpsertInput,
  NcmCloudTracksPage,
  NcmDailySongDislikeResult,
  NcmDailySongsResult,
  NcmDiscoverCard,
  NcmDiscoverCardsPage,
  NcmDiscoverPlaylistCategories,
  NcmDiscoverToplist,
  NcmHomeFeed,
  NcmPlaylistSummary,
  NcmPlaylistTracksUpdateResult,
  NcmTrackPlaybackResult,
  NcmTrackQueueResult,
  NcmTracksPage,
  NcmTrackSummary,
  ResolveNcmTrackInput,
  ResolvedNcmTrack,
  ResolvedNcmTrackLyrics,
  ResolvedNcmTrackSupplement,
  SearchNcmTracksInput,
  UpdateNcmPlaylistTracksInput
} from "./ncmDomainTypes";
import {
  parseNcmAccountStateResponse,
  parseNcmCloudTracksResponse,
  parseNcmDailySongDislikeResponse,
  parseNcmDailySongsResponse,
  parseNcmDiscoverCardsPageResponse,
  parseNcmDiscoverCardsResponse,
  parseNcmDiscoverPlaylistCategoriesResponse,
  parseNcmDiscoverToplistsResponse,
  parseNcmHomeFeedResponse,
  parseNcmLikelistIdsResponse,
  parseNcmPlaylistDetailResponse,
  parseNcmPlaylistTracksUpdateResponse,
  parseNcmTrackPlaybackResponse,
  parseNcmTrackQueueResponse,
  parseNcmTracksPageResponse,
  parseNcmTracksResponse,
  parseNcmUserPlaylistsResponse,
  parseResolvedNcmTrackResponse,
  parseResolvedNcmTrackLyricsResponse,
  parseResolvedNcmTrackSupplementResponse,
  parseStatusMessage
} from "./ncmParsers";
import { buildResolveNcmTrackBody, postJson } from "./ncmRequests";
import type { PlayerState } from "./types";

export interface NcmApiClient {
  resolveNcmTrack: (input: ResolveNcmTrackInput) => Promise<ResolvedNcmTrack>;
  playNcmTrack: (input: ResolveNcmTrackInput) => Promise<NcmTrackPlaybackResult>;
  enqueueNcmTrack: (input: ResolveNcmTrackInput) => Promise<NcmTrackQueueResult>;
  resolveNcmTrackSupplement: (
    songId: number,
    options?: { dynamicCover?: boolean }
  ) => Promise<ResolvedNcmTrackSupplement>;
  resolveNcmTrackLyrics: (songId: number) => Promise<ResolvedNcmTrackLyrics>;
  getNcmAccounts: () => Promise<NcmAccountState>;
  upsertNcmAccount: (input: NcmAccountUpsertInput) => Promise<NcmAccountState>;
  setActiveNcmAccount: (userId: number) => Promise<NcmAccountState>;
  refreshActiveNcmAccount: () => Promise<NcmAccountState>;
  logoutActiveNcmAccount: () => Promise<NcmAccountState>;
  clearActiveNcmAccount: () => Promise<NcmAccountState>;
  dailySigninActiveNcmAccount: () => Promise<NcmAccountState>;
  deleteNcmAccount: (userId: number) => Promise<NcmAccountState>;
  listNcmUserPlaylists: (input: ListNcmUserPlaylistsInput) => Promise<NcmPlaylistSummary[]>;
  searchNcmTracks: (input: SearchNcmTracksInput) => Promise<NcmTrackSummary[]>;
  searchNcmPlaylists: (input: SearchNcmTracksInput) => Promise<NcmPlaylistSummary[]>;
  getNcmPlaylistDetail: (id: number) => Promise<NcmPlaylistSummary>;
  listNcmPlaylistTracks: (input: ListNcmPlaylistTracksInput) => Promise<NcmTrackSummary[]>;
  updateNcmPlaylistTracks: (input: UpdateNcmPlaylistTracksInput) => Promise<NcmPlaylistTracksUpdateResult>;
  getNcmDailySongs: () => Promise<NcmDailySongsResult>;
  listNcmDailySongTracks: () => Promise<NcmTrackSummary[]>;
  dislikeNcmDailySong: (songId: number) => Promise<NcmDailySongDislikeResult>;
  listNcmSongDetailTracks: (ids: number[]) => Promise<NcmTrackSummary[]>;
  listNcmPersonalFmTracks: (options?: { signal?: AbortSignal }) => Promise<NcmTrackSummary[]>;
  trashNcmPersonalFmTrack: (songId: number) => Promise<void>;
  listNcmHeartbeatTracks: (input: ListNcmHeartbeatTracksInput) => Promise<NcmTrackSummary[]>;
  listNcmAlbumTracks: (id: number) => Promise<NcmTrackSummary[]>;
  listNcmArtistTracks: (input: ListNcmArtistTracksInput) => Promise<NcmTracksPage>;
  getNcmLikelistIds: (uid: number) => Promise<number[]>;
  listNcmCloudTracks: (input: ListNcmCloudTracksInput) => Promise<NcmCloudTracksPage>;
  deleteNcmCloudTrack: (songId: number) => Promise<void>;
  matchNcmCloudTrack: (input: MatchNcmCloudTrackInput) => Promise<void>;
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
  resolveNcmTrackSupplement: async (songId, options) =>
    parseResolvedNcmTrackSupplementResponse(
      await transport.requestJson(
        "/domain/ncm/track/supplement",
        postJson({ song_id: songId, dynamic_cover: options?.dynamicCover === true })
      )
    ),
  resolveNcmTrackLyrics: async (songId) =>
    parseResolvedNcmTrackLyricsResponse(
      await transport.requestJson("/domain/ncm/track/lyrics", postJson({ song_id: songId }))
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
  clearActiveNcmAccount: async () =>
    parseNcmAccountStateResponse(await transport.requestJson("/domain/ncm/accounts/clear_active", postJson())),
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
  getNcmPlaylistDetail: async (id) =>
    parseNcmPlaylistDetailResponse(
      await transport.requestJson("/domain/ncm/playlist/detail", postJson({ id }))
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
  updateNcmPlaylistTracks: async (input) =>
    parseNcmPlaylistTracksUpdateResponse(
      await transport.requestJson(
        "/domain/ncm/playlist/tracks/update",
        postJson({
          playlist_id: input.playlistId,
          song_ids: input.songIds,
          op: input.op ?? "add"
        })
      )
    ),
  getNcmDailySongs: async () =>
    parseNcmDailySongsResponse(await transport.requestJson("/domain/ncm/recommend/songs/tracks", postJson())),
  listNcmDailySongTracks: async () =>
    parseNcmTracksResponse(await transport.requestJson("/domain/ncm/recommend/songs/tracks", postJson())),
  dislikeNcmDailySong: async (songId) =>
    parseNcmDailySongDislikeResponse(
      await transport.requestJson("/domain/ncm/recommend/songs/dislike", postJson({ song_id: songId }))
    ),
  listNcmSongDetailTracks: async (ids) =>
    parseNcmTracksResponse(await transport.requestJson("/domain/ncm/song/details/tracks", postJson({ ids }))),
  listNcmPersonalFmTracks: async (options) =>
    parseNcmTracksResponse(
      await transport.requestJson("/domain/ncm/personal_fm/tracks", {
        ...postJson(),
        signal: options?.signal
      })
    ),
  trashNcmPersonalFmTrack: async (songId) => {
    const response = parseStatusMessage(
      await transport.requestJson("/domain/ncm/personal_fm/trash", postJson({ song_id: songId }))
    );
    if (response.status === "error") {
      throw new Error(response.message ?? "Failed to dislike Personal FM track");
    }
  },
  listNcmHeartbeatTracks: async (input) =>
    parseNcmTracksResponse(
      await transport.requestJson(
        "/domain/ncm/heartbeat/tracks",
        postJson({
          song_id: input.songId,
          playlist_id: input.playlistId,
          start_song_id: input.startSongId ?? null,
          count: input.count ?? null
        })
      )
    ),
  listNcmAlbumTracks: async (id) =>
    parseNcmTracksResponse(await transport.requestJson("/domain/ncm/album/tracks", postJson({ id }))),
  listNcmArtistTracks: async (input) =>
    parseNcmTracksPageResponse(
      await transport.requestJson(
        "/domain/ncm/artist/tracks",
        postJson({
          id: input.id,
          limit: input.limit ?? null,
          offset: input.offset ?? null,
          order: input.order ?? null
        })
      )
    ),
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
  matchNcmCloudTrack: async (input) => {
    const response = parseStatusMessage(
      await transport.requestJson(
        "/domain/ncm/user/cloud/match",
        postJson({
          user_id: input.userId,
          song_id: input.songId,
          adjust_song_id: input.adjustSongId
        })
      )
    );
    if (response.status === "error") {
      throw new Error(response.message ?? "Failed to match NCM cloud track");
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

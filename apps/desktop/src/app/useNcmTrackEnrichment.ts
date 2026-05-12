import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import {
  findCurrentLyricLine,
  mergeNcmTrackReference,
  type NcmLyricLine,
  type NcmTrackReference,
  type NcmTrackSupplement
} from "../features/online/ncmPlayback";
import { likeSong } from "../shared/api/ncm/user";
import type { ApiClient } from "../shared/api/client";
import type { PlayerState } from "../shared/api/types";
import { useNcmAccount } from "../shared/state/NcmAccountContext";
import {
  firstNonEmpty,
  mediaKeyForPath,
  readErrorMessage
} from "./controllerHelpers";

export interface NcmTrackEnrichment {
  currentTrackRef: Accessor<NcmTrackReference | undefined>;
  currentNcmSongId: Accessor<number | null>;
  currentNcmCoverUrl: Accessor<string | null>;
  resolvedCoverUrl: Accessor<string | null>;
  currentLyricLines: Accessor<readonly NcmLyricLine[]>;
  currentInlineLyric: Accessor<string | null>;
  fullPlayerTitle: Accessor<string>;
  fullPlayerSubtitle: Accessor<string>;
  fullPlayerDetail: Accessor<string | null>;
  lyricStatus: Accessor<"idle" | "loading" | "ready" | "error">;
  currentNcmSupplement: Accessor<NcmTrackSupplement | null>;
  currentIsLiked: Accessor<boolean>;
  registerNcmPlayback: (track: NcmTrackReference) => void;
  handleToggleLike: () => Promise<void>;
}

interface NcmTrackEnrichmentDeps {
  api: ApiClient;
  player: Accessor<PlayerState | null>;
  livePosition: Accessor<number | null>;
  coverUrl: Accessor<string | null>;
}

interface SupplementRequest {
  key: string;
  trackRef: NcmTrackReference | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  coverUrl: string | null;
}

const sameSupplementRequest = (
  previous: SupplementRequest | null,
  next: SupplementRequest | null
) => previous?.key === next?.key;

const ncmSongPageUrl = (songId: number): string => `https://music.163.com/#/song?id=${songId}`;

/**
 * Owns NCM-side track metadata that hangs off the currently-playing track:
 * the track reference dictionary, the on-demand song/lyric supplement,
 * the resolved cover URL (NCM preferred → fallback local), the full-player
 * display strings, and the liked-songs membership.
 *
 * Extracted from useAppController so the player/queue orchestrator does
 * not need to own NCM-specific concerns.
 */
export function useNcmTrackEnrichment(deps: NcmTrackEnrichmentDeps): NcmTrackEnrichment {
  const { api, player, livePosition, coverUrl } = deps;
  const accountStore = useNcmAccount();

  const [ncmTrackRefs, setNcmTrackRefs] = createSignal<Record<string, NcmTrackReference>>({});
  const [currentNcmSupplement, setCurrentNcmSupplement] =
    createSignal<NcmTrackSupplement | null>(null);
  const [likedSongIds, setLikedSongIds] = createSignal<Set<number>>(new Set());

  const currentPlayerPath = createMemo(() => player()?.file_path ?? null);
  const currentPlayerTitle = createMemo(() => player()?.title ?? null);
  const currentPlayerArtist = createMemo(() => player()?.artist ?? null);
  const currentPlayerAlbum = createMemo(() => player()?.album ?? null);
  const currentPlayerCoverUrl = createMemo(() => player()?.external_artwork_url ?? null);
  const currentPlayerTime = createMemo(() => player()?.current_time ?? 0);
  const currentPlayerDuration = createMemo(() => player()?.duration ?? null);
  const currentPlayerNcmSongId = createMemo(() => player()?.ncm_song_id ?? null);
  const currentPlayerNcmSourcePageUrl = createMemo(() => player()?.ncm_source_page_url ?? null);

  const currentTrackRef = createMemo(() => {
    const path = currentPlayerPath();
    if (!path) return undefined;
    const refs = ncmTrackRefs();
    const registeredRef = refs[path] ?? refs[mediaKeyForPath(path) ?? ""] ?? undefined;
    if (registeredRef) {
      return registeredRef;
    }

    const songId = currentPlayerNcmSongId();
    if (songId === null) {
      return undefined;
    }

    return {
      songId,
      streamUrl: path,
      sourcePageUrl: currentPlayerNcmSourcePageUrl() ?? ncmSongPageUrl(songId),
      title: currentPlayerTitle(),
      artist: currentPlayerArtist(),
      album: currentPlayerAlbum(),
      coverUrl: currentPlayerCoverUrl(),
      durationSecs: currentPlayerDuration()
    };
  });
  const currentNcmSongId = createMemo(() => currentTrackRef()?.songId ?? null);
  const currentNcmCoverUrl = createMemo(
    () => firstNonEmpty(currentNcmSupplement()?.coverUrl, currentTrackRef()?.coverUrl)
  );
  const resolvedCoverUrl = createMemo(() =>
    firstNonEmpty(currentNcmCoverUrl(), currentPlayerCoverUrl(), coverUrl())
  );
  const currentLyricLines = createMemo(() => currentNcmSupplement()?.lyrics ?? []);
  const currentInlineLyric = createMemo(() =>
    findCurrentLyricLine(currentLyricLines(), livePosition() ?? currentPlayerTime())
  );
  const fullPlayerTitle = createMemo(
    () =>
      firstNonEmpty(
        currentNcmSupplement()?.title,
        currentTrackRef()?.title,
        currentPlayerTitle()
      ) ??
      currentPlayerPath() ??
      ""
  );
  const fullPlayerSubtitle = createMemo(() =>
    [
      firstNonEmpty(
        currentNcmSupplement()?.artist,
        currentTrackRef()?.artist,
        currentPlayerArtist()
      ),
      firstNonEmpty(
        currentNcmSupplement()?.album,
        currentTrackRef()?.album,
        currentPlayerAlbum()
      )
    ]
      .filter(Boolean)
      .join(" · ")
  );
  const fullPlayerDetail = createMemo(() =>
    currentTrackRef() && currentNcmSongId() !== null ? `NCM · ID ${currentNcmSongId()}` : null
  );
  const lyricStatus = createMemo<"idle" | "loading" | "ready" | "error">(() => {
    const supplement = currentNcmSupplement();
    if (supplement === null) return "idle";
    if (supplement.status === "loading") return "loading";
    if (supplement.status === "error") return "error";
    return "ready";
  });

  const registerNcmPlayback = (track: NcmTrackReference) => {
    const normalizedKey = mediaKeyForPath(track.streamUrl);
    setNcmTrackRefs((current) => ({
      ...current,
      [track.streamUrl]: mergeNcmTrackReference(current[track.streamUrl], track),
      ...(normalizedKey
        ? {
            [normalizedKey]: mergeNcmTrackReference(current[normalizedKey], track)
          }
        : {})
    }));
  };

  const supplementRequest = createMemo<SupplementRequest | null>(
    () => {
      const trackRef = currentTrackRef();
      const mediaKey = mediaKeyForPath(trackRef?.streamUrl ?? currentPlayerPath());
      if (!mediaKey) {
        return null;
      }
      const title = firstNonEmpty(trackRef?.title, currentPlayerTitle());
      const artist = firstNonEmpty(trackRef?.artist, currentPlayerArtist());
      const album = firstNonEmpty(trackRef?.album, currentPlayerAlbum());
      const requestCoverUrl = firstNonEmpty(trackRef?.coverUrl, currentPlayerCoverUrl());
      const key = [
        trackRef ? `ncm:${trackRef.songId}` : `media:${mediaKey}`,
        title ?? "",
        artist ?? "",
        album ?? "",
        requestCoverUrl ?? ""
      ].join("|");

      return {
        key,
        trackRef: trackRef ?? null,
        title,
        artist,
        album,
        coverUrl: requestCoverUrl
      };
    },
    null,
    { equals: sameSupplementRequest }
  );

  createEffect(() => {
    const request = supplementRequest();
    if (request === null) {
      setCurrentNcmSupplement(null);
      return;
    }

    let cancelled = false;

    setCurrentNcmSupplement({
      status: "loading",
      title: request.title,
      artist: request.artist,
      album: request.album,
      coverUrl: request.coverUrl,
      lyrics: [],
      error: null
    });

    const fetchSupplement = request.trackRef
      ? Promise.allSettled([
          api.resolveNcmTrackSupplement(request.trackRef.songId),
          api.getCurrentLyrics()
        ])
      : Promise.allSettled([api.getCurrentLyrics()]);

    void fetchSupplement.then((results) => {
      if (cancelled) {
        return;
      }

      if (request.trackRef) {
        const [supplementResult, localLyricResult] = results as [
          PromiseSettledResult<Awaited<ReturnType<ApiClient["resolveNcmTrackSupplement"]>>>,
          PromiseSettledResult<Awaited<ReturnType<ApiClient["getCurrentLyrics"]>>>
        ];

        const onlineLyrics =
          supplementResult.status === "fulfilled"
            ? supplementResult.value.lyrics
            : [];
        const localLyrics =
          localLyricResult.status === "fulfilled"
            ? localLyricResult.value.lyrics
            : [];
        const lyrics = onlineLyrics.length > 0 ? onlineLyrics : localLyrics;
        const error =
          supplementResult.status === "rejected"
            ? readErrorMessage(supplementResult.reason)
            : supplementResult.value.detailError ??
              supplementResult.value.lyricsError ??
              (localLyricResult.status === "rejected"
                ? readErrorMessage(localLyricResult.reason)
                : null);
        const resolvedSupplement =
          supplementResult.status === "fulfilled" ? supplementResult.value : null;
        const hasRemoteSupplement =
          Boolean(resolvedSupplement?.title) ||
          Boolean(resolvedSupplement?.artist) ||
          Boolean(resolvedSupplement?.album) ||
          Boolean(resolvedSupplement?.coverUrl);

        setCurrentNcmSupplement({
          status: error && !hasRemoteSupplement && lyrics.length === 0 ? "error" : "success",
          title: resolvedSupplement?.title ?? request.trackRef.title,
          artist: resolvedSupplement?.artist ?? request.trackRef.artist,
          album: resolvedSupplement?.album ?? request.trackRef.album,
          coverUrl: resolvedSupplement?.coverUrl ?? request.trackRef.coverUrl,
          lyrics,
          error
        });
        return;
      }

      const [localLyricResult] = results as [
        PromiseSettledResult<Awaited<ReturnType<ApiClient["getCurrentLyrics"]>>>
      ];
      const localLyrics =
        localLyricResult.status === "fulfilled"
          ? localLyricResult.value.lyrics
          : [];
      const error =
        localLyricResult.status === "rejected" ? readErrorMessage(localLyricResult.reason) : null;

      setCurrentNcmSupplement({
        status: error && localLyrics.length === 0 ? "error" : "success",
        title: request.title,
        artist: request.artist,
        album: request.album,
        coverUrl: request.coverUrl,
        lyrics: localLyrics,
        error
      });
    });

    onCleanup(() => {
      cancelled = true;
    });
  });

  createEffect(() => {
    const account = accountStore.activeAccount();
    const userId = account?.hasCookie ? account.userId : null;
    let cancelled = false;

    if (userId === null) {
      setLikedSongIds(new Set<number>());
      return;
    }

    void (async () => {
      try {
        const idList = await api.getNcmLikelistIds(userId);
        if (!cancelled) {
          setLikedSongIds(new Set(idList));
        }
      } catch {
        if (!cancelled) {
          setLikedSongIds(new Set<number>());
        }
      }
    })();

    onCleanup(() => {
      cancelled = true;
    });
  });

  const currentIsLiked = createMemo(() => {
    const songId = currentNcmSongId();
    return songId !== null && likedSongIds().has(songId);
  });

  const handleToggleLike = async () => {
    const songId = currentNcmSongId();
    if (songId === null) return;
    const wasLiked = likedSongIds().has(songId);
    try {
      await likeSong(songId, !wasLiked);
      setLikedSongIds((prev) => {
        const next = new Set(prev);
        if (wasLiked) {
          next.delete(songId);
        } else {
          next.add(songId);
        }
        return next;
      });
    } catch {
      // Best effort.
    }
  };

  return {
    currentTrackRef,
    currentNcmSongId,
    currentNcmCoverUrl,
    resolvedCoverUrl,
    currentLyricLines,
    currentInlineLyric,
    fullPlayerTitle,
    fullPlayerSubtitle,
    fullPlayerDetail,
    lyricStatus,
    currentNcmSupplement,
    currentIsLiked,
    registerNcmPlayback,
    handleToggleLike
  };
}

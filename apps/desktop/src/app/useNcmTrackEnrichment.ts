import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import {
  mergeNcmTrackReference,
  type NcmLyricLine,
  type NcmTrackReference,
  type NcmTrackSupplement
} from "../features/online/ncmPlayback";
import { findCurrentLyricLine } from "../shared/media/lyrics";
import { likeSong } from "../shared/api/ncm/user";
import { ncmSongPageUrl } from "../shared/api/ncm/urls";
import type { ApiClient } from "../shared/api/client";
import type { PlayerState } from "../shared/api/types";
import { useNcmAccount } from "../shared/state/NcmAccountContext";
import type { LyricPriority } from "../shared/state/uiSettingsModel";
import { mediaKeyForPath } from "../shared/media/mediaIdentity";
import { firstNonEmpty, readErrorMessage } from "./controllerHelpers";
import { resolveCurrentCoverUrl } from "./ncmCoverResolution";

export interface NcmTrackEnrichment {
  currentTrackRef: Accessor<NcmTrackReference | undefined>;
  currentNcmSongId: Accessor<number | null>;
  currentNcmCoverUrl: Accessor<string | null>;
  resolvedCoverUrl: Accessor<string | null>;
  currentLyricLines: Accessor<readonly NcmLyricLine[]>;
  currentInlineLyric: Accessor<string | null>;
  fullPlayerTitle: Accessor<string>;
  fullPlayerArtist: Accessor<string | null>;
  fullPlayerAlbum: Accessor<string | null>;
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
  dynamicCoverEnabled?: Accessor<boolean>;
  localLyricDirectories?: Accessor<readonly string[]>;
  lyricPriority?: Accessor<LyricPriority>;
}

interface SupplementRequest {
  key: string;
  trackRef: NcmTrackReference | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  coverUrl: string | null;
  dynamicCover: boolean;
  lyricDirs: readonly string[];
  lyricPriority: LyricPriority;
}

type CurrentNcmSupplement = NcmTrackSupplement & {
  requestKey: string;
};

const sameSupplementRequest = (
  previous: SupplementRequest | null,
  next: SupplementRequest | null
) => previous?.key === next?.key;

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
  const dynamicCoverEnabled = deps.dynamicCoverEnabled ?? (() => false);
  const localLyricDirectories = deps.localLyricDirectories ?? (() => []);
  const lyricPriority = deps.lyricPriority ?? (() => "auto");
  const accountStore = useNcmAccount();

  const [ncmTrackRefs, setNcmTrackRefs] = createSignal<Record<string, NcmTrackReference>>({});
  const [currentNcmSupplement, setCurrentNcmSupplement] =
    createSignal<CurrentNcmSupplement | null>(null);
  const [likedSongIds, setLikedSongIds] = createSignal<Set<number>>(new Set());

  const updateCurrentSupplement = (
    requestKey: string,
    updater: (current: CurrentNcmSupplement) => CurrentNcmSupplement
  ) => {
    setCurrentNcmSupplement((current) => {
      if (current?.requestKey !== requestKey) {
        return current;
      }
      return updater(current);
    });
  };

  const currentPlayerPath = createMemo(() => player()?.file_path ?? null);
  const currentPlayerTitle = createMemo(() => player()?.title ?? null);
  const currentPlayerArtist = createMemo(() => player()?.artist ?? null);
  const currentPlayerAlbum = createMemo(() => player()?.album ?? null);
  const currentPlayerCoverUrl = createMemo(() => player()?.external_artwork_url ?? null);
  const currentPlayerTime = createMemo(() => player()?.current_time ?? 0);
  const currentPlayerDuration = createMemo(() => player()?.duration ?? null);
  const currentPlayerIsLoading = createMemo(() => player()?.is_loading ?? false);
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
  const normalizedLocalLyricDirectories = createMemo(() =>
    Array.from(
      new Set(
        localLyricDirectories()
          .map((dir) => dir.trim())
          .filter((dir) => dir.length > 0)
      )
    )
  );

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
      const dynamicCover = Boolean(trackRef) && dynamicCoverEnabled();
      const lyricDirs = trackRef ? normalizedLocalLyricDirectories() : [];
      const requestLyricPriority = lyricPriority();
      const key = [
        trackRef ? `ncm:${trackRef.songId}` : `media:${mediaKey}`,
        dynamicCover ? "dynamic-cover" : "static-cover",
        `lyrics:${lyricDirs.join("\u0000")}`,
        `lyric-priority:${requestLyricPriority}`,
        currentPlayerIsLoading() ? "loading" : "ready",
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
        coverUrl: requestCoverUrl,
        dynamicCover,
        lyricDirs,
        lyricPriority: requestLyricPriority
      };
    },
    null,
    { equals: sameSupplementRequest }
  );
  const currentSupplementForRequest = createMemo(() => {
    const supplement = currentNcmSupplement();
    const request = supplementRequest();
    return supplement?.requestKey === request?.key ? supplement : null;
  });
  const currentNcmCoverUrl = createMemo(() =>
    resolveCurrentCoverUrl(
      supplementRequest(),
      currentNcmSupplement(),
      currentPlayerCoverUrl(),
      null,
      { preferDynamicCover: false }
    )
  );
  const resolvedCoverUrl = createMemo(() =>
    resolveCurrentCoverUrl(
      supplementRequest(),
      currentNcmSupplement(),
      currentPlayerCoverUrl(),
      coverUrl()
    )
  );
  const currentLyricLines = createMemo(() => currentSupplementForRequest()?.lyrics ?? []);
  const currentInlineLyric = createMemo(() =>
    findCurrentLyricLine(currentLyricLines(), livePosition() ?? currentPlayerTime())
  );
  const fullPlayerTitle = createMemo(
    () =>
      firstNonEmpty(
        currentSupplementForRequest()?.title,
        currentTrackRef()?.title,
        currentPlayerTitle()
      ) ??
      currentPlayerPath() ??
      ""
  );
  const fullPlayerArtist = createMemo(() =>
    firstNonEmpty(
      currentSupplementForRequest()?.artist,
      currentTrackRef()?.artist,
      currentPlayerArtist()
    )
  );
  const fullPlayerAlbum = createMemo(() =>
    firstNonEmpty(
      currentSupplementForRequest()?.album,
      currentTrackRef()?.album,
      currentPlayerAlbum()
    )
  );
  const fullPlayerSubtitle = createMemo(() =>
    [fullPlayerArtist(), fullPlayerAlbum()]
      .filter(Boolean)
      .join(" · ")
  );
  const fullPlayerDetail = createMemo(() =>
    currentTrackRef() && currentNcmSongId() !== null ? `NCM · ID ${currentNcmSongId()}` : null
  );
  const lyricStatus = createMemo<"idle" | "loading" | "ready" | "error">(() => {
    const supplement = currentSupplementForRequest();
    if (supplement === null) return "idle";
    if (supplement.status === "loading") return "loading";
    if (supplement.status === "error") return "error";
    return "ready";
  });

  createEffect(() => {
    const request = supplementRequest();
    if (request === null) {
      setCurrentNcmSupplement(null);
      return;
    }

    let cancelled = false;

    setCurrentNcmSupplement({
      requestKey: request.key,
      status: "loading",
      title: request.title,
      alias: null,
      artist: request.artist,
      artists: [],
      album: request.album,
      albumId: null,
      coverUrl: request.coverUrl,
      dynamicCoverUrl: null,
      lyrics: [],
      lyricSource: null,
      error: null
    });

    if (request.trackRef) {
      const trackRef = request.trackRef;
      let hasLocalOverrideLyrics = false;
      const canDisplayOfficialEarly =
        request.lyricPriority === "official" || request.lyricDirs.length === 0;
      const supplementPromise = api.resolveNcmTrackSupplement(trackRef.songId, {
        dynamicCover: request.dynamicCover
      });
      const ncmLyricsPromise = api.resolveNcmTrackLyrics(trackRef.songId);
      const localLyricsPromise = api.getCurrentLyrics({
        songId: trackRef.songId,
        lyricDirs: request.lyricDirs
      });

      void ncmLyricsPromise
        .then((result) => {
          if (cancelled || result.songId !== trackRef.songId || result.lyrics.length === 0) {
            return;
          }
          if (hasLocalOverrideLyrics) {
            return;
          }
          if (!canDisplayOfficialEarly) {
            return;
          }
          updateCurrentSupplement(request.key, (current) => ({
            ...current,
            status: "success",
            lyrics: result.lyrics,
            lyricSource: "official"
          }));
        })
        .catch(() => {
          // The final allSettled pass records the error only if no usable lyric path wins.
        });

      void localLyricsPromise
        .then((result) => {
          if (cancelled || result.lyrics.length === 0) {
            return;
          }
          const isLocalOverride = result.source?.startsWith("local-override:") === true;
          if (isLocalOverride) {
            hasLocalOverrideLyrics = true;
          }
          updateCurrentSupplement(request.key, (current) => {
            if (!isLocalOverride && current.lyrics.length > 0) {
              return current;
            }
            return {
              ...current,
              status: "success",
              lyrics: result.lyrics,
              lyricSource: result.source
            };
          });
        })
        .catch(() => {
          // The final allSettled pass handles the rejected local lookup.
        });

      void Promise.allSettled([supplementPromise, ncmLyricsPromise, localLyricsPromise]).then((results) => {
        if (cancelled) {
          return;
        }

        const [supplementResult, ncmLyricResult, localLyricResult] = results as [
          PromiseSettledResult<Awaited<ReturnType<ApiClient["resolveNcmTrackSupplement"]>>>,
          PromiseSettledResult<Awaited<ReturnType<ApiClient["resolveNcmTrackLyrics"]>>>,
          PromiseSettledResult<Awaited<ReturnType<ApiClient["getCurrentLyrics"]>>>
        ];

        const ncmLyrics =
          ncmLyricResult.status === "fulfilled" ? ncmLyricResult.value.lyrics : [];
        const localLyrics =
          localLyricResult.status === "fulfilled" ? localLyricResult.value.lyrics : [];
        const localOverrideLyrics =
          localLyricResult.status === "fulfilled" &&
          localLyricResult.value.source?.startsWith("local-override:")
            ? localLyrics
            : [];
        const resolvedLyricSource =
          localOverrideLyrics.length > 0
            ? localLyricResult.status === "fulfilled"
              ? localLyricResult.value.source
              : null
            : ncmLyrics.length > 0
              ? "official"
              : localLyrics.length > 0 && localLyricResult.status === "fulfilled"
                ? localLyricResult.value.source
                : null;
        const resolvedLyrics =
          localOverrideLyrics.length > 0
            ? localOverrideLyrics
            : ncmLyrics.length > 0
              ? ncmLyrics
              : localLyrics;
        const error =
          supplementResult.status === "rejected"
            ? readErrorMessage(supplementResult.reason)
            : supplementResult.value.detailError ??
              supplementResult.value.dynamicCoverError ??
              (ncmLyricResult.status === "rejected"
                ? readErrorMessage(ncmLyricResult.reason)
                : null) ??
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

        updateCurrentSupplement(request.key, (current) => {
          const lyrics = resolvedLyrics.length > 0 ? resolvedLyrics : current.lyrics;
          const nextLyricSource =
            resolvedLyrics.length > 0 ? resolvedLyricSource : current.lyricSource;
          return {
            requestKey: request.key,
            status: error && !hasRemoteSupplement && lyrics.length === 0 ? "error" : "success",
            title: resolvedSupplement?.title ?? trackRef.title,
            alias: resolvedSupplement?.alias ?? null,
            artist: resolvedSupplement?.artist ?? trackRef.artist,
            artists: resolvedSupplement?.artists ?? [],
            album: resolvedSupplement?.album ?? trackRef.album,
            albumId: resolvedSupplement?.albumId ?? null,
            coverUrl: resolvedSupplement?.coverUrl ?? trackRef.coverUrl,
            dynamicCoverUrl: resolvedSupplement?.dynamicCoverUrl ?? null,
            lyrics,
            lyricSource: nextLyricSource,
            error
          };
        });
      });
    } else {
      const fetchSupplement = Promise.allSettled([api.getCurrentLyrics()]);

      void fetchSupplement.then((results) => {
        if (cancelled) {
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
          requestKey: request.key,
          status: error && localLyrics.length === 0 ? "error" : "success",
          title: request.title,
          alias: null,
          artist: request.artist,
          artists: [],
          album: request.album,
          albumId: null,
          coverUrl: request.coverUrl,
          dynamicCoverUrl: null,
          lyrics: localLyrics,
          lyricSource:
            localLyrics.length > 0 && localLyricResult.status === "fulfilled"
              ? localLyricResult.value.source
              : null,
          error
        });
      });
    }

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
      } catch (error) {
        console.warn("[useNcmTrackEnrichment] failed to load liked song ids", error);
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
    } catch (error) {
      console.warn("[useNcmTrackEnrichment] like toggle failed", { songId, wanted: !wasLiked, error });
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
    fullPlayerArtist,
    fullPlayerAlbum,
    fullPlayerSubtitle,
    fullPlayerDetail,
    lyricStatus,
    currentNcmSupplement,
    currentIsLiked,
    registerNcmPlayback,
    handleToggleLike
  };
}

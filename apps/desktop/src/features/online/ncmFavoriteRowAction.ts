import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import { createApiClient } from "../../shared/api/client";
import { assertNcmOk } from "../../shared/api/ncm";
import { likeSong } from "../../shared/api/ncm/user";
import { useTranslation } from "../../shared/i18n";
import { useNcmAccount } from "../../shared/state/NcmAccountContext";
import { message } from "../../shared/ui/naive";
import type { MediaListItem } from "../../shared/media/mediaListItem";
import type { MediaRowAction } from "../../components/media/mediaListTypes";

const ncmFavoriteApi = createApiClient();
const likedSongIdsByUser = new Map<number, ReadonlySet<number>>();

const readErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;

export function createNcmFavoriteRowAction<T extends MediaListItem>(): Accessor<MediaRowAction<T>> {
  const { t } = useTranslation();
  const accountStore = useNcmAccount();
  const [likedSongIds, setLikedSongIds] = createSignal<ReadonlySet<number>>(new Set<number>());
  const [busyLikedSongIds, setBusyLikedSongIds] = createSignal<ReadonlySet<number>>(new Set<number>());

  const setSongLiked = (songId: number, liked: boolean) => {
    setLikedSongIds((current) => {
      const next = new Set(current);
      if (liked) {
        next.add(songId);
      } else {
        next.delete(songId);
      }
      const account = accountStore.activeAccount();
      if (account?.hasCookie === true) {
        likedSongIdsByUser.set(account.userId, next);
      }
      return next;
    });
  };

  const setSongLikeBusy = (songId: number, busy: boolean) => {
    setBusyLikedSongIds((current) => {
      const next = new Set(current);
      if (busy) {
        next.add(songId);
      } else {
        next.delete(songId);
      }
      return next;
    });
  };

  const handleToggleFavorite = async (item: T, nextFavorite: boolean) => {
    const account = accountStore.activeAccount();
    if (!account) {
      message.warning(t("media.favorite.loginRequired"));
      return;
    }
    if (!account.hasCookie) {
      message.warning(t("media.favorite.unsupportedLoginMode"));
      return;
    }
    if (typeof item.songId !== "number") {
      message.warning(t("media.favorite.unsupportedSong"));
      return;
    }

    const songId = item.songId;
    if (busyLikedSongIds().has(songId)) return;
    const wasLiked = likedSongIds().has(songId);
    setSongLiked(songId, nextFavorite);
    setSongLikeBusy(songId, true);
    try {
      const result = await likeSong(songId, nextFavorite);
      assertNcmOk(result, t("media.favorite.failed"));
      message.success(t(nextFavorite ? "media.favorite.added" : "media.favorite.removed"));
    } catch (error) {
      setSongLiked(songId, wasLiked);
      message.error(readErrorMessage(error, t("media.favorite.failed")));
    } finally {
      setSongLikeBusy(songId, false);
    }
  };

  createEffect(() => {
    const account = accountStore.activeAccount();
    const userId = account?.hasCookie === true ? account.userId : null;
    let cancelled = false;

    if (userId === null) {
      setLikedSongIds(new Set<number>());
      return;
    }

    const cached = likedSongIdsByUser.get(userId);
    if (cached) {
      setLikedSongIds(cached);
    }

    void (async () => {
      try {
        const ids = await ncmFavoriteApi.getNcmLikelistIds(userId);
        if (!cancelled) {
          const next = new Set(ids);
          likedSongIdsByUser.set(userId, next);
          setLikedSongIds(next);
        }
      } catch (error) {
        console.warn("[NcmMediaList] load liked song ids failed", error);
        if (!cancelled && !cached) {
          setLikedSongIds(new Set<number>());
        }
      }
    })();

    onCleanup(() => {
      cancelled = true;
    });
  });

  return createMemo<MediaRowAction<T>>(() => ({
    kind: "favorite",
    isActive: (item) => typeof item.songId === "number" && likedSongIds().has(item.songId),
    isBusy: (item) => typeof item.songId === "number" && busyLikedSongIds().has(item.songId),
    onToggle: (item, nextFavorite) => void handleToggleFavorite(item, nextFavorite),
    activeLabel: t("media.favorite.unlike"),
    inactiveLabel: t("media.favorite.like")
  }));
}

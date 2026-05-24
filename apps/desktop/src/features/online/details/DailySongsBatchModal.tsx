import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import { CreatePlaylistModal } from "../../../components/CreatePlaylistModal";
import { IconPlaylist, IconPlus, IconQueueAdd } from "../../../components/icons";
import { Modal } from "../../../components/Modal";
import { SImage } from "../../../components/SImage";
import { createApiClient } from "../../../shared/api/client";
import { useTranslation } from "../../../shared/i18n";
import type { NcmPlaylistSummary } from "../../../shared/api/client";
import type { FeedbackSetter } from "../shared/feedback";
import { createErrorMessageReader } from "../shared/feedback";
import type { PlaybackController } from "../shared/playback";
import type { NcmProfile, OnlineTrackItem } from "../shared/types";
import {
  loadNcmUserPlaylistsByModeCached,
  refreshNcmUserPlaylistGroupsCache,
  subscribeNcmUserPlaylistGroups
} from "../ncmPlaylistSummaryCache";

interface DailySongsBatchModalProps {
  open: boolean;
  title?: string;
  items: readonly OnlineTrackItem[];
  loginProfile: NcmProfile | null;
  playback: PlaybackController;
  sourcePlaylistId?: number;
  onClose: () => void;
  onTracksRemoved?: (songIds: readonly number[]) => void;
  setFeedback: FeedbackSetter;
}

const api = createApiClient();

export function DailySongsBatchModal(props: DailySongsBatchModalProps) {
  const { t } = useTranslation();
  const readErrorMessage = createErrorMessageReader(t);
  const [checkedIds, setCheckedIds] = createSignal<string[]>([]);
  const [rangeOpen, setRangeOpen] = createSignal<boolean>(false);
  const [rangeStart, setRangeStart] = createSignal<string>("");
  const [rangeEnd, setRangeEnd] = createSignal<string>("");
  const [playlists, setPlaylists] = createSignal<NcmPlaylistSummary[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = createSignal<boolean>(false);
  const [submittingPlaylistId, setSubmittingPlaylistId] = createSignal<number | null>(null);
  const [enqueueing, setEnqueueing] = createSignal<boolean>(false);
  const [deleting, setDeleting] = createSignal<boolean>(false);
  const [createPlaylistOpen, setCreatePlaylistOpen] = createSignal<boolean>(false);

  createEffect(() => {
    if (props.open) return;
    setCheckedIds([]);
    setRangeOpen(false);
    setRangeStart("");
    setRangeEnd("");
    setSubmittingPlaylistId(null);
    setEnqueueing(false);
    setDeleting(false);
    setCreatePlaylistOpen(false);
  });

  const loadCreatedPlaylists = (userId: number): Promise<NcmPlaylistSummary[]> =>
    loadNcmUserPlaylistsByModeCached(api, userId, "created-playlists");

  createEffect(on(
    () => [props.open, props.loginProfile?.userId] as const,
    ([open, userId]) => {
      if (!open || userId === undefined) {
        setPlaylists([]);
        return;
      }
      let cancelled = false;
      const unsubscribe = subscribeNcmUserPlaylistGroups(userId, (groups) => {
        setPlaylists(groups.created);
      });
      setLoadingPlaylists(true);
      void loadCreatedPlaylists(userId).then((result) => {
        if (!cancelled) setPlaylists(result);
      }).catch((error) => {
        if (!cancelled) {
          setPlaylists([]);
          props.setFeedback("error", readErrorMessage(error));
        }
      }).finally(() => {
        if (!cancelled) setLoadingPlaylists(false);
      });
      onCleanup(() => {
        cancelled = true;
        unsubscribe();
      });
    }
  ));

  const handlePlaylistCreated = async () => {
    const userId = props.loginProfile?.userId;
    if (userId === undefined) return;
    setLoadingPlaylists(true);
    try {
      const groups = await refreshNcmUserPlaylistGroupsCache(api, userId);
      setPlaylists(groups.created);
    } catch (error) {
      props.setFeedback("error", readErrorMessage(error));
    } finally {
      setLoadingPlaylists(false);
    }
  };

  const checkedSet = createMemo<Set<string>>(() => new Set(checkedIds()));
  const selectedItems = createMemo<OnlineTrackItem[]>(() => {
    const ids = checkedSet();
    return props.items.filter((item) => ids.has(item.id));
  });
  const allChecked = createMemo<boolean>(
    () => props.items.length > 0 && props.items.every((item) => checkedSet().has(item.id))
  );

  const displayTitle = (item: OnlineTrackItem): string =>
    item.title?.trim() || item.source_path || String(item.songId);
  const displayText = (value: string | null | undefined, fallback: string): string => {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : fallback;
  };
  const busy = createMemo<boolean>(() => enqueueing() || deleting() || submittingPlaylistId() !== null);

  const toggleItem = (id: string) => {
    const next = new Set(checkedSet());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setCheckedIds([...next]);
  };

  const toggleAll = () => {
    if (allChecked()) {
      setCheckedIds([]);
      return;
    }
    setCheckedIds(props.items.map((item) => item.id));
  };

  const applyRange = () => {
    const startValue = Number(rangeStart());
    const endValue = Number(rangeEnd());
    if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) return;
    const start = Math.max(1, Math.min(Math.floor(startValue), props.items.length));
    const end = Math.max(1, Math.min(Math.floor(endValue), props.items.length));
    if (start > end) return;
    setCheckedIds(props.items.slice(start - 1, end).map((item) => item.id));
    setRangeOpen(false);
  };

  const enqueueSelected = async () => {
    const items = selectedItems();
    if (items.length === 0 || enqueueing()) return;
    setEnqueueing(true);
    try {
      for (const item of items) {
        await props.playback.enqueueOnlineTrack(item);
      }
      props.setFeedback("success", t("ncm.daily.batchQueued", { count: items.length }));
      props.onClose();
    } catch (error) {
      props.setFeedback("error", readErrorMessage(error));
    } finally {
      setEnqueueing(false);
    }
  };

  const addToPlaylist = async (playlist: NcmPlaylistSummary) => {
    const items = selectedItems();
    if (items.length === 0 || busy()) return;
    setSubmittingPlaylistId(playlist.id);
    try {
      await api.updateNcmPlaylistTracks({
        playlistId: playlist.id,
        songIds: items.map((item) => item.songId),
        op: "add"
      });
      props.setFeedback("success", t("ncm.daily.batchAddedToPlaylist", { count: items.length }));
      props.onClose();
    } catch (error) {
      props.setFeedback("error", readErrorMessage(error));
    } finally {
      setSubmittingPlaylistId(null);
    }
  };

  const deleteSelectedFromPlaylist = async () => {
    const playlistId = props.sourcePlaylistId;
    const items = selectedItems();
    if (playlistId === undefined || items.length === 0 || busy()) return;
    setDeleting(true);
    try {
      const songIds = items.map((item) => item.songId);
      await api.updateNcmPlaylistTracks({
        playlistId,
        songIds,
        op: "del"
      });
      props.onTracksRemoved?.(songIds);
      props.setFeedback("success", t("ncm.playlist.removedSelected", { count: songIds.length }));
      props.onClose();
    } catch (error) {
      props.setFeedback("error", readErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      open={props.open}
      title={props.title ?? t("ncm.daily.batch")}
      closeAriaLabel={t("library.modal.manageRoots.close")}
      onClose={props.onClose}
      size="lg"
    >
      <div class="local-batch-modal ncm-daily-batch-modal">
        <div class="local-batch-table" role="table" aria-label={t("ncm.daily.batch")}>
          <div class="local-batch-row local-batch-head" role="row">
            <span class="local-batch-cell local-batch-check" role="columnheader">
              <input
                type="checkbox"
                aria-label={t("library.batch.selectAll")}
                checked={allChecked()}
                onChange={toggleAll}
              />
            </span>
            <span class="local-batch-cell local-batch-index" role="columnheader">#</span>
            <span class="local-batch-cell" role="columnheader">{t("media.column.title")}</span>
            <span class="local-batch-cell" role="columnheader">{t("media.sort.artist")}</span>
            <span class="local-batch-cell" role="columnheader">{t("media.sort.album")}</span>
          </div>
          <div class="local-batch-body" role="rowgroup">
            <For each={props.items}>
              {(item, index) => (
                <label class="local-batch-row" role="row">
                  <span class="local-batch-cell local-batch-check" role="cell">
                    <input
                      type="checkbox"
                      aria-label={t("media.selection.item", { title: displayTitle(item) })}
                      checked={checkedSet().has(item.id)}
                      onChange={() => toggleItem(item.id)}
                    />
                  </span>
                  <span class="local-batch-cell local-batch-index" role="cell">{index() + 1}</span>
                  <span class="local-batch-cell local-batch-title" role="cell" title={displayTitle(item)}>
                    {displayTitle(item)}
                  </span>
                  <span class="local-batch-cell" role="cell">
                    {displayText(item.artist, t("library.group.unknownArtist"))}
                  </span>
                  <span class="local-batch-cell" role="cell">
                    {displayText(item.album, t("library.group.unknownAlbum"))}
                  </span>
                </label>
              )}
            </For>
          </div>
        </div>

        <div class="local-batch-footer">
          <div class="local-batch-footer-left">
            <span class="local-batch-count">
              {t("library.selection.count", { count: selectedItems().length })}
            </span>
            <div class="local-batch-range">
              <button type="button" class="ghost-button" onClick={() => setRangeOpen((open) => !open)}>
                {t("library.batch.advancedFilter")}
              </button>
              <Show when={rangeOpen()}>
                <div class="local-batch-range-popover">
                  <input
                    class="text-input"
                    type="number"
                    min="1"
                    max={props.items.length}
                    value={rangeStart()}
                    placeholder={t("library.batch.rangeStart")}
                    onInput={(event) => setRangeStart(event.currentTarget.value)}
                  />
                  <span>-</span>
                  <input
                    class="text-input"
                    type="number"
                    min="1"
                    max={props.items.length}
                    value={rangeEnd()}
                    placeholder={t("library.batch.rangeEnd")}
                    onInput={(event) => setRangeEnd(event.currentTarget.value)}
                  />
                  <button type="button" class="ghost-button" onClick={applyRange}>
                    {t("library.batch.rangeSelect")}
                  </button>
                </div>
              </Show>
            </div>
          </div>
          <div class="local-batch-actions">
            <Show when={props.sourcePlaylistId !== undefined}>
              <button
                type="button"
                class="ghost-button"
                disabled={selectedItems().length === 0 || busy()}
                onClick={() => void deleteSelectedFromPlaylist()}
              >
                <span>{deleting() ? t("ncm.playlist.removing") : t("media.context.deleteFromPlaylist")}</span>
              </button>
            </Show>
            <button
              type="button"
              class="primary-button"
              disabled={selectedItems().length === 0 || busy()}
              onClick={() => void enqueueSelected()}
            >
              <IconQueueAdd />
              <span>{t("ncm.daily.batchEnqueue")}</span>
            </button>
          </div>
        </div>

        <div class="ncm-daily-batch-playlists">
          <div class="local-action-summary">
            {props.loginProfile
              ? t("library.playlists.add.summary", { count: selectedItems().length })
              : t("ncm.empty.loginRequired")}
          </div>
          <Show when={props.loginProfile}>
            <div class="local-playlist-target-list ncm-daily-batch-targets">
              <button
                type="button"
                class="local-playlist-target"
                onClick={() => setCreatePlaylistOpen(true)}
                disabled={busy()}
              >
                <span class="local-playlist-target-icon" aria-hidden="true">
                  <IconPlus />
                </span>
                <span class="local-playlist-target-copy">
                  <span class="local-playlist-target-name">{t("playlist.create.title")}</span>
                </span>
              </button>
              <Show
                when={playlists().length > 0}
                fallback={<div class="status-line">{loadingPlaylists() ? t("ncm.playlist.loading") : t("ncm.empty.noUserPlaylists")}</div>}
              >
                <For each={playlists()}>
                  {(playlist, index) => (
                    <button
                      type="button"
                      class="local-playlist-target"
                      onClick={() => void addToPlaylist(playlist)}
                      disabled={selectedItems().length === 0 || busy()}
                    >
                      <span class="local-playlist-target-icon" aria-hidden="true">
                        <Show when={playlist.coverUrl} fallback={<IconPlaylist />}>
                          {(coverUrl) => <SImage src={coverUrl()} alt="" observeVisibility={true} shape="rect" aspect="square" />}
                        </Show>
                      </span>
                      <span class="local-playlist-target-copy">
                        <span class="local-playlist-target-name">
                          {index() === 0 ? t("ncm.liked.title") : playlist.name}
                        </span>
                        <span class="local-playlist-target-count">
                          {submittingPlaylistId() === playlist.id
                            ? t("ncm.daily.batchAdding")
                            : t("library.group.songCount", { count: playlist.trackCount ?? 0 })}
                        </span>
                      </span>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </Show>
        </div>
      </div>
      <CreatePlaylistModal
        api={api}
        open={createPlaylistOpen()}
        mode="online"
        onClose={() => setCreatePlaylistOpen(false)}
        onCreated={handlePlaylistCreated}
      />
    </Modal>
  );
}

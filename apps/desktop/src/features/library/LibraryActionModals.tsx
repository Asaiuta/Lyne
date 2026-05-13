import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Modal } from "../../components/Modal";
import { IconDelete, IconPlaylist, IconPlus } from "../../components/icons";
import type { LocalPlaylist } from "../../shared/api/types";
import { useTranslation } from "../../shared/i18n";
import type { LibraryListItem } from "./libraryDataTypes";

interface LibraryPlaylistTargetModalProps {
  open: boolean;
  items: readonly LibraryListItem[];
  playlists: readonly LocalPlaylist[];
  onClose: () => void;
  onAddToPlaylist: (playlistId: string, items: readonly LibraryListItem[]) => Promise<void>;
  onCreateAndAdd: (
    name: string,
    description: string | null,
    items: readonly LibraryListItem[]
  ) => Promise<void>;
}

interface LibraryConfirmActionModalProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

interface LibraryBatchModalProps {
  open: boolean;
  items: readonly LibraryListItem[];
  onClose: () => void;
  onAddToPlaylist: (items: readonly LibraryListItem[]) => void;
  onDeleteFromLibrary: (items: readonly LibraryListItem[]) => void;
}

export function LibraryPlaylistTargetModal(props: LibraryPlaylistTargetModalProps) {
  const { t } = useTranslation();
  const [name, setName] = createSignal<string>("");
  const [description, setDescription] = createSignal<string>("");
  const [submittingPlaylistId, setSubmittingPlaylistId] = createSignal<string | null>(null);
  const [creating, setCreating] = createSignal<boolean>(false);
  const hasItems = () => props.items.length > 0;

  createEffect(() => {
    if (props.open) return;
    setName("");
    setDescription("");
    setSubmittingPlaylistId(null);
    setCreating(false);
  });

  const handleAdd = async (playlistId: string) => {
    setSubmittingPlaylistId(playlistId);
    try {
      await props.onAddToPlaylist(playlistId, props.items);
      props.onClose();
    } finally {
      setSubmittingPlaylistId(null);
    }
  };

  const handleCreate = async () => {
    const trimmedName = name().trim();
    if (!trimmedName) return;
    setCreating(true);
    try {
      const trimmedDescription = description().trim();
      await props.onCreateAndAdd(
        trimmedName,
        trimmedDescription.length > 0 ? trimmedDescription : null,
        props.items
      );
      props.onClose();
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      open={props.open}
      title={hasItems() ? t("library.playlists.add.title") : t("library.playlists.create.title")}
      closeAriaLabel={t("library.modal.manageRoots.close")}
      onClose={props.onClose}
      size="md"
    >
      <div class="local-action-modal">
        <Show when={hasItems()}>
          <div class="local-action-summary">
            {t("library.playlists.add.summary", { count: props.items.length })}
          </div>
        </Show>

        <Show when={hasItems()}>
          <Show
            when={props.playlists.length > 0}
            fallback={<div class="status-line">{t("library.playlists.empty")}</div>}
          >
            <div class="local-playlist-target-list">
              <For each={props.playlists}>
                {(playlist) => (
                  <button
                    type="button"
                    class="local-playlist-target"
                    onClick={() => void handleAdd(playlist.playlist_id)}
                    disabled={submittingPlaylistId() !== null || creating()}
                  >
                    <span class="local-playlist-target-icon" aria-hidden="true">
                      <IconPlaylist />
                    </span>
                    <span class="local-playlist-target-copy">
                      <span class="local-playlist-target-name">{playlist.name}</span>
                      <span class="local-playlist-target-count">
                        {t("library.group.songCount", { count: playlist.track_count })}
                      </span>
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>

        <div class="local-playlist-create-inline">
          <span class="field-label">{t("library.playlists.create.title")}</span>
          <input
            class="text-input"
            type="text"
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
            placeholder={t("library.playlists.create.namePlaceholder")}
          />
          <input
            class="text-input"
            type="text"
            value={description()}
            onInput={(event) => setDescription(event.currentTarget.value)}
            placeholder={t("library.playlists.create.descriptionPlaceholder")}
          />
          <button
            type="button"
            class="primary-button"
            onClick={() => void handleCreate()}
            disabled={!name().trim() || creating() || submittingPlaylistId() !== null}
          >
            <IconPlus />
            <span>{hasItems() ? t("library.playlists.createAndAdd") : t("library.action.createPlaylist")}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function LibraryBatchModal(props: LibraryBatchModalProps) {
  const { t } = useTranslation();
  const [checkedIds, setCheckedIds] = createSignal<string[]>([]);
  const [rangeOpen, setRangeOpen] = createSignal<boolean>(false);
  const [rangeStart, setRangeStart] = createSignal<string>("");
  const [rangeEnd, setRangeEnd] = createSignal<string>("");

  createEffect(() => {
    if (props.open) return;
    setCheckedIds([]);
    setRangeOpen(false);
    setRangeStart("");
    setRangeEnd("");
  });

  const checkedSet = createMemo<Set<string>>(() => new Set(checkedIds()));
  const selectedItems = createMemo<LibraryListItem[]>(() => {
    const ids = checkedSet();
    return props.items.filter((item) => ids.has(item.id));
  });
  const allChecked = createMemo<boolean>(
    () => props.items.length > 0 && props.items.every((item) => checkedSet().has(item.id))
  );

  const displayTitle = (item: LibraryListItem): string =>
    item.title ?? item.fileName ?? item.source_path ?? item.id;
  const displayText = (value: string | null | undefined, fallback: string): string => {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : fallback;
  };

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

  const handleAddToPlaylist = () => {
    const items = selectedItems();
    if (items.length === 0) return;
    props.onAddToPlaylist(items);
  };

  const handleDelete = () => {
    const items = selectedItems();
    if (items.length === 0) return;
    props.onDeleteFromLibrary(items);
  };

  return (
    <Modal
      open={props.open}
      title={t("library.batch.title")}
      closeAriaLabel={t("library.modal.manageRoots.close")}
      onClose={props.onClose}
      size="lg"
    >
      <div class="local-batch-modal">
        <div class="local-batch-table" role="table" aria-label={t("library.batch.title")}>
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
            <button
              type="button"
              class="primary-button"
              disabled={selectedItems().length === 0}
              onClick={handleAddToPlaylist}
            >
              <IconPlaylist />
              <span>{t("library.action.addToPlaylist")}</span>
            </button>
            <button
              type="button"
              class="primary-button danger-button"
              disabled={selectedItems().length === 0}
              onClick={handleDelete}
            >
              <IconDelete />
              <span>{t("library.batch.deleteSongs")}</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function LibraryConfirmActionModal(props: LibraryConfirmActionModalProps) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = createSignal<boolean>(false);

  createEffect(() => {
    if (props.open) return;
    setSubmitting(false);
  });

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await props.onConfirm();
      props.onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={props.open}
      title={props.title}
      closeAriaLabel={t("library.modal.manageRoots.close")}
      onClose={props.onClose}
      size="sm"
      footer={
        <div class="button-row local-confirm-actions">
          <button
            type="button"
            class="ghost-button"
            onClick={props.onClose}
            disabled={submitting()}
          >
            {t("library.action.cancel")}
          </button>
          <button
            type="button"
            class="primary-button danger-button"
            onClick={() => void handleConfirm()}
            disabled={submitting()}
          >
            {props.confirmLabel}
          </button>
        </div>
      }
    >
      <div class="local-action-summary">{props.body}</div>
    </Modal>
  );
}

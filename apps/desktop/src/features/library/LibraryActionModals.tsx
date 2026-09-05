import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Modal } from "../../components/Modal";
import { IconDelete, IconPlaylist, IconPlus } from "../../components/icons";
import type { LocalPlaylist } from "../../shared/api/types";
import { useTranslation } from "../../shared/i18n";
import {
  NaiveButton,
  NaiveCheckbox,
  NaiveInput,
  NaiveInputNumber,
  NaiveList,
  NaiveListItem,
  NaiveThing
} from "../../shared/ui/naive";
import "../../shared/styles/components/selection-action-modals.css";
import type { LibraryListItem } from "./libraryViewTypes";

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
          <div class="selection-action-summary">
            {t("library.playlists.add.summary", { count: props.items.length })}
          </div>
        </Show>

        <Show when={hasItems()}>
          <Show
            when={props.playlists.length > 0}
            fallback={<div class="status-line">{t("library.playlists.empty")}</div>}
          >
            <NaiveList class="playlist-target-list" hoverable clickable>
              <For each={props.playlists}>
                {(playlist) => (
                  <NaiveListItem
                    class="playlist-target"
                    onClick={() => void handleAdd(playlist.playlist_id)}
                    disabled={submittingPlaylistId() !== null || creating()}
                    prefix={
                      <span class="playlist-target-icon" aria-hidden="true">
                        <IconPlaylist />
                      </span>
                    }
                  >
                    <NaiveThing
                      class="playlist-target-copy"
                      titleClass="playlist-target-name"
                      descriptionClass="playlist-target-count"
                      title={playlist.name}
                      description={t("library.group.songCount", { count: playlist.track_count })}
                    />
                  </NaiveListItem>
                )}
              </For>
            </NaiveList>
          </Show>
        </Show>

        <div class="local-playlist-create-inline">
          <span class="field-label">{t("library.playlists.create.title")}</span>
          <NaiveInput
            type="text"
            value={name()}
            onUpdateValue={setName}
            placeholder={t("library.playlists.create.namePlaceholder")}
            ariaLabel={t("library.playlists.create.namePlaceholder")}
          />
          <NaiveInput
            type="text"
            value={description()}
            onUpdateValue={setDescription}
            placeholder={t("library.playlists.create.descriptionPlaceholder")}
            ariaLabel={t("library.playlists.create.descriptionPlaceholder")}
          />
          <NaiveButton
            variant="primary"
            strong
            onClick={() => void handleCreate()}
            disabled={!name().trim() || creating() || submittingPlaylistId() !== null}
          >
            <IconPlus />
            <span>{hasItems() ? t("library.playlists.createAndAdd") : t("library.action.createPlaylist")}</span>
          </NaiveButton>
        </div>
      </div>
    </Modal>
  );
}

export function LibraryBatchModal(props: LibraryBatchModalProps) {
  const { t } = useTranslation();
  const [checkedIds, setCheckedIds] = createSignal<string[]>([]);
  const [rangeOpen, setRangeOpen] = createSignal<boolean>(false);
  const [rangeStart, setRangeStart] = createSignal<number | null>(null);
  const [rangeEnd, setRangeEnd] = createSignal<number | null>(null);

  createEffect(() => {
    if (props.open) return;
    setCheckedIds([]);
    setRangeOpen(false);
    setRangeStart(null);
    setRangeEnd(null);
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
    const startValue = rangeStart();
    const endValue = rangeEnd();
    if (startValue === null || endValue === null) return;
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
      <div class="batch-selection-modal">
        <div class="batch-selection-table" role="table" aria-label={t("library.batch.title")}>
          <div class="batch-selection-row batch-selection-head" role="row">
            <span class="batch-selection-cell batch-selection-check" role="columnheader">
              <NaiveCheckbox
                size="small"
                ariaLabel={t("library.batch.selectAll")}
                checked={allChecked()}
                onUpdateChecked={toggleAll}
              />
            </span>
            <span class="batch-selection-cell batch-selection-index" role="columnheader">#</span>
            <span class="batch-selection-cell" role="columnheader">{t("media.column.title")}</span>
            <span class="batch-selection-cell" role="columnheader">{t("media.sort.artist")}</span>
            <span class="batch-selection-cell" role="columnheader">{t("media.sort.album")}</span>
          </div>
          <div class="batch-selection-body" role="rowgroup">
            <For each={props.items}>
              {(item, index) => (
                <div class="batch-selection-row" role="row">
                  <span class="batch-selection-cell batch-selection-check" role="cell">
                    <NaiveCheckbox
                      size="small"
                      ariaLabel={t("media.selection.item", { title: displayTitle(item) })}
                      checked={checkedSet().has(item.id)}
                      onUpdateChecked={() => toggleItem(item.id)}
                    />
                  </span>
                  <span class="batch-selection-cell batch-selection-index" role="cell">{index() + 1}</span>
                  <span class="batch-selection-cell batch-selection-title" role="cell" title={displayTitle(item)}>
                    {displayTitle(item)}
                  </span>
                  <span class="batch-selection-cell" role="cell">
                    {displayText(item.artist, t("library.group.unknownArtist"))}
                  </span>
                  <span class="batch-selection-cell" role="cell">
                    {displayText(item.album, t("library.group.unknownAlbum"))}
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>
        <div class="batch-selection-footer">
          <div class="batch-selection-footer-left">
            <span class="batch-selection-count">
              {t("library.selection.count", { count: selectedItems().length })}
            </span>
            <div class="batch-selection-range">
              <NaiveButton variant="tertiary" onClick={() => setRangeOpen((open) => !open)}>
                {t("library.batch.advancedFilter")}
              </NaiveButton>
              <Show when={rangeOpen()}>
                <div class="batch-selection-range-popover">
                  <NaiveInputNumber
                    class="batch-selection-range-input"
                    size="small"
                    min={1}
                    max={props.items.length}
                    value={rangeStart()}
                    placeholder={t("library.batch.rangeStart")}
                    onUpdateValue={setRangeStart}
                    ariaLabel={t("library.batch.rangeStart")}
                  />
                  <span>-</span>
                  <NaiveInputNumber
                    class="batch-selection-range-input"
                    size="small"
                    min={1}
                    max={props.items.length}
                    value={rangeEnd()}
                    placeholder={t("library.batch.rangeEnd")}
                    onUpdateValue={setRangeEnd}
                    ariaLabel={t("library.batch.rangeEnd")}
                  />
                  <NaiveButton size="small" secondary onClick={applyRange}>
                    {t("library.batch.rangeSelect")}
                  </NaiveButton>
                </div>
              </Show>
            </div>
          </div>
          <div class="batch-selection-actions">
            <NaiveButton
              variant="primary"
              strong
              disabled={selectedItems().length === 0}
              onClick={handleAddToPlaylist}
            >
              <IconPlaylist />
              <span>{t("library.action.addToPlaylist")}</span>
            </NaiveButton>
            <NaiveButton
              variant="primary"
              strong
              class="library-danger-button"
              disabled={selectedItems().length === 0}
              onClick={handleDelete}
            >
              <IconDelete />
              <span>{t("library.batch.deleteSongs")}</span>
            </NaiveButton>
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
          <NaiveButton
            variant="tertiary"
            onClick={props.onClose}
            disabled={submitting()}
          >
            {t("library.action.cancel")}
          </NaiveButton>
          <NaiveButton
            variant="primary"
            strong
            class="library-danger-button"
            onClick={() => void handleConfirm()}
            disabled={submitting()}
          >
            {props.confirmLabel}
          </NaiveButton>
        </div>
      }
    >
      <div class="selection-action-summary">{props.body}</div>
    </Modal>
  );
}

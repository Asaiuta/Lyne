import { Show, createEffect, createMemo, createSignal } from "solid-js";
import { IconPlaylist } from "../../../components/icons";
import { Modal } from "../../../components/Modal";
import { createApiClient } from "../../../shared/api/client";
import { useTranslation } from "../../../shared/i18n";
import { assertNcmOk, updatePlaylist } from "../../../shared/api/ncm";
import type { OnlinePlaylistSummary } from "../ncmPlaylistSummary";
import { createErrorMessageReader, type FeedbackSetter } from "../shared/feedback";
import {
  NaiveButton,
  NaiveInput,
  NaiveSelect,
  type NaiveSelectOption
} from "../../../shared/ui/naive";

interface UpdatePlaylistModalProps {
  open: boolean;
  playlist: OnlinePlaylistSummary | null;
  nameLocked?: boolean;
  onClose: () => void;
  onUpdated: (playlist: OnlinePlaylistSummary) => void;
  setFeedback: FeedbackSetter;
}

const api = createApiClient();
const MAX_TAGS = 3;

export function UpdatePlaylistModal(props: UpdatePlaylistModalProps) {
  const { t } = useTranslation();
  const readErrorMessage = createErrorMessageReader(t);
  const [name, setName] = createSignal<string>("");
  const [desc, setDesc] = createSignal<string>("");
  const [selectedTags, setSelectedTags] = createSignal<string[]>([]);
  const [availableTags, setAvailableTags] = createSignal<string[]>([]);
  const [loadingTags, setLoadingTags] = createSignal<boolean>(false);
  const [submitting, setSubmitting] = createSignal<boolean>(false);

  createEffect(() => {
    if (!props.open || props.playlist === null) {
      setName("");
      setDesc("");
      setSelectedTags([]);
      setSubmitting(false);
      return;
    }
    setName(props.playlist.name);
    setDesc(props.playlist.description ?? "");
    setSelectedTags(props.playlist.tags.slice(0, MAX_TAGS));
  });

  createEffect(() => {
    if (!props.open) return;
    setLoadingTags(true);
    void api.getNcmDiscoverPlaylistCategories()
      .then((result) => {
        setAvailableTags(result.entries.map((entry) => entry.name));
      })
      .catch(() => {
        setAvailableTags([]);
      })
      .finally(() => setLoadingTags(false));
  });

  const tagOptions = createMemo<ReadonlyArray<NaiveSelectOption<string>>>(() =>
    availableTags().map((tag) => ({ value: tag, label: tag }))
  );
  const canSubmit = createMemo<boolean>(() =>
    props.playlist !== null && name().trim().length > 0 && !submitting()
  );

  const updateSelectedTags = (tags: string[]) => {
    if (tags.length > MAX_TAGS) {
      props.setFeedback("error", t("ncm.playlist.tagsLimit"));
      setSelectedTags(tags.slice(0, MAX_TAGS));
      return;
    }
    setSelectedTags(tags);
  };

  const submit = async () => {
    const playlist = props.playlist;
    if (!playlist || !canSubmit()) return;
    setSubmitting(true);
    try {
      const nextName = props.nameLocked ? playlist.name : name().trim();
      const result = await updatePlaylist({
        id: playlist.id,
        name: nextName,
        desc: desc().trim(),
        tags: selectedTags()
      });
      assertNcmOk(result, t("ncm.playlist.updateFailed"));
      props.onUpdated({
        ...playlist,
        name: nextName,
        description: desc().trim() || null,
        tags: selectedTags()
      });
      props.setFeedback("success", t("ncm.playlist.updateSuccess"));
      props.onClose();
    } catch (error) {
      props.setFeedback("error", readErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={props.open}
      title={t("ncm.playlist.edit")}
      closeAriaLabel={t("library.modal.manageRoots.close")}
      onClose={props.onClose}
      size="md"
    >
      <form
        class="ncm-update-playlist-modal"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div class="create-playlist-field">
          <span class="field-label">{t("ncm.playlist.name")}</span>
          <NaiveInput
            type="text"
            value={name()}
            disabled={props.nameLocked}
            placeholder={t("ncm.playlist.namePlaceholder")}
            clearable={!props.nameLocked}
            onUpdateValue={setName}
            ariaLabel={t("ncm.playlist.name")}
          />
        </div>
        <div class="create-playlist-field">
          <span class="field-label">{t("ncm.playlist.description")}</span>
          <NaiveInput
            type="textarea"
            class="ncm-update-playlist-desc"
            maxlength={800}
            value={desc()}
            placeholder={t("ncm.playlist.descriptionPlaceholder")}
            autosize={{ minRows: 3, maxRows: 6 }}
            clearable
            onUpdateValue={setDesc}
            ariaLabel={t("ncm.playlist.description")}
          />
        </div>
        <div class="ncm-update-playlist-tags">
          <span class="field-label">{t("ncm.playlist.tags")}</span>
          <Show
            when={availableTags().length > 0}
            fallback={<div class="status-line">{loadingTags() ? t("ncm.playlist.loadingTags") : t("ncm.playlist.noTags")}</div>}
          >
            <NaiveSelect<string>
              multiple
              class="ncm-update-playlist-tag-select"
              value={selectedTags()}
              options={tagOptions()}
              filterable
              clearable
              maxTagCount="responsive"
              placeholder={t("ncm.playlist.tags")}
              onUpdateValue={updateSelectedTags}
              ariaLabel={t("ncm.playlist.tags")}
            />
          </Show>
        </div>
        <NaiveButton
          nativeType="submit"
          variant="primary"
          strong
          block
          class="create-playlist-submit"
          disabled={!canSubmit()}
        >
          <IconPlaylist />
          <span>{submitting() ? t("ncm.playlist.updating") : t("ncm.playlist.edit")}</span>
        </NaiveButton>
      </form>
    </Modal>
  );
}

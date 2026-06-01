import { For, Show, createEffect, createSignal } from "solid-js";
import { Modal } from "./Modal";
import { IconPlus } from "./icons";
import type { ApiClient } from "../shared/api/client";
import type { LocalPlaylist } from "../shared/api/types";
import { assertNcmOk, createPlaylist, type NcmCreatePlaylistType } from "../shared/api/ncm";
import { useTranslation } from "../shared/i18n";

type FeedbackTone = "success" | "error";
export type CreatePlaylistMode = "online" | "local";

interface CreatePlaylistModalProps {
  api: Pick<ApiClient, "createLocalPlaylist">;
  open: boolean;
  mode: CreatePlaylistMode;
  onClose: () => void;
  onCreated: (mode: CreatePlaylistMode, playlist?: LocalPlaylist) => Promise<void> | void;
}

const PLAYLIST_TYPES: ReadonlyArray<{
  value: NcmCreatePlaylistType;
  labelKey: "playlist.create.type.normal" | "playlist.create.type.video" | "playlist.create.type.shared";
  disabled?: boolean;
}> = [
  { value: "NORMAL", labelKey: "playlist.create.type.normal" },
  { value: "VIDEO", labelKey: "playlist.create.type.video", disabled: true },
  { value: "SHARED", labelKey: "playlist.create.type.shared", disabled: true }
];

const readErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function CreatePlaylistModal(props: CreatePlaylistModalProps) {
  const { t } = useTranslation();
  const [name, setName] = createSignal<string>("");
  const [description, setDescription] = createSignal<string>("");
  const [type, setType] = createSignal<NcmCreatePlaylistType>("NORMAL");
  const [privacy, setPrivacy] = createSignal<boolean>(false);
  const [submitting, setSubmitting] = createSignal<boolean>(false);
  const [feedback, setFeedback] = createSignal<{ tone: FeedbackTone; message: string } | null>(null);

  createEffect(() => {
    if (props.open) return;
    setName("");
    setDescription("");
    setType("NORMAL");
    setPrivacy(false);
    setSubmitting(false);
    setFeedback(null);
  });

  const modalTitle = () =>
    props.mode === "local" ? t("playlist.create.localTitle") : t("playlist.create.title");
  const successMessage = (playlistName: string) =>
    props.mode === "local"
      ? t("playlist.create.feedback.localCreated", { name: playlistName })
      : t("playlist.create.feedback.created", { name: playlistName });

  const handleSubmit = async () => {
    const trimmedName = name().trim();
    if (!trimmedName || submitting()) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      if (props.mode === "local") {
        const trimmedDescription = description().trim();
        const playlist = await props.api.createLocalPlaylist({
          name: trimmedName,
          description: trimmedDescription.length > 0 ? trimmedDescription : null
        });
        await props.onCreated("local", playlist);
      } else {
        const result = await createPlaylist(trimmedName, privacy(), type());
        assertNcmOk(result, t("playlist.create.feedback.failed"));
        await props.onCreated("online");
      }
      setFeedback({
        tone: "success",
        message: successMessage(trimmedName)
      });
      props.onClose();
    } catch (error) {
      setFeedback({ tone: "error", message: readErrorMessage(error) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={props.open}
      title={modalTitle()}
      closeAriaLabel={t("library.modal.manageRoots.close")}
      onClose={props.onClose}
      size="md"
    >
      <form
        class="create-playlist-modal"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <label class="create-playlist-field">
          <span class="field-label">{t("playlist.create.name")}</span>
          <input
            class="text-input"
            type="text"
            value={name()}
            placeholder={t("playlist.create.namePlaceholder")}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>

        <Show
          when={props.mode === "local"}
          fallback={
            <>
              <label class="create-playlist-field">
                <span class="field-label">{t("playlist.create.type")}</span>
                <select
                  class="text-input"
                  value={type()}
                  onChange={(event) => setType(event.currentTarget.value as NcmCreatePlaylistType)}
                >
                  <For each={PLAYLIST_TYPES}>
                    {(option) => (
                      <option value={option.value} disabled={option.disabled}>
                        {t(option.labelKey)}
                      </option>
                    )}
                  </For>
                </select>
              </label>

              <label class="create-playlist-switch">
                <input
                  type="checkbox"
                  checked={privacy()}
                  onChange={(event) => setPrivacy(event.currentTarget.checked)}
                />
                <span>{t("playlist.create.privacy")}</span>
              </label>
            </>
          }
        >
          <label class="create-playlist-field">
            <span class="field-label">{t("playlist.create.description")}</span>
            <textarea
              class="text-input create-playlist-description"
              value={description()}
              placeholder={t("playlist.create.descriptionPlaceholder")}
              rows={3}
              onInput={(event) => setDescription(event.currentTarget.value)}
            />
          </label>
        </Show>

        <Show when={feedback()}>
          {(current) => (
            <div
              class={
                current().tone === "error"
                  ? "create-playlist-feedback status-error"
                  : "create-playlist-feedback status-line"
              }
              role="status"
            >
              {current().message}
            </div>
          )}
        </Show>

        <button
          type="submit"
          class="primary-button create-playlist-submit"
          disabled={!name().trim() || submitting()}
        >
          <IconPlus />
          <span>
            {submitting() ? t("playlist.create.submitting") : t("playlist.create.submit")}
          </span>
        </button>
      </form>
    </Modal>
  );
}

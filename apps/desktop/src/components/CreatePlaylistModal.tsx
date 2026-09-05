import { Show, createEffect, createMemo, createSignal } from "solid-js";
import { Modal } from "./Modal";
import { IconPlus } from "./icons";
import type { ApiClient } from "../shared/api/client";
import type { LocalPlaylist } from "../shared/api/types";
import { assertNcmOk, createPlaylist, type NcmCreatePlaylistType } from "../shared/api/ncm";
import { useTranslation } from "../shared/i18n";
import {
  NaiveButton,
  NaiveForm,
  NaiveFormItem,
  NaiveInput,
  NaiveSelect,
  NaiveSwitch,
  type NaiveSelectOption
} from "../shared/ui/naive";

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
  const playlistTypeOptions = createMemo<ReadonlyArray<NaiveSelectOption<NcmCreatePlaylistType>>>(
    () =>
      PLAYLIST_TYPES.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
        disabled: option.disabled
      }))
  );

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
      <NaiveForm
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <NaiveFormItem label={t("playlist.create.name")} path="name">
          <NaiveInput
            type="text"
            value={name()}
            placeholder={t("playlist.create.namePlaceholder")}
            onUpdateValue={setName}
            ariaLabel={t("playlist.create.name")}
          />
        </NaiveFormItem>

        <Show
          when={props.mode === "local"}
          fallback={
            <>
              <NaiveFormItem label={t("playlist.create.type")} path="type">
                <NaiveSelect
                  value={type()}
                  options={playlistTypeOptions()}
                  onUpdateValue={(value) => {
                    if (value !== null) setType(value);
                  }}
                  ariaLabel={t("playlist.create.type")}
                />
              </NaiveFormItem>

              <NaiveFormItem
                label={t("playlist.create.privacy")}
                path="privacy"
                labelPlacement="left"
              >
                <NaiveSwitch
                  checked={privacy()}
                  onChange={setPrivacy}
                  ariaLabel={t("playlist.create.privacy")}
                />
              </NaiveFormItem>
            </>
          }
        >
          <NaiveFormItem label={t("playlist.create.description")} path="description">
            <NaiveInput
              type="textarea"
              value={description()}
              placeholder={t("playlist.create.descriptionPlaceholder")}
              autosize={{ minRows: 2, maxRows: 4 }}
              onUpdateValue={setDescription}
              ariaLabel={t("playlist.create.description")}
            />
          </NaiveFormItem>
        </Show>

        <Show when={feedback()}>
          {(current) => (
            <div
              class={
                current().tone === "error"
                  ? "status-error"
                  : "status-line"
              }
              role="status"
            >
              {current().message}
            </div>
          )}
        </Show>

        <NaiveButton
          nativeType="submit"
          variant="primary"
          strong
          block
          disabled={!name().trim() || submitting()}
        >
          <IconPlus />
          <span>
            {submitting() ? t("playlist.create.submitting") : t("playlist.create.submit")}
          </span>
        </NaiveButton>
      </NaiveForm>
    </Modal>
  );
}

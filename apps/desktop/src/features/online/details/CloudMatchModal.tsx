import { Show, createEffect, createMemo, createSignal } from "solid-js";
import { IconCloud, IconSearch } from "../../../components/icons";
import { Modal } from "../../../components/Modal";
import { SImage } from "../../../components/SImage";
import { createApiClient, type NcmTrackSummary } from "../../../shared/api/client";
import { useTranslation } from "../../../shared/i18n";
import { NaiveButton, NaiveInputNumber } from "../../../shared/ui/naive";
import { createErrorMessageReader, type FeedbackSetter } from "../shared/feedback";
import type { OnlineTrackItem } from "../shared/types";

interface CloudMatchModalProps {
  open: boolean;
  item: OnlineTrackItem | null;
  userId: number | null;
  onClose: () => void;
  onMatched: () => Promise<void> | void;
  setFeedback: FeedbackSetter;
}

const api = createApiClient();

const displayText = (value: string | null | undefined, fallback: string): string => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
};

export function CloudMatchModal(props: CloudMatchModalProps) {
  const { t } = useTranslation();
  const readErrorMessage = createErrorMessageReader(t);
  const [targetId, setTargetId] = createSignal<number | null>(null);
  const [verifiedTargetId, setVerifiedTargetId] = createSignal<number | null>(null);
  const [verifiedTrack, setVerifiedTrack] = createSignal<NcmTrackSummary | null>(null);
  const [statusText, setStatusText] = createSignal<string | null>(null);
  const [statusTone, setStatusTone] = createSignal<"neutral" | "success" | "error">("neutral");
  const [validating, setValidating] = createSignal<boolean>(false);
  const [submitting, setSubmitting] = createSignal<boolean>(false);

  createEffect(() => {
    if (!props.open) {
      setTargetId(null);
      setVerifiedTargetId(null);
      setVerifiedTrack(null);
      setStatusText(null);
      setStatusTone("neutral");
      setValidating(false);
      setSubmitting(false);
    }
  });

  const sourceTitle = createMemo<string>(() =>
    displayText(props.item?.title, props.item?.source_path ?? String(props.item?.songId ?? ""))
  );
  const isVerified = createMemo<boolean>(() => {
    const currentTargetId = targetId();
    return currentTargetId !== null && currentTargetId === verifiedTargetId() && verifiedTrack() !== null;
  });
  const busy = createMemo<boolean>(() => validating() || submitting());

  const resetVerification = (value: number | null) => {
    setTargetId(value);
    setVerifiedTargetId(null);
    setVerifiedTrack(null);
    setStatusText(null);
    setStatusTone("neutral");
  };

  const validateTarget = async () => {
    const source = props.item;
    const currentTargetId = targetId();
    if (source === null || currentTargetId === null) {
      setStatusTone("error");
      setStatusText(t("ncm.cloud.match.invalidTarget"));
      return;
    }
    if (source.songId === currentTargetId) {
      setStatusTone("error");
      setStatusText(t("ncm.cloud.match.sameId"));
      return;
    }

    setValidating(true);
    setStatusTone("neutral");
    setStatusText(null);
    try {
      const [track] = await api.listNcmSongDetailTracks([currentTargetId]);
      if (!track) {
        setVerifiedTargetId(null);
        setVerifiedTrack(null);
        setStatusTone("error");
        setStatusText(t("ncm.cloud.match.notFound"));
        return;
      }
      setVerifiedTargetId(currentTargetId);
      setVerifiedTrack(track);
      setStatusTone("success");
      setStatusText(t("ncm.cloud.match.verified"));
    } catch (error) {
      setVerifiedTargetId(null);
      setVerifiedTrack(null);
      setStatusTone("error");
      setStatusText(readErrorMessage(error));
    } finally {
      setValidating(false);
    }
  };

  const submit = async () => {
    const source = props.item;
    const userId = props.userId;
    const currentTargetId = targetId();
    if (source === null || userId === null || currentTargetId === null) {
      setStatusTone("error");
      setStatusText(t("ncm.cloud.match.invalidTarget"));
      return;
    }
    if (source.songId === currentTargetId) {
      setStatusTone("error");
      setStatusText(t("ncm.cloud.match.sameId"));
      return;
    }
    if (!isVerified()) {
      setStatusTone("error");
      setStatusText(t("ncm.cloud.match.validationRequired"));
      return;
    }

    setSubmitting(true);
    try {
      await api.matchNcmCloudTrack({
        userId,
        songId: source.songId,
        adjustSongId: currentTargetId
      });
      props.setFeedback("success", t("ncm.cloud.match.success"));
      props.onClose();
      await props.onMatched();
    } catch (error) {
      props.setFeedback("error", readErrorMessage(error));
      setStatusTone("error");
      setStatusText(readErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={props.open}
      title={t("ncm.cloud.match.title")}
      closeAriaLabel={t("library.modal.manageRoots.close")}
      onClose={props.onClose}
      size="md"
    >
      <form
        class="ncm-cloud-match-modal"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div class="create-playlist-field">
          <span class="field-label">{t("ncm.cloud.match.sourceId")}</span>
          <NaiveInputNumber
            value={props.item?.songId ?? null}
            showButton={false}
            disabled
            ariaLabel={t("ncm.cloud.match.sourceId")}
          />
        </div>

        <div class="ncm-cloud-match-source">
          <div class="ncm-cloud-match-cover">
            <Show when={props.item?.artworkUrl} fallback={<IconCloud />}>
              {(url) => <SImage src={url()} alt="" observeVisibility={true} shape="rect" aspect="square" />}
            </Show>
          </div>
          <div class="ncm-cloud-match-copy">
            <strong>{sourceTitle()}</strong>
            <span>
              {displayText(props.item?.artist, t("library.group.unknownArtist"))}
              {" - "}
              {displayText(props.item?.album, t("library.group.unknownAlbum"))}
            </span>
          </div>
        </div>

        <div class="create-playlist-field">
          <span class="field-label">{t("ncm.cloud.match.targetId")}</span>
          <div class="ncm-cloud-match-target-row">
            <NaiveInputNumber
              value={targetId()}
              min={1}
              step={1}
              precision={0}
              showButton={false}
              placeholder={t("ncm.cloud.match.targetPlaceholder")}
              disabled={busy()}
              onUpdateValue={resetVerification}
              ariaLabel={t("ncm.cloud.match.targetId")}
            />
            <NaiveButton
              variant={isVerified() ? "default" : "primary"}
              secondary
              strong
              class="ncm-cloud-match-verify"
              disabled={busy() || targetId() === null || isVerified()}
              onClick={() => void validateTarget()}
            >
              <IconSearch />
              <span>{isVerified() ? t("ncm.cloud.match.verified") : t("ncm.cloud.match.verify")}</span>
            </NaiveButton>
          </div>
        </div>

        <Show when={verifiedTrack()}>
          {(track) => (
            <div class="ncm-cloud-match-preview">
              <div class="ncm-cloud-match-cover">
                <Show when={track().artworkUrl} fallback={<IconCloud />}>
                  {(url) => <SImage src={url()} alt="" observeVisibility={true} shape="rect" aspect="square" />}
                </Show>
              </div>
              <div class="ncm-cloud-match-copy">
                <strong>{displayText(track().title, String(track().songId))}</strong>
                <span>
                  {displayText(track().artist, t("library.group.unknownArtist"))}
                  {" - "}
                  {displayText(track().album, t("library.group.unknownAlbum"))}
                </span>
              </div>
            </div>
          )}
        </Show>

        <Show when={statusText()}>
          {(message) => (
            <span
              class={statusTone() === "error" ? "status-error" : "status-line"}
              data-tone={statusTone()}
            >
              {message()}
            </span>
          )}
        </Show>

        <div class="ncm-cloud-match-actions">
          <NaiveButton secondary strong disabled={submitting()} onClick={props.onClose}>
            {t("ncm.cloud.match.cancel")}
          </NaiveButton>
          <NaiveButton
            nativeType="submit"
            variant="primary"
            secondary
            strong
            disabled={busy() || !isVerified()}
          >
            <IconCloud />
            <span>{submitting() ? t("ncm.cloud.match.submitting") : t("ncm.cloud.match.submit")}</span>
          </NaiveButton>
        </div>
      </form>
    </Modal>
  );
}

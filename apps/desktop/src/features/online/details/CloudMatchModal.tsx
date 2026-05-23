import { Show, createEffect, createMemo, createSignal } from "solid-js";
import { IconCloud, IconSearch } from "../../../components/icons";
import { Modal } from "../../../components/Modal";
import { createApiClient, type NcmTrackSummary } from "../../../shared/api/client";
import { useTranslation } from "../../../shared/i18n";
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

const parsePositiveInteger = (value: string): number | null => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const displayText = (value: string | null | undefined, fallback: string): string => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
};

export function CloudMatchModal(props: CloudMatchModalProps) {
  const { t } = useTranslation();
  const readErrorMessage = createErrorMessageReader(t);
  const [targetIdText, setTargetIdText] = createSignal<string>("");
  const [verifiedTargetId, setVerifiedTargetId] = createSignal<number | null>(null);
  const [verifiedTrack, setVerifiedTrack] = createSignal<NcmTrackSummary | null>(null);
  const [statusText, setStatusText] = createSignal<string | null>(null);
  const [statusTone, setStatusTone] = createSignal<"neutral" | "success" | "error">("neutral");
  const [validating, setValidating] = createSignal<boolean>(false);
  const [submitting, setSubmitting] = createSignal<boolean>(false);

  createEffect(() => {
    if (!props.open) {
      setTargetIdText("");
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
  const parsedTargetId = createMemo<number | null>(() => parsePositiveInteger(targetIdText()));
  const isVerified = createMemo<boolean>(() => {
    const targetId = parsedTargetId();
    return targetId !== null && targetId === verifiedTargetId() && verifiedTrack() !== null;
  });
  const busy = createMemo<boolean>(() => validating() || submitting());

  const resetVerification = (value: string) => {
    setTargetIdText(value);
    setVerifiedTargetId(null);
    setVerifiedTrack(null);
    setStatusText(null);
    setStatusTone("neutral");
  };

  const validateTarget = async () => {
    const source = props.item;
    const targetId = parsedTargetId();
    if (source === null || targetId === null) {
      setStatusTone("error");
      setStatusText(t("ncm.cloud.match.invalidTarget"));
      return;
    }
    if (source.songId === targetId) {
      setStatusTone("error");
      setStatusText(t("ncm.cloud.match.sameId"));
      return;
    }

    setValidating(true);
    setStatusTone("neutral");
    setStatusText(null);
    try {
      const [track] = await api.listNcmSongDetailTracks([targetId]);
      if (!track) {
        setVerifiedTargetId(null);
        setVerifiedTrack(null);
        setStatusTone("error");
        setStatusText(t("ncm.cloud.match.notFound"));
        return;
      }
      setVerifiedTargetId(targetId);
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
    const targetId = parsedTargetId();
    if (source === null || userId === null || targetId === null) {
      setStatusTone("error");
      setStatusText(t("ncm.cloud.match.invalidTarget"));
      return;
    }
    if (source.songId === targetId) {
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
        adjustSongId: targetId
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
        <label class="create-playlist-field">
          <span class="field-label">{t("ncm.cloud.match.sourceId")}</span>
          <input class="text-input" type="text" value={String(props.item?.songId ?? "")} disabled />
        </label>

        <div class="ncm-cloud-match-source">
          <div class="ncm-cloud-match-cover">
            <Show when={props.item?.artworkUrl} fallback={<IconCloud />}>
              {(url) => <img src={url()} alt="" loading="lazy" />}
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

        <label class="create-playlist-field">
          <span class="field-label">{t("ncm.cloud.match.targetId")}</span>
          <div class="ncm-cloud-match-target-row">
            <input
              class="text-input"
              type="text"
              inputmode="numeric"
              value={targetIdText()}
              placeholder={t("ncm.cloud.match.targetPlaceholder")}
              disabled={busy()}
              onInput={(event) => resetVerification(event.currentTarget.value)}
            />
            <button
              type="button"
              class="ghost-button ncm-cloud-match-verify"
              disabled={busy() || parsedTargetId() === null || isVerified()}
              onClick={() => void validateTarget()}
            >
              <IconSearch />
              <span>{isVerified() ? t("ncm.cloud.match.verified") : t("ncm.cloud.match.verify")}</span>
            </button>
          </div>
        </label>

        <Show when={verifiedTrack()}>
          {(track) => (
            <div class="ncm-cloud-match-preview">
              <div class="ncm-cloud-match-cover">
                <Show when={track().artworkUrl} fallback={<IconCloud />}>
                  {(url) => <img src={url()} alt="" loading="lazy" />}
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
          <button type="button" class="ghost-button" disabled={submitting()} onClick={props.onClose}>
            {t("ncm.cloud.match.cancel")}
          </button>
          <button type="submit" class="primary-button" disabled={busy() || !isVerified()}>
            <IconCloud />
            <span>{submitting() ? t("ncm.cloud.match.submitting") : t("ncm.cloud.match.submit")}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}

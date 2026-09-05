import { For, Show } from "solid-js";
import { Modal } from "../../components/Modal";
import { SImage } from "../../components/SImage";
import type { NcmSongComment } from "../../shared/api/ncm/comment";
import { useTranslation } from "../../shared/i18n";
import { NaiveP } from "../../shared/ui/naive";
import "../../shared/styles/components/ncm-comments-modal.css";

export interface NcmCommentsModalState {
  open: boolean;
  title: string;
  status: "idle" | "loading" | "success" | "error";
  total: number;
  hotComments: readonly NcmSongComment[];
  comments: readonly NcmSongComment[];
  error: string | null;
}

export const closedNcmCommentsModal: NcmCommentsModalState = {
  open: false,
  title: "",
  status: "idle",
  total: 0,
  hotComments: [],
  comments: [],
  error: null
};

interface NcmCommentsModalProps {
  state: NcmCommentsModalState;
  onClose: () => void;
}

export function NcmCommentsModal(props: NcmCommentsModalProps) {
  const { t } = useTranslation();
  const state = () => props.state;

  return (
    <Modal
      open={state().open}
      title={t("media.comments.title", { title: state().title })}
      onClose={props.onClose}
      size="lg"
    >
      <div class="media-comments-modal">
        <Show when={state().status === "loading"}>
          <NaiveP class="panel-note">{t("media.comments.loading")}</NaiveP>
        </Show>
        <Show when={state().status === "error"}>
          <NaiveP class="panel-note">{state().error ?? t("common.error.requestFailed")}</NaiveP>
        </Show>
        <Show when={state().status === "success" && state().total === 0}>
          <NaiveP class="panel-note">{t("media.comments.empty")}</NaiveP>
        </Show>
        <Show when={state().hotComments.length > 0}>
          <section class="media-comments-section">
            <h4>{t("media.comments.hot")}</h4>
            <For each={state().hotComments}>
              {(comment) => <NcmCommentItem comment={comment} />}
            </For>
          </section>
        </Show>
        <Show when={state().comments.length > 0}>
          <section class="media-comments-section">
            <h4>
              {t("media.comments.all")}
              <Show when={state().total > 0}>
                <span>{state().total}</span>
              </Show>
            </h4>
            <For each={state().comments}>
              {(comment) => <NcmCommentItem comment={comment} />}
            </For>
          </section>
        </Show>
      </div>
    </Modal>
  );
}

function NcmCommentItem(props: { comment: NcmSongComment }) {
  const timeLabel = () =>
    props.comment.time === null ? "" : new Date(props.comment.time).toLocaleDateString();

  return (
    <article class="media-comment-item">
      <Show when={props.comment.user.avatarUrl} fallback={<div class="media-comment-avatar" aria-hidden="true" />}>
        {(avatarUrl) => (
          <SImage
            src={avatarUrl()}
            alt={props.comment.user.nickname}
            class="media-comment-avatar"
            observeVisibility={true}
            shape="circle"
            aspect="square"
          />
        )}
      </Show>
      <div class="media-comment-body">
        <div class="media-comment-meta">
          <span>{props.comment.user.nickname}</span>
          <span>{timeLabel()}</span>
        </div>
        <NaiveP>{props.comment.content}</NaiveP>
        <Show when={props.comment.likedCount > 0}>
          <span class="media-comment-like">{props.comment.likedCount}</span>
        </Show>
      </div>
    </article>
  );
}

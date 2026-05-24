import { For, Show } from "solid-js";
import type { Accessor } from "solid-js";
import type { NcmSongComment } from "../../shared/api/ncm/comment";
import { SImage } from "../SImage";
import { CoverArt } from "../CoverArt";
import { IconPlay } from "../icons";

interface FullPlayerCommentsSongProps {
  className: string;
  songClassName: string;
  coverUrl: string | null;
  title: string;
  subtitle: string;
  coverAlt: string;
  backLabel: string;
  showCover: Accessor<boolean>;
  onClose: () => void;
}

interface FullPlayerCommentsContentProps {
  loadingLabel: string;
  emptyLabel: string;
  errorLabel: string;
  hotLabel: string;
  allLabel: string;
  commentsStatus: "idle" | "loading" | "success" | "error";
  commentCount: number;
  hotComments: readonly NcmSongComment[];
  comments: readonly NcmSongComment[];
}

interface FullPlayerCommentsProps {
  song: FullPlayerCommentsSongProps;
  content: FullPlayerCommentsContentProps;
}

export function FullPlayerComments(props: FullPlayerCommentsProps) {
  return (
    <div class={props.song.className}>
      <div class={props.song.songClassName}>
        <Show when={props.song.showCover()}>
          <CoverArt coverUrl={props.song.coverUrl} alt={props.song.coverAlt} />
        </Show>
        <div class="full-player-comment-song-info">
          <span class="full-player-comment-song-title">{props.song.title}</span>
          <span class="full-player-comment-song-artist">{props.song.subtitle}</span>
        </div>
        <button
          type="button"
          class="full-player-comment-close"
          onClick={props.song.onClose}
          aria-label={props.song.backLabel}
          title={props.song.backLabel}
        >
          <IconPlay />
        </button>
      </div>

      <div class="full-player-comment-scroll">
        <Show when={props.content.commentsStatus === "loading"}>
          <div class="full-player-comment-placeholder">{props.content.loadingLabel}</div>
        </Show>
        <Show when={props.content.commentsStatus === "error"}>
          <div class="full-player-comment-placeholder">{props.content.errorLabel}</div>
        </Show>
        <Show when={props.content.commentsStatus === "success" && props.content.commentCount === 0}>
          <div class="full-player-comment-placeholder">{props.content.emptyLabel}</div>
        </Show>
        <Show when={props.content.hotComments.length > 0}>
          <section class="full-player-comment-section">
            <h3>{props.content.hotLabel}</h3>
            <For each={props.content.hotComments}>
              {(comment) => <CommentItem comment={comment} />}
            </For>
          </section>
        </Show>
        <Show when={props.content.comments.length > 0}>
          <section class="full-player-comment-section">
            <h3>
              {props.content.allLabel}
              <Show when={props.content.commentCount > 0}>
                <span>{props.content.commentCount}</span>
              </Show>
            </h3>
            <For each={props.content.comments}>
              {(comment) => <CommentItem comment={comment} />}
            </For>
          </section>
        </Show>
      </div>
    </div>
  );
}

function CommentItem(props: { comment: NcmSongComment }) {
  const timeLabel = () =>
    props.comment.time === null ? "" : new Date(props.comment.time).toLocaleDateString();

  return (
    <article class="full-player-comment-item">
      <Show
        when={props.comment.user.avatarUrl}
        fallback={<div class="full-player-comment-avatar" aria-hidden="true" />}
      >
        {(avatarUrl) => (
          <SImage
            src={avatarUrl()}
            alt={props.comment.user.nickname}
            class="full-player-comment-avatar"
            observeVisibility={true}
            shape="circle"
            aspect="square"
          />
        )}
      </Show>
      <div class="full-player-comment-body">
        <div class="full-player-comment-meta">
          <span>{props.comment.user.nickname}</span>
          <span>{timeLabel()}</span>
        </div>
        <p>{props.comment.content}</p>
        <Show when={props.comment.likedCount > 0}>
          <span class="full-player-comment-like">{props.comment.likedCount}</span>
        </Show>
      </div>
    </article>
  );
}

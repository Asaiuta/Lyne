import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import {
  IconChat,
  IconFire,
  IconHeart,
  IconMessage,
  IconThumbUp,
  IconThumbUpFilled
} from "../../../components/icons";
import {
  resolveQueueVisibleRange
} from "../../queue/queueVirtualization";
import { SImage } from "../../../components/SImage";
import { resolveNearestScrollRoot } from "../../../shared/ui/scrollRoot";
import {
  commentHugList,
  commentLike,
  hugComment,
  readCommentHugListPayload,
  readResourceCommentsPayload,
  resourceComments,
  resourceHotComments,
  type NcmResourceCommentType,
  type NcmSongComment
} from "../../../shared/api/ncm/comment";
import { useTranslation } from "../../../shared/i18n";
import { useNcmAccount } from "../../../shared/state/NcmAccountContext";
import { NaiveH3, NaiveP, NaiveSpin, NaiveText } from "../../../shared/ui/naive";

type ResourceCommentSort = "hot" | "new";
type CommentFeedback = {
  tone: "success" | "error";
  message: string;
};

export interface ResourceCommentsPanelProps {
  resourceId: number | string | null;
  resourceType: NcmResourceCommentType;
  class?: string;
  title?: string;
  grouped?: boolean;
  pageScrollRoot?: boolean;
}

const PAGE_SIZE = 20;
const COMMENT_VIRTUALIZE_THRESHOLD = 80;
const COMMENT_ROW_HEIGHT_PX = 160;
const COMMENT_ROW_GAP_PX = 16;
const COMMENT_OVERSCAN = 4;

const formatNumber = (value: number | null): string => {
  if (value === null) return "0";
  if (value >= 100000000) return `${(value / 100000000).toFixed(1).replace(/\.0$/, "")}亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(1).replace(/\.0$/, "")}万`;
  return String(Math.round(value));
};

const formatDate = (timestamp: number | null): string | null => {
  if (timestamp === null) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
};

const readErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim() ? error.message : fallback;

const getHugCount = (payload: ReturnType<typeof readCommentHugListPayload>): number =>
  payload.total || payload.count || payload.hugComments.length;

const patchComment = (
  items: readonly NcmSongComment[],
  commentId: number,
  updater: (comment: NcmSongComment) => NcmSongComment
): readonly NcmSongComment[] =>
  items.map((comment) => (comment.commentId === commentId ? updater(comment) : comment));

const appendCommentBusy = (
  current: readonly number[],
  commentId: number
): readonly number[] => current.includes(commentId) ? current : [...current, commentId];

const removeCommentBusy = (
  current: readonly number[],
  commentId: number
): readonly number[] => current.filter((item) => item !== commentId);

const isValidResourceId = (value: number | string | null): value is number | string => {
  if (typeof value === "number") return value > 0;
  return typeof value === "string" && value.trim().length > 0;
};

interface VirtualizedCommentListProps {
  items: readonly NcmSongComment[];
  renderComment: (comment: NcmSongComment) => JSX.Element;
}

interface CommentVisibleRange {
  start: number;
  end: number;
}

const shouldVirtualizeComments = (count: number): boolean =>
  count > COMMENT_VIRTUALIZE_THRESHOLD;

function VirtualizedCommentList(props: VirtualizedCommentListProps) {
  const [scrollTop, setScrollTop] = createSignal<number>(0);
  const [viewportHeight, setViewportHeight] = createSignal<number>(0);
  let listRef: HTMLDivElement | undefined;
  let scrollRoot: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | undefined;
  let scrollFrame = 0;

  const commitMeasure = () => {
    scrollFrame = 0;
    if (!listRef || typeof window === "undefined") return;
    const rootRect = scrollRoot?.getBoundingClientRect() ?? null;
    const listRect = listRef.getBoundingClientRect();
    setViewportHeight(scrollRoot?.clientHeight ?? window.innerHeight);
    setScrollTop(Math.max(0, (rootRect?.top ?? 0) - listRect.top));
  };

  const scheduleMeasure = () => {
    if (scrollFrame !== 0) return;
    if (typeof window === "undefined") {
      commitMeasure();
      return;
    }
    scrollFrame = window.requestAnimationFrame(commitMeasure);
  };

  onMount(() => {
    if (!listRef || typeof window === "undefined") return;
    scrollRoot = resolveNearestScrollRoot(listRef);
    const scrollTarget: HTMLElement | Window = scrollRoot ?? window;
    scrollTarget.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure);
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleMeasure);
      resizeObserver.observe(listRef);
      if (scrollRoot) {
        resizeObserver.observe(scrollRoot);
      }
    }
    scheduleMeasure();

    onCleanup(() => {
      scrollTarget.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      scrollRoot = null;
    });
  });

  onCleanup(() => {
    if (scrollFrame !== 0 && typeof window !== "undefined") {
      window.cancelAnimationFrame(scrollFrame);
    }
  });

  createEffect(() => {
    props.items.length;
    scheduleMeasure();
  });

  const useVirtualRows = createMemo<boolean>(() => shouldVirtualizeComments(props.items.length));
  const visibleRange = createMemo<CommentVisibleRange>((previous) => {
    if (!useVirtualRows()) {
      return previous.start === 0 && previous.end === props.items.length
        ? previous
        : { start: 0, end: props.items.length };
    }
    const next = resolveQueueVisibleRange({
      totalItems: props.items.length,
      scrollTop: scrollTop(),
      viewportHeight: viewportHeight(),
      rowHeight: COMMENT_ROW_HEIGHT_PX,
      overscan: COMMENT_OVERSCAN
    });
    return previous.start === next.start && previous.end === next.end ? previous : next;
  }, { start: 0, end: 0 });

  const renderedComments = createMemo<readonly NcmSongComment[]>(() => {
    const range = visibleRange();
    return props.items.slice(range.start, range.end);
  });
  const virtualOffset = createMemo<number>(() =>
    useVirtualRows() ? visibleRange().start * COMMENT_ROW_HEIGHT_PX : 0
  );
  const bottomOffset = createMemo<number>(() =>
    useVirtualRows() ? Math.max(0, props.items.length - visibleRange().end) * COMMENT_ROW_HEIGHT_PX : 0
  );
  const spacerHeight = (height: number): number =>
    height > 0 ? Math.max(0, height - COMMENT_ROW_GAP_PX) : 0;

  return (
    <div
      ref={listRef}
      class="ncm-resource-comment-list"
      data-virtualized={useVirtualRows() ? "true" : undefined}
    >
      <Show when={useVirtualRows() && virtualOffset() > 0}>
        <div
          class="ncm-resource-comment-spacer"
          style={{ height: `${spacerHeight(virtualOffset())}px` }}
          aria-hidden="true"
        />
      </Show>
      <For each={renderedComments()}>
        {(comment) => props.renderComment(comment)}
      </For>
      <Show when={useVirtualRows() && bottomOffset() > 0}>
        <div
          class="ncm-resource-comment-spacer"
          style={{ height: `${spacerHeight(bottomOffset())}px` }}
          aria-hidden="true"
        />
      </Show>
    </div>
  );
}

export function ResourceCommentsPanel(props: ResourceCommentsPanelProps) {
  const { t, td } = useTranslation();
  const accountStore = useNcmAccount();
  const [commentSort, setCommentSort] = createSignal<ResourceCommentSort>("hot");
  const [comments, setComments] = createSignal<readonly NcmSongComment[]>([]);
  const [hotComments, setHotComments] = createSignal<readonly NcmSongComment[]>([]);
  const [commentPage, setCommentPage] = createSignal<number>(1);
  const [commentTotal, setCommentTotal] = createSignal<number>(0);
  const [commentHasMore, setCommentHasMore] = createSignal<boolean>(false);
  const [commentLoading, setCommentLoading] = createSignal<boolean>(false);
  const [hotCommentLoading, setHotCommentLoading] = createSignal<boolean>(false);
  const [feedback, setFeedback] = createSignal<CommentFeedback | null>(null);
  const [likeBusyIds, setLikeBusyIds] = createSignal<readonly number[]>([]);
  const [hugBusyIds, setHugBusyIds] = createSignal<readonly number[]>([]);
  const title = createMemo(() => props.title ?? t("ncm.comments.title"));
  const activeAccount = createMemo(() => accountStore.activeAccount());
  const canWrite = createMemo(() => activeAccount()?.hasCookie === true);
  const activeRequestControllers = new Set<AbortController>();

  const createRequestAbortState = (): { cancelled: boolean; signal: AbortSignal; cancel: () => void } => {
    const controller = new AbortController();
    activeRequestControllers.add(controller);
    const abortState = {
      cancelled: false,
      signal: controller.signal,
      cancel: () => {
        abortState.cancelled = true;
        activeRequestControllers.delete(controller);
        controller.abort();
      }
    };
    return abortState;
  };

  onCleanup(() => {
    for (const controller of activeRequestControllers) {
      controller.abort();
    }
    activeRequestControllers.clear();
  });

  const loadComments = async (
    resourceId: number | string,
    page: number,
    append: boolean,
    abortState: { cancelled: boolean; signal?: AbortSignal; cancel?: () => void }
  ) => {
    setCommentLoading(true);
    try {
      const cursor = append ? comments()[comments().length - 1]?.time ?? undefined : undefined;
      const sortType = props.grouped === true ? 3 : commentSort() === "hot" ? 2 : 3;
      const payload = readResourceCommentsPayload(await resourceComments(
        resourceId,
        props.resourceType,
        page,
        PAGE_SIZE,
        sortType,
        cursor,
        { signal: abortState.signal }
      ));
      if (abortState.cancelled) return;
      setComments((current) => (append ? [...current, ...payload.comments] : payload.comments));
      setCommentTotal(payload.total);
      setCommentHasMore(payload.hasMore);
      setCommentPage(page);
    } catch (error) {
      if (abortState.cancelled) return;
      console.warn("[ResourceCommentsPanel] comments fetch failed", error);
      if (!append) {
        setComments([]);
        setCommentTotal(0);
        setCommentHasMore(false);
      }
    } finally {
      if (!abortState.cancelled) {
        setCommentLoading(false);
      }
      abortState.cancel?.();
    }
  };

  const loadHotComments = async (
    resourceId: number | string,
    abortState: { cancelled: boolean; signal?: AbortSignal; cancel?: () => void }
  ) => {
    setHotCommentLoading(true);
    try {
      const payload = readResourceCommentsPayload(await resourceHotComments(
        resourceId,
        props.resourceType,
        PAGE_SIZE,
        0,
        undefined,
        { signal: abortState.signal }
      ));
      if (abortState.cancelled) return;
      setHotComments(payload.hotComments);
    } catch (error) {
      if (abortState.cancelled) return;
      console.warn("[ResourceCommentsPanel] hot comments fetch failed", error);
      setHotComments([]);
    } finally {
      if (!abortState.cancelled) {
        setHotCommentLoading(false);
      }
      abortState.cancel?.();
    }
  };

  createEffect(on(
    [() => props.resourceId, () => props.grouped === true ? "grouped" : commentSort()],
    ([resourceId]) => {
      const commentsAbortState = createRequestAbortState();
      const hotCommentsAbortState =
        props.grouped === true ? createRequestAbortState() : null;
      setComments([]);
      setHotComments([]);
      setCommentPage(1);
      setCommentTotal(0);
      setCommentHasMore(false);
      setFeedback(null);
      if (!isValidResourceId(resourceId)) {
        setCommentLoading(false);
        setHotCommentLoading(false);
        return;
      }
      if (props.grouped === true) {
        void loadHotComments(resourceId, hotCommentsAbortState ?? commentsAbortState);
      }
      void loadComments(resourceId, 1, false, commentsAbortState);
      onCleanup(() => {
        commentsAbortState.cancelled = true;
        commentsAbortState.cancel();
        if (hotCommentsAbortState !== null) {
          hotCommentsAbortState.cancelled = true;
          hotCommentsAbortState.cancel();
        }
      });
    }
  ));

  const handleLoadMore = () => {
    const resourceId = props.resourceId;
    if (!isValidResourceId(resourceId) || commentLoading() || !commentHasMore()) return;
    void loadComments(resourceId, commentPage() + 1, true, createRequestAbortState());
  };

  const handleLikeComment = async (comment: NcmSongComment): Promise<void> => {
    const resourceId = props.resourceId;
    if (!isValidResourceId(resourceId) || likeBusyIds().includes(comment.commentId)) return;
    if (!canWrite()) {
      setFeedback({ tone: "error", message: t("ncm.comments.loginRequired") });
      return;
    }

    const wasLiked = comment.liked;
    const nextLiked = !wasLiked;
    const nextCount = Math.max(0, comment.likedCount + (nextLiked ? 1 : -1));
    setFeedback(null);
    setLikeBusyIds((current) => appendCommentBusy(current, comment.commentId));
    setHotComments((current) => patchComment(current, comment.commentId, (item) => ({
      ...item,
      liked: nextLiked,
      likedCount: nextCount
    })));
    setComments((current) => patchComment(current, comment.commentId, (item) => ({
      ...item,
      liked: nextLiked,
      likedCount: nextCount
    })));

    try {
      await commentLike(resourceId, comment.commentId, props.resourceType, nextLiked ? 1 : 2);
    } catch (error) {
      setHotComments((current) => patchComment(current, comment.commentId, (item) => ({
        ...item,
        liked: wasLiked,
        likedCount: comment.likedCount
      })));
      setComments((current) => patchComment(current, comment.commentId, (item) => ({
        ...item,
        liked: wasLiked,
        likedCount: comment.likedCount
      })));
      setFeedback({
        tone: "error",
        message: readErrorMessage(error, t("ncm.comments.likeFailed"))
      });
    } finally {
      setLikeBusyIds((current) => removeCommentBusy(current, comment.commentId));
    }
  };

  const handleHugComment = async (comment: NcmSongComment): Promise<void> => {
    const account = activeAccount();
    const resourceId = props.resourceId;
    if (
      !isValidResourceId(resourceId) ||
      account === null ||
      !account.hasCookie ||
      hugBusyIds().includes(comment.commentId)
    ) {
      if (!canWrite()) {
        setFeedback({ tone: "error", message: t("ncm.comments.loginRequired") });
      }
      return;
    }

    setFeedback(null);
    setHugBusyIds((current) => appendCommentBusy(current, comment.commentId));
    try {
      await hugComment(account.userId, comment.commentId, resourceId, props.resourceType);
      try {
        const hugList = readCommentHugListPayload(await commentHugList(
          account.userId,
          comment.commentId,
          resourceId,
          props.resourceType
        ));
        const count = getHugCount(hugList);
        setFeedback({
          tone: "success",
          message: count > 0
            ? t("ncm.comments.hugSuccessCount", { count })
            : t("ncm.comments.hugSuccess")
        });
      } catch {
        setFeedback({ tone: "success", message: t("ncm.comments.hugSuccess") });
      }
    } catch (error) {
      setFeedback({
        tone: "error",
        message: readErrorMessage(error, t("ncm.comments.hugFailed"))
      });
    } finally {
      setHugBusyIds((current) => removeCommentBusy(current, comment.commentId));
    }
  };

  const renderComment = (comment: NcmSongComment) => (
    <article class="ncm-resource-comment">
      <Show when={comment.user.avatarUrl} fallback={<span class="ncm-resource-comment-avatar" />}>
        {(avatarUrl) => (
          <SImage
            src={avatarUrl()}
            alt={comment.user.nickname}
            class="ncm-resource-comment-avatar"
            observeVisibility={true}
            shape="circle"
            aspect="square"
          />
        )}
      </Show>
      <div>
        <header>
          <strong>{comment.user.nickname}</strong>
          <div class="ncm-resource-comment-actions">
            <button
              type="button"
              class={comment.liked ? "ncm-resource-comment-action is-active" : "ncm-resource-comment-action"}
              title={comment.liked ? t("ncm.comments.unlike") : t("ncm.comments.like")}
              aria-label={comment.liked ? t("ncm.comments.unlike") : t("ncm.comments.like")}
              disabled={likeBusyIds().includes(comment.commentId)}
              onClick={() => void handleLikeComment(comment)}
            >
              <Show
                when={likeBusyIds().includes(comment.commentId)}
                fallback={comment.liked ? <IconThumbUpFilled /> : <IconThumbUp />}
              >
                <NaiveSpin size={15} ariaHidden />
              </Show>
              <span>{formatNumber(comment.likedCount)}</span>
            </button>
            <button
              type="button"
              class="ncm-resource-comment-action"
              title={t("ncm.comments.hug")}
              aria-label={t("ncm.comments.hug")}
              disabled={hugBusyIds().includes(comment.commentId)}
              onClick={() => void handleHugComment(comment)}
            >
              <Show when={hugBusyIds().includes(comment.commentId)} fallback={<IconHeart />}>
                <NaiveSpin size={15} ariaHidden />
              </Show>
            </button>
          </div>
        </header>
        <NaiveP>{comment.content}</NaiveP>
        <Show when={comment.beReplied}>
          {(reply) => (
            <div class="ncm-resource-comment-reply">
              <IconMessage />
              <span>
                @{reply().user.nickname}: {reply().content}
              </span>
            </div>
          )}
        </Show>
        <div class="ncm-resource-comment-meta">
          <Show when={formatDate(comment.time)}>
            {(date) => <small>{date()}</small>}
          </Show>
          <Show when={comment.ip?.location}>
            {(location) => <small>{td("ncm.comments.ipLocation", { location: location() })}</small>}
          </Show>
        </div>
      </div>
    </article>
  );

  const renderCommentList = (items: readonly NcmSongComment[], virtualized: boolean) =>
    virtualized ? (
      <VirtualizedCommentList items={items} renderComment={renderComment} />
    ) : (
      <div class="ncm-resource-comment-list">
        <For each={items}>
          {(comment) => renderComment(comment)}
        </For>
      </div>
    );

  return (
    <section
      class={`ncm-resource-comments${props.grouped === true ? " is-grouped" : ""}${props.class ? ` ${props.class}` : ""}`}
      data-page-scroll-root={props.pageScrollRoot === true ? "true" : undefined}
    >
      <Show when={props.grouped !== true}>
        <header class="ncm-resource-comments-head">
          <NaiveH3>
            <IconChat />
            {title()}
            <NaiveText depth={3}>{formatNumber(commentTotal())}</NaiveText>
          </NaiveH3>
          <div class="ncm-resource-comment-tabs">
            <button
              type="button"
              class={commentSort() === "hot" ? "is-active" : ""}
              onClick={() => setCommentSort("hot")}
            >
              {t("ncm.comments.hot")}
            </button>
            <button
              type="button"
              class={commentSort() === "new" ? "is-active" : ""}
              onClick={() => setCommentSort("new")}
            >
              {t("ncm.comments.new")}
            </button>
          </div>
        </header>
      </Show>

      <Show
        when={props.grouped === true}
        fallback={
          <Show
            when={comments().length > 0}
            fallback={
              <div class="ncm-resource-comments-empty">
                {commentLoading() ? t("ncm.comments.loading") : t("ncm.comments.empty")}
              </div>
            }
          >
            {renderCommentList(comments(), true)}
          </Show>
        }
      >
        <Show when={hotComments().length > 0 || hotCommentLoading()}>
          <section class="ncm-resource-comment-section">
            <div class="ncm-resource-comment-section-title">
              <IconFire />
              <span>{t("media.comments.hot")}</span>
            </div>
            <Show
              when={hotComments().length > 0}
              fallback={<div class="ncm-resource-comments-empty">{t("ncm.comments.loading")}</div>}
            >
              {renderCommentList(hotComments(), false)}
            </Show>
          </section>
        </Show>
        <section class="ncm-resource-comment-section">
          <div class="ncm-resource-comment-section-title">
            <IconMessage />
            <span>{t("media.comments.all")}</span>
            <Show when={commentTotal() > 0}>
              <NaiveText class="count" depth={3}>{formatNumber(commentTotal())}</NaiveText>
            </Show>
          </div>
          <Show
            when={comments().length > 0}
            fallback={
              <div class="ncm-resource-comments-empty">
                {commentLoading() ? t("ncm.comments.loading") : t("ncm.comments.empty")}
              </div>
            }
          >
            {renderCommentList(comments(), true)}
          </Show>
        </section>
      </Show>

      <Show when={feedback()}>
        {(item) => (
          <div class={item().tone === "error" ? "ncm-resource-comments-feedback status-error" : "ncm-resource-comments-feedback status-line"}>
            {item().message}
          </div>
        )}
      </Show>

      <Show when={commentHasMore()}>
        <button
          type="button"
          class="ghost-button ncm-resource-comments-more"
          disabled={commentLoading()}
          onClick={handleLoadMore}
        >
          {commentLoading() ? t("ncm.comments.loading") : t("ncm.comments.more")}
        </button>
      </Show>
    </section>
  );
}

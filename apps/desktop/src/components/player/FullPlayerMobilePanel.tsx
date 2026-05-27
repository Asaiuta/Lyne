import { Show, createEffect, createMemo, createSignal, type Component, type JSX } from "solid-js";
import { CoverArt } from "../CoverArt";
import { FullPlayerVinylNeedle } from "./FullPlayerPrimaryPanel";
import {
  IconChevronDown,
  IconHeart,
  IconHeartBit,
  IconHeartFilled,
  IconPause,
  IconPlay,
  IconShuffle,
  IconSkipNext,
  IconSkipPrev
} from "../icons";

interface FullPlayerMobileCoverProps {
  showCover: boolean;
  isPlaying: boolean;
  playerType: string;
  coverUrl: string | null;
  coverAlt: string;
}

interface FullPlayerMobileMetaProps {
  title: string;
  subtitle: string;
}

interface FullPlayerMobileActionsProps {
  showLike: boolean;
  isLiked: boolean;
  onClose: () => void;
  onToggleLike?: () => void;
}

interface FullPlayerMobileTransportProps {
  shuffleActive: boolean;
  shuffleLabel: string;
  isHeartbeat?: boolean;
  canSkipPrev: boolean;
  canSkipNext: boolean;
  isPlaying: boolean;
  playPauseLabel: string;
  repeatActive: boolean;
  repeatLabel: string;
  repeatIcon: Component;
  canSeek: boolean;
  duration: number;
  currentTime: number;
  progress: number;
  timeLeft: string;
  timeRight: string;
  onToggleShuffle: () => void;
  onSkipPrev: () => void;
  onPlayPause: () => void;
  onSkipNext: () => void;
  onCycleRepeat: () => void;
  onProgressClick: (event: MouseEvent) => void;
  onProgressKeyDown: (event: KeyboardEvent) => void;
}

interface FullPlayerMobileLabelsProps {
  close: string;
  favorite: string;
  transport: string;
  prev: string;
  next: string;
  seek: string;
}

interface FullPlayerMobilePanelProps {
  cover: FullPlayerMobileCoverProps;
  meta: FullPlayerMobileMetaProps;
  actions: FullPlayerMobileActionsProps;
  transport: FullPlayerMobileTransportProps;
  labels: FullPlayerMobileLabelsProps;
  hasLyrics: boolean;
  lyrics: () => JSX.Element;
}

const SWIPE_THRESHOLD_PX = 100;

export function FullPlayerMobilePanel(props: FullPlayerMobilePanelProps) {
  const [pageIndex, setPageIndex] = createSignal<number>(0);
  const [isSwiping, setIsSwiping] = createSignal<boolean>(false);
  const [swipeOffset, setSwipeOffset] = createSignal<number>(0);
  let pointerStartX = 0;
  let pointerId: number | null = null;

  const RepeatIcon = () => props.transport.repeatIcon;
  const hasLyricPage = () => props.hasLyrics;

  createEffect(() => {
    if (!hasLyricPage()) {
      setPageIndex(0);
      setSwipeOffset(0);
      setIsSwiping(false);
    }
  });

  const beginSwipe = (event: PointerEvent) => {
    if (!hasLyricPage()) return;
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    pointerId = event.pointerId;
    pointerStartX = event.clientX;
    setIsSwiping(true);
    setSwipeOffset(0);
    target.setPointerCapture(event.pointerId);
  };

  const updateSwipe = (event: PointerEvent) => {
    if (!isSwiping() || pointerId !== event.pointerId) return;
    let nextOffset = pointerStartX - event.clientX;
    if (pageIndex() === 0 && nextOffset < 0) {
      nextOffset *= 0.3;
    } else if (pageIndex() === 1 && nextOffset > 0) {
      nextOffset *= 0.3;
    }
    setSwipeOffset(nextOffset);
  };

  const endSwipe = (event: PointerEvent) => {
    if (!isSwiping() || pointerId !== event.pointerId) return;
    const target = event.currentTarget;
    if (target instanceof HTMLElement && target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    const offset = swipeOffset();
    if (offset > SWIPE_THRESHOLD_PX) {
      setPageIndex(1);
    } else if (offset < -SWIPE_THRESHOLD_PX) {
      setPageIndex(0);
    }
    pointerId = null;
    setSwipeOffset(0);
    setIsSwiping(false);
  };

  const mobileContentStyle = createMemo<JSX.CSSProperties>(() => ({
    transform: `translateX(calc(-${pageIndex() * 50}% - ${swipeOffset()}px))`
  }));

  return (
    <section class="full-player-mobile">
      <div class="full-player-mobile-topbar">
        <button
          type="button"
          class="full-player-mobile-topbar-button"
          onClick={props.actions.onClose}
          aria-label={props.labels.close}
          title={props.labels.close}
        >
          <IconChevronDown />
        </button>
      </div>

      <div
        class={`full-player-mobile-content${isSwiping() ? " is-swiping" : ""}`}
        style={mobileContentStyle()}
        onPointerDown={beginSwipe}
        onPointerMove={updateSwipe}
        onPointerUp={endSwipe}
        onPointerCancel={endSwipe}
      >
        <div class="full-player-mobile-page full-player-mobile-info-page">
          <div class="full-player-mobile-cover-section">
            <Show when={props.cover.showCover}>
              <div
                class={`full-player-mobile-cover full-player-cover${props.cover.isPlaying ? " is-playing" : ""}`}
              >
                <Show when={props.cover.playerType === "record"}>
                  <FullPlayerVinylNeedle />
                </Show>
                <CoverArt coverUrl={props.cover.coverUrl} alt={props.cover.coverAlt} />
              </div>
            </Show>
          </div>

          <div class="full-player-mobile-info-group">
            <div class="full-player-mobile-song-info-bar">
              <div class="full-player-mobile-info-section">
                <div class="full-player-mobile-title">{props.meta.title}</div>
                <div class="full-player-mobile-subtitle">{props.meta.subtitle}</div>
              </div>
              <div class="full-player-mobile-info-actions">
                <Show when={props.actions.showLike}>
                  <button
                    type="button"
                    class={`full-player-mobile-action-button${props.actions.isLiked ? " is-active" : ""}`}
                    onClick={() => props.actions.onToggleLike?.()}
                    disabled={!props.actions.onToggleLike}
                    aria-label={props.labels.favorite}
                    aria-pressed={props.actions.isLiked}
                    title={props.labels.favorite}
                  >
                    <Show when={props.actions.isLiked} fallback={<IconHeart />}>
                      <IconHeartFilled />
                    </Show>
                  </button>
                </Show>
              </div>
            </div>

            <div class="full-player-mobile-progress-section">
              <span class="full-player-mobile-time">{props.transport.timeLeft}</span>
              <div
                class={`full-player-mobile-progress${props.transport.canSeek ? " is-interactive" : ""}`}
                role={props.transport.canSeek ? "slider" : "presentation"}
                aria-label={props.transport.canSeek ? props.labels.seek : undefined}
                aria-valuemin={props.transport.canSeek ? 0 : undefined}
                aria-valuemax={props.transport.canSeek ? Math.round(props.transport.duration) : undefined}
                aria-valuenow={props.transport.canSeek ? Math.round(props.transport.currentTime) : undefined}
                tabIndex={props.transport.canSeek ? 0 : -1}
                onClick={props.transport.onProgressClick}
                onKeyDown={props.transport.onProgressKeyDown}
              >
                <div
                  class="full-player-mobile-progress-fill"
                  style={{ width: `${props.transport.progress * 100}%` }}
                />
              </div>
              <span class="full-player-mobile-time">{props.transport.timeRight}</span>
            </div>

            <div class="full-player-mobile-control-section" role="group" aria-label={props.labels.transport}>
              <button
                type="button"
                class={`full-player-mobile-mode-button${props.transport.shuffleActive ? " is-active" : ""}`}
                onClick={props.transport.onToggleShuffle}
                aria-label={props.transport.shuffleLabel}
                aria-pressed={props.transport.shuffleActive}
                title={props.transport.shuffleLabel}
              >
                <Show when={props.transport.isHeartbeat} fallback={<IconShuffle />}>
                  <IconHeartBit />
                </Show>
              </button>
              <button
                type="button"
                class="full-player-mobile-control-button"
                onClick={props.transport.onSkipPrev}
                disabled={!props.transport.canSkipPrev}
                aria-label={props.labels.prev}
                title={props.labels.prev}
              >
                <IconSkipPrev />
              </button>
              <button
                type="button"
                class="full-player-mobile-play-button"
                onClick={props.transport.onPlayPause}
                aria-label={props.transport.playPauseLabel}
                title={props.transport.playPauseLabel}
              >
                <Show when={props.transport.isPlaying} fallback={<IconPlay />}>
                  <IconPause />
                </Show>
              </button>
              <button
                type="button"
                class="full-player-mobile-control-button"
                onClick={props.transport.onSkipNext}
                disabled={!props.transport.canSkipNext}
                aria-label={props.labels.next}
                title={props.labels.next}
              >
                <IconSkipNext />
              </button>
              <button
                type="button"
                class={`full-player-mobile-mode-button${props.transport.repeatActive ? " is-active" : ""}`}
                onClick={props.transport.onCycleRepeat}
                aria-label={props.transport.repeatLabel}
                aria-pressed={props.transport.repeatActive}
                title={props.transport.repeatLabel}
              >
                {(() => {
                  const Icon = RepeatIcon();
                  return <Icon />;
                })()}
              </button>
            </div>
          </div>
        </div>

        <Show when={hasLyricPage()}>
          <div class="full-player-mobile-page full-player-mobile-lyric-page">
            <div class="full-player-mobile-lyric-header">
              <div class="full-player-mobile-lyric-cover">
                <CoverArt coverUrl={props.cover.coverUrl} alt={props.cover.coverAlt} />
              </div>
              <div class="full-player-mobile-lyric-info">
                <div class="full-player-mobile-lyric-title">{props.meta.title}</div>
                <div class="full-player-mobile-lyric-subtitle">{props.meta.subtitle}</div>
              </div>
              <Show when={props.actions.showLike}>
                <button
                  type="button"
                  class={`full-player-mobile-action-button${props.actions.isLiked ? " is-active" : ""}`}
                  onClick={() => props.actions.onToggleLike?.()}
                  disabled={!props.actions.onToggleLike}
                  aria-label={props.labels.favorite}
                  aria-pressed={props.actions.isLiked}
                  title={props.labels.favorite}
                >
                  <Show when={props.actions.isLiked} fallback={<IconHeart />}>
                    <IconHeartFilled />
                  </Show>
                </button>
              </Show>
            </div>
            <div class="full-player-mobile-lyric-main">{props.lyrics()}</div>
          </div>
        </Show>
      </div>

      <Show when={hasLyricPage()}>
        <div class="full-player-mobile-pagination" aria-hidden="true">
          <button
            type="button"
            class={`full-player-mobile-dot${pageIndex() === 0 ? " is-active" : ""}`}
            onClick={() => setPageIndex(0)}
            tabIndex={-1}
          />
          <button
            type="button"
            class={`full-player-mobile-dot${pageIndex() === 1 ? " is-active" : ""}`}
            onClick={() => setPageIndex(1)}
            tabIndex={-1}
          />
        </div>
      </Show>
    </section>
  );
}

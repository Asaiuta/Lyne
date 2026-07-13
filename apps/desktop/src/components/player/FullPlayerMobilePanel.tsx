import { Show, createEffect, createMemo, createSignal, type Component, type JSX } from "solid-js";
import { CoverArt } from "../CoverArt";
import {
  FullPlayerActionButton,
  FullPlayerTimeButton
} from "./FullPlayerInteractions";
import { FullPlayerVinylNeedle } from "./FullPlayerPrimaryPanel";
import {
  IconChevronDown,
  IconHeart,
  IconHeartBit,
  IconHeartFilled,
  IconPause,
  IconPlaylist,
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
  showAddToPlaylist: boolean;
  canAddToPlaylist: boolean;
  onClose: () => void;
  onToggleLike?: () => void;
  onAddToPlaylist?: () => void;
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
  timeToggleLabel: string;
  onToggleShuffle: () => void;
  onSkipPrev: () => void;
  onPlayPause: () => void;
  onSkipNext: () => void;
  onCycleRepeat: () => void;
  onCycleTimeFormat: () => void;
  onProgressClick: (event: MouseEvent) => void;
  onProgressKeyDown: (event: KeyboardEvent) => void;
}

interface FullPlayerMobileLabelsProps {
  close: string;
  favorite: string;
  addToPlaylist: string;
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
        <FullPlayerActionButton
          class="full-player-mobile-topbar-button"
          onClick={props.actions.onClose}
          label={props.labels.close}
          title={props.labels.close}
        >
          <IconChevronDown />
        </FullPlayerActionButton>
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
                  <FullPlayerActionButton
                    class="full-player-mobile-action-button"
                    onClick={() => props.actions.onToggleLike?.()}
                    disabled={!props.actions.onToggleLike}
                    label={props.labels.favorite}
                    pressed={props.actions.isLiked}
                    title={props.labels.favorite}
                    active={props.actions.isLiked}
                  >
                    <Show when={props.actions.isLiked} fallback={<IconHeart />}>
                      <IconHeartFilled />
                    </Show>
                  </FullPlayerActionButton>
                </Show>
                <Show when={props.actions.showAddToPlaylist}>
                  <FullPlayerActionButton
                    class="full-player-mobile-action-button"
                    onClick={() => props.actions.onAddToPlaylist?.()}
                    disabled={!props.actions.canAddToPlaylist || !props.actions.onAddToPlaylist}
                    label={props.labels.addToPlaylist}
                    title={props.labels.addToPlaylist}
                  >
                    <IconPlaylist />
                  </FullPlayerActionButton>
                </Show>
              </div>
            </div>

            <div class="full-player-mobile-progress-section">
              <FullPlayerTimeButton
                class="full-player-mobile-time"
                onClick={props.transport.onCycleTimeFormat}
                label={props.transport.timeToggleLabel}
              >
                {props.transport.timeLeft}
              </FullPlayerTimeButton>
              <div
                class={`full-player-mobile-progress${props.transport.canSeek ? " is-interactive" : ""}`}
                style={{ "--full-player-mobile-progress-scale": String(props.transport.progress) }}
                role={props.transport.canSeek ? "slider" : "presentation"}
                aria-label={props.transport.canSeek ? props.labels.seek : undefined}
                aria-valuemin={props.transport.canSeek ? 0 : undefined}
                aria-valuemax={props.transport.canSeek ? Math.round(props.transport.duration) : undefined}
                aria-valuenow={props.transport.canSeek ? Math.round(props.transport.currentTime) : undefined}
                tabIndex={props.transport.canSeek ? 0 : -1}
                onClick={props.transport.onProgressClick}
                onKeyDown={props.transport.onProgressKeyDown}
              >
                <div class="full-player-mobile-progress-fill" />
              </div>
              <FullPlayerTimeButton
                class="full-player-mobile-time"
                onClick={props.transport.onCycleTimeFormat}
                label={props.transport.timeToggleLabel}
              >
                {props.transport.timeRight}
              </FullPlayerTimeButton>
            </div>

            <div class="full-player-mobile-control-section" role="group" aria-label={props.labels.transport}>
              <FullPlayerActionButton
                class="full-player-mobile-mode-button"
                onClick={props.transport.onToggleShuffle}
                label={props.transport.shuffleLabel}
                pressed={props.transport.shuffleActive}
                title={props.transport.shuffleLabel}
                active={props.transport.shuffleActive}
              >
                <Show when={props.transport.isHeartbeat} fallback={<IconShuffle />}>
                  <IconHeartBit />
                </Show>
              </FullPlayerActionButton>
              <FullPlayerActionButton
                class="full-player-mobile-control-button"
                onClick={props.transport.onSkipPrev}
                disabled={!props.transport.canSkipPrev}
                label={props.labels.prev}
                title={props.labels.prev}
              >
                <IconSkipPrev />
              </FullPlayerActionButton>
              <FullPlayerActionButton
                class="full-player-mobile-play-button"
                onClick={props.transport.onPlayPause}
                label={props.transport.playPauseLabel}
                title={props.transport.playPauseLabel}
              >
                <Show when={props.transport.isPlaying} fallback={<IconPlay />}>
                  <IconPause />
                </Show>
              </FullPlayerActionButton>
              <FullPlayerActionButton
                class="full-player-mobile-control-button"
                onClick={props.transport.onSkipNext}
                disabled={!props.transport.canSkipNext}
                label={props.labels.next}
                title={props.labels.next}
              >
                <IconSkipNext />
              </FullPlayerActionButton>
              <FullPlayerActionButton
                class="full-player-mobile-mode-button"
                onClick={props.transport.onCycleRepeat}
                label={props.transport.repeatLabel}
                pressed={props.transport.repeatActive}
                title={props.transport.repeatLabel}
                active={props.transport.repeatActive}
              >
                {(() => {
                  const Icon = RepeatIcon();
                  return <Icon />;
                })()}
              </FullPlayerActionButton>
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
                <FullPlayerActionButton
                  class="full-player-mobile-action-button"
                  onClick={() => props.actions.onToggleLike?.()}
                  disabled={!props.actions.onToggleLike}
                  label={props.labels.favorite}
                  pressed={props.actions.isLiked}
                  title={props.labels.favorite}
                  active={props.actions.isLiked}
                >
                  <Show when={props.actions.isLiked} fallback={<IconHeart />}>
                    <IconHeartFilled />
                  </Show>
                </FullPlayerActionButton>
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

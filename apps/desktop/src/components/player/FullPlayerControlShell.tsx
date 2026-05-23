import { Show } from "solid-js";
import type { Component } from "solid-js";
import { PlayerVolumePopover } from "./PlayerVolumePopover";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconControls,
  IconCopy,
  IconDesktopLyric,
  IconDownload,
  IconHeart,
  IconHeartBit,
  IconHeartFilled,
  IconMessage,
  IconPause,
  IconPlaylist,
  IconPlay,
  IconShuffle,
  IconSkipNext,
  IconSkipPrev
} from "../icons";

interface FullPlayerShellLabels {
  close: string;
  favorite: string;
  addToPlaylist: string;
  download: string;
  copyLyric: string;
  lyricOffset: string;
  lyricSettings: string;
  comment: string;
  transport: string;
  prev: string;
  next: string;
  seek: string;
  queue: string;
  more: string;
  desktopLyric: string;
  qualityTag: string;
  volumeButton: string;
  volumeDialog: string;
}

interface FullPlayerShellActionsSection {
  showLike: boolean;
  isLiked: boolean;
  showAddToPlaylist: boolean;
  showDownload: boolean;
  showCopyLyric: boolean;
  canCopyLyric: boolean;
  showLyricOffset: boolean;
  canAdjustLyricOffset: boolean;
  lyricOffsetValue: string;
  showLyricSettings: boolean;
  showComments: boolean;
  showCommentCount: boolean;
  commentCount: number;
  commentActive: boolean;
  commentsEnabled: boolean;
  onClose: () => void;
  onToggleLike?: () => void;
  onCopyLyric: () => void;
  onDecreaseLyricOffset: () => void;
  onIncreaseLyricOffset: () => void;
  onResetLyricOffset: () => void;
  onOpenLyricSettings?: () => void;
  onToggleComment: () => void;
}

interface FullPlayerShellTransportSection {
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

interface FullPlayerShellUtilitySection {
  showPlayerQuality: boolean;
  showDesktopLyric: boolean;
  showMoreSettings: boolean;
  volumeOpen: boolean;
  volumeValue: number;
  volumeIcon: Component;
  onToggleVolume: () => void;
  onVolumeChange: (value: number) => void;
  onOpenQueue: () => void;
  volumeContainerRef?: (element: HTMLDivElement) => void;
}

interface FullPlayerControlShellProps {
  visible: boolean;
  labels: FullPlayerShellLabels;
  actions: FullPlayerShellActionsSection;
  transport: FullPlayerShellTransportSection;
  utility: FullPlayerShellUtilitySection;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function FullPlayerControlShell(props: FullPlayerControlShellProps) {
  const RepeatIcon = () => props.transport.repeatIcon;
  const VolumeIcon = () => props.utility.volumeIcon;

  return (
    <div
      class={`full-player-control-shell${props.visible ? " is-visible" : ""}`}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
    >
      <div class="full-player-control-side">
        <button
          type="button"
          class="full-player-menu-icon"
          onClick={props.actions.onClose}
          aria-label={props.labels.close}
          title={props.labels.close}
        >
          <IconChevronDown />
        </button>
        <Show when={props.actions.showLike}>
          <button
            type="button"
            class={`full-player-menu-icon${props.actions.isLiked ? " is-active" : ""}`}
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
        <Show when={props.actions.showAddToPlaylist}>
          <button
            type="button"
            class="full-player-menu-icon"
            aria-label={props.labels.addToPlaylist}
            title={props.labels.addToPlaylist}
          >
            <IconPlaylist />
          </button>
        </Show>
        <Show when={props.actions.showDownload}>
          <button
            type="button"
            class="full-player-menu-icon"
            aria-label={props.labels.download}
            title={props.labels.download}
          >
            <IconDownload />
          </button>
        </Show>
        <Show when={props.actions.showCopyLyric}>
          <button
            type="button"
            class="full-player-menu-icon"
            onClick={props.actions.onCopyLyric}
            disabled={!props.actions.canCopyLyric}
            aria-label={props.labels.copyLyric}
            title={props.labels.copyLyric}
          >
            <IconCopy />
          </button>
        </Show>
        <Show when={props.actions.showLyricOffset}>
          <div class="full-player-lyric-offset-control" role="group" aria-label={props.labels.lyricOffset}>
            <button
              type="button"
              class="full-player-menu-icon"
              onClick={props.actions.onDecreaseLyricOffset}
              disabled={!props.actions.canAdjustLyricOffset}
              aria-label={`${props.labels.lyricOffset} -500ms`}
              title={`${props.labels.lyricOffset} -500ms`}
            >
              <IconChevronLeft />
            </button>
            <button
              type="button"
              class="full-player-lyric-offset-value"
              onClick={props.actions.onResetLyricOffset}
              disabled={!props.actions.canAdjustLyricOffset || props.actions.lyricOffsetValue === "0s"}
              aria-label={`${props.labels.lyricOffset} ${props.actions.lyricOffsetValue}`}
              title={props.labels.lyricOffset}
            >
              {props.actions.lyricOffsetValue}
            </button>
            <button
              type="button"
              class="full-player-menu-icon"
              onClick={props.actions.onIncreaseLyricOffset}
              disabled={!props.actions.canAdjustLyricOffset}
              aria-label={`${props.labels.lyricOffset} +500ms`}
              title={`${props.labels.lyricOffset} +500ms`}
            >
              <IconChevronRight />
            </button>
          </div>
        </Show>
        <Show when={props.actions.showLyricSettings}>
          <button
            type="button"
            class="full-player-menu-icon"
            onClick={() => props.actions.onOpenLyricSettings?.()}
            aria-label={props.labels.lyricSettings}
            title={props.labels.lyricSettings}
            disabled={!props.actions.onOpenLyricSettings}
          >
            <IconControls />
          </button>
        </Show>
        <Show when={props.actions.showComments}>
          <button
            type="button"
            class={`full-player-menu-icon${props.actions.commentActive ? " is-active" : ""}`}
            onClick={props.actions.onToggleComment}
            disabled={!props.actions.commentsEnabled}
            aria-label={props.labels.comment}
            aria-pressed={props.actions.commentActive}
            title={props.labels.comment}
          >
            <IconMessage />
            <Show when={props.actions.showCommentCount && props.actions.commentCount > 0}>
              <span class="full-player-icon-badge">
                {props.actions.commentCount > 999 ? "999+" : props.actions.commentCount}
              </span>
            </Show>
          </button>
        </Show>
      </div>

      <div class="full-player-control-center">
        <div class="full-player-transport" role="group" aria-label={props.labels.transport}>
          <button
            type="button"
            class={`transport-button mode-button${props.transport.shuffleActive ? " is-active" : ""}`}
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
            class="transport-button"
            onClick={props.transport.onSkipPrev}
            disabled={!props.transport.canSkipPrev}
            aria-label={props.labels.prev}
            title={props.labels.prev}
          >
            <IconSkipPrev />
          </button>
          <button
            type="button"
            class="transport-button transport-primary"
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
            class="transport-button"
            onClick={props.transport.onSkipNext}
            disabled={!props.transport.canSkipNext}
            aria-label={props.labels.next}
            title={props.labels.next}
          >
            <IconSkipNext />
          </button>
          <button
            type="button"
            class={`transport-button mode-button${props.transport.repeatActive ? " is-active" : ""}`}
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

        <div class="full-player-progress-wrap">
          <span class="full-player-time">{props.transport.timeLeft}</span>
          <div
            class={`full-player-progress${props.transport.canSeek ? " is-interactive" : ""}`}
            role={props.transport.canSeek ? "slider" : "presentation"}
            aria-label={props.transport.canSeek ? props.labels.seek : undefined}
            aria-valuemin={props.transport.canSeek ? 0 : undefined}
            aria-valuemax={props.transport.canSeek ? Math.round(props.transport.duration) : undefined}
            aria-valuenow={props.transport.canSeek ? Math.round(props.transport.currentTime) : undefined}
            tabIndex={props.transport.canSeek ? 0 : -1}
            onClick={props.transport.onProgressClick}
            onKeyDown={props.transport.onProgressKeyDown}
          >
            <div class="full-player-progress-fill" style={{ width: `${props.transport.progress * 100}%` }} />
          </div>
          <span class="full-player-time">{props.transport.timeRight}</span>
        </div>
      </div>

      <div class="full-player-control-side is-right">
        <Show when={props.utility.showPlayerQuality}>
          <span class="full-player-quality-tag">{props.labels.qualityTag}</span>
        </Show>
        <Show when={props.utility.showDesktopLyric}>
          <button
            type="button"
            class="full-player-menu-icon full-player-utility-disabled"
            aria-label={props.labels.desktopLyric}
            title={props.labels.desktopLyric}
            disabled
          >
            <IconDesktopLyric />
          </button>
        </Show>
        <Show when={props.utility.showMoreSettings}>
          <button
            type="button"
            class="full-player-menu-icon full-player-utility-disabled"
            aria-label={props.labels.more}
            title={props.labels.more}
            disabled
          >
            <IconControls />
          </button>
        </Show>
        <div class="full-player-volume" ref={props.utility.volumeContainerRef}>
          <PlayerVolumePopover
            open={props.utility.volumeOpen}
            value={props.utility.volumeValue}
            icon={VolumeIcon()}
            buttonClass="full-player-menu-icon"
            popoverClass="full-player-volume-popover"
            buttonLabel={props.labels.volumeButton}
            dialogLabel={props.labels.volumeDialog}
            buttonTitle={props.labels.volumeButton}
            onToggle={props.utility.onToggleVolume}
            onValueChange={props.utility.onVolumeChange}
          />
        </div>
        <button
          type="button"
          class="full-player-menu-icon"
          onClick={props.utility.onOpenQueue}
          aria-label={props.labels.queue}
          title={props.labels.queue}
        >
          <IconPlaylist />
        </button>
      </div>
    </div>
  );
}

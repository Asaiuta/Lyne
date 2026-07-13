import { Show } from "solid-js";
import type { Component, JSX } from "solid-js";
import {
  FullPlayerActionButton,
  FullPlayerTimeButton,
  FullPlayerTransportButton
} from "./FullPlayerInteractions";
import { PlayerVolumePopover } from "./PlayerVolumePopover";
import {
  IconChevronDown,
  IconControls,
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
  canAddToPlaylist: boolean;
  showDownload: boolean;
  canDownload: boolean;
  showComments: boolean;
  showCommentCount: boolean;
  commentCount: number;
  commentActive: boolean;
  commentsEnabled: boolean;
  onClose: () => void;
  onToggleLike?: () => void;
  onAddToPlaylist?: () => void;
  onDownload?: () => void;
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

interface FullPlayerShellUtilitySection {
  showPlayerQuality: boolean;
  showDesktopLyric: boolean;
  showMoreSettings: boolean;
  volumeOpen: boolean;
  volumeValue: number;
  volumeIcon: Component;
  onVolumeOpenChange: (open: boolean) => void;
  onToggleMute: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
  onVolumePreview?: (value: number) => void;
  onVolumeChange: (value: number) => void;
  onVolumeWheel: JSX.EventHandlerUnion<HTMLButtonElement, WheelEvent>;
  onOpenQueue: () => void;
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
        <FullPlayerActionButton
          class="full-player-menu-icon"
          onClick={props.actions.onClose}
          label={props.labels.close}
          title={props.labels.close}
        >
          <IconChevronDown />
        </FullPlayerActionButton>
        <Show when={props.actions.showLike}>
          <FullPlayerActionButton
            class="full-player-menu-icon"
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
            class="full-player-menu-icon"
            onClick={() => props.actions.onAddToPlaylist?.()}
            disabled={!props.actions.canAddToPlaylist || !props.actions.onAddToPlaylist}
            label={props.labels.addToPlaylist}
            title={props.labels.addToPlaylist}
          >
            <IconPlaylist />
          </FullPlayerActionButton>
        </Show>
        <Show when={props.actions.showDownload}>
          <FullPlayerActionButton
            class="full-player-menu-icon"
            onClick={() => props.actions.onDownload?.()}
            disabled={!props.actions.canDownload || !props.actions.onDownload}
            label={props.labels.download}
            title={props.labels.download}
          >
            <IconDownload />
          </FullPlayerActionButton>
        </Show>
        <Show when={props.actions.showComments}>
          <FullPlayerActionButton
            class="full-player-menu-icon"
            onClick={props.actions.onToggleComment}
            disabled={!props.actions.commentsEnabled}
            label={props.labels.comment}
            pressed={props.actions.commentActive}
            title={props.labels.comment}
            active={props.actions.commentActive}
          >
            <IconMessage />
            <Show when={props.actions.showCommentCount && props.actions.commentCount > 0}>
              <span class="full-player-icon-badge">
                {props.actions.commentCount > 999 ? "999+" : props.actions.commentCount}
              </span>
            </Show>
          </FullPlayerActionButton>
        </Show>
      </div>

      <div class="full-player-control-center">
        <div class="full-player-transport" role="group" aria-label={props.labels.transport}>
          <FullPlayerTransportButton
            mode
            onClick={props.transport.onToggleShuffle}
            label={props.transport.shuffleLabel}
            pressed={props.transport.shuffleActive}
            title={props.transport.shuffleLabel}
            active={props.transport.shuffleActive}
          >
            <Show when={props.transport.isHeartbeat} fallback={<IconShuffle />}>
              <IconHeartBit />
            </Show>
          </FullPlayerTransportButton>
          <FullPlayerTransportButton
            onClick={props.transport.onSkipPrev}
            disabled={!props.transport.canSkipPrev}
            label={props.labels.prev}
            title={props.labels.prev}
          >
            <IconSkipPrev />
          </FullPlayerTransportButton>
          <FullPlayerTransportButton
            primary
            onClick={props.transport.onPlayPause}
            label={props.transport.playPauseLabel}
            title={props.transport.playPauseLabel}
          >
            <Show when={props.transport.isPlaying} fallback={<IconPlay />}>
              <IconPause />
            </Show>
          </FullPlayerTransportButton>
          <FullPlayerTransportButton
            onClick={props.transport.onSkipNext}
            disabled={!props.transport.canSkipNext}
            label={props.labels.next}
            title={props.labels.next}
          >
            <IconSkipNext />
          </FullPlayerTransportButton>
          <FullPlayerTransportButton
            mode
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
          </FullPlayerTransportButton>
        </div>

        <div class="full-player-progress-wrap">
          <FullPlayerTimeButton
            class="full-player-time"
            onClick={props.transport.onCycleTimeFormat}
            label={props.transport.timeToggleLabel}
          >
            {props.transport.timeLeft}
          </FullPlayerTimeButton>
          <div
            class={`full-player-progress${props.transport.canSeek ? " is-interactive" : ""}`}
            style={{ "--full-player-progress-scale": String(props.transport.progress) }}
            role={props.transport.canSeek ? "slider" : "presentation"}
            aria-label={props.transport.canSeek ? props.labels.seek : undefined}
            aria-valuemin={props.transport.canSeek ? 0 : undefined}
            aria-valuemax={props.transport.canSeek ? Math.round(props.transport.duration) : undefined}
            aria-valuenow={props.transport.canSeek ? Math.round(props.transport.currentTime) : undefined}
            tabIndex={props.transport.canSeek ? 0 : -1}
            onClick={props.transport.onProgressClick}
            onKeyDown={props.transport.onProgressKeyDown}
          >
            <div class="full-player-progress-fill" />
            <div
              class="full-player-progress-thumb"
              style={{ left: `${props.transport.progress * 100}%` }}
              aria-hidden="true"
            />
          </div>
          <FullPlayerTimeButton
            class="full-player-time"
            onClick={props.transport.onCycleTimeFormat}
            label={props.transport.timeToggleLabel}
          >
            {props.transport.timeRight}
          </FullPlayerTimeButton>
        </div>
      </div>

      <div class="full-player-control-side is-right">
        <Show when={props.utility.showPlayerQuality}>
          <span class="full-player-quality-tag">{props.labels.qualityTag}</span>
        </Show>
        <Show when={props.utility.showDesktopLyric}>
          <FullPlayerActionButton
            class="full-player-menu-icon"
            label={props.labels.desktopLyric}
            title={props.labels.desktopLyric}
            disabled
          >
            <IconDesktopLyric />
          </FullPlayerActionButton>
        </Show>
        <Show when={props.utility.showMoreSettings}>
          <FullPlayerActionButton
            class="full-player-menu-icon"
            label={props.labels.more}
            title={props.labels.more}
            disabled
          >
            <IconControls />
          </FullPlayerActionButton>
        </Show>
        <div class="full-player-volume">
          <PlayerVolumePopover
            open={props.utility.volumeOpen}
            value={props.utility.volumeValue}
            icon={VolumeIcon()}
            buttonClass="full-player-action-button full-player-menu-icon"
            popoverClass="full-player-volume-popover"
            buttonLabel={props.labels.volumeButton}
            dialogLabel={props.labels.volumeDialog}
            buttonTitle={props.labels.volumeButton}
            onOpenChange={props.utility.onVolumeOpenChange}
            onValuePreview={props.utility.onVolumePreview}
            onValueChange={props.utility.onVolumeChange}
            valueClass="volume-value"
            triggerRootStyle={{ width: "40px", height: "40px" }}
            onButtonClick={props.utility.onToggleMute}
            onButtonWheel={props.utility.onVolumeWheel}
          />
        </div>
        <FullPlayerActionButton
          class="full-player-menu-icon"
          onClick={props.utility.onOpenQueue}
          label={props.labels.queue}
          title={props.labels.queue}
        >
          <IconPlaylist />
        </FullPlayerActionButton>
      </div>
    </div>
  );
}

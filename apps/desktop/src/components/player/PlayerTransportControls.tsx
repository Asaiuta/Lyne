import { Show } from "solid-js";
import type { Component } from "solid-js";
import {
  IconPause,
  IconPlay,
  IconShuffle,
  IconSkipNext,
  IconSkipPrev,
  IconSpinner,
  IconThumbDown
} from "../icons";

interface PlayerTransportControlsProps {
  isPlaying: boolean;
  isPlayLoading: boolean;
  canSkipPrev: boolean;
  canSkipNext: boolean;
  shuffleActive: boolean;
  shuffleIcon?: Component;
  repeatActive: boolean;
  repeatIcon: Component;
  playPauseLabel: string;
  shuffleLabel: string;
  repeatLabel: string;
  prevLabel: string;
  prevTitle: string;
  nextLabel: string;
  nextTitle: string;
  transportLabel: string;
  isPersonalFm?: boolean;
  isRadio?: boolean;
  personalFmTrashLabel?: string;
  onPersonalFmTrash?: () => void;
  onPlayPause: () => void;
  onSkipPrev: () => void;
  onSkipNext: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
}

export function PlayerTransportControls(props: PlayerTransportControlsProps) {
  const RepeatIcon = () => props.repeatIcon;
  const ShuffleIcon = () => props.shuffleIcon ?? IconShuffle;
  const showModeButtons = () => !props.isRadio && !props.isPersonalFm;

  return (
    <div class="player-bar-transport" role="group" aria-label={props.transportLabel}>
      <Show when={showModeButtons()}>
        <button
          type="button"
          class={`transport-button mode-button${props.shuffleActive ? " is-active" : ""}`}
          onClick={props.onToggleShuffle}
          aria-label={props.shuffleLabel}
          aria-pressed={props.shuffleActive}
          title={props.shuffleLabel}
        >
          {(() => {
            const Icon = ShuffleIcon();
            return <Icon />;
          })()}
        </button>
      </Show>
      <Show
        when={props.isPersonalFm}
        fallback={
          <button
            type="button"
            class="transport-button"
            onClick={props.onSkipPrev}
            disabled={!props.canSkipPrev}
            aria-label={props.prevLabel}
            title={props.prevTitle}
          >
            <IconSkipPrev />
          </button>
        }
      >
        <button
          type="button"
          class="transport-button"
          onClick={() => props.onPersonalFmTrash?.()}
          aria-label={props.personalFmTrashLabel ?? props.prevLabel}
          title={props.personalFmTrashLabel ?? props.prevTitle}
        >
          <IconThumbDown />
        </button>
      </Show>
      <button
        type="button"
        class={`transport-button transport-primary${props.isPlayLoading ? " is-loading" : ""}`}
        onClick={props.onPlayPause}
        aria-label={props.playPauseLabel}
        title={props.playPauseLabel}
        disabled={props.isPlayLoading}
      >
        <Show
          when={props.isPlayLoading}
          fallback={
            <Show
              when={props.isPlaying}
              fallback={
                <span class="transport-icon-swap" aria-hidden="true">
                  <IconPlay />
                </span>
              }
            >
              <span class="transport-icon-swap" aria-hidden="true">
                <IconPause />
              </span>
            </Show>
          }
        >
          <span class="transport-icon-swap transport-spinner" aria-hidden="true">
            <IconSpinner />
          </span>
        </Show>
      </button>
      <button
        type="button"
        class="transport-button"
        onClick={props.onSkipNext}
        disabled={!props.canSkipNext}
        aria-label={props.nextLabel}
        title={props.nextTitle}
      >
        <IconSkipNext />
      </button>
      <Show when={showModeButtons()}>
        <button
          type="button"
          class={`transport-button mode-button${props.repeatActive ? " is-active" : ""}`}
          onClick={props.onCycleRepeat}
          aria-label={props.repeatLabel}
          aria-pressed={props.repeatActive}
          title={props.repeatLabel}
        >
          {(() => {
            const Icon = RepeatIcon();
            return <Icon />;
          })()}
        </button>
      </Show>
    </div>
  );
}

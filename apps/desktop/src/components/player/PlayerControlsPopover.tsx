import { Show } from "solid-js";
import { IconControls } from "../icons";

interface PlayerControlsPopoverProps {
  open: boolean;
  buttonLabel: string;
  menuLabel: string;
  equalizerLabel: string;
  autoCloseLabel: string;
  abLoopLabel: string;
  playbackRateLabel: string;
  unavailableDetail: string;
  unavailableSuffix: string;
  onToggle: () => void;
  onClose: () => void;
}

export function PlayerControlsPopover(props: PlayerControlsPopoverProps) {
  const items = [
    { key: "equalizer", label: props.equalizerLabel },
    { key: "autoClose", label: props.autoCloseLabel },
    { key: "abLoop", label: props.abLoopLabel },
    { key: "playbackRate", label: props.playbackRateLabel }
  ] as const;

  return (
    <>
      <button
        type="button"
        class={`player-inline-icon player-utility-button player-utility-hidden w-38px h-38px${props.open ? " is-open" : ""}`}
        aria-label={props.buttonLabel}
        title={props.buttonLabel}
        aria-haspopup="menu"
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        <IconControls />
      </button>
      <Show when={props.open}>
        <div
          class="player-controls-popover absolute min-w-220px flex flex-col gap-2"
          role="menu"
          aria-label={props.menuLabel}
        >
          <div class="player-popover-title text-13px font-semibold">{props.menuLabel}</div>
          {items.map((item) => (
            <button
              type="button"
              class="player-menu-item flex items-center justify-between gap-3 min-h-34px text-left"
              role="menuitem"
              disabled
              title={`${item.label}${props.unavailableSuffix}`}
              onClick={props.onClose}
            >
              <span>{item.label}</span>
              <span class="player-menu-item-meta">{props.unavailableDetail}</span>
            </button>
          ))}
        </div>
      </Show>
    </>
  );
}

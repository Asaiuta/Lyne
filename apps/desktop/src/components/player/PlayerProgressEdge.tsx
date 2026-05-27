import { Show } from "solid-js";
import { formatTime } from "./time";

interface PlayerProgressEdgeProps {
  canSeek: boolean;
  isDragging: boolean;
  displayTime: number;
  duration: number;
  progress: number;
  loadingProgress: number | null;
  showTooltip: boolean;
  hoverRatio: number | null;
  hoverTime: number | null;
  hoverLyric: string | null;
  seekLabel: string;
  setRef: (element: HTMLDivElement) => void;
  onClick: (event: MouseEvent) => void;
  onMouseDown: (event: MouseEvent) => void;
  onMouseEnter: () => void;
  onMouseMove: (event: MouseEvent) => void;
  onMouseLeave: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

export function PlayerProgressEdge(props: PlayerProgressEdgeProps) {
  return (
    <div
      ref={props.setRef}
      class={`player-progress-edge absolute left-0 right-0 top--8px h-16px overflow-visible bg-transparent border-0 rounded-none${props.canSeek ? " is-interactive" : ""}${props.isDragging ? " is-dragging" : ""}`}
      role={props.canSeek ? "slider" : "presentation"}
      aria-label={props.canSeek ? props.seekLabel : undefined}
      aria-valuemin={props.canSeek ? 0 : undefined}
      aria-valuemax={props.canSeek ? Math.round(props.duration) : undefined}
      aria-valuenow={props.canSeek ? Math.round(props.displayTime) : undefined}
      tabIndex={props.canSeek ? 0 : -1}
      onClick={props.onClick}
      onMouseDown={props.onMouseDown}
      onMouseEnter={props.onMouseEnter}
      onMouseMove={props.onMouseMove}
      onMouseLeave={props.onMouseLeave}
      onKeyDown={props.onKeyDown}
    >
      <div class="player-progress-edge-fill absolute top-1/2 left-0 h-3px" style={{ width: `${props.progress * 100}%` }}>
        <div class="player-progress-edge-thumb" aria-hidden="true" />
      </div>
      <Show when={props.loadingProgress !== null}>
        <div
          class="player-progress-edge-loading absolute top-1/2 left-0 h-3px"
          style={{ width: `${props.loadingProgress ?? 0}%` }}
          aria-hidden="true"
        />
      </Show>
      <Show when={props.showTooltip && props.hoverRatio !== null && props.hoverTime !== null}>
        <div
          class="player-progress-tooltip absolute inline-flex items-center gap-1.5 max-w-320px text-xs whitespace-nowrap pointer-events-none"
          role="tooltip"
          style={{ left: `${(props.hoverRatio ?? 0) * 100}%` }}
        >
          <span class="player-progress-tooltip-time font-semibold">{formatTime(props.hoverTime ?? 0)}</span>
          <Show when={props.hoverLyric}>
            {(text) => <span class="player-progress-tooltip-lyric overflow-hidden text-ellipsis max-w-240px">{text()}</span>}
          </Show>
        </div>
      </Show>
    </div>
  );
}

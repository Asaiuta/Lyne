import { Show } from "solid-js";
import { CoverArt } from "../CoverArt";

interface FullPlayerPrimaryCoverProps {
  showCover: boolean;
  isPlaying: boolean;
  playerType: string;
  coverUrl: string | null;
  coverAlt: string;
}

interface FullPlayerPrimaryMetaProps {
  showMeta: boolean;
  title: string;
  subtitle: string;
  detail?: string | null;
}

interface FullPlayerPrimaryPanelProps {
  cover: FullPlayerPrimaryCoverProps;
  meta: FullPlayerPrimaryMetaProps;
}

export function FullPlayerVinylNeedle() {
  return (
    <svg
      class="full-player-vinyl-needle"
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="9" fill="#2a2a2a" stroke="#1a1a1a" stroke-width="1" />
      <circle cx="10" cy="10" r="5" fill="#666" />
      <circle cx="10" cy="10" r="2" fill="#1a1a1a" />
      <path d="M 10 10 L 80 80" stroke="#888" stroke-width="4" stroke-linecap="round" />
      <rect
        x="78"
        y="78"
        width="14"
        height="14"
        rx="2"
        fill="#3a3a3a"
        stroke="#1a1a1a"
        stroke-width="1"
        transform="rotate(45 85 85)"
      />
      <circle cx="92" cy="92" r="2.5" fill="#aa6633" />
    </svg>
  );
}

export function FullPlayerPrimaryPanel(props: FullPlayerPrimaryPanelProps) {
  return (
    <div class="full-player-primary full-player-content-left">
      <Show when={props.cover.showCover}>
        <div class={`full-player-cover${props.cover.isPlaying ? " is-playing" : ""}`}>
          <Show when={props.cover.playerType === "record"}>
            <FullPlayerVinylNeedle />
          </Show>
          <CoverArt coverUrl={props.cover.coverUrl} alt={props.cover.coverAlt} />
        </div>
      </Show>

      <Show when={props.meta.showMeta}>
        <div class="full-player-meta">
          <div class="full-player-title">{props.meta.title}</div>
          <div class="full-player-subtitle">{props.meta.subtitle}</div>
          <Show when={props.meta.detail}>
            {(detail) => <div class="full-player-detail">{detail()}</div>}
          </Show>
        </div>
      </Show>
    </div>
  );
}

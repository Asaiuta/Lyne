import { For, Show } from "solid-js";
import { IconPlayCircle } from "./icons";

export interface DailySongsCardCover {
  id: number | string;
  url: string | null;
}

interface DailySongsCardProps {
  title: string;
  description?: string | null;
  covers: DailySongsCardCover[];
  fallbackInitial?: string;
  active?: boolean;
  variant?: "default" | "daily" | "liked";
  onClick?: () => void;
}

export function DailySongsCard(props: DailySongsCardProps) {
  const fallback = () =>
    props.fallbackInitial?.trim().slice(0, 1).toUpperCase() ||
    props.title.trim().slice(0, 1).toUpperCase() ||
    "·";

  const stackedCovers = () => props.covers.slice(0, 3);
  const currentDay = () => new Date().getDate();

  return (
    <button
      type="button"
      class={`daily-songs-card daily-songs-card--${props.variant ?? "default"}${props.active ? " is-active" : ""}`}
      onClick={() => props.onClick?.()}
    >
      <div class="daily-songs-card-art" aria-hidden="true">
        <Show
          when={stackedCovers().length > 0}
          fallback={<span class="daily-songs-card-fallback">{fallback()}</span>}
        >
          <div class="daily-songs-card-stack">
            <For each={stackedCovers()}>
              {(cover, index) => (
                <div class={`daily-songs-card-stack-slot stack-slot-${index()}`}>
                  <Show when={cover.url} fallback={<span>{fallback()}</span>}>
                    {(url) => <img src={url()} alt="" loading="lazy" />}
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
        <span class="daily-songs-card-play" aria-hidden="true">
          <IconPlayCircle />
        </span>
      </div>
      <div class="daily-songs-card-copy">
        <Show
          when={props.variant === "daily"}
          fallback={<span class="daily-songs-card-title">{props.title}</span>}
        >
          <span class="daily-songs-card-date-title">
            <span class="daily-songs-card-date-icon" aria-hidden="true">
              <span class="daily-songs-card-date-ring" />
              <span class="daily-songs-card-date-number">{currentDay()}</span>
            </span>
            <span class="daily-songs-card-title">{props.title}</span>
          </span>
        </Show>
        <Show when={props.description}>
          <span class="daily-songs-card-description">{props.description}</span>
        </Show>
      </div>
    </button>
  );
}

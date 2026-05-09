import { Show } from "solid-js";
import { IconArtist, IconPlay } from "./icons";

interface AlbumCardProps {
  title: string;
  subtitle?: string | null;
  coverUrl?: string | null;
  size?: "sm" | "md" | "lg";
  shape?: "square" | "round";
  active?: boolean;
  playCount?: number | null;
  description?: string | null;
  onClick?: () => void;
}

const sizeClass = (size?: "sm" | "md" | "lg") =>
  size === "sm" ? " album-card--sm" : size === "lg" ? " album-card--lg" : " album-card--md";

const shapeClass = (shape?: "square" | "round") =>
  shape === "round" ? " album-card--round" : "";

const formatPlayCount = (count: number): string => {
  if (count >= 100_000_000) return `${(count / 100_000_000).toFixed(1)}亿`;
  if (count >= 10_000) return `${(count / 10_000).toFixed(1)}万`;
  return String(count);
};

export function AlbumCard(props: AlbumCardProps) {
  const fallbackInitial = () => props.title.trim().slice(0, 1).toUpperCase() || "·";

  return (
    <button
      type="button"
      class={`album-card${sizeClass(props.size)}${shapeClass(props.shape)}${props.active ? " is-active" : ""}`}
      onClick={() => props.onClick?.()}
    >
      <div class="album-card-art" aria-hidden="true">
        <Show
          when={props.coverUrl}
          fallback={<span class="album-card-fallback">{fallbackInitial()}</span>}
        >
          {(url) => (
            <>
              <img class="album-card-art-img" src={url()} alt="" loading="lazy" />
              <Show when={props.shape === "round"}>
                <img class="album-card-art-shadow" src={url()} alt="" loading="lazy" />
                <span class="album-card-art-artist-icon">
                  <IconArtist />
                </span>
              </Show>
            </>
          )}
        </Show>
        <div class="album-card-art-mask" />
        <Show when={props.playCount != null && props.playCount > 0}>
          <span class="album-card-play-count">
            <IconPlay />
            {formatPlayCount(props.playCount!)}
          </span>
        </Show>
        <Show when={props.description}>
          {(desc) => <span class="album-card-description">{desc()}</span>}
        </Show>
        <span class="album-card-play-btn" aria-hidden="true">
          <IconPlay />
        </span>
      </div>
      <div class="album-card-copy">
        <span class="album-card-title">{props.title}</span>
        <Show when={props.subtitle}>
          <span class="album-card-subtitle">{props.subtitle}</span>
        </Show>
      </div>
    </button>
  );
}

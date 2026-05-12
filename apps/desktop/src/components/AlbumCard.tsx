import { Show } from "solid-js";
import { IconArtist, IconPlay } from "./icons";
import { SImage } from "./SImage";
import { coverSizeUrl } from "../shared/ui/coverSize";

interface AlbumCardProps {
  title: string;
  subtitle?: string | null;
  coverUrl?: string | null;
  size?: "sm" | "md" | "lg";
  shape?: "square" | "round";
  active?: boolean;
  playCount?: number | null;
  description?: string | null;
  coverVisible?: boolean;
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
  // 卡片显示尺寸约 120-184px，使用 m 档 (300px) 足够
  const sizedUrl = () => coverSizeUrl(props.coverUrl, "m");
  const shadowUrl = () => coverSizeUrl(props.coverUrl, "s");
  const coverVisible = () => props.coverVisible ?? true;
  const playCountText = () => {
    const count = props.playCount;
    return count != null && count > 0 ? formatPlayCount(count) : null;
  };
  const descriptionText = () => props.description?.trim() || null;
  const isRoundCard = () => props.shape === "round";
  const hasOverlayMask = () => playCountText() !== null || descriptionText() !== null;

  return (
    <button
      type="button"
      class={`album-card${sizeClass(props.size)}${shapeClass(props.shape)}${props.active ? " is-active" : ""}${coverVisible() ? "" : " is-cover-hidden"}`}
      onClick={() => props.onClick?.()}
    >
      <Show when={coverVisible()}>
        <div class="album-card-art" aria-hidden="true">
          <Show
            when={props.coverUrl}
            fallback={<span class="album-card-fallback">{fallbackInitial()}</span>}
          >
            {(_) => (
              <>
                <SImage
                  src={sizedUrl()}
                  class="album-card-art-img"
                  observeVisibility={true}
                  releaseOnHide={false}
                />
                <Show when={isRoundCard()}>
                  <SImage
                    src={shadowUrl()}
                    class="album-card-art-shadow"
                    observeVisibility={true}
                    releaseOnHide={true}
                  />
                  <span class="album-card-art-artist-icon">
                    <IconArtist />
                  </span>
                </Show>
              </>
            )}
          </Show>
          <Show when={hasOverlayMask()}>
            <div class="album-card-art-mask" />
          </Show>
          <Show when={playCountText()}>
            {(count) => (
              <span class="album-card-play-count">
                <IconPlay />
                {count()}
              </span>
            )}
          </Show>
          <Show when={descriptionText()}>
            {(desc) => <span class="album-card-description">{desc()}</span>}
          </Show>
          <Show when={!isRoundCard()}>
            <span class="album-card-play-btn" aria-hidden="true">
              <IconPlay />
            </span>
          </Show>
        </div>
      </Show>
      <div class="album-card-copy">
        <span class="album-card-title">{props.title}</span>
        <Show when={props.subtitle}>
          <span class="album-card-subtitle">{props.subtitle}</span>
        </Show>
      </div>
    </button>
  );
}

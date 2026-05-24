import { Show } from "solid-js";
import { isVideoArtworkUrl } from "../../shared/utils/mediaUrls";
import { SImage } from "../SImage";
import type { MovingStrategyProps } from "./shared";

export function VinylBg(props: MovingStrategyProps) {
  const videoUrl = () => (props.coverUrl && isVideoArtworkUrl(props.coverUrl) ? props.coverUrl : null);
  const coverStyle = () =>
    props.coverUrl && !isVideoArtworkUrl(props.coverUrl)
      ? { "--vinyl-cover-image": `url("${props.coverUrl}")` }
      : undefined;

  return (
    <div class={`appearance-layer appearance-layer--vinyl${props.active ? " is-active" : " is-paused"}`} aria-hidden="true">
      <div class="appearance-vinyl-field" />
      <div class="appearance-vinyl-disc" style={coverStyle()}>
        <div class="appearance-vinyl-rings" />
        <Show when={videoUrl()}>
          {(url) => (
            <SImage
              src={url()}
              alt=""
              class="appearance-vinyl-video"
              mediaClass="appearance-vinyl-video-media"
              observeVisibility={false}
              shape="circle"
              aspect="square"
              ariaHidden="true"
            />
          )}
        </Show>
      </div>
      <div class="appearance-vinyl-needle" />
    </div>
  );
}

import { Show } from "solid-js";
import { BackgroundMedia, createCoverMediaState, isLightTheme, type CoverStrategyProps } from "./shared";

export function CoverBlurBg(props: CoverStrategyProps) {
  const media = createCoverMediaState(props);
  const blur = () => props.blur ?? 32;
  const maskOpacity = () => props.maskOpacity ?? 0.5;
  const hasLayer = () => props.enabled && (media.currentUrl() !== null || media.previousUrl() !== null);
  const brightness = () => (isLightTheme() ? 1.1 : 0.5);
  const maskColor = () =>
    isLightTheme()
      ? `rgba(255, 255, 255, ${maskOpacity()})`
      : `rgba(0, 0, 0, ${maskOpacity()})`;
  const layerStyle = () => ({
    filter: `blur(${blur()}px) brightness(${brightness()})`,
    opacity: 1
  });
  const exitingLayerStyle = () => ({
    filter: `blur(${blur()}px) brightness(${brightness()})`,
    opacity: media.fading() ? 1 : 0
  });

  return (
    <div class="appearance-layer appearance-layer--cover-blur" aria-hidden="true">
      <Show when={hasLayer()} fallback={<div class="appearance-cover-fallback" />}>
        <Show when={media.previousUrl()}>
          {(url) => (
            <BackgroundMedia
              url={url()}
              className="appearance-cover-media appearance-cover-media--exit"
              style={exitingLayerStyle()}
            />
          )}
        </Show>
        <Show when={media.currentUrl()}>
          {(url) => (
            <BackgroundMedia
              url={url()}
              className="appearance-cover-media"
              style={layerStyle()}
            />
          )}
        </Show>
        <div class="appearance-cover-mask" style={{ background: maskColor() }} />
      </Show>
    </div>
  );
}

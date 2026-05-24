import { Show } from "solid-js";
import { BackgroundMedia, createCoverMediaState, isLightTheme, type CoverStrategyProps } from "./shared";

export function CoverImmersiveBg(props: CoverStrategyProps) {
  const media = createCoverMediaState(props);
  const hasLayer = () => props.enabled && (media.currentUrl() !== null || media.previousUrl() !== null);
  const blur = () => Math.max(18, (props.blur ?? 32) * 0.7);
  const brightness = () => (isLightTheme() ? 1.04 : 0.64);
  const saturation = () => (isLightTheme() ? 1.06 : 1.16);
  const maskOpacity = () => Math.max(0.18, (props.maskOpacity ?? 0.5) * 0.58);
  const maskColor = () =>
    isLightTheme()
      ? `rgba(255, 255, 255, ${maskOpacity()})`
      : `rgba(0, 0, 0, ${maskOpacity()})`;
  const mediaStyle = () => ({
    filter: `blur(${blur()}px) brightness(${brightness()}) saturate(${saturation()})`,
    opacity: 1
  });
  const exitingMediaStyle = () => ({
    filter: `blur(${blur()}px) brightness(${brightness()}) saturate(${saturation()})`,
    opacity: media.fading() ? 1 : 0
  });

  return (
    <div class="appearance-layer appearance-layer--cover-immersive" aria-hidden="true">
      <Show when={hasLayer()} fallback={<div class="appearance-cover-fallback appearance-cover-fallback--immersive" />}>
        <Show when={media.previousUrl()}>
          {(url) => (
            <BackgroundMedia
              url={url()}
              className="appearance-cover-media appearance-cover-media--immersive appearance-cover-media--exit"
              style={exitingMediaStyle()}
            />
          )}
        </Show>
        <Show when={media.currentUrl()}>
          {(url) => (
            <BackgroundMedia
              url={url()}
              className="appearance-cover-media appearance-cover-media--immersive"
              style={mediaStyle()}
            />
          )}
        </Show>
        <div class="appearance-cover-mask appearance-cover-mask--immersive" style={{ background: maskColor() }} />
      </Show>
    </div>
  );
}

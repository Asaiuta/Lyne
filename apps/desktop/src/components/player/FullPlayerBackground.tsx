import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { SImage } from "../SImage";
import type { PlayerBackgroundType } from "../../shared/state/uiSettingsModel";

interface FullPlayerBackgroundProps {
  readonly coverUrl: string | null;
  readonly renderActive: boolean;
  readonly backgroundType: PlayerBackgroundType;
  readonly fps: number;
  readonly flowSpeed: number;
  readonly renderScale: number;
  readonly paused: boolean;
  readonly lowFrequencyEnergy: number;
}

const FULL_PLAYER_BACKGROUND_FADE_MS = 540;

export function FullPlayerBackground(props: FullPlayerBackgroundProps) {
  const [backgroundLayers, setBackgroundLayers] = createSignal<readonly string[]>([]);
  let backgroundTimer: number | undefined;

  const clearBackgroundTimer = () => {
    if (backgroundTimer === undefined) return;
    window.clearTimeout(backgroundTimer);
    backgroundTimer = undefined;
  };

  createEffect(() => {
    if (!props.renderActive) {
      setBackgroundLayers([]);
      clearBackgroundTimer();
      return;
    }

    const nextCoverUrl = props.coverUrl;
    if (!nextCoverUrl) {
      setBackgroundLayers([]);
      clearBackgroundTimer();
      return;
    }

    setBackgroundLayers((layers) => {
      if (layers[0] === nextCoverUrl) return layers;
      return [nextCoverUrl, ...layers.slice(0, 1)];
    });

    clearBackgroundTimer();
    backgroundTimer = window.setTimeout(() => {
      setBackgroundLayers((layers) => layers.slice(0, 1));
      backgroundTimer = undefined;
    }, FULL_PLAYER_BACKGROUND_FADE_MS);
  });

  onCleanup(clearBackgroundTimer);

  return (
    <div class={`full-player-background mode-${props.backgroundType}`} aria-hidden="true">
      <Show when={props.backgroundType === "color"}>
        <div class="full-player-background-color" />
      </Show>
      <Show when={props.backgroundType === "animation"}>
        <FullPlayerMeshBackground
          coverUrl={props.coverUrl}
          active={props.renderActive && !props.paused}
          fps={props.fps}
          flowSpeed={props.flowSpeed}
          renderScale={props.renderScale}
          lowFrequencyEnergy={props.lowFrequencyEnergy}
        />
      </Show>
      <Show when={props.backgroundType === "blur"}>
        <For each={backgroundLayers()}>
          {(url, index) => (
            <SImage
              src={url}
              alt=""
              class={`full-player-background-image${index() === 0 ? " is-current" : " is-previous"}`}
              mediaClass="full-player-background-image-media"
              observeVisibility={false}
              shape="rect"
              ariaHidden="true"
            />
          )}
        </For>
      </Show>
    </div>
  );
}

interface FullPlayerMeshBackgroundProps {
  readonly coverUrl: string | null;
  readonly active: boolean;
  readonly fps: number;
  readonly flowSpeed: number;
  readonly renderScale: number;
  readonly lowFrequencyEnergy: number;
}

function FullPlayerMeshBackground(props: FullPlayerMeshBackgroundProps) {
  let canvas: HTMLCanvasElement | undefined;
  let context: CanvasRenderingContext2D | null = null;
  let frame: number | undefined;
  let lastFrameTime = 0;
  let phase = 0;
  let requestedActive = false;
  let reducedMotion = false;

  const stop = () => {
    if (frame === undefined) return;
    window.cancelAnimationFrame(frame);
    frame = undefined;
  };

  const resize = () => {
    if (!canvas) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(1, Math.max(0.1, props.renderScale));
    const width = Math.max(1, Math.round(rect.width * ratio * scale));
    const height = Math.max(1, Math.round(rect.height * ratio * scale));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
  };

  const draw = (time: number) => {
    if (!canvas || !context || !requestedActive || reducedMotion || document.hidden) {
      frame = undefined;
      return;
    }
    const fps = Math.min(256, Math.max(1, props.fps));
    const frameInterval = 1000 / fps;
    if (time - lastFrameTime < frameInterval) {
      frame = window.requestAnimationFrame(draw);
      return;
    }

    resize();
    lastFrameTime = time;
    phase += Math.max(0, props.flowSpeed) * 0.0038;
    const width = canvas.width;
    const height = canvas.height;
    const energy = Math.max(0, Math.min(1, props.lowFrequencyEnergy));
    const primaryRadius = Math.max(width, height) * (0.56 + energy * 0.16);
    const secondaryRadius = Math.max(width, height) * 0.48;
    const drift = Math.sin(phase) * 0.12;
    const lift = Math.cos(phase * 0.7) * 0.1;

    context.clearRect(0, 0, width, height);
    const base = context.createLinearGradient(0, 0, width, height);
    base.addColorStop(0, "rgb(255 179 173)");
    base.addColorStop(0.38, "rgb(126 143 255)");
    base.addColorStop(0.7, "rgb(52 109 168)");
    base.addColorStop(1, "rgb(20 26 34)");
    context.fillStyle = base;
    context.fillRect(0, 0, width, height);

    context.globalCompositeOperation = "screen";
    const primary = context.createRadialGradient(
      width * (0.34 + drift),
      height * (0.28 + lift),
      0,
      width * (0.34 + drift),
      height * (0.28 + lift),
      primaryRadius
    );
    primary.addColorStop(0, "rgba(255, 214, 210, 0.58)");
    primary.addColorStop(0.45, "rgba(126, 143, 255, 0.28)");
    primary.addColorStop(1, "rgba(126, 143, 255, 0)");
    context.fillStyle = primary;
    context.fillRect(0, 0, width, height);

    const secondary = context.createRadialGradient(
      width * (0.72 - drift * 0.65),
      height * (0.32 - lift * 0.7),
      0,
      width * (0.72 - drift * 0.65),
      height * (0.32 - lift * 0.7),
      secondaryRadius
    );
    secondary.addColorStop(0, "rgba(244, 249, 255, 0.38)");
    secondary.addColorStop(0.36, "rgba(52, 109, 168, 0.2)");
    secondary.addColorStop(1, "rgba(52, 109, 168, 0)");
    context.fillStyle = secondary;
    context.fillRect(0, 0, width, height);

    context.globalCompositeOperation = "multiply";
    const shade = context.createLinearGradient(width * 0.2, 0, width, height);
    shade.addColorStop(0, "rgba(255, 255, 255, 0.2)");
    shade.addColorStop(1, "rgba(0, 10, 24, 0.62)");
    context.fillStyle = shade;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = "source-over";

    frame = window.requestAnimationFrame(draw);
  };

  const syncVisibility = () => {
    if (document.hidden || reducedMotion || !requestedActive) {
      stop();
      return;
    }
    if (context && frame === undefined) frame = window.requestAnimationFrame(draw);
  };

  createEffect(() => {
    requestedActive = props.active;
    if (!canvas || !requestedActive || reducedMotion || document.hidden) {
      stop();
      return;
    }
    context = canvas.getContext("2d", { alpha: true });
    if (!context || frame !== undefined) return;
    frame = window.requestAnimationFrame(draw);
  });

  onMount(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncReducedMotion = () => {
      reducedMotion = media.matches;
      syncVisibility();
    };
    syncReducedMotion();
    document.addEventListener("visibilitychange", syncVisibility);
    media.addEventListener("change", syncReducedMotion);
    onCleanup(() => {
      document.removeEventListener("visibilitychange", syncVisibility);
      media.removeEventListener("change", syncReducedMotion);
    });
  });
  onCleanup(stop);

  return (
    <div class="full-player-background-render-wrapper" aria-hidden="true">
      <canvas ref={canvas} class="full-player-background-canvas" data-cover-url={props.coverUrl ?? ""} />
    </div>
  );
}

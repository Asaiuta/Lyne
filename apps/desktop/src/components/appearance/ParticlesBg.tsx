import { createEffect, onCleanup, onMount } from "solid-js";
import type { MovingStrategyProps } from "./shared";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  startColor: string;
  middleColor: string;
}
function createParticles(width: number, height: number, count: number): Particle[] {
  return Array.from({ length: count }, (_, index) => {
    const phase = index / Math.max(1, count - 1);
    const alpha = 0.10 + (phase % 0.22);
    return {
      x: width * ((phase * 0.73 + 0.17) % 1),
      y: height * ((phase * 0.41 + 0.29) % 1),
      vx: (phase % 0.5) - 0.25,
      vy: ((phase * 1.7) % 0.5) - 0.25,
      radius: 28 + (phase * 52),
      alpha,
      startColor: `rgba(255, 179, 173, ${alpha})`,
      middleColor: `rgba(225, 194, 140, ${alpha * 0.45})`
    };
  });
}

export function ParticlesBg(props: MovingStrategyProps) {
  let canvas: HTMLCanvasElement | undefined;
  let context: CanvasRenderingContext2D | null = null;
  let frame: number | undefined;
  let particles: Particle[] = [];
  let requestedActive = false;
  let previousFrameAt: number | undefined;
  let nextFrameAt: number | undefined;

  const maxFps = () => Math.min(144, Math.max(30, props.maxFps ?? 120));

  const resize = () => {
    if (!canvas) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    particles = createParticles(width, height, 24);
  };

  const draw = (now: number) => {
    if (!canvas || !context || !requestedActive || document.hidden) {
      frame = undefined;
      return;
    }
    const deltaScale = previousFrameAt === undefined
      ? 1
      : Math.min(3, Math.max(0, (now - previousFrameAt) / (1000 / 60)));
    previousFrameAt = now;
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = "screen";

    for (const particle of particles) {
      particle.x = (particle.x + (particle.vx * deltaScale) + width) % width;
      particle.y = (particle.y + (particle.vy * deltaScale) + height) % height;
      const gradient = context.createRadialGradient(
        particle.x,
        particle.y,
        0,
        particle.x,
        particle.y,
        particle.radius
      );
      gradient.addColorStop(0, particle.startColor);
      gradient.addColorStop(0.45, particle.middleColor);
      gradient.addColorStop(1, "rgba(255, 179, 173, 0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      context.fill();
    }

    scheduleDraw();
  };

  const scheduleDraw = () => {
    if (frame !== undefined) return;
    frame = window.requestAnimationFrame((now) => {
      frame = undefined;
      const minimumInterval = 1000 / maxFps();
      if (nextFrameAt === undefined || now >= nextFrameAt) {
        do {
          nextFrameAt = (nextFrameAt ?? now) + minimumInterval;
        } while (nextFrameAt <= now);
        draw(now);
        return;
      }
      scheduleDraw();
    });
  };

  const stop = () => {
    if (frame !== undefined) {
      window.cancelAnimationFrame(frame);
      frame = undefined;
    }
    previousFrameAt = undefined;
    nextFrameAt = undefined;
  };

  const syncVisibility = () => {
    if (document.hidden || !requestedActive) {
      stop();
      return;
    }
    if (context && frame === undefined) scheduleDraw();
  };

  createEffect(() => {
    requestedActive = props.active;
    if (!canvas || !requestedActive || document.hidden) {
      stop();
      return;
    }
    context = canvas.getContext("2d");
    if (!context || frame !== undefined) return;
    scheduleDraw();
  });

  onMount(() => {
    resize();
    const resizeObserver = new ResizeObserver(resize);
    if (canvas) resizeObserver.observe(canvas);
    document.addEventListener("visibilitychange", syncVisibility);
    onCleanup(() => {
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", syncVisibility);
    });
  });
  onCleanup(stop);

  return (
    <div class={`appearance-layer appearance-layer--particles${props.active ? " is-active" : " is-paused"}`} aria-hidden="true">
      <canvas ref={canvas} class="appearance-particles-canvas" />
      <div class="appearance-particles-tint" />
    </div>
  );
}

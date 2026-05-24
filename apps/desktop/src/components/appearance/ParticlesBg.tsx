import { createEffect, onCleanup } from "solid-js";
import type { MovingStrategyProps } from "./shared";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
}
function createParticles(width: number, height: number, count: number): Particle[] {
  return Array.from({ length: count }, (_, index) => {
    const phase = index / Math.max(1, count - 1);
    return {
      x: width * ((phase * 0.73 + 0.17) % 1),
      y: height * ((phase * 0.41 + 0.29) % 1),
      vx: (phase % 0.5) - 0.25,
      vy: ((phase * 1.7) % 0.5) - 0.25,
      radius: 28 + (phase * 52),
      alpha: 0.10 + (phase % 0.22)
    };
  });
}

export function ParticlesBg(props: MovingStrategyProps) {
  let canvas: HTMLCanvasElement | undefined;
  let context: CanvasRenderingContext2D | null = null;
  let frame: number | undefined;
  let particles: Particle[] = [];

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

  const draw = () => {
    if (!canvas || !context) return;
    resize();
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = "screen";

    for (const particle of particles) {
      particle.x = (particle.x + particle.vx + width) % width;
      particle.y = (particle.y + particle.vy + height) % height;
      const gradient = context.createRadialGradient(
        particle.x,
        particle.y,
        0,
        particle.x,
        particle.y,
        particle.radius
      );
      gradient.addColorStop(0, `rgba(255, 179, 173, ${particle.alpha})`);
      gradient.addColorStop(0.45, `rgba(225, 194, 140, ${particle.alpha * 0.45})`);
      gradient.addColorStop(1, "rgba(255, 179, 173, 0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      context.fill();
    }

    frame = window.requestAnimationFrame(draw);
  };

  const stop = () => {
    if (frame !== undefined) {
      window.cancelAnimationFrame(frame);
      frame = undefined;
    }
  };

  createEffect(() => {
    const active = props.active;
    if (!canvas || !active) {
      stop();
      return;
    }
    context = canvas.getContext("2d");
    if (!context || frame !== undefined) return;
    frame = window.requestAnimationFrame(draw);
  });

  onCleanup(stop);

  return (
    <div class={`appearance-layer appearance-layer--particles${props.active ? " is-active" : " is-paused"}`} aria-hidden="true">
      <canvas ref={canvas} class="appearance-particles-canvas" />
      <div class="appearance-particles-tint" />
    </div>
  );
}

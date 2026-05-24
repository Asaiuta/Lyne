import { createEffect, onCleanup, onMount } from "solid-js";

interface SpectrumCanvasProps {
  data: number[];
  active: boolean;
}

interface CanvasMetrics {
  width: number;
  height: number;
  ratio: number;
}

export function SpectrumCanvas(props: SpectrumCanvasProps) {
  let canvasRef: HTMLCanvasElement | undefined;
  let context: CanvasRenderingContext2D | null = null;
  let metrics: CanvasMetrics = { width: 0, height: 0, ratio: 1 };
  let activeFill = "oklch(0.63 0.22 24)";
  let idleFill = "oklch(0.56 0.008 280 / 0.5)";
  let frameId: number | undefined;
  let latestData: readonly number[] = [];
  let latestActive = false;

  const scheduleDraw = () => {
    if (frameId !== undefined) return;
    frameId = window.requestAnimationFrame(() => {
      frameId = undefined;
      draw();
    });
  };

  const refreshColors = () => {
    const canvas = canvasRef;
    if (!canvas) return;
    const style = getComputedStyle(canvas);
    activeFill =
      style.getPropertyValue("--color-primary").trim() ||
      style.getPropertyValue("--color-primary").trim() ||
      "oklch(0.63 0.22 24)";
    idleFill = style.getPropertyValue("--muted-soft").trim() || "oklch(0.56 0.008 280 / 0.5)";
    scheduleDraw();
  };

  const resizeCanvas = (width: number, height: number) => {
    const canvas = canvasRef;
    if (!canvas || !context) return;

    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.floor(width * ratio));
    const pixelHeight = Math.max(1, Math.floor(height * ratio));

    metrics = { width, height, ratio };
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    scheduleDraw();
  };

  const draw = () => {
    if (!context || metrics.width <= 0 || metrics.height <= 0) return;

    context.clearRect(0, 0, metrics.width, metrics.height);

    const count = latestData.length || 64;
    const barWidth = metrics.width / count;
    const maxHeight = metrics.height;

    context.fillStyle = latestActive ? activeFill : idleFill;
    for (let i = 0; i < count; i += 1) {
      const value = latestData[i] ?? 0;
      const height = Math.max(2, Math.min(maxHeight, value * maxHeight));
      const x = i * barWidth;
      context.fillRect(x, maxHeight - height, Math.max(2, barWidth - 2), height);
    }
  };

  onMount(() => {
    const canvas = canvasRef;
    if (!canvas) return;

    context = canvas.getContext("2d");
    if (!context) return;

    refreshColors();
    resizeCanvas(canvas.clientWidth, canvas.clientHeight);

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      resizeCanvas(entry.contentRect.width, entry.contentRect.height);
    });
    resizeObserver.observe(canvas);

    const colorObserver = new MutationObserver(refreshColors);
    colorObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-theme"]
    });

    onCleanup(() => {
      resizeObserver.disconnect();
      colorObserver.disconnect();
    });
  });

  createEffect(() => {
    latestData = props.data;
    latestActive = props.active;
    scheduleDraw();
  });

  onCleanup(() => {
    if (frameId !== undefined) {
      window.cancelAnimationFrame(frameId);
      frameId = undefined;
    }
  });

  return <canvas ref={canvasRef} class="spectrum-canvas" />;
}

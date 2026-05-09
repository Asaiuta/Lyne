/**
 * Cover-art color extraction (Phase 5 — dynamic accent).
 *
 * Loads an image, draws a small downsampled copy onto a canvas, and picks the
 * most saturated, sufficiently-bright pixel as the dominant accent. Falls back
 * to the static `--accent-base` when extraction fails (e.g. tainted canvas,
 * load error, or empty image).
 */

const SAMPLE_SIZE = 32;
const MIN_LIGHTNESS = 0.32;
const MAX_LIGHTNESS = 0.78;
const MIN_CHROMA = 0.06;

interface OkLch {
  l: number;
  c: number;
  h: number;
}

function srgbToLinear(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function rgbToOklch(r: number, g: number, b: number): OkLch {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const lCbrt = Math.cbrt(l);
  const mCbrt = Math.cbrt(m);
  const sCbrt = Math.cbrt(s);

  const okL = 0.2104542553 * lCbrt + 0.793617785 * mCbrt - 0.0040720468 * sCbrt;
  const okA = 1.9779984951 * lCbrt - 2.428592205 * mCbrt + 0.4505937099 * sCbrt;
  const okB = 0.0259040371 * lCbrt + 0.7827717662 * mCbrt - 0.808675766 * sCbrt;

  const chroma = Math.sqrt(okA * okA + okB * okB);
  const hue = (Math.atan2(okB, okA) * 180) / Math.PI;
  return {
    l: okL,
    c: chroma,
    h: hue < 0 ? hue + 360 : hue
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image-load-failed"));
    img.src = url;
  });
}

function extractDominant(pixels: Uint8ClampedArray): OkLch | null {
  let best: OkLch | null = null;
  let bestScore = -Infinity;

  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (alpha < 200) continue;
    const color = rgbToOklch(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (color.l < MIN_LIGHTNESS || color.l > MAX_LIGHTNESS) continue;
    if (color.c < MIN_CHROMA) continue;
    const score = color.c * 2 - Math.abs(color.l - 0.6);
    if (score > bestScore) {
      bestScore = score;
      best = color;
    }
  }

  return best;
}

/**
 * Resolve the dominant accent for an image URL. Returns null when the URL is
 * empty, the image cannot be loaded, or no qualifying color is found.
 */
export async function extractAccent(coverUrl: string | null): Promise<OkLch | null> {
  if (!coverUrl) return null;
  if (typeof window === "undefined") return null;

  let image: HTMLImageElement;
  try {
    image = await loadImage(coverUrl);
  } catch {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  try {
    ctx.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  } catch {
    return null;
  }

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  } catch {
    // tainted canvas — origin doesn't allow pixel access
    return null;
  }

  return extractDominant(imageData.data);
}

/**
 * Push the extracted accent into the document root as `--accent-dynamic` and
 * its strong companion. Pass `null` to revert to the static base color.
 */
export function applyDynamicAccent(color: OkLch | null) {
  const root = document.documentElement;
  if (!color) {
    root.style.removeProperty("--accent-dynamic");
    root.style.removeProperty("--accent-dynamic-strong");
    return;
  }
  const clampedL = Math.min(0.74, Math.max(0.5, color.l));
  const clampedC = Math.min(0.22, Math.max(0.08, color.c));
  const base = `oklch(${clampedL.toFixed(3)} ${clampedC.toFixed(3)} ${color.h.toFixed(1)})`;
  const strong = `oklch(${Math.min(0.84, clampedL + 0.08).toFixed(3)} ${Math.min(0.26, clampedC + 0.02).toFixed(3)} ${color.h.toFixed(1)})`;
  root.style.setProperty("--accent-dynamic", base);
  root.style.setProperty("--accent-dynamic-strong", strong);
}

import {
  Hct,
  QuantizerCelebi,
  Score,
  argbFromHex,
  themeFromSourceColor,
  type Theme
} from "@material/material-color-utilities";

export type ThemeScheme = "dark" | "light";

export type PaletteRole =
  | "primary"
  | "secondary"
  | "tertiary"
  | "neutral"
  | "neutralVariant"
  | "error";

export type PaletteTokenName =
  | PaletteRole
  | `on${Capitalize<PaletteRole>}`
  | `${PaletteRole}Container`
  | `on${Capitalize<PaletteRole>}Container`;

export type PaletteRoleTokens = Readonly<Record<PaletteTokenName, string>>;

export interface DynamicPalette {
  readonly sourceArgb: number;
  readonly scheme: ThemeScheme;
  readonly tokens: PaletteRoleTokens;
}

const SAMPLE_SIZE = 50;
const DEFAULT_SEED_HEX = "#fe7971";
const DEFAULT_SEED_ARGB = argbFromHex(DEFAULT_SEED_HEX);

const ROLE_VARIANTS = {
  primary: "primary",
  secondary: "secondary",
  tertiary: "tertiary",
  neutral: "neutral",
  neutralVariant: "neutralVariant",
  error: "error"
} as const satisfies Record<PaletteRole, keyof Theme["palettes"]>;

const DARK_TONES = {
  role: 80,
  onRole: 20,
  container: 30,
  onContainer: 90
} as const;

const LIGHT_TONES = {
  role: 40,
  onRole: 100,
  container: 90,
  onContainer: 10
} as const;

function readScheme(root: HTMLElement = document.documentElement): ThemeScheme {
  return root.dataset.theme === "light" ? "light" : "dark";
}

function tokenName(role: PaletteRole, variant: "role" | "onRole" | "container" | "onContainer"): PaletteTokenName {
  const key = (role.slice(0, 1).toUpperCase() + role.slice(1)) as Capitalize<PaletteRole>;
  switch (variant) {
    case "role":
      return role;
    case "onRole":
      return `on${key}`;
    case "container":
      return `${role}Container`;
    case "onContainer":
      return `on${key}Container`;
    default: {
      const exhaustive: never = variant;
      throw new Error(`Unhandled palette token variant: ${exhaustive}`);
    }
  }
}

function tokenCssVar(name: PaletteTokenName): string {
  return `--color-${name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
}

function argbToRgb(argb: number): { readonly r: number; readonly g: number; readonly b: number } {
  return {
    r: (argb >> 16) & 255,
    g: (argb >> 8) & 255,
    b: argb & 255
  };
}

function argbToCss(argb: number): string {
  const { r, g, b } = argbToRgb(argb);
  return `rgb(${r} ${g} ${b})`;
}

function hctTone(theme: Theme, role: PaletteRole, tone: number): string {
  const palette = theme.palettes[ROLE_VARIANTS[role]];
  return argbToCss(Hct.from(palette.hue, palette.chroma, tone).toInt());
}

export function createPaletteFromSource(sourceArgb: number, scheme: ThemeScheme): DynamicPalette {
  const theme = themeFromSourceColor(sourceArgb);
  const tones = scheme === "light" ? LIGHT_TONES : DARK_TONES;
  const tokens = {} as Record<PaletteTokenName, string>;

  (Object.keys(ROLE_VARIANTS) as PaletteRole[]).forEach((role) => {
    tokens[tokenName(role, "role")] = hctTone(theme, role, tones.role);
    tokens[tokenName(role, "onRole")] = hctTone(theme, role, tones.onRole);
    tokens[tokenName(role, "container")] = hctTone(theme, role, tones.container);
    tokens[tokenName(role, "onContainer")] = hctTone(theme, role, tones.onContainer);
  });

  return { sourceArgb, scheme, tokens };
}

export function createDefaultPalette(scheme: ThemeScheme): DynamicPalette {
  return createPaletteFromSource(DEFAULT_SEED_ARGB, scheme);
}

export function applyPalette(palette: DynamicPalette, root: HTMLElement = document.documentElement): void {
  (Object.entries(palette.tokens) as Array<[PaletteTokenName, string]>).forEach(([name, value]) => {
    root.style.setProperty(tokenCssVar(name), value);
  });
  root.style.setProperty("--surface-container-dynamic", "var(--color-neutral-container)");
}

export function reset(root: HTMLElement = document.documentElement): void {
  applyPalette(createDefaultPalette(readScheme(root)), root);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("palette-image-load-failed"));
    image.src = url;
  });
}

function extractArgbFromPixels(pixels: Uint8ClampedArray): number | null {
  const argbPixels: number[] = [];
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 200) continue;
    argbPixels.push((((alpha << 24) >>> 0) | (pixels[index] << 16) | (pixels[index + 1] << 8) | pixels[index + 2]) >>> 0);
  }
  if (argbPixels.length === 0) return null;

  const quantizedColors = QuantizerCelebi.quantize(argbPixels, 128);
  const ranked = Score.score(new Map(Array.from(quantizedColors).sort((a, b) => b[1] - a[1]).slice(0, 50)));
  return ranked[0] ?? null;
}

export async function extractSourceColor(coverUrl: string | null): Promise<number | null> {
  if (!coverUrl || typeof window === "undefined") return null;

  let image: HTMLImageElement;
  try {
    image = await loadImage(coverUrl);
  } catch {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  try {
    context.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return extractArgbFromPixels(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
  } catch {
    return null;
  } finally {
    canvas.remove();
  }
}

export async function applyCover(coverUrl: string | null, root: HTMLElement = document.documentElement): Promise<void> {
  const sourceArgb = await extractSourceColor(coverUrl);
  applyPalette(
    sourceArgb === null
      ? createDefaultPalette(readScheme(root))
      : createPaletteFromSource(sourceArgb, readScheme(root)),
    root
  );
}

export function applySeed(seedHex: string, root: HTMLElement = document.documentElement): void {
  let sourceArgb = DEFAULT_SEED_ARGB;
  try {
    sourceArgb = argbFromHex(seedHex.trim() || DEFAULT_SEED_HEX);
  } catch {
    sourceArgb = DEFAULT_SEED_ARGB;
  }
  applyPalette(createPaletteFromSource(sourceArgb, readScheme(root)), root);
}

export const paletteEngine = {
  applyCover,
  applyPalette,
  applySeed,
  createDefaultPalette,
  createPaletteFromSource,
  extractSourceColor,
  reset
} as const;

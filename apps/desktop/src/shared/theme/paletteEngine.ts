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

export interface DynamicThemeTokens {
  readonly main: string;
  readonly mainRgb: string;
  readonly primary: string;
  readonly primaryRgb: string;
  readonly background: string;
  readonly backgroundRgb: string;
  readonly surfaceContainer: string;
  readonly surfaceContainerRgb: string;
}

export interface DynamicPalette {
  readonly sourceArgb: number;
  readonly scheme: ThemeScheme;
  readonly tokens: PaletteRoleTokens;
  readonly theme: DynamicThemeTokens;
  readonly isMonotonous: boolean;
}

export interface ExtractedPaletteSource {
  readonly sourceArgb: number | null;
  readonly isMonotonous: boolean;
}

const SAMPLE_SIZE = 50;
const DEFAULT_SEED_HEX = "#fe7971";
const DEFAULT_SEED_ARGB = argbFromHex(DEFAULT_SEED_HEX);
const MONOTONOUS_SOURCE_ARGB = argbFromHex("#efefef");
const MONOTONOUS_MAIN_RGB = { r: 239, g: 239, b: 239 } as const;
const MONOTONOUS_LIGHT = {
  primary: { r: 10, g: 10, b: 10 },
  background: { r: 238, g: 238, b: 238 },
  surfaceContainer: { r: 212, g: 212, b: 212 }
} as const;
const MONOTONOUS_DARK = {
  primary: { r: 239, g: 239, b: 239 },
  background: { r: 31, g: 31, b: 31 },
  surfaceContainer: { r: 39, g: 39, b: 39 }
} as const;

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

const PLAYER_COVER_MAIN_TONE = 90;
const PLAYER_COVER_ROLE: PaletteRole = "secondary";
const LIGHT_PRIMARY_TONE = 10;
const LIGHT_BACKGROUND_TONE = 94;
const LIGHT_SURFACE_CONTAINER_TONE = 90;
const DARK_PRIMARY_TONE = 90;
const DARK_BACKGROUND_TONE = 20;
const DARK_SURFACE_CONTAINER_TONE = 16;
const MONOTONOUS_CHANNEL_THRESHOLD = 5;
const TOP_FREQUENT_COLOR_COUNT = 5;
const SCORE_COLOR_COUNT = 50;

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

export function argbToCss(argb: number): string {
  const { r, g, b } = argbToRgb(argb);
  return `rgb(${r} ${g} ${b})`;
}

export function argbToRgbChannels(argb: number): string {
  const { r, g, b } = argbToRgb(argb);
  return `${r}, ${g}, ${b}`;
}

function rgbToCss(color: { readonly r: number; readonly g: number; readonly b: number }): string {
  return `rgb(${color.r} ${color.g} ${color.b})`;
}

function rgbToChannels(color: { readonly r: number; readonly g: number; readonly b: number }): string {
  return `${color.r}, ${color.g}, ${color.b}`;
}

function hctToneArgb(theme: Theme, role: PaletteRole, tone: number): number {
  const palette = theme.palettes[ROLE_VARIANTS[role]];
  return Hct.from(palette.hue, palette.chroma, tone).toInt();
}

function hctTone(theme: Theme, role: PaletteRole, tone: number): string {
  return argbToCss(hctToneArgb(theme, role, tone));
}

function buildMonotonousRoleTokens(scheme: ThemeScheme): PaletteRoleTokens {
  const mode = scheme === "light" ? MONOTONOUS_LIGHT : MONOTONOUS_DARK;
  const onPrimary = scheme === "light" ? MONOTONOUS_LIGHT.background : MONOTONOUS_DARK.background;
  const tokens = {} as Record<PaletteTokenName, string>;

  (Object.keys(ROLE_VARIANTS) as PaletteRole[]).forEach((role) => {
    tokens[tokenName(role, "role")] = rgbToCss(mode.primary);
    tokens[tokenName(role, "onRole")] = rgbToCss(onPrimary);
    tokens[tokenName(role, "container")] = rgbToCss(mode.surfaceContainer);
    tokens[tokenName(role, "onContainer")] = rgbToCss(mode.primary);
  });

  return tokens;
}

function createThemeTokensFromSource(sourceArgb: number, scheme: ThemeScheme): DynamicThemeTokens {
  const theme = themeFromSourceColor(sourceArgb);
  const primaryTone = scheme === "light" ? LIGHT_PRIMARY_TONE : DARK_PRIMARY_TONE;
  const backgroundTone = scheme === "light" ? LIGHT_BACKGROUND_TONE : DARK_BACKGROUND_TONE;
  const surfaceContainerTone = scheme === "light" ? LIGHT_SURFACE_CONTAINER_TONE : DARK_SURFACE_CONTAINER_TONE;
  const main = hctToneArgb(theme, PLAYER_COVER_ROLE, PLAYER_COVER_MAIN_TONE);
  const primary = hctToneArgb(theme, PLAYER_COVER_ROLE, primaryTone);
  const background = hctToneArgb(theme, PLAYER_COVER_ROLE, backgroundTone);
  const surfaceContainer = hctToneArgb(theme, PLAYER_COVER_ROLE, surfaceContainerTone);

  return {
    main: argbToCss(main),
    mainRgb: argbToRgbChannels(main),
    primary: argbToCss(primary),
    primaryRgb: argbToRgbChannels(primary),
    background: argbToCss(background),
    backgroundRgb: argbToRgbChannels(background),
    surfaceContainer: argbToCss(surfaceContainer),
    surfaceContainerRgb: argbToRgbChannels(surfaceContainer)
  };
}

function createMonotonousThemeTokens(scheme: ThemeScheme): DynamicThemeTokens {
  const mode = scheme === "light" ? MONOTONOUS_LIGHT : MONOTONOUS_DARK;
  return {
    main: rgbToCss(MONOTONOUS_MAIN_RGB),
    mainRgb: rgbToChannels(MONOTONOUS_MAIN_RGB),
    primary: rgbToCss(mode.primary),
    primaryRgb: rgbToChannels(mode.primary),
    background: rgbToCss(mode.background),
    backgroundRgb: rgbToChannels(mode.background),
    surfaceContainer: rgbToCss(mode.surfaceContainer),
    surfaceContainerRgb: rgbToChannels(mode.surfaceContainer)
  };
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

  return {
    sourceArgb,
    scheme,
    tokens,
    theme: createThemeTokensFromSource(sourceArgb, scheme),
    isMonotonous: false
  };
}

export function createDefaultPalette(scheme: ThemeScheme): DynamicPalette {
  return createPaletteFromSource(DEFAULT_SEED_ARGB, scheme);
}

export function createMonotonousPalette(scheme: ThemeScheme): DynamicPalette {
  return {
    sourceArgb: MONOTONOUS_SOURCE_ARGB,
    scheme,
    tokens: buildMonotonousRoleTokens(scheme),
    theme: createMonotonousThemeTokens(scheme),
    isMonotonous: true
  };
}

export function createPaletteFromExtractedSource(
  source: ExtractedPaletteSource,
  scheme: ThemeScheme
): DynamicPalette {
  if (source.isMonotonous) {
    return createMonotonousPalette(scheme);
  }
  return createPaletteFromSource(source.sourceArgb ?? DEFAULT_SEED_ARGB, scheme);
}

export function createPlayerCoverColorFromSource(sourceArgb: number): string {
  const css = hctTone(themeFromSourceColor(sourceArgb), PLAYER_COVER_ROLE, PLAYER_COVER_MAIN_TONE);
  return css;
}

export function createPlayerCoverRgbChannelsFromSource(sourceArgb: number): string {
  const theme = themeFromSourceColor(sourceArgb);
  const palette = theme.palettes[PLAYER_COVER_ROLE];
  const argb = Hct.from(palette.hue, palette.chroma, PLAYER_COVER_MAIN_TONE).toInt();
  return argbToRgbChannels(argb);
}

export function applyPalette(palette: DynamicPalette, root: HTMLElement = document.documentElement): void {
  (Object.entries(palette.tokens) as Array<[PaletteTokenName, string]>).forEach(([name, value]) => {
    root.style.setProperty(tokenCssVar(name), value);
  });
  root.style.setProperty("--splayer-primary", palette.theme.primary);
  root.style.setProperty("--splayer-primary-rgb", palette.theme.primaryRgb);
  root.style.setProperty("--splayer-background", palette.theme.background);
  root.style.setProperty("--splayer-background-rgb", palette.theme.backgroundRgb);
  root.style.setProperty("--splayer-surface-container", palette.theme.surfaceContainer);
  root.style.setProperty("--splayer-surface-container-rgb", palette.theme.surfaceContainerRgb);
  root.style.setProperty("--splayer-main-cover-color", palette.theme.main);
  root.style.setProperty("--splayer-main-cover-rgb", palette.theme.mainRgb);
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

function isMonotonousColor(argb: number): boolean {
  const { r, g, b } = argbToRgb(argb);
  return Math.max(r, g, b) - Math.min(r, g, b) < MONOTONOUS_CHANNEL_THRESHOLD;
}

export function extractPaletteSourceFromPixels(pixels: Uint8ClampedArray): ExtractedPaletteSource | null {
  const argbPixels: number[] = [];
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 200) continue;
    argbPixels.push((((alpha << 24) >>> 0) | (pixels[index] << 16) | (pixels[index + 1] << 8) | pixels[index + 2]) >>> 0);
  }
  if (argbPixels.length === 0) return null;

  const quantizedColors = QuantizerCelebi.quantize(argbPixels, 128);
  const sortedQuantizedColors = Array.from(quantizedColors).sort((a, b) => b[1] - a[1]);
  const frequentColors = sortedQuantizedColors.slice(0, TOP_FREQUENT_COLOR_COUNT);
  if (frequentColors.length > 0 && frequentColors.every(([argb]) => isMonotonousColor(argb))) {
    return { sourceArgb: null, isMonotonous: true };
  }

  const ranked = Score.score(new Map(sortedQuantizedColors.slice(0, SCORE_COLOR_COUNT)));
  const sourceArgb = ranked[0] ?? null;
  return sourceArgb === null ? null : { sourceArgb, isMonotonous: false };
}

export async function extractSourceColor(coverUrl: string | null): Promise<number | null> {
  const source = await extractPaletteSource(coverUrl);
  return source?.sourceArgb ?? (source?.isMonotonous ? MONOTONOUS_SOURCE_ARGB : null);
}

export async function extractPaletteSource(coverUrl: string | null): Promise<ExtractedPaletteSource | null> {
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
    return extractPaletteSourceFromPixels(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
  } catch {
    return null;
  } finally {
    canvas.remove();
  }
}

export async function applyCover(coverUrl: string | null, root: HTMLElement = document.documentElement): Promise<void> {
  const source = await extractPaletteSource(coverUrl);
  applyPalette(source === null ? createDefaultPalette(readScheme(root)) : createPaletteFromExtractedSource(source, readScheme(root)), root);
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
  argbToCss,
  argbToRgbChannels,
  applyCover,
  applyPalette,
  applySeed,
  createDefaultPalette,
  createMonotonousPalette,
  createPaletteFromExtractedSource,
  createPaletteFromSource,
  createPlayerCoverColorFromSource,
  createPlayerCoverRgbChannelsFromSource,
  extractPaletteSource,
  extractPaletteSourceFromPixels,
  extractSourceColor,
  reset
} as const;

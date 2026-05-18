export type AudioQualityLabel = "Hi-Res" | "SQ" | "HQ" | "MQ" | "LQ";

export interface AudioQualityMetadata {
  fileName?: string | null;
  sampleRate?: number | null;
  bitsPerSample?: number | null;
  bitrateBps?: number | null;
}

const LOSSLESS_EXTENSIONS = new Set([
  "flac",
  "wav",
  "wave",
  "aiff",
  "aif",
  "aifc",
  "alac",
  "ape",
  "wv",
  "tak",
  "tta"
]);

const DSD_EXTENSIONS = new Set(["dsd", "dsf", "dff"]);

const extensionOf = (fileName?: string | null): string | null => {
  if (!fileName) return null;
  const index = fileName.lastIndexOf(".");
  if (index < 0 || index === fileName.length - 1) return null;
  return fileName.slice(index + 1).toLowerCase();
};

export const audioQualityLabelFromMetadata = (
  metadata: AudioQualityMetadata
): AudioQualityLabel | null => {
  const extension = extensionOf(metadata.fileName);
  const sampleRate = metadata.sampleRate ?? null;
  const bitsPerSample = metadata.bitsPerSample ?? null;
  const bitrateBps = metadata.bitrateBps ?? null;
  const isDsd = extension !== null && DSD_EXTENSIONS.has(extension);
  const isLossless = isDsd || (extension !== null && LOSSLESS_EXTENSIONS.has(extension));

  if (isDsd) return "Hi-Res";

  if (
    sampleRate !== null &&
    sampleRate >= 96_000 &&
    bitsPerSample !== null &&
    bitsPerSample >= 24
  ) {
    return "Hi-Res";
  }

  if (
    isLossless &&
    (bitsPerSample === null || bitsPerSample >= 16) &&
    (sampleRate === null || sampleRate >= 44_100)
  ) {
    return "SQ";
  }

  if (bitrateBps === null) return null;
  if (bitrateBps >= 320_000) return "HQ";
  if (bitrateBps >= 160_000) return "MQ";
  return "LQ";
};

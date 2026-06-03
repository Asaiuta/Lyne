import { createEffect, createMemo, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import { songMusicDetail } from "../../shared/api/ncm/search";
import type { TranslationKey, TranslationParams } from "../../shared/i18n";
import { isNumber, isRecord } from "../../shared/jsonReaders";
import type { NcmSongLevel } from "../../shared/state/uiSettingsModel";

export interface PlayerBarNcmQualityOption {
  key: string;
  level: NcmSongLevel;
  label: string;
  shortLabel: string;
  detail: string | null;
}

interface UsePlayerBarNcmQualityOptions {
  songId: Accessor<number | null>;
  selectedLevel: Accessor<NcmSongLevel>;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}

type QualityState =
  | { status: "idle"; songId: number | null; options: PlayerBarNcmQualityOption[]; error: string | null }
  | { status: "loading"; songId: number; options: PlayerBarNcmQualityOption[]; error: string | null }
  | { status: "success"; songId: number; options: PlayerBarNcmQualityOption[]; error: string | null }
  | { status: "error"; songId: number; options: PlayerBarNcmQualityOption[]; error: string | null };

export const QUALITY_LEVELS: readonly Omit<PlayerBarNcmQualityOption, "detail">[] = [
  { key: "l", level: "standard", label: "Standard", shortLabel: "Standard" },
  { key: "m", level: "higher", label: "Higher", shortLabel: "Higher" },
  { key: "h", level: "exhigh", label: "Extra High", shortLabel: "EX" },
  { key: "sq", level: "lossless", label: "Lossless", shortLabel: "SQ" },
  { key: "hr", level: "hires", label: "Hi-Res", shortLabel: "Hi-Res" },
  { key: "je", level: "jyeffect", label: "Spatial Audio", shortLabel: "Spatial" },
  { key: "sk", level: "sky", label: "Surround Audio", shortLabel: "Surround" },
  { key: "jm", level: "jymaster", label: "Master", shortLabel: "Master" }
];

export const ncmSongLevelShortLabel = (level: NcmSongLevel): string =>
  QUALITY_LEVELS.find((item) => item.level === level)?.shortLabel ?? "EX";

const readQualityNumber = (value: unknown): number | null =>
  isNumber(value) ? value : null;

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
};

const parseQualityOptions = (data: unknown): PlayerBarNcmQualityOption[] => {
  if (!isRecord(data)) {
    return [];
  }

  return QUALITY_LEVELS.flatMap((quality) => {
    const item = data[quality.key];
    if (!isRecord(item)) {
      return [];
    }
    const size = readQualityNumber(item.size);
    const br = readQualityNumber(item.br);
    const detail = size !== null ? formatSize(size) : br !== null ? `${Math.round(br / 1000)} kbps` : null;
    return [{ ...quality, detail }];
  });
};

export function usePlayerBarNcmQuality(options: UsePlayerBarNcmQualityOptions) {
  const [state, setState] = createSignal<QualityState>({
    status: "idle",
    songId: null,
    options: [],
    error: null
  });

  createEffect(() => {
    const songId = options.songId();
    setState({ status: "idle", songId, options: [], error: null });
  });

  const ensureLoaded = async () => {
    const songId = options.songId();
    if (songId === null) {
      return;
    }

    const current = state();
    if (current.songId === songId && (current.status === "loading" || current.status === "success")) {
      return;
    }

    setState({ status: "loading", songId, options: [], error: null });
    try {
      const response = await songMusicDetail(songId);
      const parsed = parseQualityOptions(response.data);
      if (options.songId() !== songId) {
        return;
      }
      setState({
        status: "success",
        songId,
        options: parsed,
        error: parsed.length > 0 ? null : options.t("player.quality.unavailable")
      });
    } catch (error) {
      if (options.songId() !== songId) {
        return;
      }
      setState({
        status: "error",
        songId,
        options: [],
        error: error instanceof Error ? error.message : options.t("common.error.requestFailed")
      });
    }
  };

  const selectedOption = createMemo(() => {
    const level = options.selectedLevel();
    return state().options.find((item) => item.level === level) ?? null;
  });

  const selectedLabel = createMemo(() => {
    const level = options.selectedLevel();
    return selectedOption()?.shortLabel ?? QUALITY_LEVELS.find((item) => item.level === level)?.shortLabel ?? "EX";
  });

  return {
    state,
    selectedLabel,
    ensureLoaded
  };
}

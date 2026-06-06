import type { Accessor } from "solid-js";
import type { PlayerState, RequestState } from "../../shared/api/types";
import type { TranslationKey, TranslationParams } from "../../shared/i18n";
import { splitArtists, stripBracketedContent } from "./metadata";

interface UsePlayerBarDisplayOptions {
  request: Accessor<RequestState<PlayerState>>;
  title: Accessor<string | null | undefined>;
  subtitle: Accessor<string | null | undefined>;
  currentLyric: Accessor<string | null | undefined>;
  displayPosition: Accessor<number | null>;
  hideBracketedContent: Accessor<boolean>;
  barLyricShow: Accessor<boolean>;
  showPlayMeta: Accessor<boolean>;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}

export function usePlayerBarDisplay(options: UsePlayerBarDisplayOptions) {
  const player = () => {
    const request = options.request();
    return request.status === "success" ? request.data : null;
  };
  const hasTrack = () => Boolean(player()?.file_path || player()?.media_id);

  const isBarVisible = () => hasTrack();

  const fallbackTitle = () => {
    const request = options.request();
    switch (request.status) {
      case "idle":
        return options.t("player.fallback.waiting");
      case "loading":
        return options.t("player.fallback.loadingState");
      case "error":
        return request.error;
      case "success":
        return null;
      default: {
        const _exhaustive: never = request;
        return _exhaustive;
      }
    }
  };

  const resolvedTitle = () =>
    options.title()?.trim() ||
    (player()?.title ?? player()?.file_path ?? fallbackTitle() ?? options.t("player.fallback.empty"));

  const title = () =>
    options.hideBracketedContent() ? stripBracketedContent(resolvedTitle()) : resolvedTitle();
  const rawArtist = () => options.subtitle()?.trim() || player()?.artist?.trim() || "";
  const artistList = () => splitArtists(rawArtist());
  const artistFallback = () => options.t("player.subtitle.empty");
  const artistText = () => rawArtist() || artistFallback();
  const currentLyric = () => {
    const lyric = options.currentLyric()?.trim();
    return lyric ? lyric : null;
  };
  const showLyric = () => options.barLyricShow() && Boolean(currentLyric());
  const secondaryKey = () => (options.barLyricShow() ? currentLyric() : null) ?? artistText();
  const showSecondaryMeta = () => options.showPlayMeta() && Boolean(secondaryKey());
  const infoKey = () => {
    const state = player();
    return state?.media_id ?? state?.file_path ?? "empty";
  };
  const duration = () => player()?.duration ?? 0;
  const currentTime = () => options.displayPosition() ?? player()?.current_time ?? 0;
  const isPlaying = () => Boolean(player()?.is_playing);
  const sliderVolume = () => Math.max(0, Math.min(1, player()?.volume ?? 0));
  const playbackRateLabel = () => null;
  const qualityLabel = () => {
    const state = player();
    if (!state || state.target_samplerate === null) {
      return options.t("player.quality.source");
    }
    return options.t("player.quality.upsampled", { value: state.target_samplerate });
  };
  const qualityTargetValue = () => {
    const sampleRate = player()?.target_samplerate;
    return sampleRate ? `${sampleRate} Hz` : options.t("player.quality.source");
  };
  const qualityResamplerValue = () => player()?.resample_quality || options.t("common.dash");
  const qualityOutputBitsValue = () => {
    const outputBits = player()?.output_bits;
    return outputBits ? `${outputBits}-bit` : options.t("common.dash");
  };
  const qualityExclusiveValue = () =>
    player()?.exclusive_mode ? options.t("common.on") : options.t("common.off");
  const qualityDitherValue = () =>
    player()?.dither_enabled ? options.t("common.on") : options.t("common.off");
  const qualityLoudnessValue = () =>
    player()?.loudness_enabled ? options.t("common.on") : options.t("common.off");
  const coverAlt = () =>
    options.title()?.trim() || player()?.title || player()?.file_path || options.t("cover.alt");

  return {
    isBarVisible,
    title,
    artistList,
    artistFallback,
    currentLyric,
    showLyric,
    secondaryKey,
    showSecondaryMeta,
    infoKey,
    duration,
    currentTime,
    isPlaying,
    sliderVolume,
    playbackRateLabel,
    qualityLabel,
    qualityTargetValue,
    qualityResamplerValue,
    qualityOutputBitsValue,
    qualityExclusiveValue,
    qualityDitherValue,
    qualityLoudnessValue,
    coverAlt
  };
}

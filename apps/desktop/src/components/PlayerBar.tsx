import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { PlayerState, RepeatMode, RequestState, ShuffleMode } from "../shared/api/types";
import { useTranslation } from "../shared/i18n";
import { CoverArt } from "./CoverArt";
import {
  IconControls,
  IconDots,
  IconExpand,
  IconHeart,
  IconPause,
  IconPlay,
  IconRepeat,
  IconRepeatOne,
  IconShuffle,
  IconSkipNext,
  IconSkipPrev,
  IconPlaylist,
  IconVolumeHigh,
  IconVolumeMute
} from "./icons";

type WsStatus = "connected" | "connecting" | "disconnected";

interface PlayerBarProps {
  request: RequestState<PlayerState>;
  loadingProgress: number | null;
  wsStatus: WsStatus;
  commandError: string | null;
  coverUrl: string | null;
  currentLyric?: string | null;
  canSkipPrev: boolean;
  canSkipNext: boolean;
  livePosition: number | null;
  repeatMode: RepeatMode;
  shuffleMode: ShuffleMode;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (position: number) => void;
  onVolumeChange: (volume: number) => void;
  onSkipPrev: () => void;
  onSkipNext: () => void;
  onCycleRepeat: () => void;
  onToggleShuffle: () => void;
  onCoverClick: () => void;
}

const COMMAND_ERROR_AUTO_DISMISS_MS = 4000;

const formatTime = (value: number) => {
  if (!Number.isFinite(value)) {
    return "0:00";
  }
  const total = Math.max(0, Math.floor(value));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function PlayerBar(props: PlayerBarProps) {
  void props.onStop;
  const { t } = useTranslation();
  const [showRemaining, setShowRemaining] = createSignal(false);
  const [volumePopoverOpen, setVolumePopoverOpen] = createSignal(false);
  const [errorVisible, setErrorVisible] = createSignal(false);
  const [moreOpen, setMoreOpen] = createSignal(false);
  let volumeRef: HTMLDivElement | undefined;
  let moreRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (!volumePopoverOpen()) return;

    const handlePointer = (event: MouseEvent) => {
      if (!volumeRef) return;
      if (event.target instanceof Node && volumeRef.contains(event.target)) {
        return;
      }
      setVolumePopoverOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setVolumePopoverOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointer);
    window.addEventListener("keydown", handleKey);
    onCleanup(() => {
      window.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    });
  });

  createEffect(() => {
    if (!moreOpen()) return;

    const handlePointer = (event: MouseEvent) => {
      if (!moreRef) return;
      if (event.target instanceof Node && moreRef.contains(event.target)) {
        return;
      }
      setMoreOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointer);
    window.addEventListener("keydown", handleKey);
    onCleanup(() => {
      window.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    });
  });

  createEffect(() => {
    const error = props.commandError;
    if (!error) {
      setErrorVisible(false);
      return;
    }
    setErrorVisible(true);
    const timer = window.setTimeout(() => setErrorVisible(false), COMMAND_ERROR_AUTO_DISMISS_MS);
    onCleanup(() => window.clearTimeout(timer));
  });

  const player = () => (props.request.status === "success" ? props.request.data : null);

  const fallbackTitle = () => {
    const request = props.request;
    switch (request.status) {
      case "idle":
        return t("player.fallback.waiting");
      case "loading":
        return t("player.fallback.loadingState");
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

  const title = () =>
    player()?.title ?? player()?.file_path ?? fallbackTitle() ?? t("player.fallback.empty");
  const artistLine = () => player()?.artist?.trim() || t("player.subtitle.empty");
  const currentLyric = () => {
    const lyric = props.currentLyric?.trim();
    return lyric ? lyric : null;
  };
  const secondaryLine = () => currentLyric() ?? artistLine();
  const secondaryLabel = () =>
    currentLyric() ? t("player.meta.lyricLive") : artistLine();
  const duration = () => player()?.duration ?? 0;
  const currentTime = () => props.livePosition ?? player()?.current_time ?? 0;
  const remainingTime = () => Math.max(0, duration() - currentTime());
  const progress = () => (duration() > 0 ? clamp01(currentTime() / duration()) : 0);
  const isPlaying = () => Boolean(player()?.is_playing);
  const canSeek = () => duration() > 0;
  const sliderVolume = () => Math.max(0, Math.min(1, player()?.volume ?? 0));
  const repeatActive = () => props.repeatMode !== "off";
  const shuffleActive = () => props.shuffleMode === "on";
  const RepeatIcon = () => (props.repeatMode === "one" ? IconRepeatOne : IconRepeat);
  const repeatLabel = () => t(`player.repeat.${props.repeatMode}` as const);
  const shuffleLabel = () =>
    shuffleActive() ? t("player.shuffle.on") : t("player.shuffle.off");
  const playPauseLabel = () => (isPlaying() ? t("player.aria.pause") : t("player.aria.play"));
  const timeRight = () =>
    showRemaining() ? `-${formatTime(remainingTime())}` : formatTime(duration());
  const timeToggleLabel = () =>
    showRemaining() ? t("player.toggle.remaining") : t("player.toggle.elapsed");
  const playbackRateLabel = () => null;
  const qualityLabel = () => {
    const state = player();
    if (!state || state.target_samplerate === null) {
      return t("player.quality.source");
    }
    return t("player.quality.upsampled", { value: state.target_samplerate });
  };

  const seekFromClientX = (clientX: number, rect: DOMRect) => {
    if (!canSeek()) return;
    const ratio = clamp01((clientX - rect.left) / rect.width);
    props.onSeek(ratio * duration());
  };

  const handleProgressClick = (event: MouseEvent) => {
    const target = event.currentTarget;
    if (target instanceof HTMLDivElement) {
      seekFromClientX(event.clientX, target.getBoundingClientRect());
    }
  };

  const handleProgressKeyDown = (event: KeyboardEvent) => {
    if (!canSeek()) return;
    const STEP = 5;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      props.onSeek(Math.max(0, currentTime() - STEP));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      props.onSeek(Math.min(duration(), currentTime() + STEP));
    } else if (event.key === "Home") {
      event.preventDefault();
      props.onSeek(0);
    } else if (event.key === "End") {
      event.preventDefault();
      props.onSeek(duration());
    }
  };

  const handleVolumeInput = (event: InputEvent) => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;
    const next = Number.parseFloat(target.value);
    if (!Number.isFinite(next)) {
      return;
    }
    props.onVolumeChange(next);
  };

  const VolumeIcon = () => (sliderVolume() <= 0.001 ? IconVolumeMute : IconVolumeHigh);

  const VolumeSlider = () => (
    <input
      type="range"
      min={0}
      max={1}
      step={0.01}
      value={sliderVolume()}
      onInput={handleVolumeInput}
      disabled={props.request.status !== "success"}
      class="volume-slider"
      aria-label={t("player.aria.volume")}
    />
  );

  return (
    <>
      <Show when={props.commandError && errorVisible()}>
        <div class="command-error-toast" role="status" aria-live="polite">
          {props.commandError}
        </div>
      </Show>
      <footer class="player-bar" aria-label={t("player.aria.controls")}>
        <div
          class={`player-progress-edge${canSeek() ? " is-interactive" : ""}`}
          role={canSeek() ? "slider" : "presentation"}
          aria-label={canSeek() ? t("player.aria.seek") : undefined}
          aria-valuemin={canSeek() ? 0 : undefined}
          aria-valuemax={canSeek() ? Math.round(duration()) : undefined}
          aria-valuenow={canSeek() ? Math.round(currentTime()) : undefined}
          tabIndex={canSeek() ? 0 : -1}
          onClick={handleProgressClick}
          onKeyDown={handleProgressKeyDown}
        >
          <div class="player-progress-edge-fill" style={{ width: `${progress() * 100}%` }}>
            <div class="player-progress-edge-thumb" aria-hidden="true" />
          </div>
          <Show when={props.loadingProgress !== null}>
            <div
              class="player-progress-edge-loading"
              style={{ width: `${props.loadingProgress ?? 0}%` }}
              aria-hidden="true"
            />
          </Show>
        </div>

        <div class="player-bar-left">
          <button
            type="button"
            class="player-bar-cover"
            onClick={props.onCoverClick}
            aria-label={t("player.aria.coverExpand")}
            title={t("player.aria.coverExpand")}
          >
            <CoverArt
              coverUrl={props.coverUrl}
              alt={player()?.title ?? player()?.file_path ?? t("cover.alt")}
            />
            <span class="player-bar-cover-expand" aria-hidden="true">
              <IconExpand />
            </span>
          </button>
          <div class="player-bar-info">
            <div class="player-bar-title-row">
              <div class="player-bar-title" title={title()}>
                {title()}
              </div>
              <Show when={playbackRateLabel()}>
                {(label) => <span class="player-inline-tag player-inline-tag-accent">{label()}</span>}
              </Show>
              <button
                type="button"
                class="player-inline-icon player-like-icon"
                aria-label={t("player.aria.favorite")}
                title={t("player.aria.favorite")}
              >
                <IconHeart />
              </button>
              <div class="player-inline-menu" ref={moreRef}>
                <button
                  type="button"
                  class="player-inline-icon"
                  aria-label={t("player.aria.more")}
                  title={t("player.aria.more")}
                  aria-expanded={moreOpen()}
                  aria-haspopup="menu"
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  <IconDots />
                </button>
                <Show when={moreOpen()}>
                  <div class="player-inline-menu-popover" role="menu" aria-label={t("player.aria.more")}>
                    <button type="button" class="player-menu-item" role="menuitem" onClick={() => setMoreOpen(false)}>
                      {t("player.menu.openAlbum")}
                    </button>
                    <button type="button" class="player-menu-item" role="menuitem" onClick={() => setMoreOpen(false)}>
                      {t("player.menu.viewCredits")}
                    </button>
                    <button type="button" class="player-menu-item" role="menuitem" onClick={() => setMoreOpen(false)}>
                      {t("player.menu.share")}
                    </button>
                  </div>
                </Show>
              </div>
            </div>
            <div class="player-info-secondary" title={secondaryLabel()}>
              {secondaryLine()}
            </div>
          </div>
        </div>

        <div class="player-bar-center">
          <div class="player-bar-transport" role="group" aria-label={t("player.aria.transport")}>
            <button
              type="button"
              class={`transport-button mode-button${shuffleActive() ? " is-active" : ""}`}
              onClick={props.onToggleShuffle}
              aria-label={shuffleLabel()}
              aria-pressed={shuffleActive()}
              title={shuffleLabel()}
            >
              <IconShuffle />
            </button>
            <button
              type="button"
              class="transport-button"
              onClick={props.onSkipPrev}
              disabled={!props.canSkipPrev}
              aria-label={t("player.aria.prev")}
              title={t("player.title.prev")}
            >
              <IconSkipPrev />
            </button>
            <button
              type="button"
              class="transport-button transport-primary"
              onClick={isPlaying() ? props.onPause : props.onPlay}
              aria-label={playPauseLabel()}
              title={playPauseLabel()}
            >
              <Show when={isPlaying()} fallback={<IconPlay />}>
                <IconPause />
              </Show>
            </button>
            <button
              type="button"
              class="transport-button"
              onClick={props.onSkipNext}
              disabled={!props.canSkipNext}
              aria-label={t("player.aria.next")}
              title={t("player.title.next")}
            >
              <IconSkipNext />
            </button>
            <button
              type="button"
              class={`transport-button mode-button${repeatActive() ? " is-active" : ""}`}
              onClick={props.onCycleRepeat}
              aria-label={repeatLabel()}
              aria-pressed={repeatActive()}
              title={repeatLabel()}
            >
              {(() => {
                const Icon = RepeatIcon();
                return <Icon />;
              })()}
            </button>
          </div>
        </div>

        <div class="player-bar-right">
          <div class="player-time-stack">
            <button
              type="button"
              class="player-time-toggle"
              onClick={() => setShowRemaining((prev) => !prev)}
              aria-label={t("player.aria.timeToggle")}
              title={timeToggleLabel()}
            >
              <span class="player-time-current">{formatTime(currentTime())}</span>
              <span class="player-time-divider" aria-hidden="true">/</span>
              <span class="player-time-total">{timeRight()}</span>
            </button>
          </div>

          <div class="player-utility-group" role="group" aria-label={t("player.aria.more")}>
            <span class="player-inline-tag player-right-tag player-utility-hidden">{qualityLabel()}</span>
            <button
              type="button"
              class="player-inline-icon player-utility-button player-utility-hidden"
              aria-label={t("player.aria.more")}
              title={t("player.aria.more")}
            >
              <IconControls />
            </button>
            <div class="player-volume" ref={volumeRef}>
              <button
                type="button"
                class="player-inline-icon player-utility-button volume-toggle player-utility-hidden"
                onClick={() => setVolumePopoverOpen((open) => !open)}
                aria-label={t("player.aria.volumePopover")}
                aria-expanded={volumePopoverOpen()}
                aria-haspopup="dialog"
              >
                {(() => {
                  const Icon = VolumeIcon();
                  return <Icon />;
                })()}
              </button>
              <Show when={volumePopoverOpen()}>
                <div class="player-volume-popover" role="dialog" aria-label={t("player.aria.volume")}>
                  <VolumeSlider />
                  <span class="volume-value">{Math.round(sliderVolume() * 100)}%</span>
                </div>
              </Show>
            </div>
            <button
              type="button"
              class="player-inline-icon player-utility-button"
              aria-label={t("sidebar.nav.queue.label")}
              title={t("sidebar.nav.queue.label")}
            >
              <IconPlaylist />
            </button>
          </div>
        </div>
      </footer>
    </>
  );
}

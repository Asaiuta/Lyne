import { Show } from "solid-js";
import type { JSX } from "solid-js";
import type { PlayerState, RepeatMode, RequestState, ShuffleMode } from "../shared/api/types";
import { ncmSongShareUrl } from "../shared/api/ncm/urls";
import { useTranslation } from "../shared/i18n";
import { useUISearch } from "../shared/state/UISearchContext";
import { useUISettings } from "../shared/state/useUISettings";
import type { ActivePage } from "../shared/ui/navigation";
import type { NcmArtistSummary, NcmLyricLine } from "../features/online/ncmPlayback";
import { PlayerBarInfoPanel } from "./player/PlayerBarInfoPanel";
import { PlayerBarUtilityPanel } from "./player/PlayerBarUtilityPanel";
import { PlayerProgressEdge } from "./player/PlayerProgressEdge";
import { PlayerTransportControls } from "./player/PlayerTransportControls";
import { usePlayerBarCoverTransition } from "./player/usePlayerBarCoverTransition";
import { usePlayerBarCommandError } from "./player/usePlayerBarCommandError";
import { usePlayerBarDisplay } from "./player/usePlayerBarDisplay";
import { usePlayerBarOverlays } from "./player/usePlayerBarOverlays";
import { usePlayerBarProgress } from "./player/usePlayerBarProgress";
import { usePlayerBarTimeFormat } from "./player/usePlayerBarTimeFormat";
import { usePlayerBarNcmQuality } from "./player/usePlayerBarNcmQuality";
import {
  IconHeartBit,
  IconRepeat,
  IconRepeatOne,
  IconShuffle,
  IconVolumeHigh,
  IconVolumeMute
} from "./icons";
import "../shared/styles/components/player.css";

type WsStatus = "connected" | "connecting" | "disconnected";

interface PlayerBarProps {
  request: RequestState<PlayerState>;
  loadingProgress: number | null;
  wsStatus: WsStatus;
  commandError: string | null;
  coverUrl: string | null;
  title?: string | null;
  subtitle?: string | null;
  currentLyric?: string | null;
  canSkipPrev: boolean;
  canSkipNext: boolean;
  livePosition: number | null;
  queueLength: number;
  queueOpen: boolean;
  repeatMode: RepeatMode;
  shuffleMode: ShuffleMode;
  lyrics?: readonly NcmLyricLine[];
  artistLinks?: readonly NcmArtistSummary[];
  isPlayLoading?: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (position: number) => void;
  onVolumeChange: (volume: number) => void;
  onSkipPrev: () => void;
  onSkipNext: () => void;
  onCycleRepeat: () => void;
  onToggleShuffle: () => void;
  onCoverClick: () => void;
  onOpenQueue: () => void;
  onOpenSettings?: () => void;
  onNavigate?: (page: ActivePage) => void;
  onSelectArtist?: (artist: NcmArtistSummary) => void;
  onSelectQuality?: (level: string) => void;
  isLiked?: boolean;
  onToggleLike?: () => void;
}

export function PlayerBar(props: PlayerBarProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const search = useUISearch();

  const { coverTransitioning } = usePlayerBarCoverTransition({
    coverUrl: () => props.coverUrl
  });
  const { errorVisible } = usePlayerBarCommandError({
    commandError: () => props.commandError
  });
  const {
    volumePopoverOpen,
    moreOpen,
    qualityOpen,
    controlsOpen,
    toggleVolumePopover,
    toggleMore,
    toggleQuality,
    toggleControls,
    closeMore,
    closeQuality,
    closeControls,
    setVolumeRef,
    setMoreRef,
    setQualityRef,
    setControlsRef
  } = usePlayerBarOverlays();

  const {
    isBarVisible,
    title,
    artistList,
    artistFallback,
    currentLyric,
    showLyric,
    showSecondaryMeta,
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
  } = usePlayerBarDisplay({
    request: () => props.request,
    title: () => props.title,
    subtitle: () => props.subtitle,
    currentLyric: () => props.currentLyric,
    livePosition: () => props.livePosition,
    hideBracketedContent: () => uiSettings.hideBracketedContent,
    barLyricShow: () => uiSettings.barLyricShow,
    showPlayMeta: () => uiSettings.showPlayMeta,
    t
  });
  const repeatActive = () => props.repeatMode !== "off";
  const shuffleActive = () => props.shuffleMode !== "off";
  const RepeatIcon = () => (props.repeatMode === "one" ? IconRepeatOne : IconRepeat);
  const ShuffleIcon = () => (props.shuffleMode === "heartbeat" ? IconHeartBit : IconShuffle);
  const repeatLabel = () => t(`player.repeat.${props.repeatMode}` as const);
  const shuffleLabel = () => t(`player.shuffle.${props.shuffleMode}` as const);
  const playPauseLabel = () => (isPlaying() ? t("player.aria.pause") : t("player.aria.play"));
  const handlePlayPauseClick = () => {
    if (isPlaying()) {
      props.onPause();
      return;
    }
    props.onPlay();
  };
  const {
    canSeek,
    displayTime,
    progress,
    hoverTime,
    hoverRatio,
    isDragging,
    nearestLyricText,
    setProgressEdgeRef,
    handleProgressClick,
    handleProgressMouseDown,
    handleProgressMouseEnter,
    handleProgressMouseMove,
    handleProgressMouseLeave,
    handleProgressKeyDown
  } = usePlayerBarProgress({
    duration,
    currentTime,
    lyrics: () => props.lyrics ?? [],
    progressAdjustLyric: () => uiSettings.progressAdjustLyric,
    progressLyricShow: () => uiSettings.progressLyricShow,
    onSeek: props.onSeek
  });
  const { timeLeft, timeRight, timeToggleLabel, cycleTimeFormat } = usePlayerBarTimeFormat({
    timeFormat: () => uiSettings.timeFormat,
    duration,
    displayTime,
    t
  });
  const currentNcmSongId = () =>
    props.request.status === "success" ? props.request.data.ncm_song_id : null;
  const ncmQuality = usePlayerBarNcmQuality({
    songId: currentNcmSongId,
    selectedLevel: () => uiSettings.ncmSongLevel,
    t
  });
  const isOnlineNcmTrack = () => currentNcmSongId() !== null;

  const VolumeIcon = () => (sliderVolume() <= 0.001 ? IconVolumeMute : IconVolumeHigh);
  const metadataText = () => {
    const artists = artistList();
    if (artists.length > 0) {
      return artists.join(" / ");
    }
    return artistFallback();
  };
  const copyToClipboard = async (value: string, _feedbackMessage: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(trimmed);
    } catch (error) {
      console.warn("[PlayerBar] clipboard writeText failed", error);
    }
  };
  const handleCopyTitle = () => {
    void copyToClipboard(title(), t("player.feedback.copiedTitle"));
    closeMore();
  };
  const handleCopyArtist = () => {
    void copyToClipboard(metadataText(), t("player.feedback.copiedArtist"));
    closeMore();
  };
  const handleSearch = () => {
    const keyword = title().trim();
    if (!keyword) {
      closeMore();
      return;
    }
    search.setQuery(keyword);
    props.onNavigate?.("recommend");
    search.submitSearch();
    closeMore();
  };
  const handleShare = () => {
    const player = props.request.status === "success" ? props.request.data : null;
    const shareUrl =
      player?.ncm_song_id !== null && player?.ncm_song_id !== undefined
        ? ncmSongShareUrl(player.ncm_song_id, uiSettings.shareUrlFormat)
        : player?.ncm_source_page_url ?? null;
    if (!shareUrl) {
      closeMore();
      return;
    }
    void copyToClipboard(shareUrl, t("player.feedback.copiedShareLink"));
    closeMore();
  };
  const handleSelectArtist = (artistId: number) => {
    const artist = props.artistLinks?.find((item) => item.id === artistId);
    if (!artist) {
      return;
    }
    props.onSelectArtist?.(artist);
  };
  const handleToggleQuality = () => {
    const wasOpen = qualityOpen();
    toggleQuality();
    if (!wasOpen && isOnlineNcmTrack()) {
      void ncmQuality.ensureLoaded();
    }
  };
  const handleSelectQuality = (level: string) => {
    closeQuality();
    if (level === uiSettings.ncmSongLevel) {
      return;
    }
    props.onSelectQuality?.(level);
  };
  const utilityQuality = () => ({
    open: qualityOpen(),
    buttonValue: isOnlineNcmTrack() ? ncmQuality.selectedLabel() : qualityLabel(),
    buttonLabel: t("player.aria.qualityPopover"),
    dialogLabel: t("player.quality.title"),
    mode: isOnlineNcmTrack() ? "online" as const : "output" as const,
    options: ncmQuality.state().options,
    selectedLevel: isOnlineNcmTrack() ? uiSettings.ncmSongLevel : null,
    loading: ncmQuality.state().status === "loading",
    error: ncmQuality.state().error,
    targetLabel: t("player.quality.target"),
    targetValue: qualityTargetValue(),
    resamplerLabel: t("player.quality.resampler"),
    resamplerValue: qualityResamplerValue(),
    outputBitsLabel: t("player.quality.outputBits"),
    outputBitsValue: qualityOutputBitsValue(),
    exclusiveLabel: t("player.quality.exclusive"),
    exclusiveValue: qualityExclusiveValue(),
    ditherLabel: t("player.quality.dither"),
    ditherValue: qualityDitherValue(),
    loudnessLabel: t("player.quality.loudness"),
    loudnessValue: qualityLoudnessValue(),
    hintLabel: t("player.quality.hint"),
    onToggle: handleToggleQuality,
    onSelectLevel: handleSelectQuality,
    ref: setQualityRef
  });
  const utilityControls = () => ({
    open: controlsOpen(),
    buttonLabel: t("player.aria.controlsPopover"),
    menuLabel: t("player.controls.title"),
    equalizerLabel: t("player.controls.equalizer"),
    autoCloseLabel: t("player.controls.autoClose"),
    abLoopLabel: t("player.controls.abLoop"),
    playbackRateLabel: t("player.controls.playbackRate"),
    unavailableDetail: t("player.controls.unavailable"),
    unavailableSuffix: t("player.controls.unavailableSuffix"),
    onToggle: toggleControls,
    onClose: closeControls,
    ref: setControlsRef
  });
  const utilityVolume = () => ({
    open: volumePopoverOpen(),
    value: sliderVolume(),
    icon: VolumeIcon(),
    buttonLabel: t("player.aria.volumePopover"),
    dialogLabel: t("player.aria.volume"),
    sliderDisabled: props.request.status !== "success",
    sliderStyle: { "--volume-fill": sliderVolume().toString() },
    onToggle: toggleVolumePopover,
    onChange: props.onVolumeChange,
    onWheel: ((event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.05 : 0.05;
      const next = Math.max(0, Math.min(1, sliderVolume() + delta));
      props.onVolumeChange(next);
    }) as JSX.EventHandlerUnion<HTMLButtonElement, WheelEvent>,
    ref: setVolumeRef
  });
  const utilityQueue = () => ({
    label: t("sidebar.nav.queue.label"),
    active: props.queueOpen,
    showCount: uiSettings.showPlaylistCount,
    length: props.queueLength,
    onOpen: props.onOpenQueue
  });
  const infoCover = () => ({
    coverHidden: uiSettings.hiddenCovers.player,
    coverTransitioning: coverTransitioning(),
    coverUrl: props.coverUrl,
    coverAlt: coverAlt(),
    coverExpandLabel: t("player.aria.coverExpand"),
    onClick: props.onCoverClick
  });
  const infoMeta = () => ({
    title: title(),
    playbackRateLabel: playbackRateLabel(),
    favoriteLabel: t("player.aria.favorite"),
    isLiked: Boolean(props.isLiked),
    showSecondaryMeta: showSecondaryMeta(),
    showLyric: showLyric(),
    currentLyric: currentLyric(),
    lyricLiveLabel: t("player.meta.lyricLive"),
    artistList: artistList(),
    artistLinks: props.artistLinks,
    artistFallback: artistFallback(),
    onToggleLike: props.onToggleLike,
    onSelectArtist: handleSelectArtist
  });
  const infoMenu = () => ({
    label: t("player.aria.more"),
    open: moreOpen(),
    copyTitleLabel: t("player.menu.copyTitle"),
    copyArtistLabel: t("player.menu.copyArtist"),
    searchLabel: t("player.menu.searchTitle"),
    shareLabel: t("player.menu.share"),
    onToggle: toggleMore,
    onCopyTitle: handleCopyTitle,
    onCopyArtist: handleCopyArtist,
    onSearch: handleSearch,
    onShare: handleShare,
    ref: setMoreRef
  });

  return (
    <>
      <Show when={props.commandError && errorVisible()}>
        <div class="command-error-toast" role="status" aria-live="polite">
          {props.commandError}
        </div>
      </Show>
      <footer
        class={`player-bar z-10 w-full${isBarVisible() ? " is-visible" : ""}`}
        aria-label={t("player.aria.controls")}
        aria-hidden={!isBarVisible()}
      >
        <PlayerProgressEdge
          canSeek={canSeek()}
          isDragging={isDragging()}
          displayTime={displayTime()}
          duration={duration()}
          progress={progress()}
          loadingProgress={props.loadingProgress}
          showTooltip={canSeek() && uiSettings.progressTooltipShow}
          hoverRatio={hoverRatio()}
          hoverTime={hoverTime()}
          hoverLyric={nearestLyricText()}
          seekLabel={t("player.aria.seek")}
          setRef={setProgressEdgeRef}
          onClick={handleProgressClick}
          onMouseDown={handleProgressMouseDown}
          onMouseEnter={handleProgressMouseEnter}
          onMouseMove={handleProgressMouseMove}
          onMouseLeave={handleProgressMouseLeave}
          onKeyDown={handleProgressKeyDown}
        />

        <PlayerBarInfoPanel
          cover={infoCover()}
          meta={infoMeta()}
          menu={infoMenu()}
        />

        <div class="player-bar-center">
          <PlayerTransportControls
            isPlaying={isPlaying()}
            isPlayLoading={Boolean(props.isPlayLoading)}
            canSkipPrev={props.canSkipPrev}
            canSkipNext={props.canSkipNext}
            shuffleActive={shuffleActive()}
            shuffleIcon={ShuffleIcon()}
            repeatActive={repeatActive()}
            repeatIcon={RepeatIcon()}
            playPauseLabel={playPauseLabel()}
            shuffleLabel={shuffleLabel()}
            repeatLabel={repeatLabel()}
            prevLabel={t("player.aria.prev")}
            prevTitle={t("player.title.prev")}
            nextLabel={t("player.aria.next")}
            nextTitle={t("player.title.next")}
            transportLabel={t("player.aria.transport")}
            onPlayPause={handlePlayPauseClick}
            onSkipPrev={props.onSkipPrev}
            onSkipNext={props.onSkipNext}
            onToggleShuffle={props.onToggleShuffle}
            onCycleRepeat={props.onCycleRepeat}
          />
        </div>

        <PlayerBarUtilityPanel
          timeLeft={timeLeft()}
          timeRight={timeRight()}
          timeToggleLabel={timeToggleLabel()}
          onCycleTimeFormat={cycleTimeFormat}
          utilitiesLabel={t("player.aria.more")}
          showPlayerQuality={uiSettings.showPlayerQuality}
          quality={utilityQuality()}
          desktopLyricLabel={t("player.aria.desktopLyric")}
          showDesktopLyric={uiSettings.fullPlayerShowDesktopLyric}
          controls={utilityControls()}
          volume={utilityVolume()}
          queue={utilityQueue()}
        />
      </footer>
    </>
  );
}

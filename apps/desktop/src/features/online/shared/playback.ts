import type { ApiClient, ResolveNcmTrackInput } from "../../../shared/api/client";
import type { PlayerState } from "../../../shared/api/types";
import type { NcmSongLevel } from "../../../shared/state/uiSettingsModel";
import { readUISettingField } from "../../../shared/state/uiSettingsStorage";
import type { NcmTrackReference } from "../ncmPlayback";
import {
  createErrorMessageReader,
  type FeedbackSetter,
  type Translator
} from "./feedback";
import type { OnlineTrackItem } from "./types";

export interface PlaybackContext {
  api: ApiClient;
  t: Translator;
  onRegisterPlayback: (track: NcmTrackReference) => void;
  onApplyPlayerState?: (state: PlayerState) => void;
  onStateRefresh: (expectedPath?: string | null) => Promise<void>;
  setFeedback: FeedbackSetter;
}

export interface PlayAllOptions {
  /**
   * Index within `items` to start playback from. The track at this index is
   * played immediately; every subsequent track is enqueued in order. Items
   * before the index are ignored. Out-of-range or negative values fall back to
   * starting at index 0. Defaults to 0.
   */
  startIndex?: number;
}

export interface PlaybackController {
  playOnlineTrack: (item: OnlineTrackItem) => Promise<void>;
  enqueueOnlineTrack: (item: OnlineTrackItem) => Promise<void>;
  queueNextOnlineTrack: (item: OnlineTrackItem) => Promise<void>;
  /**
   * Play a full list as a queue: play the first eligible track, then enqueue
   * the remaining tracks in their given (visible/filtered/sorted) order. The
   * order of `items` is the queue contract and is preserved exactly. An empty
   * (or fully out-of-range) list is a no-op; a single eligible track only plays
   * and enqueues nothing extra. Error handling matches `playOnlineTrack` /
   * `enqueueOnlineTrack` (each surfaces feedback via `setFeedback`).
   */
  playAll: (items: readonly OnlineTrackItem[], options?: PlayAllOptions) => Promise<void>;
}

export function createPlaybackController(ctx: PlaybackContext): PlaybackController {
  const {
    api,
    t,
    onRegisterPlayback,
    onApplyPlayerState,
    onStateRefresh,
    setFeedback
  } = ctx;
  let playRequestGeneration = 0;

  const readErrorMessage = createErrorMessageReader(t);

  const readSongLevel = (): NcmSongLevel => readUISettingField("ncmSongLevel");

  const buildResolveInput = (item: OnlineTrackItem): ResolveNcmTrackInput => ({
    songId: item.songId,
    level: readSongLevel(),
    sourcePageUrl: item.source_path,
    title: item.title,
    artist: item.artist,
    album: item.album,
    artworkUrl: item.artworkUrl,
    durationSecs: item.duration_secs
  });

  const playOnlineTrack = async (item: OnlineTrackItem) => {
    const requestGeneration = ++playRequestGeneration;
    setFeedback("neutral", t("ncm.feedback.initial"));
    try {
      const result = await api.playNcmTrack(buildResolveInput(item));
      onRegisterPlayback(result.track);
      if (requestGeneration !== playRequestGeneration) return;

      if (onApplyPlayerState) {
        onApplyPlayerState(result.state);
      } else {
        await onStateRefresh(result.track.streamUrl);
      }

      if (requestGeneration === playRequestGeneration) {
        setFeedback("neutral", t("ncm.feedback.initial"));
      }
    } catch (error) {
      if (requestGeneration === playRequestGeneration) {
        setFeedback("error", readErrorMessage(error));
      }
    }
  };

  const enqueueOnlineTrack = async (item: OnlineTrackItem) => {
    try {
      const result = await api.enqueueNcmTrack(buildResolveInput(item));
      onRegisterPlayback(result.track);
      setFeedback("success", t("ncm.feedback.trackQueued", { title: item.title ?? item.songId }));
    } catch (error) {
      setFeedback("error", readErrorMessage(error));
    }
  };

  const queueNextOnlineTrack = async (item: OnlineTrackItem) => {
    try {
      const track = await api.resolveNcmTrack(buildResolveInput(item));
      await api.queueNext(track.streamUrl);
      onRegisterPlayback(track);
      setFeedback("success", t("ncm.feedback.trackQueued", { title: item.title ?? item.songId }));
    } catch (error) {
      setFeedback("error", readErrorMessage(error));
    }
  };

  const playAll = async (
    items: readonly OnlineTrackItem[],
    options: PlayAllOptions = {}
  ) => {
    const startIndex = options.startIndex !== undefined && options.startIndex > 0
      ? options.startIndex
      : 0;
    const [first, ...rest] = items.slice(startIndex);
    if (!first) return;
    await playOnlineTrack(first);
    for (const item of rest) {
      await enqueueOnlineTrack(item);
    }
  };

  return { playOnlineTrack, enqueueOnlineTrack, queueNextOnlineTrack, playAll };
}

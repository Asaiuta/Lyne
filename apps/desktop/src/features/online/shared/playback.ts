import type { ApiClient, ResolveNcmTrackInput } from "../../../shared/api/client";
import { STORAGE_KEYS } from "../../../shared/state/useUISettings";
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
  onStateRefresh: (expectedPath?: string | null) => Promise<void>;
  setFeedback: FeedbackSetter;
}

export interface PlaybackController {
  playOnlineTrack: (item: OnlineTrackItem) => Promise<void>;
  enqueueOnlineTrack: (item: OnlineTrackItem) => Promise<void>;
  queueNextOnlineTrack: (item: OnlineTrackItem) => Promise<void>;
}

export function createPlaybackController(ctx: PlaybackContext): PlaybackController {
  const { api, t, onRegisterPlayback, onStateRefresh, setFeedback } = ctx;

  const readErrorMessage = createErrorMessageReader(t);

  const readSongLevel = () => {
    try {
      return localStorage.getItem(STORAGE_KEYS.ncmSongLevel) ?? "exhigh";
    } catch {
      return "exhigh";
    }
  };

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
    setFeedback("neutral", t("ncm.feedback.initial"));
    try {
      const result = await api.playNcmTrack(buildResolveInput(item));
      onRegisterPlayback(result.track);
      await onStateRefresh(result.track.streamUrl);
      setFeedback("neutral", t("ncm.feedback.initial"));
    } catch (error) {
      setFeedback("error", readErrorMessage(error));
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

  return { playOnlineTrack, enqueueOnlineTrack, queueNextOnlineTrack };
}

import type { ApiClient } from "../../../shared/api/client";
import type { TranslationKey, TranslationParams } from "../../../shared/i18n";
import { STORAGE_KEYS } from "../../../shared/state/useUISettings";
import type { NcmTrackReference } from "../ncmPlayback";
import type { Feedback, OnlineTrackItem } from "./types";

type Translator = (key: TranslationKey, params?: TranslationParams) => string;

export interface PlaybackContext {
  api: ApiClient;
  t: Translator;
  onRegisterPlayback: (track: NcmTrackReference) => void;
  onStateRefresh: (expectedPath?: string | null) => Promise<void>;
  setFeedback: (tone: Feedback["tone"], message: string) => void;
}

export interface PlaybackController {
  registerAndResolveTrack: (item: OnlineTrackItem) => Promise<string>;
  playOnlineTrack: (item: OnlineTrackItem) => Promise<void>;
  enqueueOnlineTrack: (item: OnlineTrackItem) => Promise<void>;
}

export function createPlaybackController(ctx: PlaybackContext): PlaybackController {
  const { api, t, onRegisterPlayback, onStateRefresh, setFeedback } = ctx;

  const readErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : t("common.error.requestFailed");

  const registerAndResolveTrack = async (item: OnlineTrackItem): Promise<string> => {
    const songLevel = (() => {
      try {
        return localStorage.getItem(STORAGE_KEYS.ncmSongLevel) ?? "exhigh";
      } catch {
        return "exhigh";
      }
    })();
    const track = await api.resolveNcmTrack({
      songId: item.songId,
      level: songLevel,
      sourcePageUrl: item.source_path,
      title: item.title,
      artist: item.artist,
      album: item.album,
      artworkUrl: item.artworkUrl,
      durationSecs: item.duration_secs
    });
    onRegisterPlayback(track);
    return track.streamUrl;
  };

  const playOnlineTrack = async (item: OnlineTrackItem) => {
    setFeedback("neutral", t("ncm.feedback.initial"));
    try {
      const url = await registerAndResolveTrack(item);
      await api.load(url, { autoplay: true });
      await onStateRefresh(url);
      setFeedback("neutral", t("ncm.feedback.initial"));
    } catch (error) {
      setFeedback("error", readErrorMessage(error));
    }
  };

  const enqueueOnlineTrack = async (item: OnlineTrackItem) => {
    try {
      const url = await registerAndResolveTrack(item);
      await api.enqueueTrack(url);
      setFeedback("success", t("ncm.feedback.trackQueued", { title: item.title ?? item.songId }));
    } catch (error) {
      setFeedback("error", readErrorMessage(error));
    }
  };

  return { registerAndResolveTrack, playOnlineTrack, enqueueOnlineTrack };
}

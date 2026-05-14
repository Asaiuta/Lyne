import { parseWsEvent } from "./wsTypes";
import type { WsEvent } from "./wsTypes";

type Equal<Actual, Expected> =
  (<T>() => T extends Actual ? 1 : 2) extends
  (<T>() => T extends Expected ? 1 : 2)
    ? true
    : false;

type Expect<T extends true> = T;

export type WsEventNameContract = Expect<
  Equal<
    WsEvent["type"],
    | "loading_progress"
    | "load_complete"
    | "load_error"
    | "track_changed"
    | "playback_ended"
    | "needs_preload"
    | "spectrum_data"
    | "queue_updated"
    | "play"
    | "pause"
    | "stop"
    | "seek"
    | "position"
    | "playback_history_updated"
  >
>;

export const wsWireFixtures = [
  {
    type: "loading_progress",
    progress: 50
  },
  {
    type: "load_complete",
    file_path: "D:/Music/track.flac",
    duration: 180.5
  },
  {
    type: "load_error",
    error: "decode failed"
  },
  {
    type: "track_changed",
    file_path: "D:/Music/track.flac",
    duration: 180.5,
    media_id: "media-1",
    ncm_song_id: null,
    ncm_source_page_url: null,
    title: "Needle",
    artist: "Ada",
    album: null,
    has_cover_art: true,
    external_artwork_url: null
  },
  {
    type: "playback_ended",
    position: 180.5
  },
  {
    type: "needs_preload",
    remaining_secs: 5
  },
  {
    type: "spectrum_data",
    data: [0.1, 0.2]
  },
  {
    type: "queue_updated",
    queue_length: 3
  },
  {
    type: "play",
    position: 10,
    timestamp: 1710000000000
  },
  {
    type: "pause",
    position: 11,
    timestamp: 1710000000001
  },
  {
    type: "stop",
    position: 0,
    timestamp: 1710000000002
  },
  {
    type: "seek",
    position: 25,
    timestamp: 1710000000003
  },
  {
    type: "position",
    position: 26,
    timestamp: 1710000000004
  },
  {
    type: "playback_history_updated",
    timestamp: 1710000000005
  }
] satisfies readonly unknown[];

export const parsedWsWireFixtures = wsWireFixtures.map((fixture) => parseWsEvent(fixture)) satisfies Array<WsEvent | null>;

export const unknownWsWireFixture = parseWsEvent({ type: "future_event" }) satisfies WsEvent | null;
export const invalidWsWireFixture = parseWsEvent({ type: "position", position: Number.NaN, timestamp: 1 }) satisfies WsEvent | null;

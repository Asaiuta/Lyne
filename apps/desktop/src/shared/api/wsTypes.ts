export type WsEvent =
  | { type: "loading_progress"; progress: number }
  | { type: "load_complete"; file_path: string | null; duration: number }
  | { type: "load_error"; error: string }
  | { type: "track_changed"; file_path: string | null; duration: number }
  | { type: "playback_ended" }
  | { type: "needs_preload"; remaining_secs: number }
  | { type: "spectrum_data"; data: number[] }
  | { type: "queue_updated"; queue: unknown[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const readNullableString = (value: unknown): string | null =>
  value === null ? null : readString(value);

const readNumberArray = (value: unknown): number[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const numbers = value.filter((item) => typeof item === "number" && Number.isFinite(item));
  return numbers.length === value.length ? numbers : null;
};

export const parseWsEvent = (raw: unknown): WsEvent | null => {
  if (!isRecord(raw)) {
    return null;
  }

  const eventType = readString(raw.type);
  if (!eventType) {
    return null;
  }

  switch (eventType) {
    case "loading_progress": {
      const progress = readNumber(raw.progress);
      return progress === null ? null : { type: eventType, progress };
    }
    case "load_complete": {
      const filePath = readNullableString(raw.file_path);
      const duration = readNumber(raw.duration);
      if (duration === null) {
        return null;
      }
      return { type: eventType, file_path: filePath, duration };
    }
    case "load_error": {
      const error = readString(raw.error);
      return error ? { type: eventType, error } : null;
    }
    case "track_changed": {
      const filePath = readNullableString(raw.file_path);
      const duration = readNumber(raw.duration);
      if (duration === null) {
        return null;
      }
      return { type: eventType, file_path: filePath, duration };
    }
    case "playback_ended":
      return { type: eventType };
    case "needs_preload": {
      const remaining = readNumber(raw.remaining_secs);
      return remaining === null ? null : { type: eventType, remaining_secs: remaining };
    }
    case "spectrum_data": {
      const data = readNumberArray(raw.data);
      return data ? { type: eventType, data } : null;
    }
    case "queue_updated": {
      const queue = Array.isArray(raw.queue) ? raw.queue : null;
      return queue !== null ? { type: eventType, queue } : null;
    }
    default:
      return null;
  }
};

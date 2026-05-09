export interface NcmLyricLine {
  time: number;
  endTime: number | null;
  text: string;
  translatedText?: string | null;
  words?: readonly NcmLyricWord[];
}

export interface NcmLyricWord {
  startTime: number;
  endTime: number;
  text: string;
}

type TimedWordParser = (body: string) => readonly NcmLyricWord[];

export interface NcmTrackReference {
  songId: number;
  streamUrl: string;
  sourcePageUrl: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  coverUrl: string | null;
  durationSecs: number | null;
}

export interface NcmTrackSupplement {
  status: "loading" | "success" | "error";
  title: string | null;
  artist: string | null;
  album: string | null;
  coverUrl: string | null;
  lyrics: NcmLyricLine[];
  error: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? value : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readArtists = (value: unknown): string | null => {
  const names = asArray(value)
    .map((item) => readString(asRecord(item)?.name))
    .filter((name): name is string => name !== null);
  return names.length > 0 ? names.join(", ") : null;
};

export const mergeNcmTrackReference = (
  previous: NcmTrackReference | undefined,
  next: NcmTrackReference
): NcmTrackReference => ({
  ...previous,
  ...next,
  title: next.title ?? previous?.title ?? null,
  artist: next.artist ?? previous?.artist ?? null,
  album: next.album ?? previous?.album ?? null,
  coverUrl: next.coverUrl ?? previous?.coverUrl ?? null,
  durationSecs: next.durationSecs ?? previous?.durationSecs ?? null
});

export const readSongDetailSupplement = (
  payload: unknown,
  fallbackSongId: number
): Pick<NcmTrackSupplement, "title" | "artist" | "album" | "coverUrl"> | null => {
  const root = asRecord(payload);
  const songs = asArray(root?.songs);
  const target =
    songs
      .map(asRecord)
      .find((song) => readNumber(song?.id) === fallbackSongId) ??
    asRecord(songs[0]);

  if (!target) {
    return null;
  }

  const album = asRecord(target.al) ?? asRecord(target.album);
  return {
    title: readString(target.name),
    artist:
      readArtists(target.ar) ??
      readArtists(target.artists) ??
      readString(asRecord(target.artist)?.name),
    album: readString(album?.name),
    coverUrl: readString(album?.picUrl) ?? readString(target.picUrl)
  };
};

const parseTimestampFraction = (rawFraction: string | undefined): number => {
  if (!rawFraction) {
    return 0;
  }

  if (rawFraction.length === 3) {
    return Number(rawFraction) / 1000;
  }

  if (rawFraction.length === 2) {
    return Number(rawFraction) / 100;
  }

  return Number(rawFraction) / 10;
};

const parseClockTimestamp = (rawValue: string): number | null => {
  const text = rawValue.trim();
  if (!text) {
    return null;
  }

  if (text.endsWith("s") && !text.includes(":")) {
    const seconds = Number(text.slice(0, -1));
    return Number.isFinite(seconds) ? seconds : null;
  }

  const parts = text.split(":");
  const secondsPart = parts[parts.length - 1];
  if (!secondsPart) {
    return null;
  }

  const [rawSeconds, rawFraction] = secondsPart.split(".");
  const seconds = Number(rawSeconds || 0);
  const minutes = parts.length >= 2 ? Number(parts[parts.length - 2] || 0) : 0;
  const hours = parts.length >= 3 ? Number(parts[parts.length - 3] || 0) : 0;
  const fraction = parseTimestampFraction(rawFraction);

  if (![seconds, minutes, hours, fraction].every(Number.isFinite)) {
    return null;
  }

  return (hours * 60 + minutes) * 60 + seconds + fraction;
};

const decodeXmlEntities = (value: string): string =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

const stripXmlTags = (value: string): string =>
  decodeXmlEntities(value.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

const joinWords = (words: readonly NcmLyricWord[]): string =>
  words
    .map((word) => word.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();

const normalizeTimedWords = (words: readonly NcmLyricWord[]): NcmLyricWord[] =>
  words
    .filter(
      (word) =>
        Number.isFinite(word.startTime) &&
        Number.isFinite(word.endTime) &&
        word.endTime >= word.startTime &&
        word.text.trim() !== ""
    )
    .sort((left, right) => left.startTime - right.startTime);

const buildWordTimedLine = (
  lineStartMs: number,
  lineDurationMs: number | null,
  body: string,
  parseWords: TimedWordParser
): NcmLyricLine | null => {
  if (!Number.isFinite(lineStartMs)) {
    return null;
  }

  if (lineDurationMs !== null && !Number.isFinite(lineDurationMs)) {
    return null;
  }

  const words = normalizeTimedWords(parseWords(body));
  const text = joinWords(words);
  if (!text) {
    return null;
  }

  const lastWord = words[words.length - 1];
  return {
    time: lineStartMs / 1000,
    endTime: lineDurationMs === null ? lastWord?.endTime ?? null : (lineStartMs + lineDurationMs) / 1000,
    text,
    words
  };
};

const parseTimedLyricText = (lyric: string): NcmLyricLine[] => {
  const lines: NcmLyricLine[] = [];
  const rawLines = lyric.split(/\r?\n/);

  for (const rawLine of rawLines) {
    const matches = [...rawLine.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    if (matches.length === 0) {
      continue;
    }

    const text = rawLine.replace(/\[[^\]]+\]/g, "").trim();
    if (!text) {
      continue;
    }

    for (const match of matches) {
      const minutes = Number(match[1] ?? 0);
      const seconds = Number(match[2] ?? 0);
      const fraction = parseTimestampFraction(match[3]);
      lines.push({
        time: minutes * 60 + seconds + fraction,
        endTime: null,
        text
      });
    }
  }

  return lines.sort((left, right) => left.time - right.time);
};

const parseYrcLyricText = (lyric: string): NcmLyricLine[] => {
  const lines: NcmLyricLine[] = [];
  const lineRegex = /^\[(\d+),(\d+)\](.*)$/;
  const wordRegex = /\((\d+),(\d+),0\)([^(]*)/g;

  for (const rawLine of lyric.split(/\r?\n/)) {
    const lineMatch = rawLine.match(lineRegex);
    if (!lineMatch) {
      continue;
    }

    const lineStartMs = Number(lineMatch[1]);
    const lineDurationMs = Number(lineMatch[2]);
    const body = lineMatch[3] ?? "";
    if (!Number.isFinite(lineStartMs) || !Number.isFinite(lineDurationMs)) {
      continue;
    }

    const words = [...body.matchAll(wordRegex)]
      .map<NcmLyricWord | null>((match) => {
        const startTimeMs = Number(match[1]);
        const durationMs = Number(match[2]);
        const text = (match[3] ?? "").trim();
        if (!Number.isFinite(startTimeMs) || !Number.isFinite(durationMs) || !text) {
          return null;
        }
        return {
          startTime: startTimeMs / 1000,
          endTime: (startTimeMs + durationMs) / 1000,
          text
        };
      })
      .filter((word): word is NcmLyricWord => word !== null);

    const text = joinWords(words);
    if (!text) {
      continue;
    }

    lines.push({
      time: lineStartMs / 1000,
      endTime: (lineStartMs + lineDurationMs) / 1000,
      text,
      words
    });
  }

  return lines.sort((left, right) => left.time - right.time);
};

const parseQrcLyricText = (lyric: string): NcmLyricLine[] => {
  const lines: NcmLyricLine[] = [];
  const lineRegex = /^\[(\d+),(\d+)\](.*)$/;
  const wordRegex = /([^()[\]]+)\((\d+),(\d+)\)/g;

  for (const rawLine of lyric.split(/\r?\n/)) {
    const lineMatch = rawLine.match(lineRegex);
    if (!lineMatch) {
      continue;
    }

    const lineStartMs = Number(lineMatch[1]);
    const lineDurationMs = Number(lineMatch[2]);
    const body = lineMatch[3] ?? "";
    if (!Number.isFinite(lineStartMs) || !Number.isFinite(lineDurationMs)) {
      continue;
    }

    const words = [...body.matchAll(wordRegex)]
      .map<NcmLyricWord | null>((match) => {
        const text = (match[1] ?? "").trim();
        const startTimeMs = Number(match[2]);
        const durationMs = Number(match[3]);
        if (!Number.isFinite(startTimeMs) || !Number.isFinite(durationMs) || !text) {
          return null;
        }
        return {
          startTime: startTimeMs / 1000,
          endTime: (startTimeMs + durationMs) / 1000,
          text
        };
      })
      .filter((word): word is NcmLyricWord => word !== null);

    const text = joinWords(words);
    if (!text) {
      continue;
    }

    lines.push({
      time: lineStartMs / 1000,
      endTime: (lineStartMs + lineDurationMs) / 1000,
      text,
      words
    });
  }

  return lines.sort((left, right) => left.time - right.time);
};

const parseLysLyricText = (lyric: string): NcmLyricLine[] => {
  const lines: NcmLyricLine[] = [];
  const lineRegex = /^\[(\d+)\](.*)$/;
  const wordRegex = /([^()[\]]+)\((\d+),(\d+)\)/g;

  for (const rawLine of lyric.split(/\r?\n/)) {
    const lineMatch = rawLine.match(lineRegex);
    if (!lineMatch) {
      continue;
    }

    const line = buildWordTimedLine(0, null, lineMatch[2] ?? "", (body) =>
      [...body.matchAll(wordRegex)]
        .map<NcmLyricWord | null>((match) => {
          const text = (match[1] ?? "").trim();
          const startTimeMs = Number(match[2]);
          const durationMs = Number(match[3]);
          if (!Number.isFinite(startTimeMs) || !Number.isFinite(durationMs) || !text) {
            return null;
          }
          return {
            startTime: startTimeMs / 1000,
            endTime: (startTimeMs + durationMs) / 1000,
            text
          };
        })
        .filter((word): word is NcmLyricWord => word !== null)
    );

    const firstWord = line?.words?.[0];
    if (line && firstWord) {
      lines.push({
        ...line,
        time: firstWord.startTime
      });
    }
  }

  return lines.sort((left, right) => left.time - right.time);
};

const parseEslrcLyricText = (lyric: string): NcmLyricLine[] => {
  const lines: NcmLyricLine[] = [];
  const timestampRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const rawLine of lyric.split(/\r?\n/)) {
    const marks = [...rawLine.matchAll(timestampRegex)];
    if (marks.length < 2) {
      continue;
    }

    const words: NcmLyricWord[] = [];
    for (let index = 0; index < marks.length - 1; index += 1) {
      const current = marks[index];
      const next = marks[index + 1];
      const currentEnd = (current.index ?? 0) + current[0].length;
      const nextStart = next.index ?? currentEnd;
      const text = rawLine.slice(currentEnd, nextStart).trim();
      if (!text) {
        continue;
      }

      const currentMinutes = Number(current[1] ?? 0);
      const currentSeconds = Number(current[2] ?? 0);
      const nextMinutes = Number(next[1] ?? 0);
      const nextSeconds = Number(next[2] ?? 0);
      words.push({
        startTime: currentMinutes * 60 + currentSeconds + parseTimestampFraction(current[3]),
        endTime: nextMinutes * 60 + nextSeconds + parseTimestampFraction(next[3]),
        text
      });
    }

    const normalizedWords = normalizeTimedWords(words);
    const text = joinWords(normalizedWords);
    const firstWord = normalizedWords[0];
    const lastWord = normalizedWords[normalizedWords.length - 1];
    if (!firstWord || !lastWord || !text) {
      continue;
    }

    lines.push({
      time: firstWord.startTime,
      endTime: lastWord.endTime,
      text,
      words: normalizedWords
    });
  }

  return lines.sort((left, right) => left.time - right.time);
};

const parseTtmlLyricText = (lyric: string): NcmLyricLine[] => {
  const lines: NcmLyricLine[] = [];
  const paragraphRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  const spanRegex = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;
  const attr = (attributes: string, name: string): string | null => {
    const match = attributes.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"));
    return match?.[1] ?? null;
  };

  for (const paragraph of lyric.matchAll(paragraphRegex)) {
    const attributes = paragraph[1] ?? "";
    const body = paragraph[2] ?? "";
    const begin = attr(attributes, "begin");
    const end = attr(attributes, "end");
    const startTime = begin ? parseClockTimestamp(begin) : null;
    const endTime = end ? parseClockTimestamp(end) : null;
    if (startTime === null) {
      continue;
    }

    const words = [...body.matchAll(spanRegex)]
      .map<NcmLyricWord | null>((span) => {
        const spanAttributes = span[1] ?? "";
        const spanText = stripXmlTags(span[2] ?? "");
        const spanBegin = attr(spanAttributes, "begin");
        const spanEnd = attr(spanAttributes, "end");
        const wordStart = spanBegin ? parseClockTimestamp(spanBegin) : null;
        const wordEnd = spanEnd ? parseClockTimestamp(spanEnd) : null;
        if (wordStart === null || wordEnd === null || !spanText) {
          return null;
        }
        return {
          startTime: wordStart,
          endTime: wordEnd,
          text: spanText
        };
      })
      .filter((word): word is NcmLyricWord => word !== null);

    const text = words.length > 0 ? joinWords(words) : stripXmlTags(body);
    if (!text) {
      continue;
    }

    lines.push({
      time: startTime,
      endTime,
      text,
      words: words.length > 0 ? words : undefined
    });
  }

  return lines.sort((left, right) => left.time - right.time);
};

const mergeTranslatedLyricLines = (
  baseLines: readonly NcmLyricLine[],
  translatedLines: readonly NcmLyricLine[]
): NcmLyricLine[] => {
  if (baseLines.length === 0 || translatedLines.length === 0) {
    return [...baseLines];
  }

  return baseLines.map((line) => {
    const nearest = translatedLines.reduce<NcmLyricLine | null>((current, candidate) => {
      if (current === null) {
        return candidate;
      }
      return Math.abs(candidate.time - line.time) < Math.abs(current.time - line.time)
        ? candidate
        : current;
    }, null);

    if (!nearest || Math.abs(nearest.time - line.time) > 1.2) {
      return line;
    }

    return {
      ...line,
      translatedText: nearest.text
    };
  });
};

export const readLyricLines = (payload: unknown): NcmLyricLine[] => {
  const root = asRecord(payload);
  const yrc = readString(asRecord(root?.yrc)?.lyric);
  const klyric = readString(asRecord(root?.klyric)?.lyric);
  const lrc = readString(asRecord(root?.lrc)?.lyric);
  const tlyric = readString(asRecord(root?.tlyric)?.lyric);
  const ttml = readString(root?.ttml) ?? readString(asRecord(root?.ttml)?.lyric);
  const lys = readString(root?.lys) ?? readString(asRecord(root?.lys)?.lyric);
  const eslrc = readString(root?.eslrc) ?? readString(asRecord(root?.eslrc)?.lyric);
  const candidates = [
    yrc ? parseYrcLyricText(yrc) : [],
    klyric ? parseQrcLyricText(klyric) : [],
    ttml ? parseTtmlLyricText(ttml) : [],
    lys ? parseLysLyricText(lys) : [],
    eslrc ? parseEslrcLyricText(eslrc) : [],
    lrc ? parseTimedLyricText(lrc) : []
  ];

  const translatedLines = tlyric ? parseTimedLyricText(tlyric) : [];

  for (const parsed of candidates) {
    if (parsed.length > 0) {
      return mergeTranslatedLyricLines(parsed, translatedLines);
    }
  }

  return [];
};

export const findActiveLyricIndex = (
  lyrics: readonly NcmLyricLine[],
  currentTime: number
): number => {
  if (lyrics.length === 0 || !Number.isFinite(currentTime)) {
    return -1;
  }

  for (let index = lyrics.length - 1; index >= 0; index -= 1) {
    if (currentTime >= lyrics[index].time) {
      return index;
    }
  }

  return -1;
};

export const findCurrentLyricLine = (
  lyrics: readonly NcmLyricLine[],
  currentTime: number
): string | null => {
  const index = findActiveLyricIndex(lyrics, currentTime);
  return index >= 0 ? lyrics[index]?.text ?? null : null;
};

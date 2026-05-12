import type { FeedCardItem } from "./shared/types";

export interface RadioCategory {
  id: number;
  name: string;
}

export interface RadioCategorySection extends RadioCategory {
  radios: FeedCardItem[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const readNestedCreator = (value: unknown): string | null => {
  if (!isRecord(value)) return null;
  return readString(value.nickname) ?? readString(value.name);
};

export const parseRadioCard = (value: unknown): FeedCardItem | null => {
  if (!isRecord(value)) return null;
  const id = readNumber(value.id ?? value.radioId ?? value.rid);
  const title = readString(value.name ?? value.title);
  if (id === null || title === null) return null;

  const subtitle =
    readString(value.rcmdText) ??
    readString(value.desc) ??
    readString(value.copywriter) ??
    readNestedCreator(value.dj) ??
    readNestedCreator(value.creator);

  return {
    id,
    title,
    subtitle,
    coverUrl: readString(value.picUrl ?? value.picURL ?? value.coverUrl ?? value.coverImgUrl),
    playCount: readNumber(value.playCount ?? value.listenerCount ?? value.subCount),
    description: readString(value.desc ?? value.description)
  };
};

export const parseRadioCategories = (payload: unknown): RadioCategory[] => {
  if (!isRecord(payload)) return [];
  return readArray(payload.categories)
    .map((item) => {
      if (!isRecord(item)) return null;
      const id = readNumber(item.id);
      const name = readString(item.name);
      return id === null || name === null ? null : { id, name };
    })
    .filter((item): item is RadioCategory => item !== null);
};

export const parseRadioCardsFromKey = (payload: unknown, key: "toplist" | "djRadios"): FeedCardItem[] => {
  if (!isRecord(payload)) return [];
  return readArray(payload[key]).map(parseRadioCard).filter((item): item is FeedCardItem => item !== null);
};

export const parseRadioCategorySections = (payload: unknown): RadioCategorySection[] => {
  if (!isRecord(payload)) return [];
  return readArray(payload.data)
    .map((item) => {
      if (!isRecord(item)) return null;
      const id = readNumber(item.categoryId ?? item.id);
      const name = readString(item.categoryName ?? item.name);
      if (id === null || name === null) return null;
      return {
        id,
        name,
        radios: readArray(item.radios).map(parseRadioCard).filter((radio): radio is FeedCardItem => radio !== null)
      };
    })
    .filter((item): item is RadioCategorySection => item !== null);
};

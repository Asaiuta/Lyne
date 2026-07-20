import type { TranslationDict } from "./locales/en";
import type { Locale } from "./types";

export const SUPPORTED_LOCALES = ["en", "zh-CN"] as const satisfies readonly Locale[];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "audio-desktop.locale";

export type LocaleDictionary = Readonly<TranslationDict>;

export interface LoadedLocale {
  readonly locale: Locale;
  readonly dictionary: LocaleDictionary;
}

export interface LocaleStorageReader {
  getItem(key: string): string | null;
}

export interface LocaleDetectionEnvironment {
  readonly storage: LocaleStorageReader | null;
  readonly languages: readonly string[];
}

export type LocaleDictionaryLoader = () => Promise<LocaleDictionary>;
export type LocaleDictionaryLoaders = Readonly<Record<Locale, LocaleDictionaryLoader>>;
export type LoadLocale = (locale: Locale) => Promise<LoadedLocale>;

export const isLocale = (value: string | null | undefined): value is Locale =>
  value !== null &&
  value !== undefined &&
  (SUPPORTED_LOCALES as readonly string[]).includes(value);

const localeFromLanguage = (language: string): Locale | null => {
  const normalized = language.trim().toLowerCase();
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized.startsWith("en")) return "en";
  return null;
};

const browserStorage = (): LocaleStorageReader | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const resolveLocale = (options: {
  readonly storedLocale?: string | null;
  readonly languages?: readonly string[];
}): Locale => {
  if (isLocale(options.storedLocale)) return options.storedLocale;

  for (const language of options.languages ?? []) {
    const locale = localeFromLanguage(language);
    if (locale) return locale;
  }

  return DEFAULT_LOCALE;
};

const browserLocaleEnvironment = (): LocaleDetectionEnvironment => {
  const languages: string[] = [];
  if (typeof navigator !== "undefined") {
    if (navigator.language) languages.push(navigator.language);
    languages.push(...Array.from(navigator.languages ?? []));
  }

  return {
    storage: browserStorage(),
    languages
  };
};

export const detectLocale = (
  environment: LocaleDetectionEnvironment = browserLocaleEnvironment()
): Locale => {
  let storedLocale: string | null = null;
  try {
    storedLocale = environment.storage?.getItem(LOCALE_STORAGE_KEY) ?? null;
  } catch {
    // Storage can be unavailable in private/sandboxed browser contexts.
  }

  return resolveLocale({ storedLocale, languages: environment.languages });
};

export const createCachedLocaleLoader = (
  loaders: LocaleDictionaryLoaders
): LoadLocale => {
  const cache = new Map<Locale, Promise<LoadedLocale>>();

  return (locale: Locale): Promise<LoadedLocale> => {
    const cached = cache.get(locale);
    if (cached) return cached;

    const pending = Promise.resolve()
      .then(() => loaders[locale]())
      .then((dictionary): LoadedLocale => Object.freeze({ locale, dictionary }));

    let guarded: Promise<LoadedLocale>;
    guarded = pending.catch((error: unknown) => {
      if (cache.get(locale) === guarded) cache.delete(locale);
      throw error;
    });
    cache.set(locale, guarded);
    return guarded;
  };
};

const localeLoaders = {
  en: () => import("./locales/en").then((module) => module.en),
  "zh-CN": () => import("./locales/zh-CN").then((module) => module.zhCN)
} satisfies LocaleDictionaryLoaders;

export const loadLocale: LoadLocale = createCachedLocaleLoader(localeLoaders);

export const loadInitialLocale = (
  environment?: LocaleDetectionEnvironment
): Promise<LoadedLocale> => loadLocale(detectLocale(environment));

export interface LocaleCommitterOptions {
  readonly load: LoadLocale;
  readonly updateDocumentLanguage: (locale: Locale) => void;
  readonly persistLocale: (locale: Locale) => void;
  readonly commit: (loaded: LoadedLocale) => void;
}

export const createLocaleCommitter = (
  options: LocaleCommitterOptions
): ((locale: Locale) => Promise<Locale>) =>
  async (locale: Locale): Promise<Locale> => {
    const loaded = await options.load(locale);
    options.updateDocumentLanguage(loaded.locale);
    options.persistLocale(loaded.locale);
    options.commit(loaded);
    return loaded.locale;
  };

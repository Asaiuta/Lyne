import { createContext, createSignal, useContext } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import { interpolate } from "./format";
import {
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  createLocaleCommitter,
  loadLocale,
  type LoadedLocale
} from "./locale";
import type { TranslationKey } from "./locales/en";
import type { Locale, TranslationParams } from "./types";

const updateDocumentLanguage = (locale: Locale): void => {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
};

const persistLocale = (locale: Locale): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Locale switching remains usable when persistence is unavailable.
  }
};

interface I18nContextValue {
  locale: Accessor<Locale>;
  setLocale: (locale: Locale) => Promise<Locale>;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  /**
   * Tagged-string variant for callers that build keys at runtime (eg. by
   * concatenating an enum-like value). Falls back to the key itself when no
   * translation is registered, matching the behaviour of `t`.
   */
  td: (key: string, params?: TranslationParams) => string;
  supportedLocales: readonly Locale[];
}

const I18nContext = createContext<I18nContextValue | null>(null);

interface I18nProviderProps {
  initial: LoadedLocale;
  children: JSX.Element;
}

export function I18nProvider(props: I18nProviderProps) {
  const [loadedLocale, setLoadedLocale] = createSignal<LoadedLocale>(props.initial);
  updateDocumentLanguage(props.initial.locale);

  const locale: Accessor<Locale> = () => loadedLocale().locale;
  const dictionary = (): Readonly<Record<string, string>> => loadedLocale().dictionary;
  const setLocale = createLocaleCommitter({
    load: loadLocale,
    updateDocumentLanguage,
    persistLocale,
    commit: (loaded) => {
      setLoadedLocale(loaded);
    }
  });

  const td = (key: string, params?: TranslationParams): string => {
    const template = dictionary()[key] ?? key;
    return interpolate(template, params);
  };

  const t = (key: TranslationKey, params?: TranslationParams): string => td(key, params);

  return (
    <I18nContext.Provider
      value={{ locale, setLocale, t, td, supportedLocales: SUPPORTED_LOCALES }}
    >
      {props.children}
    </I18nContext.Provider>
  );
}

export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useTranslation must be used within an I18nProvider");
  }
  return ctx;
}

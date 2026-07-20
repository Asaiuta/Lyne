import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCALE_STORAGE_KEY,
  createCachedLocaleLoader,
  createLocaleCommitter,
  detectLocale,
  resolveLocale,
  type LoadedLocale,
  type LocaleDictionary,
  type LocaleDictionaryLoaders
} from "./locale";

const dictionary = (name: string): LocaleDictionary =>
  Object.freeze({ __testDictionary: name }) as unknown as LocaleDictionary;

const enDictionary = dictionary("en");
const zhDictionary = dictionary("zh-CN");

const expectRejected = async (promise: Promise<unknown>, pattern: RegExp): Promise<void> => {
  let caught: unknown;
  try {
    await promise;
  } catch (error: unknown) {
    caught = error;
  }
  assert.equal(caught instanceof Error, true, "expected the promise to reject with an Error");
  if (caught instanceof Error) assert.equal(pattern.test(caught.message), true);
};

test("resolveLocale preserves stored/browser/default precedence", () => {
  const cases = [
    {
      name: "stored locale wins",
      input: { storedLocale: "en", languages: ["zh-CN"] },
      expected: "en"
    },
    {
      name: "Chinese browser locale is supported",
      input: { storedLocale: null, languages: ["zh-Hans-CN", "en-US"] },
      expected: "zh-CN"
    },
    {
      name: "English browser locale is supported",
      input: { storedLocale: "unsupported", languages: ["fr-FR", "en-GB"] },
      expected: "en"
    },
    {
      name: "unsupported locales use the default",
      input: { storedLocale: "fr", languages: ["ja-JP"] },
      expected: "en"
    },
    {
      name: "missing inputs use the default",
      input: {},
      expected: "en"
    }
  ] as const;

  for (const entry of cases) {
    assert.equal(resolveLocale(entry.input), entry.expected, entry.name);
  }
});

test("detectLocale tolerates unavailable storage", () => {
  assert.equal(
    detectLocale({
      storage: {
        getItem(key: string): string | null {
          assert.equal(key, LOCALE_STORAGE_KEY);
          throw new Error("storage unavailable");
        }
      },
      languages: ["zh-TW"]
    }),
    "zh-CN"
  );
});

test("cached locale loader calls only the selected dictionary loader", async () => {
  const calls: string[] = [];
  const load = createCachedLocaleLoader({
    en: async () => {
      calls.push("en");
      return enDictionary;
    },
    "zh-CN": async () => {
      calls.push("zh-CN");
      return zhDictionary;
    }
  });

  const loaded = await load("zh-CN");
  assert.deepEqual(calls, ["zh-CN"]);
  assert.equal(loaded.locale, "zh-CN");
  assert.equal(loaded.dictionary, zhDictionary);
});

test("cached locale loader shares in-flight and fulfilled work", async () => {
  let calls = 0;
  let resolveDictionary: ((value: LocaleDictionary) => void) | undefined;
  const deferred = new Promise<LocaleDictionary>((resolve) => {
    resolveDictionary = resolve;
  });
  const loaders: LocaleDictionaryLoaders = {
    en: () => {
      calls += 1;
      return deferred;
    },
    "zh-CN": async () => zhDictionary
  };
  const load = createCachedLocaleLoader(loaders);

  const first = load("en");
  const second = load("en");
  assert.equal(first, second);
  assert.equal(calls, 0, "loader starts in the next microtask");
  await Promise.resolve();
  assert.equal(calls, 1);

  const resolve = resolveDictionary;
  if (!resolve) throw new Error("deferred locale loader did not expose its resolver");
  resolve(enDictionary);
  const [firstLoaded, secondLoaded] = await Promise.all([first, second]);
  assert.equal(firstLoaded, secondLoaded);
  assert.equal(await load("en"), firstLoaded);
  assert.equal(calls, 1);
});

test("cached locale loader evicts rejected work so a later load can retry", async () => {
  let calls = 0;
  const load = createCachedLocaleLoader({
    en: async () => {
      calls += 1;
      if (calls === 1) throw new Error("first load failed");
      return enDictionary;
    },
    "zh-CN": async () => zhDictionary
  });

  await expectRejected(load("en"), /first load failed/);
  const loaded = await load("en");
  assert.equal(loaded.dictionary, enDictionary);
  assert.equal(calls, 2);
});

test("locale committer publishes one loaded state only after loading succeeds", async () => {
  const initial: LoadedLocale = { locale: "en", dictionary: enDictionary };
  const next: LoadedLocale = { locale: "zh-CN", dictionary: zhDictionary };
  let current = initial;
  const events: string[] = [];
  const setLocale = createLocaleCommitter({
    load: async () => next,
    updateDocumentLanguage: (locale) => events.push(`document:${locale}`),
    persistLocale: (locale) => events.push(`storage:${locale}`),
    commit: (loaded) => {
      events.push(`commit:${loaded.locale}`);
      current = loaded;
    }
  });

  assert.equal(await setLocale("zh-CN"), "zh-CN");
  assert.deepEqual(events, ["document:zh-CN", "storage:zh-CN", "commit:zh-CN"]);
  assert.equal(current, next);
});

test("locale committer preserves the current state and effects on load failure", async () => {
  const initial: LoadedLocale = { locale: "en", dictionary: enDictionary };
  let current = initial;
  const events: string[] = [];
  const setLocale = createLocaleCommitter({
    load: async () => {
      throw new Error("dictionary unavailable");
    },
    updateDocumentLanguage: (locale) => events.push(`document:${locale}`),
    persistLocale: (locale) => events.push(`storage:${locale}`),
    commit: (loaded) => {
      events.push(`commit:${loaded.locale}`);
      current = loaded;
    }
  });

  await expectRejected(setLocale("zh-CN"), /dictionary unavailable/);
  assert.deepEqual(events, []);
  assert.equal(current, initial);
});

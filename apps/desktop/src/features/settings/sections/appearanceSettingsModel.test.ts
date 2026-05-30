import assert from "node:assert/strict";
import test from "node:test";
import type { UISettingsRuntime } from "../../../shared/state/useUISettings";
import {
  STORAGE_KEYS,
  readUISettingsSnapshot
} from "../../../shared/state/useUISettings";
import {
  APPEARANCE_RETURNED_SETTER_FIELDS,
  APPEARANCE_SIGNAL_FIELDS,
  APPEARANCE_SIMPLE_COMMIT_FIELDS,
  APPEARANCE_STYLE_COMMIT_FIELDS,
  commitAppearanceSignalField,
  createAppearanceAccessors,
  createAppearanceFieldCommitters,
  createAppearanceSetterAliases,
  createAppearanceSignals
} from "./appearanceSettingsModel";

const runtimeFromValues = (values: Record<string, string>): UISettingsRuntime => ({
  storage: {
    getItem: (key) => values[key] ?? null
  },
  events: {
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  }
});

test("appearance descriptor groups stay unique and intentionally scoped", () => {
  assert.equal(new Set(APPEARANCE_SIGNAL_FIELDS).size, APPEARANCE_SIGNAL_FIELDS.length);
  assert.equal(
    APPEARANCE_RETURNED_SETTER_FIELDS.every((field) => APPEARANCE_SIGNAL_FIELDS.includes(field)),
    true
  );
  assert.equal(
    APPEARANCE_SIMPLE_COMMIT_FIELDS.every((field) => APPEARANCE_SIGNAL_FIELDS.includes(field)),
    true
  );
  assert.equal(
    APPEARANCE_STYLE_COMMIT_FIELDS.every((field) => APPEARANCE_SIGNAL_FIELDS.includes(field)),
    true
  );
  assert.equal(APPEARANCE_SIGNAL_FIELDS.includes("themeFollowCover"), true);
  assert.equal(APPEARANCE_SIGNAL_FIELDS.includes("fullPlayerShowCommentCount"), true);
});

test("appearance signal factory creates accessors and returned setter aliases", () => {
  const initialSettings = readUISettingsSnapshot(
    runtimeFromValues({
      [STORAGE_KEYS.bgBlur]: "18",
      [STORAGE_KEYS.themeMode]: "light",
      [STORAGE_KEYS.customAccentColor]: "#57c785"
    })
  );
  const signals = createAppearanceSignals(initialSettings);
  const accessors = createAppearanceAccessors(signals);
  const setters = createAppearanceSetterAliases(signals, APPEARANCE_RETURNED_SETTER_FIELDS);

  assert.equal(accessors.bgBlur(), 18);
  assert.equal(accessors.themeMode(), "light");
  assert.equal(accessors.customAccentColor(), "#57c785");

  setters.setBgBlur(24);
  setters.setCustomAccentColor("#56a8ff");

  assert.equal(accessors.bgBlur(), 24);
  assert.equal(accessors.customAccentColor(), "#56a8ff");
});

test("appearance commit factory persists and rolls back through schema fields", () => {
  const values: Record<string, string> = {
    [STORAGE_KEYS.themeMode]: "dark"
  };
  const runtime: UISettingsRuntime = {
    storage: {
      getItem: (key) => values[key] ?? null,
      setItem: (key, value) => {
        values[key] = value;
      }
    },
    events: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }
  };

  const signals = createAppearanceSignals(readUISettingsSnapshot(runtime));
  const accessors = createAppearanceAccessors(signals);
  const committers = createAppearanceFieldCommitters(signals, APPEARANCE_SIMPLE_COMMIT_FIELDS, {
    runtime
  });

  assert.equal(committers.routeAnimation("flow"), true);
  assert.equal(accessors.routeAnimation(), "flow");
  assert.equal(values[STORAGE_KEYS.routeAnimation], "flow");

  const failingRuntime: UISettingsRuntime = {
    storage: {
      getItem: () => null,
      setItem: () => {
        throw new Error("storage unavailable");
      }
    },
    events: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }
  };

  assert.equal(
    commitAppearanceSignalField(signals, "themeMode", "light", failingRuntime),
    false
  );
  assert.equal(accessors.themeMode(), "dark");
});

test("appearance style committers run post-persist hooks only after successful writes", () => {
  const values: Record<string, string> = {};
  let applied = 0;
  const runtime: UISettingsRuntime = {
    storage: {
      getItem: (key) => values[key] ?? null,
      setItem: (key, value) => {
        values[key] = value;
      }
    },
    events: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }
  };
  const signals = createAppearanceSignals(readUISettingsSnapshot(runtime));
  const accessors = createAppearanceAccessors(signals);
  const committers = createAppearanceFieldCommitters(signals, APPEARANCE_STYLE_COMMIT_FIELDS, {
    afterPersist: () => {
      applied += 1;
    },
    runtime
  });

  assert.equal(committers.customAccentColor("#c084fc"), true);
  assert.equal(accessors.customAccentColor(), "#c084fc");
  assert.equal(applied, 1);

  const failingCommitters = createAppearanceFieldCommitters(signals, APPEARANCE_STYLE_COMMIT_FIELDS, {
    afterPersist: () => {
      applied += 1;
    },
    runtime: {
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("storage unavailable");
        }
      },
      events: {
        addEventListener: () => undefined,
        removeEventListener: () => undefined
      }
    }
  });

  assert.equal(failingCommitters.customAccentColor("#fe7971"), false);
  assert.equal(accessors.customAccentColor(), "#c084fc");
  assert.equal(applied, 1);
});

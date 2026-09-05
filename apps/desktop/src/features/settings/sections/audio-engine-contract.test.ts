import assert from "node:assert/strict";
import test from "node:test";

import configRsSource from "../../../../../../src/config.rs?raw";
import audioSettingsRsSource from "../../../../../../src/audio_settings.rs?raw";
import {
  EQ_BANDS,
  EQ_TYPE_OPTIONS,
  LOUDNESS_MODE_OPTIONS,
  NOISE_SHAPER_OPTIONS,
  OUTPUT_BIT_OPTIONS,
  RESAMPLE_QUALITY_OPTIONS,
  STREAMING_FULL_BUFFER_LIMIT_MIB_DEFAULT,
  STREAMING_FULL_BUFFER_LIMIT_MIB_MAX
} from "./audioEngineSettingsModel";

/**
 * B1 contract: the TS engine-option lists in audioEngineSettingsModel.ts are
 * hand-maintained copies of canonical value lists owned by the Rust engine.
 * Drift fails silently (the Rust parsers default unknown input instead of
 * rejecting it), so this test pins the TS lists to the canonical outputs of
 * the `*_to_string()` functions and constants in src/config.rs.
 *
 * The parser functions additionally accept legacy aliases ("standard",
 * "ultrahigh"/"ultra_high", "rg_track"/"rg_album", "1k"/"2k" eq-band names,
 * case-insensitive input). Those are accept-aliases, NOT canonical wire
 * values — the canonical set is always the `*_to_string()` output, which is
 * what the TS option lists must mirror.
 *
 * Extraction is regex-over-`?raw` source on purpose (no cargo invocation):
 * if a Rust file moves or a function is renamed, the marker assertions below
 * fail loudly instead of silently comparing against an empty set.
 */

/** Slice a `pub fn` body by balanced braces (deterministic for top-level fns). */
const rustFnBody = (source: string, fnName: string): string => {
  const fnStart = source.indexOf(`fn ${fnName}`);
  assert.equal(
    fnStart !== -1,
    true,
    `Rust source should define fn ${fnName} (file moved or renamed?)`
  );
  const open = source.indexOf("{", fnStart);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }
  assert.equal(true, false, `fn ${fnName} body should terminate before EOF`);
  return "";
};

/** Canonical strings emitted by a `*_to_string` match: `"value".to_string()`. */
const toStringLiterals = (body: string): string[] =>
  [...body.matchAll(/"([^"]+)"\.to_string\(\)/g)].map((match) => match[1]);

const sorted = (values: readonly string[]): string[] => [...values].sort();

const assertUnique = (label: string, values: readonly string[]): void => {
  assert.equal(new Set(values).size, values.length, `${label} should not contain duplicates`);
};

test("Rust contract sources resolve to the engine files", () => {
  assert.equal(
    configRsSource.includes("pub const DEFAULT_STREAMING_PCM_WINDOW_LIMIT_MIB"),
    true,
    "repo-root src/config.rs should be the engine config (path changed?)"
  );
  assert.equal(
    audioSettingsRsSource.includes("fn validate_update"),
    true,
    "repo-root src/audio_settings.rs should be the settings coordinator (path changed?)"
  );
});

test("NOISE_SHAPER_OPTIONS matches Rust noise_shaper_curve_to_string", () => {
  const canonical = toStringLiterals(
    rustFnBody(configRsSource, "noise_shaper_curve_to_string")
  );
  assertUnique("NOISE_SHAPER_OPTIONS", NOISE_SHAPER_OPTIONS);
  assert.deepEqual(sorted(canonical), sorted([...NOISE_SHAPER_OPTIONS]));
});

test("RESAMPLE_QUALITY_OPTIONS matches Rust resample_quality_to_string", () => {
  // parse_resample_quality accepts the aliases "standard", "ultrahigh" and
  // "ultra_high" (plus case-insensitive input); those are accept-aliases.
  const canonical = toStringLiterals(
    rustFnBody(configRsSource, "resample_quality_to_string")
  );
  assertUnique("RESAMPLE_QUALITY_OPTIONS", RESAMPLE_QUALITY_OPTIONS);
  assert.deepEqual(sorted(canonical), sorted([...RESAMPLE_QUALITY_OPTIONS]));
});

test("LOUDNESS_MODE_OPTIONS matches Rust normalization_mode_to_string", () => {
  // parse_normalization_mode accepts the aliases "rg_track" / "rg_album" and
  // defaults unknown input to "track"; those are accept-aliases.
  const canonical = toStringLiterals(
    rustFnBody(configRsSource, "normalization_mode_to_string")
  );
  assertUnique("LOUDNESS_MODE_OPTIONS", LOUDNESS_MODE_OPTIONS);
  assert.deepEqual(sorted(canonical), sorted([...LOUDNESS_MODE_OPTIONS]));
});

test("EQ_TYPE_OPTIONS matches Rust default and the validated set", () => {
  // eq_type is a free string in EngineSettings, but the settings coordinator
  // validates it to exactly {IIR, FIR} (case-insensitive, normalized to
  // uppercase in src/audio_settings.rs) — so the TS option list must mirror
  // that accepted set, and contain the "IIR" default from src/config.rs.
  const defaultEqType = configRsSource.match(/eq_type:\s*"([^"]+)"\.to_string\(\)/);
  assert.equal(defaultEqType !== null, true, "EngineSettings::default should set eq_type");
  const envDefaultEqType = configRsSource.match(/env_string_or\("AUDIO_EQ_TYPE",\s*"([^"]+)"\)/);
  assert.equal(envDefaultEqType !== null, true, "from_env_defaults should default eq_type");
  assert.equal(
    defaultEqType![1],
    envDefaultEqType![1],
    "eq_type defaults should agree across Default::default and from_env_defaults"
  );

  const accepted = [
    ...rustFnBody(audioSettingsRsSource, "validate_update").matchAll(
      /eq_ignore_ascii_case\("([^"]+)"\)/g
    )
  ].map((match) => match[1]);
  assert.deepEqual(sorted(accepted), ["FIR", "IIR"]);
  assert.deepEqual(sorted(accepted), sorted([...EQ_TYPE_OPTIONS]));
  assert.equal(
    accepted.includes(defaultEqType![1]),
    true,
    "TS EQ_TYPE_OPTIONS should contain the Rust default eq_type (via the accepted set)"
  );
});

test("OUTPUT_BIT_OPTIONS stays within the Rust output_bits clamp and default", () => {
  const clampMatches = [
    ...configRsSource.matchAll(/output_bits\.clamp\(\s*(\d+)\s*,\s*(\d+)\s*\)/g)
  ];
  assert.equal(
    clampMatches.length >= 2,
    true,
    "output_bits clamp should exist in normalized() and apply_update()"
  );
  const clampBounds = clampMatches.map((match) => [Number(match[1]), Number(match[2])]);
  assert.deepEqual(
    clampBounds,
    clampBounds.map(() => clampBounds[0]),
    "all output_bits clamps should agree"
  );
  const [minBits, maxBits] = clampBounds[0];

  const defaultBits = [...configRsSource.matchAll(/output_bits:\s*(\d+)/g)].map((match) =>
    Number(match[1])
  );
  assert.equal(defaultBits.length >= 1, true, "output_bits default should exist");
  assert.equal(
    defaultBits.every((value) => value === defaultBits[0]),
    true,
    "output_bits defaults should agree"
  );

  assertUnique("OUTPUT_BIT_OPTIONS", OUTPUT_BIT_OPTIONS);
  assert.equal(
    OUTPUT_BIT_OPTIONS.every((value) => {
      const bits = Number(value);
      return Number.isInteger(bits) && bits >= minBits && bits <= maxBits;
    }),
    true,
    `each OUTPUT_BIT_OPTIONS value should be within ${minBits}..${maxBits}`
  );
  assert.equal(
    (OUTPUT_BIT_OPTIONS as readonly string[]).includes(String(defaultBits[0])),
    true,
    "OUTPUT_BIT_OPTIONS should contain the Rust default output_bits"
  );
});

test("EQ_BANDS matches Rust CANONICAL_EQ_BAND_NAMES", () => {
  const constMatch = configRsSource.match(
    /const CANONICAL_EQ_BAND_NAMES:\s*\[&str;\s*\d+\]\s*=\s*\[([\s\S]*?)\];/
  );
  assert.equal(
    constMatch !== null,
    true,
    "src/config.rs should define CANONICAL_EQ_BAND_NAMES (file structure changed?)"
  );
  const canonicalBands = [...constMatch![1].matchAll(/"(\d+)"/g)].map((match) => match[1]);
  assert.equal(canonicalBands.length, EQ_BANDS.length, "canonical band count should match");
  assert.deepEqual(canonicalBands, EQ_BANDS.map(String));
});

test("streaming PCM window default/max match the Rust constants", () => {
  const defaultMatch = configRsSource.match(
    /pub const DEFAULT_STREAMING_PCM_WINDOW_LIMIT_MIB:\s*u64\s*=\s*(\d+);/
  );
  const maxMatch = configRsSource.match(
    /pub const MAX_STREAMING_PCM_WINDOW_LIMIT_MIB:\s*u64\s*=\s*(\d+);/
  );
  assert.equal(
    defaultMatch !== null,
    true,
    "src/config.rs should define DEFAULT_STREAMING_PCM_WINDOW_LIMIT_MIB"
  );
  assert.equal(
    maxMatch !== null,
    true,
    "src/config.rs should define MAX_STREAMING_PCM_WINDOW_LIMIT_MIB"
  );
  assert.equal(Number(defaultMatch![1]), STREAMING_FULL_BUFFER_LIMIT_MIB_DEFAULT);
  assert.equal(Number(maxMatch![1]), STREAMING_FULL_BUFFER_LIMIT_MIB_MAX);
});

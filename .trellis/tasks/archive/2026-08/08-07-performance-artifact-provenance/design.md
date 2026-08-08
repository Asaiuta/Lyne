# Design: performance artifact provenance (PERF-005)

> Child of `08-07-full-codebase-audit`, owns PERF-005.
> Wave 3 (performance-evidence) family. Direct successor of
> `08-07-realtime-benchmark-gate-contract` — its gate verdicts are the first
> consumers of the provenance block, and the gate spec's `environment.class`
> is mirrored into the provenance block's build/host identity.

## Problem recap (evidence from research/06-performance.md)

| Artifact family | Today | Missing |
| --- | --- | --- |
| Rust bench JSON (`audio_callback_output_path_perf` schema_v2, `pcm_window_perf` schema_v1) | measurements + `gate` object (new) | generation time, git/dirty identity, profile/toolchain, CPU/OS |
| Electron reports (`electron-webaudio/real-time/real-file…`) | `generated_at` + `environment{platform,arch,node,electron,chrome,v8}` | git state, executable hash, fixture hash |
| Lyne reports (`lyne-*-benchmark.cjs`, `splayer-library`…) | `generated_at` + paths/parameters | git/dirty identity, server binary hash, how it was built |
| Tauri probes (`launch-meta.json` + probe JSON) | `gitHead` from launch-meta | dirty fingerprint, binary hash, toolchain/profile, viewport/device mode bounded to record |

Same-commit artifacts from different dirty trees or binaries are
indistinguishable today; comparison claims (before/after) are not
auditable.

## One versioned provenance block (schemaVersion 1)

Shared JSON shape used by all four families. Rust and Node writers mirror
the same field names so cross-family comparisons and the
`compareProvenance` helper work uniformly.

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-07T10:00:00.000Z",
  "source": {
    "gitHead": "dbbbdafd903ca1e0feb19f7d6359f3e24936ec60",
    "dirty": true,
    "dirtyFingerprint": "sha256hex-of-normalized-porcelain",
    "branch": "feat/desktop-lyric"
  },
  "build": {
    "profile": "release",
    "toolchain": "rustc 1.85.0 (windows-x86_64)",
    "binary": { "path": "target/release/audio_server.exe", "sha256": "hex" }
  },
  "runtime": {
    "node": "20.11.0", "electron": "30.0.0",
    "chrome": "124.0.0.0", "v8": "12.4.0"
  },
  "host": { "os": "windows", "arch": "x86_64", "cpuClass": "unknown|measured" },
  "fixture": [
    { "name": "pipeline-v2/music-16s-44k-stereo.wav", "sha256": "hex" }
  ],
  "workload": { "quick": true, "trials": 3, "percentile": 99.99 },
  "attribution": ["in-process", "no device/DAC", "no end-to-end latency"]
}
```

Field policy (applies to every writer):

- `source.dirtyFingerprint`: SHA-256 over the **normalized** output of
  `git status --porcelain` (paths included as tokens, sorted, one
  normalized line each). It is a hash, never an embedded path list, so
  it is privacy-safe: two machines with the same dirty tree produce the
  same fingerprint; filenames never appear in the artifact.
- `binary.sha256` / `fixture[].sha256`: full file hash. Only the hash and
  relative path are recorded; absolute roots and home/user segments are
  normalized away.
- `attribution`: free-form list of declared measurement limits. Each
  family supplies its own defaults (`in-process`, `no device/DAC`…);
  the block must never claim audible end-to-end latency unless a
  device/loopback measurement existed.
- Omitted fields: use `null`, never invent empty strings.

## Comparability logic (pure, testable)

`compareProvenance(a, b) -> { comparable: boolean, mismatches: string[] }`:

- Always compare: `schemaVersion`, `source.gitHead`, `source.dirtyFingerprint`,
  `build.toolchain` (major/minor), `host.os`, `host.arch`.
- `dirtyFingerprint === null` on either side → mismatch
  `"missing-dirty-fingerprint"` (can't prove same tree).
- Compare `build.binary.sha256` when both sides record a binary.
- Compare `fixture[].sha256` pairwise when both record fixtures.
- Same `gitHead` but different `dirtyFingerprint` → eligible=false
  `"dirty-tree-differs"`. This is the core PERF-005 acceptance.

## 3. Writers / migration

### 3.1 Rust benches — `src/bench_provenance.rs`

New `#[doc(hidden)] pub mod bench_provenance` (precedent: `bench_gate`,
`player::bench_support`). Std-only + `serde`:

- `fn collect(spec: &ProvenanceRequest) -> Provenance` — runs
  `git rev-parse HEAD`, `git status --porcelain`, `git branch
  --show-current` via `std::process::Command` (may fail → `null`
  fields, never panics), hashes binary + fixtures via `sha256` from a
  small std-free SHA-256 impl or `sha2` dependency if present
  (verify: repo already depends on `sha2`? if not use `crypto` feature
  of the existing tree — see implement step 0); reads `profile!()`
  / `env!("PROFILE")` from `--cfg` and
  `std::env::consts::{OS, ARCH}`; CPU class via env probe optional.
- `fn compare(left: &Provenance, right: &Provenance) -> ComparisonResult`
  — pure, mirrors the section-2 rules, unit-tested in-module.
- Bench `--out` JSON: add `provenance: ProvenanceJson` to the existing
  `BenchmarkReport` (schema stays `2` for output_path — additive field
  with `#[serde(default)]`; schema stays `2` unless the struct rejects unknown
fields, in which case bump to `3`). `pcm_window` report
  adds it as well; there is no `--gate` there, report-only gains the
  block.
- No workload change: provenance is collected after the measurement
  loop finishes, before write.

### 3.2 Node perf evidence — `apps/desktop/scripts/provenance-utils.cjs`

Shared helper module (`.cjs`, zero deps, mirrors the Rust block):

- `collectProvenance({ serverPath, fixturePaths, workload, attribution, toolchain })`
  — reads repo git identity via `child_process` (`git rev-parse HEAD`,
  `git status --porcelain`, branch), hashes files with `crypto`, fills
  build/host from `process.versions` + `os.`
- `attachReportProvenance(report, options)` — `report.provenance =
  collectProvenance(options)`; keeps existing `report.generated_at`
  untouched (back-compat: consumers read `generated_at`, new
  `provenance.generatedAt` may differ by ms; document that
  `generated_at` is legacy and frozen).
- `compareProvenance(a, b)` — same logic as Rust.
- All callers (Electron baselines, Lyne benchmarks, real-file,
  splayer-library, pipeline matrix) get a one-line call:
  `attachReportProvenance(report, {...})` before `writeJsonReport`.
- `perf-utils.cjs` gains a thin re-export
  (`collectProvenance` / `attachReportProvenance`) so existing imports
  keep working; no behavior change.

Excluded: report-only scripts (e.g. `electron-webaudio`) do NOT become
gates; provenance is metadata only, exit-code semantics untouched.

### 3.3 Tauri probes — launch-meta extension

- `launch-meta.json` written by the launcher already records `gitHead`;
  this task **extends** it (additive) with `dirtyFingerprint` +
  `branch` + `provenanceSchemaVersion: 1` the same way the Rust/Node
  helpers compute it — the launcher (`research/tauri-perf/…` and
  `apps/desktop/scripts/` sharing the field shape) reuses
  `provenance-utils.cjs`.
- Probe scripts (`page-resource-probe.mjs` etc.) keep their own JSON
  but now `attachReportProvenance` from the shared helper, so each
  probe artifact carries the same block.
- The Tauri probes live under the `07-12-frontend-tauri-performance-trace`
  research folder; this task touches only the shared helper + launcher
  extension, and the task-local probes stay owned by 07-12 unless a
  probe already deviates (checked in implement step 5).

## 4. Acceptance-to-design mapping

| AC | Design |
| --- | --- |
| New artifacts expose versioned block | §3.1–3.3, schemaVersion 1 |
| Different dirty trees / binaries detected incomparable even with same gitHead | §2 `dirty-tree-differs` + binary sha |
| Clean-tree reproducible | fingerprint of clean tree = hash of empty porcelain → stable |
| No tokens/credentials/unrestricted names | §1 privacy (hash-only, relative paths, no embedded file list) + redaction tests |
| Existing consumers tolerate migration | additive fields; `generated_at` frozen; schema bump additive; matrix reads `summary` unchanged |

## 5. Limits / boundaries

- No new measurement, no new gate, no exit-code/verdict change
  (PERF-001 work stays in `08-07-realtime-benchmark-gate-contract`).
- `audio-engine-core` (external repo) artifacts are out of scope
  (external origin, cross-repo provenance may be documented in
  `attribution` but not parsed).
- Tauri visual-trace probes: contract only, actual probe work owned by
  `07-12-frontend-tauri-performance-trace`; ignore-out if those files
  are mid-edit to avoid stepping on the parallel owner.
- Device/DAC/end-to-end claims: provenance only records declared
  `attribution`, never fabricates levels.

## Rollout / rollback

| Phase | Action | Rollback |
| --- | --- | --- |
| 1 | `src/bench_provenance.rs` + unit tests | delete file |
| 2 | wire Rust benches (additive JSON field) | revert schema/`#[serde(default)]` |
| 3 | `provenance-utils.cjs` + Electron/Lyne/splayer scripts | revert script calls |
| 4 | launch-meta extension (additive) | revert field |
| 5 | docs + quality-guidelines updates | revert docs |
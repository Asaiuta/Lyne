# Implementation plan: performance artifact provenance (PERF-005)

Ordered steps; each step must keep build + existing tests green before
moving on. Task boundary: product-side report writers +
`provenance-utils.cjs` + launch-meta extension. Tauri probe internals stay
with `07-12-frontend-tauri-performance-trace` (contract only).

## 0. Pre-flight

- [x] Verify existing SHA-256 availability: `sha2 = "0.10"` already in
      workspace `[dependencies]` (Cargo.toml:150) — no new dependency needed.
      Confirm it is usable from benches (lib dependency, yes).
- [x] Inventory every report emission site again (they may have changed since
      the audit): Rust `--out` writers, Electron baselines, Lyne benchmarks,
      real-file baseline, splayer-library, pipeline matrix child row writers.
- [x] Check `apps/desktop/scripts/provenance-utils.cjs` does not already exist;
      check `perf-utils.cjs` export surface to plan the re-export.

## 1. Shared Rust module: `src/bench_provenance.rs`

- [x] New `#[doc(hidden)] pub mod bench_provenance` in `src/lib.rs`, file with:
      - `Provenance` struct (schemaVersion 1) matching the design §1 JSON;
      - `collect(request: &ProvenanceRequest) -> Provenance` — git identity
        via `std::process::Command` (never panics; failures → null), file
        SHA-256, `env!("CARGO_PKG_PROFILE")` or `profile!()`-style probe,
        `std::env::consts::OS/ARCH`, CPU class optional env probe;
      - `compare(a: &Provenance, b: &Provenance) -> ComparisonResult
        { comparable, mismatches: Vec<String> }` (pure);
      - in-module unit tests: same tree → comparable; same gitHead +
        different dirtyFingerprint → `dirty-tree-differs`; clean-vs-dirty
        mismatch; binary sha mismatch; null fingerprints → missing.
- [x] Format the struct for serde_json; verify schema field names exactly
      match the Node helper (shared contract).

Review gate: `cargo test --lib bench_provenance` green; `cargo build --benches` ok.

## 2. Wire Rust benches

- [x] `benches/audio_callback_output_path_perf.rs`: collect provenance before
      `write_report`, add `provenance: Option<provenance::Provenance>` field to
      `BenchmarkReport` with `#[serde(default)]` (schema_version stays 2, but
      bump to 3 if the struct uses `deny_unknown_fields` anywhere; verify).
      Emit the block in `--report`/`--out` output only (not stdout pollute).
- [x] `benches/pcm_window_perf.rs`: same additive field; verify schema stays 1
      or bump to 2 accordingly.
- [x] Verify both bench JSON outputs parse back and `compareProvenance` works
      on two runs of the same tree (same fingerprint).

## 3. Node helper: `apps/desktop/scripts/provenance-utils.cjs`

- [x] Implement `collectProvenance(options)` (git via child_process, crypto
      hash, process versions, os), `attachReportProvenance(report, options)`,
      `compareProvenance(a, b)`; mirror Rust field names exactly.
- [x] Pure tests (`.test.cjs` next to the helper or under the existing
      `scripts/` test convention — follow lyne-subgates.test.cjs pattern):
      - clean tree fingerprint stable across two invocations;
      - dirty fingerprint differs when a file changes (touch a temp file in a
        temp repo — needs a `--repo` override to point at a fixture git dir,
        or reuse repoRoot with an ignored marker; design a testable seam);
      - redaction: no absolute path / token appears in `source` fields;
      - same gitHead + different dirty → incomparable.
- [x] Re-export from `perf-utils.cjs` (thin), keep existing exports untouched.

Review gate: `node apps/desktop/scripts/run-focused-tests.mjs` green with new
  test registered in `package.json` as `test:provenance` (run-focused only
  compiles `.test.ts` — Node-helper tests must follow the `node --test
  ./scripts/*.test.cjs` convention like `test:lyne-subgates`).

## 4. Migrate node report writers

- [x] `electron-webaudio-baseline.cjs`, `electron-realtime-playback-baseline.cjs`,
      `electron-real-file-playback-baseline.cjs`: call
      `attachReportProvenance(report, { serverPath?, fixturePaths?, workload })`
      before writing; keep existing `generated_at` + `environment`.
- [x] `lyne-playback-latency-benchmark.cjs`, `lyne-playback-stability-benchmark.cjs`,
      `lyne-active-playback-control-probe.cjs`, `lyne-real-library-benchmark.cjs`,
      `splayer-library-benchmark.cjs`: same attach; include
      `attribution: ["sidecar-http", "no-device"]` where true.
- [x] `pipeline-v2-playback-matrix.cjs`: row output gets provenance of the
      child report (child already carries it); classification unchanged.
- [x] Verify by running one cheap script (e.g. lyne-active-playback-control-probe
      or a fixture it supports quickly) and confirm `provenance` block exists
      with correct fields.

## 5. Tauri launch-meta extension

- [x] Locate the launcher that wrote `launch-meta.json` (research/tauri-perf).
      Add `dirtyFingerprint`, `branch`, `provenanceSchemaVersion: 1` via the
      shared `provenance-utils.cjs` (additive, keep `gitHead`).
- [x] If the launcher is mid-edit by the parallel 07-12 owner, only document
      the contract in the SPEC and skip the code change (roll back to
      documentation-only).
- [x] No changes to probe scripts themselves in this task.

## 6. Docs + spec

- [x] quality-guidelines.md: add "Performance artifact provenance contract"
      section (schemaVersion, field policy, comparability rules, redaction).
- [x] docs/performance: mention provenance in the gate-verb table rows that
      already document `--gate`; add "artifact identity" paragraph.
- [x] Update `08-07-realtime-benchmark-gate-contract` archived task? No —
      archived text is history. New docs standalone.

## 7. Verification

- [x] `cargo test` full suite (assert baseline grown, record counts).
- [x] `cd apps/desktop && node ./scripts/run-focused-tests.mjs` green.
- [x] Unit tests: Rust bench_provenance + node provenance-utils covered:
      all four private fields/privacy tests.
- [x] Grep gates:
      - `grep -rn "provenance" benches/audio_callback_output_path_perf.rs` →
        additive field present;
      - `grep -rn "attachReportProvenance" apps/desktop/scripts/*.cjs` →
        every reporter with an artifact writer attaches a block;
      - fixture/redaction test casts the block to JSON and asserts no
        `token`/`password`/absolute-root substring in emitted strings.
- [x] Two-sample comparability evidence: run one writer twice (same tree and
      after touching a scratch file emptied again) — record first vs second
      fingerprints in notes.

## Validation commands

```bash
cargo test --lib bench_provenance
cargo build --benches
cd apps/desktop && node ./scripts/run-focused-tests.mjs
node apps/desktop/scripts/provenance-utils.test.cjs   # if standalone runner
git diff --check
```

## Rollback points

- Step 1–2: delete module + revert bench fields (additive, data-safe).
- Step 3–4: revert helper + call sites (self-contained).
- Step 5: revert launch-meta extension.

## Out of scope reminders

- No new measurement workload, no verdict/exit semantics change.
- `audio-engine-core` external repo artifacts → out of scope.
- Tauri probe code stays with `07-12-frontend-tauri-performance-trace`.
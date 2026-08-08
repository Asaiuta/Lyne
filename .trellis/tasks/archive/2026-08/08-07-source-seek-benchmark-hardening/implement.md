# Source-seek benchmark hardening — execution plan (PERF-002)

Ordered checklist with review gates. Rollback points noted per step.

## 0. Baseline calibration

- [x] Build bench (`cargo rustc --profile release --bench source_seek_perf --
      -C panic=abort` via `scripts/run-release-bench.ps1`) against *current*
      code; run `--quick` and (once) `--heavy`, record p50/p95/p99/max for
      persistent and reopen; save raw numbers in `validation-evidence.md`.
- [x] Choose absolute budgets: `persistent_seek_p99_ns` and
      `reopen_probe_p99_ns` = 3× observed p99 (headroom for host noise),
      rounded; record assumption + host in gate-spec `budget_provenance`.

Review gate: budgets are defensible numbers, not placeholders.

## 1. bench_support split + unit tests

- [x] Replace `benchmark_persistent_source_seeks_for_bench` with
      `SourceSeekBench` session struct (`open_source_seek_bench` /
      `source_seek_bench_fixture_path` / `persistent_seek(index)` /
      `reopen_probe()` / `finish()`) so persistent and reopen measures
      interleave on the SAME session; fixture lifecycle owned by the struct
      (design §3).
- [x] Keep fixture bytes deterministic (unchanged generator).
- [x] Move `percentile` from bench local helper; add `#[cfg(test)]` unit
      tests in `source_seek_perf.rs` for percentile math + relative-guard
      boundary.
- [x] `cargo test` green; `cargo build --benches` ok.

## 2. Bench rewrite (modes + interleave + report)

- [x] Parse args via `bench_gate::parse_args` (report/check/gate);
      `--report <path>` explicit.
- [x] Interleaved measurement loop (alternating persistent/reopen, equal
      counts), warmup runs first.
- [x] Relative guard in Check and Gate: `persistent_p50 <= reopen_p50 +
      2_000_000` else IntegrityFailed exit 3; Report prints but never asserts.
- [x] `--gate` → `bench_gate::finish` with two absolute metrics; gate JSON
      embedded when `--report` present; provenance via
      `bench_provenance::collect` (fixture hashed before deletion).
- [x] Remove unconditional `assert!(persistent_p50 <= reopen_p50)`.
- [x] `cargo test` + `cargo build --benches` + binary smoke run `--check`
      exit 0.

Review gate: `--check` passes; report run never fails on timing.

## 3. Gate spec + over-budget fixture

- [x] `benches/gate-specs/source_seek_perf.gate.json` (schemaVersion 1,
      env class `lyne-dev-bench-gate`, two metrics, integrity
      `["finite"]`, `budget_provenance` filled from step 0).
- [x] `benches/gate-specs/over-budget/source_seek_perf.gate.json` budget_ns=1
      for both metrics.
- [x] Verify: `--gate` without env override → unsupported exit 2; with
      `BENCH_GATE_ENV_CLASS=lyne-dev-bench-gate` → passed exit 0; over-budget
      spec → failed exit 1 (reason contains measured vs budget).

## 4. Docs + spec

- [x] `docs/performance/playback-latency-benchmark.md` (or a new
      `source-seek` subsection): mode table incl. `--enforce` alias note,
      absolute vs relative criteria, statement that local source-seek timing
      is NOT remote-fetch or device-audible latency evidence; fixture identity
      note.
- [x] `.trellis/spec/backend/quality-guidelines.md`: extend the benchmark
      section with source-seek gate row (mode/exit semantics + local-only
      caveat).
- [x] `validation-evidence.md` records baselines, verdicts, suite results.

## 5. Full verification

- [x] `cargo test` full suite (record counts), `cargo clippy --benches` no
      new warnings, `npm test` unaffected (no JS changes).
- [x] Grep gates: no `assert!(persistent_p50` left in benches; `--enforce`
      only as deprecated alias doc mention in this bench.
- [x] JSON parse-back of `--report` output: summary + gate + provenance
      blocks well-formed.

## Rollbacks

- Step 0: budgets are data, revert = no-op spec.
- Step 1: revert split → old combined function (single-file revert).
- Step 2: revert bench rewrite → old 17-line bench (includes assert; restore
  documented noisy behavior until redesign lands).
- Step 3: delete spec files → `--gate` yields misconfigured (exit 2), never a
  false pass.
- Step 4: revert docs only.
# Implementation plan: realtime benchmark gate contract (PERF-001 + PERF-004)

Ordered steps; each step must keep the repo buildable and existing tests
green before moving on. Task boundary: benches are this repo's
`benches/` fixtures + Lyne scripts; `source_seek_perf` is excluded (PERF-002
owner: `08-07-source-seek-benchmark-hardening`).

## 0. Pre-flight evidence

- [x] Record the current `--enforce` behavior for the four benches in task
      notes (run each `--quick --enforce` once, capture exit codes) — baseline
      for the "before" side of the acceptance evidence.
- [x] `grep -rn "audio_callback_output_path_perf --.*enforce\|--enforce" docs/
      README.md .trellis/tasks/archive/ | head` — inventory live callers to
      rewrite in step 4.

## 1. Shared gate module: `src/bench_gate.rs`

- [x] New `#[doc(hidden)] pub mod bench_gate` in `src/lib.rs` and file
      `src/bench_gate.rs` with:
      - `GateMode { Check, Gate }` parser (hand-rolled, no deps);
      - `Verdict` enum (`Passed/Failed/Unsupported/Misconfigured/
        IntegrityFailed`) with stable `verdict=<V>` print format;
      - `GateSpec` serde struct (schemaVersion, benchmark, mode, warmup,
        trials, percentile, deadline, metrics[], environment{class,os,arch,
        profile}, budgetProvenance, integrityChecks[]) + validation;
      - `evaluate_gate(spec, metrics) -> Verdict` (pure; no timers);
      - env-class matching (os/arch/profile + `BENCH_GATE_ENV_CLASS` override
        for CI runners);
      - `gate_self_test()` covering pass/fail/unsupported/integrity verdicts.
- [x] Unit tests in-module: deadline miss rate > target → Failed; p99.99 over
      budget → Failed; env class mismatch → Unsupported; bad schema → 
      Misconfigured; integrity finite check → IntegrityFailed; passing case →
      Passed. (`cargo test --lib bench_gate`)
- [x] `--gate-self-test` CLI entry on shared parsing helper: runs canned
      verdict checks, exit 0 only if all expected.

Review gate: `cargo test --lib bench_gate` green; `cargo build --benches` ok.

## 2. Wire the four canonical benches

Files: `benches/audio_callback_chain_perf.rs`,
`benches/audio_callback_output_path_perf.rs`,
`benches/audio_resampler_streaming_perf.rs`,
`benches/audio_spectrum_handoff_perf.rs`.

- [x] Each bench: parse `--check` (new), `--gate`, `--gate-spec <path>`,
      keep `--enforce` as deprecated alias for `--check` with stderr note;
      default spec path `benches/gate-specs/<bench>.gate.json`.
- [x] Replace inline finite-only asserts: under `--check` keep them as
      integrity checks (exit 3 on failure); under `--gate` route measured
      aggregates into `evaluate_gate` and use the Verdict exit code
      (0/1/2/2/3).
- [x] `audio_callback_output_path_perf`: feed the already-measured
      `callback_p99_99_ns`, `deadline_miss_rate` (per scenario, 512+ frames)
      into the gate; stop gating on best/median only.
- [x] `audio_callback_chain_perf`: add p99-ish tail capture? No — keep chain
      as budget-on-512 `ns_per_buffer` against period-derived budget; the
      spec metric for chain is the 512-frame buffer duration vs the period
      10.67 ms (with `deadline` envelope); document in spec.
- [x] `--out` JSON: add top-level `gate` object (`{"verdict","reason","spec":{...}}`),
      bump `schema_version` only on the four structs (additive via
      `#[serde(default)]` where possible).
- [x] Spec files `benches/gate-specs/*.gate.json` x4 with
      `environment.class = "lyne-dev-bench-gate"` + `BENCH_GATE_ENV_CLASS`
      documented; a second per-bench "(over)" spec under
      `benches/gate-specs/over-budget/` for step 7.

Review gate: each bench `--quick --check` exit 0;
`--quick --gate --gate-spec over-budget/<bench>.gate.json` exits 1 with
expected reason (run once each, record output in task notes).

## 3. Lyne exit folding (PERF-004)

- [x] `apps/desktop/scripts/lyne-playback-latency-benchmark.cjs`:
  - `summary.pass = !report.error && stabilityPass && controlUpdatePass`
    (respect `enabled !== true` skips);
  - add `failure_reasons: []` populated from stability/control summaries
    (e.g. `stability:underrun_delta>0`, `control:ack-fail`);
  - keep exit logic `if (!report.summary.pass) process.exitCode = 1`.
- [x] `pipeline-v2-playback-matrix.cjs`: `classifyRow` guard — if
      `summary.pass === true && (summary.failure_reasons?.length)` treat as
      failed; keep `unsupported_output_format` case; matrix exit unchanged.
- [x] Unit-test the new folding logic (extract a pure `computeSummaryPass`
      helper or add focused node test in `src/**/*.test.ts` per project
      convention) covering enabled/disabled sub-gates.

Review gate: `node apps/desktop/scripts/run-focused-tests.mjs` green.

## 4. Docs + caller rewrite

- [x] `docs/performance/playback-latency-benchmark.md` gate table → new
      vocabulary (`--check` / `--gate`, spec file names, environment class,
      exit codes 0/1/2/3 semantics).
- [x] `grep -rn "audio_callback_output_path_perf"` live callers → rewrite
      (README + any active prd/implement that uses `--enforce`);
      archived task text is left as history (no rewrite of archive).
- [x] `AGENTS.md`/bench guide section if it lists canonical bench commands.

## 5. Verification

- [x] `cargo test` full suite (assert count from step 0 baseline unchanged or
      grown; record).
- [x] `cd apps/desktop && node ./scripts/run-focused-tests.mjs` green.
- [x] Grep gates:
  - `grep -rn "audio_callback_output_path_perf --.*enforce" apps | grep -v node_modules` → only deprecated-alias usage in docs? none.
  - `grep -rn "--enforce" benches/audio_callback_chain_perf.rs
      benches/audio_callback_output_path_perf.rs
      benches/audio_resampler_streaming_perf.rs
      benches/audio_spectrum_handoff_perf.rs` → only alias acceptance.
- [x] Acceptance cross-check from
      prd.md: over-budget fixture fails each canonical bench (specs in
      step 2 record), Lyne sub-gate exit nonzero (node simulation),
      report mode emits full measurements without verdict,
      gate schema fields machine-readable covered by unit tests.

## Validation commands

```bash
cargo test --lib bench_gate
cargo build --benches --release
cargo bench --bench audio_callback_output_path_perf -- --quick --check
./scripts/run-release-bench.ps1 -Bench audio_callback_output_path_perf --quick --gate --gate-spec benches/gate-specs/audio_callback_output_path_perf.gate.json
node apps/desktop/scripts/run-focused-tests.mjs
```

## Rollback points

- Step 1: delete `src/bench_gate.rs` + lib export (no consumers yet).
- Step 2: revert bench files; `--enforce` alias keeps old semantics working.
- Step 3: revert the two `.cjs` scripts (self-contained).
- Step 4: docs only.

## Out of scope reminders

- `source_seek_perf` PERF-002 → `08-07-source-seek-benchmark-hardening`.
- audio-engine-core's own benches → external repo; not rewritten here.
- No new deps (serde already present in workspace; parsing hand-rolled).
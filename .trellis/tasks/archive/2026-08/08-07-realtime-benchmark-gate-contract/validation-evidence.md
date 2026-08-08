# Validation evidence (2026-08, final build)

## Bench verdict matrix (release build, quick profile)

| Bench | `--check` | `--gate` (approved env) | `--gate` over-budget spec | no env class |
| --- | --- | --- | --- | --- |
| audio_callback_chain_perf | exit 0, passed | exit 0, passed (~26-31 µs/512 buffer) | exit 1, failed "measured ... exceeds budget 1000.000 ns" | exit 2, unsupported "environment class mismatch" |
| audio_callback_output_path_perf | exit 0, passed | exit 0, passed (p99.99 63-268 µs < 3% of period) | exit 1, failed "p99.99 ... exceeds budget 1.067 ns" | exit 2, unsupported |
| audio_resampler_streaming_perf | exit 0, passed | exit 0, passed (~8.5 ns/input sample) | exit 1, failed "measured ... exceeds budget 1.000 ns" | exit 2, unsupported |
| audio_spectrum_handoff_perf | exit 0, passed | exit 0, passed (~7.4-8.8 µs/buffer) | exit 1, failed "measured ... exceeds budget 1.000 ns" | exit 2, unsupported |

- `--gate` without `--gate-spec` resolves to the committed default spec
  (`benches/gate-specs/<bench>.gate.json`); verified: chain loads the default
  spec and reports unsupported (env), not misconfigured.
- `--gate-self-test`: verdict smoke exits 0.
- `--enforce` alias -> `--check` with deprecation stderr (verified exit 0).
- Report only (no flag): no verdict line, exit 0.
- JSON report (`--report <path>`): embeds
  `gate: {mode, verdict, reason, exit_code}` and is written **before** the
  gate exit, so failed gates still produce machine-readable evidence.

## Test suites

- `cargo test --lib`: 387 passed / 0 failed (incl. 7 `bench_gate` unit tests:
  parse, reject-unknown, pass, over-budget fail, deadline-miss fail, integrity
  fail, exit-code stability + self-test usages).
- `cargo clippy --benches`: no warnings from bench_gate or the four benches
  (pre-existing repo warnings only).
- `cargo build --benches`: clean.
- `node --test scripts/lyne-subgates.test.cjs` (apps/desktop): 5/5 passed.
- `node ./scripts/run-focused-tests.mjs` (apps/desktop): 520 passed / 0 failed.
- `npm run typecheck` (apps/desktop): clean.

## Gate contract checks

- `measureSubGates` semantics: disabled stability/control participate as pass;
  enabled failures push `stability:sub-gate-failed` / `control:sub-gate-failed`
  into `summary.failure_reasons`; `summary.pass` folds both.
- `pipeline-v2-playback-matrix.cjs::classifyRow` treats a passing summary that
  carries failure reasons as failed (defensive guard).
- Gate spec folder: 4 standard specs + 4 over-budget fixtures;
  specs with empty `metrics` are rejected by `load_spec`
  ("a gate without a budget is not a gate").
- Mode precedence: `--gate` > `--check`/`--enforce` > report.

## Grep gates

- `--enforce` in the four canonical benches: 0 (alias handled in shared parser).
- `audio_callback_* --enforce` references in docs/README/tasks: none (rewritten
  to `--check`; `06-08-shared-state-split/prd.md` updated).
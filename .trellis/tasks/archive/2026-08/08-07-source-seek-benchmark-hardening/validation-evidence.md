# Validation evidence — source-seek benchmark hardening (PERF-002)

Task: `08-07-source-seek-benchmark-hardening` · status: in progress

## Step 0 — Baselines (pre-rewrite, old binary)

Sequential measurement (all persistent, then all reopen), no warmup,
unconditional `assert!(persistent_p50 <= reopen_p50)`.

| Run | persistent p50 | persistent p99 | reopen p50 | reopen p99 |
| --- | ---: | ---: | ---: | ---: |
| quick #1 | 8.2 µs | 261.6 µs | 97.9 µs | 307.6 µs |
| quick #3 | 8.0 µs | 180.1 µs | 112.5 µs | 280.3 µs |
| full | 8.1 µs | 63.5 µs | 96.7 µs | 261.9 µs |

Budget decision (3× observed quick/full p99 with headroom):
`persistent_seek_p99_ns = 750_000` (≥3× 262 µs), `reopen_probe_p99_ns = 950_000`
(≥3× 319 µs). Recorded in `benches/gate-specs/source_seek_perf.gate.json`
`budget_provenance`.

## Step 2 — Rewrite smoke (new bench)

Report mode (no flag): exit 0, no timing assert. Quick-mode sample rows:

| Run | persistent p50 | persistent p99 | reopen p50 | reopen p99 | delta p50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| #1 | 8.5 µs | 80 µs | 149.3 µs | 235.3 µs | −140.8 µs |
| #2 | 12.3 µs | 113.4 µs | 166.7 µs | 270.8 µs | −154.4 µs |
| #3 (report) | 10.2 µs | 21.8 µs | 148.9 µs | 239.2 µs | −138.7 µs |
| full --check | — | — | — | — | −142.0 µs (exit 0) |

Persistent seek is structurally faster than reopen+probe → relative guard
`persistent p50 ≤ reopen p50 + 2 ms` holds with large margin.

## Gate matrix (final release binary, 2026-08-08)

| Mode | Env/class | Spec | Verdict | Exit | Evidence |
| --- | --- | --- | --- | ---: | --- |
| (no flag) report | any | — | none | 0 | never fails on timing |
| `--check` | any | built-in integrity | passed | 0 | finite/positive metrics + relative guard |
| `--gate` | approved `BENCH_GATE_ENV_CLASS=lyne-dev-bench-gate` | default spec | passed | 0 | absolute budgets met |
| `--gate` | unset (local) | default spec | unsupported | 2 | env class mismatch, never passed |
| `--gate --gate-spec over-budget` | approved | budget_ns=1 | failed | 1 | reason: measured 62.9 µs > 1 ns budget |
| `--gate-self-test` | any | canned | — | 0 | — |

## Report JSON (schema_version 2)

- `--report .tmp/ssr.json`: embeds `persistent`/`reopen` summaries
  `{count,p50_ns,p95_ns,p99_ns,max_ns}`, `relative_delta_p50_ns`, `gate`
  `{mode,verdict,reason,exit_code}` (skip when report-only), provenance block
  (git HEAD, dirty fingerprint, branch, profile, host, fixture sha256).
- Fixture identity: `.tmp/source-seek-bench-*.wav` repo-relative with `/`
  separators (cross-family consistent with Node `repo_relative`); fixture is
  removed by `finish()` — zero residue checked.
- Over-budget run still writes the report before exit(1): gate=failed, exit 1.

## Privacy / determinism

- `bench_provenance::repo_relative` fallback for outside-repo paths returns
  basename only (never absolute user path). New unit tests:
  `repo_relative_falls_back_to_basename_outside_repo`,
  `repo_relative_uses_forward_slashes_inside_repo` (11/11 provenance tests).
- Fixture content deterministic: same sha256 across runs.

## Final suite

- `cargo test`: 401 passed / 0 failed (incl. 3 new `source_seek_bench`
  lib tests + 11 provenance + 7 bench_gate).
- `cargo clippy --bench source_seek_perf`: no warnings in new code.
- Lib-wide clippy: 66 pre-existing warnings, untouched by this task.

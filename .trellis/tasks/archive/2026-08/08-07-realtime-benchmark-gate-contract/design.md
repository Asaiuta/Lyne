# Design: trustworthy realtime benchmark gate contract

> Child of `08-07-full-codebase-audit`, owns PERF-001 + PERF-004.
> Wave 3 (performance-evidence) family: `08-07-performance-artifact-provenance`,
> `08-07-source-seek-benchmark-hardening`, `07-12-frontend-tauri-performance-trace`.

## Problem recap (evidence from research/06-performance.md)

Current "gates" are reachability checks, not budget gates:

| Bench | Today's `--enforce` | Evidence (research) |
| --- | --- | --- |
| `audio_callback_chain_perf` | one 512-frame `active_dsp_no_convolver` row finite + > 0 | `:107-110` |
| `audio_callback_output_path_perf` | best/median finite + > 0 on 512-frame rows only (deadline/p99..p99.99 already measured, unused) | `:189-195` |
| `audio_resampler_streaming_perf` | one 44.1→48 borrowed 512-frame row finite + non-empty output | `:113-120` |
| `audio_spectrum_handoff_perf` | analyzer timing finite + > 0 | `:111-115` |

Lyne side (PERF-004):

- `lyne-playback-latency-benchmark.cjs` computes `stability_pass` /
  `control_update_pass`, but `summary.pass` is hardcoded `true`
  (line ~1229); exit code only reads `summary.pass` → sub-gate failures
  still exit 0.
- `pipeline-v2-playback-matrix.cjs::classifyRow` only checks
  `report?.summary?.pass` → failed rows are impossible from sub-gates.

Docs/task checklists that call these "gates": 
`docs/performance/playback-latency-benchmark.md:283-286`,
`07-03-core-dep-integration/prd.md:41`, multiple archived checklists.

## Design overview

Three explicit modes, one machine-readable gate contract, one truth per
benchmark. All four canonical benches share one Rust gate module; the two
Lyne scripts share one verdict JSON shape. No absolute budget is enforced
without an explicit spec that names its environment class.

```text
cargo bench --bench audio_callback_output_path_perf -- [--quick|--heavy]
    [--check]                     # deterministic integrity only, exit 0/3
    [--gate [--gate-spec file]]   # real budget gate, exit 0/1/2/3
    [--gate-self-test]            # smoke: pass/fail/unsupported verdicts

node scripts/lyne-playback-latency-benchmark.cjs ...  # summary.pass now folds
                                                      # stability+control sub-gates
node scripts/pipeline-v2-playback-matrix.cjs          # classifyRow keeps sub-gate failures
```

### 1. Gate contract document (JSON, schemaVersion 1)

Path: `benches/gate-specs/<bench>.gate.json` (new dir, committed).

```json
{
  "schemaVersion": 1,
  "benchmark": "audio_callback_output_path_perf",
  "mode": "gate",
  "warmup": 1,
  "trials": 3,
  "percentile": 99.99,
  "deadline": {
    "framePeriodNsProvenance": "512 frames / 48kHz callback period = 10.6667 ms",
    "targetMissRate": 0.0,
    "targetP9999FractionOfPeriod": 0.1
  },
  "metrics": [
    {
      "name": "callback_p99_99_ns",
      "budgetNsPctOfPeriod": 100,
      "source": "measured in-process callback tail, schema_version=2 JSON",
      "hostSensitive": true
    }
  ],
  "environment": {
    "class": "lyne-dev-bench-gate",
    "os": "windows",
    "arch": "x86_64",
    "profile": "release",
    "requiresWarmup": true,
    "notes": "approved: 2026-08 CI runner / dev machine with quiet background load"
  },
  "budgetProvenance": "declared 512-frame callback period at 48 kHz; percentiles from output-path bench's existing p99.99 aggregate (not best-of). See docs/performance/playback-latency-benchmark.md gate table.",
  "integrityChecks": ["finite", "positive", "outputNonEmpty", "deadlineAccounting"]
}
```

- Same schema is consumed for `window_seek_perf` (ports its inline p99 gate +
  spread gate into the spec) and keeps `playback_load_budget_perf` /
  `audio_quality_measurements` (already have real gates; they stay unchanged,
  they only adopt the `--gate` exit-code contract if cheap — see implement).
- A spec with an empty `metrics` array or missing `environment.class` fails
  spec validation (exit 2) — no silent "gate" without a budget.

### 2. Shared Rust gate module

New `src/bench_gate.rs`, exposed as `audio_engine::bench_gate` behind
`#[doc(hidden)] pub mod` (precedent: `player::bench_support` is already a
bench-facing lib module).

```rust
pub enum GateMode { Check, Gate }
pub enum Verdict {
    Passed,                 // exit 0
    Failed { reason: String }, // exit 1
    Unsupported { reason: String }, // exit 2
    Misconfigured { reason: String }, // exit 2
    IntegrityFailed { reason: String }, // exit 3 (deterministic, no budget)
}
pub struct GateSpec { ... } // serde Deserialize, schemaVersion validated
pub fn evaluate_gate(spec: &GateSpec, metrics: &GateMetrics) -> Verdict;
pub fn self_test_verdicts() -> Result<(), String>; // canned pass/fail scenarios
```

- `evaluate_gate` never touches timers; benches pass measured aggregates.
  Unit tests live in the module (`cargo test bench_gate`).
- Verdict line printed in a stable format
  `bench_gate verdict=<Verdict> bench=<name> mode=<mode> reason=<...>`, and any
  `--out` JSON gets a top-level `"gate"` object added to the existing report.
- `--gate-self-test` runs canned over-budget / finite-check / unsupported-env
  cases and exits 0 only if all three verdicts come back as expected — this is
  the acceptance "injected over-budget fixture fails for documented reason"
  without needing a long host run cycle.

### 3. CLI contract per canonical bench

Accepted flags (`parse_args` stays hand-rolled, no new deps):

- `--quick | --heavy` unchanged (fixture scale).
- `--check` — old cheap integrity asserts, plus existing relative % checks where
  a bench already had them (dv:: `audio_derived_constants_perf` etc. untouched).
  Verdict: integrity failure → exit 3. No timing budget.
- `--gate [--gate-spec <path>]` — default spec path
  `benches/gate-specs/<bench-name>.gate.json` unless `--gate-spec` given.
  Verdicts: Passed → 0, Failed → 1, Unsupported/Misconfigured → 2.
- `--out <path>` unchanged; report schema gains `gate` object when `--gate`.
- `--enforce` RENAMED to `--check`. Keep `--enforce` accepted for a transition
  window as an alias of `--check` (one-month), printing a deprecation note;
  then remove in a later cleanup. Rationale: today's `--enforce` semantic is
  exactly "integrity check", so aliasing is honest.
- `--gate-self-test` runs embedded verdict smoke without measuring.

Mode precedence: `--gate` > `--check`/`--enforce` > default (report-only).
Report-only = whole measurement suite, no verdict lines, exit 0 as long as
the bench itself completes (respect valid input errors → exit 1 with clear
message, because a crashed bench is never "pass").

### 4. Lyne players-latency exit contract (PERF-004)

`lyne-playback-latency-benchmark.cjs`:

```js
report.summary = {
  pass: !report.error && stabilityPass && controlUpdatePass,
  stability_pass: stabilityPass,
  control_update_pass: controlUpdatePass,
  failure_reasons: [],   // e.g. ["stability:underrun_delta>0", "control:ack-failure"]
  ...existing fields
};
```

- `stability.enabled`/`control_updates.enabled` are respected: disabled → gate
  participates as `true` (unchanged, so plain latency runs keep working).
- Exit code logic stays `if (!report.summary.pass) process.exitCode = 1;` —
  now it actually fires.
- Failure reason strings carried into `summary.failure_reasons` so the matrix
  can classify without re-deriving.

`pipeline-v2-playback-matrix.cjs`:

- `classifyRow` logic: `passed` only if `summary.pass`; else keep existing
  `unsupported_output_format` special case; else `failed`. Because
  `summary.pass` now folds the sub-gates, sub-gate failures classify failed
  automatically without matrix changes — but add a defensive guard: if
  `summary.pass === true` and `summary.failure_reasons.length > 0` treat as
  failed (protects against future divergence).
- Matrix summary counts + exit code (fail > 0 → exit 1) unchanged.

### 5. Provenance + environment class

- Every `--gate` run records in stdout + JSON gate object: spec path, spec
  `environment.class`, `profile`, `trials`, `warmup`, measured percentile,
  budget source string; this satisfies "budget provenance machine-readable".
- Environment class matching: spec's `os/arch/profile` preferred; if the
  current process reports a mismatch, verdict `Unsupported` (exit 2), never
  `Passed`.
  This is the hook `08-07-performance-artifact-provenance` can later sign.
- Deterministic pre-budget checks (`integrity`) eval before budget metrics so a
  noisy host can't turn a real bug into a "timeout": integrity fail → exit 3,
  budget fail → exit 1, both reasons distinct in JSON.

### 6. Backward compatibility / docs

- Old `--enforce` callers: 3 docs spots (performance doc tail gate table,
  07-03-core-dep-integration prd gate, archived checklists referenced by
  implement docs). Rewrite live docs to the new vocabulary:
  - `docs/performance/playback-latency-benchmark.md` table → `--check` +
    `--gate` rows with the spec file names;
  - search `grep -rn "audio_callback_output_path_perf --.*enforce"` for
    remaining live callers: README, `crates/*`, `benches/*`, no-op cleanup.
- `--out` schema: increase `schema_version` to 3 on the four benches'
  JSON reports if they can't keep additive `gate` object without a bump —
  keep additive without bump where the struct permits (`#[serde(default)]`).
- `run-release-bench.ps1` untouched (passes any bench args through-correctly).

### 7. Out of scope (task boundary)

- `source_seek_perf` silent assertion (PERF-002) → owned by
  `08-07-source-seek-benchmark-hardening`.
- audio-engine-core repo's own benches (`crates/audio-engine-core/…` and the
  external dep) → not this repo's fixtures; the external repo has its own
  gates; cross-repo provenance in `08-07-performance-artifact-provenance`.
- `audio_quality_measurements`, `playback_load_budget_perf` already gate
  honestly; only adopt unambiguous verdict vocabulary if it turns out cheap —
  otherwise leave, they're not part of the contract table.
- No new external crates (no clap/serde_with); hand-rolled parsing keeps
  benches dependency-free.

## Rollout / rollback

| Phase | What happens | Rollback |
| --- | --- | --- |
| 1. `src/bench_gate.rs` + unit tests | no benches use it yet | delete file |
| 2. four benches wired to `--gate`; `--enforce`→`--check` alias | existing `--enforce` callers still pass (check semantics) | revert CLI mapping |
| 3. gate-spec JSONs + vendored env class | `--gate` green on this machine | revert JSONs; gate stays opt-in |
| 4. Lyne exit folding + matrix guard | old JSON reports keep `pass:true`, stability fields remain | revert cjs changes |
| 5. docs rewrite | live callers copy new commands | git revert of docs commit |

Acceptance criteria cross-check:

- injected over-budget → `--gate --gate-spec over.json` fails exit 1 with
  reason, plus `--gate-self-test` smoke;
- output_path/chain gates evaluate declared deadline/p99.99 (spec metric
  names), not finite-only — verified by the over-budget self-test;
- Lyne exits nonzero when enabled stability/control sub-gate false (fixed cjs)
  and matrix row classified failed;
- report-only (no flag) prints everything, no verdict; exit 0;
- gate schema records mode/cases/metrics/budget/source/profile/env probe and
  unit tests cover passed/failed/unsupported;
- docs and Trellis callers same commands.
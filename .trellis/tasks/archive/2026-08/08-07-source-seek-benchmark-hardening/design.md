# Source-seek benchmark hardening — design (PERF-002)

## 1. Problem

`benches/source_seek_perf.rs` (PERF-002, from `06-performance.md:106-124`):

- No mode vocabulary: every run unconditionally asserts `persistent_p50 <=
  reopen_p50` — a noisy timing comparison produced by **non-interleaved**
  measurement (all persistent seeks first, then all reopen/probe opens).
- No warmup, no p95/max, no absolute service objective, no structured output.
- `benchmark_persistent_source_seeks_for_bench` owns fixture lifecycle
  (temp WAV, pid-suffixed, deleted at end) and measures both paths in one
  function; the bench has no seam to interleave or to record fixture identity.
- No provenance/environment metadata (pre-PERF-005 artifacts).
- Product race fixes (`08-07-streaming-source-seek-activation-race`) are a
  different task; that task's latest-wins serial is *excluded* here.

## 2. Mode vocabulary (reuse bench_gate contract)

Same three modes as the canonical realtime benches (`src/bench_gate.rs`):

| Mode | Flag | Behavior | Exit |
| --- | --- | --- | --- |
| Report | (no flag) | measure, print, fail never (remove unconditional assert) | 0 |
| Check | `--check` (legacy alias `--enforce`) | deterministic guards only: finite/positive metrics + relative regression guard | 0 / 3 |
| Gate | `--gate [--gate-spec path]` | evaluate absolute `budget_ns` from spec against measured p99; env class mismatch → unsupported | 0 / 1 / 2 / 3 |

`--enforce` remains the deprecated alias of `--check` (gate contract); the
PRD's "`--enforce` evaluates absolute and relative criteria" is satisfied by
`--check` (relative) + `--gate` (absolute). Documented in the gate section.

## 3. Bench measurement interface (bench_support split)

`src/player/bench_support.rs` currently exposes one combined function. Replace
it with a bench-session struct so the bench can interleave persistent and
reopen measures on the SAME session (reopen needs `session.identity` for
`expected_identity`; two free functions cannot interleave):

```rust
/// Deterministic local fixture: WAV under repoRoot/.tmp/ (gitignored,
/// still repo-relative for privacy), plus one open persistent session.
pub struct SourceSeekBench {
    fixture: PathBuf,
    session: PersistentStreamingSession,
}

pub fn open_source_seek_bench() -> SourceSeekBench;
pub fn source_seek_bench_fixture_path(bench: &SourceSeekBench) -> &Path; // for hashing

impl SourceSeekBench {
    /// One measured seek (alternating targets 10_000 / 80_000 frames).
    pub fn persistent_seek(&mut self, index: usize) -> u64;
    /// One measured reopen + probe (fresh `SourceSeekRecovery` open).
    pub fn reopen_probe(&mut self) -> u64;
    /// Drop session + remove fixture.
    pub fn finish(self);
}
```

- Existing combined function is removed (only `source_seek_perf.rs` calls it —
  verified by grep; will re-verify).
- Fixture generation stays deterministic (fixed frames, i16 mono, 44.1 kHz,
  132_300 frames) — same bytes every run -> deterministic decoder coverage.
- Fixture location moves from `std::env::temp_dir()` (would leak an absolute
  user path into provenance) to `repoRoot/.tmp/` — already gitignored
  (line 67 of `.gitignore`), and `repo_relative` in `bench_provenance.rs`
  resolves it to a clean relative path.
- Warmup is the bench's job: it calls both methods once with
  `warmup_iterations` first, discards results. Hot filesystem cache for both.

## 4. Bench rewrite (`benches/source_seek_perf.rs`)

```
args: --quick | --heavy | (full)
      --report <path>          (JSON emission, additive)
      --check / --enforce      deterministic guard mode
      --gate [--gate-spec p]

schedule:
  quick: iterations=20, warmup=5
  heavy: iterations=4_000, warmup=100
  full : iterations=200, warmup=20

measure interleaved:
  warmup: persistent(warm) ; reopen(warm)
  for i in 0..iterations:
      persistent_times[i] = one persistent seek       (target alternates)
      reopen_times[i]     = one reopen+probe open
  => equal-count pairs, alternating order → cache/scheduler drift affects
     both sides equally.

summarize: percentile() (existing ceil formula) → p50, p95, p99, max
   persistent / reopen / delta = persistent_p50 - reopen_p50

relative guard (deterministic, runs in Check and Gate):
   persistent_p50 <= reopen_p50 + 2_000_000 ns   (2ms tolerance)
   reason above threshold => IntegrityFailed (exit 3)
   rationale: persistent session advantage is structural; a >2ms inversion
   is not noise, it is staleness or regression.

absolute gate (Gate mode only, via bench_gate::finish):
   metrics = [ persistent_seek_p99_ns, reopen_probe_p99_ns ]
   spec: benches/gate-specs/source_seek_perf.gate.json
   env class must be approved (BENCH_GATE_ENV_CLASS), else unsupported.

JSON report (--report):
{
  "schema_version": 2,
  "benchmark": "source_seek_perf",
  "mode": "quick",
  "warmup_iterations": 20,
  "iterations": 200,
  "summary": { persistent: {count,p50_ns,p95_ns,p99_ns,max_ns},
               reopen: {...}, delta: {p50_ns} },
  "gate": {mode, verdict, reason, exit_code} | null,
  "provenance": { ... }        // PERF-005 block, fixture hashed pre-delete
}
```

Fixture identity: before removal, hash the WAV (sha256) into
`provenance.fixtures` so the deterministic fixture is attributable.

## 5. Gate spec

`benches/gate-specs/source_seek_perf.gate.json`, schema v1:

- `environment.class`: `lyne-dev-bench-gate` (same as the four canonical).
- Metrics (absolute NS budgets, calibrated from real runs in implement step 0):
  - `persistent_seek_p99_ns` — budget from baseline × headroom, host_sensitive.
  - `reopen_probe_p99_ns` — same.
- `budget_provenance` states measurement date/mode/host.
- Integrity checks: `["finite"]` (positive timing only; nominal).
- Over-budget fixture under `benches/gate-specs/over-budget/source_seek_perf.gate.json`
  with tiny budget_ns for `--gate` failure verification.

## 6. Non-goals / boundaries

- `window_seek_perf.rs` still uses legacy `--enforce` (pre-gate contract).
  Out of scope here (different bench), noted as follow-up.
- No change to Lyne/JS pipeline consumers (`pipeline-v2-playback-matrix` reads
  Lyne JSON, not this bench).
- No product seek-race logic; the bench deliberately does not exercise
  latest-wins serialization or stale-epoch reactivation.
- `bench_gate` itself: no new fields needed (reuse `finish` + default spec
  resolution). All gate objectives are absolute ns.

## 7. Tests / verification

- Unit: percentile function correctness (boundary values), relative-guard
  boundary (>2 ms inversion fails; ≤ passes), fixture round-trip,
  interleaving yields equal counts.
- Integration (bench binary): `--check` exit 0 on real run; `--gate` pass on
  approved env class; over-budget spec → failed exit 1 (persistent p99 >
  budget); no env class → unsupported exit 2.
- JSON parse-back: `provenance` block has gitHead + fixture sha; `gate`
  object present; mode line printed.
- `cargo test`, `cargo clippy --benches` clean on new code; grep gates
  (no `assert!(persistent_p50` left in report path).

## 8. Rollback

Each code change is localized; revert `source_seek_perf.rs` +
`bench_support.rs` split restores prior behavior. Gate spec delete restores
no-gate mode (checks succeed because spec absent → unsupported? No:
`--gate` without spec resolves default path; absence of file → misconfigured
exit 2, never passed).
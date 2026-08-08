# Validation evidence — performance artifact provenance (PERF-005)

Task: `08-07-performance-artifact-provenance` · status: implemented

## What was built

| Artifact | Location | Role |
| --- | --- | --- |
| Rust provenance module | `src/bench_provenance.rs` | `collect()` probes git identity (HEAD, dirty-tree fingerprint, branch), build (profile/toolchain/binary SHA-256), host (OS/arch/CPU), fixture hashes; `compare()` implements comparability rules; 9 unit tests |
| Node mirror | `apps/desktop/scripts/provenance-utils.cjs` | `collectProvenance` / `attachReportProvenance` (idempotent) / `compareProvenance`; CRLF-normalized porcelain; repo-relative paths only; CLI seam `--emit-git-fields` for the PowerShell launcher |
| Node tests | `apps/desktop/scripts/provenance-utils.test.cjs` | 8 tests incl. temp-git-repo clean/dirty fingerprints, privacy redaction, binary/fixture drift, idempotent attach, legacy `generated_at` frozen |
| Rust bench JSON | `audio_callback_output_path_perf.rs`, `pcm_window_perf.rs` | additive `provenance` block on `BenchmarkReport` (schema stays 2 / 1) |
| Report writers | 10 scripts | every JSON report emission point calls `attachReportProvenance` (latency/stability benchmarks, real-file/realtime baselines, webaudio, active-playback probe, library scan evidence, real-library, splayer-library, pipeline matrix) |
| Tauri launch-meta | `restart-tauri-cdp.ps1` | merges shared-helper fields via `provenance-utils.cjs --emit-git-fields` (additive: `gitHead` kept, adds `dirty`, `dirtyFingerprint`, `branch`, `provenanceSchemaVersion`) |

## Test suites

| Suite | Result |
| --- | --- |
| `cargo test` (full) | 396 passed / 0 failed (incl. 9 `bench_provenance`) |
| `cargo build --benches` | clean |
| `cargo clippy --benches` | no warnings from new code |
| `cd apps/desktop && npm test` | 520 focused + 6 bundle-policy + 8 provenance-utils + 5 lyne-subgates — all green |
| `npm run typecheck` | clean |
| Bench JSON parse-back | `provenance` block present with correct `gitHead` (= `git rev-parse HEAD`), dirty=true on this dirty working tree |

## Cross-family fingerprint equivalence

Same normalized porcelain, same fingerprint across Rust and Node:

- Rust report (`audio_callback_output_path_perf --report`): `e83672ecf375…` (snapshot at run time)
- Node `collectProvenance`: `e83672ecf375…` identical for the same tree
- Two consecutive runs in the same tree produce the same fingerprint
  (`d042deec7b6e…` before later edits; stable within a tree state)

Key normalization: Windows git emits CRLF; Node strips `\r` so it matches
Rust's `str::lines()`.

## Comparability evidence

| Case | Expected | Result |
| --- | --- | --- |
| Same tree, two runs | comparable | ✔ `comparable: true` |
| Same `gitHead`, different dirty fingerprint | incomparable | `dirty-tree-differs` |
| Different `gitHead` | incomparable | `git-head …` |
| Missing dirty fingerprint | incomparable | `missing-dirty-fingerprint` |
| Different binary sha | incomparable | `binary-sha-differs` |
| Same-named fixture with different hash | incomparable | `fixture-sha-differs` |
| Temp repo clean → dirty | fingerprint changes | verified live |

The dirty fingerprint is a SHA-256 of the sorted normalized porcelain lines —
unit redaction test asserts no absolute path, line content or token leaks into
the serialized block (`sha256_lines_is_deterministic_and_path_free`,
`binary and fixture paths are recorded repo-relative`).
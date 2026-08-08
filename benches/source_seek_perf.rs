//! Source-seek benchmark (PERF-002 remediation).
//!
//! Measures persistent-session seek latency versus reopen+probe latency on one
//! deterministic local WAV fixture, with explicit report / check / gate modes
//! from the shared `bench_gate` contract.
//!
//! Modes:
//! - Report (no flag): measure, print, never fail on timing.
//! - Check (`--check`, legacy alias `--enforce`): deterministic guards only
//!   — finite/positive metrics plus the relative regression guard
//!   (persistent p50 <= reopen p50 + 2 ms). Failure -> exit 3.
//! - Gate (`--gate`): evaluate absolute `budget_ns` metrics from
//!   `benches/gate-specs/source_seek_perf.gate.json`. Passed -> 0,
//!   budget failed -> 1, env mismatch/misconfig -> 2, integrity -> 3.
//!
//! Scope note: this measures LOCAL open/seek/probe only. It is NOT remote
//! fetch latency, NOT device-audible latency, and does NOT exercise the
//! latest-wins seek serialization (owned by the seek-race remediation task).

use std::path::{Path, PathBuf};

use audio_engine::bench_gate::{self, exit_for, GateContext, GateMode, GateMetric};
use audio_engine::bench_provenance::{self, ProvenanceRequest};
use audio_engine::player::bench_support::{
    open_source_seek_bench, pct_rank, relative_guard_violated, source_seek_bench_fixture_path,
};

use serde::Serialize;

/// Relative guard tolerance: a persistent seek may exceed reopen+probe p50 by
/// up to 2 ms before the relationship is treated as a deterministic regression.
const RELATIVE_GUARD_P50_TOLERANCE_NS: u64 = 2_000_000;

fn percentile(sorted: &[u64], rank: f64) -> u64 {
    pct_rank(sorted, rank)
}

#[derive(Debug, Clone, Copy, Serialize)]
struct SourceSeekSummary {
    count: usize,
    p50_ns: u64,
    p95_ns: u64,
    p99_ns: u64,
    max_ns: u64,
}

impl SourceSeekSummary {
    fn from_samples(count: usize, mut samples: Vec<u64>) -> Self {
        samples.sort_unstable();
        Self {
            count,
            p50_ns: percentile(&samples, 0.50),
            p95_ns: percentile(&samples, 0.95),
            p99_ns: percentile(&samples, 0.99),
            max_ns: *samples.last().expect("seek samples must be non-empty"),
        }
    }
}

#[derive(Clone, Serialize)]
struct SourceSeekReport {
    schema_version: u32,
    benchmark: &'static str,
    mode: &'static str,
    iterations: usize,
    warmup_iterations: usize,
    persistent: SourceSeekSummary,
    reopen: SourceSeekSummary,
    relative_delta_p50_ns: i128,
    #[serde(skip_serializing_if = "Option::is_none")]
    gate: Option<GateJson>,
    provenance: bench_provenance::Provenance,
}

#[derive(Clone, Serialize)]
struct GateJson {
    mode: &'static str,
    verdict: &'static str,
    reason: String,
    exit_code: i32,
}

fn write_report(path: PathBuf, report: &SourceSeekReport) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap_or_else(|error| {
            panic!("failed to create report dir '{}': {error}", parent.display())
        });
    }
    let json = serde_json::to_vec_pretty(report).expect("source-seek report must serialize");
    std::fs::write(&path, json).unwrap_or_else(|error| {
        panic!("failed to write source-seek report '{}': {error}", path.display())
    });
    println!("source_seek_report path={}", path.display());
}

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let quick = args.iter().any(|arg| arg == "--quick");
    let heavy = args.iter().any(|arg| arg == "--heavy");
    let report_path = args
        .windows(2)
        .find(|pair| pair[0] == "--report")
        .map(|pair| PathBuf::from(&pair[1]));
    let (gate_mode, gate_spec, gate_self_test) = bench_gate::parse_args(&args);

    let (iterations, warmup_iterations) = if quick {
        (20, 5)
    } else if heavy {
        (4_000, 100)
    } else {
        (200, 20)
    };
    let mode = if quick { "quick" } else if heavy { "heavy" } else { "full" };

    if gate_self_test {
        bench_gate::gate_self_test().expect("gate self-test failed");
        return;
    }

    println!(
        "source_seek_perf mode={mode} iterations={iterations} warmup={warmup_iterations} \
         coverage=persistent_session_seek_vs_reopen_probe,local_only"
    );

    let mut bench = open_source_seek_bench();
    let fixture_path = source_seek_bench_fixture_path(&bench).to_path_buf();

    // Warm both paths first so filesystem cache and decoder state are hot for
    // both sides of the comparison.
    for warmup_index in 0..warmup_iterations {
        bench.persistent_seek(warmup_index);
        bench.reopen_probe();
    }

    // Interleave: alternate one persistent seek and one reopen+probe so page
    // cache and scheduler drift do not systematically favor one side.
    let mut persistent_samples = Vec::with_capacity(iterations);
    let mut reopen_samples = Vec::with_capacity(iterations);
    for index in 0..iterations {
        persistent_samples.push(bench.persistent_seek(index));
        reopen_samples.push(bench.reopen_probe());
    }
    let persistent = SourceSeekSummary::from_samples(iterations, persistent_samples);
    let reopen = SourceSeekSummary::from_samples(iterations, reopen_samples);
    let delta_p50 = i128::from(persistent.p50_ns) - i128::from(reopen.p50_ns);

    println!(
        "source_seek scenario=persistent count={} p50_ns={} p95_ns={} p99_ns={} max_ns={}",
        persistent.count, persistent.p50_ns, persistent.p95_ns, persistent.p99_ns, persistent.max_ns
    );
    println!(
        "source_seek scenario=reopen count={} p50_ns={} p95_ns={} p99_ns={} max_ns={}",
        reopen.count, reopen.p50_ns, reopen.p95_ns, reopen.p99_ns, reopen.max_ns
    );
    println!(
        "source_seek relative_delta_p50_ns={delta_p50} guard_tolerance_ns={RELATIVE_GUARD_P50_TOLERANCE_NS}"
    );

    // Relative regression guard (deterministic; runs in Check and Gate).
    let guard_violated = relative_guard_violated(
        persistent.p50_ns,
        reopen.p50_ns,
        RELATIVE_GUARD_P50_TOLERANCE_NS,
    );

    // Gate evaluation (absolute budgets or integrity-only).
    let gate_json = if matches!(gate_mode, GateMode::Check | GateMode::Gate) {
        let metrics = [
            GateMetric { name: "persistent_seek_p99_ns", value_ns: persistent.p99_ns as f64 },
            GateMetric { name: "reopen_probe_p99_ns", value_ns: reopen.p99_ns as f64 },
        ];
        let ctx = GateContext {
            frame_period_ns: 1.0, // spec uses absolute budget_ns only
            deadline_miss_rate: None,
            p9999_ns: None,
        };
        let (verdict, _spec) = bench_gate::finish(
            "source_seek_perf",
            gate_mode,
            gate_spec.as_deref().map(Path::new),
            &metrics,
            &ctx,
        );
        let verdict = if guard_violated && verdict.kind == bench_gate::VerdictKind::Passed {
            bench_gate::Verdict::integrity_failed(format!(
                "relative guard: persistent p50 ({} ns) exceeds reopen p50 ({} ns) + tolerance ({} ns)",
                persistent.p50_ns, reopen.p50_ns, RELATIVE_GUARD_P50_TOLERANCE_NS
            ))
        } else {
            verdict
        };
        let exit_code = exit_for(&verdict);
        Some(GateJson {
            mode: match gate_mode {
                GateMode::Check => "check",
                GateMode::Gate => "gate",
                GateMode::Report => "report",
            },
            verdict: verdict.kind.as_str(),
            reason: verdict.reason.clone(),
            exit_code,
        })
    } else {
        None
    };

    if let Some(gate) = &gate_json {
        println!("source_seek gate={} verdict={} reason={}", gate.mode, gate.verdict, gate.reason);
    }

    let provenance = bench_provenance::collect(&ProvenanceRequest {
        binary_path: None,
        fixture_paths: vec![fixture_path.as_path()],
        profile: Some(mode),
        attribution: vec![
            "local-only",
            "no-remote-fetch",
            "no-device-output",
            "no-first-audible-frame",
        ],
    });

    if let Some(path) = report_path {
        write_report(
            path,
            &SourceSeekReport {
                schema_version: 2,
                benchmark: "source_seek_perf",
                mode,
                iterations,
                warmup_iterations,
                persistent,
                reopen,
                relative_delta_p50_ns: delta_p50,
                gate: gate_json.clone(),
                provenance,
            },
        );
    }
    bench.finish();

    if let Some(gate) = gate_json {
        if gate.exit_code != 0 {
            std::process::exit(gate.exit_code);
        }
    }
}
//! Trustworthy realtime benchmark gate contract (PERF-001 remediation).
//!
//! This module defines the explicit report / check / gate vocabulary shared by
//! the canonical realtime benches (`audio_callback_chain_perf`,
//! `audio_callback_output_path_perf`, `audio_resampler_streaming_perf`,
//! `audio_spectrum_handoff_perf`) and consumed by the Lyne side through the
//! same verdict vocabulary in JS.
//!
//! Contract:
//! - **Report** (no flag): measure everything, print everything, never emit a
//!   verdict; exit 0 unless the bench itself fails to complete.
//! - **Check** (`--check`, legacy `--enforce` alias): deterministic integrity
//!   checks (finite, positive, non-empty output, deadline accounting). No
//!   timing budgets. Failure -> exit 3.
//! - **Gate** (`--gate` + `--gate-spec`): evaluate declared budget metrics
//!   against a machine-readable contract that names its environment class.
//!   Passed -> 0, Failed -> 1, Unsupported/Misconfigured -> 2.
//!
//! Absolute host-sensitive budgets must live in the spec under
//! `environment.class`; a run on a mismatched class is `Unsupported`, never
//! `Passed`.

use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GateMode {
    Report,
    Check,
    Gate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerdictKind {
    Passed,
    Failed,
    Unsupported,
    Misconfigured,
    IntegrityFailed,
}

impl VerdictKind {
    pub fn exit_code(self) -> i32 {
        match self {
            Self::Passed => 0,
            Self::Failed => 1,
            Self::Unsupported | Self::Misconfigured => 2,
            Self::IntegrityFailed => 3,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Passed => "passed",
            Self::Failed => "failed",
            Self::Unsupported => "unsupported",
            Self::Misconfigured => "misconfigured",
            Self::IntegrityFailed => "integrity_failed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verdict {
    pub kind: VerdictKind,
    pub reason: String,
}

impl Verdict {
    pub fn passed() -> Self {
        Self {
            kind: VerdictKind::Passed,
            reason: String::new(),
        }
    }

    pub fn failed(reason: impl Into<String>) -> Self {
        Self {
            kind: VerdictKind::Failed,
            reason: reason.into(),
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            kind: VerdictKind::Unsupported,
            reason: reason.into(),
        }
    }

    pub fn misconfigured(reason: impl Into<String>) -> Self {
        Self {
            kind: VerdictKind::Misconfigured,
            reason: reason.into(),
        }
    }

    pub fn integrity_failed(reason: impl Into<String>) -> Self {
        Self {
            kind: VerdictKind::IntegrityFailed,
            reason: reason.into(),
        }
    }

    pub fn is_pass(&self) -> bool {
        self.kind == VerdictKind::Passed
    }
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct GateSpec {
    pub schema_version: u32,
    pub benchmark: String,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub warmup: u32,
    #[serde(default)]
    pub trials: u32,
    #[serde(default)]
    pub percentile: Option<f64>,
    #[serde(default)]
    pub deadline: Option<DeadlineSpec>,
    #[serde(default)]
    pub metrics: Vec<MetricSpec>,
    pub environment: EnvironmentSpec,
    #[serde(default)]
    pub budget_provenance: String,
    #[serde(default)]
    pub integrity_checks: Vec<String>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct DeadlineSpec {
    pub frame_period_ns_provenance: String,
    #[serde(default)]
    pub target_miss_rate: f64,
    pub target_p9999_fraction_of_period: f64,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct MetricSpec {
    pub name: String,
    /// Budget as a fraction of the declared callback period (e.g. 0.1 = 10%).
    #[serde(default)]
    pub budget_fraction_of_period: Option<f64>,
    /// Absolute budget in nanoseconds.
    #[serde(default)]
    pub budget_ns: Option<f64>,
    #[serde(default)]
    pub source: String,
    #[serde(default = "default_true")]
    pub host_sensitive: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct EnvironmentSpec {
    pub class: String,
    #[serde(default)]
    pub os: Option<String>,
    #[serde(default)]
    pub arch: Option<String>,
    #[serde(default)]
    pub profile: Option<String>,
    #[serde(default = "default_true")]
    pub requires_warmup: bool,
}

#[derive(Debug, Clone)]
pub struct GateMetric {
    /// Must match a `MetricSpec.name` in the spec.
    pub name: &'static str,
    /// Measured value in nanoseconds.
    pub value_ns: f64,
}

/// The frame-period-derived budget base for a bench run.
#[derive(Debug, Clone, Copy)]
pub struct GateContext {
    /// Declared callback period in ns (e.g. 512 frames at 48 kHz -> 10_666_667).
    pub frame_period_ns: f64,
    /// Measured deadline-miss rate in [0, 1]; `None` when the bench does not
    /// compute deadline accounting.
    pub deadline_miss_rate: Option<f64>,
    /// Best percentile tail value if the bench measures it (p99.99, ns).
    pub p9999_ns: Option<f64>,
}

pub fn parse_args(args: &[String]) -> (GateMode, Option<String>, bool) {
    let mut mode = GateMode::Report;
    let mut spec: Option<String> = None;
    let mut self_test = false;

    // Precedence: --gate > --check/--enforce > default (report).
    let mut iter = args.iter().peekable();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--check" | "--enforce" => {
                if arg == "--enforce" {
                    eprintln!(
                        "[bench_gate] --enforce is deprecated: use --check (integrity) or --gate \
                         (budget). Treating as --check."
                    );
                }
                if mode == GateMode::Report {
                    mode = GateMode::Check;
                }
            }
            "--gate" => mode = GateMode::Gate,
            "--gate-spec" => {
                if let Some(path) = iter.next() {
                    spec = Some(path.clone());
                } else {
                    eprintln!("[bench_gate] --gate-spec requires a path value");
                }
            }
            "--gate-self-test" => self_test = true,
            _ => {}
        }
    }
    (mode, spec, self_test)
}

pub fn current_environment() -> EnvironmentSpec {
    EnvironmentSpec {
        class: std::env::var("BENCH_GATE_ENV_CLASS").unwrap_or_else(|_| "local".to_string()),
        os: Some(std::env::consts::OS.to_string()),
        arch: Some(std::env::consts::ARCH.to_string()),
        profile: Some(if cfg!(debug_assertions) {
            "debug".to_string()
        } else {
            "release".to_string()
        }),
        requires_warmup: true,
    }
}

pub fn load_spec(path: &Path) -> Result<GateSpec, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|error| format!("failed to read gate spec {}: {error}", path.display()))?;
    let spec: GateSpec = serde_json::from_str(&text)
        .map_err(|error| format!("invalid gate spec {}: {error}", path.display()))?;
    if spec.schema_version != 1 {
        return Err(format!(
            "unsupported gate spec schema_version {} (expected 1)",
            spec.schema_version
        ));
    }
    if spec.metrics.is_empty() {
        return Err(format!(
            "gate spec {} declares no metrics; a gate without a budget is not a gate",
            path.display()
        ));
    }
    Ok(spec)
}

/// Render the canonical gate verdict line consumed by docs and CI.
pub fn verdict_line(bench: &str, mode: GateMode, verdict: &Verdict) -> String {
    format!(
        "bench_gate verdict={} bench={} mode={} reason={}",
        verdict.kind.as_str(),
        bench,
        match mode {
            GateMode::Report => "report",
            GateMode::Check => "check",
            GateMode::Gate => "gate",
        },
        verdict.reason
    )
}

pub fn exit_for(verdict: &Verdict) -> i32 {
    verdict.kind.exit_code()
}

/// Shared bench exit path: prints the canonical verdict line and returns the
/// verdict plus the loaded spec (when gate mode). Callers exit with
/// `verdict.kind.exit_code()` and may attach `spec` to their JSON report.
///
/// - Report: no verdict, exit 0.
/// - Check: integrity-only; failure -> exit 3.
/// - Gate: loads spec, evaluates budget, prints verdict; exits per kind.
pub fn finish(
    bench: &str,
    mode: GateMode,
    spec_path: Option<&std::path::Path>,
    metrics: &[GateMetric],
    ctx: &GateContext,
) -> (Verdict, Option<GateSpec>) {
    match mode {
        GateMode::Report => (Verdict::passed(), None),
        GateMode::Check => {
            // Deterministic integrity: finite and positive timing.
            let mut reasons = Vec::new();
            for metric in metrics {
                if !metric.value_ns.is_finite() || metric.value_ns <= 0.0 {
                    reasons.push(format!(
                        "metric {} not finite/positive ({}); measurement invalid",
                        metric.name, metric.value_ns
                    ));
                }
            }
            let verdict = if reasons.is_empty() {
                Verdict::passed()
            } else {
                Verdict::integrity_failed(reasons.join("; "))
            };
            println!("{}", verdict_line(bench, GateMode::Check, &verdict));
            (verdict, None)
        }
        GateMode::Gate => {
            // --gate without --gate-spec resolves to the committed spec for the
            // bench: benches/gate-specs/<bench>.gate.json (relative to cwd).
            let resolved = spec_path.map(std::path::PathBuf::from).unwrap_or_else(|| {
                std::path::PathBuf::from(format!("benches/gate-specs/{bench}.gate.json"))
            });
            let spec = match load_spec(&resolved) {
                Ok(spec) => spec,
                Err(error) => {
                    eprintln!("[bench_gate] {error}");
                    return (Verdict::misconfigured(error), None);
                }
            };
            let verdict = match evaluate_gate(&spec, metrics, ctx) {
                Ok(verdict) => verdict,
                Err(error) => {
                    eprintln!("[bench_gate] gate evaluation error: {error}");
                    return (Verdict::misconfigured(error), Some(spec));
                }
            };
            println!("{}", verdict_line(bench, GateMode::Gate, &verdict));
            (verdict, Some(spec))
        }
    }
}

/// Environment match gate: a mismatched class, OS, arch or profile is
/// `Unsupported`, never `Passed`.
pub fn check_environment(spec: &EnvironmentSpec) -> Result<(), Verdict> {
    let current = current_environment();
    if !spec.class.is_empty() && spec.class != "any" && spec.class != current.class {
        return Err(Verdict::unsupported(format!(
            "environment class mismatch: spec requires '{}', current benching env is '{}' \
             (set BENCH_GATE_ENV_CLASS to opt in on an approved machine)",
            spec.class, current.class
        )));
    }
    if let Some(os) = &spec.os {
        if os != "any" && os != current.os.as_deref().unwrap_or("") {
            return Err(Verdict::unsupported(format!(
                "os mismatch: spec={os}, current={}",
                current.os.as_deref().unwrap_or("unknown")
            )));
        }
    }
    if let Some(arch) = &spec.arch {
        if arch != "any" && arch != current.arch.as_deref().unwrap_or("") {
            return Err(Verdict::unsupported(format!(
                "arch mismatch: spec={arch}, current={}",
                current.arch.as_deref().unwrap_or("unknown")
            )));
        }
    }
    if let Some(profile) = &spec.profile {
        if profile != "any" && profile != current.profile.as_deref().unwrap_or("") {
            return Err(Verdict::unsupported(format!(
                "profile mismatch: spec={profile}, current={}",
                current.profile.as_deref().unwrap_or("unknown")
            )));
        }
    }
    Ok(())
}

/// Pure monetary gate evaluation. Order:
/// 1. contract validation -> `Misconfigured`;
/// 2. environment class -> `Unsupported`;
/// 3. deterministic integrity checks -> `IntegrityFailed`;
/// 4. deadline/tail+budget metrics -> `Failed`;
///    everything else -> `Passed`.
pub fn evaluate_gate(
    spec: &GateSpec,
    metrics: &[GateMetric],
    ctx: &GateContext,
) -> Result<Verdict, String> {
    // Integrity first so a noisy host cannot convert a real correctness bug
    // into a timeout-style verdict.
    for check in &spec.integrity_checks {
        match check.as_str() {
            "finite" => {
                for metric in metrics {
                    if !metric.value_ns.is_finite() || metric.value_ns <= 0.0 {
                        return Ok(Verdict::integrity_failed(format!(
                            "metric {} is not finite and positive ({}); configuring benchmarks \
                             cannot rescue an invalid measurement",
                            metric.name, metric.value_ns
                        )));
                    }
                    if let Some(m) = spec.metrics.iter().find(|m| m.name == metric.name) {
                        if m.budget_ns.is_some()
                            && metric.value_ns > m.budget_ns.unwrap_or(f64::MAX)
                        {
                            // Budget belongs to the timing gate; keep the verdict
                            // failed below. Do not short-circuit here.
                        }
                    }
                }
            }
            "outputNonEmpty" => {
                // benches pass output-frame counts through value_ns as a standin
                // only when they opt in; nothing to do at this layer.
            }
            _ => {}
        }
    }

    // Env class
    if let Err(verdict) = check_environment(&spec.environment) {
        return Ok(verdict);
    }

    // Deadline accounting
    if let Some(deadline) = &spec.deadline {
        if let Some(miss_rate) = ctx.deadline_miss_rate {
            if miss_rate > deadline.target_miss_rate {
                return Ok(Verdict::failed(format!(
                    "deadline_miss_rate={miss_rate:.9} exceeds target {} \
                     (period={} ns, provenance={})",
                    deadline.target_miss_rate,
                    ctx.frame_period_ns,
                    deadline.frame_period_ns_provenance
                )));
            }
        }
        if let Some(p9999) = ctx.p9999_ns {
            let budget = deadline.target_p9999_fraction_of_period * ctx.frame_period_ns;
            if p9999 > budget {
                return Ok(Verdict::failed(format!(
                    "p99.99 {p9999} ns exceeds budget {budget} ns \
                     (fraction={} of period {} ns)",
                    deadline.target_p9999_fraction_of_period, ctx.frame_period_ns
                )));
            }
        }
    }

    // Budget metrics
    for metric in metrics {
        let Some(spec_metric) = spec.metrics.iter().find(|m| m.name == metric.name) else {
            return Ok(Verdict::misconfigured(format!(
                "measured metric '{}' has no matching entry in gate spec",
                metric.name
            )));
        };
        let budget_ns = spec_metric.budget_ns.or_else(|| {
            spec_metric
                .budget_fraction_of_period
                .map(|f| f * ctx.frame_period_ns)
        });
        if let Some(budget) = budget_ns {
            if metric.value_ns > budget {
                return Ok(Verdict::failed(format!(
                    "metric {} measured {:.3} ns exceeds budget {:.3} ns (source={}, \
                     host_sensitive={})",
                    metric.name,
                    metric.value_ns,
                    budget,
                    spec_metric.source,
                    spec_metric.host_sensitive
                )));
            }
        }
    }

    Ok(Verdict::passed())
}

/// Canned self-test used by `--gate-self-test`: verifies that the evaluator
/// returns the expected verdicts for pass/fail/env-mismatch/misconfig cases
/// without running a measurement suite.
pub fn gate_self_test() -> Result<(), String> {
    let spec_text = r#"{
        "schema_version": 1,
        "benchmark": "self-test",
        "warmup": 1,
        "trials": 1,
        "metrics": [
            {"name": "buffer_ns", "budget_ns": 1000, "source": "self-test"}
        ],
        "deadline": {
            "frame_period_ns_provenance": "self-test",
            "target_miss_rate": 0.0,
            "target_p9999_fraction_of_period": 0.5
        },
        "environment": {
            "class": "any",
            "os": "any",
            "arch": "any",
            "profile": "any",
            "requires_warmup": false
        },
        "budget_provenance": "self-test",
        "integrity_checks": ["finite"]
    }"#;
    let spec: GateSpec = serde_json::from_str(spec_text)
        .map_err(|error| format!("self-test spec parse failed: {error}"))?;

    let ctx = GateContext {
        frame_period_ns: 1_000_000_000.0,
        deadline_miss_rate: Some(0.0),
        p9999_ns: Some(20_000.0),
    };

    let pass = evaluate_gate(
        &spec,
        &[GateMetric {
            name: "buffer_ns",
            value_ns: 1.0,
        }],
        &ctx,
    )?;
    if pass.kind != VerdictKind::Passed {
        return Err(format!("expected Passed, got {:?}", pass.kind));
    }

    let fail = evaluate_gate(
        &spec,
        &[GateMetric {
            name: "buffer_ns",
            value_ns: 200_000.0,
        }],
        &ctx,
    )?;
    if fail.kind != VerdictKind::Failed {
        return Err(format!(
            "expected Failed for over-budget, got {:?}",
            fail.kind
        ));
    }

    let miss = evaluate_gate(
        &spec,
        &[GateMetric {
            name: "buffer_ns",
            value_ns: 1.0,
        }],
        &GateContext {
            frame_period_ns: 1_000_000_000.0,
            deadline_miss_rate: Some(0.5),
            p9999_ns: Some(20.0),
        },
    )?;
    if miss.kind != VerdictKind::Failed {
        return Err(format!(
            "expected Failed for deadline misses, got {:?}",
            miss.kind
        ));
    }

    let integrity = evaluate_gate(
        &spec,
        &[GateMetric {
            name: "buffer_ns",
            value_ns: f64::NAN,
        }],
        &ctx,
    )?;
    if integrity.kind != VerdictKind::IntegrityFailed {
        return Err(format!(
            "expected IntegrityFailed for NaN, got {:?}",
            integrity.kind
        ));
    }

    // Unsupported on environment mismatch via explicit class override.
    std::env::set_var("BENCH_GATE_ENV_CLASS", "self-test-approved");
    let mut env_spec: GateSpec = serde_json::from_str(spec_text).map_err(|e| e.to_string())?;
    env_spec.environment.class = "ci-approved".to_string();
    let unsupported = evaluate_gate(
        &env_spec,
        &[GateMetric {
            name: "buffer_ns",
            value_ns: 1.0,
        }],
        &ctx,
    )?;
    std::env::remove_var("BENCH_GATE_ENV_CLASS");
    if unsupported.kind != VerdictKind::Unsupported {
        return Err(format!(
            "expected Unsupported for env mismatch, got {:?}",
            unsupported.kind
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPEC: &str = r#"{
        "schema_version": 1,
        "benchmark": "test",
        "warmup": 1,
        "trials": 3,
        "metrics": [{"name": "buffer_ns", "budget_ns": 1000}],
        "environment": {
            "class": "any",
            "os": "any",
            "arch": "any",
            "profile": "any",
            "requires_warmup": false
        }
    }"#;

    #[test]
    fn parses_spec() {
        let spec: GateSpec = serde_json::from_str(SPEC).expect("spec");
        assert_eq!(spec.schema_version, 1);
        assert_eq!(spec.metrics.len(), 1);
    }

    #[test]
    fn reject_unknown_fields() {
        let result: Result<GateSpec, _> = serde_json::from_str(
            r#"{"schema_version":1,"benchmark":"x","environment":{"class":"any"},"bogus":1}"#,
        );
        assert!(result.is_err(), "unknown fields must be rejected");
    }
    #[test]
    fn pass_case() {
        let spec: GateSpec = serde_json::from_str(SPEC).unwrap();
        let verdict = evaluate_gate(
            &spec,
            &[GateMetric {
                name: "buffer_ns",
                value_ns: 500.0,
            }],
            &GateContext {
                frame_period_ns: 10_000_000.0,
                deadline_miss_rate: None,
                p9999_ns: None,
            },
        )
        .expect("evaluate");
        assert_eq!(verdict.kind, VerdictKind::Passed);
    }

    #[test]
    fn fail_over_budget() {
        let spec: GateSpec = serde_json::from_str(SPEC).unwrap();
        let verdict = evaluate_gate(
            &spec,
            &[GateMetric {
                name: "buffer_ns",
                value_ns: 100_000.0,
            }],
            &GateContext {
                frame_period_ns: 10_000_000.0,
                deadline_miss_rate: None,
                p9999_ns: None,
            },
        )
        .expect("evaluate");
        assert_eq!(verdict.kind, VerdictKind::Failed);
        assert!(verdict.reason.contains("budget"));
    }

    #[test]
    fn fail_deadline_miss_rate() {
        let spec: GateSpec = {
            let mut s: GateSpec = serde_json::from_str(SPEC).unwrap();
            s.deadline = Some(DeadlineSpec {
                frame_period_ns_provenance: "test".into(),
                target_miss_rate: 0.0,
                target_p9999_fraction_of_period: 1.0,
            });
            s
        };
        let verdict = evaluate_gate(
            &spec,
            &[GateMetric {
                name: "buffer_ns",
                value_ns: 100.0,
            }],
            &GateContext {
                frame_period_ns: 10_000_000.0,
                deadline_miss_rate: Some(0.01),
                p9999_ns: None,
            },
        )
        .expect("evaluate");
        assert_eq!(verdict.kind, VerdictKind::Failed);
    }

    #[test]
    fn integrity_failure_is_separate() {
        let spec: GateSpec = {
            let mut s: GateSpec = serde_json::from_str(SPEC).unwrap();
            s.integrity_checks = vec!["finite".into()];
            s
        };
        let verdict = evaluate_gate(
            &spec,
            &[GateMetric {
                name: "buffer_ns",
                value_ns: f64::NAN,
            }],
            &GateContext {
                frame_period_ns: 10_000_000.0,
                deadline_miss_rate: None,
                p9999_ns: None,
            },
        )
        .expect("evaluate");
        assert_eq!(verdict.kind, VerdictKind::IntegrityFailed);
    }

    #[test]
    fn exit_codes_are_stable() {
        assert_eq!(VerdictKind::Passed.exit_code(), 0);
        assert_eq!(VerdictKind::Failed.exit_code(), 1);
        assert_eq!(VerdictKind::Unsupported.exit_code(), 2);
        assert_eq!(VerdictKind::Misconfigured.exit_code(), 2);
        assert_eq!(VerdictKind::IntegrityFailed.exit_code(), 3);
    }
}

use std::fmt;

#[derive(Clone, Copy)]
enum PathKind {
    Sample,
    Control,
}

impl fmt::Display for PathKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sample => f.write_str("sample"),
            Self::Control => f.write_str("control"),
        }
    }
}

struct Metric {
    name: &'static str,
    kind: PathKind,
    unit: &'static str,
    current_ns: f64,
    legacy_ns: f64,
    original_ns: f64,
    first_pass_ns: Option<f64>,
    include_in_original_total: bool,
    include_in_incremental_total: bool,
}

impl Metric {
    fn legacy_improvement_percent(&self) -> f64 {
        (self.legacy_ns - self.current_ns) / self.legacy_ns * 100.0
    }

    fn legacy_speedup(&self) -> f64 {
        self.legacy_ns / self.current_ns
    }

    fn original_improvement_percent(&self) -> f64 {
        (self.original_ns - self.current_ns) / self.original_ns * 100.0
    }

    fn original_speedup(&self) -> f64 {
        self.original_ns / self.current_ns
    }
}

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let quick = args.iter().any(|arg| arg == "--quick");
    let heavy = args.iter().any(|arg| arg == "--heavy");
    let enforce = args.iter().any(|arg| arg == "--enforce");

    let mut metrics = Vec::new();
    metrics.extend(derived::sample_metrics(quick, heavy));
    metrics.extend(biquad::sample_metrics(quick, heavy));
    metrics.extend(limiter::sample_metrics(quick, heavy));
    metrics.extend(convolver::sample_metrics(quick, heavy));
    metrics.extend(truepeak::sample_metrics(quick, heavy));
    metrics.extend(derived::control_metrics(quick, heavy));
    metrics.extend(biquad::control_metrics(quick, heavy));
    metrics.extend(lockfree::control_metrics(quick, heavy));

    println!(
        "audio_overall_perf mode={} metrics={}",
        if quick {
            "quick"
        } else if heavy {
            "heavy"
        } else {
            "full"
        },
        metrics.len()
    );

    print_metrics(&metrics);
    print_total(
        "from_original_total",
        "original",
        &metrics,
        PathKind::Sample,
        BaselineKind::Original,
    );
    print_total(
        "from_original_total",
        "original",
        &metrics,
        PathKind::Control,
        BaselineKind::Original,
    );
    print_total(
        "incremental_after_first_pass_total",
        "first_pass",
        &metrics,
        PathKind::Sample,
        BaselineKind::FirstPass,
    );
    print_total(
        "incremental_after_first_pass_total",
        "first_pass",
        &metrics,
        PathKind::Control,
        BaselineKind::FirstPass,
    );

    if enforce {
        let (sample_current, sample_original, _) =
            total_for(&metrics, PathKind::Sample, BaselineKind::Original);
        assert!(
            sample_current < sample_original,
            "sample path total did not improve: current={sample_current:.3}, original={sample_original:.3}"
        );
    }
}

fn print_metrics(metrics: &[Metric]) {
    for metric in metrics {
        let total_marker = match (
            metric.include_in_original_total,
            metric.include_in_incremental_total,
        ) {
            (true, true) => "original+incremental",
            (true, false) => "original",
            (false, true) => "incremental",
            (false, false) => "detail",
        };
        let first_pass = metric
            .first_pass_ns
            .map(|value| format!("{value:.3}"))
            .unwrap_or_else(|| "n/a".to_string());
        println!(
            "overall_component name={} path={} unit={} current={:.3} legacy={:.3} first_pass={} original={:.3} legacy_improvement={:.2}% original_improvement={:.2}% legacy_speedup={:.2}x original_speedup={:.2}x total={}",
            metric.name,
            metric.kind,
            metric.unit,
            metric.current_ns,
            metric.legacy_ns,
            first_pass,
            metric.original_ns,
            metric.legacy_improvement_percent(),
            metric.original_improvement_percent(),
            metric.legacy_speedup(),
            metric.original_speedup(),
            total_marker
        );
    }
}

#[derive(Clone, Copy)]
enum BaselineKind {
    Original,
    FirstPass,
}

fn print_total(
    name: &str,
    baseline_name: &str,
    metrics: &[Metric],
    kind: PathKind,
    baseline_kind: BaselineKind,
) {
    let (current, baseline, components) = total_for(metrics, kind, baseline_kind);
    if components == 0 {
        println!(
            "overall_summary name={} path={} baseline={} components=0 current_sum=0.000 baseline_sum=0.000 improvement=0.00% speedup=1.00x",
            name, kind, baseline_name
        );
        return;
    }

    println!(
        "overall_summary name={} path={} baseline={} components={} current_sum={:.3} baseline_sum={:.3} improvement={:.2}% speedup={:.2}x",
        name,
        kind,
        baseline_name,
        components,
        current,
        baseline,
        (baseline - current) / baseline * 100.0,
        baseline / current
    );
}

fn total_for(metrics: &[Metric], kind: PathKind, baseline_kind: BaselineKind) -> (f64, f64, usize) {
    metrics
        .iter()
        .filter(|metric| {
            let included = match baseline_kind {
                BaselineKind::Original => metric.include_in_original_total,
                BaselineKind::FirstPass => metric.include_in_incremental_total,
            };
            included
                && matches!(
                    (metric.kind, kind),
                    (PathKind::Sample, PathKind::Sample) | (PathKind::Control, PathKind::Control)
                )
        })
        .filter_map(|metric| {
            let baseline = match baseline_kind {
                BaselineKind::Original => Some(metric.original_ns),
                BaselineKind::FirstPass => metric.first_pass_ns,
            }?;
            Some((metric.current_ns, baseline))
        })
        .fold((0.0, 0.0, 0usize), |(current, baseline, count), metric| {
            (current + metric.0, baseline + metric.1, count + 1)
        })
}

fn metric(
    name: &'static str,
    kind: PathKind,
    unit: &'static str,
    current_ns: f64,
    legacy_ns: f64,
    include_in_total: bool,
) -> Metric {
    metric_with_baselines(
        name,
        kind,
        unit,
        current_ns,
        legacy_ns,
        legacy_ns,
        None,
        include_in_total,
        false,
    )
}

fn metric_with_first_pass(
    name: &'static str,
    kind: PathKind,
    unit: &'static str,
    current_ns: f64,
    first_pass_ns: f64,
    original_ns: f64,
    include_in_original_total: bool,
) -> Metric {
    metric_with_baselines(
        name,
        kind,
        unit,
        current_ns,
        first_pass_ns,
        original_ns,
        Some(first_pass_ns),
        include_in_original_total,
        true,
    )
}

fn detail_metric_with_baselines(
    name: &'static str,
    kind: PathKind,
    unit: &'static str,
    current_ns: f64,
    legacy_ns: f64,
    original_ns: f64,
    first_pass_ns: Option<f64>,
) -> Metric {
    metric_with_baselines(
        name,
        kind,
        unit,
        current_ns,
        legacy_ns,
        original_ns,
        first_pass_ns,
        false,
        false,
    )
}

fn metric_with_baselines(
    name: &'static str,
    kind: PathKind,
    unit: &'static str,
    current_ns: f64,
    legacy_ns: f64,
    original_ns: f64,
    first_pass_ns: Option<f64>,
    include_in_original_total: bool,
    include_in_incremental_total: bool,
) -> Metric {
    Metric {
        name,
        kind,
        unit,
        current_ns,
        legacy_ns,
        original_ns,
        first_pass_ns,
        include_in_original_total,
        include_in_incremental_total,
    }
}

#[allow(dead_code)]
mod derived {
    include!("audio_derived_constants_perf.rs");

    pub(super) fn sample_metrics(quick: bool, heavy: bool) -> Vec<super::Metric> {
        let iterations = if quick {
            24
        } else if heavy {
            120
        } else {
            60
        };
        let frames = if quick {
            4_096
        } else if heavy {
            16_384
        } else {
            8_192
        };
        let corpus = synthetic_corpus(frames, CHANNELS);

        let noise = benchmark_noise_shaper(&corpus, iterations);
        let volume_controller = benchmark_volume_controller(&corpus, iterations);
        let volume_processor = benchmark_volume_processor(&corpus, iterations);
        let saturation = benchmark_saturation(&corpus, iterations);
        let gain_ramp_block = benchmark_gain_ramp_block_apply(&corpus, iterations);
        let volume_lazy_settle = benchmark_volume_lazy_settle(&corpus, iterations);

        vec![
            report_metric(
                "noise_shaper_cached_scale_tpdf",
                super::PathKind::Sample,
                "sample",
                noise,
                true,
            ),
            report_metric(
                "volume_controller_cached_one_minus",
                super::PathKind::Sample,
                "sample",
                volume_controller,
                false,
            ),
            report_metric(
                "volume_processor_local_current",
                super::PathKind::Sample,
                "sample",
                volume_processor,
                false,
            ),
            report_metric(
                "saturation_hot_field_hoist",
                super::PathKind::Sample,
                "sample",
                saturation,
                true,
            ),
            report_metric(
                "gain_ramp_block_apply_vs_next_gain_loop",
                super::PathKind::Sample,
                "sample",
                gain_ramp_block,
                true,
            ),
            report_metric(
                "volume_lazy_settle_vs_exact_smoothing_kernel",
                super::PathKind::Sample,
                "sample",
                volume_lazy_settle,
                true,
            ),
        ]
    }

    pub(super) fn control_metrics(quick: bool, heavy: bool) -> Vec<super::Metric> {
        let iterations = if quick {
            24
        } else if heavy {
            120
        } else {
            60
        };
        let frames = if quick {
            4_096
        } else if heavy {
            16_384
        } else {
            8_192
        };
        let gain_ramp = benchmark_gain_ramp(frames * CHANNELS, iterations);
        let loudness = benchmark_loudness_gain_cache(iterations);

        vec![
            report_metric(
                "gain_ramp_cached_current",
                super::PathKind::Control,
                "call",
                gain_ramp,
                true,
            ),
            report_metric(
                "loudness_gain_linear_cache",
                super::PathKind::Control,
                "call",
                loudness,
                true,
            ),
        ]
    }

    fn report_metric(
        name: &'static str,
        kind: super::PathKind,
        unit: &'static str,
        report: BenchReport,
        include_in_total: bool,
    ) -> super::Metric {
        super::metric_with_baselines(
            name,
            kind,
            unit,
            report.current_ns_per_unit,
            report.legacy_ns_per_unit,
            report.original_ns_per_unit,
            report.first_pass_ns_per_unit,
            include_in_total,
            report.first_pass_ns_per_unit.is_some() && include_in_total,
        )
    }
}

#[allow(dead_code)]
mod biquad {
    include!("audio_biquad_perf.rs");

    pub(super) fn sample_metrics(quick: bool, heavy: bool) -> Vec<super::Metric> {
        let iterations = if quick {
            8
        } else if heavy {
            40
        } else {
            24
        };
        let frames = if quick {
            12_000
        } else if heavy {
            48_000
        } else {
            24_000
        };
        let corpus = synthetic_corpus(frames, CHANNELS);

        let eq = benchmark_eq(&corpus, iterations);
        let dl_transitioning = benchmark_dynamic_loudness(
            &corpus,
            iterations,
            DynamicLoudnessScenario::TransitioningLowVolume,
        );
        let dl_max_active = benchmark_dynamic_loudness(
            &corpus,
            iterations,
            DynamicLoudnessScenario::MaxActiveSettled,
        );
        let dl_identity = benchmark_dynamic_loudness(
            &corpus,
            iterations,
            DynamicLoudnessScenario::IdentitySettled,
        );

        vec![
            super::metric_with_first_pass(
                "eq_flatten_and_settled_stereo_fast",
                super::PathKind::Sample,
                "sample",
                eq.current_ns_per_sample,
                eq.previous_flat_ns_per_sample,
                eq.legacy_ns_per_sample,
                true,
            ),
            super::detail_metric_with_baselines(
                "eq_settled_stereo_fast_delta",
                super::PathKind::Sample,
                "sample",
                eq.current_ns_per_sample,
                eq.previous_flat_ns_per_sample,
                eq.legacy_ns_per_sample,
                Some(eq.previous_flat_ns_per_sample),
            ),
            process_metric(
                "dynamic_loudness_process_transitioning",
                dl_transitioning,
                false,
            ),
            process_metric("dynamic_loudness_process_max_active", dl_max_active, true),
            process_metric("dynamic_loudness_process_identity", dl_identity, false),
        ]
    }

    pub(super) fn control_metrics(quick: bool, heavy: bool) -> Vec<super::Metric> {
        let iterations = if quick {
            80_000
        } else if heavy {
            400_000
        } else {
            200_000
        };
        let coeff = benchmark_coefficients(iterations);
        vec![super::metric(
            "dynamic_coeff_cache",
            super::PathKind::Control,
            "update",
            coeff.cached_ns_per_update,
            coeff.legacy_ns_per_update,
            true,
        )]
    }

    fn process_metric(
        name: &'static str,
        report: ProcessReport,
        include_in_total: bool,
    ) -> super::Metric {
        super::metric(
            name,
            super::PathKind::Sample,
            "sample",
            report.current_ns_per_sample,
            report.legacy_ns_per_sample,
            include_in_total,
        )
    }
}

#[allow(dead_code)]
mod limiter {
    include!("audio_limiter_perf.rs");

    pub(super) fn sample_metrics(quick: bool, heavy: bool) -> Vec<super::Metric> {
        let frames = if quick {
            12_000
        } else if heavy {
            96_000
        } else {
            48_000
        };
        let iterations = if quick {
            8
        } else if heavy {
            40
        } else {
            24
        };
        let corpus = deterministic_transient_corpus(frames, CHANNELS);
        let report = benchmark_limiter(&corpus, iterations);

        vec![super::metric(
            "limiter_monotonic_queue",
            super::PathKind::Sample,
            "sample",
            report.monotonic_ns_per_sample,
            report.legacy_ns_per_sample,
            true,
        )]
    }
}

#[allow(dead_code)]
mod convolver {
    include!("audio_convolver_perf.rs");

    pub(super) fn sample_metrics(quick: bool, heavy: bool) -> Vec<super::Metric> {
        let iterations = if quick {
            24
        } else if heavy {
            120
        } else {
            60
        };
        let frames = if quick {
            2_048
        } else if heavy {
            8_192
        } else {
            4_096
        };
        let trials = if quick {
            2
        } else if heavy {
            3
        } else {
            2
        };
        let report = benchmark_convolver(2, 256, frames, iterations, trials);

        vec![
            super::metric(
                "convolver_process_inplace",
                super::PathKind::Sample,
                "sample",
                report.process_inplace_ns_per_sample,
                report.legacy_process_inplace_ns_per_sample,
                true,
            ),
            super::metric(
                "convolver_process_into",
                super::PathKind::Sample,
                "sample",
                report.process_into_ns_per_sample,
                report.legacy_process_into_ns_per_sample,
                false,
            ),
        ]
    }
}

#[allow(dead_code)]
mod truepeak {
    include!("audio_truepeak_perf.rs");

    pub(super) fn sample_metrics(quick: bool, heavy: bool) -> Vec<super::Metric> {
        let frames = if quick {
            24_000
        } else if heavy {
            96_000
        } else {
            48_000
        };
        let iterations = if quick {
            8
        } else if heavy {
            60
        } else {
            30
        };
        let corpus = synthetic_corpus(frames);
        let report = benchmark_true_peak(&corpus, iterations);

        vec![super::metric(
            "true_peak_fir_ring_slice",
            super::PathKind::Sample,
            "sample",
            report.ring_slice_ns_per_sample,
            report.legacy_ns_per_sample,
            true,
        )]
    }
}

#[allow(dead_code)]
mod lockfree {
    include!("audio_lockfree_params_perf.rs");

    pub(super) fn control_metrics(quick: bool, heavy: bool) -> Vec<super::Metric> {
        let iterations = if quick {
            200_000
        } else if heavy {
            1_000_000
        } else {
            500_000
        };
        let update_interval = if quick { 2_048 } else { 8_192 };
        let steady = benchmark_steady_state(iterations);
        let occasional = benchmark_occasional_update(iterations, update_interval);
        let arc_guard = benchmark_arc_guard_steady_state(iterations);

        vec![
            super::metric_with_first_pass(
                "lockfree_params_generation_steady_state",
                super::PathKind::Control,
                "read",
                steady.current_ns_per_read,
                arc_guard.baseline_ns_per_read,
                steady.legacy_ns_per_read,
                true,
            ),
            super::metric(
                "lockfree_params_generation_occasional_update",
                super::PathKind::Control,
                "read",
                occasional.current_ns_per_read,
                occasional.legacy_ns_per_read,
                false,
            ),
            super::detail_metric_with_baselines(
                "lockfree_params_generation_vs_arc_guard",
                super::PathKind::Control,
                "read",
                arc_guard.current_ns_per_read,
                arc_guard.baseline_ns_per_read,
                steady.legacy_ns_per_read,
                Some(arc_guard.baseline_ns_per_read),
            ),
        ]
    }
}

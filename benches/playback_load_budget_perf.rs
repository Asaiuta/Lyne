use std::hint::black_box;
use std::time::{Duration, Instant};

use audio_engine::diagnostics::decode_memory_budget;
use audio_engine::player::bench_support::{
    ensure_decoded_samples_fit_budget_for_bench, estimate_decoded_buffer_for_bench,
    DecodedBudgetBenchEstimate, DecodedBudgetBenchKind,
};

const CHANNELS: usize = 2;
const SAMPLE_BYTES: usize = std::mem::size_of::<f64>();
const BYTES_PER_MIB: f64 = 1024.0 * 1024.0;

#[derive(Clone, Copy)]
struct Scenario {
    name: &'static str,
    kind: DecodedBudgetBenchKind,
    input_frames: u64,
    input_sample_rate: u32,
    output_sample_rate: u32,
    channels: usize,
    needs_resample: bool,
    existing_samples: usize,
    expect_accept: bool,
}

#[derive(Clone, Copy)]
struct Report {
    estimate: DecodedBudgetBenchEstimate,
    accepted: usize,
    rejected: usize,
    ns_per_check: f64,
    elapsed: Duration,
}

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let quick = args.iter().any(|arg| arg == "--quick");
    let heavy = args.iter().any(|arg| arg == "--heavy");
    let enforce = args.iter().any(|arg| arg == "--enforce");

    let (iterations, trials) = if heavy { (250_000, 5) } else { (10_000, 1) };

    let budget = decode_memory_budget();
    println!(
        "playback_load_budget_perf mode={} budget_mb={} budget_source={} coverage=decoded_buffer_budget_and_gapless_existing_buffers",
        mode_name(quick, heavy),
        budget.limit_mb,
        budget.source
    );
    println!(
        "playback_load_budget_note includes=decoded_buffer_estimate,budget_guard,gapless_existing_samples,oversized_rejection excludes=decoder_io,resampler_runtime,cpal_device_write"
    );

    for scenario in scenarios_for_budget(budget.limit_bytes) {
        let report = best_of(trials, || measure_scenario(scenario, iterations));
        println!(
            "playback_load_budget scenario={} kind={} iterations={} trials={} input_frames={} input_sample_rate={} output_sample_rate={} channels={} resample={} existing_samples={} estimated_samples={} estimated_mib={:.3} accepted={} rejected={} ns_per_check={:.3} elapsed_ms={:.3}",
            scenario.name,
            kind_name(scenario.kind),
            iterations,
            trials,
            scenario.input_frames,
            scenario.input_sample_rate,
            scenario.output_sample_rate,
            scenario.channels,
            scenario.needs_resample,
            scenario.existing_samples,
            report.estimate.samples,
            report.estimate.bytes as f64 / BYTES_PER_MIB,
            report.accepted,
            report.rejected,
            report.ns_per_check,
            report.elapsed.as_secs_f64() * 1_000.0
        );

        if enforce {
            if scenario.expect_accept {
                assert_eq!(
                    report.rejected, 0,
                    "{} should fit the budget",
                    scenario.name
                );
                assert_eq!(report.accepted, iterations);
            } else {
                assert_eq!(report.accepted, 0, "{} should be rejected", scenario.name);
                assert_eq!(report.rejected, iterations);
            }
        }
    }
}

fn mode_name(quick: bool, heavy: bool) -> &'static str {
    if quick {
        "quick"
    } else if heavy {
        "heavy"
    } else {
        "full"
    }
}

fn scenarios_for_budget(limit_bytes: usize) -> Vec<Scenario> {
    let five_minutes_48k = u64::from(48_000_u32) * 60 * 5;
    let three_minutes_48k_samples = 48_000_usize * 60 * 3 * CHANNELS;
    let oversize_samples = (limit_bytes / SAMPLE_BYTES).saturating_add(CHANNELS * 1024);
    let oversize_frames = (oversize_samples / CHANNELS).saturating_add(1) as u64;

    vec![
        Scenario {
            name: "short_30s_48k_stereo",
            kind: DecodedBudgetBenchKind::CurrentTrack,
            input_frames: u64::from(48_000_u32) * 30,
            input_sample_rate: 48_000,
            output_sample_rate: 48_000,
            channels: CHANNELS,
            needs_resample: false,
            existing_samples: 0,
            expect_accept: true,
        },
        Scenario {
            name: "normal_5m_48k_stereo",
            kind: DecodedBudgetBenchKind::CurrentTrack,
            input_frames: five_minutes_48k,
            input_sample_rate: 48_000,
            output_sample_rate: 48_000,
            channels: CHANNELS,
            needs_resample: false,
            existing_samples: 0,
            expect_accept: true,
        },
        Scenario {
            name: "resampled_5m_44k_to_96k_stereo",
            kind: DecodedBudgetBenchKind::CurrentTrack,
            input_frames: u64::from(44_100_u32) * 60 * 5,
            input_sample_rate: 44_100,
            output_sample_rate: 96_000,
            channels: CHANNELS,
            needs_resample: true,
            existing_samples: 0,
            expect_accept: true,
        },
        Scenario {
            name: "gapless_5m_with_current_3m_buffer",
            kind: DecodedBudgetBenchKind::GaplessPreload,
            input_frames: five_minutes_48k,
            input_sample_rate: 48_000,
            output_sample_rate: 48_000,
            channels: CHANNELS,
            needs_resample: false,
            existing_samples: three_minutes_48k_samples,
            expect_accept: true,
        },
        Scenario {
            name: "oversized_track_guard",
            kind: DecodedBudgetBenchKind::CurrentTrack,
            input_frames: oversize_frames,
            input_sample_rate: 48_000,
            output_sample_rate: 48_000,
            channels: CHANNELS,
            needs_resample: false,
            existing_samples: 0,
            expect_accept: false,
        },
    ]
}

fn kind_name(kind: DecodedBudgetBenchKind) -> &'static str {
    match kind {
        DecodedBudgetBenchKind::CurrentTrack => "current_track",
        DecodedBudgetBenchKind::GaplessPreload => "gapless_preload",
    }
}

fn best_of<F>(trials: usize, mut run: F) -> Report
where
    F: FnMut() -> Report,
{
    let mut best: Option<Report> = None;
    for _ in 0..trials {
        let report = run();
        if best
            .as_ref()
            .map_or(true, |current| report.ns_per_check < current.ns_per_check)
        {
            best = Some(report);
        }
    }
    best.expect("at least one trial")
}

fn measure_scenario(scenario: Scenario, iterations: usize) -> Report {
    let estimate = estimate_decoded_buffer_for_bench(
        scenario.input_frames,
        scenario.input_sample_rate,
        scenario.output_sample_rate,
        scenario.channels,
        scenario.needs_resample,
    )
    .expect("benchmark shape should estimate");

    let mut accepted = 0usize;
    let mut rejected = 0usize;
    let start = Instant::now();

    for _ in 0..iterations {
        match ensure_decoded_samples_fit_budget_for_bench(
            scenario.kind,
            black_box(scenario.name),
            black_box(estimate.samples),
            black_box(scenario.existing_samples),
        ) {
            Ok(()) => accepted += 1,
            Err(err) => {
                black_box(err);
                rejected += 1;
            }
        }
    }

    let elapsed = start.elapsed();
    Report {
        estimate,
        accepted,
        rejected,
        ns_per_check: elapsed.as_nanos() as f64 / iterations as f64,
        elapsed,
    }
}

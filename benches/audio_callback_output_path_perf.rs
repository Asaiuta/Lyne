use std::hint::black_box;
use std::path::{Path, PathBuf};

use audio_engine::bench_gate::{self, exit_for, GateContext, GateMetric, GateMode};
use audio_engine::bench_provenance::{self, ProvenanceRequest};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Instant;

use audio_engine::player::bench_support::{
    spectrum_channel_for_bench, SpectrumBenchSender, AUDIO_PROCESS_BUFFER_FRAMES,
};
use audio_engine::player::{
    audio_callback_lockfree, CallbackScratch, FinalNoiseShaper, PlayerState, SharedState,
};
use audio_engine::processor::{
    AtomicLoudnessState, AtomicNoiseShaperParams, DspChain, NoiseShaperCurve, StreamingResampler,
};
use serde::Serialize;

const CHANNELS: usize = 2;
const SOURCE_SAMPLE_RATE: u32 = 44_100;
const OUTPUT_SAMPLE_RATE: u32 = 48_000;
const BUFFER_FRAMES: [usize; 4] = [64, 128, 256, 512];
const WARMUP_BUFFERS: usize = 64;

#[derive(Clone, Copy)]
enum Scenario {
    Direct,
    ShaperOnly,
    ResamplerOnly,
    Full,
}

impl Scenario {
    fn name(self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::ShaperOnly => "shaper_only",
            Self::ResamplerOnly => "resampler_only",
            Self::Full => "full",
        }
    }

    fn uses_resampler(self) -> bool {
        matches!(self, Self::ResamplerOnly | Self::Full)
    }

    fn uses_shaper(self) -> bool {
        matches!(self, Self::ShaperOnly | Self::Full)
    }

    fn all() -> &'static [Self] {
        &[
            Self::Direct,
            Self::ShaperOnly,
            Self::ResamplerOnly,
            Self::Full,
        ]
    }
}

struct BenchFixture {
    shared: SharedState,
    chain: DspChain,
    final_noise_shaper: FinalNoiseShaper,
    loudness: Arc<AtomicLoudnessState>,
    spectrum_tx: SpectrumBenchSender,
    resampler: Option<StreamingResampler>,
    scratch: CallbackScratch,
    output: Vec<f32>,
}

#[derive(Clone, Serialize)]
struct Report {
    ns_per_output_sample: f64,
    ns_per_output_buffer: f64,
    elapsed_ns: u64,
    callback_latency_ns: LatencySummary,
}

struct ReportStats {
    best: Report,
    median: Report,
    worst: Report,
    aggregate_callback_latency_ns: LatencySummary,
}

#[derive(Clone, Serialize)]
struct LatencySummary {
    count: usize,
    deadline_miss_count: usize,
    deadline_miss_rate: f64,
    p50: u64,
    p95: u64,
    p99: u64,
    p99_9: u64,
    p99_99: u64,
    max: u64,
}

#[derive(Clone, Serialize)]
struct BenchmarkRow {
    scenario: &'static str,
    frames: usize,
    samples: usize,
    fixture_source_frames: usize,
    callback_period_ms: f64,
    aggregate_callback_latency_ns: LatencySummary,
    best: Report,
    median: Report,
    worst: Report,
}

#[derive(Clone, Serialize)]
struct BenchmarkReport {
    schema_version: u32,
    benchmark: &'static str,
    mode: &'static str,
    channels: usize,
    source_sample_rate: u32,
    output_sample_rate: u32,
    iterations_per_trial: usize,
    trials: usize,
    rows: Vec<BenchmarkRow>,
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

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let quick = args.iter().any(|arg| arg == "--quick");
    let heavy = args.iter().any(|arg| arg == "--heavy");
    let (gate_mode, gate_spec, gate_self_test) = bench_gate::parse_args(&args);
    if gate_self_test {
        bench_gate::gate_self_test().expect("gate self-test failed");
        println!("bench_gate self_test=passed");
        return;
    }
    let report_path = args
        .windows(2)
        .find(|pair| pair[0] == "--report")
        .map(|pair| PathBuf::from(&pair[1]));

    let (iterations, trials) = if quick {
        (500, 3)
    } else if heavy {
        (10_000, 7)
    } else {
        (2_000, 5)
    };
    let mode = if quick {
        "quick"
    } else if heavy {
        "heavy"
    } else {
        "full"
    };

    println!(
        "audio_callback_output_path_perf mode={} channels={} source_sample_rate={} output_sample_rate={} coverage=audio_callback_final_output_path",
        mode,
        CHANNELS,
        SOURCE_SAMPLE_RATE,
        OUTPUT_SAMPLE_RATE
    );
    println!(
        "audio_callback_output_path_note includes=callback_state,loudness_gain_disabled,dsp_chain_empty,optional_resampler,optional_final_noise_shaper,spectrum_pack excludes=decoder,cpal_device_write"
    );

    let mut gate_candidate: Option<(f64, f64, f64)> = None; // (buffer_ns, deadline_miss_rate, p99_99_ns)
    let mut rows = Vec::with_capacity(Scenario::all().len() * BUFFER_FRAMES.len());
    for &scenario in Scenario::all() {
        for &frames in &BUFFER_FRAMES {
            let stats = benchmark_scenario(scenario, frames, iterations, trials);
            let latency = &stats.aggregate_callback_latency_ns;
            println!(
                "callback_output_path scenario={} frames={} samples={} iterations={} trials={} ns_per_output_sample={:.3} ns_per_output_buffer={:.3} elapsed_ms={:.3} median_ns_per_output_sample={:.3} median_ns_per_output_buffer={:.3} worst_ns_per_output_sample={:.3} worst_ns_per_output_buffer={:.3} callback_p50_ns={} callback_p95_ns={} callback_p99_ns={} callback_p99_9_ns={} callback_p99_99_ns={} callback_max_ns={} deadline_misses={} deadline_miss_rate={:.9}",
                scenario.name(),
                frames,
                frames * CHANNELS,
                iterations,
                trials,
                stats.best.ns_per_output_sample,
                stats.best.ns_per_output_buffer,
                stats.best.elapsed_ns as f64 / 1_000_000.0,
                stats.median.ns_per_output_sample,
                stats.median.ns_per_output_buffer,
                stats.worst.ns_per_output_sample,
                stats.worst.ns_per_output_buffer,
                latency.p50,
                latency.p95,
                latency.p99,
                latency.p99_9,
                latency.p99_99,
                latency.max,
                latency.deadline_miss_count,
                latency.deadline_miss_rate
            );

            if matches!(scenario, Scenario::Full) && frames == 512 {
                gate_candidate = Some((
                    stats.median.ns_per_output_buffer,
                    latency.deadline_miss_rate,
                    latency.p99_99 as f64,
                ));
            }

            rows.push(BenchmarkRow {
                scenario: scenario.name(),
                frames,
                samples: frames * CHANNELS,
                fixture_source_frames: source_frames_for_bench(
                    scenario,
                    frames,
                    iterations + WARMUP_BUFFERS,
                ),
                callback_period_ms: frames as f64 * 1_000.0
                    / f64::from(output_sample_rate(scenario)),
                aggregate_callback_latency_ns: stats.aggregate_callback_latency_ns,
                best: stats.best,
                median: stats.median,
                worst: stats.worst,
            });
        }
    }

    // Gate verdict (check or gate mode).
    let gate_json = if matches!(gate_mode, GateMode::Check | GateMode::Gate) {
        let (buffer_ns, miss_rate, p9999) =
            gate_candidate.expect("gate scenario (full/512) executed");
        let ctx = GateContext {
            frame_period_ns: 512.0 * 1_000_000_000.0 / f64::from(OUTPUT_SAMPLE_RATE),
            deadline_miss_rate: Some(miss_rate),
            p9999_ns: Some(p9999),
        };
        let metrics = [GateMetric {
            name: "full_512_buffer_ns",
            value_ns: buffer_ns,
        }];
        let (verdict, _spec) = bench_gate::finish(
            "audio_callback_output_path_perf",
            gate_mode,
            gate_spec.as_deref().map(Path::new),
            &metrics,
            &ctx,
        );
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

    if let Some(path) = report_path {
        let provenance = bench_provenance::collect(&ProvenanceRequest {
            binary_path: None,
            fixture_paths: Vec::new(),
            profile: Some(mode),
            attribution: vec![
                "in-process",
                "no-cpal-device-write",
                "no-audible-end-to-end",
            ],
        });
        write_report(
            path,
            BenchmarkReport {
                schema_version: 2,
                benchmark: "audio_callback_output_path_perf",
                mode,
                channels: CHANNELS,
                source_sample_rate: SOURCE_SAMPLE_RATE,
                output_sample_rate: OUTPUT_SAMPLE_RATE,
                iterations_per_trial: iterations,
                trials,
                rows,
                gate: gate_json.clone(),
                provenance,
            },
        );
    }

    if let Some(gate) = gate_json {
        if gate.exit_code != 0 {
            std::process::exit(gate.exit_code);
        }
    }
}

fn benchmark_scenario(
    scenario: Scenario,
    frames: usize,
    iterations: usize,
    trials: usize,
) -> ReportStats {
    let mut reports = Vec::with_capacity(trials);
    let mut aggregate_latency_samples = Vec::with_capacity(iterations * trials);

    for _ in 0..trials {
        let mut fixture = build_fixture(scenario, frames, iterations + WARMUP_BUFFERS);
        warm_callback(&mut fixture, frames);
        let (ns_per_output_sample, ns_per_output_buffer, elapsed_ns) =
            measure_callback_throughput(&mut fixture, frames, iterations);
        assert_source_headroom(&fixture);
        drop(fixture);

        let mut latency_fixture = build_fixture(scenario, frames, iterations + WARMUP_BUFFERS);
        warm_callback(&mut latency_fixture, frames);
        let latency_samples = measure_callback_latency(&mut latency_fixture, frames, iterations);
        assert_source_headroom(&latency_fixture);
        aggregate_latency_samples.extend_from_slice(&latency_samples);
        let callback_latency_ns =
            summarize_latency(latency_samples, frames, output_sample_rate(scenario));
        let report = Report {
            ns_per_output_sample,
            ns_per_output_buffer,
            elapsed_ns,
            callback_latency_ns,
        };
        reports.push(report);
    }

    reports.sort_by(|left, right| {
        left.ns_per_output_sample
            .total_cmp(&right.ns_per_output_sample)
    });

    ReportStats {
        best: reports[0].clone(),
        median: reports[reports.len() / 2].clone(),
        worst: reports[reports.len() - 1].clone(),
        aggregate_callback_latency_ns: summarize_latency(
            aggregate_latency_samples,
            frames,
            output_sample_rate(scenario),
        ),
    }
}

fn build_fixture(scenario: Scenario, frames: usize, callback_count: usize) -> BenchFixture {
    let source_frames = source_frames_for_bench(scenario, frames, callback_count);
    let shared = SharedState::new();
    shared
        .audio_buffer
        .store(Arc::new(synthetic_buffer(source_frames, CHANNELS)));
    shared
        .total_frames
        .store(source_frames as u64, Ordering::Relaxed);
    shared
        .sample_rate
        .store(SOURCE_SAMPLE_RATE as u64, Ordering::Relaxed);
    shared.channels.store(CHANNELS as u64, Ordering::Relaxed);
    shared.state.store(PlayerState::Playing);

    let chain = DspChain::new(SOURCE_SAMPLE_RATE).expect("valid benchmark DSP chain");
    let loudness = Arc::new(AtomicLoudnessState::default());
    loudness.set_enabled(false);

    let noise_shaper_params = Arc::new(AtomicNoiseShaperParams::new());
    noise_shaper_params.set_enabled(scenario.uses_shaper());
    noise_shaper_params.set_bits(24);
    noise_shaper_params.set_curve(NoiseShaperCurve::TpdfOnly);
    let final_noise_shaper =
        FinalNoiseShaper::new(CHANNELS, output_sample_rate(scenario), noise_shaper_params)
            .expect("valid benchmark noise shaper");

    let resampler = if scenario.uses_resampler() {
        Some(
            StreamingResampler::new(CHANNELS, SOURCE_SAMPLE_RATE, OUTPUT_SAMPLE_RATE)
                .expect("valid benchmark resampler"),
        )
    } else {
        None
    };

    let (spectrum_tx, _spectrum_rx) = spectrum_channel_for_bench(16);

    BenchFixture {
        shared,
        chain,
        final_noise_shaper,
        loudness,
        spectrum_tx,
        resampler,
        scratch: CallbackScratch::new(CHANNELS),
        output: vec![0.0; frames * CHANNELS],
    }
}

fn output_sample_rate(scenario: Scenario) -> u32 {
    if scenario.uses_resampler() {
        OUTPUT_SAMPLE_RATE
    } else {
        SOURCE_SAMPLE_RATE
    }
}

fn source_frames_for_bench(scenario: Scenario, frames: usize, callback_count: usize) -> usize {
    if scenario.uses_resampler() {
        let output_frames = callback_count
            .checked_mul(frames)
            .expect("benchmark output frame count must fit usize");
        let scaled_input_frames = output_frames
            .checked_mul(SOURCE_SAMPLE_RATE as usize)
            .expect("benchmark resampler input estimate must fit usize")
            .div_ceil(OUTPUT_SAMPLE_RATE as usize);
        scaled_input_frames
            .checked_add(AUDIO_PROCESS_BUFFER_FRAMES * 2)
            .expect("benchmark resampler headroom must fit usize")
    } else {
        callback_count
            .checked_mul(frames)
            .and_then(|source_frames| source_frames.checked_add(AUDIO_PROCESS_BUFFER_FRAMES))
            .expect("benchmark source frame count must fit usize")
    }
}

fn assert_source_headroom(fixture: &BenchFixture) {
    let consumed_frames = fixture.shared.position_frames() as usize;
    let total_frames = fixture.shared.total_frames.load(Ordering::Relaxed) as usize;
    assert!(
        consumed_frames < total_frames,
        "callback benchmark exhausted its synthetic input ({consumed_frames}/{total_frames} frames)"
    );
}

fn warm_callback(fixture: &mut BenchFixture, frames: usize) {
    for _ in 0..WARMUP_BUFFERS {
        run_callback_once(fixture, frames);
    }
}

fn measure_callback_throughput(
    fixture: &mut BenchFixture,
    frames: usize,
    iterations: usize,
) -> (f64, f64, u64) {
    let start = Instant::now();

    for _ in 0..iterations {
        run_callback_once(fixture, frames);
    }

    let elapsed = start.elapsed();
    let ns_per_output_buffer = elapsed.as_nanos() as f64 / iterations as f64;
    let ns_per_output_sample = ns_per_output_buffer / (frames * CHANNELS) as f64;

    (
        ns_per_output_sample,
        ns_per_output_buffer,
        elapsed.as_nanos().min(u128::from(u64::MAX)) as u64,
    )
}

fn measure_callback_latency(
    fixture: &mut BenchFixture,
    frames: usize,
    iterations: usize,
) -> Vec<u64> {
    let mut samples = Vec::with_capacity(iterations);
    for _ in 0..iterations {
        let started_at = Instant::now();
        run_callback_once(fixture, frames);
        samples.push(started_at.elapsed().as_nanos().min(u128::from(u64::MAX)) as u64);
    }
    samples
}

fn summarize_latency(
    mut samples: Vec<u64>,
    callback_frames: usize,
    sample_rate: u32,
) -> LatencySummary {
    let deadline_miss_count = samples
        .iter()
        .filter(|&&latency_ns| {
            u128::from(latency_ns) * u128::from(sample_rate)
                > callback_frames as u128 * 1_000_000_000_u128
        })
        .count();
    let deadline_miss_rate = if samples.is_empty() {
        0.0
    } else {
        deadline_miss_count as f64 / samples.len() as f64
    };
    samples.sort_unstable();
    LatencySummary {
        count: samples.len(),
        deadline_miss_count,
        deadline_miss_rate,
        p50: nearest_rank(&samples, 0.50),
        p95: nearest_rank(&samples, 0.95),
        p99: nearest_rank(&samples, 0.99),
        p99_9: nearest_rank(&samples, 0.999),
        p99_99: nearest_rank(&samples, 0.9999),
        max: samples.last().copied().unwrap_or(0),
    }
}

fn nearest_rank(sorted: &[u64], percentile: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let rank = (percentile * sorted.len() as f64).ceil() as usize;
    sorted[rank.saturating_sub(1).min(sorted.len() - 1)]
}

fn write_report(path: PathBuf, report: BenchmarkReport) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap_or_else(|error| {
            panic!(
                "failed to create callback benchmark report directory '{}': {error}",
                parent.display()
            )
        });
    }
    let json = serde_json::to_vec_pretty(&report)
        .expect("callback benchmark report must serialize as JSON");
    std::fs::write(&path, json).unwrap_or_else(|error| {
        panic!(
            "failed to write callback benchmark report '{}': {error}",
            path.display()
        )
    });
    println!("callback_output_path_report path={}", path.display());
}

fn run_callback_once(fixture: &mut BenchFixture, frames: usize) {
    debug_assert_eq!(fixture.output.len(), frames * CHANNELS);
    audio_callback_lockfree(
        black_box(&mut fixture.output),
        &fixture.shared,
        &mut fixture.chain,
        Some(&mut fixture.final_noise_shaper),
        &fixture.loudness,
        &fixture.spectrum_tx,
        CHANNELS,
        &mut fixture.resampler,
        &mut fixture.scratch,
    );
    black_box(&fixture.output);
}

fn synthetic_buffer(frames: usize, channels: usize) -> Vec<f64> {
    let mut out = Vec::with_capacity(frames * channels);
    let mut left_phase = 0.0_f64;
    let mut right_phase = 0.0_f64;

    for frame in 0..frames {
        let t = frame as f64 / SOURCE_SAMPLE_RATE as f64;
        left_phase +=
            std::f64::consts::TAU * (220.0 + 11.0 * (t * 3.0).sin()) / SOURCE_SAMPLE_RATE as f64;
        right_phase +=
            std::f64::consts::TAU * (330.0 + 7.0 * (t * 5.0).cos()) / SOURCE_SAMPLE_RATE as f64;
        let envelope = 0.65 + 0.20 * (std::f64::consts::TAU * 1.7 * t).sin();
        let transient = if frame % 127 == 0 { 0.28 } else { 0.0 };
        let left =
            (left_phase.sin() * 0.55 + (left_phase * 3.0).sin() * 0.08 + transient) * envelope;
        let right =
            (right_phase.sin() * 0.50 - (right_phase * 2.0).cos() * 0.07 - transient) * envelope;

        if channels == 1 {
            out.push((left + right) * 0.5);
        } else {
            out.push(left);
            out.push(right);
            for ch in 2..channels {
                out.push((left + right) * 0.25 * (1.0 - ch as f64 * 0.03));
            }
        }
    }

    out
}

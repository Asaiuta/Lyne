use std::hint::black_box;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use audio_engine::player::bench_support::{spectrum_channel_for_bench, SpectrumBenchSender};
use audio_engine::player::{audio_callback_lockfree, CallbackScratch, PlayerState, SharedState};
use audio_engine::processor::{
    AtomicLoudnessState, AtomicNoiseShaperParams, DspChain, NoiseShaperCurve, NoiseShaperProcessor,
    StreamingResampler,
};

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
    final_noise_shaper: NoiseShaperProcessor,
    loudness: Arc<AtomicLoudnessState>,
    spectrum_tx: SpectrumBenchSender,
    resampler: Option<StreamingResampler>,
    scratch: CallbackScratch,
    output: Vec<f32>,
}

#[derive(Clone, Copy)]
struct Report {
    ns_per_output_sample: f64,
    ns_per_output_buffer: f64,
    elapsed: Duration,
}

struct ReportStats {
    best: Report,
    median: Report,
    worst: Report,
}

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let quick = args.iter().any(|arg| arg == "--quick");
    let heavy = args.iter().any(|arg| arg == "--heavy");
    let enforce = args.iter().any(|arg| arg == "--enforce");

    let (iterations, trials) = if quick {
        (500, 3)
    } else if heavy {
        (10_000, 7)
    } else {
        (2_000, 5)
    };

    println!(
        "audio_callback_output_path_perf mode={} channels={} source_sample_rate={} output_sample_rate={} coverage=audio_callback_final_output_path",
        if quick {
            "quick"
        } else if heavy {
            "heavy"
        } else {
            "full"
        },
        CHANNELS,
        SOURCE_SAMPLE_RATE,
        OUTPUT_SAMPLE_RATE
    );
    println!(
        "audio_callback_output_path_note includes=callback_state,loudness_gain_disabled,dsp_chain_empty,optional_resampler,optional_final_noise_shaper,spectrum_pack excludes=decoder,cpal_device_write"
    );

    for &scenario in Scenario::all() {
        for &frames in &BUFFER_FRAMES {
            let stats = benchmark_scenario(scenario, frames, iterations, trials);
            println!(
                "callback_output_path scenario={} frames={} samples={} iterations={} trials={} ns_per_output_sample={:.3} ns_per_output_buffer={:.3} elapsed_ms={:.3} median_ns_per_output_sample={:.3} median_ns_per_output_buffer={:.3} worst_ns_per_output_sample={:.3} worst_ns_per_output_buffer={:.3}",
                scenario.name(),
                frames,
                frames * CHANNELS,
                iterations,
                trials,
                stats.best.ns_per_output_sample,
                stats.best.ns_per_output_buffer,
                stats.best.elapsed.as_secs_f64() * 1_000.0,
                stats.median.ns_per_output_sample,
                stats.median.ns_per_output_buffer,
                stats.worst.ns_per_output_sample,
                stats.worst.ns_per_output_buffer
            );

            if enforce && frames == 512 {
                assert!(
                    stats.best.ns_per_output_sample.is_finite()
                        && stats.best.ns_per_output_sample > 0.0
                        && stats.median.ns_per_output_sample.is_finite()
                        && stats.median.ns_per_output_sample > 0.0,
                    "callback output path benchmark produced invalid timing"
                );
            }
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

    for _ in 0..trials {
        let mut fixture = build_fixture(scenario, frames, iterations + WARMUP_BUFFERS);
        warm_callback(&mut fixture, frames);
        let report = measure_callback(&mut fixture, frames, iterations);
        reports.push(report);
    }

    reports.sort_by(|left, right| {
        left.ns_per_output_sample
            .total_cmp(&right.ns_per_output_sample)
    });

    ReportStats {
        best: reports[0],
        median: reports[reports.len() / 2],
        worst: reports[reports.len() - 1],
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

    let chain = DspChain::new(SOURCE_SAMPLE_RATE as f64);
    let loudness = Arc::new(AtomicLoudnessState::default());
    loudness.set_enabled(false);

    let noise_shaper_params = Arc::new(AtomicNoiseShaperParams::new());
    noise_shaper_params.set_enabled(scenario.uses_shaper());
    noise_shaper_params.set_bits(24);
    noise_shaper_params.set_curve(NoiseShaperCurve::TpdfOnly);
    let final_noise_shaper =
        NoiseShaperProcessor::new(CHANNELS, output_sample_rate(scenario), noise_shaper_params);

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
        callback_count * 4_096 + 8_192
    } else {
        callback_count * frames + 8_192
    }
}

fn warm_callback(fixture: &mut BenchFixture, frames: usize) {
    for _ in 0..WARMUP_BUFFERS {
        run_callback_once(fixture, frames);
    }
}

fn measure_callback(fixture: &mut BenchFixture, frames: usize, iterations: usize) -> Report {
    let start = Instant::now();

    for _ in 0..iterations {
        run_callback_once(fixture, frames);
    }

    let elapsed = start.elapsed();
    let ns_per_output_buffer = elapsed.as_nanos() as f64 / iterations as f64;
    let ns_per_output_sample = ns_per_output_buffer / (frames * CHANNELS) as f64;

    Report {
        ns_per_output_sample,
        ns_per_output_buffer,
        elapsed,
    }
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

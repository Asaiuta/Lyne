use std::hint::black_box;
use std::time::{Duration, Instant};

use audio_engine::processor::{
    AtomicVolumeParams, AudioProcessor, GainRamp, NoiseShaper, NoiseShaperCurve, Saturation,
    SaturationType, TrackLoudness, VolumeController, VolumeProcessor,
};

const SAMPLE_RATE: u32 = 48_000;
const SAMPLE_RATE_F64: f64 = SAMPLE_RATE as f64;
const CHANNELS: usize = 2;
const CALLBACK_FRAMES: usize = 64;
const BENCH_INV_U64_MAX: f64 = 1.0 / u64::MAX as f64;
fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let quick = args.iter().any(|arg| arg == "--quick");
    let enforce = args.iter().any(|arg| arg == "--enforce");
    let iterations = if quick { 30 } else { 160 };
    let frames = if quick { 4_096 } else { 16_384 };
    let corpus = synthetic_corpus(frames, CHANNELS);

    println!("audio_derived_constants_perf frames={frames} iterations={iterations}");

    let noise_report = benchmark_noise_shaper(&corpus, iterations);
    print_report("noise_shaper_cached_scale_tpdf", &noise_report);

    let noise_ring_report = benchmark_noise_shaper_9tap_duplicated_ring(&corpus, iterations);
    print_report(
        "candidate_noise_shaper_9tap_duplicated_ring",
        &noise_ring_report,
    );

    let volume_controller_report = benchmark_volume_controller(&corpus, iterations);
    print_report(
        "volume_controller_cached_one_minus",
        &volume_controller_report,
    );

    let volume_processor_report = benchmark_volume_processor(&corpus, iterations);
    print_report("volume_processor_local_current", &volume_processor_report);

    let saturation_report = benchmark_saturation(&corpus, iterations);
    print_report("saturation_hot_field_hoist", &saturation_report);

    let ramp_report = benchmark_gain_ramp(frames * CHANNELS, iterations);
    print_report("gain_ramp_cached_current", &ramp_report);

    let loudness_report = benchmark_loudness_gain_cache(iterations);
    print_report("loudness_gain_linear_cache", &loudness_report);

    let gain_ramp_block_report = benchmark_gain_ramp_block_apply(&corpus, iterations);
    print_report(
        "gain_ramp_block_apply_vs_next_gain_loop",
        &gain_ramp_block_report,
    );

    let saturation_outer_match_report = benchmark_saturation_outer_dispatch(&corpus, iterations);
    print_report(
        "candidate_saturation_outer_dispatch_vs_current",
        &saturation_outer_match_report,
    );

    let volume_lazy_settle_report = benchmark_volume_lazy_settle(&corpus, iterations);
    print_report(
        "volume_lazy_settle_vs_exact_smoothing_kernel",
        &volume_lazy_settle_report,
    );

    if enforce {
        for (name, report) in [
            ("noise_shaper_cached_scale_tpdf", &noise_report),
            ("volume_processor_local_current", &volume_processor_report),
            ("gain_ramp_cached_current", &ramp_report),
            ("loudness_gain_linear_cache", &loudness_report),
        ] {
            assert!(
                report.improvement_percent >= 5.0,
                "{name} improvement below 5%: {:.2}%",
                report.improvement_percent
            );
        }
    }
}

struct BenchReport {
    current_ns_per_unit: f64,
    legacy_ns_per_unit: f64,
    original_ns_per_unit: f64,
    first_pass_ns_per_unit: Option<f64>,
    improvement_percent: f64,
    original_improvement_percent: f64,
}

fn benchmark_noise_shaper(corpus: &[f64], iterations: usize) -> BenchReport {
    let mut current_check = NoiseShaper::new(CHANNELS, SAMPLE_RATE, 24);
    let mut legacy_check = LegacyNoiseShaper::new(CHANNELS, SAMPLE_RATE, 24);
    assert_noise_outputs_match(&mut current_check, &mut legacy_check, corpus);

    let current_duration = measure(
        || {
            let mut shaper = NoiseShaper::new(CHANNELS, SAMPLE_RATE, 24);
            let mut sum = 0.0;
            for frame in 0..(corpus.len() / CHANNELS) {
                for ch in 0..CHANNELS {
                    let idx = frame * CHANNELS + ch;
                    sum += shaper.process_sample(black_box(corpus[idx]), ch);
                }
            }
            black_box(sum)
        },
        iterations,
    );

    let legacy_duration = measure(
        || {
            let mut shaper = LegacyNoiseShaper::new(CHANNELS, SAMPLE_RATE, 24);
            let mut sum = 0.0;
            for frame in 0..(corpus.len() / CHANNELS) {
                for ch in 0..CHANNELS {
                    let idx = frame * CHANNELS + ch;
                    sum += shaper.process_sample(black_box(corpus[idx]), ch);
                }
            }
            black_box(sum)
        },
        iterations,
    );

    report(current_duration, legacy_duration, corpus.len() * iterations)
}

fn benchmark_noise_shaper_9tap_duplicated_ring(corpus: &[f64], iterations: usize) -> BenchReport {
    assert_noise_9tap_duplicated_ring_outputs_match(corpus);

    let coeffs = NoiseShaperCurve::FWeighted9.coeffs();
    let candidate_duration = measure(
        || {
            let mut shaper = DuplicatedRing9TapNoiseShaper::new(CHANNELS, coeffs, 24);
            let mut sum = 0.0;
            for frame in 0..(corpus.len() / CHANNELS) {
                for ch in 0..CHANNELS {
                    let idx = frame * CHANNELS + ch;
                    sum += shaper.process_sample(black_box(corpus[idx]), ch);
                }
            }
            black_box(sum)
        },
        iterations,
    );

    let current_shift_duration = measure(
        || {
            let mut shaper = Current9TapShiftNoiseShaper::new(CHANNELS, coeffs, 24);
            let mut sum = 0.0;
            for frame in 0..(corpus.len() / CHANNELS) {
                for ch in 0..CHANNELS {
                    let idx = frame * CHANNELS + ch;
                    sum += shaper.process_sample(black_box(corpus[idx]), ch);
                }
            }
            black_box(sum)
        },
        iterations,
    );

    report(
        candidate_duration,
        current_shift_duration,
        corpus.len() * iterations,
    )
}

fn benchmark_volume_controller(corpus: &[f64], iterations: usize) -> BenchReport {
    assert_volume_controller_outputs_match(corpus);

    let current_duration = measure(
        || {
            let mut volume = VolumeController::with_sample_rate(SAMPLE_RATE);
            volume.set_target(0.25);
            let mut buffer = corpus.to_vec();
            volume.process(black_box(&mut buffer), CHANNELS);
            black_box(buffer[buffer.len() - 1])
        },
        iterations,
    );

    let legacy_duration = measure(
        || {
            let mut volume = LegacyVolumeController::with_sample_rate(SAMPLE_RATE);
            volume.set_target(0.25);
            let mut buffer = corpus.to_vec();
            volume.process(black_box(&mut buffer), CHANNELS);
            black_box(buffer[buffer.len() - 1])
        },
        iterations,
    );

    report(current_duration, legacy_duration, corpus.len() * iterations)
}

fn benchmark_volume_processor(corpus: &[f64], iterations: usize) -> BenchReport {
    assert_volume_processor_outputs_match(corpus);

    let params = std::sync::Arc::new(AtomicVolumeParams::new());
    params.set_volume(0.25);
    let mut current = VolumeProcessor::new(std::sync::Arc::clone(&params));
    current.set_sample_rate(SAMPLE_RATE_F64);
    let mut legacy = LegacyVolumeProcessor::new(SAMPLE_RATE_F64, 0.25);
    let mut current_buffer = corpus.to_vec();
    let mut legacy_buffer = corpus.to_vec();

    let current_duration = measure(
        || {
            current_buffer.copy_from_slice(corpus);
            current.reset();
            current.process(black_box(&mut current_buffer), CHANNELS);
            black_box(current_buffer[current_buffer.len() - 1])
        },
        iterations,
    );

    let legacy_duration = measure(
        || {
            legacy_buffer.copy_from_slice(corpus);
            legacy.reset();
            legacy.process(black_box(&mut legacy_buffer), CHANNELS);
            black_box(legacy_buffer[legacy_buffer.len() - 1])
        },
        iterations,
    );

    report(current_duration, legacy_duration, corpus.len() * iterations)
}

fn benchmark_saturation(corpus: &[f64], iterations: usize) -> BenchReport {
    assert_saturation_outputs_match(corpus);

    let mut current = configured_saturation();
    let legacy = LegacySaturation::configured();
    let mut current_buffer = corpus.to_vec();
    let mut legacy_buffer = corpus.to_vec();

    let current_duration = measure(
        || {
            process_blocks_mut(&mut current_buffer, corpus, CALLBACK_FRAMES, |block| {
                current.process_with_channels(block, CHANNELS);
            });
            black_box(current_buffer[current_buffer.len() / 2])
        },
        iterations,
    );

    let legacy_duration = measure(
        || {
            process_blocks_mut(&mut legacy_buffer, corpus, CALLBACK_FRAMES, |block| {
                legacy.process_with_channels(block, CHANNELS);
            });
            black_box(legacy_buffer[legacy_buffer.len() / 2])
        },
        iterations,
    );

    report(current_duration, legacy_duration, corpus.len() * iterations)
}

fn benchmark_gain_ramp(samples: usize, iterations: usize) -> BenchReport {
    assert_gain_ramp_outputs_match(samples);

    let current_duration = measure(
        || {
            let mut ramp = GainRamp::new(0.05, 0.95, SAMPLE_RATE, 250);
            let mut sum = 0.0;
            for _ in 0..samples {
                sum += ramp.next_gain();
            }
            black_box(sum)
        },
        iterations,
    );

    let legacy_duration = measure(
        || {
            let mut ramp = LegacyGainRamp::new(0.05, 0.95, SAMPLE_RATE, 250);
            let mut sum = 0.0;
            for _ in 0..samples {
                sum += ramp.next_gain();
            }
            black_box(sum)
        },
        iterations,
    );

    report(current_duration, legacy_duration, samples * iterations)
}

fn benchmark_loudness_gain_cache(iterations: usize) -> BenchReport {
    assert_loudness_gain_outputs_match();
    let track = TrackLoudness::new("bench.wav", -18.0, -1.0, None, -14.0);
    let legacy = LegacyTrackLoudness {
        integrated_lufs: -18.0,
    };
    let calls_per_iteration = 64_000;

    let current_duration = measure(
        || {
            let mut sum = 0.0f32;
            for _ in 0..calls_per_iteration {
                sum += track.gain_linear(black_box(-14.0));
            }
            black_box(sum)
        },
        iterations,
    );

    let legacy_duration = measure(
        || {
            let mut sum = 0.0f32;
            for _ in 0..calls_per_iteration {
                sum += legacy.gain_linear(black_box(-14.0));
            }
            black_box(sum)
        },
        iterations,
    );

    report(
        current_duration,
        legacy_duration,
        calls_per_iteration * iterations,
    )
}

fn benchmark_gain_ramp_block_apply(corpus: &[f64], iterations: usize) -> BenchReport {
    assert_gain_ramp_block_apply_matches_next_gain_loop(corpus);
    let mut current_buffer = corpus.to_vec();
    let mut legacy_buffer = corpus.to_vec();
    let mut original_buffer = corpus.to_vec();

    let current_duration = measure(
        || {
            let mut ramp = GainRamp::new(0.05, 0.95, SAMPLE_RATE, 250);
            current_buffer.copy_from_slice(corpus);
            for block in current_buffer.chunks_mut(CALLBACK_FRAMES * CHANNELS) {
                ramp.apply(block);
            }
            black_box(current_buffer[current_buffer.len() / 2])
        },
        iterations,
    );

    let legacy_duration = measure(
        || {
            let mut ramp = GainRamp::new(0.05, 0.95, SAMPLE_RATE, 250);
            legacy_buffer.copy_from_slice(corpus);
            for sample in &mut legacy_buffer {
                *sample *= ramp.next_gain();
            }
            black_box(legacy_buffer[legacy_buffer.len() / 2])
        },
        iterations,
    );

    let original_duration = measure(
        || {
            let mut ramp = LegacyGainRamp::new(0.05, 0.95, SAMPLE_RATE, 250);
            original_buffer.copy_from_slice(corpus);
            for sample in &mut original_buffer {
                *sample *= ramp.next_gain();
            }
            black_box(original_buffer[original_buffer.len() / 2])
        },
        iterations,
    );

    report_with_first_pass(
        current_duration,
        legacy_duration,
        original_duration,
        corpus.len() * iterations,
    )
}

fn benchmark_saturation_outer_dispatch(corpus: &[f64], iterations: usize) -> BenchReport {
    assert_saturation_outer_dispatch_outputs_match(corpus);

    let mut current = configured_saturation();
    let candidate = CandidateSaturationOuterDispatch::configured();
    let mut current_buffer = corpus.to_vec();
    let mut outer_dispatch_buffer = corpus.to_vec();

    let outer_dispatch_duration = measure(
        || {
            process_blocks_mut(
                &mut outer_dispatch_buffer,
                corpus,
                CALLBACK_FRAMES,
                |block| {
                    candidate.process_with_channels(block, CHANNELS);
                },
            );
            black_box(outer_dispatch_buffer[outer_dispatch_buffer.len() / 2])
        },
        iterations,
    );

    let current_duration = measure(
        || {
            process_blocks_mut(&mut current_buffer, corpus, CALLBACK_FRAMES, |block| {
                current.process_with_channels(block, CHANNELS);
            });
            black_box(current_buffer[current_buffer.len() / 2])
        },
        iterations,
    );

    report(
        outer_dispatch_duration,
        current_duration,
        corpus.len() * iterations,
    )
}

fn benchmark_volume_lazy_settle(corpus: &[f64], iterations: usize) -> BenchReport {
    assert_volume_lazy_settle_close(corpus);

    let current_duration = measure(
        || {
            let mut volume = CurrentVolumeKernel::new(SAMPLE_RATE_F64, 0.25);
            let mut buffer = corpus.to_vec();
            volume.process(black_box(&mut buffer), CHANNELS);
            black_box(buffer[buffer.len() - 1])
        },
        iterations,
    );

    let legacy_duration = measure(
        || {
            let mut volume = LegacyExactVolumeKernel::new(SAMPLE_RATE_F64, 0.25);
            let mut buffer = corpus.to_vec();
            volume.process(black_box(&mut buffer), CHANNELS);
            black_box(buffer[buffer.len() - 1])
        },
        iterations,
    );

    let original_duration = measure(
        || {
            let mut volume = OriginalExactVolumeKernel::new(SAMPLE_RATE_F64, 0.25);
            let mut buffer = corpus.to_vec();
            volume.process(black_box(&mut buffer), CHANNELS);
            black_box(buffer[buffer.len() - 1])
        },
        iterations,
    );

    report_with_first_pass(
        current_duration,
        legacy_duration,
        original_duration,
        corpus.len() * iterations,
    )
}

fn configured_saturation() -> Saturation {
    let mut saturation = Saturation::with_type(SaturationType::Tube);
    saturation.set_drive(1.35);
    saturation.set_threshold(0.18);
    saturation.set_mix(0.72);
    saturation.set_input_gain(3.0);
    saturation.set_output_gain(-1.5);
    saturation.set_highpass_mode(false);
    saturation
}

fn measure<T>(mut run: impl FnMut() -> T, iterations: usize) -> Duration {
    let start = Instant::now();
    for _ in 0..iterations {
        black_box(run());
    }
    start.elapsed()
}

fn report(current: Duration, legacy: Duration, units: usize) -> BenchReport {
    let current_ns_per_unit = nanos_per_unit(current, units);
    let legacy_ns_per_unit = nanos_per_unit(legacy, units);
    BenchReport {
        current_ns_per_unit,
        legacy_ns_per_unit,
        original_ns_per_unit: legacy_ns_per_unit,
        first_pass_ns_per_unit: None,
        improvement_percent: (legacy_ns_per_unit - current_ns_per_unit) / legacy_ns_per_unit
            * 100.0,
        original_improvement_percent: (legacy_ns_per_unit - current_ns_per_unit)
            / legacy_ns_per_unit
            * 100.0,
    }
}

fn report_with_first_pass(
    current: Duration,
    first_pass: Duration,
    original: Duration,
    units: usize,
) -> BenchReport {
    let current_ns_per_unit = nanos_per_unit(current, units);
    let first_pass_ns_per_unit = nanos_per_unit(first_pass, units);
    let original_ns_per_unit = nanos_per_unit(original, units);
    BenchReport {
        current_ns_per_unit,
        legacy_ns_per_unit: first_pass_ns_per_unit,
        original_ns_per_unit,
        first_pass_ns_per_unit: Some(first_pass_ns_per_unit),
        improvement_percent: (first_pass_ns_per_unit - current_ns_per_unit)
            / first_pass_ns_per_unit
            * 100.0,
        original_improvement_percent: (original_ns_per_unit - current_ns_per_unit)
            / original_ns_per_unit
            * 100.0,
    }
}

fn print_report(name: &str, report: &BenchReport) {
    if let Some(first_pass) = report.first_pass_ns_per_unit {
        println!(
            "{name} current={:.3} ns/unit first_pass={:.3} ns/unit original={:.3} ns/unit incremental_improvement={:.2}% original_improvement={:.2}%",
            report.current_ns_per_unit,
            first_pass,
            report.original_ns_per_unit,
            report.improvement_percent,
            report.original_improvement_percent
        );
    } else {
        println!(
            "{name} current={:.3} ns/unit legacy={:.3} ns/unit improvement={:.2}%",
            report.current_ns_per_unit, report.legacy_ns_per_unit, report.improvement_percent
        );
    }
}

fn nanos_per_unit(duration: Duration, units: usize) -> f64 {
    duration.as_nanos() as f64 / units as f64
}

fn synthetic_corpus(frames: usize, channels: usize) -> Vec<f64> {
    let mut seed = 0xC0FF_EE17_u64;
    let mut out = Vec::with_capacity(frames * channels);

    for frame in 0..frames {
        let t = frame as f64 / SAMPLE_RATE_F64;
        let sine = (std::f64::consts::TAU * 997.0 * t).sin() * 0.34;
        let sweep_hz = 35.0 * (420.0_f64).powf(frame as f64 / frames as f64);
        let sweep = (std::f64::consts::TAU * sweep_hz * t).sin() * 0.19;
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        let white = (((seed >> 33) as f64 / u32::MAX as f64) * 2.0 - 1.0) * 0.04;
        let transient = if frame % 1024 == 97 { 0.55 } else { 0.0 };
        let sample = sine + sweep + white + transient;
        for ch in 0..channels {
            out.push(sample * (1.0 - ch as f64 * 0.03));
        }
    }

    out
}

fn process_blocks_mut(
    buffer: &mut [f64],
    corpus: &[f64],
    block_frames: usize,
    mut process: impl FnMut(&mut [f64]),
) {
    let block_samples = block_frames * CHANNELS;
    for (out, input) in buffer
        .chunks_mut(block_samples)
        .zip(corpus.chunks(block_samples))
    {
        out.copy_from_slice(input);
        process(black_box(out));
    }
}

fn assert_noise_outputs_match(
    current: &mut NoiseShaper,
    legacy: &mut LegacyNoiseShaper,
    corpus: &[f64],
) {
    for frame in 0..(corpus.len() / CHANNELS) {
        for ch in 0..CHANNELS {
            let idx = frame * CHANNELS + ch;
            let current_out = current.process_sample(corpus[idx], ch);
            let legacy_out = legacy.process_sample(corpus[idx], ch);
            assert_eq!(current_out.to_bits(), legacy_out.to_bits());
        }
    }
}

fn assert_noise_9tap_duplicated_ring_outputs_match(corpus: &[f64]) {
    for curve in [
        NoiseShaperCurve::FWeighted9,
        NoiseShaperCurve::ModifiedE9,
        NoiseShaperCurve::ImprovedE9,
    ] {
        let coeffs = curve.coeffs();
        let mut current = Current9TapShiftNoiseShaper::new(CHANNELS, coeffs, 24);
        let mut candidate = DuplicatedRing9TapNoiseShaper::new(CHANNELS, coeffs, 24);

        for frame in 0..(corpus.len() / CHANNELS) {
            for ch in 0..CHANNELS {
                let idx = frame * CHANNELS + ch;
                let current_out = current.process_sample(corpus[idx], ch);
                let candidate_out = candidate.process_sample(corpus[idx], ch);
                assert_eq!(
                    candidate_out.to_bits(),
                    current_out.to_bits(),
                    "duplicated ring mismatch for {:?} frame {frame} channel {ch}",
                    curve
                );
            }
        }
    }
}

fn assert_volume_controller_outputs_match(corpus: &[f64]) {
    let mut current = VolumeController::with_sample_rate(SAMPLE_RATE);
    let mut legacy = LegacyVolumeController::with_sample_rate(SAMPLE_RATE);
    current.set_target(0.25);
    legacy.set_target(0.25);
    let mut current_buffer = corpus.to_vec();
    let mut legacy_buffer = corpus.to_vec();
    current.process(&mut current_buffer, CHANNELS);
    legacy.process(&mut legacy_buffer, CHANNELS);
    assert_max_abs_diff("VolumeController", &current_buffer, &legacy_buffer, 1.0e-14);
}

fn assert_volume_processor_outputs_match(corpus: &[f64]) {
    let params = std::sync::Arc::new(AtomicVolumeParams::new());
    params.set_volume(0.25);
    let mut current = VolumeProcessor::new(params);
    current.set_sample_rate(SAMPLE_RATE_F64);
    let mut legacy = LegacyVolumeProcessor::new(SAMPLE_RATE_F64, 0.25);
    let mut current_buffer = corpus.to_vec();
    let mut legacy_buffer = corpus.to_vec();
    current.process(&mut current_buffer, CHANNELS);
    legacy.process(&mut legacy_buffer, CHANNELS);
    assert_max_abs_diff("VolumeProcessor", &current_buffer, &legacy_buffer, 1.0e-6);
}

fn assert_saturation_outputs_match(corpus: &[f64]) {
    let mut current = configured_saturation();
    let legacy = LegacySaturation::configured();
    let mut current_buffer = corpus.to_vec();
    let mut legacy_buffer = corpus.to_vec();
    current.process_with_channels(&mut current_buffer, CHANNELS);
    legacy.process_with_channels(&mut legacy_buffer, CHANNELS);
    assert_max_abs_diff("Saturation", &current_buffer, &legacy_buffer, 1.0e-14);
}

fn assert_gain_ramp_outputs_match(samples: usize) {
    let mut current = GainRamp::new(0.05, 0.95, SAMPLE_RATE, 250);
    let mut legacy = LegacyGainRamp::new(0.05, 0.95, SAMPLE_RATE, 250);
    for idx in 0..samples {
        let current_gain = current.next_gain();
        let legacy_gain = legacy.next_gain();
        assert!(
            (current_gain - legacy_gain).abs() <= 1.0e-12,
            "GainRamp mismatch at {idx}: current={current_gain} legacy={legacy_gain}"
        );
    }
}

fn assert_loudness_gain_outputs_match() {
    let current = TrackLoudness::new("bench.wav", -18.0, -1.0, None, -14.0);
    let legacy = LegacyTrackLoudness {
        integrated_lufs: -18.0,
    };
    for target in [-23.0, -18.0, -14.0, -9.0] {
        let current_gain = current.gain_linear(target);
        let legacy_gain = legacy.gain_linear(target);
        assert_eq!(current_gain.to_bits(), legacy_gain.to_bits());
    }
}

fn assert_gain_ramp_block_apply_matches_next_gain_loop(corpus: &[f64]) {
    let mut current = GainRamp::new(0.05, 0.95, SAMPLE_RATE, 250);
    let mut legacy = GainRamp::new(0.05, 0.95, SAMPLE_RATE, 250);
    let mut original = LegacyGainRamp::new(0.05, 0.95, SAMPLE_RATE, 250);
    let mut current_buffer = corpus.to_vec();
    let mut legacy_buffer = corpus.to_vec();
    let mut original_buffer = corpus.to_vec();

    for block in current_buffer.chunks_mut(CALLBACK_FRAMES * CHANNELS) {
        current.apply(block);
    }
    for sample in &mut legacy_buffer {
        *sample *= legacy.next_gain();
    }
    for sample in &mut original_buffer {
        *sample *= original.next_gain();
    }

    assert_max_abs_diff(
        "GainRampBlockApply",
        &current_buffer,
        &legacy_buffer,
        1.0e-12,
    );
    assert_max_abs_diff(
        "GainRampBlockApplyOriginal",
        &current_buffer,
        &original_buffer,
        1.0e-12,
    );
}

fn assert_saturation_outer_dispatch_outputs_match(corpus: &[f64]) {
    let mut current = configured_saturation();
    let candidate = CandidateSaturationOuterDispatch::configured();
    let mut current_buffer = corpus.to_vec();
    let mut outer_dispatch_buffer = corpus.to_vec();
    candidate.process_with_channels(&mut outer_dispatch_buffer, CHANNELS);
    current.process_with_channels(&mut current_buffer, CHANNELS);
    assert_max_abs_diff(
        "SaturationOuterDispatch",
        &outer_dispatch_buffer,
        &current_buffer,
        1.0e-14,
    );
}

fn assert_volume_lazy_settle_close(corpus: &[f64]) {
    let mut current = CurrentVolumeKernel::new(SAMPLE_RATE_F64, 0.25);
    let mut legacy = LegacyExactVolumeKernel::new(SAMPLE_RATE_F64, 0.25);
    let mut original = OriginalExactVolumeKernel::new(SAMPLE_RATE_F64, 0.25);
    let mut current_buffer = corpus.to_vec();
    let mut legacy_buffer = corpus.to_vec();
    let mut original_buffer = corpus.to_vec();
    current.process(&mut current_buffer, CHANNELS);
    legacy.process(&mut legacy_buffer, CHANNELS);
    original.process(&mut original_buffer, CHANNELS);
    assert_max_abs_diff(
        "VolumeLazySettleKernel",
        &current_buffer,
        &legacy_buffer,
        1.0e-6,
    );
    assert_max_abs_diff(
        "VolumeLazySettleOriginalKernel",
        &current_buffer,
        &original_buffer,
        1.0e-6,
    );
}

fn assert_max_abs_diff(name: &str, current: &[f64], legacy: &[f64], tolerance: f64) {
    let max_abs = current
        .iter()
        .zip(legacy)
        .map(|(left, right)| (left - right).abs())
        .fold(0.0, f64::max);
    assert!(
        max_abs <= tolerance,
        "{name} synthetic corpus mismatch max_abs={max_abs:.3e}"
    );
}

struct LegacyNoiseShaper {
    error_history: Vec<[f64; 9]>,
    coeffs: [f64; 9],
    bits: u32,
    rng_state: u64,
}

impl LegacyNoiseShaper {
    fn new(channels: usize, sample_rate: u32, bits: u32) -> Self {
        let curve = if sample_rate <= 50_000 {
            [2.033, -2.165, 1.959, -1.590, 0.6149, 0.0, 0.0, 0.0, 0.0]
        } else {
            [0.0; 9]
        };
        Self {
            error_history: vec![[0.0; 9]; channels],
            coeffs: curve,
            bits: bits.clamp(8, 32),
            rng_state: 0x1234_5678_9ABC_DEF0,
        }
    }

    #[inline(always)]
    fn next_u64(&mut self) -> u64 {
        self.rng_state ^= self.rng_state << 13;
        self.rng_state ^= self.rng_state >> 7;
        self.rng_state ^= self.rng_state << 17;
        self.rng_state
    }

    #[inline(always)]
    fn tpdf(&mut self) -> f64 {
        let r1 = self.next_u64() as f64 / u64::MAX as f64;
        let r2 = self.next_u64() as f64 / u64::MAX as f64;
        r1 - r2
    }

    fn process_sample(&mut self, sample: f64, ch: usize) -> f64 {
        if ch >= self.error_history.len() {
            return sample;
        }

        const SILENCE_THRESHOLD: f64 = 1e-6;
        if sample.abs() < SILENCE_THRESHOLD {
            self.error_history[ch] = [0.0; 9];
            return sample;
        }

        let dither = self.tpdf();
        let e = &mut self.error_history[ch];
        let feedback = self.coeffs[0] * e[0]
            + self.coeffs[1] * e[1]
            + self.coeffs[2] * e[2]
            + self.coeffs[3] * e[3]
            + self.coeffs[4] * e[4]
            + self.coeffs[5] * e[5]
            + self.coeffs[6] * e[6]
            + self.coeffs[7] * e[7]
            + self.coeffs[8] * e[8];

        let scale = 2.0_f64.powi(self.bits as i32 - 1);
        let x = sample * scale + feedback;
        let quantized = (x + dither).round();
        let raw_error = x - quantized;
        let clamped_error = raw_error.clamp(-2.0, 2.0);

        e[8] = e[7];
        e[7] = e[6];
        e[6] = e[5];
        e[5] = e[4];
        e[4] = e[3];
        e[3] = e[2];
        e[2] = e[1];
        e[1] = e[0];
        e[0] = clamped_error;

        quantized * (1.0 / scale)
    }
}

struct Current9TapShiftNoiseShaper {
    error_history: Vec<[f64; 9]>,
    coeffs: [f64; 9],
    scale: f64,
    lsb: f64,
    rng_state: u64,
}

impl Current9TapShiftNoiseShaper {
    fn new(channels: usize, coeffs: [f64; 9], bits: u32) -> Self {
        let scale = 2.0_f64.powi(bits.clamp(8, 32) as i32 - 1);
        Self {
            error_history: vec![[0.0; 9]; channels],
            coeffs,
            scale,
            lsb: 1.0 / scale,
            rng_state: 0x1234_5678_9ABC_DEF0,
        }
    }

    #[inline(always)]
    fn next_u64(&mut self) -> u64 {
        self.rng_state ^= self.rng_state << 13;
        self.rng_state ^= self.rng_state >> 7;
        self.rng_state ^= self.rng_state << 17;
        self.rng_state
    }

    #[inline(always)]
    fn tpdf(&mut self) -> f64 {
        let r1 = self.next_u64() as f64 * BENCH_INV_U64_MAX;
        let r2 = self.next_u64() as f64 * BENCH_INV_U64_MAX;
        r1 - r2
    }

    #[inline(always)]
    fn process_sample(&mut self, sample: f64, ch: usize) -> f64 {
        if ch >= self.error_history.len() {
            return sample;
        }

        const SILENCE_THRESHOLD: f64 = 1e-6;
        if sample.abs() < SILENCE_THRESHOLD {
            self.error_history[ch] = [0.0; 9];
            return sample;
        }

        let dither = self.tpdf();
        let e = &mut self.error_history[ch];
        let feedback = self.coeffs[0] * e[0]
            + self.coeffs[1] * e[1]
            + self.coeffs[2] * e[2]
            + self.coeffs[3] * e[3]
            + self.coeffs[4] * e[4]
            + self.coeffs[5] * e[5]
            + self.coeffs[6] * e[6]
            + self.coeffs[7] * e[7]
            + self.coeffs[8] * e[8];
        let x = sample * self.scale + feedback;
        let quantized = (x + dither).round();
        let clamped_error = (x - quantized).clamp(-2.0, 2.0);

        e[8] = e[7];
        e[7] = e[6];
        e[6] = e[5];
        e[5] = e[4];
        e[4] = e[3];
        e[3] = e[2];
        e[2] = e[1];
        e[1] = e[0];
        e[0] = clamped_error;

        quantized * self.lsb
    }
}

struct DuplicatedRing9TapNoiseShaper {
    history: Vec<[f64; 18]>,
    heads: Vec<usize>,
    coeffs: [f64; 9],
    scale: f64,
    lsb: f64,
    rng_state: u64,
}

impl DuplicatedRing9TapNoiseShaper {
    fn new(channels: usize, coeffs: [f64; 9], bits: u32) -> Self {
        let scale = 2.0_f64.powi(bits.clamp(8, 32) as i32 - 1);
        Self {
            history: vec![[0.0; 18]; channels],
            heads: vec![0; channels],
            coeffs,
            scale,
            lsb: 1.0 / scale,
            rng_state: 0x1234_5678_9ABC_DEF0,
        }
    }

    #[inline(always)]
    fn next_u64(&mut self) -> u64 {
        self.rng_state ^= self.rng_state << 13;
        self.rng_state ^= self.rng_state >> 7;
        self.rng_state ^= self.rng_state << 17;
        self.rng_state
    }

    #[inline(always)]
    fn tpdf(&mut self) -> f64 {
        let r1 = self.next_u64() as f64 * BENCH_INV_U64_MAX;
        let r2 = self.next_u64() as f64 * BENCH_INV_U64_MAX;
        r1 - r2
    }

    #[inline(always)]
    fn process_sample(&mut self, sample: f64, ch: usize) -> f64 {
        if ch >= self.history.len() {
            return sample;
        }

        const SILENCE_THRESHOLD: f64 = 1e-6;
        if sample.abs() < SILENCE_THRESHOLD {
            self.history[ch] = [0.0; 18];
            self.heads[ch] = 0;
            return sample;
        }

        let dither = self.tpdf();
        let head = self.heads[ch];
        let e = &mut self.history[ch];
        let feedback = e[head] * self.coeffs[0]
            + e[head + 1] * self.coeffs[1]
            + e[head + 2] * self.coeffs[2]
            + e[head + 3] * self.coeffs[3]
            + e[head + 4] * self.coeffs[4]
            + e[head + 5] * self.coeffs[5]
            + e[head + 6] * self.coeffs[6]
            + e[head + 7] * self.coeffs[7]
            + e[head + 8] * self.coeffs[8];
        let x = sample * self.scale + feedback;
        let quantized = (x + dither).round();
        let clamped_error = (x - quantized).clamp(-2.0, 2.0);

        let next_head = if head == 0 { 8 } else { head - 1 };
        e[next_head] = clamped_error;
        e[next_head + 9] = clamped_error;
        self.heads[ch] = next_head;

        quantized * self.lsb
    }
}

struct LegacyVolumeController {
    current: f64,
    target: f64,
    smoothing: f64,
}

impl LegacyVolumeController {
    fn with_sample_rate(sample_rate: u32) -> Self {
        let smoothing_samples = 0.02 * sample_rate as f64;
        Self {
            current: 1.0,
            target: 1.0,
            smoothing: (-1.0 / smoothing_samples).exp(),
        }
    }

    fn set_target(&mut self, volume: f64) {
        self.target = volume.clamp(0.0, 1.0);
    }

    fn next_volume(&mut self) -> f64 {
        self.current += (self.target - self.current) * (1.0 - self.smoothing);
        self.current
    }

    fn process(&mut self, buffer: &mut [f64], channels: usize) {
        let frames = buffer.len() / channels;
        for frame in 0..frames {
            let vol = self.next_volume();
            for ch in 0..channels {
                buffer[frame * channels + ch] *= vol;
            }
        }
    }
}

struct LegacyVolumeProcessor {
    current_volume: f64,
    target: f64,
    smoothing_coeff: f64,
}

impl LegacyVolumeProcessor {
    fn new(sample_rate: f64, target: f64) -> Self {
        let smoothing_samples = 0.005 * sample_rate;
        Self {
            current_volume: 1.0,
            target,
            smoothing_coeff: (-1.0 / smoothing_samples).exp(),
        }
    }

    fn process(&mut self, buffer: &mut [f64], channels: usize) {
        let frames = buffer.len() / channels;
        for frame in 0..frames {
            self.current_volume +=
                (self.target - self.current_volume) * (1.0 - self.smoothing_coeff);
            for ch in 0..channels {
                buffer[frame * channels + ch] *= self.current_volume;
            }
        }
    }

    fn reset(&mut self) {
        self.current_volume = self.target;
    }
}

struct LegacySaturation {
    sat_type: SaturationType,
    drive: f64,
    threshold: f64,
    mix: f64,
    input_gain_db: f64,
    output_gain_db: f64,
    enabled: bool,
    highpass_mode: bool,
}

impl LegacySaturation {
    fn configured() -> Self {
        Self {
            sat_type: SaturationType::Tube,
            drive: 1.35,
            threshold: 0.18,
            mix: 0.72,
            input_gain_db: 3.0,
            output_gain_db: -1.5,
            enabled: true,
            highpass_mode: false,
        }
    }

    fn process_with_channels(&self, samples: &mut [f64], _channels: usize) {
        if !self.enabled {
            return;
        }

        if self.highpass_mode {
            unreachable!("derived constants benchmark only covers full-band saturation");
        } else {
            self.process_fullband(samples);
        }
    }

    fn process_fullband(&self, samples: &mut [f64]) {
        for sample in samples.iter_mut() {
            let dry = *sample * db_to_linear(self.input_gain_db);

            if dry.abs() > self.threshold {
                let driven = dry * (1.0 + self.drive);
                let saturated = apply_saturation_type(self.sat_type, driven);
                *sample = (dry * (1.0 - self.mix) + saturated * self.mix)
                    * db_to_linear(self.output_gain_db);
            } else {
                *sample = dry;
            }
        }
    }
}

struct LegacyGainRamp {
    from: f64,
    to: f64,
    total_samples: usize,
    remaining: usize,
}

impl LegacyGainRamp {
    fn new(from: f64, to: f64, sample_rate: u32, ramp_ms: u32) -> Self {
        let total_samples = (sample_rate as u64 * ramp_ms as u64 / 1000) as usize;
        let total_samples = total_samples.max(1);
        Self {
            from,
            to,
            total_samples,
            remaining: total_samples,
        }
    }

    fn next_gain(&mut self) -> f64 {
        if self.remaining > 0 {
            let progress = (self.total_samples - self.remaining) as f64 / self.total_samples as f64;
            let gain = self.from + (self.to - self.from) * progress;
            self.remaining -= 1;
            gain
        } else {
            self.to
        }
    }
}

struct LegacyTrackLoudness {
    integrated_lufs: f64,
}

struct CandidateSaturationOuterDispatch {
    sat_type: SaturationType,
    drive: f64,
    threshold: f64,
    mix: f64,
    input_gain: f64,
    output_gain: f64,
    enabled: bool,
    highpass_mode: bool,
}

impl CandidateSaturationOuterDispatch {
    fn configured() -> Self {
        Self {
            sat_type: SaturationType::Tube,
            drive: 1.35,
            threshold: 0.18,
            mix: 0.72,
            input_gain: db_to_linear(3.0),
            output_gain: db_to_linear(-1.5),
            enabled: true,
            highpass_mode: false,
        }
    }

    fn process_with_channels(&self, samples: &mut [f64], _channels: usize) {
        if !self.enabled {
            return;
        }
        if self.highpass_mode {
            unreachable!("derived constants benchmark only covers full-band saturation");
        }

        let input_gain = self.input_gain;
        let output_gain = self.output_gain;
        let threshold = self.threshold;
        let drive_plus1 = 1.0 + self.drive;
        let mix = self.mix;
        let one_minus_mix = 1.0 - mix;

        match self.sat_type {
            SaturationType::Tape => {
                for sample in samples.iter_mut() {
                    let dry = *sample * input_gain;

                    if dry.abs() > threshold {
                        let driven = dry * drive_plus1;
                        let saturated = driven.signum() * (1.0 - (-driven.abs()).exp());
                        *sample = (dry * one_minus_mix + saturated * mix) * output_gain;
                    } else {
                        *sample = dry;
                    }
                }
            }
            SaturationType::Tube => {
                for sample in samples.iter_mut() {
                    let dry = *sample * input_gain;
                    if dry.abs() > threshold {
                        let saturated = (dry * drive_plus1).tanh();
                        *sample = (dry * one_minus_mix + saturated * mix) * output_gain;
                    } else {
                        *sample = dry;
                    }
                }
            }
            SaturationType::Transistor => {
                for sample in samples.iter_mut() {
                    let dry = *sample * input_gain;
                    if dry.abs() > threshold {
                        let driven = dry * drive_plus1;
                        let saturated = if driven.abs() <= 1.5 {
                            driven - (driven * driven * driven) / 3.0
                        } else {
                            driven.signum() * 0.375
                        };
                        *sample = (dry * one_minus_mix + saturated * mix) * output_gain;
                    } else {
                        *sample = dry;
                    }
                }
            }
        }
    }
}

struct LegacyExactVolumeKernel {
    current_volume: f64,
    target: f64,
    one_minus_smoothing_coeff: f64,
}

impl LegacyExactVolumeKernel {
    fn new(sample_rate: f64, target: f64) -> Self {
        let smoothing_coeff = (-1.0 / (0.005 * sample_rate)).exp();
        Self {
            current_volume: 1.0,
            target,
            one_minus_smoothing_coeff: 1.0 - smoothing_coeff,
        }
    }

    fn process(&mut self, buffer: &mut [f64], channels: usize) {
        let target = self.target;
        let one_minus_coeff = self.one_minus_smoothing_coeff;
        let mut current_volume = self.current_volume;
        let frames = buffer.len() / channels;

        for frame in 0..frames {
            current_volume += (target - current_volume) * one_minus_coeff;
            for ch in 0..channels {
                buffer[frame * channels + ch] *= current_volume;
            }
        }
        self.current_volume = current_volume;
    }
}

struct OriginalExactVolumeKernel {
    current_volume: f64,
    target: f64,
    smoothing_coeff: f64,
}

impl OriginalExactVolumeKernel {
    fn new(sample_rate: f64, target: f64) -> Self {
        let smoothing_coeff = (-1.0 / (0.005 * sample_rate)).exp();
        Self {
            current_volume: 1.0,
            target,
            smoothing_coeff,
        }
    }

    fn process(&mut self, buffer: &mut [f64], channels: usize) {
        let target = self.target;
        let smoothing_coeff = self.smoothing_coeff;
        let frames = buffer.len() / channels;

        for frame in 0..frames {
            self.current_volume += (target - self.current_volume) * (1.0 - smoothing_coeff);
            for ch in 0..channels {
                buffer[frame * channels + ch] *= self.current_volume;
            }
        }
    }
}

struct CurrentVolumeKernel {
    current_volume: f64,
    target: f64,
    one_minus_smoothing_coeff: f64,
}

impl CurrentVolumeKernel {
    fn new(sample_rate: f64, target: f64) -> Self {
        let smoothing_coeff = (-1.0 / (0.005 * sample_rate)).exp();
        Self {
            current_volume: 1.0,
            target,
            one_minus_smoothing_coeff: 1.0 - smoothing_coeff,
        }
    }

    fn process(&mut self, buffer: &mut [f64], channels: usize) {
        const SETTLE_EPSILON: f64 = 1.0e-6;
        let target = self.target;
        let one_minus_coeff = self.one_minus_smoothing_coeff;
        let mut current_volume = self.current_volume;
        let frames = buffer.len() / channels;
        let mut frame = 0;

        while frame < frames {
            if (target - current_volume).abs() <= SETTLE_EPSILON {
                current_volume = target;
                break;
            }
            current_volume += (target - current_volume) * one_minus_coeff;
            for ch in 0..channels {
                buffer[frame * channels + ch] *= current_volume;
            }
            frame += 1;
        }

        if frame < frames && target != 1.0 {
            for sample in &mut buffer[(frame * channels)..] {
                *sample *= target;
            }
        }

        self.current_volume = current_volume;
    }
}

impl LegacyTrackLoudness {
    fn gain_linear(&self, target_lufs: f64) -> f32 {
        let gain_db = target_lufs - self.integrated_lufs;
        10.0_f64.powf(gain_db / 20.0) as f32
    }
}

fn db_to_linear(db: f64) -> f64 {
    10.0_f64.powf(db / 20.0)
}

fn apply_saturation_type(sat_type: SaturationType, x: f64) -> f64 {
    match sat_type {
        SaturationType::Tape => x.signum() * (1.0 - (-x.abs()).exp()),
        SaturationType::Tube => x.tanh(),
        SaturationType::Transistor => {
            if x.abs() <= 1.5 {
                x - (x * x * x) / 3.0
            } else {
                x.signum() * 0.375
            }
        }
    }
}

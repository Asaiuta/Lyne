use std::hint::black_box;
use std::time::{Duration, Instant};

const CHANNELS: usize = 2;
const SAMPLE_RATE: f64 = 48_000.0;
const BLOCK_SIZE: usize = 64;
const EQ_BANDS: usize = 10;
const LOUDNESS_BANDS_N: usize = 7;
const GAIN_UPDATE_EPSILON_DB: f64 = 0.01;
const BAND_ACTIVE_EPSILON_DB: f64 = 0.0001;
const LOUDNESS_BANDS: [(f64, f64, f64); LOUDNESS_BANDS_N] = [
    (40.0, 12.0, 0.0),
    (100.0, 10.0, 0.9),
    (300.0, 4.0, 1.0),
    (1000.0, 0.0, 1.0),
    (3000.0, 2.0, 0.9),
    (8000.0, 4.0, 0.8),
    (12000.0, 6.0, 0.0),
];

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let quick = args.iter().any(|arg| arg == "--quick");
    let enforce = args.iter().any(|arg| arg == "--enforce");
    let iterations = if quick { 12 } else { 80 };
    let coeff_iterations = if quick { 80_000 } else { 600_000 };
    let frames = if quick { 12_000 } else { 48_000 };
    let corpus = synthetic_corpus(frames, CHANNELS);

    println!("audio_biquad_perf frames={frames} iterations={iterations}");

    let eq_report = benchmark_eq(&corpus, iterations);
    println!(
        "eq_flatten current={:.3} ns/sample legacy_vec_vec={:.3} ns/sample improvement={:.2}%",
        eq_report.current_ns_per_sample,
        eq_report.legacy_ns_per_sample,
        eq_report.improvement_percent
    );
    println!(
        "eq_settled_stereo_fast_delta current={:.3} ns/sample previous_flat={:.3} ns/sample improvement={:.2}%",
        eq_report.current_ns_per_sample,
        eq_report.previous_flat_ns_per_sample,
        eq_report.previous_flat_improvement_percent
    );
    if enforce {
        assert!(
            eq_report.improvement_percent >= 10.0,
            "EQ flatten improvement below 10%: {:.2}%",
            eq_report.improvement_percent
        );
    }

    let coeff_report = benchmark_coefficients(coeff_iterations);
    println!(
        "dynamic_coeff_cache cached={:.3} ns/update legacy_trig={:.3} ns/update speedup={:.2}x",
        coeff_report.cached_ns_per_update, coeff_report.legacy_ns_per_update, coeff_report.speedup
    );
    if enforce {
        assert!(
            coeff_report.speedup >= 4.0,
            "coefficient cache speedup below 4x: {:.2}x",
            coeff_report.speedup
        );
    }

    let dl_transitioning_report = benchmark_dynamic_loudness(
        &corpus,
        iterations,
        DynamicLoudnessScenario::TransitioningLowVolume,
    );
    println!(
        "dynamic_loudness_process_transitioning current={:.3} ns/sample legacy_trig={:.3} ns/sample improvement={:.2}%",
        dl_transitioning_report.current_ns_per_sample,
        dl_transitioning_report.legacy_ns_per_sample,
        dl_transitioning_report.improvement_percent
    );
    println!(
        "dynamic_loudness_active_index_transitioning candidate={:.3} ns/sample current={:.3} ns/sample improvement={:.2}%",
        dl_transitioning_report.candidate_ns_per_sample,
        dl_transitioning_report.current_ns_per_sample,
        dl_transitioning_report.candidate_improvement_percent
    );

    let dl_max_active_report = benchmark_dynamic_loudness(
        &corpus,
        iterations,
        DynamicLoudnessScenario::MaxActiveSettled,
    );
    println!(
        "dynamic_loudness_process_max_active current={:.3} ns/sample legacy_trig={:.3} ns/sample improvement={:.2}%",
        dl_max_active_report.current_ns_per_sample,
        dl_max_active_report.legacy_ns_per_sample,
        dl_max_active_report.improvement_percent
    );
    println!(
        "dynamic_loudness_active_index_max_active candidate={:.3} ns/sample current={:.3} ns/sample improvement={:.2}%",
        dl_max_active_report.candidate_ns_per_sample,
        dl_max_active_report.current_ns_per_sample,
        dl_max_active_report.candidate_improvement_percent
    );

    let dl_identity_report = benchmark_dynamic_loudness(
        &corpus,
        iterations,
        DynamicLoudnessScenario::IdentitySettled,
    );
    println!(
        "dynamic_loudness_process_identity current={:.3} ns/sample legacy_trig={:.3} ns/sample improvement={:.2}%",
        dl_identity_report.current_ns_per_sample,
        dl_identity_report.legacy_ns_per_sample,
        dl_identity_report.improvement_percent
    );
    println!(
        "dynamic_loudness_active_index_identity candidate={:.3} ns/sample current={:.3} ns/sample improvement={:.2}%",
        dl_identity_report.candidate_ns_per_sample,
        dl_identity_report.current_ns_per_sample,
        dl_identity_report.candidate_improvement_percent
    );
    if enforce {
        assert!(
            dl_max_active_report.improvement_percent >= 3.0,
            "DynamicLoudness process improvement below 3%: {:.2}%",
            dl_max_active_report.improvement_percent
        );
    }
}

#[derive(Debug)]
struct EqReport {
    current_ns_per_sample: f64,
    legacy_ns_per_sample: f64,
    previous_flat_ns_per_sample: f64,
    improvement_percent: f64,
    previous_flat_improvement_percent: f64,
}

#[derive(Debug)]
struct CoeffReport {
    cached_ns_per_update: f64,
    legacy_ns_per_update: f64,
    speedup: f64,
}

#[derive(Debug)]
struct ProcessReport {
    current_ns_per_sample: f64,
    legacy_ns_per_sample: f64,
    candidate_ns_per_sample: f64,
    improvement_percent: f64,
    candidate_improvement_percent: f64,
}

#[derive(Clone, Copy)]
enum DynamicLoudnessScenario {
    TransitioningLowVolume,
    MaxActiveSettled,
    IdentitySettled,
}

fn benchmark_eq(corpus: &[f64], iterations: usize) -> EqReport {
    let gains = [12.0, 9.0, 6.0, 3.0, -3.0, -6.0, -9.0, -12.0, 6.0, -6.0];

    let mut current_check = prepared_flat_eq(&gains);
    let mut legacy_check = prepared_legacy_eq(&gains);
    assert_eq_outputs_match(&mut current_check, &mut legacy_check, corpus);

    let mut current_previous_check = prepared_flat_eq(&gains);
    let mut previous_flat_check = prepared_flat_eq(&gains);
    assert_eq_previous_outputs_match(
        &mut current_previous_check,
        &mut previous_flat_check,
        corpus,
    );

    let mut current = prepared_flat_eq(&gains);
    let mut legacy = prepared_legacy_eq(&gains);
    let mut previous_flat = prepared_flat_eq(&gains);

    let current_duration = measure(
        || {
            let mut buffer = corpus.to_vec();
            current.process(black_box(&mut buffer));
            black_box(buffer[0])
        },
        iterations,
    );

    let previous_flat_duration = measure(
        || {
            let mut buffer = corpus.to_vec();
            previous_flat.process_without_fast_path(black_box(&mut buffer));
            black_box(buffer[0])
        },
        iterations,
    );

    let legacy_duration = measure(
        || {
            let mut buffer = corpus.to_vec();
            legacy.process(black_box(&mut buffer));
            black_box(buffer[0])
        },
        iterations,
    );

    let samples = corpus.len() * iterations;
    let current_ns_per_sample = nanos_per_unit(current_duration, samples);
    let legacy_ns_per_sample = nanos_per_unit(legacy_duration, samples);
    let previous_flat_ns_per_sample = nanos_per_unit(previous_flat_duration, samples);
    EqReport {
        current_ns_per_sample,
        legacy_ns_per_sample,
        previous_flat_ns_per_sample,
        improvement_percent: (legacy_ns_per_sample - current_ns_per_sample) / legacy_ns_per_sample
            * 100.0,
        previous_flat_improvement_percent: (previous_flat_ns_per_sample - current_ns_per_sample)
            / previous_flat_ns_per_sample
            * 100.0,
    }
}

fn benchmark_coefficients(iterations: usize) -> CoeffReport {
    let gains = [-20.0, -12.0, -6.0, 0.0, 6.0, 12.0, 20.0];
    let mut cached = CachedBenchFilter::peaking(1000.0, 0.0, 1.0, SAMPLE_RATE);
    let mut legacy = LegacyDynFilter::peaking(1000.0, 0.0, 1.0, SAMPLE_RATE);

    let cached_duration = measure(
        || {
            for i in 0..gains.len() {
                cached.set_gain_db(black_box(gains[i]));
            }
            black_box(cached.coeffs.b0)
        },
        iterations,
    );

    let legacy_duration = measure(
        || {
            for i in 0..gains.len() {
                legacy.set_gain_db(black_box(gains[i]));
            }
            black_box(legacy.coeffs.b0)
        },
        iterations,
    );

    let updates = iterations * gains.len();
    let cached_ns_per_update = nanos_per_unit(cached_duration, updates);
    let legacy_ns_per_update = nanos_per_unit(legacy_duration, updates);

    CoeffReport {
        cached_ns_per_update,
        legacy_ns_per_update,
        speedup: legacy_ns_per_update / cached_ns_per_update,
    }
}

fn benchmark_dynamic_loudness(
    corpus: &[f64],
    iterations: usize,
    scenario: DynamicLoudnessScenario,
) -> ProcessReport {
    let mut current_check = CachedDynamicLoudness::new(CHANNELS, SAMPLE_RATE);
    let mut legacy_check = LegacyDynamicLoudness::new(CHANNELS, SAMPLE_RATE);
    configure_dynamic_scenario(&mut current_check, &mut legacy_check, scenario);
    assert_dynamic_outputs_match(&mut current_check, &mut legacy_check, corpus);

    let mut current_candidate_check = CachedDynamicLoudness::new(CHANNELS, SAMPLE_RATE);
    configure_cached_dynamic_scenario(&mut current_candidate_check, scenario);
    let mut candidate_check = CachedDynamicLoudness::new(CHANNELS, SAMPLE_RATE);
    configure_cached_dynamic_scenario(&mut candidate_check, scenario);
    assert_dynamic_candidate_outputs_match(
        &mut current_candidate_check,
        &mut candidate_check,
        corpus,
    );

    let mut current = CachedDynamicLoudness::new(CHANNELS, SAMPLE_RATE);
    configure_cached_dynamic_scenario(&mut current, scenario);
    let mut legacy = LegacyDynamicLoudness::new(CHANNELS, SAMPLE_RATE);
    configure_legacy_dynamic_scenario(&mut legacy, scenario);
    let mut candidate = CachedDynamicLoudness::new(CHANNELS, SAMPLE_RATE);
    configure_cached_dynamic_scenario(&mut candidate, scenario);

    let current_duration = measure(
        || {
            let mut buffer = corpus.to_vec();
            current.process(black_box(&mut buffer));
            black_box(buffer[0])
        },
        iterations,
    );

    let candidate_duration = measure(
        || {
            let mut buffer = corpus.to_vec();
            candidate.process_active_index_candidate(black_box(&mut buffer));
            black_box(buffer[0])
        },
        iterations,
    );

    let legacy_duration = measure(
        || {
            let mut buffer = corpus.to_vec();
            legacy.process(black_box(&mut buffer));
            black_box(buffer[0])
        },
        iterations,
    );

    report_process_with_candidate(
        current_duration,
        legacy_duration,
        candidate_duration,
        corpus.len() * iterations,
    )
}

fn configure_dynamic_scenario(
    current: &mut CachedDynamicLoudness,
    legacy: &mut LegacyDynamicLoudness,
    scenario: DynamicLoudnessScenario,
) {
    configure_cached_dynamic_scenario(current, scenario);
    configure_legacy_dynamic_scenario(legacy, scenario);
}

fn configure_cached_dynamic_scenario(
    current: &mut CachedDynamicLoudness,
    scenario: DynamicLoudnessScenario,
) {
    match scenario {
        DynamicLoudnessScenario::TransitioningLowVolume => {
            current.set_volume_db(-40.0);
        }
        DynamicLoudnessScenario::MaxActiveSettled => {
            current.set_volume_db(-40.0);
            settle_cached_dynamic_loudness(current);
            assert_eq!(current.active_band_count(), LOUDNESS_BANDS_N - 1);
        }
        DynamicLoudnessScenario::IdentitySettled => {
            current.set_volume_db(-15.0);
            settle_cached_dynamic_loudness(current);
            assert_eq!(current.active_band_count(), 0);
        }
    }
}

fn configure_legacy_dynamic_scenario(
    legacy: &mut LegacyDynamicLoudness,
    scenario: DynamicLoudnessScenario,
) {
    match scenario {
        DynamicLoudnessScenario::TransitioningLowVolume => {
            legacy.set_volume_db(-40.0);
        }
        DynamicLoudnessScenario::MaxActiveSettled => {
            legacy.set_volume_db(-40.0);
            settle_legacy_dynamic_loudness(legacy);
        }
        DynamicLoudnessScenario::IdentitySettled => {
            legacy.set_volume_db(-15.0);
            settle_legacy_dynamic_loudness(legacy);
        }
    }
}

#[allow(dead_code)]
fn settle_dynamic_loudness(
    current: &mut CachedDynamicLoudness,
    legacy: &mut LegacyDynamicLoudness,
) {
    settle_cached_dynamic_loudness(current);
    settle_legacy_dynamic_loudness(legacy);
}

fn settle_cached_dynamic_loudness(current: &mut CachedDynamicLoudness) {
    let mut silence = vec![0.0; CHANNELS * 48_000];
    current.process(&mut silence);
}

fn settle_legacy_dynamic_loudness(legacy: &mut LegacyDynamicLoudness) {
    let mut silence = vec![0.0; CHANNELS * 48_000];
    legacy.process(&mut silence);
}

fn measure<T>(mut run: impl FnMut() -> T, iterations: usize) -> Duration {
    let start = Instant::now();
    for _ in 0..iterations {
        black_box(run());
    }
    start.elapsed()
}

#[allow(dead_code)]
fn report_process(current: Duration, legacy: Duration, samples: usize) -> ProcessReport {
    report_process_with_candidate(current, legacy, current, samples)
}

fn report_process_with_candidate(
    current: Duration,
    legacy: Duration,
    candidate: Duration,
    samples: usize,
) -> ProcessReport {
    let current_ns_per_sample = nanos_per_unit(current, samples);
    let legacy_ns_per_sample = nanos_per_unit(legacy, samples);
    let candidate_ns_per_sample = nanos_per_unit(candidate, samples);
    ProcessReport {
        current_ns_per_sample,
        legacy_ns_per_sample,
        candidate_ns_per_sample,
        improvement_percent: (legacy_ns_per_sample - current_ns_per_sample) / legacy_ns_per_sample
            * 100.0,
        candidate_improvement_percent: (current_ns_per_sample - candidate_ns_per_sample)
            / current_ns_per_sample
            * 100.0,
    }
}

fn nanos_per_unit(duration: Duration, units: usize) -> f64 {
    duration.as_nanos() as f64 / units as f64
}

fn synthetic_corpus(frames: usize, channels: usize) -> Vec<f64> {
    let mut seed = 0x1234_5678_u64;
    let mut out = Vec::with_capacity(frames * channels);

    for frame in 0..frames {
        let t = frame as f64 / SAMPLE_RATE;
        let sweep_hz = 20.0 * (1000.0_f64).powf(frame as f64 / frames as f64);
        let sine = (2.0 * std::f64::consts::PI * sweep_hz * t).sin() * 0.35;
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        let white = (((seed >> 33) as f64 / u32::MAX as f64) * 2.0 - 1.0) * 0.05;
        let sample = sine + white;

        for ch in 0..channels {
            let pan = if ch == 0 { 0.97 } else { 1.03 };
            out.push(sample * pan);
        }
    }

    out
}

fn settle_current_eq(eq: &mut FlatEqualizer) {
    let mut silence = vec![0.0; CHANNELS * 2048];
    eq.process(&mut silence);
}

fn prepared_flat_eq(gains: &[f64; EQ_BANDS]) -> FlatEqualizer {
    let mut eq = FlatEqualizer::new(CHANNELS, SAMPLE_RATE);
    eq.set_enabled(true);
    eq.set_all_bands(gains, SAMPLE_RATE);
    settle_current_eq(&mut eq);
    eq
}

fn prepared_legacy_eq(gains: &[f64; EQ_BANDS]) -> LegacyEqualizer {
    let mut eq = LegacyEqualizer::new(CHANNELS, SAMPLE_RATE);
    eq.set_enabled(true);
    eq.set_all_bands(gains, SAMPLE_RATE);
    eq.settle();
    eq
}

fn assert_eq_outputs_match(
    current: &mut FlatEqualizer,
    legacy: &mut LegacyEqualizer,
    corpus: &[f64],
) {
    let mut current_buffer = corpus.to_vec();
    let mut legacy_buffer = corpus.to_vec();
    current.process(&mut current_buffer);
    legacy.process(&mut legacy_buffer);

    let max_abs = max_abs_diff(&current_buffer, &legacy_buffer);
    assert!(
        max_abs <= 1e-12,
        "EQ synthetic corpus mismatch max_abs={:.3e}",
        max_abs,
    );
}

fn assert_eq_previous_outputs_match(
    current: &mut FlatEqualizer,
    previous_flat: &mut FlatEqualizer,
    corpus: &[f64],
) {
    let mut current_buffer = corpus.to_vec();
    let mut previous_flat_buffer = corpus.to_vec();
    current.process(&mut current_buffer);
    previous_flat.process_without_fast_path(&mut previous_flat_buffer);

    let max_abs = max_abs_diff(&current_buffer, &previous_flat_buffer);
    assert!(
        max_abs <= 1e-12,
        "EQ previous-flat corpus mismatch max_abs={:.3e}",
        max_abs,
    );
}

fn assert_dynamic_outputs_match(
    current: &mut CachedDynamicLoudness,
    legacy: &mut LegacyDynamicLoudness,
    corpus: &[f64],
) {
    let mut current_buffer = corpus.to_vec();
    let mut legacy_buffer = corpus.to_vec();
    current.process(&mut current_buffer);
    legacy.process(&mut legacy_buffer);

    let max_abs = max_abs_diff(&current_buffer, &legacy_buffer);
    assert!(
        max_abs <= 1.0e-3,
        "DynamicLoudness synthetic corpus mismatch max_abs={:.3e}",
        max_abs,
    );
}

fn assert_dynamic_candidate_outputs_match(
    current: &mut CachedDynamicLoudness,
    candidate: &mut CachedDynamicLoudness,
    corpus: &[f64],
) {
    let mut current_buffer = corpus.to_vec();
    let mut candidate_buffer = corpus.to_vec();
    current.process(&mut current_buffer);
    candidate.process_active_index_candidate(&mut candidate_buffer);

    let max_abs = max_abs_diff(&current_buffer, &candidate_buffer);
    assert!(
        max_abs <= 1e-12,
        "DynamicLoudness candidate corpus mismatch max_abs={:.3e}",
        max_abs,
    );
}

fn max_abs_diff(left: &[f64], right: &[f64]) -> f64 {
    left.iter()
        .zip(right)
        .map(|(a, b)| (a - b).abs())
        .fold(0.0, f64::max)
}

#[derive(Clone)]
struct LegacyEqSection {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}

impl LegacyEqSection {
    fn peaking_eq(freq: f64, gain_db: f64, q: f64, sample_rate: f64) -> Self {
        let a = 10.0_f64.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f64::consts::PI * freq / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let alpha = sin_w0 / (2.0 * q);

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos_w0;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha / a;

        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    #[inline]
    fn process(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }

    fn copy_coefficients_from(&mut self, other: &Self) {
        self.b0 = other.b0;
        self.b1 = other.b1;
        self.b2 = other.b2;
        self.a1 = other.a1;
        self.a2 = other.a2;
    }
}

struct LegacyEqualizer {
    bands: Vec<Vec<LegacyEqSection>>,
    target_bands: Vec<Vec<LegacyEqSection>>,
    smooth_counter: Vec<u32>,
    channels: usize,
    enabled: bool,
}

struct FlatEqualizer {
    bands: Vec<[LegacyEqSection; EQ_BANDS]>,
    target_bands: Vec<[LegacyEqSection; EQ_BANDS]>,
    smooth_counter: Vec<u32>,
    channels: usize,
    enabled: bool,
}

impl FlatEqualizer {
    const FREQUENCIES: [f64; EQ_BANDS] = LegacyEqualizer::FREQUENCIES;
    const Q: f64 = LegacyEqualizer::Q;
    const EQ_SMOOTH_SAMPLES: u32 = LegacyEqualizer::EQ_SMOOTH_SAMPLES;
    const INV_EQ_SMOOTH: f64 = LegacyEqualizer::INV_EQ_SMOOTH;

    fn new(channels: usize, sample_rate: f64) -> Self {
        let bands = (0..channels)
            .map(|_| Self::build_channel_bank(sample_rate))
            .collect::<Vec<_>>();
        let target_bands = bands.clone();
        Self {
            bands,
            target_bands,
            smooth_counter: vec![0; EQ_BANDS],
            channels,
            enabled: false,
        }
    }

    fn build_channel_bank(sample_rate: f64) -> [LegacyEqSection; EQ_BANDS] {
        std::array::from_fn(|idx| {
            LegacyEqSection::peaking_eq(Self::FREQUENCIES[idx], 0.0, Self::Q, sample_rate)
        })
    }

    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    fn set_all_bands(&mut self, gains: &[f64; EQ_BANDS], sample_rate: f64) {
        for (idx, &gain) in gains.iter().enumerate() {
            self.set_band_gain(idx, gain, sample_rate);
        }
    }

    fn set_band_gain(&mut self, band_idx: usize, gain_db: f64, sample_rate: f64) {
        let gain_db = gain_db.clamp(-15.0, 15.0);
        let freq = Self::FREQUENCIES[band_idx];
        for ch in 0..self.channels {
            self.target_bands[ch][band_idx] =
                LegacyEqSection::peaking_eq(freq, gain_db, Self::Q, sample_rate);
        }
        self.smooth_counter[band_idx] = Self::EQ_SMOOTH_SAMPLES;
    }

    fn process(&mut self, buffer: &mut [f64]) {
        if !self.enabled {
            return;
        }
        if self.channels == 2 && self.smooth_counter.iter().all(|&counter| counter == 0) {
            self.process_settled_stereo_fast(buffer);
            return;
        }

        self.process_without_fast_path(buffer);
    }

    fn process_without_fast_path(&mut self, buffer: &mut [f64]) {
        let frames = buffer.len() / self.channels;
        for frame in 0..frames {
            for ch in 0..self.channels {
                let idx = frame * self.channels + ch;
                buffer[idx] = self.process_sample_no_counter_update(buffer[idx], ch);
            }
            for b in 0..EQ_BANDS {
                if self.smooth_counter[b] > 0 {
                    self.smooth_counter[b] -= 1;
                    if self.smooth_counter[b] == 0 {
                        for c in 0..self.channels {
                            self.bands[c][b].copy_coefficients_from(&self.target_bands[c][b]);
                        }
                    }
                }
            }
        }
    }

    fn process_settled_stereo_fast(&mut self, buffer: &mut [f64]) {
        if !self.enabled {
            return;
        }
        if self.channels != 2 || self.smooth_counter.iter().any(|&counter| counter > 0) {
            self.process(buffer);
            return;
        }

        let (left_banks, right_banks) = self.bands.split_at_mut(1);
        let left_bands = &mut left_banks[0];
        let right_bands = &mut right_banks[0];

        for frame in buffer.chunks_exact_mut(2) {
            let mut left = frame[0];
            for band in left_bands.iter_mut() {
                left = band.process(left);
            }
            frame[0] = left;

            let mut right = frame[1];
            for band in right_bands.iter_mut() {
                right = band.process(right);
            }
            frame[1] = right;
        }
    }

    fn process_sample_no_counter_update(&mut self, mut sample: f64, ch: usize) -> f64 {
        for b in 0..EQ_BANDS {
            if self.smooth_counter[b] > 0 {
                let current_out = self.bands[ch][b].process(sample);
                let target_out = self.target_bands[ch][b].process(sample);
                let t = self.smooth_counter[b] as f64 * Self::INV_EQ_SMOOTH;
                sample = current_out * t + target_out * (1.0 - t);
            } else {
                sample = self.bands[ch][b].process(sample);
            }
        }
        sample
    }
}

impl LegacyEqualizer {
    const FREQUENCIES: [f64; EQ_BANDS] = [
        31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
    ];
    const Q: f64 = 1.41;
    const EQ_SMOOTH_SAMPLES: u32 = 1024;
    const INV_EQ_SMOOTH: f64 = 1.0 / Self::EQ_SMOOTH_SAMPLES as f64;

    fn new(channels: usize, sample_rate: f64) -> Self {
        let bands = (0..channels)
            .map(|_| Self::build_channel_bank(sample_rate))
            .collect::<Vec<_>>();
        let target_bands = bands.clone();
        Self {
            bands,
            target_bands,
            smooth_counter: vec![0; EQ_BANDS],
            channels,
            enabled: false,
        }
    }

    fn build_channel_bank(sample_rate: f64) -> Vec<LegacyEqSection> {
        Self::FREQUENCIES
            .iter()
            .map(|&freq| LegacyEqSection::peaking_eq(freq, 0.0, Self::Q, sample_rate))
            .collect()
    }

    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    fn set_all_bands(&mut self, gains: &[f64; EQ_BANDS], sample_rate: f64) {
        for (idx, &gain) in gains.iter().enumerate() {
            self.set_band_gain(idx, gain, sample_rate);
        }
    }

    fn set_band_gain(&mut self, band_idx: usize, gain_db: f64, sample_rate: f64) {
        let gain_db = gain_db.clamp(-15.0, 15.0);
        let freq = Self::FREQUENCIES[band_idx];
        for ch in 0..self.channels {
            self.target_bands[ch][band_idx] =
                LegacyEqSection::peaking_eq(freq, gain_db, Self::Q, sample_rate);
        }
        self.smooth_counter[band_idx] = Self::EQ_SMOOTH_SAMPLES;
    }

    fn settle(&mut self) {
        let mut silence = vec![0.0; CHANNELS * 2048];
        self.process(&mut silence);
    }

    fn process(&mut self, buffer: &mut [f64]) {
        if !self.enabled {
            return;
        }
        let frames = buffer.len() / self.channels;
        for frame in 0..frames {
            for ch in 0..self.channels {
                let idx = frame * self.channels + ch;
                buffer[idx] = self.process_sample_no_counter_update(buffer[idx], ch);
            }
            for b in 0..EQ_BANDS {
                if self.smooth_counter[b] > 0 {
                    self.smooth_counter[b] -= 1;
                    if self.smooth_counter[b] == 0 {
                        for c in 0..self.channels {
                            self.bands[c][b].copy_coefficients_from(&self.target_bands[c][b]);
                        }
                    }
                }
            }
        }
    }

    fn process_sample_no_counter_update(&mut self, mut sample: f64, ch: usize) -> f64 {
        for b in 0..EQ_BANDS {
            if self.smooth_counter[b] > 0 {
                let current_out = self.bands[ch][b].process(sample);
                let target_out = self.target_bands[ch][b].process(sample);
                let t = self.smooth_counter[b] as f64 * Self::INV_EQ_SMOOTH;
                sample = current_out * t + target_out * (1.0 - t);
            } else {
                sample = self.bands[ch][b].process(sample);
            }
        }
        sample
    }
}

#[derive(Clone, Copy)]
enum FilterType {
    Peaking,
    LowShelf,
    HighShelf,
}

#[derive(Clone, Default)]
struct DynCoeffs {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
}

#[derive(Clone, Default)]
struct DynState {
    z1: f64,
    z2: f64,
}

#[allow(dead_code)]
#[derive(Clone)]
struct CachedGeometry {
    freq: f64,
    q: f64,
    sample_rate: f64,
    cos_w0: f64,
    sin_w0: f64,
    alpha: f64,
}

impl CachedGeometry {
    fn new(freq: f64, q: f64, sample_rate: f64, filter_type: FilterType) -> Self {
        let w0 = 2.0 * std::f64::consts::PI * freq / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let alpha = match filter_type {
            FilterType::Peaking => sin_w0 / (2.0 * q),
            FilterType::LowShelf | FilterType::HighShelf => sin_w0 / std::f64::consts::SQRT_2,
        };

        Self {
            freq,
            q,
            sample_rate,
            cos_w0,
            sin_w0,
            alpha,
        }
    }
}

#[derive(Clone)]
struct CachedBenchFilter {
    geometry: CachedGeometry,
    coeffs: DynCoeffs,
    state: DynState,
    filter_type: FilterType,
}

impl CachedBenchFilter {
    fn peaking(freq: f64, gain_db: f64, q: f64, sample_rate: f64) -> Self {
        Self::new(freq, gain_db, q, sample_rate, FilterType::Peaking)
    }

    fn new(freq: f64, gain_db: f64, q: f64, sample_rate: f64, filter_type: FilterType) -> Self {
        let geometry = CachedGeometry::new(freq, q, sample_rate, filter_type);
        let mut filter = Self {
            geometry,
            coeffs: DynCoeffs::default(),
            state: DynState::default(),
            filter_type,
        };
        filter.set_gain_db(gain_db);
        filter
    }

    fn set_gain_db(&mut self, gain_db: f64) {
        self.coeffs = match self.filter_type {
            FilterType::Peaking => cached_peaking_coeffs(&self.geometry, gain_db),
            FilterType::LowShelf => cached_low_shelf_coeffs(&self.geometry, gain_db),
            FilterType::HighShelf => cached_high_shelf_coeffs(&self.geometry, gain_db),
        };
    }

    fn coeffs_for_gain(&self, gain_db: f64) -> DynCoeffs {
        match self.filter_type {
            FilterType::Peaking => cached_peaking_coeffs(&self.geometry, gain_db),
            FilterType::LowShelf => cached_low_shelf_coeffs(&self.geometry, gain_db),
            FilterType::HighShelf => cached_high_shelf_coeffs(&self.geometry, gain_db),
        }
    }

    #[inline]
    fn process(&mut self, x: f64) -> f64 {
        let y = self.coeffs.b0 * x + self.state.z1;
        self.state.z1 = self.coeffs.b1 * x - self.coeffs.a1 * y + self.state.z2;
        self.state.z2 = self.coeffs.b2 * x - self.coeffs.a2 * y;
        y
    }
}

fn cached_peaking_coeffs(geometry: &CachedGeometry, gain_db: f64) -> DynCoeffs {
    if gain_db.abs() < 0.0001 {
        return DynCoeffs {
            b0: 1.0,
            ..DynCoeffs::default()
        };
    }

    let a = 10.0_f64.powf(gain_db / 40.0);
    let cos_w0 = geometry.cos_w0;
    let alpha = geometry.alpha;
    let b0 = 1.0 + alpha * a;
    let b1 = -2.0 * cos_w0;
    let b2 = 1.0 - alpha * a;
    let a0 = 1.0 + alpha / a;
    let a1 = -2.0 * cos_w0;
    let a2 = 1.0 - alpha / a;
    DynCoeffs {
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
        a1: a1 / a0,
        a2: a2 / a0,
    }
}

fn cached_low_shelf_coeffs(geometry: &CachedGeometry, gain_db: f64) -> DynCoeffs {
    if gain_db.abs() < 0.0001 {
        return DynCoeffs {
            b0: 1.0,
            ..DynCoeffs::default()
        };
    }

    let a = 10.0_f64.powf(gain_db / 40.0);
    let cos_w0 = geometry.cos_w0;
    let sin_w0 = geometry.sin_w0;
    let alpha = geometry.alpha;
    let beta = 2.0 * a.sqrt() * alpha;
    let b0 = a * ((a + 1.0) - (a - 1.0) * cos_w0 + beta * sin_w0);
    let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0);
    let b2 = a * ((a + 1.0) - (a - 1.0) * cos_w0 - beta * sin_w0);
    let a0 = (a + 1.0) + (a - 1.0) * cos_w0 + beta * sin_w0;
    let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0);
    let a2 = (a + 1.0) + (a - 1.0) * cos_w0 - beta * sin_w0;
    DynCoeffs {
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
        a1: a1 / a0,
        a2: a2 / a0,
    }
}

fn cached_high_shelf_coeffs(geometry: &CachedGeometry, gain_db: f64) -> DynCoeffs {
    if gain_db.abs() < 0.0001 {
        return DynCoeffs {
            b0: 1.0,
            ..DynCoeffs::default()
        };
    }

    let a = 10.0_f64.powf(gain_db / 40.0);
    let cos_w0 = geometry.cos_w0;
    let sin_w0 = geometry.sin_w0;
    let alpha = geometry.alpha;
    let beta = 2.0 * a.sqrt() * alpha;
    let b0 = a * ((a + 1.0) + (a - 1.0) * cos_w0 + beta * sin_w0);
    let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0);
    let b2 = a * ((a + 1.0) + (a - 1.0) * cos_w0 - beta * sin_w0);
    let a0 = (a + 1.0) - (a - 1.0) * cos_w0 + beta * sin_w0;
    let a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos_w0);
    let a2 = (a + 1.0) - (a - 1.0) * cos_w0 - beta * sin_w0;
    DynCoeffs {
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
        a1: a1 / a0,
        a2: a2 / a0,
    }
}

#[derive(Clone)]
struct LegacyDynFilter {
    freq: f64,
    q: f64,
    sample_rate: f64,
    coeffs: DynCoeffs,
    state: DynState,
    filter_type: FilterType,
}

impl LegacyDynFilter {
    fn peaking(freq: f64, gain_db: f64, q: f64, sample_rate: f64) -> Self {
        Self::new(freq, gain_db, q, sample_rate, FilterType::Peaking)
    }

    fn low_shelf(freq: f64, gain_db: f64, sample_rate: f64) -> Self {
        Self::new(freq, gain_db, 0.7, sample_rate, FilterType::LowShelf)
    }

    fn high_shelf(freq: f64, gain_db: f64, sample_rate: f64) -> Self {
        Self::new(freq, gain_db, 0.7, sample_rate, FilterType::HighShelf)
    }

    fn new(freq: f64, gain_db: f64, q: f64, sample_rate: f64, filter_type: FilterType) -> Self {
        let mut filter = Self {
            freq,
            q,
            sample_rate,
            coeffs: DynCoeffs::default(),
            state: DynState::default(),
            filter_type,
        };
        filter.set_gain_db(gain_db);
        filter
    }

    fn set_gain_db(&mut self, gain_db: f64) {
        self.coeffs = match self.filter_type {
            FilterType::Peaking => {
                legacy_peaking_coeffs(self.freq, gain_db, self.q, self.sample_rate)
            }
            FilterType::LowShelf => legacy_low_shelf_coeffs(self.freq, gain_db, self.sample_rate),
            FilterType::HighShelf => legacy_high_shelf_coeffs(self.freq, gain_db, self.sample_rate),
        };
    }

    #[inline]
    fn process(&mut self, x: f64) -> f64 {
        let y = self.coeffs.b0 * x + self.state.z1;
        self.state.z1 = self.coeffs.b1 * x - self.coeffs.a1 * y + self.state.z2;
        self.state.z2 = self.coeffs.b2 * x - self.coeffs.a2 * y;
        y
    }
}

fn legacy_peaking_coeffs(freq: f64, gain_db: f64, q: f64, sample_rate: f64) -> DynCoeffs {
    let geometry = CachedGeometry::new(freq, q, sample_rate, FilterType::Peaking);
    cached_peaking_coeffs(&geometry, gain_db)
}

fn legacy_low_shelf_coeffs(freq: f64, gain_db: f64, sample_rate: f64) -> DynCoeffs {
    let geometry = CachedGeometry::new(freq, 0.7, sample_rate, FilterType::LowShelf);
    cached_low_shelf_coeffs(&geometry, gain_db)
}

fn legacy_high_shelf_coeffs(freq: f64, gain_db: f64, sample_rate: f64) -> DynCoeffs {
    let geometry = CachedGeometry::new(freq, 0.7, sample_rate, FilterType::HighShelf);
    cached_high_shelf_coeffs(&geometry, gain_db)
}

#[derive(Clone)]
struct LegacySmoother {
    current: f64,
    target: f64,
    coeff: f64,
    samples_remaining: usize,
}

impl LegacySmoother {
    fn new(smoothing_time_ms: f64, sample_rate: f64) -> Self {
        let tau = (smoothing_time_ms / 1000.0) * sample_rate;
        let coeff = if tau > 0.0 { (-1.0 / tau).exp() } else { 0.0 };
        Self {
            current: 0.0,
            target: 0.0,
            coeff,
            samples_remaining: 0,
        }
    }

    fn set_target(&mut self, target: f64) {
        self.target = target;
        self.samples_remaining = (SAMPLE_RATE * 0.05) as usize;
    }

    fn next_block(&mut self, block_size: usize) -> f64 {
        if self.samples_remaining == 0 {
            self.current = self.target;
            return self.current;
        }
        let samples = block_size.min(self.samples_remaining);
        for _ in 0..samples {
            self.current = self.target + (self.current - self.target) * self.coeff;
        }
        self.samples_remaining -= samples;
        self.current
    }
}

struct LegacyDynamicLoudness {
    filters: Vec<Vec<LegacyDynFilter>>,
    smoothers: Vec<LegacySmoother>,
    max_gains: [f64; LOUDNESS_BANDS_N],
    ref_volume_db: f64,
    transition_db: f64,
    pre_gain_db: f64,
    channels: usize,
    current_loudness_factor: f64,
    strength: f64,
    enabled: bool,
}

struct CachedDynamicLoudness {
    filters: Vec<[CachedBenchFilter; LOUDNESS_BANDS_N]>,
    smoothers: Vec<LegacySmoother>,
    last_applied_gains: [f64; LOUDNESS_BANDS_N],
    active_bands: [bool; LOUDNESS_BANDS_N],
    max_gains: [f64; LOUDNESS_BANDS_N],
    ref_volume_db: f64,
    transition_db: f64,
    pre_gain_linear: f64,
    channels: usize,
    current_loudness_factor: f64,
    strength: f64,
    enabled: bool,
}

impl CachedDynamicLoudness {
    fn new(channels: usize, sample_rate: f64) -> Self {
        let filters = (0..channels)
            .map(|_| Self::build_channel_filters(sample_rate))
            .collect();
        let smoothers = LOUDNESS_BANDS
            .iter()
            .map(|_| LegacySmoother::new(50.0, sample_rate))
            .collect();
        let max_gains = LOUDNESS_BANDS.map(|(_, max_gain, _)| max_gain);

        Self {
            filters,
            smoothers,
            last_applied_gains: [f64::NAN; LOUDNESS_BANDS_N],
            active_bands: [false; LOUDNESS_BANDS_N],
            max_gains,
            ref_volume_db: -15.0,
            transition_db: 25.0,
            pre_gain_linear: 10.0_f64.powf(-3.0 / 20.0),
            channels,
            current_loudness_factor: 0.0,
            strength: 1.0,
            enabled: true,
        }
    }

    fn build_channel_filters(sample_rate: f64) -> [CachedBenchFilter; LOUDNESS_BANDS_N] {
        std::array::from_fn(|idx| {
            let (freq, _max_gain, q) = LOUDNESS_BANDS[idx];
            if q == 0.0 && freq < 1000.0 {
                CachedBenchFilter::new(freq, 0.0, 0.7, sample_rate, FilterType::LowShelf)
            } else if q == 0.0 {
                CachedBenchFilter::new(freq, 0.0, 0.7, sample_rate, FilterType::HighShelf)
            } else {
                CachedBenchFilter::peaking(freq, 0.0, q, sample_rate)
            }
        })
    }

    fn apply_band_gain_if_changed(&mut self, band: usize, gain_db: f64) {
        let should_be_active = gain_db.abs() >= BAND_ACTIVE_EPSILON_DB;
        if (gain_db - self.last_applied_gains[band]).abs() < GAIN_UPDATE_EPSILON_DB
            && self.active_bands[band] == should_be_active
        {
            return;
        }

        let coeffs = self.filters[0][band].coeffs_for_gain(gain_db);
        for ch_filters in &mut self.filters {
            ch_filters[band].coeffs = coeffs.clone();
        }
        self.last_applied_gains[band] = gain_db;
        self.active_bands[band] = should_be_active;
    }

    fn active_band_count(&self) -> usize {
        self.active_bands.iter().filter(|&&active| active).count()
    }

    fn set_volume_db(&mut self, volume_db: f64) {
        let factor = if volume_db >= self.ref_volume_db {
            0.0
        } else {
            ((self.ref_volume_db - volume_db) / self.transition_db).min(1.0)
        };

        if (self.current_loudness_factor - factor).abs() > 0.0001 {
            self.current_loudness_factor = factor;
            for (i, smoother) in self.smoothers.iter_mut().enumerate() {
                smoother.set_target(self.max_gains[i] * factor * self.strength);
            }
        }
    }

    fn process(&mut self, buffer: &mut [f64]) {
        if !self.enabled || self.strength < 0.0001 {
            return;
        }

        let frames = buffer.len() / self.channels;
        if frames == 0 {
            return;
        }

        for chunk_start in (0..frames).step_by(BLOCK_SIZE) {
            let chunk_end = (chunk_start + BLOCK_SIZE).min(frames);
            let chunk_frames = chunk_end - chunk_start;

            for i in 0..self.smoothers.len() {
                let gain = self.smoothers[i].next_block(chunk_frames);
                self.apply_band_gain_if_changed(i, gain);
            }
        }

        if self.active_bands.iter().all(|&active| !active) {
            for sample in buffer.iter_mut().take(frames * self.channels) {
                *sample *= self.pre_gain_linear;
            }
            return;
        }

        for frame in 0..frames {
            for ch in 0..self.channels {
                let idx = frame * self.channels + ch;
                let mut sample = buffer[idx] * self.pre_gain_linear;
                for band in 0..LOUDNESS_BANDS_N {
                    if self.active_bands[band] {
                        sample = self.filters[ch][band].process(sample);
                    }
                }
                buffer[idx] = sample;
            }
        }
    }

    fn process_active_index_candidate(&mut self, buffer: &mut [f64]) {
        if !self.enabled || self.strength < 0.0001 {
            return;
        }

        let frames = buffer.len() / self.channels;
        if frames == 0 {
            return;
        }

        for chunk_start in (0..frames).step_by(BLOCK_SIZE) {
            let chunk_end = (chunk_start + BLOCK_SIZE).min(frames);
            let chunk_frames = chunk_end - chunk_start;

            for i in 0..self.smoothers.len() {
                let gain = self.smoothers[i].next_block(chunk_frames);
                self.apply_band_gain_if_changed(i, gain);
            }
        }

        let mut active_indices = [0usize; LOUDNESS_BANDS_N];
        let mut active_len = 0usize;
        for (band, &active) in self.active_bands.iter().enumerate() {
            if active {
                active_indices[active_len] = band;
                active_len += 1;
            }
        }

        if active_len == 0 {
            for sample in buffer.iter_mut().take(frames * self.channels) {
                *sample *= self.pre_gain_linear;
            }
            return;
        }

        for frame in 0..frames {
            for ch in 0..self.channels {
                let idx = frame * self.channels + ch;
                let mut sample = buffer[idx] * self.pre_gain_linear;
                let ch_filters = &mut self.filters[ch];
                for &band in active_indices[..active_len].iter() {
                    sample = ch_filters[band].process(sample);
                }
                buffer[idx] = sample;
            }
        }
    }
}

impl LegacyDynamicLoudness {
    fn new(channels: usize, sample_rate: f64) -> Self {
        let filters = (0..channels)
            .map(|_| Self::build_channel_filters(sample_rate))
            .collect();
        let smoothers = LOUDNESS_BANDS
            .iter()
            .map(|_| LegacySmoother::new(50.0, sample_rate))
            .collect();
        let max_gains = LOUDNESS_BANDS.map(|(_, max_gain, _)| max_gain);

        Self {
            filters,
            smoothers,
            max_gains,
            ref_volume_db: -15.0,
            transition_db: 25.0,
            pre_gain_db: -3.0,
            channels,
            current_loudness_factor: 0.0,
            strength: 1.0,
            enabled: true,
        }
    }

    fn build_channel_filters(sample_rate: f64) -> Vec<LegacyDynFilter> {
        LOUDNESS_BANDS
            .iter()
            .map(|&(freq, _max_gain, q)| {
                if q == 0.0 && freq < 1000.0 {
                    LegacyDynFilter::low_shelf(freq, 0.0, sample_rate)
                } else if q == 0.0 {
                    LegacyDynFilter::high_shelf(freq, 0.0, sample_rate)
                } else {
                    LegacyDynFilter::peaking(freq, 0.0, q, sample_rate)
                }
            })
            .collect()
    }

    fn set_volume_db(&mut self, volume_db: f64) {
        let factor = if volume_db >= self.ref_volume_db {
            0.0
        } else {
            ((self.ref_volume_db - volume_db) / self.transition_db).min(1.0)
        };

        if (self.current_loudness_factor - factor).abs() > 0.0001 {
            self.current_loudness_factor = factor;
            for (i, smoother) in self.smoothers.iter_mut().enumerate() {
                smoother.set_target(self.max_gains[i] * factor * self.strength);
            }
        }
    }

    fn process(&mut self, buffer: &mut [f64]) {
        if !self.enabled || self.strength < 0.0001 {
            return;
        }

        let frames = buffer.len() / self.channels;
        if frames == 0 {
            return;
        }

        let pre_gain = if self.pre_gain_db != 0.0 {
            10.0_f64.powf(self.pre_gain_db / 20.0)
        } else {
            1.0
        };

        for chunk_start in (0..frames).step_by(BLOCK_SIZE) {
            let chunk_end = (chunk_start + BLOCK_SIZE).min(frames);
            let chunk_frames = chunk_end - chunk_start;

            for (i, smoother) in self.smoothers.iter_mut().enumerate() {
                let gain = smoother.next_block(chunk_frames);
                for ch_filters in &mut self.filters {
                    ch_filters[i].set_gain_db(gain);
                }
            }
        }

        for frame in 0..frames {
            for ch in 0..self.channels {
                let idx = frame * self.channels + ch;
                let mut sample = buffer[idx] * pre_gain;
                for filter in &mut self.filters[ch] {
                    sample = filter.process(sample);
                }
                buffer[idx] = sample;
            }
        }
    }
}

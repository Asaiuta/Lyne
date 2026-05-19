//! EBU R128 loudness meter and 4x FIR true peak detector.

use crate::processor::dsp::linear_to_db;
use std::sync::OnceLock;

const TRUE_PEAK_PHASES: usize = 4;
const TRUE_PEAK_FIR_TAPS: usize = 64;
const TRUE_PEAK_FIR_MASK: usize = TRUE_PEAK_FIR_TAPS - 1;
const TRUE_PEAK_FIR_BETA: f64 = 8.6;
const TRUE_PEAK_FIR_CUTOFF: f64 = 0.5;

static TRUE_PEAK_FIR: OnceLock<[[f32; TRUE_PEAK_FIR_TAPS]; TRUE_PEAK_PHASES]> = OnceLock::new();

/// EBU R128 loudness meter using the ebur128 crate
/// Measures integrated, short-term, momentary loudness and loudness range
pub struct LoudnessMeter {
    ebur128: Option<ebur128::EbuR128>,
    sample_rate: u32,
    channels: usize,
    // Cached results
    integrated_loudness: f64,
    short_term_loudness: f64,
    momentary_loudness: f64,
    loudness_range: f64,
    true_peak: f64,
    samples_processed: u64,
    // 4x FIR true peak detector (per channel).
    true_peak_detectors: Vec<TruePeakDetector>,
}

impl LoudnessMeter {
    pub fn new(channels: usize, sample_rate: u32) -> Self {
        let ebur128 =
            ebur128::EbuR128::new(channels as u32, sample_rate, ebur128::Mode::all()).ok();

        // Create true peak detector for each channel
        let true_peak_detectors = (0..channels).map(|_| TruePeakDetector::new()).collect();

        Self {
            ebur128,
            sample_rate,
            channels,
            integrated_loudness: -70.0,
            short_term_loudness: -70.0,
            momentary_loudness: -70.0,
            loudness_range: 0.0,
            true_peak: -70.0,
            samples_processed: 0,
            true_peak_detectors,
        }
    }

    /// Reset meter state (call when starting a new track)
    pub fn reset(&mut self) {
        if let Some(ref mut ebur) = self.ebur128 {
            ebur.reset();
        }
        self.integrated_loudness = -70.0;
        self.short_term_loudness = -70.0;
        self.momentary_loudness = -70.0;
        self.loudness_range = 0.0;
        self.true_peak = -70.0;
        self.samples_processed = 0;
        // Reset true peak detectors
        for detector in &mut self.true_peak_detectors {
            detector.reset();
        }
    }

    /// Process interleaved f64 samples
    pub fn process(&mut self, samples: &[f64]) {
        let Some(ref mut ebur) = self.ebur128 else {
            return;
        };

        let frames = samples.len() / self.channels;
        if frames == 0 {
            return;
        }
        let sample_count = frames * self.channels;
        let samples = &samples[..sample_count];

        if let Err(e) = ebur.add_frames_f64(samples) {
            log::warn!("EBU R128 add_frames error: {:?}", e);
            return;
        }

        self.samples_processed += frames as u64;

        // Update measurements
        if let Ok(loudness) = ebur.loudness_global() {
            self.integrated_loudness = loudness;
        }

        if let Ok(loudness) = ebur.loudness_shortterm() {
            self.short_term_loudness = loudness;
        }

        if let Ok(loudness) = ebur.loudness_momentary() {
            self.momentary_loudness = loudness;
        }

        if let Ok(lra) = ebur.loudness_range() {
            self.loudness_range = lra;
        }

        // True peak using 4x polyphase FIR oversampling.
        // Process each channel through its dedicated TruePeakDetector
        for (ch, detector) in self.true_peak_detectors.iter_mut().enumerate() {
            detector.process_strided(samples, ch, self.channels);
        }

        // Get maximum true peak across all channels
        let max_true_peak = self
            .true_peak_detectors
            .iter()
            .map(|d| d.max_true_peak())
            .fold(0.0_f64, f64::max);

        if max_true_peak > 0.0 {
            let peak_db = 20.0 * max_true_peak.log10();
            self.true_peak = peak_db.max(self.true_peak);
        }
    }

    pub fn integrated_loudness(&self) -> f64 {
        self.integrated_loudness
    }
    pub fn short_term_loudness(&self) -> f64 {
        self.short_term_loudness
    }
    pub fn momentary_loudness(&self) -> f64 {
        self.momentary_loudness
    }
    pub fn loudness_range(&self) -> f64 {
        self.loudness_range
    }
    pub fn true_peak(&self) -> f64 {
        self.true_peak
    }
    pub fn samples_processed(&self) -> u64 {
        self.samples_processed
    }

    pub fn has_reliable_measurement(&self) -> bool {
        let min_samples = (self.sample_rate as f64 * 0.4) as u64;
        self.samples_processed >= min_samples
    }
}

/// True peak detector using 4x polyphase FIR oversampling.
///
/// The FIR is a fixed-size Kaiser-windowed sinc table generated on first use.
/// It replaces the older cubic interpolation estimate with a bounded, no-heap
/// process path. Formal BS.1770 conformance still depends on validating the tap
/// table against reference corpus data.
///
/// This is used for measurement, not limiting. The limiter above
/// handles peak limiting without oversampling (acceptable for most use cases).
pub struct TruePeakDetector {
    /// Causal FIR history. Power-of-two length keeps wrap indexing cheap.
    ring_buffer: [f64; TRUE_PEAK_FIR_TAPS],
    write_pos: usize,
    /// Maximum true peak detected
    max_true_peak: f64,
}

impl TruePeakDetector {
    pub fn new() -> Self {
        let _ = true_peak_fir();
        Self {
            ring_buffer: [0.0; TRUE_PEAK_FIR_TAPS],
            write_pos: 0,
            max_true_peak: 0.0,
        }
    }

    /// Process samples and update true peak measurement
    pub fn process(&mut self, samples: &[f64]) {
        for &sample in samples {
            self.process_sample(sample);
        }
    }

    /// Process one channel from an interleaved buffer without allocating.
    pub fn process_strided(&mut self, samples: &[f64], offset: usize, stride: usize) {
        let mut index = offset;
        while index < samples.len() {
            self.process_sample(samples[index]);
            index += stride;
        }
    }

    #[inline]
    fn process_sample(&mut self, sample: f64) {
        self.max_true_peak = self.max_true_peak.max(sample.abs());

        self.ring_buffer[self.write_pos] = sample;
        self.write_pos = (self.write_pos + 1) & TRUE_PEAK_FIR_MASK;

        for phase in true_peak_fir() {
            let mut acc = 0.0;
            let mut ring_index = self.write_pos.wrapping_sub(1) & TRUE_PEAK_FIR_MASK;

            for &tap in phase {
                acc += self.ring_buffer[ring_index] * tap as f64;
                ring_index = ring_index.wrapping_sub(1) & TRUE_PEAK_FIR_MASK;
            }

            self.max_true_peak = self.max_true_peak.max(acc.abs());
        }
    }

    /// Get maximum true peak detected (linear)
    pub fn max_true_peak(&self) -> f64 {
        self.max_true_peak
    }

    /// Get maximum true peak in dBTP
    pub fn max_true_peak_db(&self) -> f64 {
        linear_to_db(self.max_true_peak)
    }

    /// Reset detector state
    pub fn reset(&mut self) {
        self.ring_buffer.fill(0.0);
        self.write_pos = 0;
        self.max_true_peak = 0.0;
    }
}

impl Default for TruePeakDetector {
    fn default() -> Self {
        Self::new()
    }
}

fn true_peak_fir() -> &'static [[f32; TRUE_PEAK_FIR_TAPS]; TRUE_PEAK_PHASES] {
    TRUE_PEAK_FIR.get_or_init(generate_true_peak_fir)
}

fn generate_true_peak_fir() -> [[f32; TRUE_PEAK_FIR_TAPS]; TRUE_PEAK_PHASES] {
    let mut phases = [[0.0_f32; TRUE_PEAK_FIR_TAPS]; TRUE_PEAK_PHASES];
    let center = (TRUE_PEAK_FIR_TAPS as f64 - 1.0) * 0.5;
    let window_denominator = modified_bessel_i0(TRUE_PEAK_FIR_BETA);

    for (phase_index, phase) in phases.iter_mut().enumerate() {
        let fractional_delay = phase_index as f64 / TRUE_PEAK_PHASES as f64;
        let mut sum = 0.0;

        for (tap_index, tap) in phase.iter_mut().enumerate() {
            let position = tap_index as f64 - center - fractional_delay;
            let normalized = (2.0 * tap_index as f64) / (TRUE_PEAK_FIR_TAPS as f64 - 1.0) - 1.0;
            let window = modified_bessel_i0(
                TRUE_PEAK_FIR_BETA * (1.0 - normalized * normalized).max(0.0).sqrt(),
            ) / window_denominator;
            let value = 2.0
                * TRUE_PEAK_FIR_CUTOFF
                * sinc(2.0 * TRUE_PEAK_FIR_CUTOFF * position)
                * window;

            *tap = value as f32;
            sum += value;
        }

        for tap in phase {
            *tap = (*tap as f64 / sum) as f32;
        }
    }

    phases
}

#[inline]
fn sinc(x: f64) -> f64 {
    if x.abs() < 1.0e-12 {
        1.0
    } else {
        let pix = std::f64::consts::PI * x;
        pix.sin() / pix
    }
}

fn modified_bessel_i0(x: f64) -> f64 {
    let half_x = x * 0.5;
    let mut sum = 1.0;
    let mut term = 1.0;

    for k in 1..=32 {
        let k = k as f64;
        term *= (half_x * half_x) / (k * k);
        sum += term;

        if term < sum * 1.0e-15 {
            break;
        }
    }

    sum
}

#[cfg(test)]
mod tests {
    use super::*;

    fn deterministic_interleaved(frames: usize, channels: usize) -> Vec<f64> {
        let mut samples = Vec::with_capacity(frames * channels);
        for frame in 0..frames {
            for ch in 0..channels {
                let sample = ((frame as f64 * 0.017) + ch as f64 * 0.13).sin() * 0.5;
                samples.push(sample);
            }
        }
        samples
    }

    #[test]
    fn true_peak_strided_matches_channel_extract_for_common_channel_counts() {
        for channels in [1, 2, 6, 8] {
            let samples = deterministic_interleaved(512, channels);

            for ch in 0..channels {
                let channel_samples: Vec<f64> =
                    samples.iter().skip(ch).step_by(channels).copied().collect();
                let mut contiguous = TruePeakDetector::new();
                let mut strided = TruePeakDetector::new();

                contiguous.process(&channel_samples);
                strided.process_strided(&samples, ch, channels);

                assert_eq!(
                    contiguous.max_true_peak().to_bits(),
                    strided.max_true_peak().to_bits(),
                    "channels={channels}, channel={ch}"
                );
            }
        }
    }

    #[test]
    fn loudness_meter_truncates_partial_frames() {
        let mut meter = LoudnessMeter::new(2, 48_000);
        let samples = vec![0.1, -0.1, 0.2];

        meter.process(&samples);

        assert_eq!(meter.samples_processed(), 1);
    }

    #[test]
    fn loudness_meter_process_is_steady_state_no_alloc() {
        let mut meter = LoudnessMeter::new(2, 48_000);
        let samples = deterministic_interleaved(64, 2);

        assert_no_alloc::assert_no_alloc(|| {
            for _ in 0..1_000 {
                meter.process(&samples);
            }
        });
    }

    #[test]
    fn loudness_meter_handles_surround_channel_counts() {
        for channels in [1, 2, 6, 8] {
            let mut meter = LoudnessMeter::new(channels, 48_000);
            let samples = deterministic_interleaved(256, channels);

            meter.process(&samples);

            assert_eq!(meter.samples_processed(), 256);
            assert!(meter.true_peak().is_finite());
        }
    }

    #[test]
    fn true_peak_fir_taps_are_normalized() {
        for phase in true_peak_fir() {
            let sum: f64 = phase.iter().map(|&tap| tap as f64).sum();
            assert!(
                (sum - 1.0).abs() < 1.0e-6,
                "phase sum should preserve DC gain: {sum}"
            );
        }
    }

    #[test]
    fn true_peak_reset_clears_ring_history() {
        let mut detector = TruePeakDetector::new();
        detector.process(&[1.0; TRUE_PEAK_FIR_TAPS]);
        assert!(detector.max_true_peak() > 0.0);

        detector.reset();
        detector.process(&[0.0; TRUE_PEAK_FIR_TAPS]);

        assert_eq!(detector.max_true_peak(), 0.0);
    }

    #[test]
    fn true_peak_cross_buffer_continuity_matches_single_process() {
        let samples: Vec<f64> = (0..1024).map(|i| (i as f64 * 0.071).sin()).collect();
        let mut single = TruePeakDetector::new();
        let mut chunked = TruePeakDetector::new();

        single.process(&samples);
        for chunk in samples.chunks(17) {
            chunked.process(chunk);
        }

        assert_eq!(
            single.max_true_peak().to_bits(),
            chunked.max_true_peak().to_bits()
        );
    }

    #[test]
    fn true_peak_impulse_reaches_sample_peak_without_cubic_overshoot() {
        let mut detector = TruePeakDetector::new();
        let mut samples = vec![0.0; TRUE_PEAK_FIR_TAPS * 2];
        samples[TRUE_PEAK_FIR_TAPS / 2] = 1.0;

        detector.process(&samples);

        assert!(detector.max_true_peak() >= 1.0);
        assert!(detector.max_true_peak() < 1.1);
    }
}

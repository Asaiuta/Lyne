//! Track loudness target gain calculation for loaded playback buffers.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;

use super::state::{CachedLoudness, SharedState};
use crate::processor::AtomicLoudnessState;

const AUDIO_HEADROOM: f64 = 0.99;

fn replay_gain_to_target_gain_db(rg_gain_db: f64, target_lufs: f64, reference_lufs: f64) -> f64 {
    rg_gain_db + (target_lufs - reference_lufs)
}

fn calc_safe_replay_gain_db(target_gain_db: f64, peak: Option<f64>, preamp_db: f64) -> f64 {
    let requested_total_gain = target_gain_db + preamp_db;
    if requested_total_gain <= 0.0 {
        return target_gain_db;
    }

    if let Some(peak_val) = peak {
        if peak_val > 0.0 {
            let max_linear = AUDIO_HEADROOM / peak_val;
            let max_total_gain_db = 20.0 * max_linear.log10();
            if requested_total_gain > max_total_gain_db {
                let limited_target_gain = max_total_gain_db - preamp_db;
                log::info!(
                    "Peak protection: peak={:.4}, requested total={:.2} dB, limited target to {:.2} dB",
                    peak_val,
                    requested_total_gain,
                    limited_target_gain
                );
                return limited_target_gain;
            }
        }
    }

    target_gain_db
}

fn analyze_ebu_r128_loudness(
    samples: &Arc<Vec<f64>>,
    channels: usize,
    sample_rate: u32,
) -> Option<f64> {
    let mut meter = crate::processor::LoudnessMeter::new(channels, sample_rate);
    meter.process(samples);
    let loudness = meter.integrated_loudness();
    loudness.is_finite().then_some(loudness)
}

fn ebu_r128_gain_for_target(
    samples: &Arc<Vec<f64>>,
    channels: usize,
    sample_rate: u32,
    target_lufs: f64,
) -> Option<f64> {
    analyze_ebu_r128_loudness(samples, channels, sample_rate)
        .map(|loudness| target_lufs - loudness)
        .filter(|gain| gain.is_finite())
}

pub(super) fn apply_loaded_track_loudness(
    shared_state: &Arc<SharedState>,
    loudness_state: &Arc<AtomicLoudnessState>,
    metadata: &crate::decoder::TrackMetadata,
    cached_loudness: Option<&CachedLoudness>,
    samples: &Arc<Vec<f64>>,
    channels: usize,
    sample_rate: u32,
    target_lufs: f64,
    replaygain_reference_lufs: f64,
) {
    shared_state.mark_loudness_started();
    loudness_state.set_smoothing(200.0, sample_rate);

    let preamp = loudness_state.preamp_gain_db.load(Ordering::Relaxed);
    match loudness_state.get_mode() {
        crate::config::NormalizationMode::Track | crate::config::NormalizationMode::Streaming => {}
        crate::config::NormalizationMode::Album => {
            shared_state.mark_loudness_finished();
            return;
        }
        crate::config::NormalizationMode::ReplayGainTrack => {
            if let Some(rg_gain) = metadata.rg_track_gain {
                let peak = metadata.rg_track_peak;
                let target_gain =
                    replay_gain_to_target_gain_db(rg_gain, target_lufs, replaygain_reference_lufs);
                let effective_gain = calc_safe_replay_gain_db(target_gain, peak, preamp);
                loudness_state.set_target_gain(effective_gain);
                log::info!(
                    "ReplayGain Track tag: {:.2} dB, target gain {:.2} dB, preamp {:.2} dB, effective total {:.2} dB (peak: {:?})",
                    rg_gain,
                    effective_gain,
                    preamp,
                    effective_gain + preamp,
                    peak
                );
                shared_state.mark_loudness_finished();
                return;
            }

            log::warn!("No ReplayGain track gain found, scheduling EBU R128 analysis");
        }
        crate::config::NormalizationMode::ReplayGainAlbum => {
            let rg_gain = metadata.rg_album_gain.or(metadata.rg_track_gain);
            let peak = metadata.rg_album_peak.or(metadata.rg_track_peak);
            if let Some(gain) = rg_gain {
                let target_gain =
                    replay_gain_to_target_gain_db(gain, target_lufs, replaygain_reference_lufs);
                let effective_gain = calc_safe_replay_gain_db(target_gain, peak, preamp);
                loudness_state.set_target_gain(effective_gain);
                log::info!(
                    "ReplayGain Album tag: {:.2} dB, target gain {:.2} dB, preamp {:.2} dB, effective total {:.2} dB (peak: {:?})",
                    gain,
                    effective_gain,
                    preamp,
                    effective_gain + preamp,
                    peak
                );
                shared_state.mark_loudness_finished();
                return;
            }

            log::warn!("No ReplayGain gain found, scheduling EBU R128 analysis");
        }
    }

    if let Some(gain) = cached_loudness.and_then(|cached| cached.gain_for_target(target_lufs)) {
        loudness_state.set_target_gain(gain);
        log::info!(
            "Cached loudness target gain {:.2} dB, preamp {:.2} dB (integrated: {:.2} LUFS, target: {:.2} LUFS)",
            gain,
            preamp,
            cached_loudness
                .map(|cached| cached.integrated_lufs)
                .unwrap_or(-70.0),
            target_lufs
        );
        shared_state.mark_loudness_finished();
        return;
    }

    loudness_state.set_target_gain(0.0);
    shared_state.mark_loudness_finished();
    if samples.is_empty() {
        return;
    }
    spawn_background_ebu_r128_analysis(
        Arc::clone(shared_state),
        Arc::clone(loudness_state),
        Arc::clone(samples),
        channels,
        sample_rate,
        target_lufs,
        shared_state.load_generation.load(Ordering::Acquire),
        preamp,
    );
}

pub(super) fn refresh_loaded_loudness(
    shared_state: &Arc<SharedState>,
    loudness_state: &Arc<AtomicLoudnessState>,
    target_lufs: f64,
    replaygain_reference_lufs: f64,
) {
    let samples = shared_state.audio_buffer.load_full();
    if samples.is_empty() {
        return;
    }

    let channels = shared_state.channels.load(Ordering::Relaxed).max(1) as usize;
    let sample_rate = shared_state.sample_rate.load(Ordering::Relaxed).max(1) as u32;
    let metadata = shared_state.track_metadata.read().clone();
    let cached_loudness = shared_state.current_cached_loudness.read().clone();
    apply_loaded_track_loudness(
        shared_state,
        loudness_state,
        &metadata,
        cached_loudness.as_ref(),
        &samples,
        channels,
        sample_rate,
        target_lufs,
        replaygain_reference_lufs,
    );
}

#[allow(clippy::too_many_arguments)]
fn spawn_background_ebu_r128_analysis(
    shared_state: Arc<SharedState>,
    loudness_state: Arc<AtomicLoudnessState>,
    samples: Arc<Vec<f64>>,
    channels: usize,
    sample_rate: u32,
    target_lufs: f64,
    generation: u64,
    preamp: f64,
) {
    thread::spawn(move || {
        if shared_state.load_generation.load(Ordering::Acquire) != generation {
            return;
        }

        shared_state.mark_background_loudness_started();
        let gain = ebu_r128_gain_for_target(&samples, channels, sample_rate, target_lufs);

        if shared_state.load_generation.load(Ordering::Acquire) != generation {
            return;
        }
        shared_state.mark_background_loudness_finished();

        if apply_background_loudness_gain_if_current(
            &shared_state,
            &loudness_state,
            generation,
            gain,
        ) {
            if let Some(gain) = gain {
                log::info!(
                    "Background EBU R128 target gain {:.2} dB, preamp {:.2} dB (target: {:.2} LUFS)",
                    gain,
                    preamp,
                    target_lufs
                );
            } else {
                log::warn!(
                    "Background EBU R128 analysis failed, keeping target gain 0.0 dB plus preamp {:.2} dB",
                    preamp
                );
            }
        }
    });
}

fn apply_background_loudness_gain_if_current(
    shared_state: &SharedState,
    loudness_state: &AtomicLoudnessState,
    generation: u64,
    gain: Option<f64>,
) -> bool {
    if shared_state.load_generation.load(Ordering::Acquire) != generation {
        return false;
    }

    loudness_state.set_target_gain(gain.unwrap_or(0.0));
    shared_state.mark_background_loudness_applied();
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::NormalizationMode;
    use crate::decoder::TrackMetadata;
    use crate::processor::AtomicLoudnessState;

    fn test_shared_state() -> Arc<SharedState> {
        Arc::new(SharedState::new())
    }

    #[test]
    fn replay_gain_is_converted_to_configured_target_lufs() {
        assert_eq!(replay_gain_to_target_gain_db(-2.0, -14.0, -18.0), 2.0);
        assert_eq!(replay_gain_to_target_gain_db(1.5, -16.0, -18.0), 3.5);
    }

    #[test]
    fn replay_gain_peak_protection_accounts_for_preamp_without_double_counting_it() {
        let preamp_db = 3.0;
        let limited_target = calc_safe_replay_gain_db(6.0, Some(1.0), preamp_db);
        let max_total_gain = 20.0 * AUDIO_HEADROOM.log10();

        assert!(limited_target < 0.0);
        assert!((limited_target + preamp_db - max_total_gain).abs() < 1.0e-9);
    }

    #[test]
    fn replay_gain_track_mode_stores_target_gain_without_preamp() {
        let loudness_state = Arc::new(AtomicLoudnessState::default());
        loudness_state.set_mode(NormalizationMode::ReplayGainTrack as u8);
        loudness_state.set_preamp_gain(-2.0);

        let metadata = TrackMetadata {
            rg_track_gain: Some(0.0),
            rg_track_peak: None,
            ..Default::default()
        };

        let samples = Arc::new(vec![0.0; 1024]);
        let shared_state = test_shared_state();

        apply_loaded_track_loudness(
            &shared_state,
            &loudness_state,
            &metadata,
            None,
            &samples,
            2,
            44_100,
            -14.0,
            -18.0,
        );

        let target_gain = loudness_state.target_gain_db.load(Ordering::Relaxed);
        assert!((target_gain - 4.0).abs() < 1.0e-9);
    }

    #[test]
    fn cached_loudness_sets_track_target_gain_without_full_analysis() {
        let loudness_state = Arc::new(AtomicLoudnessState::default());
        loudness_state.set_mode(NormalizationMode::Track as u8);
        let metadata = TrackMetadata::default();
        let cached = CachedLoudness {
            integrated_lufs: -20.0,
            true_peak_dbtp: -1.0,
            loudness_range: None,
        };
        let samples = Arc::new(vec![0.0; 1024]);
        let shared_state = test_shared_state();

        apply_loaded_track_loudness(
            &shared_state,
            &loudness_state,
            &metadata,
            Some(&cached),
            &samples,
            2,
            44_100,
            -14.0,
            -18.0,
        );

        let target_gain = loudness_state.target_gain_db.load(Ordering::Relaxed);
        assert!((target_gain - 6.0).abs() < 1.0e-9);
    }

    #[test]
    fn replay_gain_tag_takes_priority_over_cached_loudness() {
        let loudness_state = Arc::new(AtomicLoudnessState::default());
        loudness_state.set_mode(NormalizationMode::ReplayGainTrack as u8);
        let metadata = TrackMetadata {
            rg_track_gain: Some(0.0),
            rg_track_peak: None,
            ..Default::default()
        };
        let cached = CachedLoudness {
            integrated_lufs: -30.0,
            true_peak_dbtp: -1.0,
            loudness_range: None,
        };
        let samples = Arc::new(vec![0.0; 1024]);
        let shared_state = test_shared_state();

        apply_loaded_track_loudness(
            &shared_state,
            &loudness_state,
            &metadata,
            Some(&cached),
            &samples,
            2,
            44_100,
            -14.0,
            -18.0,
        );

        let target_gain = loudness_state.target_gain_db.load(Ordering::Relaxed);
        assert!((target_gain - 4.0).abs() < 1.0e-9);
    }

    #[test]
    fn replay_gain_missing_tag_falls_back_to_cached_loudness() {
        let loudness_state = Arc::new(AtomicLoudnessState::default());
        loudness_state.set_mode(NormalizationMode::ReplayGainTrack as u8);
        let metadata = TrackMetadata::default();
        let cached = CachedLoudness {
            integrated_lufs: -21.0,
            true_peak_dbtp: -1.0,
            loudness_range: None,
        };
        let samples = Arc::new(vec![0.0; 1024]);
        let shared_state = test_shared_state();

        apply_loaded_track_loudness(
            &shared_state,
            &loudness_state,
            &metadata,
            Some(&cached),
            &samples,
            2,
            44_100,
            -14.0,
            -18.0,
        );

        let target_gain = loudness_state.target_gain_db.load(Ordering::Relaxed);
        assert!((target_gain - 7.0).abs() < 1.0e-9);
    }

    #[test]
    fn background_loudness_apply_is_generation_guarded() {
        let shared_state = SharedState::new();
        let loudness_state = AtomicLoudnessState::default();
        shared_state.load_generation.store(2, Ordering::Release);

        assert!(!apply_background_loudness_gain_if_current(
            &shared_state,
            &loudness_state,
            1,
            Some(6.0),
        ));
        assert_eq!(loudness_state.target_gain_db.load(Ordering::Relaxed), 0.0);
        assert_eq!(
            shared_state
                .background_loudness_applied_ms
                .load(Ordering::Relaxed),
            0
        );

        assert!(apply_background_loudness_gain_if_current(
            &shared_state,
            &loudness_state,
            2,
            Some(6.0),
        ));
        assert_eq!(loudness_state.target_gain_db.load(Ordering::Relaxed), 6.0);
        assert!(
            shared_state
                .background_loudness_applied_ms
                .load(Ordering::Relaxed)
                > 0
        );
    }
}

//! User-facing setters / getters for runtime effect parameters and the small
//! "legacy snapshot" Mutex<Effect> constructors used by older API surfaces.
//!
//! Each setter mutates the lock-free `AtomicXParams` Arc on the player so the
//! audio thread picks up the change without locking; getters either query the
//! same Atomic struct or build a fresh non-realtime snapshot for callers that
//! still expect the original Mutex-wrapped effect instance.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use parking_lot::Mutex;

use crate::processor::{
    CrossfeedSettings, LoudnessInfo, LoudnessNormalizer, NoiseShaperCurve, SaturationSettings,
};

use super::AudioPlayer;

impl AudioPlayer {
    pub fn loudness_normalizer(&self) -> Arc<Mutex<LoudnessNormalizer>> {
        Arc::clone(&self.loudness_normalizer)
    }

    pub fn set_loudness_enabled(&mut self, enabled: bool) {
        log::info!("set_loudness_enabled called with enabled={}", enabled);
        self.loudness_enabled = enabled;
        self.config.loudness.enabled = enabled;
        self.loudness_normalizer.lock().set_enabled(enabled);
    }

    pub fn set_target_lufs(&mut self, target_lufs: f64) {
        self.loudness_normalizer.lock().set_target_lufs(target_lufs);
        self.config.loudness.target_lufs = target_lufs;
    }

    pub fn set_album_gain(&self, gain_db: f64) {
        self.loudness_normalizer.lock().set_album_gain(gain_db);
    }

    pub fn set_preamp_gain(&self, gain_db: f64) {
        self.loudness_normalizer.lock().set_preamp_gain(gain_db);
    }

    pub fn set_normalization_mode(&mut self, mode: crate::config::NormalizationMode) {
        self.loudness_normalizer.lock().set_mode(mode);
        self.config.loudness.mode = mode;
    }

    pub fn get_loudness_info(&self) -> LoudnessInfo {
        self.loudness_normalizer.lock().get_loudness_info()
    }

    /// Get saturation settings
    pub fn get_saturation_info(&self) -> SaturationSettings {
        self.lockfree_saturation_params.get_settings()
    }

    /// Set saturation enabled
    pub fn set_saturation_enabled(&self, enabled: bool) {
        self.lockfree_saturation_params.set_enabled(enabled);
        log::info!(
            "Saturation {}",
            if enabled { "enabled" } else { "disabled" }
        );
    }

    /// Set saturation drive (0.0 - 2.0)
    pub fn set_saturation_drive(&self, drive: f64) {
        self.lockfree_saturation_params.set_drive(drive);
        log::info!("Saturation drive set to: {}", drive);
    }

    /// Set saturation mix (0.0 - 1.0)
    pub fn set_saturation_mix(&self, mix: f64) {
        self.lockfree_saturation_params.set_mix(mix);
        log::info!("Saturation mix set to: {}", mix);
    }

    /// Get crossfeed settings
    pub fn get_crossfeed_info(&self) -> CrossfeedSettings {
        self.lockfree_crossfeed_params.get_settings()
    }

    /// Set crossfeed enabled
    pub fn set_crossfeed_enabled(&self, enabled: bool) {
        self.lockfree_crossfeed_params.set_enabled(enabled);
        log::info!("Crossfeed {}", if enabled { "enabled" } else { "disabled" });
    }

    /// Set crossfeed mix (0.0 - 1.0)
    pub fn set_crossfeed_mix(&self, mix: f64) {
        self.lockfree_crossfeed_params.set_mix(mix);
        log::info!("Crossfeed mix set to: {}", mix);
    }

    // ============ Dynamic Loudness Methods ============

    /// Get Dynamic Loudness enabled state
    pub fn is_dynamic_loudness_enabled(&self) -> bool {
        self.lockfree_dynamic_loudness_params.is_enabled()
    }

    /// Set Dynamic Loudness enabled
    pub fn set_dynamic_loudness_enabled(&self, enabled: bool) {
        self.lockfree_dynamic_loudness_params.set_enabled(enabled);
        log::info!(
            "Dynamic Loudness {}",
            if enabled { "enabled" } else { "disabled" }
        );
    }

    /// Get Dynamic Loudness strength (0.0 - 1.0)
    pub fn get_dynamic_loudness_strength(&self) -> f64 {
        self.lockfree_dynamic_loudness_params.strength()
    }

    /// Set Dynamic Loudness strength (0.0 - 1.0)
    pub fn set_dynamic_loudness_strength(&self, strength: f64) {
        self.lockfree_dynamic_loudness_params.set_strength(strength);
        log::info!("Dynamic Loudness strength: {:.0}%", strength * 100.0);
    }

    /// Get current loudness factor (for display)
    pub fn get_dynamic_loudness_factor(&self) -> f64 {
        self.dynamic_loudness_telemetry.factor()
    }

    /// Get current band gains (for display/metering)
    pub fn get_dynamic_loudness_gains(&self) -> [f64; 7] {
        self.dynamic_loudness_telemetry.band_gains()
    }

    // ============ Backward Compatibility Methods ============
    // These methods provide compatibility with legacy API

    /// Get a snapshot noise shaper instance for backward compatibility.
    ///
    /// Note: This instance is NOT wired into the real-time lock-free DSP chain.
    pub fn noise_shaper(&self) -> Arc<Mutex<crate::processor::NoiseShaper>> {
        let channels = self.shared_state.channels.load(Ordering::Relaxed).max(1) as usize;
        let sample_rate = self.shared_state.sample_rate.load(Ordering::Relaxed).max(1) as u32;
        let bits = self.get_output_bits();

        let mut shaper = crate::processor::NoiseShaper::new(channels, sample_rate, bits);
        shaper.set_enabled(self.dither_enabled);
        Arc::new(Mutex::new(shaper))
    }

    /// Get noise shaper curve name.
    pub fn get_noise_shaper_curve(&self) -> String {
        format!("{:?}", *self.shared_state.noise_shaper_curve.read())
    }

    /// Set noise shaper curve.
    pub fn set_noise_shaper_curve(&self, curve: NoiseShaperCurve) -> Result<(), String> {
        self.lockfree_noise_shaper_params.set_curve(curve);
        *self.shared_state.noise_shaper_curve.write() = curve;
        self.cmd_tx
            .send(super::AudioCommand::SetNoiseShaperCurve { curve })
            .map_err(|e| format!("Failed to send SetNoiseShaperCurve command: {}", e))
    }

    /// Get an EQ snapshot instance for backward compatibility.
    ///
    /// Note: This instance is NOT wired into the real-time lock-free DSP chain.
    pub fn eq(&self) -> Arc<Mutex<crate::processor::Equalizer>> {
        let channels = self.shared_state.channels.load(Ordering::Relaxed).max(1) as usize;
        let sample_rate = self.shared_state.sample_rate.load(Ordering::Relaxed).max(1) as f64;
        let snapshot = self.lockfree_eq_params.read();

        let mut eq = crate::processor::Equalizer::new(channels, sample_rate);
        eq.set_all_bands(&snapshot.gains, sample_rate);
        eq.set_enabled(snapshot.enabled);
        Arc::new(Mutex::new(eq))
    }

    /// Get a crossfeed snapshot instance for backward compatibility.
    ///
    /// Note: This instance is NOT wired into the real-time lock-free DSP chain.
    pub fn crossfeed(&self) -> Arc<Mutex<crate::processor::Crossfeed>> {
        let sample_rate = self.shared_state.sample_rate.load(Ordering::Relaxed).max(1) as f64;
        let snapshot = self.lockfree_crossfeed_params.read();

        let mut crossfeed = crate::processor::Crossfeed::new(sample_rate);
        crossfeed.set_mix(snapshot.mix);
        crossfeed.set_sample_rate(sample_rate, snapshot.cutoff_hz);
        crossfeed.set_enabled(snapshot.enabled);
        Arc::new(Mutex::new(crossfeed))
    }

    /// Get a saturation snapshot instance for backward compatibility.
    ///
    /// Note: This instance is NOT wired into the real-time lock-free DSP chain.
    pub fn saturation(&self) -> Arc<Mutex<crate::processor::Saturation>> {
        let sample_rate = self.shared_state.sample_rate.load(Ordering::Relaxed).max(1) as f64;
        let snapshot = self.lockfree_saturation_params.read();

        let mut saturation = crate::processor::Saturation::new();
        saturation.set_sample_rate(sample_rate);
        saturation.set_drive(snapshot.drive);
        saturation.set_threshold(snapshot.threshold);
        saturation.set_mix(snapshot.mix);
        saturation.set_input_gain(snapshot.input_gain_db);
        saturation.set_output_gain(snapshot.output_gain_db);
        saturation.set_highpass_mode(snapshot.highpass_mode);
        saturation.set_highpass_cutoff(snapshot.highpass_cutoff);
        saturation.set_enabled(snapshot.enabled);
        // M-4 fix: use From trait for type-safe conversion
        saturation.set_type(crate::processor::SaturationType::from(snapshot.sat_type));
        Arc::new(Mutex::new(saturation))
    }
}

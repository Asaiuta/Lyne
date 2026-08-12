//! User-facing setters / getters for runtime effect parameters.
//!
//! Real-time effect changes must flow through the player's lock-free
//! `AtomicXParams` fields so the audio thread can observe them without
//! locking. The `*_snapshot()` helpers below build detached `Mutex<Effect>`
//! values for inspection and tests only; mutating those snapshots does not
//! affect the active DSP chain.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use parking_lot::Mutex;

use crate::processor::{
    CrossfeedSettings, LoudnessInfo, LoudnessNormalizer, NoiseShaperCurve, SaturationSettings,
};

use super::AudioPlayer;

impl AudioPlayer {
    /// Returns the live loudness normalizer handle used by the runtime DSP
    /// path. Mutations on this handle update the shared atomic loudness state
    /// consumed by the audio thread.
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
        if let Err(error) = self.loudness_normalizer.lock().set_target_lufs(target_lufs) {
            // The core rejects non-finite / unrepresentable gains. Keep the
            // previous normalizer state and do not persist a value the engine
            // refused to apply.
            log::warn!("Rejected target LUFS {target_lufs}: {error}");
            return;
        }
        self.config.loudness.target_lufs = target_lufs;
        if let Err(e) = self
            .cmd_tx
            .send(super::AudioCommand::SetTargetLufs(target_lufs))
        {
            log::warn!("Failed to send SetTargetLufs command: {}", e);
        }
        if let Err(e) = self.cmd_tx.send(super::AudioCommand::RefreshLoadedLoudness) {
            log::warn!("Failed to send RefreshLoadedLoudness command: {}", e);
        }
    }

    pub fn set_album_gain(&self, gain_db: f64) {
        if let Err(error) = self.loudness_normalizer.lock().set_album_gain(gain_db) {
            log::warn!("Rejected album gain {gain_db} dB: {error}");
        }
    }

    pub fn set_preamp_gain(&self, gain_db: f64) {
        if let Err(error) = self.loudness_normalizer.lock().set_preamp_gain(gain_db) {
            log::warn!("Rejected preamp gain {gain_db} dB: {error}");
            return;
        }
        if let Err(e) = self.cmd_tx.send(super::AudioCommand::RefreshLoadedLoudness) {
            log::warn!("Failed to send RefreshLoadedLoudness command: {}", e);
        }
    }

    pub fn set_normalization_mode(&mut self, mode: crate::config::NormalizationMode) {
        self.loudness_normalizer.lock().set_mode(mode);
        self.config.loudness.mode = mode;
        if let Err(e) = self.cmd_tx.send(super::AudioCommand::RefreshLoadedLoudness) {
            log::warn!("Failed to send RefreshLoadedLoudness command: {}", e);
        }
    }

    pub fn get_loudness_info(&self) -> LoudnessInfo {
        self.loudness_normalizer.lock().get_loudness_info()
    }

    /// Get saturation settings
    pub fn get_saturation_info(&self) -> SaturationSettings {
        let snapshot = self.lockfree_saturation_params.read();
        SaturationSettings {
            sat_type: snapshot.sat_type.into(),
            quality: snapshot.quality.into(),
            drive: snapshot.drive,
            threshold: snapshot.threshold,
            mix: snapshot.mix,
            input_gain_db: snapshot.input_gain_db,
            output_gain_db: snapshot.output_gain_db,
            enabled: snapshot.enabled,
            highpass_mode: snapshot.highpass_mode,
            highpass_cutoff: snapshot.highpass_cutoff,
        }
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
        let snapshot = self.lockfree_crossfeed_params.read();
        CrossfeedSettings {
            mix: snapshot.mix,
            cutoff_hz: snapshot.cutoff_hz,
            enabled: snapshot.enabled,
        }
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

    // ============ Snapshot Helpers ============

    /// Builds a detached noise shaper snapshot for inspection or tests.
    ///
    /// Mutating the returned value does not affect the real-time DSP chain.
    pub fn noise_shaper_snapshot(
        &self,
    ) -> Result<Arc<Mutex<crate::processor::NoiseShaper>>, String> {
        let channels = self.shared_state.channels.load(Ordering::Relaxed).max(1) as usize;
        let sample_rate = self.shared_state.sample_rate.load(Ordering::Relaxed).max(1) as u32;
        let bits = self.get_output_bits();

        let mut shaper = crate::processor::NoiseShaper::new(channels, sample_rate, bits)
            .map_err(|error| format!("Failed to build noise shaper snapshot: {error}"))?;
        shaper.set_enabled(self.dither_enabled);
        Ok(Arc::new(Mutex::new(shaper)))
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

    /// Builds a detached EQ snapshot for inspection or tests.
    ///
    /// Mutating the returned value does not affect the real-time DSP chain.
    pub fn eq_snapshot(&self) -> Arc<Mutex<crate::processor::Equalizer>> {
        let channels = self.shared_state.channels.load(Ordering::Relaxed).max(1) as usize;
        let sample_rate = self.shared_state.sample_rate.load(Ordering::Relaxed).max(1) as f64;
        let snapshot = self.lockfree_eq_params.read();

        let mut eq = crate::processor::Equalizer::new(channels, sample_rate);
        if let Err(error) = eq.set_all_bands(&snapshot.gains, sample_rate) {
            // A detached snapshot is diagnostic only; report the rejected gains
            // instead of silently returning a differently configured EQ.
            log::warn!("Rejected EQ snapshot band gains: {error}");
        }
        eq.set_enabled(snapshot.enabled);
        Arc::new(Mutex::new(eq))
    }

    /// Builds a detached crossfeed snapshot for inspection or tests.
    ///
    /// Mutating the returned value does not affect the real-time DSP chain.
    pub fn crossfeed_snapshot(&self) -> Arc<Mutex<crate::processor::Crossfeed>> {
        let sample_rate = self.shared_state.sample_rate.load(Ordering::Relaxed).max(1) as f64;
        let snapshot = self.lockfree_crossfeed_params.read();

        let mut crossfeed = crate::processor::Crossfeed::new(sample_rate);
        crossfeed.set_mix(snapshot.mix);
        crossfeed.set_sample_rate(sample_rate, snapshot.cutoff_hz);
        crossfeed.set_enabled(snapshot.enabled);
        Arc::new(Mutex::new(crossfeed))
    }

    /// Builds a detached saturation snapshot for inspection or tests.
    ///
    /// Mutating the returned value does not affect the real-time DSP chain.
    pub fn saturation_snapshot(&self) -> Arc<Mutex<crate::processor::Saturation>> {
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

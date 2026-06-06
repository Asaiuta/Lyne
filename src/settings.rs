//! Audio Engine Settings Persistence
//!
//! Handles saving and loading user preferences to a JSON file.

use crate::config::{
    noise_shaper_curve_to_string, normalization_mode_to_string, parse_noise_shaper_curve,
    parse_normalization_mode, parse_resample_quality, resample_quality_to_string, EngineSettings,
    EngineSettingsUpdate, DEFAULT_STREAMING_FULL_BUFFER_LIMIT_MIB,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::Mutex;

pub type PersistentSettingsUpdate = EngineSettingsUpdate;

/// Compatibility shape returned by the existing frontend settings endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistentSettings {
    pub volume: f32,
    pub device_id: Option<usize>,
    pub exclusive_mode: bool,
    pub eq_type: String,
    pub eq_bands: Option<HashMap<String, f64>>,
    pub fir_taps: Option<usize>,
    pub dither_enabled: bool,
    pub output_bits: u32,
    pub noise_shaper_curve: String,
    pub loudness_enabled: bool,
    pub loudness_mode: String,
    pub target_lufs: f64,
    pub preamp_db: f64,
    pub saturation_enabled: bool,
    pub saturation_drive: f64,
    pub saturation_mix: f64,
    pub crossfeed_enabled: bool,
    pub crossfeed_mix: f64,
    pub dynamic_loudness_enabled: bool,
    pub dynamic_loudness_strength: f64,
    pub target_samplerate: Option<u32>,
    pub resample_quality: String,
    pub use_cache: bool,
    pub preemptive_resample: bool,
    #[serde(default)]
    pub streaming_first_buffer: bool,
    #[serde(default = "default_streaming_full_buffer_limit_mib")]
    pub streaming_full_buffer_limit_mib: u64,
    pub use_next_prefetch: bool,
}

impl From<EngineSettings> for PersistentSettings {
    fn from(settings: EngineSettings) -> Self {
        Self {
            volume: settings.volume,
            device_id: settings.device_id,
            exclusive_mode: settings.exclusive_mode,
            eq_type: settings.eq_type,
            eq_bands: settings.eq_bands,
            fir_taps: settings.fir_taps,
            dither_enabled: settings.dither.enabled,
            output_bits: settings.output_bits,
            noise_shaper_curve: noise_shaper_curve_to_string(settings.dither.noise_shaper_curve),
            loudness_enabled: settings.loudness.enabled,
            loudness_mode: normalization_mode_to_string(settings.loudness.mode),
            target_lufs: settings.loudness.target_lufs,
            preamp_db: settings.dynamic_loudness.pre_gain_db,
            saturation_enabled: settings.saturation.enabled,
            saturation_drive: settings.saturation.drive,
            saturation_mix: settings.saturation.mix,
            crossfeed_enabled: settings.crossfeed.enabled,
            crossfeed_mix: settings.crossfeed.mix,
            dynamic_loudness_enabled: settings.dynamic_loudness.enabled,
            dynamic_loudness_strength: settings.dynamic_loudness.strength,
            target_samplerate: settings.target_samplerate,
            resample_quality: resample_quality_to_string(settings.resample_quality),
            use_cache: settings.use_cache,
            preemptive_resample: settings.preemptive_resample,
            streaming_first_buffer: settings.streaming_first_buffer,
            streaming_full_buffer_limit_mib: settings.streaming_full_buffer_limit_mib,
            use_next_prefetch: settings.use_next_prefetch,
        }
    }
}

impl From<PersistentSettings> for EngineSettings {
    fn from(settings: PersistentSettings) -> Self {
        let mut engine = EngineSettings::default();
        engine.volume = settings.volume;
        engine.device_id = settings.device_id;
        engine.exclusive_mode = settings.exclusive_mode;
        engine.eq_type = settings.eq_type;
        engine.eq_bands = settings.eq_bands;
        engine.fir_taps = settings.fir_taps;
        engine.dither.enabled = settings.dither_enabled;
        engine.dither.noise_shaper_curve = parse_noise_shaper_curve(&settings.noise_shaper_curve);
        engine.output_bits = settings.output_bits;
        engine.loudness.enabled = settings.loudness_enabled;
        engine.loudness.mode = parse_normalization_mode(&settings.loudness_mode);
        engine.loudness.target_lufs = settings.target_lufs;
        engine.dynamic_loudness.pre_gain_db = settings.preamp_db;
        engine.saturation.enabled = settings.saturation_enabled;
        engine.saturation.drive = settings.saturation_drive;
        engine.saturation.mix = settings.saturation_mix;
        engine.crossfeed.enabled = settings.crossfeed_enabled;
        engine.crossfeed.mix = settings.crossfeed_mix;
        engine.dynamic_loudness.enabled = settings.dynamic_loudness_enabled;
        engine.dynamic_loudness.strength = settings.dynamic_loudness_strength;
        engine.target_samplerate = settings.target_samplerate;
        engine.resample_quality = parse_resample_quality(&settings.resample_quality);
        engine.use_cache = settings.use_cache;
        engine.preemptive_resample = settings.preemptive_resample;
        engine.streaming_first_buffer = settings.streaming_first_buffer;
        engine.streaming_full_buffer_limit_mib = settings.streaming_full_buffer_limit_mib;
        engine.use_next_prefetch = settings.use_next_prefetch;
        engine.normalized()
    }
}

fn default_streaming_full_buffer_limit_mib() -> u64 {
    DEFAULT_STREAMING_FULL_BUFFER_LIMIT_MIB
}

impl Default for PersistentSettings {
    fn default() -> Self {
        EngineSettings::default().into()
    }
}

/// Settings manager that handles persistence
pub struct SettingsManager {
    settings: EngineSettings,
    file_path: PathBuf,
}

impl SettingsManager {
    /// Create a new settings manager with the given file path
    pub fn new(file_path: PathBuf) -> Self {
        let settings = EngineSettings::load_from_file(&file_path).unwrap_or_else(|e| {
            log::info!("Using default settings: {}", e);
            EngineSettings::default()
        });

        Self {
            settings,
            file_path,
        }
    }

    /// Save settings to file
    pub fn save(&self) -> Result<(), String> {
        self.settings.save(&self.file_path)?;
        log::debug!("Saved settings to {}", self.file_path.display());
        Ok(())
    }

    /// Get current settings
    pub fn get(&self) -> &EngineSettings {
        &self.settings
    }

    /// Update settings and save to file
    pub fn update(&mut self, update: EngineSettingsUpdate) -> Result<(), String> {
        self.settings.apply_update(update);
        self.save()
    }

    /// Get current engine settings
    pub fn get_settings(&self) -> EngineSettings {
        self.settings.clone()
    }

    /// Get current settings in the legacy API response shape.
    pub fn get_persistent_settings(&self) -> PersistentSettings {
        self.settings.clone().into()
    }
}

/// Thread-safe settings manager wrapper
pub type SharedSettingsManager = Arc<Mutex<SettingsManager>>;

/// Create a shared settings manager
pub fn create_settings_manager(settings_path: &Path) -> SharedSettingsManager {
    Arc::new(Mutex::new(SettingsManager::new(
        settings_path.to_path_buf(),
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::MAX_STREAMING_FULL_BUFFER_LIMIT_MIB;

    #[test]
    fn persistent_settings_round_trips_streaming_buffer_fields() {
        let engine = EngineSettings {
            streaming_first_buffer: true,
            streaming_full_buffer_limit_mib: 128,
            ..EngineSettings::default()
        };

        let persistent = PersistentSettings::from(engine);
        assert!(persistent.streaming_first_buffer);
        assert_eq!(persistent.streaming_full_buffer_limit_mib, 128);

        let restored = EngineSettings::from(persistent);
        assert!(restored.streaming_first_buffer);
        assert_eq!(restored.streaming_full_buffer_limit_mib, 128);
    }

    #[test]
    fn persistent_settings_defaults_legacy_streaming_fields() {
        let mut value = serde_json::to_value(PersistentSettings::default())
            .expect("default settings should serialize");
        let object = value
            .as_object_mut()
            .expect("settings should serialize as object");
        object.remove("streaming_first_buffer");
        object.remove("streaming_full_buffer_limit_mib");

        let settings: PersistentSettings =
            serde_json::from_value(value).expect("legacy settings should deserialize");

        assert!(!settings.streaming_first_buffer);
        assert_eq!(
            settings.streaming_full_buffer_limit_mib,
            DEFAULT_STREAMING_FULL_BUFFER_LIMIT_MIB
        );
    }

    #[test]
    fn persistent_settings_normalizes_streaming_full_buffer_limit() {
        let restored = EngineSettings::from(PersistentSettings {
            streaming_full_buffer_limit_mib: MAX_STREAMING_FULL_BUFFER_LIMIT_MIB + 1,
            ..PersistentSettings::default()
        });

        assert_eq!(
            restored.streaming_full_buffer_limit_mib,
            MAX_STREAMING_FULL_BUFFER_LIMIT_MIB
        );
    }
}

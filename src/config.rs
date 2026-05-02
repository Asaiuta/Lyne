use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::Path;

// M-4 fix: Import SaturationType from processor module (single source of truth).
// Previously defined identically in both config.rs and saturation.rs.
pub use crate::processor::SaturationType;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum ResampleQuality {
    Low,
    Standard,
    High,
    UltraHigh,
}

/// Phase response for resampling filter
/// - Minimum: Lowest latency, some pre-echo reduction (value = 0)
/// - Linear: Default, symmetric impulse response (value = 50)  
/// - Maximum: Maximum phase linearization (value = 100)
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub enum PhaseResponse {
    #[default]
    Linear, // 50 - default, symmetric
    Minimum, // 0 - lowest latency
    Maximum, // 100 - maximum phase linearization
}

impl PhaseResponse {
    /// Convert to soxr phase_response value
    pub fn to_soxr_value(&self) -> f64 {
        match self {
            PhaseResponse::Minimum => 0.0,
            PhaseResponse::Linear => 50.0,
            PhaseResponse::Maximum => 100.0,
        }
    }
}

/// Loudness normalization mode
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub enum NormalizationMode {
    #[default]
    Track, // Track-based: analyze whole track on load (EBU R128)
    Album,           // Album mode: preserve relative loudness within album
    Streaming,       // Streaming: real-time adaptive adjustment
    ReplayGainTrack, // Use ReplayGain track gain from tags
    ReplayGainAlbum, // Use ReplayGain album gain from tags (fallback to track)
}

/// Loudness normalization configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoudnessConfig {
    /// Target loudness in LUFS
    /// - -23 LUFS: EBU R128 broadcast standard
    /// - -14 LUFS: Spotify/YouTube streaming standard  
    /// - -16 LUFS: Apple Music/Amazon standard
    pub target_lufs: f64,

    /// True peak limit in dBTP (default: -1.0)
    pub true_peak_limit_db: f64,

    /// Gain smoothing time in milliseconds (default: 100-500ms)
    pub smoothing_time_ms: f64,

    /// Normalization mode
    pub mode: NormalizationMode,

    /// Enable loudness normalization
    pub enabled: bool,

    /// ReplayGain reference loudness in LUFS
    /// - -18 LUFS: ReplayGain 2.0 reference
    /// - -14 LUFS: common legacy ReplayGain 1.0 tagging practice
    pub replaygain_reference_lufs: f64,
}

impl Default for LoudnessConfig {
    fn default() -> Self {
        Self {
            target_lufs: -12.0,       // Closer to domestic streaming platforms
            true_peak_limit_db: -0.5, // Safer headroom while preserving transients
            smoothing_time_ms: 200.0,
            mode: NormalizationMode::Track,
            enabled: true,
            replaygain_reference_lufs: -18.0,
        }
    }
}

// M-4 fix: SaturationType is now imported from processor::saturation (single definition).
// The duplicate definition that was here has been removed.

/// Saturation configuration for analog warmth
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaturationConfig {
    /// Saturation type (Tape, Tube, Transistor)
    pub sat_type: SaturationType,
    /// Drive amount (0.0 - 2.0)
    pub drive: f64,
    /// Threshold where saturation begins (0.0 - 1.0)
    pub threshold: f64,
    /// Mix between dry and wet (0.0 - 1.0)
    pub mix: f64,
    /// Input gain applied before saturation (dB)
    pub input_gain_db: f64,
    /// Output gain compensation applied after saturation (dB)
    pub output_gain_db: f64,
    /// Enable/disable saturation
    pub enabled: bool,
}

impl Default for SaturationConfig {
    fn default() -> Self {
        Self {
            sat_type: SaturationType::Tube,
            drive: 0.25,     // Lower drive for subtle warmth
            threshold: 0.88, // Higher threshold, only affect loud transients
            mix: 0.2,        // Lower mix for transparent effect
            input_gain_db: 0.0,
            output_gain_db: 0.0,
            enabled: true, // Enabled by default for analog warmth
        }
    }
}

/// Dynamic Loudness Compensation configuration
/// Based on ISO 226:2003 Equal-Loudness Contours (Fletcher-Munson effect)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynamicLoudnessConfig {
    /// Reference volume level in dB (above this, no compensation)
    /// Typical values: -15 dB (50% perceived loudness) to -20 dB
    pub ref_volume_db: f64,

    /// Transition range in dB (compensation range from ref to max)
    /// At ref_volume - transition_db, compensation is at maximum
    /// Typical: 25 dB (e.g., -15 to -40 dB)
    pub transition_db: f64,

    /// Strength multiplier (0.0 - 1.0)
    /// 0.0 = disabled, 1.0 = full compensation
    pub strength: f64,

    /// Pre-gain in dB to prevent clipping from bass boost
    /// Default: -3 dB headroom
    pub pre_gain_db: f64,

    /// Enable/disable dynamic loudness compensation
    pub enabled: bool,
}

impl Default for DynamicLoudnessConfig {
    fn default() -> Self {
        Self {
            ref_volume_db: -15.0, // ~50% perceived loudness
            transition_db: 25.0,  // Full compensation at -40 dB
            strength: 1.0,        // Full strength by default
            pre_gain_db: -3.0,    // Headroom for bass boost
            enabled: false,       // Persistent settings are the canonical default
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossfeedConfig {
    pub enabled: bool,
    pub mix: f64,
}

impl Default for CrossfeedConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            mix: 0.3,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DitherConfig {
    pub enabled: bool,
    pub noise_shaper_curve: crate::processor::NoiseShaperCurve,
}

impl Default for DitherConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            noise_shaper_curve: crate::processor::NoiseShaperCurve::Lipshitz5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineSettings {
    pub target_samplerate: Option<u32>,
    pub resample_quality: ResampleQuality,
    pub phase_response: PhaseResponse,
    pub use_cache: bool,
    pub preemptive_resample: bool,
    pub eq_type: String,
    pub volume: f32,
    pub device_id: Option<usize>,
    pub exclusive_mode: bool,
    pub loudness: LoudnessConfig,
    pub dynamic_loudness: DynamicLoudnessConfig,
    pub saturation: SaturationConfig,
    pub crossfeed: CrossfeedConfig,
    pub dither: DitherConfig,
    pub eq_bands: Option<HashMap<String, f64>>,
    pub fir_taps: Option<usize>,
    /// Output bit depth for noise shaper (M-1 fix: was hardcoded to 24)
    pub output_bits: u32,
}

#[derive(Debug, Clone)]
pub struct WebDavFallbackConfig {
    pub base_url: String,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RuntimeServerConfig {
    pub analysis_max_concurrency: usize,
    pub analysis_max_blocking_threads: usize,
    pub analysis_task_timeout_secs: u64,
    pub scan_task_max_entries: usize,
    pub scan_task_ttl_secs: u64,
    pub allowed_origins: Vec<String>,
    pub webdav_fallback: Option<WebDavFallbackConfig>,
}

#[derive(Debug, Clone)]
pub struct ResolvedConfig {
    pub settings: EngineSettings,
    pub server: RuntimeServerConfig,
}

impl Default for ResampleQuality {
    fn default() -> Self {
        Self::High
    }
}

impl Default for EngineSettings {
    fn default() -> Self {
        Self {
            target_samplerate: None,
            resample_quality: ResampleQuality::default(),
            phase_response: PhaseResponse::default(),
            use_cache: false,
            preemptive_resample: true,
            eq_type: "IIR".to_string(),
            volume: 0.7,
            device_id: None,
            exclusive_mode: false,
            loudness: LoudnessConfig::default(),
            dynamic_loudness: DynamicLoudnessConfig::default(),
            saturation: SaturationConfig::default(),
            crossfeed: CrossfeedConfig::default(),
            dither: DitherConfig::default(),
            eq_bands: None,
            fir_taps: Some(1023),
            output_bits: 24,
        }
    }
}

impl EngineSettings {
    pub fn load_from_file(path: &Path) -> Result<Self, String> {
        if !path.exists() {
            let settings = Self::from_env_defaults();
            settings.save(path)?;
            log::info!("Created default engine settings at {}", path.display());
            return Ok(settings);
        }

        let content = fs::read_to_string(path)
            .map_err(|e| format!("Failed to read engine settings '{}': {}", path.display(), e))?;
        let settings: Self = serde_json::from_str(&content).or_else(|engine_error| {
            serde_json::from_str::<LegacyPersistentSettings>(&content)
                .map(EngineSettings::from)
                .map_err(|legacy_error| {
                    format!(
                        "Failed to parse engine settings '{}': {}; legacy parse also failed: {}",
                        path.display(),
                        engine_error,
                        legacy_error
                    )
                })
        })?;
        log::info!("Loaded engine settings from {}", path.display());
        Ok(settings.normalized())
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "Failed to create settings directory '{}': {}",
                    parent.display(),
                    e
                )
            })?;
        }

        let content = serde_json::to_string_pretty(&self.clone().normalized())
            .map_err(|e| format!("Failed to serialize engine settings: {}", e))?;
        fs::write(path, content).map_err(|e| {
            format!(
                "Failed to write engine settings '{}': {}",
                path.display(),
                e
            )
        })
    }

    pub fn from_env_defaults() -> Self {
        // Load .env file if it exists
        dotenv::dotenv().ok();

        let target_samplerate = env::var("AUDIO_TARGET_SAMPLERATE")
            .ok()
            .and_then(|s| s.parse().ok());

        let resample_quality = match env::var("AUDIO_RESAMPLE_QUALITY")
            .unwrap_or_default()
            .as_str()
        {
            "low" => ResampleQuality::Low,
            "std" => ResampleQuality::Standard,
            "uhq" => ResampleQuality::UltraHigh,
            _ => ResampleQuality::High, // Default to High (hq)
        };

        let use_cache = env::var("AUDIO_USE_CACHE")
            .map(|s| s.to_lowercase() == "true")
            .unwrap_or(false);

        let preemptive_resample = env::var("AUDIO_PREEMPTIVE_RESAMPLE")
            .map(|s| s.to_lowercase() == "true")
            .unwrap_or(true);

        let eq_type = env::var("AUDIO_EQ_TYPE").unwrap_or_else(|_| "IIR".to_string());

        // Load loudness configuration with range validation (FIX for Defect 29)
        let loudness = LoudnessConfig {
            // target_lufs: typical range -30 to -6 LUFS (EBU R128: -23, streaming: -14 to -16)
            target_lufs: env::var("AUDIO_TARGET_LUFS")
                .ok()
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(-12.0)
                .clamp(-30.0, -6.0),
            // true_peak_limit_db: must be <= 0 to prevent clipping, >= -3 for reasonable headroom
            true_peak_limit_db: env::var("AUDIO_TRUE_PEAK_LIMIT")
                .ok()
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(-0.5)
                .clamp(-3.0, 0.0),
            // smoothing_time_ms: minimum 10ms to avoid audio artifacts, max 2000ms
            smoothing_time_ms: env::var("AUDIO_LOUDNESS_SMOOTHING_MS")
                .ok()
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(200.0)
                .clamp(10.0, 2000.0),
            mode: match env::var("AUDIO_NORMALIZATION_MODE")
                .unwrap_or_default()
                .to_lowercase()
                .as_str()
            {
                "album" => NormalizationMode::Album,
                "streaming" => NormalizationMode::Streaming,
                "replaygain_track" | "rg_track" => NormalizationMode::ReplayGainTrack,
                "replaygain_album" | "rg_album" => NormalizationMode::ReplayGainAlbum,
                _ => NormalizationMode::Track,
            },
            enabled: env::var("AUDIO_LOUDNESS_NORMALIZATION")
                .map(|s| s.to_lowercase() == "true")
                .unwrap_or(true),
            replaygain_reference_lufs: env::var("AUDIO_REPLAYGAIN_REFERENCE_LUFS")
                .ok()
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(-18.0)
                .clamp(-23.0, -12.0),
        };

        // Load phase response setting
        let phase_response = match env::var("AUDIO_PHASE_RESPONSE")
            .unwrap_or_default()
            .to_lowercase()
            .as_str()
        {
            "minimum" | "min" => PhaseResponse::Minimum,
            "maximum" | "max" => PhaseResponse::Maximum,
            _ => PhaseResponse::Linear, // Default
        };

        // Load saturation configuration with range validation (FIX for Defect 29)
        let saturation = SaturationConfig {
            sat_type: match env::var("AUDIO_SATURATION_TYPE")
                .unwrap_or_default()
                .to_lowercase()
                .as_str()
            {
                "tape" => SaturationType::Tape,
                "transistor" => SaturationType::Transistor,
                _ => SaturationType::Tube, // Default
            },
            // drive: 0.0 (no saturation) to 2.0 (heavy saturation)
            drive: env::var("AUDIO_SATURATION_DRIVE")
                .ok()
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(0.25)
                .clamp(0.0, 2.0),
            // threshold: 0.0 to 1.0 (normalized signal level)
            threshold: env::var("AUDIO_SATURATION_THRESHOLD")
                .ok()
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(0.88)
                .clamp(0.0, 1.0),
            // mix: 0.0 (dry) to 1.0 (wet)
            mix: env::var("AUDIO_SATURATION_MIX")
                .ok()
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(0.2)
                .clamp(0.0, 1.0),
            // input_gain_db: -20 to +20 dB
            input_gain_db: env::var("AUDIO_SATURATION_INPUT_GAIN")
                .ok()
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(0.0)
                .clamp(-20.0, 20.0),
            // output_gain_db: -20 to +20 dB
            output_gain_db: env::var("AUDIO_SATURATION_OUTPUT_GAIN")
                .ok()
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(0.0)
                .clamp(-20.0, 20.0),
            enabled: env::var("AUDIO_SATURATION_ENABLED")
                .map(|s| s.to_lowercase() == "true")
                .unwrap_or(true), // Enabled by default
        };

        // Load dynamic loudness compensation configuration
        let dynamic_loudness = DynamicLoudnessConfig {
            // ref_volume_db: -30 to 0 dB (typical: -15 to -20)
            ref_volume_db: env::var("AUDIO_DYNAMIC_LOUDNESS_REF_DB")
                .ok()
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(-15.0)
                .clamp(-30.0, 0.0),
            // transition_db: 10 to 40 dB (compensation range)
            transition_db: env::var("AUDIO_DYNAMIC_LOUDNESS_TRANSITION_DB")
                .ok()
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(25.0)
                .clamp(10.0, 40.0),
            // strength: 0.0 to 1.0
            strength: env::var("AUDIO_DYNAMIC_LOUDNESS_STRENGTH")
                .ok()
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(1.0)
                .clamp(0.0, 1.0),
            // pre_gain_db: -6 to 0 dB (headroom for bass boost)
            pre_gain_db: env::var("AUDIO_DYNAMIC_LOUDNESS_PRE_GAIN_DB")
                .ok()
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(-3.0)
                .clamp(-6.0, 0.0),
            enabled: env::var("AUDIO_DYNAMIC_LOUDNESS_ENABLED")
                .map(|s| s.to_lowercase() == "true")
                .unwrap_or(true), // Enabled by default
        };

        // Load output bit depth for noise shaper (M-1 fix)
        let output_bits = env::var("AUDIO_OUTPUT_BITS")
            .ok()
            .and_then(|s| s.parse::<u32>().ok())
            .map(|b| b.clamp(8, 32))
            .unwrap_or(24);

        log::info!("Loaded config: Quality={:?}, Phase={:?}, Cache={}, Preemptive={}, EQ={}, Loudness={} LUFS, DynamicLoudness={} (ref={}dB), Saturation={}",
            resample_quality, phase_response, use_cache, preemptive_resample, eq_type, loudness.target_lufs,
            dynamic_loudness.enabled, dynamic_loudness.ref_volume_db, saturation.enabled);

        Self {
            target_samplerate,
            resample_quality,
            phase_response,
            use_cache,
            preemptive_resample,
            eq_type,
            volume: 0.7,
            device_id: None,
            exclusive_mode: false,
            loudness,
            dynamic_loudness,
            saturation,
            crossfeed: CrossfeedConfig::default(),
            dither: DitherConfig::default(),
            eq_bands: None,
            fir_taps: Some(1023),
            output_bits,
        }
    }

    pub fn normalized(mut self) -> Self {
        self.volume = self.volume.clamp(0.0, 1.0);
        self.output_bits = self.output_bits.clamp(8, 32);
        self.loudness.target_lufs = self.loudness.target_lufs.clamp(-30.0, -6.0);
        self.loudness.true_peak_limit_db = self.loudness.true_peak_limit_db.clamp(-3.0, 0.0);
        self.loudness.smoothing_time_ms = self.loudness.smoothing_time_ms.clamp(10.0, 2000.0);
        self.loudness.replaygain_reference_lufs =
            self.loudness.replaygain_reference_lufs.clamp(-23.0, -12.0);
        self.saturation.drive = self.saturation.drive.clamp(0.0, 2.0);
        self.saturation.threshold = self.saturation.threshold.clamp(0.0, 1.0);
        self.saturation.mix = self.saturation.mix.clamp(0.0, 1.0);
        self.saturation.input_gain_db = self.saturation.input_gain_db.clamp(-20.0, 20.0);
        self.saturation.output_gain_db = self.saturation.output_gain_db.clamp(-20.0, 20.0);
        self.crossfeed.mix = self.crossfeed.mix.clamp(0.0, 1.0);
        self.dynamic_loudness.ref_volume_db = self.dynamic_loudness.ref_volume_db.clamp(-30.0, 0.0);
        self.dynamic_loudness.transition_db = self.dynamic_loudness.transition_db.clamp(10.0, 40.0);
        self.dynamic_loudness.strength = self.dynamic_loudness.strength.clamp(0.0, 1.0);
        self.dynamic_loudness.pre_gain_db = self.dynamic_loudness.pre_gain_db.clamp(-6.0, 0.0);
        self
    }

    pub fn apply_update(&mut self, update: EngineSettingsUpdate) {
        if let Some(volume) = update.volume {
            self.volume = volume.clamp(0.0, 1.0);
        }
        if let Some(device_id) = update.device_id {
            self.device_id = device_id;
        }
        if let Some(exclusive_mode) = update.exclusive_mode {
            self.exclusive_mode = exclusive_mode;
        }
        if let Some(eq_type) = update.eq_type {
            self.eq_type = eq_type;
        }
        if let Some(eq_bands) = update.eq_bands {
            self.eq_bands = Some(eq_bands);
        }
        if let Some(fir_taps) = update.fir_taps {
            self.fir_taps = Some(fir_taps);
        }
        if let Some(dither_enabled) = update.dither_enabled {
            self.dither.enabled = dither_enabled;
        }
        if let Some(output_bits) = update.output_bits {
            self.output_bits = output_bits.clamp(8, 32);
        }
        if let Some(curve) = update.noise_shaper_curve {
            self.dither.noise_shaper_curve = parse_noise_shaper_curve(&curve);
        }
        if let Some(loudness_enabled) = update.loudness_enabled {
            self.loudness.enabled = loudness_enabled;
        }
        if let Some(mode) = update.loudness_mode {
            self.loudness.mode = parse_normalization_mode(&mode);
        }
        if let Some(target_lufs) = update.target_lufs {
            self.loudness.target_lufs = target_lufs.clamp(-30.0, -6.0);
        }
        if let Some(preamp_db) = update.preamp_db {
            self.dynamic_loudness.pre_gain_db = preamp_db.clamp(-6.0, 0.0);
        }
        if let Some(saturation_enabled) = update.saturation_enabled {
            self.saturation.enabled = saturation_enabled;
        }
        if let Some(saturation_drive) = update.saturation_drive {
            self.saturation.drive = saturation_drive.clamp(0.0, 2.0);
        }
        if let Some(saturation_mix) = update.saturation_mix {
            self.saturation.mix = saturation_mix.clamp(0.0, 1.0);
        }
        if let Some(crossfeed_enabled) = update.crossfeed_enabled {
            self.crossfeed.enabled = crossfeed_enabled;
        }
        if let Some(crossfeed_mix) = update.crossfeed_mix {
            self.crossfeed.mix = crossfeed_mix.clamp(0.0, 1.0);
        }
        if let Some(dynamic_loudness_enabled) = update.dynamic_loudness_enabled {
            self.dynamic_loudness.enabled = dynamic_loudness_enabled;
        }
        if let Some(dynamic_loudness_strength) = update.dynamic_loudness_strength {
            self.dynamic_loudness.strength = dynamic_loudness_strength.clamp(0.0, 1.0);
        }
        if let Some(target_samplerate) = update.target_samplerate {
            self.target_samplerate = target_samplerate;
        }
        if let Some(quality) = update.resample_quality {
            self.resample_quality = parse_resample_quality(&quality);
        }
        if let Some(use_cache) = update.use_cache {
            self.use_cache = use_cache;
        }
        if let Some(preemptive_resample) = update.preemptive_resample {
            self.preemptive_resample = preemptive_resample;
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EngineSettingsUpdate {
    pub volume: Option<f32>,
    pub device_id: Option<Option<usize>>,
    pub exclusive_mode: Option<bool>,
    pub eq_type: Option<String>,
    pub eq_bands: Option<HashMap<String, f64>>,
    pub fir_taps: Option<usize>,
    pub dither_enabled: Option<bool>,
    pub output_bits: Option<u32>,
    pub noise_shaper_curve: Option<String>,
    pub loudness_enabled: Option<bool>,
    pub loudness_mode: Option<String>,
    pub target_lufs: Option<f64>,
    pub preamp_db: Option<f64>,
    pub saturation_enabled: Option<bool>,
    pub saturation_drive: Option<f64>,
    pub saturation_mix: Option<f64>,
    pub crossfeed_enabled: Option<bool>,
    pub crossfeed_mix: Option<f64>,
    pub dynamic_loudness_enabled: Option<bool>,
    pub dynamic_loudness_strength: Option<f64>,
    pub target_samplerate: Option<Option<u32>>,
    pub resample_quality: Option<String>,
    pub use_cache: Option<bool>,
    pub preemptive_resample: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
struct LegacyPersistentSettings {
    volume: f32,
    device_id: Option<usize>,
    exclusive_mode: bool,
    eq_type: String,
    eq_bands: Option<HashMap<String, f64>>,
    fir_taps: Option<usize>,
    dither_enabled: bool,
    output_bits: u32,
    noise_shaper_curve: String,
    loudness_enabled: bool,
    loudness_mode: String,
    target_lufs: f64,
    preamp_db: f64,
    saturation_enabled: bool,
    saturation_drive: f64,
    saturation_mix: f64,
    crossfeed_enabled: bool,
    crossfeed_mix: f64,
    dynamic_loudness_enabled: bool,
    dynamic_loudness_strength: f64,
    target_samplerate: Option<u32>,
    resample_quality: String,
    use_cache: bool,
    preemptive_resample: bool,
}

impl From<LegacyPersistentSettings> for EngineSettings {
    fn from(settings: LegacyPersistentSettings) -> Self {
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
        engine.normalized()
    }
}

impl RuntimeServerConfig {
    pub fn from_env() -> Self {
        dotenv::dotenv().ok();
        let analysis_max_concurrency = read_env_usize("ANALYSIS_MAX_CONCURRENCY", 2).max(1);
        let analysis_max_blocking_threads = read_env_usize(
            "ANALYSIS_MAX_BLOCKING_THREADS",
            analysis_max_concurrency.max(2),
        )
        .max(1);
        let analysis_task_timeout_secs = read_env_u64("ANALYSIS_TASK_TIMEOUT_SECS", 180).max(1);
        let scan_task_max_entries = read_env_usize("SCAN_TASK_MAX_ENTRIES", 512).max(1);
        let scan_task_ttl_secs = read_env_u64("SCAN_TASK_TTL_SECS", 600).max(1);
        let allowed_origins = configured_allowed_origins_from_env();
        let webdav_fallback = read_webdav_fallback_from_env();

        Self {
            analysis_max_concurrency,
            analysis_max_blocking_threads,
            analysis_task_timeout_secs,
            scan_task_max_entries,
            scan_task_ttl_secs,
            allowed_origins,
            webdav_fallback,
        }
    }
}

impl ResolvedConfig {
    pub fn new(settings: EngineSettings, server: RuntimeServerConfig) -> Self {
        Self {
            settings: settings.normalized(),
            server,
        }
    }
}

fn read_env_usize(key: &str, default: usize) -> usize {
    env::var(key)
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(default)
}

fn read_env_u64(key: &str, default: u64) -> u64 {
    env::var(key)
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(default)
}

fn configured_allowed_origins_from_env() -> Vec<String> {
    let configured = env::var("AUDIO_ALLOWED_ORIGINS")
        .ok()
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|origin| !origin.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if configured.is_empty() {
        return vec![
            "tauri://localhost".to_string(),
            "http://localhost:5173".to_string(),
            "http://127.0.0.1:5173".to_string(),
            "https://tauri.localhost".to_string(),
            "http://tauri.localhost".to_string(),
            "file://".to_string(),
            "null".to_string(),
        ];
    }

    configured
}

fn read_webdav_fallback_from_env() -> Option<WebDavFallbackConfig> {
    let base_url = env::var("WEBDAV_URL").unwrap_or_default();
    if base_url.trim().is_empty() {
        return None;
    }

    Some(WebDavFallbackConfig {
        base_url,
        username: env::var("WEBDAV_USER").ok(),
        password: env::var("WEBDAV_PASS").ok(),
    })
}

pub fn parse_resample_quality(value: &str) -> ResampleQuality {
    match value.to_lowercase().as_str() {
        "low" => ResampleQuality::Low,
        "std" | "standard" => ResampleQuality::Standard,
        "uhq" | "ultrahigh" | "ultra_high" => ResampleQuality::UltraHigh,
        _ => ResampleQuality::High,
    }
}

pub fn resample_quality_to_string(value: ResampleQuality) -> String {
    match value {
        ResampleQuality::Low => "low".to_string(),
        ResampleQuality::Standard => "std".to_string(),
        ResampleQuality::High => "hq".to_string(),
        ResampleQuality::UltraHigh => "uhq".to_string(),
    }
}

pub fn parse_normalization_mode(value: &str) -> NormalizationMode {
    match value.to_lowercase().as_str() {
        "album" => NormalizationMode::Album,
        "streaming" => NormalizationMode::Streaming,
        "replaygain_track" | "rg_track" => NormalizationMode::ReplayGainTrack,
        "replaygain_album" | "rg_album" => NormalizationMode::ReplayGainAlbum,
        _ => NormalizationMode::Track,
    }
}

pub fn normalization_mode_to_string(value: NormalizationMode) -> String {
    match value {
        NormalizationMode::Track => "track".to_string(),
        NormalizationMode::Album => "album".to_string(),
        NormalizationMode::Streaming => "streaming".to_string(),
        NormalizationMode::ReplayGainTrack => "replaygain_track".to_string(),
        NormalizationMode::ReplayGainAlbum => "replaygain_album".to_string(),
    }
}

pub fn parse_noise_shaper_curve(value: &str) -> crate::processor::NoiseShaperCurve {
    match value.to_lowercase().as_str() {
        "fweighted9" | "f_weighted9" | "f-weighted9" => {
            crate::processor::NoiseShaperCurve::FWeighted9
        }
        "modifiede9" | "modified_e9" | "modified-e9" => {
            crate::processor::NoiseShaperCurve::ModifiedE9
        }
        "improvede9" | "improved_e9" | "improved-e9" => {
            crate::processor::NoiseShaperCurve::ImprovedE9
        }
        "tpdfonly" | "tpdf_only" | "tpdf-only" => crate::processor::NoiseShaperCurve::TpdfOnly,
        _ => crate::processor::NoiseShaperCurve::Lipshitz5,
    }
}

pub fn noise_shaper_curve_to_string(value: crate::processor::NoiseShaperCurve) -> String {
    match value {
        crate::processor::NoiseShaperCurve::Lipshitz5 => "Lipshitz5".to_string(),
        crate::processor::NoiseShaperCurve::FWeighted9 => "FWeighted9".to_string(),
        crate::processor::NoiseShaperCurve::ModifiedE9 => "ModifiedE9".to_string(),
        crate::processor::NoiseShaperCurve::ImprovedE9 => "ImprovedE9".to_string(),
        crate::processor::NoiseShaperCurve::TpdfOnly => "TpdfOnly".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn unique_settings_path(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time should be after UNIX_EPOCH")
            .as_nanos();
        env::temp_dir().join(format!("audio_engine_{name}_{nanos}.json"))
    }

    #[test]
    fn engine_settings_default_uses_persistent_defaults() {
        let settings = EngineSettings::default();

        assert_eq!(settings.volume, 0.7);
        assert_eq!(settings.output_bits, 24);
        assert!(!settings.dynamic_loudness.enabled);
        assert_eq!(settings.fir_taps, Some(1023));
        assert_eq!(settings.resample_quality, ResampleQuality::High);
    }

    #[test]
    fn engine_settings_round_trips_json() {
        let path = unique_settings_path("roundtrip");
        let mut settings = EngineSettings::default();
        settings.volume = 0.42;
        settings.dynamic_loudness.enabled = true;

        settings.save(&path).expect("settings should save");
        let loaded = EngineSettings::load_from_file(&path).expect("settings should load");
        let _ = fs::remove_file(&path);

        assert!((loaded.volume - 0.42).abs() < f32::EPSILON);
        assert!(loaded.dynamic_loudness.enabled);
    }

    #[test]
    fn engine_settings_missing_file_bootstraps_default_file() {
        let path = unique_settings_path("missing");
        let settings =
            EngineSettings::load_from_file(&path).expect("missing settings should bootstrap");
        let exists = path.exists();
        let _ = fs::remove_file(&path);

        assert!(exists);
        assert_eq!(settings.output_bits, 24);
    }

    #[test]
    fn runtime_server_config_reads_and_clamps_env_defaults() {
        env::set_var("ANALYSIS_MAX_CONCURRENCY", "0");
        env::set_var("ANALYSIS_MAX_BLOCKING_THREADS", "4");
        env::set_var("ANALYSIS_TASK_TIMEOUT_SECS", "0");
        env::set_var("SCAN_TASK_MAX_ENTRIES", "32");
        env::set_var("SCAN_TASK_TTL_SECS", "90");
        env::set_var(
            "AUDIO_ALLOWED_ORIGINS",
            "http://example.test, http://localhost:5173",
        );
        env::set_var("WEBDAV_URL", "https://dav.example.test");
        env::set_var("WEBDAV_USER", "user");
        env::set_var("WEBDAV_PASS", "pass");

        let config = RuntimeServerConfig::from_env();

        env::remove_var("ANALYSIS_MAX_CONCURRENCY");
        env::remove_var("ANALYSIS_MAX_BLOCKING_THREADS");
        env::remove_var("ANALYSIS_TASK_TIMEOUT_SECS");
        env::remove_var("SCAN_TASK_MAX_ENTRIES");
        env::remove_var("SCAN_TASK_TTL_SECS");
        env::remove_var("AUDIO_ALLOWED_ORIGINS");
        env::remove_var("WEBDAV_URL");
        env::remove_var("WEBDAV_USER");
        env::remove_var("WEBDAV_PASS");

        assert_eq!(config.analysis_max_concurrency, 1);
        assert_eq!(config.analysis_max_blocking_threads, 4);
        assert_eq!(config.analysis_task_timeout_secs, 1);
        assert_eq!(config.scan_task_max_entries, 32);
        assert_eq!(config.scan_task_ttl_secs, 90);
        assert_eq!(config.allowed_origins.len(), 2);
        let fallback = config
            .webdav_fallback
            .expect("webdav fallback should be present");
        assert_eq!(fallback.base_url, "https://dav.example.test");
        assert_eq!(fallback.username.as_deref(), Some("user"));
        assert_eq!(fallback.password.as_deref(), Some("pass"));
    }

    #[test]
    fn engine_settings_loads_legacy_persistent_settings_shape() {
        let path = unique_settings_path("legacy");
        let legacy = serde_json::json!({
            "volume": 0.25,
            "device_id": null,
            "exclusive_mode": false,
            "eq_type": "IIR",
            "eq_bands": null,
            "fir_taps": 1023,
            "dither_enabled": true,
            "output_bits": 24,
            "noise_shaper_curve": "Lipshitz5",
            "loudness_enabled": true,
            "loudness_mode": "track",
            "target_lufs": -12.0,
            "preamp_db": -2.0,
            "saturation_enabled": true,
            "saturation_drive": 0.5,
            "saturation_mix": 0.2,
            "crossfeed_enabled": true,
            "crossfeed_mix": 0.4,
            "dynamic_loudness_enabled": true,
            "dynamic_loudness_strength": 0.8,
            "target_samplerate": null,
            "resample_quality": "uhq",
            "use_cache": true,
            "preemptive_resample": false
        });
        fs::write(
            &path,
            serde_json::to_string_pretty(&legacy).expect("legacy json should serialize"),
        )
        .expect("legacy settings should write");

        let settings = EngineSettings::load_from_file(&path).expect("legacy settings should load");
        let _ = fs::remove_file(&path);

        assert!((settings.volume - 0.25).abs() < f32::EPSILON);
        assert_eq!(settings.resample_quality, ResampleQuality::UltraHigh);
        assert!(settings.crossfeed.enabled);
        assert!(settings.dynamic_loudness.enabled);
    }
}

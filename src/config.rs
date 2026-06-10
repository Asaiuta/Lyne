use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::Path;

pub use audio_engine_core::config::{
    CrossfeedConfig, DitherConfig, DynamicLoudnessConfig, LoudnessConfig, NormalizationMode,
    PhaseResponse, ResampleQuality, SaturationConfig, SaturationType,
};

pub const ENV_AUDIO_CACHE_MAX_BYTES: &str = "AUDIO_CACHE_MAX_BYTES";
pub const DEFAULT_CACHE_MAX_BYTES: u64 = 10 * 1024 * 1024 * 1024;
pub const DEFAULT_STREAMING_FULL_BUFFER_LIMIT_MIB: u64 = 256;
pub const MAX_STREAMING_FULL_BUFFER_LIMIT_MIB: u64 = 4096;

fn env_flag(name: &str, default: bool) -> bool {
    env::var(name)
        .map(|s| s.eq_ignore_ascii_case("true"))
        .unwrap_or(default)
}

fn env_parse<T>(name: &str) -> Option<T>
where
    T: std::str::FromStr,
{
    env::var(name).ok().and_then(|s| s.parse::<T>().ok())
}

fn env_parse_clamped<T>(name: &str, default: T, min: T, max: T) -> T
where
    T: std::str::FromStr + PartialOrd + Copy,
{
    let value = env_parse(name).unwrap_or(default);
    if value < min {
        min
    } else if value > max {
        max
    } else {
        value
    }
}

fn env_string(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn env_string_or(name: &str, default: &str) -> String {
    env_string(name).unwrap_or_else(|| default.to_string())
}

fn env_parse_or<T>(name: &str, default: T) -> T
where
    T: std::str::FromStr + Copy,
{
    env_parse(name).unwrap_or(default)
}

const CANONICAL_EQ_BAND_NAMES: [&str; 10] = [
    "31", "62", "125", "250", "500", "1000", "2000", "4000", "8000", "16000",
];

fn canonicalize_eq_band_name(name: &str) -> Option<&'static str> {
    match name {
        "31" => Some("31"),
        "62" => Some("62"),
        "125" => Some("125"),
        "250" => Some("250"),
        "500" => Some("500"),
        "1000" | "1k" => Some("1000"),
        "2000" | "2k" => Some("2000"),
        "4000" | "4k" => Some("4000"),
        "8000" | "8k" => Some("8000"),
        "16000" | "16k" => Some("16000"),
        _ => None,
    }
}

pub fn normalize_eq_bands(
    bands: HashMap<String, f64>,
    on_unknown: impl FnMut(&str),
) -> HashMap<String, f64> {
    let mut on_unknown = on_unknown;
    let mut normalized = HashMap::with_capacity(CANONICAL_EQ_BAND_NAMES.len());
    for (name, gain) in bands {
        if let Some(canonical) = canonicalize_eq_band_name(name.as_str()) {
            normalized.insert(canonical.to_string(), gain);
        } else {
            on_unknown(name.as_str());
        }
    }
    normalized
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineSettings {
    pub target_samplerate: Option<u32>,
    pub resample_quality: ResampleQuality,
    pub phase_response: PhaseResponse,
    pub use_cache: bool,
    pub preemptive_resample: bool,
    #[serde(default)]
    pub streaming_first_buffer: bool,
    #[serde(default = "default_streaming_full_buffer_limit_mib")]
    pub streaming_full_buffer_limit_mib: u64,
    #[serde(default = "default_use_next_prefetch")]
    pub use_next_prefetch: bool,
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
    pub library_scan_max_concurrency: usize,
    pub library_scan_max_workers: usize,
    pub library_scan_cover_max_bytes: u64,
    pub scan_task_max_entries: usize,
    pub scan_task_ttl_secs: u64,
    pub cache_max_bytes: u64,
    pub allowed_origins: Vec<String>,
    pub webdav_fallback: Option<WebDavFallbackConfig>,
}

#[derive(Debug, Clone)]
pub struct ResolvedConfig {
    pub settings: EngineSettings,
    pub server: RuntimeServerConfig,
}

impl Default for EngineSettings {
    fn default() -> Self {
        Self {
            target_samplerate: None,
            resample_quality: ResampleQuality::default(),
            phase_response: PhaseResponse::default(),
            use_cache: false,
            preemptive_resample: true,
            streaming_first_buffer: false,
            streaming_full_buffer_limit_mib: DEFAULT_STREAMING_FULL_BUFFER_LIMIT_MIB,
            use_next_prefetch: true,
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
        let settings: Self = serde_json::from_str(&content).map_err(|e| {
            format!(
                "Failed to parse engine settings '{}': {}",
                path.display(),
                e
            )
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

        let target_samplerate = env_parse("AUDIO_TARGET_SAMPLERATE");

        let resample_quality =
            parse_resample_quality(env_string_or("AUDIO_RESAMPLE_QUALITY", "hq").as_str());

        let use_cache = env_flag("AUDIO_USE_CACHE", false);

        let preemptive_resample = env_flag("AUDIO_PREEMPTIVE_RESAMPLE", true);
        let streaming_first_buffer = env_flag("AUDIO_STREAMING_FIRST_BUFFER", false);
        let streaming_full_buffer_limit_mib = env_parse_clamped(
            "AUDIO_STREAMING_FULL_BUFFER_LIMIT_MIB",
            DEFAULT_STREAMING_FULL_BUFFER_LIMIT_MIB,
            0,
            MAX_STREAMING_FULL_BUFFER_LIMIT_MIB,
        );

        let use_next_prefetch = env_flag("AUDIO_USE_NEXT_PREFETCH", true);

        let eq_type = env_string_or("AUDIO_EQ_TYPE", "IIR");

        // Load loudness configuration with range validation (FIX for Defect 29)
        let loudness = LoudnessConfig {
            // target_lufs: typical range -30 to -6 LUFS (EBU R128: -23, streaming: -14 to -16)
            target_lufs: env_parse_clamped("AUDIO_TARGET_LUFS", -12.0, -30.0, -6.0),
            // true_peak_limit_db: must be <= 0 to prevent clipping, >= -3 for reasonable headroom
            true_peak_limit_db: env_parse_clamped("AUDIO_TRUE_PEAK_LIMIT", -0.5, -3.0, 0.0),
            // smoothing_time_ms: minimum 10ms to avoid audio artifacts, max 2000ms
            smoothing_time_ms: env_parse_clamped(
                "AUDIO_LOUDNESS_SMOOTHING_MS",
                200.0,
                10.0,
                2000.0,
            ),
            mode: parse_normalization_mode(
                env_string_or("AUDIO_NORMALIZATION_MODE", "track").as_str(),
            ),
            enabled: env_flag("AUDIO_LOUDNESS_NORMALIZATION", true),
            replaygain_reference_lufs: env_parse_clamped(
                "AUDIO_REPLAYGAIN_REFERENCE_LUFS",
                -18.0,
                -23.0,
                -12.0,
            ),
        };

        // Load phase response setting
        let phase_response =
            parse_phase_response(env_string_or("AUDIO_PHASE_RESPONSE", "linear").as_str());

        // Load saturation configuration with range validation (FIX for Defect 29)
        let saturation = SaturationConfig {
            sat_type: parse_saturation_type(
                env_string_or("AUDIO_SATURATION_TYPE", "tube").as_str(),
            ),
            // drive: 0.0 (no saturation) to 2.0 (heavy saturation)
            drive: env_parse_clamped("AUDIO_SATURATION_DRIVE", 0.25, 0.0, 2.0),
            // threshold: 0.0 to 1.0 (normalized signal level)
            threshold: env_parse_clamped("AUDIO_SATURATION_THRESHOLD", 0.88, 0.0, 1.0),
            // mix: 0.0 (dry) to 1.0 (wet)
            mix: env_parse_clamped("AUDIO_SATURATION_MIX", 0.2, 0.0, 1.0),
            // input_gain_db: -20 to +20 dB
            input_gain_db: env_parse_clamped("AUDIO_SATURATION_INPUT_GAIN", 0.0, -20.0, 20.0),
            // output_gain_db: -20 to +20 dB
            output_gain_db: env_parse_clamped("AUDIO_SATURATION_OUTPUT_GAIN", 0.0, -20.0, 20.0),
            enabled: env_flag("AUDIO_SATURATION_ENABLED", true), // Enabled by default
        };

        // Load dynamic loudness compensation configuration
        let dynamic_loudness = DynamicLoudnessConfig {
            // ref_volume_db: -30 to 0 dB (typical: -15 to -20)
            ref_volume_db: env_parse_clamped("AUDIO_DYNAMIC_LOUDNESS_REF_DB", -15.0, -30.0, 0.0),
            // transition_db: 10 to 40 dB (compensation range)
            transition_db: env_parse_clamped(
                "AUDIO_DYNAMIC_LOUDNESS_TRANSITION_DB",
                25.0,
                10.0,
                40.0,
            ),
            // strength: 0.0 to 1.0
            strength: env_parse_clamped("AUDIO_DYNAMIC_LOUDNESS_STRENGTH", 1.0, 0.0, 1.0),
            // pre_gain_db: -6 to 0 dB (headroom for bass boost)
            pre_gain_db: env_parse_clamped("AUDIO_DYNAMIC_LOUDNESS_PRE_GAIN_DB", -3.0, -6.0, 0.0),
            enabled: env_flag("AUDIO_DYNAMIC_LOUDNESS_ENABLED", true), // Enabled by default
        };

        // Load output bit depth for noise shaper (M-1 fix)
        let output_bits = env_parse_clamped("AUDIO_OUTPUT_BITS", 24_u32, 8_u32, 32_u32);

        log::info!("Loaded config: Quality={:?}, Phase={:?}, Cache={}, Preemptive={}, StreamingFirstBuffer={}, StreamingFullBufferLimitMiB={}, EQ={}, Loudness={} LUFS, DynamicLoudness={} (ref={}dB), Saturation={}",
            resample_quality, phase_response, use_cache, preemptive_resample, streaming_first_buffer, streaming_full_buffer_limit_mib, eq_type, loudness.target_lufs,
            dynamic_loudness.enabled, dynamic_loudness.ref_volume_db, saturation.enabled);

        Self {
            target_samplerate,
            resample_quality,
            phase_response,
            use_cache,
            preemptive_resample,
            streaming_first_buffer,
            streaming_full_buffer_limit_mib,
            use_next_prefetch,
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
        self.streaming_full_buffer_limit_mib = self
            .streaming_full_buffer_limit_mib
            .min(MAX_STREAMING_FULL_BUFFER_LIMIT_MIB);
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
        if let Some(eq_bands) = self.eq_bands.take() {
            self.eq_bands = Some(normalize_eq_bands(eq_bands, |_| {}));
        }
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
            self.eq_bands = Some(normalize_eq_bands(eq_bands, |_| {}));
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
        if let Some(streaming_first_buffer) = update.streaming_first_buffer {
            self.streaming_first_buffer = streaming_first_buffer;
        }
        if let Some(streaming_full_buffer_limit_mib) = update.streaming_full_buffer_limit_mib {
            self.streaming_full_buffer_limit_mib =
                streaming_full_buffer_limit_mib.min(MAX_STREAMING_FULL_BUFFER_LIMIT_MIB);
        }
        if let Some(use_next_prefetch) = update.use_next_prefetch {
            self.use_next_prefetch = use_next_prefetch;
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EngineSettingsUpdate {
    pub volume: Option<f32>,
    /// Tri-state PATCH semantics:
    /// - `None`: leave existing device selection unchanged
    /// - `Some(Some(id))`: select the given output device
    /// - `Some(None)`: clear the current device selection
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
    /// Tri-state PATCH semantics:
    /// - `None`: leave current target samplerate unchanged
    /// - `Some(Some(rate))`: set an explicit target samplerate
    /// - `Some(None)`: clear the target and follow source / device defaults
    pub target_samplerate: Option<Option<u32>>,
    pub resample_quality: Option<String>,
    pub use_cache: Option<bool>,
    pub preemptive_resample: Option<bool>,
    pub streaming_first_buffer: Option<bool>,
    pub streaming_full_buffer_limit_mib: Option<u64>,
    pub use_next_prefetch: Option<bool>,
}

fn default_streaming_full_buffer_limit_mib() -> u64 {
    DEFAULT_STREAMING_FULL_BUFFER_LIMIT_MIB
}

fn default_use_next_prefetch() -> bool {
    true
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
        let library_scan_max_concurrency =
            read_env_usize("LIBRARY_SCAN_MAX_CONCURRENCY", 1).clamp(1, 4);
        let library_scan_max_workers = read_env_usize("LIBRARY_SCAN_MAX_WORKERS", 2).clamp(1, 8);
        let library_scan_cover_max_bytes =
            read_env_u64("LIBRARY_SCAN_COVER_MAX_BYTES", 8 * 1024 * 1024).max(1);
        let scan_task_max_entries = read_env_usize("SCAN_TASK_MAX_ENTRIES", 512).max(1);
        let scan_task_ttl_secs = read_env_u64("SCAN_TASK_TTL_SECS", 600).max(1);
        let cache_max_bytes = read_env_u64(ENV_AUDIO_CACHE_MAX_BYTES, DEFAULT_CACHE_MAX_BYTES);
        let allowed_origins = configured_allowed_origins_from_env();
        let webdav_fallback = read_webdav_fallback_from_env();

        Self {
            analysis_max_concurrency,
            analysis_max_blocking_threads,
            analysis_task_timeout_secs,
            library_scan_max_concurrency,
            library_scan_max_workers,
            library_scan_cover_max_bytes,
            scan_task_max_entries,
            scan_task_ttl_secs,
            cache_max_bytes,
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
    env_parse_or(key, default)
}

fn read_env_u64(key: &str, default: u64) -> u64 {
    env_parse_or(key, default)
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

pub fn parse_phase_response(value: &str) -> PhaseResponse {
    match value.to_lowercase().as_str() {
        "minimum" | "min" => PhaseResponse::Minimum,
        "maximum" | "max" => PhaseResponse::Maximum,
        _ => PhaseResponse::Linear,
    }
}

pub fn parse_saturation_type(value: &str) -> SaturationType {
    match value.to_lowercase().as_str() {
        "tape" => SaturationType::Tape,
        "transistor" => SaturationType::Transistor,
        _ => SaturationType::Tube,
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
        assert!(settings.use_next_prefetch);
        assert_eq!(
            settings.streaming_full_buffer_limit_mib,
            DEFAULT_STREAMING_FULL_BUFFER_LIMIT_MIB
        );
        assert_eq!(settings.fir_taps, Some(1023));
        assert_eq!(settings.resample_quality, ResampleQuality::High);
    }

    #[test]
    fn engine_settings_normalized_clamps_streaming_full_buffer_limit() {
        let settings = EngineSettings {
            streaming_full_buffer_limit_mib: MAX_STREAMING_FULL_BUFFER_LIMIT_MIB + 1,
            ..EngineSettings::default()
        }
        .normalized();

        assert_eq!(
            settings.streaming_full_buffer_limit_mib,
            MAX_STREAMING_FULL_BUFFER_LIMIT_MIB
        );
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
        env::set_var("LIBRARY_SCAN_MAX_CONCURRENCY", "0");
        env::set_var("LIBRARY_SCAN_MAX_WORKERS", "0");
        env::set_var("LIBRARY_SCAN_COVER_MAX_BYTES", "1048576");
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
        env::remove_var("LIBRARY_SCAN_MAX_CONCURRENCY");
        env::remove_var("LIBRARY_SCAN_MAX_WORKERS");
        env::remove_var("LIBRARY_SCAN_COVER_MAX_BYTES");
        env::remove_var("SCAN_TASK_MAX_ENTRIES");
        env::remove_var("SCAN_TASK_TTL_SECS");
        env::remove_var("AUDIO_ALLOWED_ORIGINS");
        env::remove_var("WEBDAV_URL");
        env::remove_var("WEBDAV_USER");
        env::remove_var("WEBDAV_PASS");

        assert_eq!(config.analysis_max_concurrency, 1);
        assert_eq!(config.analysis_max_blocking_threads, 4);
        assert_eq!(config.analysis_task_timeout_secs, 1);
        assert_eq!(config.library_scan_max_concurrency, 1);
        assert_eq!(config.library_scan_max_workers, 1);
        assert_eq!(config.library_scan_cover_max_bytes, 1_048_576);
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
    fn normalize_eq_bands_maps_legacy_aliases_to_canonical_names() {
        let bands = HashMap::from([
            ("1k".to_string(), 1.5),
            ("2k".to_string(), -0.5),
            ("16000".to_string(), 0.75),
        ]);

        let normalized = normalize_eq_bands(bands, |_| {});

        assert_eq!(normalized.get("1000"), Some(&1.5));
        assert_eq!(normalized.get("2000"), Some(&-0.5));
        assert_eq!(normalized.get("16000"), Some(&0.75));
        assert!(!normalized.contains_key("1k"));
        assert!(!normalized.contains_key("2k"));
    }

    #[test]
    fn engine_settings_normalized_rewrites_eq_band_aliases() {
        let settings = EngineSettings {
            eq_bands: Some(HashMap::from([
                ("1k".to_string(), 2.0),
                ("4k".to_string(), -1.0),
            ])),
            ..EngineSettings::default()
        }
        .normalized();

        let bands = settings.eq_bands.expect("eq bands should remain present");
        assert_eq!(bands.get("1000"), Some(&2.0));
        assert_eq!(bands.get("4000"), Some(&-1.0));
        assert!(!bands.contains_key("1k"));
        assert!(!bands.contains_key("4k"));
    }
}

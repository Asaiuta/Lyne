use serde::{Deserialize, Serialize};

pub use crate::processor::SaturationType;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum ResampleQuality {
    Low,
    Standard,
    High,
    UltraHigh,
}

impl Default for ResampleQuality {
    fn default() -> Self {
        Self::High
    }
}

/// Phase response for resampling filter.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub enum PhaseResponse {
    #[default]
    Linear,
    Minimum,
    Maximum,
}

impl PhaseResponse {
    /// Convert to soxr phase_response value.
    pub fn to_soxr_value(&self) -> f64 {
        match self {
            PhaseResponse::Minimum => 0.0,
            PhaseResponse::Linear => 50.0,
            PhaseResponse::Maximum => 100.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub enum NormalizationMode {
    #[default]
    Track,
    Album,
    Streaming,
    ReplayGainTrack,
    ReplayGainAlbum,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoudnessConfig {
    pub target_lufs: f64,
    pub true_peak_limit_db: f64,
    pub smoothing_time_ms: f64,
    pub mode: NormalizationMode,
    pub enabled: bool,
    pub replaygain_reference_lufs: f64,
}

impl Default for LoudnessConfig {
    fn default() -> Self {
        Self {
            target_lufs: -12.0,
            true_peak_limit_db: -0.5,
            smoothing_time_ms: 200.0,
            mode: NormalizationMode::Track,
            enabled: true,
            replaygain_reference_lufs: -18.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaturationConfig {
    pub sat_type: SaturationType,
    pub drive: f64,
    pub threshold: f64,
    pub mix: f64,
    pub input_gain_db: f64,
    pub output_gain_db: f64,
    pub enabled: bool,
}

impl Default for SaturationConfig {
    fn default() -> Self {
        Self {
            sat_type: SaturationType::Tube,
            drive: 0.25,
            threshold: 0.88,
            mix: 0.2,
            input_gain_db: 0.0,
            output_gain_db: 0.0,
            enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynamicLoudnessConfig {
    pub ref_volume_db: f64,
    pub transition_db: f64,
    pub strength: f64,
    pub pre_gain_db: f64,
    pub enabled: bool,
}

impl Default for DynamicLoudnessConfig {
    fn default() -> Self {
        Self {
            ref_volume_db: -15.0,
            transition_db: 25.0,
            strength: 1.0,
            pre_gain_db: -3.0,
            enabled: false,
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

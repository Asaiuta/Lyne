//! Request / response DTOs for the HTTP handlers, plus the shared `ApiResponse`
//! envelope and the small `HttpResponse` helpers (success / bad_request / etc.)
//! that handler modules use to build status-correct payloads.
//!
//! Fields are kept at `pub(crate)` so sibling handler modules (`playback::*`,
//! `effects`, `webdav_handlers`, ...) can read/build them after the move,
//! matching the visibility they had implicitly when they shared a single file.

use actix_web::{http::StatusCode, HttpResponse};
use serde::{Deserialize, Serialize};

use crate::player::AudioDeviceInfo;

#[derive(Deserialize)]
pub struct LoadRequest {
    pub(crate) path: String,
    pub(crate) autoplay: Option<bool>,
    pub(crate) source_key: Option<String>,
}

#[derive(Deserialize)]
pub struct WebDavConfigureRequest {
    pub(crate) base_url: String,
    pub(crate) username: Option<String>,
    pub(crate) password: Option<String>,
}

#[derive(Deserialize)]
pub struct WebDavSourceUpsertRequest {
    pub(crate) source_key: String,
    pub(crate) display_name: Option<String>,
    pub(crate) base_url: String,
    pub(crate) username: Option<String>,
    pub(crate) password: Option<String>,
    pub(crate) is_default: Option<bool>,
}

#[derive(Deserialize)]
pub struct WebDavDefaultRequest {
    pub(crate) source_key: String,
}

#[derive(Deserialize)]
pub struct WebDavBrowseRequest {
    pub(crate) path: Option<String>,
}

#[derive(Deserialize)]
pub struct SeekRequest {
    pub(crate) position: f64,
}

#[derive(Deserialize)]
pub struct VolumeRequest {
    pub(crate) volume: f32,
}

#[derive(Deserialize)]
pub struct ConfigureOutputRequest {
    pub(crate) device_id: Option<usize>,
    pub(crate) exclusive: Option<bool>,
}

#[derive(Deserialize)]
pub struct ConfigureUpsamplingRequest {
    pub(crate) target_samplerate: Option<u32>,
}

#[derive(Deserialize)]
pub struct SetEqRequest {
    pub(crate) bands: Option<std::collections::HashMap<String, f64>>,
    pub(crate) enabled: Option<bool>,
}

#[derive(Deserialize)]
pub struct SetEqTypeRequest {
    #[serde(rename = "type")]
    pub(crate) eq_type: String,
    /// Number of FIR taps (only used when eq_type is "FIR")
    /// Default: 1023, recommended range: 255-4095
    pub(crate) fir_taps: Option<usize>,
}

#[derive(Deserialize)]
pub struct ConfigureOptimizationsRequest {
    pub(crate) dither_enabled: Option<bool>,
    pub(crate) replaygain_enabled: Option<bool>,
}

#[derive(Deserialize)]
pub struct ConfigureNormalizationRequest {
    pub(crate) enabled: Option<bool>,
    pub(crate) target_lufs: Option<f64>,
    pub(crate) mode: Option<String>, // "track" / "album" / "streaming"
    pub(crate) album_gain_db: Option<f64>,
    pub(crate) preamp_db: Option<f64>,
}

#[derive(Deserialize)]
pub struct ScanBackgroundRequest {
    pub(crate) path: String,
    pub(crate) store: Option<bool>, // Whether to store in database (default: true)
    pub(crate) source_key: Option<String>,
}

#[derive(Deserialize)]
pub struct QueueNextRequest {
    pub(crate) path: String,
    pub(crate) source_key: Option<String>,
    pub(crate) entry_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct LoadIrRequest {
    pub(crate) path: String,
}

#[derive(Deserialize)]
pub struct SetCrossfeedRequest {
    pub(crate) enabled: Option<bool>,
    pub(crate) mix: Option<f64>,
}

#[derive(Deserialize)]
pub struct SetSaturationRequest {
    pub(crate) enabled: Option<bool>,
    pub(crate) drive: Option<f64>,
    pub(crate) threshold: Option<f64>,
    pub(crate) mix: Option<f64>,
    pub(crate) input_gain_db: Option<f64>,
    pub(crate) output_gain_db: Option<f64>,
    pub(crate) highpass_mode: Option<bool>,
    pub(crate) highpass_cutoff: Option<f64>,
}

#[derive(Deserialize)]
pub struct SetDynamicLoudnessRequest {
    pub(crate) enabled: Option<bool>,
    pub(crate) strength: Option<f64>, // 0.0 - 1.0
}

#[derive(Deserialize)]
pub struct SetNoiseShaperCurveRequest {
    pub(crate) curve: String, // "Lipshitz5", "FWeighted9", "ModifiedE9", "ImprovedE9", "TpdfOnly"
}

#[derive(Deserialize)]
pub struct SetOutputBitsRequest {
    pub(crate) bits: u32, // 16, 24, or 32
}

#[derive(Serialize)]
#[allow(dead_code)]
pub struct LoadingStatusResponse {
    pub(crate) is_loading: bool,
    pub(crate) progress: u64,
    pub(crate) error: Option<String>,
}

#[derive(Serialize)]
#[allow(dead_code)]
pub struct IrStatusResponse {
    pub(crate) ir_loaded: bool,
}

#[derive(Serialize)]
pub struct StateResponse {
    pub(crate) is_playing: bool,
    pub(crate) is_paused: bool,
    pub(crate) is_loading: bool,
    pub(crate) duration: f64,
    pub(crate) current_time: f64,
    pub(crate) file_path: Option<String>,
    pub(crate) media_id: Option<String>,
    pub(crate) ncm_song_id: Option<i64>,
    pub(crate) ncm_source_page_url: Option<String>,
    pub(crate) volume: f32,
    pub(crate) device_id: Option<usize>,
    pub(crate) exclusive_mode: bool,
    pub(crate) eq_type: String,
    pub(crate) dither_enabled: bool,
    pub(crate) replaygain_enabled: bool,
    pub(crate) loudness_enabled: bool,
    // Loudness normalization extended fields
    pub(crate) loudness_mode: String,
    pub(crate) target_lufs: f64,
    pub(crate) preamp_db: f64,
    // ReplayGain fields
    pub(crate) rg_track_gain: Option<f64>,
    pub(crate) rg_album_gain: Option<f64>,
    pub(crate) rg_track_peak: Option<f64>,
    pub(crate) rg_album_peak: Option<f64>,
    // Saturation fields
    pub(crate) saturation_enabled: bool,
    pub(crate) saturation_drive: f64,
    pub(crate) saturation_mix: f64,
    // Crossfeed fields
    pub(crate) crossfeed_enabled: bool,
    pub(crate) crossfeed_mix: f64,
    // Dynamic Loudness fields
    pub(crate) dynamic_loudness_enabled: bool,
    pub(crate) dynamic_loudness_strength: f64,
    pub(crate) dynamic_loudness_factor: f64,
    // Noise shaper fields
    pub(crate) output_bits: u32,
    pub(crate) noise_shaper_curve: String,
    // Resampling fields
    pub(crate) target_samplerate: Option<u32>,
    pub(crate) resample_quality: String,
    pub(crate) use_cache: bool,
    pub(crate) preemptive_resample: bool,
    // Track metadata
    pub(crate) title: Option<String>,
    pub(crate) artist: Option<String>,
    pub(crate) album: Option<String>,
    pub(crate) track_number: Option<u32>,
    pub(crate) disc_number: Option<u32>,
    pub(crate) genre: Option<String>,
    pub(crate) year: Option<u32>,
    pub(crate) has_cover_art: bool,
    pub(crate) external_artwork_url: Option<String>,
    pub(crate) repeat_mode: String,
    pub(crate) shuffle_mode: String,
}

#[derive(Serialize)]
pub struct ApiResponse {
    pub(crate) status: String,
    pub(crate) message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) state: Option<StateResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) devices: Option<DevicesResponse>,
}

#[derive(Serialize)]
pub struct DevicesResponse {
    pub(crate) preferred: Vec<AudioDeviceInfo>,
    pub(crate) other: Vec<AudioDeviceInfo>,
    pub(crate) preferred_name: String,
}

impl ApiResponse {
    pub(crate) fn success(msg: impl Into<String>) -> Self {
        Self {
            status: "success".into(),
            message: Some(msg.into()),
            state: None,
            devices: None,
        }
    }

    pub(crate) fn success_with_state(msg: impl Into<String>, state: StateResponse) -> Self {
        Self {
            status: "success".into(),
            message: Some(msg.into()),
            state: Some(state),
            devices: None,
        }
    }

    pub(crate) fn error(msg: impl Into<String>) -> Self {
        Self {
            status: "error".into(),
            message: Some(msg.into()),
            state: None,
            devices: None,
        }
    }
}

pub(crate) fn success_response(message: impl Into<String>) -> HttpResponse {
    HttpResponse::Ok().json(ApiResponse::success(message))
}

pub(crate) fn error_response(status: StatusCode, message: impl Into<String>) -> HttpResponse {
    HttpResponse::build(status).json(ApiResponse::error(message))
}

pub(crate) fn bad_request_response(message: impl Into<String>) -> HttpResponse {
    error_response(StatusCode::BAD_REQUEST, message)
}

pub(crate) fn bad_gateway_response(message: impl Into<String>) -> HttpResponse {
    error_response(StatusCode::BAD_GATEWAY, message)
}

pub(crate) fn unauthorized_response(message: impl Into<String>) -> HttpResponse {
    error_response(StatusCode::UNAUTHORIZED, message)
}

pub(crate) fn not_found_response(message: impl Into<String>) -> HttpResponse {
    error_response(StatusCode::NOT_FOUND, message)
}

pub(crate) fn too_many_requests_response(message: impl Into<String>) -> HttpResponse {
    error_response(StatusCode::TOO_MANY_REQUESTS, message)
}

pub(crate) fn internal_server_error_response(message: impl Into<String>) -> HttpResponse {
    error_response(StatusCode::INTERNAL_SERVER_ERROR, message)
}

pub(crate) fn gateway_timeout_response(message: impl Into<String>) -> HttpResponse {
    error_response(StatusCode::GATEWAY_TIMEOUT, message)
}

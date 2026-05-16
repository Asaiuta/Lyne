//! HTTP/WebSocket Server
//!
//! REST API compatible with existing frontend, with WebSocket for spectrum data.

use actix_cors::Cors;
use actix_web::http::header;
use actix_web::{
    dev::ServerHandle,
    http::{Method, StatusCode},
    middleware, web, App, HttpResponse, HttpServer,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::runtime::{Builder as TokioRuntimeBuilder, Runtime as TokioRuntime};
use tokio::sync::Semaphore;
use tokio::time::timeout;

use crate::app_database::{AppDatabase, PlaybackRuntimeSnapshot};
use crate::config::{EngineSettings, ResolvedConfig};
use crate::player::{AudioDeviceInfo, AudioPlayer, PlayerState};
use crate::processor::LoudnessDatabase;
use crate::runtime::RuntimePaths;
use crate::settings::PersistentSettingsUpdate;
use crate::settings::SharedSettingsManager;
use crate::webdav::WebDavConfig;

/// Environment variable that carries the per-run bearer token from the Tauri host
/// (or any supervising process) to the audio sidecar. Required at startup; an empty
/// or missing value aborts the server.
pub const ENV_AUDIO_API_TOKEN: &str = "AUDIO_API_TOKEN";

/// Application state shared across handlers
pub struct AppState {
    pub player: Mutex<AudioPlayer>,
    pub webdav_config: Mutex<WebDavConfig>,
    pub ncm_client: Arc<ncm_api_rs::ApiClient>,
    pub app_db: Arc<AppDatabase>,
    /// Persistent settings manager
    pub settings_manager: SharedSettingsManager,
    /// Analysis and scan job state.
    pub analysis: AnalysisState,
    /// Playback-specific domain state.
    pub playback: PlaybackDomainState,
    /// Runtime directories and files, retained for local diagnostics without
    /// exposing their absolute paths.
    pub runtime_paths: RuntimePaths,
}

/// Local control-plane state shared by auth, WebSocket upgrade, and shutdown.
/// Kept separate from AppState so domain handlers do not carry server lifecycle
/// fields they do not use.
pub struct ServerControlState {
    /// Per-run bearer token shared with the supervising Tauri host. Validated by
    /// the auth middleware on every HTTP route and by the WebSocket handshake.
    pub api_token: Arc<String>,
    /// Local-only graceful shutdown handle
    pub shutdown_handle: Mutex<Option<ServerHandle>>,
}

/// Analysis/runtime state grouped away from the rest of the application domain
/// so handlers only touch the concerns they actually need.
pub struct AnalysisState {
    /// Database for pre-computed loudness metadata
    pub loudness_db: Mutex<Option<LoudnessDatabase>>,
    /// Dedicated runtime for CPU/IO-heavy analysis jobs
    pub analysis_runtime: Arc<AnalysisRuntime>,
    /// Concurrency guard for analysis jobs to avoid starving playback/control plane
    pub analysis_semaphore: Arc<Semaphore>,
    /// Configured analysis concurrency limit.
    pub analysis_max_concurrency: usize,
    /// Background scan task records
    pub scan_tasks: Mutex<HashMap<u64, ScanTaskRecord>>,
    /// Task id counter
    pub scan_task_counter: AtomicU64,
    /// Max retained scan task records
    pub scan_task_max_entries: usize,
    /// TTL for finished scan task records in seconds
    pub scan_task_ttl_secs: u64,
    /// Max runtime cache footprint in bytes before cleanup prunes oldest cache files.
    pub cache_max_bytes: u64,
    /// Milliseconds from server entry to ready signal.
    pub startup_ready_ms: AtomicU64,
    /// Max time for one analysis job before timeout
    pub analysis_task_timeout_secs: u64,
    /// Last observed WebDAV browse latency in milliseconds.
    pub webdav_last_latency_ms: AtomicU64,
    /// Highest observed WebDAV browse latency in milliseconds for this process.
    pub webdav_max_latency_ms: AtomicU64,
    /// Count of WebDAV browse attempts in this process.
    pub webdav_request_count: AtomicU64,
    /// Count of WebDAV browse failures in this process.
    pub webdav_error_count: AtomicU64,
}

/// Playback-domain state that is shared by handlers and the playback supervisor.
pub struct PlaybackDomainState {
    /// Active playback session id in the domain database
    pub active_session_id: Mutex<Option<i64>>,
    /// Backend-owned NCM scrobble session accumulator
    pub ncm_scrobble: Mutex<NcmScrobbleState>,
}

#[derive(Default)]
pub struct NcmScrobbleState {
    pub sessions: HashMap<i64, NcmScrobbleSession>,
}

pub struct NcmScrobbleSession {
    pub source_path: String,
    pub song_id: i64,
    pub accumulated: Duration,
    pub segment_started_at: Option<Instant>,
}

/// Own the dedicated analysis runtime and guarantee it is torn down on a plain
/// OS thread even when the enclosing app state drops inside an async context.
pub struct AnalysisRuntime {
    inner: Option<TokioRuntime>,
}

impl AnalysisRuntime {
    fn new(runtime: TokioRuntime) -> Self {
        Self {
            inner: Some(runtime),
        }
    }

    fn handle(&self) -> Option<tokio::runtime::Handle> {
        self.inner.as_ref().map(|rt| rt.handle().clone())
    }
}

impl Drop for AnalysisRuntime {
    fn drop(&mut self) {
        if let Some(runtime) = self.inner.take() {
            let join_handle = std::thread::spawn(move || {
                runtime.shutdown_timeout(Duration::from_secs(2));
            });
            let _ = join_handle.join();
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanTaskRecord {
    pub status: String,
    pub created_at_epoch_secs: u64,
    pub updated_at_epoch_secs: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<JsonValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

mod diagnostics;
mod effects;
mod lyrics;
mod netease;
mod playback;
mod settings_handlers;
mod webdav_handlers;
mod ws_events;
mod ws_handlers;

pub mod auth;

async fn run_analysis_job<T, F>(data: &web::Data<Arc<AppState>>, job: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let permit = Arc::clone(&data.analysis.analysis_semaphore)
        .acquire_owned()
        .await
        .map_err(|e| format!("Analysis semaphore closed: {}", e))?;

    let handle = data
        .analysis
        .analysis_runtime
        .handle()
        .ok_or_else(|| "Analysis runtime unavailable (shutdown in progress)".to_string())?;
    let join_handle = handle.spawn_blocking(move || {
        let _permit = permit;
        job()
    });

    let timeout_secs = data.analysis.analysis_task_timeout_secs.max(1);
    let join_result = timeout(Duration::from_secs(timeout_secs), join_handle)
        .await
        .map_err(|_| format!("Analysis task timed out after {}s", timeout_secs))?;

    join_result.map_err(|e| format!("Analysis worker join error: {}", e))?
}

// ============ Path Security ============

/// Validate file paths to prevent traversal and probing.
///
/// - HTTP(S) URLs are allowed (they have their own security model)
/// - Local paths are validated to prevent directory traversal
/// - Local paths MUST exist and be accessible (canonicalize must succeed)
/// - Returns Ok(validated_path) or Err(error_message)
pub(crate) fn validate_path(path: &str) -> Result<String, String> {
    // Allow HTTP(S) URLs - they have their own security (TLS, authentication)
    if looks_like_http_url(path) {
        if path.contains("..") || path.contains('\\') {
            return Err("Invalid URL: path traversal characters not allowed".into());
        }
        let url = reqwest::Url::parse(path)
            .map_err(|e| format!("Invalid URL '{}': {}", path, e))?;
        validate_remote_media_url(&url)?;
        return Ok(url.to_string());
    }

    // Local file path validation
    let path = std::path::Path::new(path);

    // Check for path traversal attempts.
    // Only reject actual parent-dir components, not filenames that merely
    // contain consecutive dots such as `song..demo.flac`.
    let path_str = path.to_string_lossy();
    if path
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("Path traversal not allowed: '..' path segment found".into());
    }

    // On Windows, also check for drive letter injection
    #[cfg(windows)]
    {
        // Reject UNC/network paths but allow Windows extended-length local paths
        // like `\\?\D:\Music\Track.flac`, which are produced by canonicalize().
        let is_extended_local_path = path_str
            .strip_prefix("\\\\?\\")
            .and_then(|rest| {
                let mut chars = rest.chars();
                match (chars.next(), chars.next(), chars.next()) {
                    (Some(drive), Some(':'), Some('\\' | '/')) if drive.is_ascii_alphabetic() => {
                        Some(())
                    }
                    _ => None,
                }
            })
            .is_some();

        // Check for UNC path injection (\\server\share)
        if path_str.starts_with("\\\\") && !is_extended_local_path {
            return Err("UNC paths not allowed".into());
        }
        // Check for reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_uppercase();
        let reserved = [
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
            "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        ];
        if reserved.contains(&file_name.as_str()) {
            return Err(format!("Reserved device name not allowed: {}", file_name));
        }
    }

    // Require canonicalization to succeed for local paths. This prevents:
    // 1. Path probing attacks (determining if arbitrary paths exist)
    // 2. Symlink attacks (following symlinks outside intended directories)
    // 3. Race conditions (TOCTOU)
    match path.canonicalize() {
        Ok(canonical) => {
            // Path exists and is accessible - return canonical path
            Ok(canonical.to_string_lossy().to_string())
        }
        Err(e) => {
            // Reject paths that don't exist or aren't accessible.
            log::warn!("Path validation rejected: '{}' - {}", path.display(), e);
            Err(format!(
                "File not found or inaccessible: {}",
                path.display()
            ))
        }
    }
}

fn looks_like_http_url(path: &str) -> bool {
    path.get(..7)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("http://"))
        || path
            .get(..8)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"))
}

fn validate_remote_media_url(url: &reqwest::Url) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Invalid URL: only http and https schemes are allowed".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Invalid URL: embedded credentials are not allowed".into());
    }
    if url.as_str().contains('\\') || url.path().contains("..") {
        return Err("Invalid URL: path traversal characters not allowed".into());
    }

    let host = url
        .host_str()
        .ok_or_else(|| "Invalid URL: missing host".to_string())?;
    if is_private_host(host) {
        return Err(format!(
            "URL host '{}' is not allowed (private/internal address)",
            host
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_path;
    use std::fs;

    #[test]
    fn validate_path_allows_public_https_urls() {
        let validated = validate_path("https://example.com/music/song.flac?token=abc").unwrap();
        assert_eq!(validated, "https://example.com/music/song.flac?token=abc");
    }

    #[test]
    fn validate_path_rejects_internal_url_hosts() {
        for url in [
            "http://localhost/song.flac",
            "http://LOCALHOST./song.flac",
            "http://127.0.0.1/song.flac",
            "http://10.0.0.8/song.flac",
            "http://172.16.4.2/song.flac",
            "http://192.168.1.2/song.flac",
            "http://169.254.1.2/song.flac",
            "http://[::1]/song.flac",
            "http://[fe80::1]/song.flac",
            "http://[fc00::1]/song.flac",
            "http://[::ffff:127.0.0.1]/song.flac",
        ] {
            assert!(validate_path(url).is_err(), "expected '{}' to be rejected", url);
        }
    }

    #[test]
    fn validate_path_rejects_ambiguous_numeric_url_hosts() {
        for url in [
            "http://2130706433/song.flac",
            "http://0177.0.0.1/song.flac",
            "http://0x7f000001/song.flac",
            "http://0x7f.0x00.0x00.0x01/song.flac",
        ] {
            assert!(validate_path(url).is_err(), "expected '{}' to be rejected", url);
        }
    }

    #[test]
    fn validate_path_rejects_url_traversal_and_credentials() {
        for url in [
            "https://example.com/../secret.flac",
            "https://example.com/music\\secret.flac",
            "https://user:password@example.com/song.flac",
        ] {
            assert!(validate_path(url).is_err(), "expected '{}' to be rejected", url);
        }
    }

    #[test]
    #[cfg(windows)]
    fn validate_path_allows_extended_local_paths() {
        let temp_dir = std::env::temp_dir().join("audio_player_validate_path");
        fs::create_dir_all(&temp_dir).unwrap();
        let track_path = temp_dir.join("track.flac");
        fs::write(&track_path, b"test").unwrap();

        let canonical = track_path.canonicalize().unwrap();
        let canonical_str = canonical.to_string_lossy().to_string();
        assert!(
            canonical_str.starts_with(r"\\?\"),
            "expected canonical path to use extended-length syntax, got {}",
            canonical_str
        );

        let validated = validate_path(&canonical_str).unwrap();
        assert_eq!(validated, canonical_str);

        let _ = fs::remove_file(&track_path);
        let _ = fs::remove_dir(&temp_dir);
    }

    #[test]
    #[cfg(windows)]
    fn validate_path_allows_filenames_with_double_dots() {
        let temp_dir = std::env::temp_dir().join("audio_player_validate_path_double_dots");
        fs::create_dir_all(&temp_dir).unwrap();
        let track_path = temp_dir.join("song..demo.flac");
        fs::write(&track_path, b"test").unwrap();

        let validated = validate_path(&track_path.to_string_lossy()).unwrap();
        assert!(validated.to_lowercase().contains("song..demo.flac"));

        let _ = fs::remove_file(&track_path);
        let _ = fs::remove_dir(&temp_dir);
    }

    #[test]
    #[cfg(windows)]
    fn validate_path_rejects_parent_dir_segments() {
        let result = validate_path(r"D:\music\..\secret.flac");
        assert!(result.is_err());
    }
}

/// Check if a host is a private/internal address (SSRF protection)
fn is_private_host(host: &str) -> bool {
    let host = host
        .trim_matches('.')
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") {
        return true;
    }

    if let Ok(ip) = host.parse::<IpAddr>() {
        return is_private_ip(ip);
    }

    is_ambiguous_numeric_host(&host)
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_private_ipv4(ip),
        IpAddr::V6(ip) => is_private_ipv6(ip),
    }
}

fn is_private_ipv4(ip: Ipv4Addr) -> bool {
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
}

fn is_private_ipv6(ip: Ipv6Addr) -> bool {
    ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_unique_local()
        || ip.is_unicast_link_local()
        || ip.is_multicast()
        || ip.to_ipv4_mapped().is_some_and(is_private_ipv4)
}

fn is_ambiguous_numeric_host(host: &str) -> bool {
    if host.is_empty() {
        return false;
    }
    if host.chars().all(|ch| ch.is_ascii_digit() || ch == '.') {
        return true;
    }
    if host
        .strip_prefix("0x")
        .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|ch| ch.is_ascii_hexdigit()))
    {
        return true;
    }
    host.contains('.')
        && host.split('.').all(|part| {
            !part.is_empty()
                && (part.chars().all(|ch| ch.is_ascii_digit())
                    || part.strip_prefix("0x").is_some_and(|rest| {
                        !rest.is_empty() && rest.chars().all(|ch| ch.is_ascii_hexdigit())
                    }))
        })
}

// ============ Request/Response Types ============

#[derive(Deserialize)]
pub struct LoadRequest {
    path: String,
    autoplay: Option<bool>,
}

#[derive(Deserialize)]
pub struct WebDavConfigureRequest {
    base_url: String,
    username: Option<String>,
    password: Option<String>,
}

#[derive(Deserialize)]
pub struct WebDavSourceUpsertRequest {
    source_key: String,
    display_name: Option<String>,
    base_url: String,
    username: Option<String>,
    password: Option<String>,
    is_default: Option<bool>,
}

#[derive(Deserialize)]
pub struct WebDavDefaultRequest {
    source_key: String,
}

#[derive(Deserialize)]
pub struct WebDavBrowseRequest {
    path: Option<String>,
}

#[derive(Deserialize)]
pub struct SeekRequest {
    position: f64,
}

#[derive(Deserialize)]
pub struct VolumeRequest {
    volume: f32,
}

#[derive(Deserialize)]
pub struct ConfigureOutputRequest {
    device_id: Option<usize>,
    exclusive: Option<bool>,
}

#[derive(Deserialize)]
pub struct ConfigureUpsamplingRequest {
    target_samplerate: Option<u32>,
}

#[derive(Deserialize)]
pub struct SetEqRequest {
    bands: Option<std::collections::HashMap<String, f64>>,
    enabled: Option<bool>,
}

#[derive(Deserialize)]
pub struct SetEqTypeRequest {
    #[serde(rename = "type")]
    eq_type: String,
    /// Number of FIR taps (only used when eq_type is "FIR")
    /// Default: 1023, recommended range: 255-4095
    fir_taps: Option<usize>,
}

#[derive(Deserialize)]
pub struct ConfigureOptimizationsRequest {
    dither_enabled: Option<bool>,
    replaygain_enabled: Option<bool>,
}

#[derive(Deserialize)]
pub struct ConfigureNormalizationRequest {
    enabled: Option<bool>,
    target_lufs: Option<f64>,
    mode: Option<String>, // "track" / "album" / "streaming"
    album_gain_db: Option<f64>,
    preamp_db: Option<f64>,
}

#[derive(Deserialize)]
pub struct ScanBackgroundRequest {
    path: String,
    store: Option<bool>, // Whether to store in database (default: true)
}

#[derive(Deserialize)]
pub struct QueueNextRequest {
    path: String,
    // Optional: WebDAV auth (if path is HTTP URL)
    username: Option<String>,
    password: Option<String>,
}

#[derive(Deserialize)]
pub struct LoadIrRequest {
    path: String,
}

#[derive(Deserialize)]
pub struct SetCrossfeedRequest {
    enabled: Option<bool>,
    mix: Option<f64>,
}

#[derive(Deserialize)]
pub struct SetSaturationRequest {
    enabled: Option<bool>,
    drive: Option<f64>,
    threshold: Option<f64>,
    mix: Option<f64>,
    input_gain_db: Option<f64>,
    output_gain_db: Option<f64>,
    highpass_mode: Option<bool>,
    highpass_cutoff: Option<f64>,
}

#[derive(Deserialize)]
pub struct SetDynamicLoudnessRequest {
    enabled: Option<bool>,
    strength: Option<f64>, // 0.0 - 1.0
}

#[derive(Deserialize)]
pub struct SetNoiseShaperCurveRequest {
    curve: String, // "Lipshitz5", "FWeighted9", "ModifiedE9", "ImprovedE9", "TpdfOnly"
}

#[derive(Deserialize)]
pub struct SetOutputBitsRequest {
    bits: u32, // 16, 24, or 32
}

#[derive(Serialize)]
pub struct LoadingStatusResponse {
    is_loading: bool,
    progress: u64,
    error: Option<String>,
}

#[derive(Serialize)]
pub struct IrStatusResponse {
    ir_loaded: bool,
}

#[derive(Serialize)]
pub struct StateResponse {
    is_playing: bool,
    is_paused: bool,
    is_loading: bool,
    duration: f64,
    current_time: f64,
    file_path: Option<String>,
    media_id: Option<String>,
    ncm_song_id: Option<i64>,
    ncm_source_page_url: Option<String>,
    volume: f32,
    device_id: Option<usize>,
    exclusive_mode: bool,
    eq_type: String,
    dither_enabled: bool,
    replaygain_enabled: bool,
    loudness_enabled: bool,
    // Loudness normalization extended fields
    loudness_mode: String,
    target_lufs: f64,
    preamp_db: f64,
    // ReplayGain fields
    rg_track_gain: Option<f64>,
    rg_album_gain: Option<f64>,
    rg_track_peak: Option<f64>,
    rg_album_peak: Option<f64>,
    // Saturation fields
    saturation_enabled: bool,
    saturation_drive: f64,
    saturation_mix: f64,
    // Crossfeed fields
    crossfeed_enabled: bool,
    crossfeed_mix: f64,
    // Dynamic Loudness fields
    dynamic_loudness_enabled: bool,
    dynamic_loudness_strength: f64,
    dynamic_loudness_factor: f64,
    // Noise shaper fields
    output_bits: u32,
    noise_shaper_curve: String,
    // Resampling fields
    target_samplerate: Option<u32>,
    resample_quality: String,
    use_cache: bool,
    preemptive_resample: bool,
    // Track metadata
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    track_number: Option<u32>,
    disc_number: Option<u32>,
    genre: Option<String>,
    year: Option<u32>,
    has_cover_art: bool,
    external_artwork_url: Option<String>,
    repeat_mode: String,
    shuffle_mode: String,
}

#[derive(Serialize)]
pub struct ApiResponse {
    status: String,
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<StateResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    devices: Option<DevicesResponse>,
}

#[derive(Serialize)]
pub struct DevicesResponse {
    preferred: Vec<AudioDeviceInfo>,
    other: Vec<AudioDeviceInfo>,
    preferred_name: String,
}

impl ApiResponse {
    fn success(msg: impl Into<String>) -> Self {
        Self {
            status: "success".into(),
            message: Some(msg.into()),
            state: None,
            devices: None,
        }
    }

    fn success_with_state(msg: impl Into<String>, state: StateResponse) -> Self {
        Self {
            status: "success".into(),
            message: Some(msg.into()),
            state: Some(state),
            devices: None,
        }
    }

    fn error(msg: impl Into<String>) -> Self {
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

// ============ Helper Functions ============

/// Apply persisted settings to player after runtime settings updates.
fn apply_settings_to_player(player: &mut AudioPlayer, settings: &EngineSettings) {
    // Volume
    player.set_volume(settings.volume as f64);

    // Device settings are applied separately via configure_output API

    // EQ
    if settings.eq_type == "FIR" {
        let taps = settings.fir_taps.unwrap_or(1023);
        let _ = player.enable_fir_eq(taps);
    } else {
        *player.shared_state().eq_type.write() = "IIR".to_string();
    }

    if let Some(ref bands) = settings.eq_bands {
        // Build gains array from bands map
        let band_map: std::collections::HashMap<&str, usize> = [
            ("31", 0),
            ("62", 1),
            ("125", 2),
            ("250", 3),
            ("500", 4),
            ("1000", 5),
            ("2000", 6),
            ("4000", 7),
            ("8000", 8),
            ("16000", 9),
            ("1k", 5),
            ("2k", 6),
            ("4k", 7),
            ("8k", 8),
            ("16k", 9),
        ]
        .into_iter()
        .collect();

        if player.is_fir_eq_enabled() {
            let mut gains = [0.0_f64; 10];
            for (name, &gain) in bands {
                if let Some(&idx) = band_map.get(name.as_str()) {
                    gains[idx] = gain;
                }
            }
            let _ = player.set_fir_bands(&gains);
        } else {
            // IIR EQ (lock-free)
            for (name, &gain) in bands {
                if let Some(&idx) = band_map.get(name.as_str()) {
                    player.lockfree_eq_params.set_band_gain(idx, gain);
                }
            }
        }
    }

    // Dither (state only; lock-free audio path currently does not host NoiseShaper stage)
    player.dither_enabled = settings.dither.enabled;
    player.set_output_bits(settings.output_bits);
    let _ = player.set_noise_shaper_curve(settings.dither.noise_shaper_curve);

    // Loudness
    player.set_loudness_enabled(settings.loudness.enabled);
    player.set_target_lufs(settings.loudness.target_lufs);
    player.set_preamp_gain(settings.dynamic_loudness.pre_gain_db);
    player.set_normalization_mode(settings.loudness.mode);

    // Saturation
    player.set_saturation_enabled(settings.saturation.enabled);
    player.set_saturation_drive(settings.saturation.drive);
    player.set_saturation_mix(settings.saturation.mix);

    // Crossfeed
    player.set_crossfeed_enabled(settings.crossfeed.enabled);
    player.set_crossfeed_mix(settings.crossfeed.mix);

    // Dynamic Loudness
    player.set_dynamic_loudness_enabled(settings.dynamic_loudness.enabled);
    player.set_dynamic_loudness_strength(settings.dynamic_loudness.strength);

    // Resampling
    player.target_sample_rate = settings.target_samplerate;
    player.set_resample_quality(settings.resample_quality);
    player.set_use_cache(settings.use_cache);
    player.set_preemptive_resample(settings.preemptive_resample);
}

fn get_player_state(player: &AudioPlayer) -> StateResponse {
    let shared = player.shared_state();
    let state = player.get_state();

    // Get real values from SharedState
    let volume = shared.volume.load(std::sync::atomic::Ordering::Relaxed) as f32 / 1_000_000.0;
    let device_id = shared.device_id.load(std::sync::atomic::Ordering::Relaxed);
    let file_path = shared
        .current_track_path
        .read()
        .clone()
        .or_else(|| shared.file_path.read().clone());
    let media_id = file_path
        .as_deref()
        .map(crate::app_database::media_id_for_path);
    let eq_type = shared.eq_type.read().clone();

    // Get track metadata
    let metadata = shared.track_metadata.read();

    // Get loudness normalization info
    let loudness_info = player.get_loudness_info();
    let loudness_mode = match player.get_normalization_mode() {
        crate::config::NormalizationMode::Track => "track".to_string(),
        crate::config::NormalizationMode::Album => "album".to_string(),
        crate::config::NormalizationMode::Streaming => "streaming".to_string(),
        crate::config::NormalizationMode::ReplayGainTrack => "replaygain_track".to_string(),
        crate::config::NormalizationMode::ReplayGainAlbum => "replaygain_album".to_string(),
    };

    // Get saturation info
    let saturation_info = player.get_saturation_info();

    // Get crossfeed info
    let crossfeed_info = player.get_crossfeed_info();

    // Get noise shaper info
    let noise_shaper_curve = player.get_noise_shaper_curve();

    StateResponse {
        is_playing: state == PlayerState::Playing,
        is_paused: state == PlayerState::Paused,
        is_loading: shared.is_loading.load(std::sync::atomic::Ordering::Relaxed),
        duration: shared.duration_secs(),
        current_time: shared.current_time_secs(),
        file_path,
        media_id,
        ncm_song_id: None,
        ncm_source_page_url: None,
        volume,
        device_id: if device_id >= 0 {
            Some(device_id as usize)
        } else {
            None
        },
        exclusive_mode: player.exclusive_mode,
        eq_type,
        dither_enabled: player.dither_enabled,
        replaygain_enabled: player.replaygain_enabled,
        loudness_enabled: player.loudness_enabled,
        // Loudness normalization extended fields
        loudness_mode,
        target_lufs: player.get_target_lufs(),
        preamp_db: loudness_info.preamp_db,
        // ReplayGain fields
        rg_track_gain: metadata.rg_track_gain,
        rg_album_gain: metadata.rg_album_gain,
        rg_track_peak: metadata.rg_track_peak,
        rg_album_peak: metadata.rg_album_peak,
        // Saturation fields
        saturation_enabled: saturation_info.enabled,
        saturation_drive: saturation_info.drive,
        saturation_mix: saturation_info.mix,
        // Crossfeed fields
        crossfeed_enabled: crossfeed_info.enabled,
        crossfeed_mix: crossfeed_info.mix,
        // Dynamic Loudness fields
        dynamic_loudness_enabled: player.is_dynamic_loudness_enabled(),
        dynamic_loudness_strength: player.get_dynamic_loudness_strength(),
        dynamic_loudness_factor: player.get_dynamic_loudness_factor(),
        // Noise shaper fields
        output_bits: player.get_output_bits(),
        noise_shaper_curve,
        // Resampling fields
        target_samplerate: player.target_sample_rate,
        resample_quality: player.get_resample_quality(),
        use_cache: player.get_use_cache(),
        preemptive_resample: player.get_preemptive_resample(),
        // Track metadata
        title: metadata.title.clone(),
        artist: metadata.artist.clone(),
        album: metadata.album.clone(),
        track_number: metadata.track_number,
        disc_number: metadata.disc_number,
        genre: metadata.genre.clone(),
        year: metadata.year,
        has_cover_art: metadata.cover_art.is_some(),
        external_artwork_url: None,
        repeat_mode: shared.repeat_mode().as_str().to_string(),
        shuffle_mode: shared.shuffle_mode().as_str().to_string(),
    }
}

fn get_enriched_player_state(
    player: &AudioPlayer,
    app_db: &crate::app_database::AppDatabase,
) -> StateResponse {
    let mut state = get_player_state(player);
    enrich_state_from_media_database(app_db, &mut state);
    state
}

fn enrich_state_from_media_database(
    app_db: &crate::app_database::AppDatabase,
    state: &mut StateResponse,
) {
    let Some(path) = state.file_path.as_deref() else {
        return;
    };

    let Ok(Some(item)) = app_db.media_metadata_for_path(path) else {
        return;
    };

    if state.media_id.is_none() {
        state.media_id = Some(item.media_id);
    }
    if state
        .title
        .as_deref()
        .map_or(true, |value| value.trim().is_empty())
    {
        state.title = item.title;
    }
    if state
        .artist
        .as_deref()
        .map_or(true, |value| value.trim().is_empty())
    {
        state.artist = item.artist;
    }
    if state
        .album
        .as_deref()
        .map_or(true, |value| value.trim().is_empty())
    {
        state.album = item.album;
    }
    if state.duration <= 0.0 {
        if let Some(duration) = item.duration_secs {
            state.duration = duration;
        }
    }
    state.has_cover_art = state.has_cover_art || item.has_cover_art;
    if state.external_artwork_url.is_none() {
        state.external_artwork_url = item.external_artwork_url;
    }

    if let Ok(Some(source)) = app_db.ncm_track_source_for_path(path) {
        state.ncm_song_id = Some(source.song_id);
        state.ncm_source_page_url = source.source_page_url;
    }
}

fn build_runtime_snapshot(player: &AudioPlayer) -> PlaybackRuntimeSnapshot {
    let shared = player.shared_state();
    let volume = shared.volume.load(std::sync::atomic::Ordering::Relaxed) as f32 / 1_000_000.0;
    let device_id = shared.device_id.load(std::sync::atomic::Ordering::Relaxed);

    PlaybackRuntimeSnapshot {
        position_secs: Some(shared.current_time_secs()),
        duration_secs: Some(shared.duration_secs()),
        volume: Some(volume),
        device_id: if device_id >= 0 {
            Some(device_id as usize)
        } else {
            None
        },
        exclusive_mode: player.exclusive_mode,
    }
}

fn restore_domain_state(state: &Arc<AppState>) {
    match state.app_db.latest_open_playback_session() {
        Ok(Some(session)) => {
            *state.playback.active_session_id.lock() = Some(session.session_id);
            log::info!(
                "Recovered active playback session {} for '{}'",
                session.session_id,
                session.source_path
            );
        }
        Ok(None) => {}
        Err(e) => log::warn!("Failed to restore active playback session: {}", e),
    }

    match state
        .app_db
        .recent_analysis_tasks(state.analysis.scan_task_max_entries)
    {
        Ok(tasks) => {
            let mut memory_tasks = state.analysis.scan_tasks.lock();
            for task in tasks {
                memory_tasks.insert(
                    task.task_id,
                    ScanTaskRecord {
                        status: task.status,
                        created_at_epoch_secs: task.created_at_epoch_secs,
                        updated_at_epoch_secs: task.updated_at_epoch_secs,
                        result: task.result,
                        error: task.error,
                    },
                );
            }
            if !memory_tasks.is_empty() {
                log::info!(
                    "Recovered {} persisted analysis task records",
                    memory_tasks.len()
                );
            }
        }
        Err(e) => log::warn!("Failed to restore persisted analysis tasks: {}", e),
    }
}

pub(crate) fn record_webdav_probe(data: &AppState, latency: Duration, success: bool) {
    let latency_ms = latency.as_millis().min(u128::from(u64::MAX)) as u64;
    data.analysis
        .webdav_last_latency_ms
        .store(latency_ms, Ordering::Relaxed);
    data.analysis
        .webdav_max_latency_ms
        .fetch_max(latency_ms, Ordering::Relaxed);
    data.analysis
        .webdav_request_count
        .fetch_add(1, Ordering::Relaxed);
    if !success {
        data.analysis
            .webdav_error_count
            .fetch_add(1, Ordering::Relaxed);
    }
}

// ============ Route Handlers ============

/// CORS preflight handler for OPTIONS requests
/// Returns 200 OK with appropriate CORS headers (added by DefaultHeaders middleware)
async fn cors_preflight() -> HttpResponse {
    HttpResponse::Ok().finish()
}

async fn shutdown_server(control: web::Data<Arc<ServerControlState>>) -> HttpResponse {
    let handle = control.shutdown_handle.lock().clone();
    if let Some(handle) = handle {
        actix_web::rt::spawn(async move {
            handle.stop(true).await;
        });
        HttpResponse::Ok().json(serde_json::json!({ "status": "shutting_down" }))
    } else {
        HttpResponse::ServiceUnavailable()
            .json(serde_json::json!({ "status": "shutdown_handle_unavailable" }))
    }
}

// ============ Server Entry Point ============

pub async fn run_server(
    port: u16,
    config: ResolvedConfig,
    settings_manager: SharedSettingsManager,
    runtime_paths: RuntimePaths,
) -> std::io::Result<()> {
    let startup_started_at = Instant::now();
    let api_token = std::env::var(ENV_AUDIO_API_TOKEN).unwrap_or_default();
    if api_token.trim().is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!(
                "{} is not set. The audio sidecar requires a per-run bearer token \
                 supplied by the Tauri host. Set the env var before launch.",
                ENV_AUDIO_API_TOKEN
            ),
        ));
    }
    let api_token = Arc::new(api_token);
    let server_control = Arc::new(ServerControlState {
        api_token: Arc::clone(&api_token),
        shutdown_handle: Mutex::new(None),
    });

    let app_db = Arc::new(
        AppDatabase::open(&runtime_paths.app_db_path)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?,
    );

    // Load WebDAV config from domain database first, then env fallback.
    let webdav_fallback_config = || -> WebDavConfig {
        config
            .server
            .webdav_fallback
            .as_ref()
            .map(|fallback| WebDavConfig {
                base_url: fallback.base_url.clone(),
                username: fallback.username.clone(),
                password: fallback.password.clone(),
            })
            .unwrap_or_default()
    };
    let webdav_config = match app_db.load_primary_webdav_source() {
        Ok(Some(cfg)) if cfg.is_configured() => cfg,
        Ok(_) => webdav_fallback_config(),
        Err(e) => {
            log::warn!(
                "Failed to load primary WebDAV source from app db: {}. Using env fallback.",
                e
            );
            webdav_fallback_config()
        }
    };

    // Initialize loudness database.
    let loudness_db = match LoudnessDatabase::open(&runtime_paths.loudness_db_path) {
        Ok(db) => {
            log::info!(
                "Loudness database opened: {}",
                runtime_paths.loudness_db_path.display()
            );
            Some(db)
        }
        Err(e) => {
            log::warn!(
                "Failed to open loudness database: {}. Loudness caching disabled.",
                e
            );
            None
        }
    };

    // Create player with config
    let player = AudioPlayer::new(config.settings.clone());

    let analysis_parallelism = config.server.analysis_max_concurrency;
    let analysis_blocking_threads = config.server.analysis_max_blocking_threads;
    let analysis_runtime = TokioRuntimeBuilder::new_multi_thread()
        .worker_threads(1)
        .max_blocking_threads(analysis_blocking_threads)
        .thread_name("audio-analysis")
        .enable_time()
        .build()
        .map_err(|e| {
            std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("Failed to init analysis runtime: {}", e),
            )
        })?;

    log::info!(
        "Analysis worker pool initialized: concurrency_limit={}, max_blocking_threads={}",
        analysis_parallelism,
        analysis_blocking_threads
    );
    log::info!(
        "Runtime paths active: data='{}', cache='{}', logs='{}', app_db='{}'",
        runtime_paths.app_data_dir.display(),
        runtime_paths.cache_dir.display(),
        runtime_paths.log_dir.display(),
        runtime_paths.app_db_path.display()
    );

    let allowed_origins = config.server.allowed_origins.clone();
    let ncm_client = Arc::new(ncm_api_rs::create_client(None));

    let state = Arc::new(AppState {
        player: Mutex::new(player),
        webdav_config: Mutex::new(webdav_config),
        ncm_client: Arc::clone(&ncm_client),
        app_db,
        settings_manager,
        analysis: AnalysisState {
            loudness_db: Mutex::new(loudness_db),
            analysis_runtime: Arc::new(AnalysisRuntime::new(analysis_runtime)),
            analysis_semaphore: Arc::new(Semaphore::new(analysis_parallelism)),
            analysis_max_concurrency: analysis_parallelism,
            scan_tasks: Mutex::new(HashMap::new()),
            scan_task_counter: AtomicU64::new(0),
            scan_task_max_entries: config.server.scan_task_max_entries,
            scan_task_ttl_secs: config.server.scan_task_ttl_secs,
            cache_max_bytes: config.server.cache_max_bytes,
            startup_ready_ms: AtomicU64::new(0),
            analysis_task_timeout_secs: config.server.analysis_task_timeout_secs,
            webdav_last_latency_ms: AtomicU64::new(0),
            webdav_max_latency_ms: AtomicU64::new(0),
            webdav_request_count: AtomicU64::new(0),
            webdav_error_count: AtomicU64::new(0),
        },
        playback: PlaybackDomainState {
            active_session_id: Mutex::new(None),
            ncm_scrobble: Mutex::new(NcmScrobbleState::default()),
        },
        runtime_paths: runtime_paths.clone(),
    });

    restore_domain_state(&state);
    let playback_supervisor = playback::spawn_playback_supervisor(&state);

    log::info!("Starting Audio Engine on http://127.0.0.1:{}", port);
    log::info!("Allowed UI origins: {}", allowed_origins.join(", "));
    log::info!(
        "Bearer auth enabled (token length={}, env={})",
        api_token.len(),
        ENV_AUDIO_API_TOKEN
    );
    state.analysis.startup_ready_ms.store(
        startup_started_at
            .elapsed()
            .as_millis()
            .min(u128::from(u64::MAX)) as u64,
        Ordering::Relaxed,
    );

    // Print ready signal for parent process
    println!("RUST_AUDIO_ENGINE_READY");

    let server_state = Arc::clone(&state);
    let server_control_state = Arc::clone(&server_control);
    let cors_allowed_origins = allowed_origins.clone();
    let auth_token = Arc::clone(&api_token);
    let server = HttpServer::new(move || {
        let allowed_origins = cors_allowed_origins.clone();
        App::new()
            .app_data(web::Data::new(Arc::clone(&server_state)))
            .app_data(web::Data::new(Arc::clone(&server_control_state)))
            // Inner-to-outer wrap order: BearerAuth runs first, then Logger sees the
            // resulting (possibly 401) response, then Cors handles preflight + headers.
            .wrap(auth::BearerAuth::new(Arc::clone(&auth_token)))
            .wrap(middleware::Logger::default())
            .wrap(
                Cors::default()
                    .allowed_origin_fn(move |origin, _request_head| {
                        origin
                            .to_str()
                            .map(|value| {
                                allowed_origins.iter().any(|allowed| {
                                    allowed == "*" || allowed.eq_ignore_ascii_case(value)
                                })
                            })
                            .unwrap_or(false)
                    })
                    .supports_credentials()
                    .allowed_methods(vec!["GET", "POST", "OPTIONS"])
                    .allowed_headers(vec![
                        header::CONTENT_TYPE,
                        header::AUTHORIZATION,
                        header::COOKIE,
                    ])
                    .expose_headers(vec![header::SET_COOKIE])
                    .max_age(3600),
            )
            // CORS preflight handler - catch all OPTIONS requests
            .default_service(web::route().method(Method::OPTIONS).to(cors_preflight))
            .route("/shutdown", web::post().to(shutdown_server))
            .configure(playback::configure_routes)
            .configure(effects::configure_routes)
            .configure(settings_handlers::configure_routes)
            .configure(webdav_handlers::configure_routes)
            .configure(diagnostics::configure_routes)
            .configure(netease::configure_routes)
            .configure(ws_handlers::configure_routes)
    })
    .bind(("127.0.0.1", port))?
    .shutdown_timeout(5)
    .run();

    {
        let mut shutdown_handle = server_control.shutdown_handle.lock();
        *shutdown_handle = Some(server.handle());
    }

    let server_result = server.await;
    playback_supervisor.abort();
    drop(state);
    drop(server_control);
    server_result
}

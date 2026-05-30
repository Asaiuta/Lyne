//! HTTP/WebSocket Server
//!
//! REST API compatible with existing frontend, with WebSocket for spectrum data.

use actix_cors::Cors;
use actix_web::http::header;
use actix_web::{dev::ServerHandle, http::Method, middleware, web, App, HttpResponse, HttpServer};
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::runtime::{Builder as TokioRuntimeBuilder, Runtime as TokioRuntime};
use tokio::sync::Semaphore;
use tokio::time::timeout;

use crate::app_database::{AppDatabase, PlaybackRuntimeSnapshot};
use crate::config::ResolvedConfig;
use crate::player::AudioPlayer;
pub(crate) use crate::player::PlayerState;
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
    pub loudness_db: Option<Arc<LoudnessDatabase>>,
    /// Dedicated runtime for CPU/IO-heavy analysis jobs
    pub analysis_runtime: Arc<AnalysisRuntime>,
    /// Concurrency guard for analysis jobs to avoid starving playback/control plane
    pub analysis_semaphore: Arc<Semaphore>,
    /// Configured analysis concurrency limit.
    pub analysis_max_concurrency: usize,
    /// Concurrency guard for full library scans.
    pub library_scan_semaphore: Arc<Semaphore>,
    /// Configured library scan concurrency limit.
    pub library_scan_max_concurrency: usize,
    /// Max metadata worker threads used by one local library scan.
    pub library_scan_max_workers: usize,
    /// Max sidecar cover-art bytes read during library scans.
    pub library_scan_cover_max_bytes: u64,
    /// Background scan task records
    pub scan_tasks: Mutex<HashMap<u64, ScanTaskRecord>>,
    /// Cancellation handles for running background scan tasks.
    pub(crate) scan_task_cancels: Mutex<HashMap<u64, AnalysisCancelToken>>,
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
    /// Prebuilt playback control events fanned out to all WebSocket sessions.
    pub ws_events: tokio::sync::broadcast::Sender<JsonValue>,
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

#[derive(Clone, Debug)]
pub(crate) struct AnalysisCancelToken {
    cancelled: Arc<AtomicBool>,
}

impl AnalysisCancelToken {
    pub(crate) fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub(crate) fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub(crate) fn check(&self) -> Result<(), String> {
        if self.is_cancelled() {
            Err(analysis_cancelled_error())
        } else {
            Ok(())
        }
    }

    pub(crate) fn decode_token(&self) -> crate::decoder::DecodeCancelToken {
        crate::decoder::DecodeCancelToken::new(Arc::clone(&self.cancelled))
    }
}

impl Default for AnalysisCancelToken {
    fn default() -> Self {
        Self::new()
    }
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
mod path_security;
mod playback;
mod request_types;
mod settings_handlers;
mod state_helpers;
mod webdav_handlers;
mod ws_events;
mod ws_handlers;

pub mod auth;

pub(crate) use path_security::validate_path;
pub(crate) use request_types::*;
pub(crate) use state_helpers::{
    apply_settings_to_player, build_runtime_snapshot, enrich_player_state, get_player_state,
    record_webdav_probe, restore_domain_state,
};

pub(crate) const ANALYSIS_TIMEOUT_JOIN_GRACE_MS: u64 = 500;

pub(crate) fn analysis_cancelled_error() -> String {
    "Analysis task canceled".to_string()
}

pub(crate) fn is_analysis_timeout_error(error: &str) -> bool {
    error.to_ascii_lowercase().contains("timed out")
}

pub(crate) fn is_analysis_cancelled_error(error: &str) -> bool {
    error.to_ascii_lowercase().contains("cancel")
}

async fn run_analysis_job<T, F>(data: &web::Data<Arc<AppState>>, job: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(AnalysisCancelToken) -> Result<T, String> + Send + 'static,
{
    run_analysis_job_with_token(data, AnalysisCancelToken::new(), job).await
}

async fn run_analysis_job_with_token<T, F>(
    data: &web::Data<Arc<AppState>>,
    cancel_token: AnalysisCancelToken,
    job: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(AnalysisCancelToken) -> Result<T, String> + Send + 'static,
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
    let worker_token = cancel_token.clone();
    let mut join_handle = handle.spawn_blocking(move || {
        let _permit = permit;
        worker_token.check()?;
        job(worker_token)
    });

    let timeout_secs = data.analysis.analysis_task_timeout_secs.max(1);
    let timeout_duration = Duration::from_secs(timeout_secs);
    let timeout_error = || format!("Analysis task timed out after {}s", timeout_secs);
    let join_result = match timeout(timeout_duration, &mut join_handle).await {
        Ok(join_result) => join_result,
        Err(_) => {
            cancel_token.cancel();
            let grace_duration = Duration::from_millis(ANALYSIS_TIMEOUT_JOIN_GRACE_MS);
            let _ = timeout(grace_duration, join_handle).await;
            return Err(timeout_error());
        }
    };

    join_result.map_err(|e| format!("Analysis worker join error: {}", e))?
}

#[cfg(test)]
pub(crate) fn test_app_state_for_analysis(
    temp_dir: &std::path::Path,
    analysis_timeout_secs: u64,
    analysis_concurrency: usize,
) -> Arc<AppState> {
    let runtime_paths = RuntimePaths {
        app_data_dir: temp_dir.to_path_buf(),
        cache_dir: temp_dir.join("cache"),
        log_dir: temp_dir.join("logs"),
        settings_path: temp_dir.join("settings.json"),
        loudness_db_path: temp_dir.join("loudness.db"),
        app_db_path: temp_dir.join("app.db"),
    };
    runtime_paths.ensure().unwrap();

    Arc::new(AppState {
        player: Mutex::new(AudioPlayer::new(crate::config::EngineSettings::default())),
        webdav_config: Mutex::new(WebDavConfig::default()),
        ncm_client: Arc::new(ncm_api_rs::create_client(None)),
        app_db: Arc::new(AppDatabase::in_memory().unwrap()),
        settings_manager: crate::settings::create_settings_manager(&runtime_paths.settings_path),
        analysis: AnalysisState {
            loudness_db: None,
            analysis_runtime: Arc::new(AnalysisRuntime::new(
                TokioRuntimeBuilder::new_multi_thread()
                    .worker_threads(1)
                    .max_blocking_threads(analysis_concurrency.max(1))
                    .enable_time()
                    .build()
                    .unwrap(),
            )),
            analysis_semaphore: Arc::new(Semaphore::new(analysis_concurrency.max(1))),
            analysis_max_concurrency: analysis_concurrency.max(1),
            library_scan_semaphore: Arc::new(Semaphore::new(1)),
            library_scan_max_concurrency: 1,
            library_scan_max_workers: 1,
            library_scan_cover_max_bytes: 1024 * 1024,
            scan_tasks: Mutex::new(HashMap::new()),
            scan_task_cancels: Mutex::new(HashMap::new()),
            scan_task_counter: AtomicU64::new(0),
            scan_task_max_entries: 8,
            scan_task_ttl_secs: 60,
            cache_max_bytes: 1024 * 1024,
            startup_ready_ms: AtomicU64::new(0),
            analysis_task_timeout_secs: analysis_timeout_secs.max(1),
            webdav_last_latency_ms: AtomicU64::new(0),
            webdav_max_latency_ms: AtomicU64::new(0),
            webdav_request_count: AtomicU64::new(0),
            webdav_error_count: AtomicU64::new(0),
        },
        playback: PlaybackDomainState {
            active_session_id: Mutex::new(None),
            ws_events: ws_handlers::websocket_event_broadcast_channel(),
            ncm_scrobble: Mutex::new(NcmScrobbleState::default()),
        },
        runtime_paths,
    })
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
            Some(Arc::new(db))
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
    let player = AudioPlayer::with_loudness_database(config.settings.clone(), loudness_db.clone());

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
            loudness_db,
            analysis_runtime: Arc::new(AnalysisRuntime::new(analysis_runtime)),
            analysis_semaphore: Arc::new(Semaphore::new(analysis_parallelism)),
            analysis_max_concurrency: analysis_parallelism,
            library_scan_semaphore: Arc::new(Semaphore::new(
                config.server.library_scan_max_concurrency,
            )),
            library_scan_max_concurrency: config.server.library_scan_max_concurrency,
            library_scan_max_workers: config.server.library_scan_max_workers,
            library_scan_cover_max_bytes: config.server.library_scan_cover_max_bytes,
            scan_tasks: Mutex::new(HashMap::new()),
            scan_task_cancels: Mutex::new(HashMap::new()),
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
            ws_events: ws_handlers::websocket_event_broadcast_channel(),
            ncm_scrobble: Mutex::new(NcmScrobbleState::default()),
        },
        runtime_paths: runtime_paths.clone(),
    });

    restore_domain_state(&state);
    let playback_supervisor = playback::spawn_playback_supervisor(&state);
    let websocket_event_coordinator = ws_handlers::spawn_websocket_event_coordinator(&state);

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
                    .allowed_methods(vec!["GET", "POST", "PATCH", "DELETE", "OPTIONS"])
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
    websocket_event_coordinator.abort();
    drop(state);
    drop(server_control);
    server_result
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::web;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir_for(test_name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "audio-player-{}-{}-{}",
            test_name,
            std::process::id(),
            unique
        ))
    }

    #[actix_rt::test]
    async fn analysis_timeout_cancels_worker_and_releases_permit() {
        let temp_dir = temp_dir_for("analysis-timeout-cancel");
        let state = test_app_state_for_analysis(&temp_dir, 1, 1);
        let data = web::Data::new(state);
        let observed_cancel = Arc::new(AtomicBool::new(false));
        let exited = Arc::new(AtomicBool::new(false));

        let observed_cancel_for_job = Arc::clone(&observed_cancel);
        let exited_for_job = Arc::clone(&exited);
        let result: Result<(), String> =
            run_analysis_job_with_token(&data, AnalysisCancelToken::new(), move |token| {
                while !token.is_cancelled() {
                    std::thread::sleep(Duration::from_millis(10));
                }
                observed_cancel_for_job.store(true, Ordering::Release);
                exited_for_job.store(true, Ordering::Release);
                Err::<(), String>(analysis_cancelled_error())
            })
            .await;

        assert!(result
            .as_ref()
            .is_err_and(|error| is_analysis_timeout_error(error)));
        assert!(observed_cancel.load(Ordering::Acquire));
        assert!(exited.load(Ordering::Acquire));
        assert_eq!(data.analysis.analysis_semaphore.available_permits(), 1);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[actix_rt::test]
    async fn registered_task_cancel_stops_running_analysis_job() {
        let temp_dir = temp_dir_for("analysis-explicit-cancel");
        let state = test_app_state_for_analysis(&temp_dir, 30, 1);
        let data = web::Data::new(state);
        let task_id = 42;
        let task_token = AnalysisCancelToken::new();
        data.analysis
            .scan_task_cancels
            .lock()
            .insert(task_id, task_token.clone());

        let started = Arc::new(AtomicBool::new(false));
        let observed_cancel = Arc::new(AtomicBool::new(false));
        let started_for_cancel = Arc::clone(&started);
        let data_for_cancel = data.clone();
        actix_rt::spawn(async move {
            while !started_for_cancel.load(Ordering::Acquire) {
                actix_rt::time::sleep(Duration::from_millis(10)).await;
            }
            if let Some(token) = data_for_cancel
                .analysis
                .scan_task_cancels
                .lock()
                .get(&task_id)
            {
                token.cancel();
            }
        });

        let started_for_job = Arc::clone(&started);
        let observed_cancel_for_job = Arc::clone(&observed_cancel);
        let result: Result<(), String> = timeout(
            Duration::from_secs(2),
            run_analysis_job_with_token(&data, task_token, move |token| {
                started_for_job.store(true, Ordering::Release);
                while !token.is_cancelled() {
                    std::thread::sleep(Duration::from_millis(10));
                }
                observed_cancel_for_job.store(true, Ordering::Release);
                Err::<(), String>(analysis_cancelled_error())
            }),
        )
        .await
        .expect("explicit cancellation should stop the worker promptly");

        assert!(result
            .as_ref()
            .is_err_and(|error| is_analysis_cancelled_error(error)));
        assert!(observed_cancel.load(Ordering::Acquire));
        assert_eq!(data.analysis.analysis_semaphore.available_permits(), 1);

        data.analysis.scan_task_cancels.lock().remove(&task_id);
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}

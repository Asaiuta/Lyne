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
use std::sync::atomic::{AtomicU64, Ordering};
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
    drop(state);
    drop(server_control);
    server_result
}

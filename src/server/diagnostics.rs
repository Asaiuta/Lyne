use super::*;
use actix_web::{web, HttpResponse};
use serde::Serialize;
use std::sync::atomic::Ordering;

const WS_TICK_INTERVAL_MS: u64 = 50;
const WS_IDLE_AFTER_TICKS: u32 = 40;
const WS_IDLE_SLEEP_MS: u64 = 200;
const WS_POSITION_EVERY_TICKS: u32 = 20;

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.route(
        "/diagnostics/runtime",
        web::get().to(get_runtime_diagnostics),
    );
}

async fn get_runtime_diagnostics(data: web::Data<Arc<AppState>>) -> HttpResponse {
    HttpResponse::Ok().json(build_runtime_diagnostics(data.as_ref().as_ref()))
}

#[derive(Debug, Serialize)]
struct RuntimeDiagnosticsResponse {
    status: &'static str,
    snapshot: RuntimeDiagnosticsSnapshot,
}

#[derive(Debug, Serialize)]
struct RuntimeDiagnosticsSnapshot {
    process: ProcessDiagnostics,
    analysis: AnalysisDiagnostics,
    webdav: WebDavDiagnostics,
    storage: StorageDiagnostics,
    decode: DecodeDiagnostics,
    playback_phases: PlaybackPhaseDiagnostics,
    playback: PlaybackDiagnostics,
    websocket: WebSocketDiagnostics,
    policies: DiagnosticsPolicies,
}

#[derive(Debug, Serialize)]
struct ProcessDiagnostics {
    memory: crate::diagnostics::ProcessMemorySnapshot,
    cpu: crate::diagnostics::ProcessCpuSnapshot,
    process_tree: crate::diagnostics::ProcessTreeSnapshot,
    startup_ready_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
struct AnalysisDiagnostics {
    concurrency_limit: usize,
    available_permits: usize,
    in_use_permits: usize,
    task_timeout_secs: u64,
    library_scan_concurrency_limit: usize,
    library_scan_available_permits: usize,
    library_scan_in_use_permits: usize,
    library_scan_max_workers: usize,
    library_scan_cover_max_bytes: u64,
    scan_task_records: usize,
    scan_task_record_limit: usize,
    scan_task_ttl_secs: u64,
}

#[derive(Debug, Serialize)]
struct WebDavDiagnostics {
    configured: bool,
    request_count: u64,
    error_count: u64,
    last_latency_ms: Option<u64>,
    max_latency_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
struct StorageDiagnostics {
    cache_dir: crate::diagnostics::FileFootprint,
    cache_max_bytes: u64,
    app_database: crate::diagnostics::FileFootprint,
    loudness_database: crate::diagnostics::FileFootprint,
    library_track_count: Option<u64>,
    library_total_size_bytes: Option<u64>,
    library_stats_error: Option<String>,
}

#[derive(Debug, Serialize)]
struct DecodeDiagnostics {
    memory_budget: crate::diagnostics::DecodeMemoryBudget,
    last_duration_ms: Option<u64>,
    last_input_frames: Option<u64>,
    last_output_samples: Option<u64>,
    last_chunk_count: Option<u64>,
    last_throughput_frames_per_sec: Option<u64>,
    budget_rejection_count: u64,
}

#[derive(Debug, Serialize)]
struct PlaybackDiagnostics {
    is_playing: bool,
    is_paused: bool,
    is_loading: bool,
    load_progress: u64,
    has_load_error: bool,
    load_error_count: u64,
    underrun_count: u64,
    underrun_silence_frames: u64,
    duration_secs: f64,
    current_time_secs: f64,
    sample_rate: u64,
    channels: u64,
    total_frames: u64,
    position_frames: u64,
}

#[derive(Debug, Serialize)]
struct PlaybackPhaseDiagnostics {
    timestamps_ms: PlaybackPhaseTimestamps,
    durations_ms: PlaybackPhaseDurations,
}

#[derive(Debug, Serialize)]
struct PlaybackPhaseTimestamps {
    load_request_started: Option<u64>,
    load_request_returned: Option<u64>,
    decode_started: Option<u64>,
    decode_finished: Option<u64>,
    loudness_started: Option<u64>,
    loudness_finished: Option<u64>,
    background_loudness_started: Option<u64>,
    background_loudness_finished: Option<u64>,
    background_loudness_applied: Option<u64>,
    load_complete_applied: Option<u64>,
    stream_build_started: Option<u64>,
    stream_build_finished: Option<u64>,
    stream_play_returned: Option<u64>,
    first_callback_after_play: Option<u64>,
    first_position_advanced: Option<u64>,
}

#[derive(Debug, Serialize)]
struct PlaybackPhaseDurations {
    load_request_ms: Option<u64>,
    request_returned_to_decode_start_ms: Option<u64>,
    decode_ms: Option<u64>,
    decode_finished_to_loudness_start_ms: Option<u64>,
    loudness_ms: Option<u64>,
    background_loudness_ms: Option<u64>,
    background_loudness_finish_to_apply_ms: Option<u64>,
    loudness_finished_to_load_complete_applied_ms: Option<u64>,
    load_complete_applied_to_stream_build_start_ms: Option<u64>,
    stream_build_ms: Option<u64>,
    stream_play_to_first_callback_ms: Option<u64>,
    stream_play_to_first_position_advanced_ms: Option<u64>,
    request_started_to_first_position_advanced_ms: Option<u64>,
    request_returned_to_first_position_advanced_ms: Option<u64>,
    decode_finished_to_first_position_advanced_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
struct WebSocketDiagnostics {
    tick_interval_ms: u64,
    idle_after_ticks: u32,
    idle_sleep_ms: u64,
    position_event_every_ticks: u32,
    spectrum_suppresses_unchanged_when_idle: bool,
    spectrum_event_count: u64,
    position_event_count: u64,
}

#[derive(Debug, Serialize)]
struct DiagnosticsPolicies {
    sensitive_paths_redacted: bool,
    cache_cleanup_policy: &'static str,
    database_cleanup_policy: &'static str,
    webdav_degradation_policy: &'static str,
    scan_degradation_policy: &'static str,
    spectrum_degradation_policy: &'static str,
}

fn build_runtime_diagnostics(data: &AppState) -> RuntimeDiagnosticsResponse {
    RuntimeDiagnosticsResponse {
        status: "success",
        snapshot: RuntimeDiagnosticsSnapshot {
            process: ProcessDiagnostics {
                memory: crate::diagnostics::process_memory_snapshot(),
                cpu: crate::diagnostics::process_cpu_snapshot(),
                process_tree: crate::diagnostics::process_tree_snapshot(),
                startup_ready_ms: non_zero_u64(
                    data.analysis.startup_ready_ms.load(Ordering::Relaxed),
                ),
            },
            analysis: build_analysis_diagnostics(data),
            webdav: build_webdav_diagnostics(data),
            storage: build_storage_diagnostics(data),
            decode: build_decode_diagnostics(data),
            playback_phases: build_playback_phase_diagnostics(data),
            playback: build_playback_diagnostics(data),
            websocket: build_websocket_diagnostics(data),
            policies: DiagnosticsPolicies {
                sensitive_paths_redacted: true,
                cache_cleanup_policy:
                    "resample cache writes prune oldest .bin files above AUDIO_CACHE_MAX_BYTES",
                database_cleanup_policy:
                    "startup GC removes terminal analysis tasks/history and orphan cover art",
                webdav_degradation_policy:
                    "WebDAV browse runs behind analysis concurrency and timeout limits",
                scan_degradation_policy:
                    "scan task records are bounded by max entries and terminal-record TTL",
                spectrum_degradation_policy:
                    "idle WebSocket loop sleeps and suppresses unchanged idle spectrum frames",
            },
        },
    }
}

fn build_websocket_diagnostics(data: &AppState) -> WebSocketDiagnostics {
    let shared_state = {
        let player = data.player.lock();
        player.shared_state()
    };

    WebSocketDiagnostics {
        tick_interval_ms: WS_TICK_INTERVAL_MS,
        idle_after_ticks: WS_IDLE_AFTER_TICKS,
        idle_sleep_ms: WS_IDLE_SLEEP_MS,
        position_event_every_ticks: WS_POSITION_EVERY_TICKS,
        spectrum_suppresses_unchanged_when_idle: true,
        spectrum_event_count: shared_state.ws_spectrum_event_count.load(Ordering::Relaxed),
        position_event_count: shared_state.ws_position_event_count.load(Ordering::Relaxed),
    }
}

fn non_zero_u64(value: u64) -> Option<u64> {
    (value > 0).then_some(value)
}

fn phase_delta_ms(start: u64, end: u64) -> Option<u64> {
    if start > 0 && end >= start {
        Some(end - start)
    } else {
        None
    }
}

fn build_decode_diagnostics(data: &AppState) -> DecodeDiagnostics {
    let shared_state = {
        let player = data.player.lock();
        player.shared_state()
    };

    DecodeDiagnostics {
        memory_budget: crate::diagnostics::decode_memory_budget(),
        last_duration_ms: non_zero_u64(
            shared_state.last_decode_duration_ms.load(Ordering::Relaxed),
        ),
        last_input_frames: non_zero_u64(
            shared_state
                .last_decode_input_frames
                .load(Ordering::Relaxed),
        ),
        last_output_samples: non_zero_u64(
            shared_state
                .last_decode_output_samples
                .load(Ordering::Relaxed),
        ),
        last_chunk_count: non_zero_u64(
            shared_state.last_decode_chunk_count.load(Ordering::Relaxed),
        ),
        last_throughput_frames_per_sec: non_zero_u64(
            shared_state
                .last_decode_throughput_frames_per_sec
                .load(Ordering::Relaxed),
        ),
        budget_rejection_count: shared_state
            .decode_budget_rejection_count
            .load(Ordering::Relaxed),
    }
}

fn build_playback_phase_diagnostics(data: &AppState) -> PlaybackPhaseDiagnostics {
    let shared_state = {
        let player = data.player.lock();
        player.shared_state()
    };

    let load_request_started = shared_state.load_request_started_ms.load(Ordering::Relaxed);
    let load_request_returned = shared_state
        .load_request_returned_ms
        .load(Ordering::Relaxed);
    let decode_started = shared_state.decode_started_ms.load(Ordering::Relaxed);
    let decode_finished = shared_state.decode_finished_ms.load(Ordering::Relaxed);
    let loudness_started = shared_state.loudness_started_ms.load(Ordering::Relaxed);
    let loudness_finished = shared_state.loudness_finished_ms.load(Ordering::Relaxed);
    let background_loudness_started = shared_state
        .background_loudness_started_ms
        .load(Ordering::Relaxed);
    let background_loudness_finished = shared_state
        .background_loudness_finished_ms
        .load(Ordering::Relaxed);
    let background_loudness_applied = shared_state
        .background_loudness_applied_ms
        .load(Ordering::Relaxed);
    let load_complete_applied = shared_state
        .load_complete_applied_ms
        .load(Ordering::Relaxed);
    let stream_build_started = shared_state.stream_build_started_ms.load(Ordering::Relaxed);
    let stream_build_finished = shared_state
        .stream_build_finished_ms
        .load(Ordering::Relaxed);
    let stream_play_returned = shared_state.stream_play_returned_ms.load(Ordering::Relaxed);
    let first_callback_after_play = shared_state
        .first_callback_after_play_ms
        .load(Ordering::Relaxed);
    let first_position_advanced = shared_state
        .first_position_advanced_ms
        .load(Ordering::Relaxed);

    PlaybackPhaseDiagnostics {
        timestamps_ms: PlaybackPhaseTimestamps {
            load_request_started: non_zero_u64(load_request_started),
            load_request_returned: non_zero_u64(load_request_returned),
            decode_started: non_zero_u64(decode_started),
            decode_finished: non_zero_u64(decode_finished),
            loudness_started: non_zero_u64(loudness_started),
            loudness_finished: non_zero_u64(loudness_finished),
            background_loudness_started: non_zero_u64(background_loudness_started),
            background_loudness_finished: non_zero_u64(background_loudness_finished),
            background_loudness_applied: non_zero_u64(background_loudness_applied),
            load_complete_applied: non_zero_u64(load_complete_applied),
            stream_build_started: non_zero_u64(stream_build_started),
            stream_build_finished: non_zero_u64(stream_build_finished),
            stream_play_returned: non_zero_u64(stream_play_returned),
            first_callback_after_play: non_zero_u64(first_callback_after_play),
            first_position_advanced: non_zero_u64(first_position_advanced),
        },
        durations_ms: PlaybackPhaseDurations {
            load_request_ms: phase_delta_ms(load_request_started, load_request_returned),
            request_returned_to_decode_start_ms: phase_delta_ms(
                load_request_returned,
                decode_started,
            ),
            decode_ms: phase_delta_ms(decode_started, decode_finished),
            decode_finished_to_loudness_start_ms: phase_delta_ms(decode_finished, loudness_started),
            loudness_ms: phase_delta_ms(loudness_started, loudness_finished),
            background_loudness_ms: phase_delta_ms(
                background_loudness_started,
                background_loudness_finished,
            ),
            background_loudness_finish_to_apply_ms: phase_delta_ms(
                background_loudness_finished,
                background_loudness_applied,
            ),
            loudness_finished_to_load_complete_applied_ms: phase_delta_ms(
                loudness_finished,
                load_complete_applied,
            ),
            load_complete_applied_to_stream_build_start_ms: phase_delta_ms(
                load_complete_applied,
                stream_build_started,
            ),
            stream_build_ms: phase_delta_ms(stream_build_started, stream_build_finished),
            stream_play_to_first_callback_ms: phase_delta_ms(
                stream_play_returned,
                first_callback_after_play,
            ),
            stream_play_to_first_position_advanced_ms: phase_delta_ms(
                stream_play_returned,
                first_position_advanced,
            ),
            request_started_to_first_position_advanced_ms: phase_delta_ms(
                load_request_started,
                first_position_advanced,
            ),
            request_returned_to_first_position_advanced_ms: phase_delta_ms(
                load_request_returned,
                first_position_advanced,
            ),
            decode_finished_to_first_position_advanced_ms: phase_delta_ms(
                decode_finished,
                first_position_advanced,
            ),
        },
    }
}

fn build_analysis_diagnostics(data: &AppState) -> AnalysisDiagnostics {
    let available_permits = data.analysis.analysis_semaphore.available_permits();
    let concurrency_limit = data.analysis.analysis_max_concurrency;
    let library_scan_available_permits = data.analysis.library_scan_semaphore.available_permits();
    let library_scan_concurrency_limit = data.analysis.library_scan_max_concurrency;
    let scan_task_records = data.analysis.scan_tasks.lock().len();

    AnalysisDiagnostics {
        concurrency_limit: concurrency_limit.max(available_permits),
        available_permits,
        in_use_permits: concurrency_limit.saturating_sub(available_permits),
        task_timeout_secs: data.analysis.analysis_task_timeout_secs,
        library_scan_concurrency_limit: library_scan_concurrency_limit
            .max(library_scan_available_permits),
        library_scan_available_permits,
        library_scan_in_use_permits: library_scan_concurrency_limit
            .saturating_sub(library_scan_available_permits),
        library_scan_max_workers: data.analysis.library_scan_max_workers,
        library_scan_cover_max_bytes: data.analysis.library_scan_cover_max_bytes,
        scan_task_records,
        scan_task_record_limit: data.analysis.scan_task_max_entries,
        scan_task_ttl_secs: data.analysis.scan_task_ttl_secs,
    }
}

fn build_webdav_diagnostics(data: &AppState) -> WebDavDiagnostics {
    let request_count = data.analysis.webdav_request_count.load(Ordering::Relaxed);
    let error_count = data.analysis.webdav_error_count.load(Ordering::Relaxed);
    let last_latency_ms = data.analysis.webdav_last_latency_ms.load(Ordering::Relaxed);
    let max_latency_ms = data.analysis.webdav_max_latency_ms.load(Ordering::Relaxed);

    WebDavDiagnostics {
        configured: data.webdav_config.lock().is_configured(),
        request_count,
        error_count,
        last_latency_ms: (request_count > 0).then_some(last_latency_ms),
        max_latency_ms: (request_count > 0).then_some(max_latency_ms),
    }
}

fn build_storage_diagnostics(data: &AppState) -> StorageDiagnostics {
    let library_stats = data.app_db.library_summary_stats();
    let (library_track_count, library_total_size_bytes, library_stats_error) = match library_stats {
        Ok(stats) => (Some(stats.total_count), Some(stats.total_size_bytes), None),
        Err(e) => (None, None, Some(e)),
    };

    StorageDiagnostics {
        cache_dir: crate::diagnostics::directory_size_snapshot(&data.runtime_paths.cache_dir),
        cache_max_bytes: data.analysis.cache_max_bytes,
        app_database: crate::diagnostics::file_size_snapshot(&data.runtime_paths.app_db_path),
        loudness_database: crate::diagnostics::file_size_snapshot(
            &data.runtime_paths.loudness_db_path,
        ),
        library_track_count,
        library_total_size_bytes,
        library_stats_error,
    }
}

fn build_playback_diagnostics(data: &AppState) -> PlaybackDiagnostics {
    let shared_state = {
        let player = data.player.lock();
        player.shared_state()
    };
    let state = shared_state.state.load();
    let has_load_error = shared_state.load_error.read().is_some();

    PlaybackDiagnostics {
        is_playing: state == PlayerState::Playing,
        is_paused: state == PlayerState::Paused,
        is_loading: shared_state.is_loading.load(Ordering::Relaxed),
        load_progress: shared_state.load_progress.load(Ordering::Relaxed),
        has_load_error,
        load_error_count: shared_state.load_error_count.load(Ordering::Relaxed),
        underrun_count: shared_state.audio_underrun_count.load(Ordering::Relaxed),
        underrun_silence_frames: shared_state
            .audio_underrun_silence_frames
            .load(Ordering::Relaxed),
        duration_secs: shared_state.duration_secs(),
        current_time_secs: shared_state.current_time_secs(),
        sample_rate: shared_state.sample_rate.load(Ordering::Relaxed),
        channels: shared_state.channels.load(Ordering::Relaxed),
        total_frames: shared_state.total_frames.load(Ordering::Relaxed),
        position_frames: shared_state.position_frames.load(Ordering::Relaxed),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_database::AppDatabase;
    use crate::config::EngineSettings;
    use crate::settings::create_settings_manager;
    use crate::webdav::WebDavConfig;
    use std::sync::atomic::AtomicU64;

    fn test_state(temp_dir: &std::path::Path) -> Arc<AppState> {
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
            player: Mutex::new(AudioPlayer::new(EngineSettings::default())),
            webdav_config: Mutex::new(WebDavConfig::default()),
            ncm_client: Arc::new(ncm_api_rs::create_client(None)),
            app_db: Arc::new(AppDatabase::in_memory().unwrap()),
            settings_manager: create_settings_manager(&runtime_paths.settings_path),
            analysis: AnalysisState {
                loudness_db: None,
                analysis_runtime: Arc::new(AnalysisRuntime::new(
                    TokioRuntimeBuilder::new_multi_thread()
                        .worker_threads(1)
                        .max_blocking_threads(1)
                        .enable_time()
                        .build()
                        .unwrap(),
                )),
                analysis_semaphore: Arc::new(Semaphore::new(2)),
                analysis_max_concurrency: 2,
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
                analysis_task_timeout_secs: 30,
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

    #[test]
    fn runtime_diagnostics_redacts_runtime_paths() {
        let temp_dir = std::env::temp_dir().join("audio_player_diagnostics_redaction");
        let _ = std::fs::remove_dir_all(&temp_dir);
        let state = test_state(&temp_dir);

        let response = build_runtime_diagnostics(state.as_ref());
        let json = serde_json::to_string(&response).unwrap();

        assert!(json.contains("\"sensitive_paths_redacted\":true"));
        assert!(json.contains("\"playback_phases\""));
        assert!(json.contains("\"load_request_started\""));
        assert!(json.contains("\"stream_play_to_first_position_advanced_ms\""));
        assert!(!json.contains(&temp_dir.to_string_lossy().to_string()));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn webdav_probe_records_latency_and_errors() {
        let temp_dir = std::env::temp_dir().join("audio_player_diagnostics_webdav");
        let _ = std::fs::remove_dir_all(&temp_dir);
        let state = test_state(&temp_dir);

        record_webdav_probe(state.as_ref(), Duration::from_millis(12), true);
        record_webdav_probe(state.as_ref(), Duration::from_millis(30), false);

        let response = build_runtime_diagnostics(state.as_ref());
        let json = serde_json::to_value(response).unwrap();
        let webdav = &json["snapshot"]["webdav"];

        assert_eq!(webdav["request_count"], 2);
        assert_eq!(webdav["error_count"], 1);
        assert_eq!(webdav["last_latency_ms"], 30);
        assert_eq!(webdav["max_latency_ms"], 30);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}

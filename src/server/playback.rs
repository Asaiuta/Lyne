use super::*;
use crate::app_database::QueueEntryRecord;
use crate::player::{RepeatMode, ShuffleMode};
use crate::playlist;
use actix_web::{web, HttpRequest, HttpResponse};
use serde::Deserialize;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/load", web::post().to(load))
        .route("/play", web::post().to(play))
        .route("/pause", web::post().to(pause))
        .route("/stop", web::post().to(stop))
        .route("/seek", web::post().to(seek))
        .route("/repeat", web::post().to(set_repeat_mode))
        .route("/shuffle", web::post().to(set_shuffle_mode))
        .route("/state", web::get().to(get_state))
        .route("/queue_status", web::get().to(get_queue_status))
        .route("/volume", web::post().to(set_volume))
        .route("/devices", web::get().to(list_devices))
        .route("/configure_output", web::post().to(configure_output))
        .route(
            "/configure_upsampling",
            web::post().to(configure_upsampling),
        )
        .route(
            "/configure_resampling",
            web::post().to(configure_resampling),
        )
        .route(
            "/configure_normalization",
            web::post().to(configure_normalization),
        )
        .route("/loudness_info", web::get().to(get_loudness_info))
        .route("/scan_loudness", web::post().to(scan_track_loudness))
        .route(
            "/scan_loudness_background",
            web::post().to(scan_loudness_background),
        )
        .route(
            "/scan_loudness_task/{task_id}",
            web::get().to(get_scan_loudness_task),
        )
        .route(
            "/scan_loudness_task/{task_id}/cancel",
            web::post().to(cancel_scan_loudness_task),
        )
        .route("/queue_next", web::post().to(queue_next))
        .route("/cancel_preload", web::post().to(cancel_preload))
        .route("/playlist/load", web::post().to(load_playlist))
        .route("/load_ir", web::post().to(load_ir))
        .route("/unload_ir", web::post().to(unload_ir))
        .route("/loading_status", web::get().to(get_loading_status))
        .route("/ir_status", web::get().to(get_ir_status))
        .route(
            "/domain/analysis_tasks",
            web::get().to(get_recent_analysis_tasks),
        )
        .route(
            "/domain/playback_history",
            web::get().to(get_playback_history),
        )
        .route(
            "/domain/playback_sessions",
            web::get().to(get_playback_sessions),
        )
        .route("/domain/media_items", web::get().to(get_media_items))
        .route(
            "/domain/media_items/{media_id}/cover_art",
            web::get().to(get_media_cover_art),
        )
        .route("/domain/library/roots", web::get().to(get_library_roots))
        .route("/domain/library/scan", web::post().to(scan_library_root))
        .route(
            "/domain/queue_snapshot",
            web::get().to(get_queue_snapshot_domain),
        )
        .route("/domain/queue", web::get().to(get_persistent_queue))
        .route("/domain/queue", web::post().to(replace_persistent_queue))
        .route(
            "/domain/queue/enqueue",
            web::post().to(enqueue_persistent_queue),
        )
        .route(
            "/domain/queue/play",
            web::post().to(play_from_persistent_queue),
        )
        .route(
            "/domain/queue/{entry_id}",
            web::delete().to(remove_persistent_queue_entry),
        )
        .route(
            "/domain/queue/clear",
            web::post().to(clear_persistent_queue),
        )
        .route(
            "/domain/device_config",
            web::get().to(get_device_config_domain),
        )
        .route("/domain/dsp_configs", web::get().to(get_dsp_configs_domain));
}

#[derive(Deserialize)]
struct ScanTaskPath {
    task_id: u64,
}

#[derive(Deserialize)]
struct LimitQuery {
    limit: Option<usize>,
    task_type: Option<String>,
}

#[derive(Deserialize)]
struct LibraryScanRequest {
    path: String,
    display_name: Option<String>,
    source_key: Option<String>,
}

#[derive(Deserialize)]
struct QueueEnqueueRequest {
    path: String,
}

#[derive(Deserialize)]
struct QueueReplaceRequest {
    paths: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum PlaylistLoadMode {
    ParseOnly,
    Append,
    Replace,
}

#[derive(Deserialize)]
struct PlaylistLoadRequest {
    path: String,
    mode: PlaylistLoadMode,
}

#[derive(Deserialize)]
struct QueueEntryPath {
    entry_id: i64,
}

#[derive(Deserialize)]
struct PlayQueueRequest {
    entry_id: Option<i64>,
}

#[derive(Deserialize)]
struct PlaybackModeRequest {
    mode: String,
}

fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn cleanup_scan_tasks(data: &web::Data<Arc<AppState>>) {
    let now = now_epoch_secs();
    let ttl = data.scan_task_ttl_secs;
    let max_entries = data.scan_task_max_entries;

    let mut tasks = data.scan_tasks.lock();

    tasks.retain(|_, task| {
        let finished = task.status == "success" || task.status == "error";
        if !finished {
            return true;
        }
        now.saturating_sub(task.updated_at_epoch_secs) <= ttl
    });

    if tasks.len() > max_entries {
        let mut entries: Vec<(u64, bool, u64)> = tasks
            .iter()
            .map(|(id, task)| {
                let finished = task.status == "success" || task.status == "error";
                (*id, finished, task.updated_at_epoch_secs)
            })
            .collect();

        entries.sort_by_key(|(_, finished, updated_at)| (!*finished, *updated_at));
        let remove_count = tasks.len().saturating_sub(max_entries);

        for (id, _, _) in entries.into_iter().take(remove_count) {
            tasks.remove(&id);
        }
    }
}

fn upsert_scan_task_record(
    data: &web::Data<Arc<AppState>>,
    task_id: u64,
    source_path: &str,
    task: &ScanTaskRecord,
    store_result: bool,
) {
    if let Err(e) = data.app_db.upsert_analysis_task(
        task_id,
        "scan_loudness",
        source_path,
        &task.status,
        store_result,
        task.created_at_epoch_secs,
        task.updated_at_epoch_secs,
        task.result.as_ref(),
        task.error.as_deref(),
    ) {
        log::warn!("Failed to persist scan task {}: {}", task_id, e);
    }
}

fn persist_library_scan_task(
    data: &web::Data<Arc<AppState>>,
    task_id: u64,
    source_path: &str,
    status: &str,
    created_at_epoch_secs: u64,
    updated_at_epoch_secs: u64,
    result: Option<&serde_json::Value>,
    error: Option<&str>,
) {
    if let Err(e) = data.app_db.upsert_analysis_task(
        task_id,
        "library_scan",
        source_path,
        status,
        true,
        created_at_epoch_secs,
        updated_at_epoch_secs,
        result,
        error,
    ) {
        log::warn!("Failed to persist library scan task {}: {}", task_id, e);
    }
}

fn sync_queue_snapshot(data: &web::Data<Arc<AppState>>) {
    let shared_state = {
        let player = data.player.lock();
        player.shared_state()
    };

    let current_track_path = shared_state.current_track_path.read().clone();
    let pending_track_path = shared_state.pending_file_path.read().clone();
    let needs_preload = shared_state.needs_preload.load(Ordering::Acquire);
    let pending_ready = shared_state.pending_ready.load(Ordering::Acquire);

    if let Err(e) = data.app_db.upsert_queue_snapshot(
        current_track_path.as_deref(),
        pending_track_path.as_deref(),
        needs_preload,
        pending_ready,
    ) {
        log::warn!("Failed to persist queue snapshot: {}", e);
    }
}

fn emit_queue_updated(data: &web::Data<Arc<AppState>>) {
    let player = data.player.lock();
    let shared = player.shared_state();
    shared
        .event_flags
        .fetch_or(crate::player::EVENT_QUEUE_UPDATED, Ordering::Release);
}

fn emit_playback_event(data: &web::Data<Arc<AppState>>, event: u32) {
    let player = data.player.lock();
    let shared = player.shared_state();
    shared.event_flags.fetch_or(event, Ordering::Release);
}

pub(crate) fn spawn_playback_supervisor(state: &Arc<AppState>) -> actix_rt::task::JoinHandle<()> {
    let weak_state = Arc::downgrade(state);
    actix_rt::spawn(async move {
        let mut last_end_count: Option<u64> = None;
        let mut timer = tokio::time::interval(Duration::from_millis(100));

        loop {
            timer.tick().await;
            let Some(state) = weak_state.upgrade() else {
                break;
            };
            let data = web::Data::new(state);
            let shared_state = {
                let player = data.player.lock();
                player.shared_state()
            };
            let last_count = last_end_count
                .get_or_insert_with(|| shared_state.playback_end_count.load(Ordering::Acquire));

            let needs_preload = shared_state.needs_preload.load(Ordering::Acquire);
            let pending_ready = shared_state.pending_ready.load(Ordering::Acquire);
            if needs_preload && !pending_ready {
                match queue_next_from_persistent_queue(&data) {
                    Ok(Some(path)) => log::info!("Supervisor preloaded next queue entry: {}", path),
                    Ok(None) => {}
                    Err(e) => log::warn!("Supervisor failed to preload next queue entry: {}", e),
                }
            }

            let end_count = shared_state.playback_end_count.load(Ordering::Acquire);
            while *last_count < end_count {
                *last_count += 1;
                handle_natural_playback_end(&data);
            }
        }
    })
}

pub(super) fn mark_current_track_as_played(data: &web::Data<Arc<AppState>>, current_path: &str) {
    if let Err(e) = data
        .app_db
        .mark_queue_entry_played_by_path("active", current_path)
    {
        log::warn!(
            "Failed to mark queue entry as played for '{}': {}",
            current_path,
            e
        );
    } else {
        emit_queue_updated(data);
    }
}

fn load_queue_entry_for_playback(
    data: &web::Data<Arc<AppState>>,
    entry: QueueEntryRecord,
    autoplay: bool,
) -> Result<(), String> {
    let credentials = {
        let cfg = data.webdav_config.lock();
        cfg.http_credentials()
    };

    let mut player = data.player.lock();
    if autoplay {
        player.load_with_credentials_and_autoplay(&entry.source_path, credentials.as_ref())?;
    } else {
        player.load_with_credentials(&entry.source_path, credentials.as_ref())?;
    }

    data.app_db
        .mark_queue_entry_status("active", entry.entry_id, "playing")?;
    sync_queue_snapshot(data);
    emit_queue_updated(data);
    Ok(())
}

fn finish_active_session_on_natural_end(data: &web::Data<Arc<AppState>>) {
    let (snapshot, current_path) = {
        let player = data.player.lock();
        let shared = player.shared_state();
        let snapshot = build_runtime_snapshot(&player);
        let current_path = shared.current_track_path.read().clone();
        let file_path = shared.file_path.read().clone();
        (snapshot, current_path.or(file_path))
    };

    if let Some(ref path) = current_path {
        mark_current_track_as_played(data, path);
    }

    if let Some(session_id) = data.active_session_id.lock().take() {
        if let Err(e) = data
            .app_db
            .finish_playback_session(session_id, "ended", &snapshot)
        {
            log::warn!(
                "Failed to finish playback session {} on natural end: {}",
                session_id,
                e
            );
        }
        if let Some(ref path) = current_path {
            let payload = serde_json::json!({ "reason": "natural_end" });
            if let Err(e) = data.app_db.append_playback_history(
                Some(session_id),
                path,
                "playback_ended",
                snapshot.position_secs,
                Some(&payload),
            ) {
                log::warn!("Failed to append playback_ended history: {}", e);
            }
        }
    }

    emit_playback_event(data, crate::player::EVENT_PLAYBACK_ENDED);
}

fn handle_natural_playback_end(data: &web::Data<Arc<AppState>>) {
    let shared_state = {
        let player = data.player.lock();
        player.shared_state()
    };
    let repeat_mode = shared_state.repeat_mode();
    let current_path = shared_state
        .current_track_path
        .read()
        .clone()
        .or_else(|| shared_state.file_path.read().clone());

    if repeat_mode == RepeatMode::One {
        if let Some(ref path) = current_path {
            log::info!("Repeat one restarting '{}'", path);
            let restart_result = {
                let mut player = data.player.lock();
                player.seek(0.0).and_then(|_| player.play())
            };
            if let Err(e) = restart_result {
                log::warn!(
                    "Failed to restart repeat-one playback for '{}': {}",
                    path,
                    e
                );
                finish_active_session_on_natural_end(data);
            } else {
                emit_playback_event(
                    data,
                    crate::player::EVENT_PLAYBACK_SEEKED | crate::player::EVENT_PLAYBACK_STARTED,
                );
            }
            return;
        }
    }

    if let Some(ref path) = current_path {
        mark_current_track_as_played(data, path);
    }

    match data
        .app_db
        .peek_next_queue_entry("active", current_path.as_deref())
    {
        Ok(Some(entry)) => {
            if let Err(e) = load_queue_entry_for_playback(data, entry, true) {
                log::warn!("Failed to advance queue after natural end: {}", e);
                finish_active_session_on_natural_end(data);
            }
            return;
        }
        Ok(None) => {}
        Err(e) => log::warn!(
            "Failed to inspect next queue entry after natural end: {}",
            e
        ),
    }

    if repeat_mode == RepeatMode::All {
        match data.app_db.reset_queue_cycle_for_repeat_all("active") {
            Ok(Some(entry)) => {
                log::info!("Repeat all wrapping to '{}'", entry.source_path);
                if let Err(e) = load_queue_entry_for_playback(data, entry, true) {
                    log::warn!("Failed to wrap repeat-all queue: {}", e);
                    finish_active_session_on_natural_end(data);
                }
                return;
            }
            Ok(None) => {}
            Err(e) => log::warn!("Failed to reset queue cycle for repeat-all: {}", e),
        }
    }

    finish_active_session_on_natural_end(data);
}

pub(super) fn queue_next_from_persistent_queue(
    data: &web::Data<Arc<AppState>>,
) -> Result<Option<String>, String> {
    let current_path = {
        let player = data.player.lock();
        let shared = player.shared_state();
        let current_path = shared.current_track_path.read().clone();
        current_path
    };

    let next_entry = data
        .app_db
        .peek_next_queue_entry("active", current_path.as_deref())?;

    let Some(entry) = next_entry else {
        return Ok(None);
    };

    data.app_db
        .mark_queue_entry_status("active", entry.entry_id, "preloading")?;
    emit_queue_updated(data);

    let credentials = {
        let cfg = data.webdav_config.lock();
        cfg.http_credentials()
    };

    let player = data.player.lock();
    match player.queue_next_with_credentials(&entry.source_path, credentials) {
        Ok(()) => {
            sync_queue_snapshot(data);
            emit_queue_updated(data);
            Ok(Some(entry.source_path))
        }
        Err(e) => {
            let _ = data
                .app_db
                .mark_queue_entry_status("active", entry.entry_id, "queued");
            emit_queue_updated(data);
            Err(e)
        }
    }
}

fn task_is_canceled(data: &web::Data<Arc<AppState>>, task_id: u64) -> bool {
    data.scan_tasks
        .lock()
        .get(&task_id)
        .map(|task| task.status == "canceled")
        .unwrap_or(false)
}

fn analysis_error_response(e: &str) -> HttpResponse {
    if e.to_ascii_lowercase().contains("timed out") {
        HttpResponse::GatewayTimeout().json(ApiResponse::error(e))
    } else {
        HttpResponse::InternalServerError().json(ApiResponse::error(e))
    }
}

fn is_supported_media_path(path: &std::path::Path) -> bool {
    const SUPPORTED_EXTENSIONS: &[&str] = &[
        "flac", "mp3", "wav", "m4a", "aac", "ogg", "opus", "aiff", "aif", "wma", "alac",
    ];

    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            SUPPORTED_EXTENSIONS
                .iter()
                .any(|candidate| candidate.eq_ignore_ascii_case(ext))
        })
        .unwrap_or(false)
}

fn is_supported_media_href(path: &str) -> bool {
    const SUPPORTED_EXTENSIONS: &[&str] = &[
        "flac", "mp3", "wav", "m4a", "aac", "ogg", "opus", "aiff", "aif", "wma", "alac",
    ];

    let trimmed = path.split('?').next().unwrap_or(path).trim_end_matches('/');
    let ext = trimmed.rsplit('.').next().unwrap_or("");
    SUPPORTED_EXTENSIONS
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(ext))
}

fn scan_local_library(
    data: &web::Data<Arc<AppState>>,
    root_id: i64,
    root_path: &str,
) -> Result<(u64, u64), String> {
    let mut scanned = 0_u64;
    let mut indexed = 0_u64;
    let mut stack = vec![std::path::PathBuf::from(root_path)];

    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir)
            .map_err(|e| format!("Failed to read directory '{}': {}", dir.display(), e))?;

        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
            let path = entry.path();

            if path.is_dir() {
                stack.push(path);
                continue;
            }

            if !is_supported_media_path(&path) {
                continue;
            }

            let canonical = path
                .canonicalize()
                .unwrap_or(path.clone())
                .to_string_lossy()
                .to_string();
            scanned += 1;

            match crate::decoder::StreamingDecoder::open(&canonical) {
                Ok(decoder) => {
                    let info = decoder.info.clone();
                    match data.app_db.record_media_metadata(
                        &canonical,
                        &info.metadata,
                        info.duration_secs,
                        Some(info.sample_rate),
                        Some(info.channels),
                    ) {
                        Ok(_) => indexed += 1,
                        Err(e) => log::warn!("Failed to index '{}': {}", canonical, e),
                    }
                }
                Err(e) => log::warn!("Skipping media file '{}': {}", canonical, e),
            }
        }
    }

    data.app_db
        .update_library_root_scan_status(
            root_id,
            "completed",
            Some(indexed),
            None,
            Some(now_epoch_secs()),
        )
        .map_err(|e| format!("Failed to finalize library scan state: {}", e))?;

    Ok((scanned, indexed))
}

fn scan_webdav_library(
    data: &web::Data<Arc<AppState>>,
    root_id: i64,
    root_path: &str,
    source_key: Option<&str>,
) -> Result<(u64, u64), String> {
    let webdav_cfg = if let Some(source_key) = source_key {
        data.app_db
            .load_webdav_source_config(source_key)?
            .map(|source| source.config)
            .ok_or_else(|| format!("WebDAV source '{}' not found", source_key))?
    } else {
        data.webdav_config.lock().clone()
    };

    if !webdav_cfg.is_configured() {
        return Err("WebDAV source is not configured".to_string());
    }

    let credentials = webdav_cfg.http_credentials();
    let mut scanned = 0_u64;
    let mut indexed = 0_u64;
    let mut stack = vec![root_path.to_string()];

    while let Some(path) = stack.pop() {
        let entries = webdav_cfg
            .list(&path)
            .map_err(|e| format!("Failed to browse WebDAV path '{}': {}", path, e))?;

        for entry in entries {
            if entry.is_dir {
                let child_path = if entry.href.is_empty() {
                    continue;
                } else {
                    entry.href.clone()
                };
                if child_path != path {
                    stack.push(child_path);
                }
                continue;
            }

            if !is_supported_media_href(&entry.url) {
                continue;
            }

            scanned += 1;
            match crate::decoder::StreamingDecoder::open_with_credentials(
                &entry.url,
                credentials.as_ref(),
            ) {
                Ok(decoder) => {
                    let info = decoder.info.clone();
                    match data.app_db.record_media_metadata(
                        &entry.url,
                        &info.metadata,
                        info.duration_secs,
                        Some(info.sample_rate),
                        Some(info.channels),
                    ) {
                        Ok(_) => indexed += 1,
                        Err(e) => log::warn!("Failed to index remote media '{}': {}", entry.url, e),
                    }
                }
                Err(e) => log::warn!("Skipping remote media '{}': {}", entry.url, e),
            }
        }
    }

    data.app_db
        .update_library_root_scan_status(
            root_id,
            "completed",
            Some(indexed),
            None,
            Some(now_epoch_secs()),
        )
        .map_err(|e| format!("Failed to finalize remote library scan state: {}", e))?;

    Ok((scanned, indexed))
}

fn track_loudness_to_json(track_loudness: &crate::processor::TrackLoudness) -> serde_json::Value {
    serde_json::json!({
        "track_id": track_loudness.track_id,
        "file_path": track_loudness.file_path,
        "integrated_lufs": track_loudness.integrated_lufs,
        "true_peak_dbtp": track_loudness.true_peak_dbtp,
        "loudness_range": track_loudness.loudness_range,
        "track_gain_db": track_loudness.track_gain_db,
    })
}

fn try_get_cached_loudness(
    data: &web::Data<Arc<AppState>>,
    path: &str,
) -> Option<crate::processor::TrackLoudness> {
    let db_guard = data.loudness_db.lock();
    let db = db_guard.as_ref()?;

    match db.needs_scan(path) {
        Ok(false) => match db.get(path) {
            Ok(Some(track)) => {
                log::info!("Using cached loudness for: {}", path);
                Some(track)
            }
            Ok(None) => None,
            Err(e) => {
                log::warn!("Loudness cache read failed for '{}': {}", path, e);
                None
            }
        },
        Ok(true) => None,
        Err(e) => {
            log::warn!("Loudness cache validation failed for '{}': {}", path, e);
            None
        }
    }
}

fn try_store_loudness(data: &web::Data<Arc<AppState>>, track: &crate::processor::TrackLoudness) {
    let db_guard = data.loudness_db.lock();
    if let Some(db) = db_guard.as_ref() {
        if let Err(e) = db.upsert(track) {
            log::warn!(
                "Failed to store loudness cache for '{}': {}",
                track.file_path,
                e
            );
        }
    }
}

fn analyze_track_loudness(
    path: String,
    credentials: Option<crate::decoder::HttpCredentials>,
) -> Result<crate::processor::TrackLoudness, String> {
    use crate::decoder::StreamingDecoder;
    use crate::processor::{LoudnessMeter, TrackLoudness, DEFAULT_STREAMING_TARGET_LUFS};

    let mut decoder = StreamingDecoder::open_with_credentials(&path, credentials.as_ref())
        .map_err(|e| format!("Failed to open file: {}", e))?;

    let sample_rate = decoder.info.sample_rate;
    let channels = decoder.info.channels;
    let mut meter = LoudnessMeter::new(channels, sample_rate);

    let mut total_samples = 0usize;
    while let Some(chunk) = decoder.decode_next().map_err(|e| e.to_string())? {
        meter.process(&chunk);
        total_samples += chunk.len();
    }

    let integrated_lufs = meter.integrated_loudness();
    let integrated_lufs = if integrated_lufs.is_finite() {
        integrated_lufs
    } else {
        -70.0
    };
    let loudness_range = meter.loudness_range();
    let true_peak_linear = meter.true_peak().max(1e-10); // guard against 0.0 and negative
    let true_peak_dbtp = 20.0 * true_peak_linear.log10();

    let track_loudness = TrackLoudness::new(
        &path,
        integrated_lufs,
        true_peak_dbtp,
        if loudness_range > 0.0 {
            Some(loudness_range)
        } else {
            None
        },
        DEFAULT_STREAMING_TARGET_LUFS,
    );

    log::info!(
        "Loudness scan complete: {} -> {:.1} LUFS, {:.1} dBTP, {} samples",
        path,
        integrated_lufs,
        true_peak_dbtp,
        total_samples
    );

    Ok(track_loudness)
}

async fn load(data: web::Data<Arc<AppState>>, body: web::Json<LoadRequest>) -> HttpResponse {
    let path = match validate_path(&body.path) {
        Ok(p) => p,
        Err(e) => return HttpResponse::BadRequest().json(ApiResponse::error(&e)),
    };

    let credentials = {
        let cfg = data.webdav_config.lock();
        cfg.http_credentials()
    };
    let mut player = data.player.lock();
    match player.load_with_credentials(&path, credentials.as_ref()) {
        Ok(()) => {
            let snapshot = build_runtime_snapshot(&player);
            let media_id = data.app_db.record_media_stub(&path);
            if let Err(e) = &media_id {
                log::warn!("Failed to ensure media item for '{}': {}", path, e);
            }

            let previous_session = { data.active_session_id.lock().take() };
            if let Some(session_id) = previous_session {
                if let Err(e) = data
                    .app_db
                    .finish_playback_session(session_id, "replaced", &snapshot)
                {
                    log::warn!(
                        "Failed to close replaced playback session {}: {}",
                        session_id,
                        e
                    );
                }
            }

            match data
                .app_db
                .start_playback_session(&path, "loaded", &snapshot)
            {
                Ok(session_id) => {
                    *data.active_session_id.lock() = Some(session_id);
                    let payload = serde_json::json!({
                        "media_id": media_id.ok(),
                        "kind": "load"
                    });
                    if let Err(e) = data.app_db.append_playback_history(
                        Some(session_id),
                        &path,
                        "load_requested",
                        snapshot.position_secs,
                        Some(&payload),
                    ) {
                        log::warn!("Failed to append load history: {}", e);
                    }
                }
                Err(e) => log::warn!("Failed to start playback session for '{}': {}", path, e),
            }

            sync_queue_snapshot(&data);
            HttpResponse::Ok().json(ApiResponse::success_with_state(
                "Track loaded",
                get_player_state(&player),
            ))
        }
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::error(&format!("Failed to load: {}", e))),
    }
}

async fn play(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let mut player = data.player.lock();
    match player.play() {
        Ok(()) => {
            let snapshot = build_runtime_snapshot(&player);
            if let Some(session_id) = *data.active_session_id.lock() {
                if let Err(e) = data
                    .app_db
                    .update_playback_session(session_id, "playing", &snapshot)
                {
                    log::warn!("Failed to update playback session {}: {}", session_id, e);
                }
                if let Some(path) = player.shared_state().file_path.read().clone() {
                    let _ = data.app_db.append_playback_history(
                        Some(session_id),
                        &path,
                        "play",
                        snapshot.position_secs,
                        None,
                    );
                }
            }
            player
                .shared_state()
                .event_flags
                .fetch_or(crate::player::EVENT_PLAYBACK_STARTED, Ordering::Release);
            HttpResponse::Ok().json(ApiResponse::success_with_state(
                "Playback started",
                get_player_state(&player),
            ))
        }
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::error(&format!("Playback failed: {}", e))),
    }
}

async fn pause(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let mut player = data.player.lock();
    match player.pause() {
        Ok(()) => {
            let snapshot = build_runtime_snapshot(&player);
            if let Some(session_id) = *data.active_session_id.lock() {
                if let Err(e) = data
                    .app_db
                    .update_playback_session(session_id, "paused", &snapshot)
                {
                    log::warn!("Failed to update playback session {}: {}", session_id, e);
                }
                if let Some(path) = player.shared_state().file_path.read().clone() {
                    let _ = data.app_db.append_playback_history(
                        Some(session_id),
                        &path,
                        "pause",
                        snapshot.position_secs,
                        None,
                    );
                }
            }
            player
                .shared_state()
                .event_flags
                .fetch_or(crate::player::EVENT_PLAYBACK_PAUSED, Ordering::Release);
            HttpResponse::Ok().json(ApiResponse::success_with_state(
                "Playback paused",
                get_player_state(&player),
            ))
        }
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::error(&format!("Pause failed: {}", e))),
    }
}

async fn stop(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let mut player = data.player.lock();
    let snapshot_before_stop = build_runtime_snapshot(&player);
    let current_path = player.shared_state().file_path.read().clone();
    player.stop();
    if let Some(session_id) = data.active_session_id.lock().take() {
        if let Err(e) =
            data.app_db
                .finish_playback_session(session_id, "stopped", &snapshot_before_stop)
        {
            log::warn!("Failed to finish playback session {}: {}", session_id, e);
        }
        if let Some(path) = current_path {
            let _ = data.app_db.append_playback_history(
                Some(session_id),
                &path,
                "stop",
                snapshot_before_stop.position_secs,
                None,
            );
        }
    }
    sync_queue_snapshot(&data);
    player
        .shared_state()
        .event_flags
        .fetch_or(crate::player::EVENT_PLAYBACK_STOPPED, Ordering::Release);
    HttpResponse::Ok().json(ApiResponse::success_with_state(
        "Playback stopped",
        get_player_state(&player),
    ))
}

async fn seek(data: web::Data<Arc<AppState>>, body: web::Json<SeekRequest>) -> HttpResponse {
    let mut player = data.player.lock();
    match player.seek(body.position) {
        Ok(()) => {
            let snapshot = build_runtime_snapshot(&player);
            if let Some(session_id) = *data.active_session_id.lock() {
                if let Err(e) = data
                    .app_db
                    .update_playback_session(session_id, "seeking", &snapshot)
                {
                    log::warn!("Failed to update playback session {}: {}", session_id, e);
                }
                if let Some(path) = player.shared_state().file_path.read().clone() {
                    let payload = serde_json::json!({ "target_position": body.position });
                    let _ = data.app_db.append_playback_history(
                        Some(session_id),
                        &path,
                        "seek",
                        Some(body.position),
                        Some(&payload),
                    );
                }
            }
            player
                .shared_state()
                .event_flags
                .fetch_or(crate::player::EVENT_PLAYBACK_SEEKED, Ordering::Release);
            HttpResponse::Ok().json(ApiResponse::success_with_state(
                "Seek successful",
                get_player_state(&player),
            ))
        }
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::error(&format!("Seek failed: {}", e))),
    }
}

async fn set_repeat_mode(
    data: web::Data<Arc<AppState>>,
    body: web::Json<PlaybackModeRequest>,
) -> HttpResponse {
    let mode = match RepeatMode::parse(&body.mode) {
        Some(mode) => mode,
        None => {
            return HttpResponse::BadRequest().json(ApiResponse::error(
                "Invalid repeat mode. Use: off, one, all",
            ));
        }
    };

    let player = data.player.lock();
    player.set_repeat_mode(mode);
    HttpResponse::Ok().json(ApiResponse::success_with_state(
        "Repeat mode updated",
        get_player_state(&player),
    ))
}

async fn set_shuffle_mode(
    data: web::Data<Arc<AppState>>,
    body: web::Json<PlaybackModeRequest>,
) -> HttpResponse {
    let mode = match ShuffleMode::parse(&body.mode) {
        Some(mode) => mode,
        None => {
            return HttpResponse::BadRequest()
                .json(ApiResponse::error("Invalid shuffle mode. Use: off, on"));
        }
    };

    let update_result = match mode {
        ShuffleMode::Off => data.app_db.unshuffle_entries("active"),
        ShuffleMode::On => data.app_db.shuffle_entries("active"),
    };
    if let Err(e) = update_result {
        return HttpResponse::InternalServerError().json(ApiResponse::error(&e));
    }

    let player = data.player.lock();
    player.set_shuffle_mode(mode);
    drop(player);
    emit_queue_updated(&data);

    let player = data.player.lock();
    HttpResponse::Ok().json(ApiResponse::success_with_state(
        "Shuffle mode updated",
        get_player_state(&player),
    ))
}

async fn get_state(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let player = data.player.lock();
    HttpResponse::Ok().json(ApiResponse {
        status: "success".into(),
        message: None,
        state: Some(get_player_state(&player)),
        devices: None,
    })
}

async fn get_queue_status(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let shared_state = {
        let player = data.player.lock();
        player.shared_state()
    };

    let current_track_path = shared_state.current_track_path.read().clone();
    let pending_track_path = shared_state.pending_file_path.read().clone();
    let needs_preload = shared_state.needs_preload.load(Ordering::Acquire);
    let pending_ready = shared_state.pending_ready.load(Ordering::Acquire);
    let is_preload_canceling = shared_state.cancel_preload_signal.load(Ordering::Acquire);

    sync_queue_snapshot(&data);

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "queue": {
            "current_track_path": current_track_path,
            "pending_track_path": pending_track_path,
            "needs_preload": needs_preload,
            "pending_ready": pending_ready,
            "is_preload_canceling": is_preload_canceling,
        }
    }))
}

async fn set_volume(
    data: web::Data<Arc<AppState>>,
    body: web::Json<VolumeRequest>,
) -> HttpResponse {
    let mut player = data.player.lock();
    player.set_volume(body.volume as f64);
    let snapshot = build_runtime_snapshot(&player);
    if let Some(session_id) = *data.active_session_id.lock() {
        if let Err(e) = data
            .app_db
            .update_playback_session(session_id, "active", &snapshot)
        {
            log::warn!(
                "Failed to persist volume update for session {}: {}",
                session_id,
                e
            );
        }
    }
    HttpResponse::Ok().json(ApiResponse::success_with_state(
        "Volume set",
        get_player_state(&player),
    ))
}

async fn list_devices(data: web::Data<Arc<AppState>>, _req: HttpRequest) -> HttpResponse {
    let player = data.player.lock();
    let devices = player.list_devices();

    let response = DevicesResponse {
        preferred: devices.clone(),
        other: vec![],
        preferred_name: if cfg!(windows) { "WASAPI" } else { "CoreAudio" }.into(),
    };

    HttpResponse::Ok().json(ApiResponse {
        status: "success".into(),
        message: None,
        state: None,
        devices: Some(response),
    })
}

async fn configure_output(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ConfigureOutputRequest>,
) -> HttpResponse {
    let mut player = data.player.lock();

    if let Err(e) = player.select_device(body.device_id) {
        return HttpResponse::InternalServerError().json(ApiResponse::error(&e));
    }

    if let Some(exclusive) = body.exclusive {
        player.exclusive_mode = exclusive;
        player
            .shared_state()
            .exclusive_mode
            .store(exclusive, std::sync::atomic::Ordering::Relaxed);
    }

    if let Err(e) =
        data.app_db
            .upsert_device_config("active_output", body.device_id, player.exclusive_mode)
    {
        log::warn!("Failed to persist output config: {}", e);
    }

    HttpResponse::Ok().json(ApiResponse::success_with_state(
        "Output configured",
        get_player_state(&player),
    ))
}

async fn configure_upsampling(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ConfigureUpsamplingRequest>,
) -> HttpResponse {
    const MIN_SAMPLE_RATE: u32 = 8000;
    const MAX_SAMPLE_RATE: u32 = 384000;

    if let Some(sr) = body.target_samplerate {
        if sr == 0 {
            return HttpResponse::BadRequest().json(ApiResponse::error(
                "Sample rate cannot be 0. Use null to disable upsampling.",
            ));
        }
        if sr < MIN_SAMPLE_RATE {
            return HttpResponse::BadRequest().json(ApiResponse::error(&format!(
                "Sample rate {} Hz is too low. Minimum: {} Hz.",
                sr, MIN_SAMPLE_RATE
            )));
        }
        if sr > MAX_SAMPLE_RATE {
            return HttpResponse::BadRequest().json(ApiResponse::error(&format!(
                "Sample rate {} Hz is too high. Maximum: {} Hz.",
                sr, MAX_SAMPLE_RATE
            )));
        }
    }

    let mut player = data.player.lock();
    player.target_sample_rate = body.target_samplerate;

    let msg = match body.target_samplerate {
        Some(sr) => format!("Upsampling set to {} Hz", sr),
        None => "Upsampling disabled".into(),
    };

    HttpResponse::Ok().json(ApiResponse::success(&msg))
}

#[derive(Deserialize)]
struct ConfigureResamplingRequest {
    quality: Option<String>,
    use_cache: Option<bool>,
    preemptive_resample: Option<bool>,
}

async fn configure_resampling(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ConfigureResamplingRequest>,
) -> HttpResponse {
    let mut player = data.player.lock();

    if let Some(ref quality_str) = body.quality {
        let quality = match quality_str.to_lowercase().as_str() {
            "low" => crate::config::ResampleQuality::Low,
            "std" | "standard" => crate::config::ResampleQuality::Standard,
            "hq" | "high" => crate::config::ResampleQuality::High,
            "uhq" | "ultrahigh" => crate::config::ResampleQuality::UltraHigh,
            _ => {
                return HttpResponse::BadRequest().json(ApiResponse::error(
                    "Invalid quality. Use: low, std, hq, uhq",
                ));
            }
        };
        player.set_resample_quality(quality);
    }

    if let Some(cache) = body.use_cache {
        player.set_use_cache(cache);
    }

    if let Some(preemptive) = body.preemptive_resample {
        player.set_preemptive_resample(preemptive);
    }

    let payload = serde_json::json!({
        "quality": player.get_resample_quality(),
        "use_cache": player.get_use_cache(),
        "preemptive_resample": player.get_preemptive_resample(),
    });
    if let Err(e) = data.app_db.upsert_dsp_config("resampling", &payload) {
        log::warn!("Failed to persist resampling config: {}", e);
    }

    HttpResponse::Ok().json(ApiResponse::success_with_state(
        "Resampling settings updated",
        get_player_state(&player),
    ))
}

async fn configure_normalization(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ConfigureNormalizationRequest>,
) -> HttpResponse {
    let mut player = data.player.lock();

    if let Some(enabled) = body.enabled {
        player.set_loudness_enabled(enabled);
    }

    if let Some(target_lufs) = body.target_lufs {
        player.set_target_lufs(target_lufs);
    }

    if let Some(album_gain_db) = body.album_gain_db {
        player.set_album_gain(album_gain_db);
    }

    if let Some(preamp_db) = body.preamp_db {
        player.set_preamp_gain(preamp_db);
    }

    if let Some(ref mode_str) = body.mode {
        let mode = match mode_str.to_lowercase().as_str() {
            "track" => crate::config::NormalizationMode::Track,
            "album" => crate::config::NormalizationMode::Album,
            "streaming" => crate::config::NormalizationMode::Streaming,
            "replaygain_track" | "rg_track" => crate::config::NormalizationMode::ReplayGainTrack,
            "replaygain_album" | "rg_album" => crate::config::NormalizationMode::ReplayGainAlbum,
            _ => crate::config::NormalizationMode::Track,
        };
        player.set_normalization_mode(mode);
    }

    let info = player.get_loudness_info();
    let payload = serde_json::json!({
        "enabled": player.loudness_enabled,
        "target_lufs": player.get_target_lufs(),
        "preamp_db": info.preamp_db,
        "current_gain_db": info.current_gain_db,
    });
    if let Err(e) = data.app_db.upsert_dsp_config("normalization", &payload) {
        log::warn!("Failed to persist normalization config: {}", e);
    }

    HttpResponse::Ok().json(ApiResponse::success_with_state(
        "Normalization configured",
        get_player_state(&player),
    ))
}

async fn get_loudness_info(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let player = data.player.lock();
    let info = player.get_loudness_info();

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "loudness": {
            "integrated_lufs": info.integrated_lufs,
            "short_term_lufs": info.short_term_lufs,
            "momentary_lufs": info.momentary_lufs,
            "loudness_range": info.loudness_range,
            "true_peak_dbtp": info.true_peak_dbtp,
            "current_gain_db": info.current_gain_db,
            "target_gain_db": info.target_gain_db,
        }
    }))
}

async fn scan_track_loudness(
    data: web::Data<Arc<AppState>>,
    body: web::Json<LoadRequest>,
) -> HttpResponse {
    let path = match validate_path(&body.path) {
        Ok(p) => p,
        Err(e) => return HttpResponse::BadRequest().json(ApiResponse::error(&e)),
    };

    if let Some(track_loudness) = try_get_cached_loudness(&data, &path) {
        return HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "source": "cache",
            "track_loudness": track_loudness_to_json(&track_loudness)
        }));
    }

    let credentials = {
        let cfg = data.webdav_config.lock();
        cfg.http_credentials()
    };

    let path_for_job = path.clone();
    let credentials_for_job = credentials.clone();

    let result = run_analysis_job(&data, move || {
        analyze_track_loudness(path_for_job, credentials_for_job)
    })
    .await;

    match result {
        Ok(track_loudness) => {
            try_store_loudness(&data, &track_loudness);
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "source": "fresh",
                "track_loudness": track_loudness_to_json(&track_loudness)
            }))
        }
        Err(e) => analysis_error_response(&e),
    }
}

async fn scan_loudness_background(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ScanBackgroundRequest>,
) -> HttpResponse {
    let path = match validate_path(&body.path) {
        Ok(p) => p,
        Err(e) => return HttpResponse::BadRequest().json(ApiResponse::error(&e)),
    };
    let store = body.store.unwrap_or(true);

    if data.analysis_semaphore.available_permits() == 0 {
        return HttpResponse::TooManyRequests().json(ApiResponse::error(
            "Too many scan tasks in progress, please retry later",
        ));
    }

    cleanup_scan_tasks(&data);

    let task_id = data.scan_task_counter.fetch_add(1, Ordering::Relaxed) + 1;
    let now = now_epoch_secs();
    let initial_task = ScanTaskRecord {
        status: "queued".to_string(),
        created_at_epoch_secs: now,
        updated_at_epoch_secs: now,
        result: None,
        error: None,
    };
    data.scan_tasks.lock().insert(task_id, initial_task.clone());
    upsert_scan_task_record(&data, task_id, &path, &initial_task, store);

    let data_for_task = data.clone();
    let path_for_task = path.clone();
    actix_rt::spawn(async move {
        {
            if let Some(task) = data_for_task.scan_tasks.lock().get_mut(&task_id) {
                task.status = "running".to_string();
                task.updated_at_epoch_secs = now_epoch_secs();
                let snapshot = task.clone();
                upsert_scan_task_record(&data_for_task, task_id, &path_for_task, &snapshot, store);
            }
        }

        if task_is_canceled(&data_for_task, task_id) {
            return;
        }

        if let Some(track_loudness) = try_get_cached_loudness(&data_for_task, &path_for_task) {
            if !task_is_canceled(&data_for_task, task_id) {
                if let Some(task) = data_for_task.scan_tasks.lock().get_mut(&task_id) {
                    task.status = "success".to_string();
                    task.result = Some(track_loudness_to_json(&track_loudness));
                    task.updated_at_epoch_secs = now_epoch_secs();
                    let snapshot = task.clone();
                    upsert_scan_task_record(
                        &data_for_task,
                        task_id,
                        &path_for_task,
                        &snapshot,
                        store,
                    );
                }
            }
            return;
        }

        let path_for_analysis = path_for_task.clone();
        let result = run_analysis_job(&data_for_task, move || {
            analyze_track_loudness(path_for_analysis, None)
        })
        .await;

        match result {
            Ok(track_loudness) => {
                if store {
                    try_store_loudness(&data_for_task, &track_loudness);
                }
                if !task_is_canceled(&data_for_task, task_id) {
                    if let Some(task) = data_for_task.scan_tasks.lock().get_mut(&task_id) {
                        task.status = "success".to_string();
                        task.result = Some(track_loudness_to_json(&track_loudness));
                        task.updated_at_epoch_secs = now_epoch_secs();
                        let snapshot = task.clone();
                        upsert_scan_task_record(
                            &data_for_task,
                            task_id,
                            &path_for_task,
                            &snapshot,
                            store,
                        );
                    }
                }
            }
            Err(e) => {
                if !task_is_canceled(&data_for_task, task_id) {
                    if let Some(task) = data_for_task.scan_tasks.lock().get_mut(&task_id) {
                        task.status = "error".to_string();
                        task.error = Some(e);
                        task.updated_at_epoch_secs = now_epoch_secs();
                        let snapshot = task.clone();
                        upsert_scan_task_record(
                            &data_for_task,
                            task_id,
                            &path_for_task,
                            &snapshot,
                            store,
                        );
                    }
                }
            }
        }

        cleanup_scan_tasks(&data_for_task);
    });

    HttpResponse::Accepted().json(serde_json::json!({
        "status": "accepted",
        "task_id": task_id,
        "path": path
    }))
}

async fn get_scan_loudness_task(
    data: web::Data<Arc<AppState>>,
    path: web::Path<ScanTaskPath>,
) -> HttpResponse {
    cleanup_scan_tasks(&data);

    let task_id = path.task_id;
    let tasks = data.scan_tasks.lock();
    if let Some(task) = tasks.get(&task_id) {
        HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "task_id": task_id,
            "task": task
        }))
    } else {
        drop(tasks);
        match data.app_db.get_analysis_task(task_id) {
            Ok(Some(task)) => HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "task_id": task_id,
                "task": task
            })),
            Ok(None) => HttpResponse::NotFound().json(ApiResponse::error("Scan task not found")),
            Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
        }
    }
}

async fn cancel_scan_loudness_task(
    data: web::Data<Arc<AppState>>,
    path: web::Path<ScanTaskPath>,
) -> HttpResponse {
    cleanup_scan_tasks(&data);

    let task_id = path.task_id;
    let mut tasks = data.scan_tasks.lock();
    if let Some(task) = tasks.get_mut(&task_id) {
        match task.status.as_str() {
            "queued" | "running" => {
                task.status = "canceled".to_string();
                task.error = Some("Canceled by client".to_string());
                task.updated_at_epoch_secs = now_epoch_secs();
                let snapshot = task.clone();
                upsert_scan_task_record(&data, task_id, "", &snapshot, true);
                HttpResponse::Ok().json(serde_json::json!({
                    "status": "success",
                    "task_id": task_id,
                    "message": "Scan task canceled"
                }))
            }
            _ => HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "task_id": task_id,
                "message": "Task already finished"
            })),
        }
    } else {
        HttpResponse::NotFound().json(ApiResponse::error("Scan task not found"))
    }
}

async fn queue_next(
    data: web::Data<Arc<AppState>>,
    body: web::Json<QueueNextRequest>,
) -> HttpResponse {
    let path = match validate_path(&body.path) {
        Ok(p) => p,
        Err(e) => return HttpResponse::BadRequest().json(ApiResponse::error(&e)),
    };

    let credentials = match (&body.username, &body.password) {
        (Some(u), Some(p)) => Some(crate::decoder::HttpCredentials {
            username: u.clone(),
            password: p.clone(),
        }),
        _ => data.webdav_config.lock().http_credentials(),
    };

    let player = data.player.lock();
    match player.queue_next_with_credentials(&path, credentials) {
        Ok(()) => {
            let _ = data.app_db.mark_queue_entry_status_by_path(
                "active",
                &path,
                &["queued"],
                "preloading",
            );
            let payload = serde_json::json!({
                "queued_path": path,
                "has_credentials_override": body.username.is_some() && body.password.is_some()
            });
            let current_path = player.shared_state().file_path.read().clone();
            if let Some(session_id) = *data.active_session_id.lock() {
                let source_path = current_path.as_deref().unwrap_or(&path);
                let _ = data.app_db.append_playback_history(
                    Some(session_id),
                    source_path,
                    "queue_next",
                    Some(player.shared_state().current_time_secs()),
                    Some(&payload),
                );
            }
            sync_queue_snapshot(&data);
            emit_queue_updated(&data);
            HttpResponse::Ok().json(ApiResponse::success("Queued for gapless playback"))
        }
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn play_from_persistent_queue(
    data: web::Data<Arc<AppState>>,
    body: web::Json<PlayQueueRequest>,
) -> HttpResponse {
    let entry = match data.app_db.list_queue_entries("active") {
        Ok(entries) => {
            if let Some(entry_id) = body.entry_id {
                entries.into_iter().find(|entry| entry.entry_id == entry_id)
            } else {
                entries
                    .into_iter()
                    .find(|entry| entry.status == "queued" || entry.status == "preloading")
            }
        }
        Err(e) => return HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    };

    let Some(entry) = entry else {
        return HttpResponse::NotFound().json(ApiResponse::error("Queue entry not found"));
    };

    match load_queue_entry_for_playback(&data, entry, true) {
        Ok(()) => {
            let player = data.player.lock();
            HttpResponse::Ok().json(ApiResponse::success_with_state(
                "Queue playback started",
                get_player_state(&player),
            ))
        }
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&format!(
            "Failed to play queue entry: {}",
            e
        ))),
    }
}

async fn cancel_preload(data: web::Data<Arc<AppState>>) -> HttpResponse {
    data.player.lock().cancel_preload();
    HttpResponse::Ok().json(ApiResponse::success("Preload cancelled"))
}

async fn load_playlist(
    data: web::Data<Arc<AppState>>,
    body: web::Json<PlaylistLoadRequest>,
) -> HttpResponse {
    let result = match playlist::load_playlist(&body.path, validate_path) {
        Ok(result) => result,
        Err(e) => return HttpResponse::BadRequest().json(ApiResponse::error(&e)),
    };

    let paths: Vec<String> = result
        .entries
        .iter()
        .map(|entry| entry.path.clone())
        .collect();

    let update_result = match body.mode {
        PlaylistLoadMode::ParseOnly => Ok(()),
        PlaylistLoadMode::Append => data.app_db.append_queue_entries("active", &paths),
        PlaylistLoadMode::Replace => data.app_db.replace_queue_entries("active", &paths),
    };

    match update_result {
        Ok(()) => {
            if !matches!(body.mode, PlaylistLoadMode::ParseOnly) {
                emit_queue_updated(&data);
            }
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "tracks": result.entries,
                "count": paths.len(),
                "rejected": result.rejected
            }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn load_ir(data: web::Data<Arc<AppState>>, body: web::Json<LoadIrRequest>) -> HttpResponse {
    let path = match validate_path(&body.path) {
        Ok(p) => p,
        Err(e) => return HttpResponse::BadRequest().json(ApiResponse::error(&e)),
    };

    let mut player = data.player.lock();
    match player.load_ir(&path) {
        Ok(()) => HttpResponse::Ok().json(ApiResponse::success("IR loaded")),
        Err(e) => {
            if e.to_ascii_lowercase().contains("not yet implemented") {
                HttpResponse::NotImplemented().json(ApiResponse::error(&e))
            } else {
                HttpResponse::InternalServerError().json(ApiResponse::error(&e))
            }
        }
    }
}

async fn unload_ir(data: web::Data<Arc<AppState>>) -> HttpResponse {
    data.player.lock().unload_ir();
    HttpResponse::Ok().json(ApiResponse::success("IR unloaded"))
}

async fn get_loading_status(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let player = data.player.lock();

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "loading": {
            "is_loading": player.is_loading(),
            "progress": player.load_progress(),
            "error": player.load_error()
        }
    }))
}

async fn get_ir_status(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let player = data.player.lock();

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "ir": {
            "loaded": player.is_ir_loaded()
        }
    }))
}

async fn get_recent_analysis_tasks(
    data: web::Data<Arc<AppState>>,
    query: web::Query<LimitQuery>,
) -> HttpResponse {
    let limit = query.limit.unwrap_or(50).clamp(1, 500);
    match data
        .app_db
        .recent_analysis_tasks_by_type(query.task_type.as_deref(), limit)
    {
        Ok(tasks) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "tasks": tasks
        })),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn get_playback_history(
    data: web::Data<Arc<AppState>>,
    query: web::Query<LimitQuery>,
) -> HttpResponse {
    let limit = query.limit.unwrap_or(50).clamp(1, 500);
    match data.app_db.recent_playback_history(limit) {
        Ok(history) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "history": history
        })),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn get_playback_sessions(
    data: web::Data<Arc<AppState>>,
    query: web::Query<LimitQuery>,
) -> HttpResponse {
    let limit = query.limit.unwrap_or(50).clamp(1, 500);
    match data.app_db.recent_playback_sessions(limit) {
        Ok(sessions) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "sessions": sessions
        })),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn get_media_items(
    data: web::Data<Arc<AppState>>,
    query: web::Query<LimitQuery>,
) -> HttpResponse {
    let limit = query.limit.unwrap_or(100).clamp(1, 1000);
    match data.app_db.recent_media_items(limit) {
        Ok(items) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "media_items": items
        })),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

#[derive(Deserialize)]
struct MediaPath {
    media_id: String,
}

async fn get_media_cover_art(
    data: web::Data<Arc<AppState>>,
    path: web::Path<MediaPath>,
) -> HttpResponse {
    match data.app_db.get_cover_art_for_media(&path.media_id) {
        Ok(Some((record, bytes))) => {
            let mime = record
                .mime_type
                .clone()
                .unwrap_or_else(|| "application/octet-stream".to_string());
            HttpResponse::Ok()
                .insert_header(("Content-Type", mime))
                .insert_header(("Content-Length", bytes.len().to_string()))
                .insert_header(("X-Cover-Art-Id", record.cover_art_id))
                .body(bytes)
        }
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::error("Cover art not found")),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn get_library_roots(data: web::Data<Arc<AppState>>) -> HttpResponse {
    match data.app_db.list_library_roots() {
        Ok(roots) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "roots": roots
        })),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn scan_library_root(
    data: web::Data<Arc<AppState>>,
    body: web::Json<LibraryScanRequest>,
) -> HttpResponse {
    let started_at = now_epoch_secs();
    let scan_task_id = data.scan_task_counter.fetch_add(1, Ordering::Relaxed) + 1;
    let requested_path = body.path.trim();
    let is_remote = requested_path.starts_with("http://")
        || requested_path.starts_with("https://")
        || requested_path.starts_with('/');
    let path = if is_remote {
        requested_path.to_string()
    } else {
        match validate_path(requested_path) {
            Ok(value) => value,
            Err(e) => return HttpResponse::BadRequest().json(ApiResponse::error(&e)),
        }
    };

    let display_name = body.display_name.clone().unwrap_or_else(|| {
        std::path::Path::new(&path)
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.to_string())
            .unwrap_or_else(|| path.clone())
    });
    let source_kind = if is_remote { "webdav" } else { "local" };
    let source_key = body
        .source_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let root_id = match data.app_db.upsert_library_root(
        source_key,
        &path,
        source_kind,
        &display_name,
        "scanning",
    ) {
        Ok(value) => value,
        Err(e) => return HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    };

    if let Err(e) = data.app_db.update_library_root_scan_status(
        root_id,
        "scanning",
        None,
        Some(now_epoch_secs()),
        None,
    ) {
        return HttpResponse::InternalServerError().json(ApiResponse::error(&e));
    }
    persist_library_scan_task(
        &data,
        scan_task_id,
        &path,
        "scanning",
        started_at,
        started_at,
        Some(&serde_json::json!({
            "root_id": root_id,
            "source_kind": source_kind,
            "source_key": source_key,
            "display_name": display_name,
        })),
        None,
    );

    let result = if source_kind == "local" {
        scan_local_library(&data, root_id, &path)
    } else {
        scan_webdav_library(&data, root_id, &path, source_key)
    };

    match result {
        Ok((scanned, indexed)) => {
            let finished_at = now_epoch_secs();
            let payload = serde_json::json!({
                "root_id": root_id,
                "source_kind": source_kind,
                "source_key": source_key,
                "display_name": display_name,
                "scanned_files": scanned,
                "indexed_files": indexed,
            });
            persist_library_scan_task(
                &data,
                scan_task_id,
                &path,
                "success",
                started_at,
                finished_at,
                Some(&payload),
                None,
            );
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "task_id": scan_task_id,
                "root_id": root_id,
                "scanned_files": scanned,
                "indexed_files": indexed
            }))
        }
        Err(e) => {
            let finished_at = now_epoch_secs();
            let _ = data.app_db.update_library_root_scan_status(
                root_id,
                "error",
                None,
                None,
                Some(finished_at),
            );
            persist_library_scan_task(
                &data,
                scan_task_id,
                &path,
                "error",
                started_at,
                finished_at,
                Some(&serde_json::json!({
                    "root_id": root_id,
                    "source_kind": source_kind,
                    "source_key": source_key,
                    "display_name": display_name,
                })),
                Some(&e),
            );
            HttpResponse::InternalServerError().json(ApiResponse::error(&e))
        }
    }
}

async fn get_queue_snapshot_domain(data: web::Data<Arc<AppState>>) -> HttpResponse {
    match data.app_db.get_queue_snapshot() {
        Ok(snapshot) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "queue_snapshot": snapshot
        })),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn get_persistent_queue(data: web::Data<Arc<AppState>>) -> HttpResponse {
    match data.app_db.list_queue_entries("active") {
        Ok(entries) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "queue": entries
        })),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn replace_persistent_queue(
    data: web::Data<Arc<AppState>>,
    body: web::Json<QueueReplaceRequest>,
) -> HttpResponse {
    let mut validated = Vec::with_capacity(body.paths.len());
    for path in &body.paths {
        match validate_path(path) {
            Ok(value) => validated.push(value),
            Err(e) => return HttpResponse::BadRequest().json(ApiResponse::error(&e)),
        }
    }

    match data.app_db.replace_queue_entries("active", &validated) {
        Ok(()) => {
            emit_queue_updated(&data);
            get_persistent_queue(data).await
        }
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn enqueue_persistent_queue(
    data: web::Data<Arc<AppState>>,
    body: web::Json<QueueEnqueueRequest>,
) -> HttpResponse {
    let path = match validate_path(&body.path) {
        Ok(value) => value,
        Err(e) => return HttpResponse::BadRequest().json(ApiResponse::error(&e)),
    };

    match data.app_db.append_queue_entry("active", &path) {
        Ok(()) => {
            emit_queue_updated(&data);
            get_persistent_queue(data).await
        }
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn remove_persistent_queue_entry(
    data: web::Data<Arc<AppState>>,
    path: web::Path<QueueEntryPath>,
) -> HttpResponse {
    match data.app_db.remove_queue_entry("active", path.entry_id) {
        Ok(()) => {
            emit_queue_updated(&data);
            get_persistent_queue(data).await
        }
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn clear_persistent_queue(data: web::Data<Arc<AppState>>) -> HttpResponse {
    match data.app_db.clear_queue("active") {
        Ok(()) => {
            emit_queue_updated(&data);
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "queue": []
            }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn get_device_config_domain(data: web::Data<Arc<AppState>>) -> HttpResponse {
    match data.app_db.get_device_config("active_output") {
        Ok(config) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "device_config": config
        })),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn get_dsp_configs_domain(data: web::Data<Arc<AppState>>) -> HttpResponse {
    match data.app_db.list_dsp_configs() {
        Ok(configs) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "dsp_configs": configs
        })),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

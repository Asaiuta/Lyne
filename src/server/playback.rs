use super::lyrics;
use super::*;
use crate::app_database::{
    media_id_for_path, LibrarySortField, LibrarySortOrder, LibraryTrackQuery, QueueEntryRecord,
};
use crate::player::{PlayerState, RepeatMode, SharedState, ShuffleMode};
use crate::playlist;
use actix_web::http::StatusCode;
use actix_web::{web, HttpRequest, HttpResponse};
use ncm_api_rs::Query;
use serde::Deserialize;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
            "/domain/library/track_summaries",
            web::get().to(get_library_track_summaries),
        )
        .route(
            "/domain/library/tracks/{track_key}",
            web::get().to(get_library_track_detail),
        )
        .route(
            "/domain/library/tracks/{track_key}/cover_art",
            web::get().to(get_library_track_cover_art),
        )
        .route(
            "/domain/library/queue_from_query",
            web::post().to(replace_queue_from_library_query),
        )
        .route(
            "/domain/library/queue_from_track_keys",
            web::post().to(replace_queue_from_track_keys),
        )
        .route(
            "/domain/media_items/delete",
            web::post().to(delete_media_items),
        )
        .route(
            "/domain/media_items/metadata",
            web::post().to(upsert_external_media_metadata),
        )
        .route(
            "/domain/local_playlists",
            web::get().to(list_local_playlists),
        )
        .route(
            "/domain/local_playlists",
            web::post().to(create_local_playlist),
        )
        .route(
            "/domain/local_playlists/{playlist_id}",
            web::get().to(get_local_playlist),
        )
        .route(
            "/domain/local_playlists/{playlist_id}",
            web::patch().to(update_local_playlist),
        )
        .route(
            "/domain/local_playlists/{playlist_id}",
            web::delete().to(delete_local_playlist),
        )
        .route(
            "/domain/local_playlists/{playlist_id}/items",
            web::post().to(add_local_playlist_items),
        )
        .route(
            "/domain/local_playlists/{playlist_id}/items/remove",
            web::post().to(remove_local_playlist_items),
        )
        .route(
            "/domain/media_items/{media_id}/cover_art",
            web::get().to(get_media_cover_art),
        )
        .route(
            "/domain/media_items/cover_art",
            web::get().to(get_media_cover_art_by_query),
        )
        .route("/domain/current_lyrics", web::get().to(get_current_lyrics))
        .route("/domain/library/roots", web::get().to(get_library_roots))
        .route(
            "/domain/library/roots/{root_id}",
            web::delete().to(delete_library_root),
        )
        .route("/domain/library/scan", web::post().to(scan_library_root))
        .route(
            "/domain/library/scan_tasks/{task_id}",
            web::get().to(get_library_scan_task),
        )
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
            "/domain/queue/play_next",
            web::post().to(play_next_queue_entry),
        )
        .route(
            "/domain/queue/play_previous",
            web::post().to(play_previous_queue_entry),
        )
        .route(
            "/domain/queue/adjacent",
            web::get().to(get_queue_adjacent_entries),
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
struct LibraryRootPath {
    root_id: i64,
}

#[derive(Deserialize)]
struct LimitQuery {
    limit: Option<usize>,
    task_type: Option<String>,
    all: Option<bool>,
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
struct ExternalMediaMetadataRequest {
    source_path: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration_secs: Option<f64>,
    external_artwork_url: Option<String>,
}

#[derive(Deserialize)]
struct MediaItemsDeleteRequest {
    media_ids: Vec<String>,
}

#[derive(Deserialize)]
struct LibraryTrackPath {
    track_key: i64,
}

#[derive(Deserialize)]
struct LibraryQueueQueryRequest {
    search: Option<String>,
    folder_path: Option<String>,
    sort_field: Option<String>,
    sort_order: Option<String>,
    start_track_key: Option<i64>,
}

#[derive(Deserialize)]
struct LibraryQueueTrackKeysRequest {
    track_keys: Vec<i64>,
    start_track_key: Option<i64>,
}

type LibraryQueueRow = (i64, String);

struct LibraryQueuePlayback {
    state: StateResponse,
    queued_count: usize,
}

#[derive(Debug)]
enum LibraryQueueFailure {
    BadRequest(String),
    NotFound(String),
    Internal(String),
}

impl LibraryQueueFailure {
    fn into_response(self) -> HttpResponse {
        let (status, message) = match self {
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, message),
            Self::NotFound(message) => (StatusCode::NOT_FOUND, message),
            Self::Internal(message) => (StatusCode::INTERNAL_SERVER_ERROR, message),
        };
        HttpResponse::build(status).json(ApiResponse::error(&message))
    }
}

#[derive(Deserialize)]
struct LocalPlaylistPath {
    playlist_id: String,
}

#[derive(Deserialize)]
struct LocalPlaylistCreateRequest {
    name: String,
    description: Option<String>,
}

#[derive(Deserialize)]
struct LocalPlaylistUpdateRequest {
    name: Option<String>,
    description: Option<String>,
}

#[derive(Deserialize)]
struct LocalPlaylistItemsRequest {
    media_ids: Vec<String>,
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
    source_path: Option<String>,
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

fn sync_queue_snapshot_from_shared(
    data: &web::Data<Arc<AppState>>,
    shared_state: &Arc<SharedState>,
) {
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
    emit_queue_updated_from_shared(&shared);
}

fn emit_queue_updated_from_shared(shared: &Arc<SharedState>) {
    shared
        .event_flags
        .fetch_or(crate::player::EVENT_QUEUE_UPDATED, Ordering::Release);
}

fn emit_playback_history_updated_from_shared(shared: &Arc<SharedState>) {
    shared.event_flags.fetch_or(
        crate::player::EVENT_PLAYBACK_HISTORY_UPDATED,
        Ordering::Release,
    );
}

fn append_playback_history_and_emit(
    data: &web::Data<Arc<AppState>>,
    shared: &Arc<SharedState>,
    session_id: Option<i64>,
    source_path: &str,
    event_type: &str,
    position_secs: Option<f64>,
    payload: Option<&serde_json::Value>,
) -> Result<(), String> {
    data.app_db.append_playback_history(
        session_id,
        source_path,
        event_type,
        position_secs,
        payload,
    )?;
    emit_playback_history_updated_from_shared(shared);
    Ok(())
}

const NCM_SCROBBLE_MIN_LISTEN_SECS: u64 = 30;

fn begin_ncm_scrobble_session(
    data: &web::Data<Arc<AppState>>,
    session_id: i64,
    source_path: &str,
    is_playing: bool,
) {
    let track_source = match data.app_db.ncm_track_source_for_path(source_path) {
        Ok(Some(track_source)) => track_source,
        Ok(None) => return,
        Err(err) => {
            log::warn!("Failed to read NCM track source for scrobble: {}", err);
            return;
        }
    };

    data.ncm_scrobble.lock().sessions.insert(
        session_id,
        NcmScrobbleSession {
            source_path: source_path.to_string(),
            song_id: track_source.song_id,
            accumulated: Duration::ZERO,
            segment_started_at: is_playing.then(Instant::now),
        },
    );
}

fn start_ncm_scrobble_segment(data: &web::Data<Arc<AppState>>, session_id: i64) {
    let mut state = data.ncm_scrobble.lock();
    if let Some(session) = state.sessions.get_mut(&session_id) {
        if session.segment_started_at.is_none() {
            session.segment_started_at = Some(Instant::now());
        }
    }
}

fn stop_ncm_scrobble_segment(data: &web::Data<Arc<AppState>>, session_id: i64) {
    let mut state = data.ncm_scrobble.lock();
    if let Some(session) = state.sessions.get_mut(&session_id) {
        stop_ncm_scrobble_segment_inner(session);
    }
}

fn sync_ncm_scrobble_segment_from_shared(
    data: &web::Data<Arc<AppState>>,
    shared_state: &Arc<SharedState>,
) {
    let Some(session_id) = *data.active_session_id.lock() else {
        return;
    };
    let is_audible_playback = shared_state.state.load() == PlayerState::Playing
        && !shared_state.is_loading.load(Ordering::Acquire);
    if is_audible_playback {
        start_ncm_scrobble_segment(data, session_id);
    } else {
        stop_ncm_scrobble_segment(data, session_id);
    }
}

fn finish_ncm_scrobble_session(data: &web::Data<Arc<AppState>>, session_id: i64, reason: &str) {
    let finished = {
        let mut state = data.ncm_scrobble.lock();
        let Some(mut session) = state.sessions.remove(&session_id) else {
            return;
        };
        stop_ncm_scrobble_segment_inner(&mut session);
        session
    };

    let listen_secs = finished.accumulated.as_secs();
    if listen_secs < NCM_SCROBBLE_MIN_LISTEN_SECS {
        log::debug!(
            "Skipping NCM scrobble for song {} after {}s ({})",
            finished.song_id,
            listen_secs,
            reason
        );
        return;
    }

    let app_state = Arc::clone(data.get_ref());
    let source_path = finished.source_path;
    let song_id = finished.song_id;
    let reason = reason.to_string();
    actix_rt::spawn(async move {
        submit_ncm_scrobble(app_state, source_path, song_id, listen_secs, reason).await;
    });
}

fn stop_ncm_scrobble_segment_inner(session: &mut NcmScrobbleSession) {
    if let Some(started_at) = session.segment_started_at.take() {
        session.accumulated += started_at.elapsed();
    }
}

async fn submit_ncm_scrobble(
    data: Arc<AppState>,
    source_path: String,
    song_id: i64,
    listen_secs: u64,
    reason: String,
) {
    let cookie = match data.app_db.active_ncm_cookie() {
        Ok(Some(cookie)) => cookie,
        Ok(None) => {
            log::debug!(
                "Skipping NCM scrobble for song {} without active cookie",
                song_id
            );
            return;
        }
        Err(err) => {
            log::warn!("Failed to read active NCM cookie for scrobble: {}", err);
            return;
        }
    };

    let query = Query::new()
        .cookie(&cookie)
        .param("id", &song_id.to_string())
        .param("sourceid", "")
        .param("time", &listen_secs.to_string());

    match data.ncm_client.scrobble(&query).await {
        Ok(_) => {
            if let Err(err) = data
                .app_db
                .mark_ncm_track_scrobbled(&source_path, listen_secs)
            {
                log::warn!(
                    "Failed to mark NCM song {} scrobbled after submit: {}",
                    song_id,
                    err
                );
            }
            log::info!(
                "NCM scrobble song {} after {}s ({})",
                song_id,
                listen_secs,
                reason
            );
        }
        Err(err) => {
            log::warn!(
                "NCM scrobble song {} after {}s failed: {}",
                song_id,
                listen_secs,
                err
            );
        }
    }
}

fn emit_playback_event(data: &web::Data<Arc<AppState>>, event: u32) {
    let player = data.player.lock();
    let shared = player.shared_state();
    shared.event_flags.fetch_or(event, Ordering::Release);
}

fn playback_runtime_snapshot_from_state(state: &StateResponse) -> PlaybackRuntimeSnapshot {
    PlaybackRuntimeSnapshot {
        position_secs: Some(state.current_time),
        duration_secs: Some(state.duration),
        volume: Some(state.volume),
        device_id: state.device_id,
        exclusive_mode: state.exclusive_mode,
    }
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

            sync_ncm_scrobble_segment_from_shared(&data, &shared_state);

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
) -> Result<(StateResponse, Arc<SharedState>), String> {
    let credentials = {
        let cfg = data.webdav_config.lock();
        cfg.http_credentials()
    };

    let (state_response, shared_state) = {
        let mut player = data.player.lock();
        if autoplay {
            player.load_with_credentials_and_autoplay(&entry.source_path, credentials.as_ref())?;
        } else {
            player.load_with_credentials(&entry.source_path, credentials.as_ref())?;
        }
        (
            get_enriched_player_state(&player, &data.app_db),
            player.shared_state(),
        )
    };

    let media_id = data.app_db.record_media_stub(&entry.source_path);
    if let Err(e) = &media_id {
        log::warn!(
            "Failed to ensure media item for queued '{}': {}",
            entry.source_path,
            e
        );
    }
    let snapshot = playback_runtime_snapshot_from_state(&state_response);

    let previous_session = { data.active_session_id.lock().take() };
    if let Some(session_id) = previous_session {
        finish_ncm_scrobble_session(data, session_id, "replaced");
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

    let session_id = data.app_db.start_playback_session(
        &entry.source_path,
        if autoplay { "playing" } else { "loaded" },
        &snapshot,
    )?;
    *data.active_session_id.lock() = Some(session_id);
    begin_ncm_scrobble_session(
        data,
        session_id,
        &entry.source_path,
        state_response.is_playing && !state_response.is_loading,
    );
    let payload = serde_json::json!({
        "media_id": media_id.ok(),
        "kind": if autoplay { "queue_autoplay" } else { "queue_load" },
        "entry_id": entry.entry_id
    });
    append_playback_history_and_emit(
        data,
        &shared_state,
        Some(session_id),
        &entry.source_path,
        "load_requested",
        snapshot.position_secs,
        Some(&payload),
    )?;

    data.app_db
        .mark_queue_entry_playing("active", entry.entry_id)?;
    sync_queue_snapshot_from_shared(data, &shared_state);
    emit_queue_updated_from_shared(&shared_state);
    Ok((state_response, shared_state))
}

pub(super) fn load_validated_path_for_playback(
    data: &web::Data<Arc<AppState>>,
    path: &str,
    autoplay: bool,
    history_kind: &'static str,
) -> Result<(StateResponse, Arc<SharedState>), String> {
    let credentials = {
        let cfg = data.webdav_config.lock();
        cfg.http_credentials()
    };

    let (state_response, shared_state) = {
        let mut player = data.player.lock();
        if autoplay {
            player.load_with_credentials_and_autoplay(path, credentials.as_ref())?;
        } else {
            player.load_with_credentials(path, credentials.as_ref())?;
        }
        (
            get_enriched_player_state(&player, &data.app_db),
            player.shared_state(),
        )
    };

    let media_id = data.app_db.record_media_stub(path);
    if let Err(e) = &media_id {
        log::warn!("Failed to ensure media item for '{}': {}", path, e);
    }
    let snapshot = playback_runtime_snapshot_from_state(&state_response);

    let previous_session = { data.active_session_id.lock().take() };
    if let Some(session_id) = previous_session {
        finish_ncm_scrobble_session(data, session_id, "replaced");
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

    match data.app_db.start_playback_session(
        path,
        if autoplay { "playing" } else { "loaded" },
        &snapshot,
    ) {
        Ok(session_id) => {
            *data.active_session_id.lock() = Some(session_id);
            begin_ncm_scrobble_session(
                data,
                session_id,
                path,
                state_response.is_playing && !state_response.is_loading,
            );
            let payload = serde_json::json!({
                "media_id": media_id.ok(),
                "kind": history_kind
            });
            if let Err(e) = append_playback_history_and_emit(
                data,
                &shared_state,
                Some(session_id),
                path,
                "load_requested",
                snapshot.position_secs,
                Some(&payload),
            ) {
                log::warn!("Failed to append load history: {}", e);
            }
        }
        Err(e) => log::warn!("Failed to start playback session for '{}': {}", path, e),
    }

    sync_queue_snapshot_from_shared(data, &shared_state);
    Ok((state_response, shared_state))
}

fn same_media_identity(left: &str, right: &str) -> bool {
    media_id_for_path(left) == media_id_for_path(right)
}

fn current_queue_cursor_path(data: &web::Data<Arc<AppState>>) -> Option<String> {
    let player = data.player.lock();
    let shared = player.shared_state();
    let current_track_path = shared.current_track_path.read().clone();
    if current_track_path.is_some() {
        return current_track_path;
    }
    let file_path = shared.file_path.read().clone();
    file_path
}

#[cfg(test)]
mod tests {
    use super::{library_queue_start_index, same_media_identity, LibraryQueueFailure};

    #[test]
    fn same_media_identity_normalizes_windows_paths() {
        assert!(same_media_identity(
            r"D:\Music\Artist\Track.FLAC",
            r"\\?\D:\Music\Artist\Track.flac"
        ));
    }

    #[test]
    fn library_queue_start_index_defaults_to_first_track() {
        let rows = vec![
            (10, "D:/music/a.flac".to_string()),
            (20, "D:/music/b.flac".to_string()),
        ];

        let start_index = library_queue_start_index(&rows, None, "missing").unwrap();

        assert_eq!(start_index, 0);
    }

    #[test]
    fn library_queue_start_index_finds_requested_track() {
        let rows = vec![
            (10, "D:/music/a.flac".to_string()),
            (20, "D:/music/b.flac".to_string()),
        ];

        let start_index = library_queue_start_index(&rows, Some(20), "missing").unwrap();

        assert_eq!(start_index, 1);
    }

    #[test]
    fn library_queue_start_index_rejects_missing_requested_track() {
        let rows = vec![(10, "D:/music/a.flac".to_string())];

        let error = library_queue_start_index(&rows, Some(20), "missing track").unwrap_err();

        match error {
            LibraryQueueFailure::NotFound(message) => assert_eq!(message, "missing track"),
            other => panic!("expected NotFound, got {other:?}"),
        }
    }
}

fn finish_active_session_on_natural_end(data: &web::Data<Arc<AppState>>) {
    let (snapshot, current_path, shared_state) = {
        let player = data.player.lock();
        let shared = player.shared_state();
        let snapshot = build_runtime_snapshot(&player);
        let current_path = shared.current_track_path.read().clone();
        let file_path = shared.file_path.read().clone();
        (snapshot, current_path.or(file_path), shared)
    };

    if let Some(ref path) = current_path {
        mark_current_track_as_played(data, path);
    }

    if let Some(session_id) = data.active_session_id.lock().take() {
        finish_ncm_scrobble_session(data, session_id, "ended");
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
            if let Err(e) = append_playback_history_and_emit(
                data,
                &shared_state,
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

    match data
        .app_db
        .peek_next_queue_entry("active", current_path.as_deref())
    {
        Ok(Some(entry)) => {
            finish_active_session_on_natural_end(data);
            if let Err(e) = load_queue_entry_for_playback(data, entry, true) {
                log::warn!("Failed to advance queue after natural end: {}", e);
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
                finish_active_session_on_natural_end(data);
                if let Err(e) = load_queue_entry_for_playback(data, entry, true) {
                    log::warn!("Failed to wrap repeat-all queue: {}", e);
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

    let (queue_result, shared_state) = {
        let player = data.player.lock();
        let result = player.queue_next_with_credentials(&entry.source_path, credentials);
        (result, player.shared_state())
    };

    match queue_result {
        Ok(()) => {
            sync_queue_snapshot_from_shared(data, &shared_state);
            emit_queue_updated_from_shared(&shared_state);
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
        "mp3", "flac", "wav", "aac", "m4a", "ogg", "opus", "wma", "ape", "wv", "alac", "aiff",
        "aif", "dsf", "dff", "mpc", "tak", "tta", "ac3", "dts", "thd", "truehd", "mka", "mkv",
        "mp4", "m4v", "mov", "webm", "asf", "amr", "au", "ra", "rm", "3gp",
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

fn external_cover_for_media(path: &std::path::Path) -> Option<(Vec<u8>, String)> {
    const COVER_NAMES: &[&str] = &["cover", "folder", "front", "album"];
    const COVER_EXTENSIONS: &[(&str, &str)] = &[
        ("jpg", "image/jpeg"),
        ("jpeg", "image/jpeg"),
        ("png", "image/png"),
        ("webp", "image/webp"),
    ];

    let dir = path.parent()?;
    let stem = path.file_stem().and_then(|value| value.to_str());
    let mut candidates = Vec::new();
    if let Some(stem) = stem {
        for (ext, _) in COVER_EXTENSIONS {
            candidates.push(dir.join(format!("{}.{}", stem, ext)));
        }
    }
    for name in COVER_NAMES {
        for (ext, _) in COVER_EXTENSIONS {
            candidates.push(dir.join(format!("{}.{}", name, ext)));
        }
    }

    for candidate in candidates {
        if !candidate.is_file() {
            continue;
        }
        let ext = candidate
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let mime = COVER_EXTENSIONS
            .iter()
            .find(|(candidate_ext, _)| *candidate_ext == ext)
            .map(|(_, mime)| (*mime).to_string())
            .unwrap_or_else(|| "application/octet-stream".to_string());
        match std::fs::read(&candidate) {
            Ok(bytes) => return Some((bytes, mime)),
            Err(e) => log::warn!(
                "Failed to read external cover '{}': {}",
                candidate.display(),
                e
            ),
        }
    }

    None
}

fn metadata_with_external_cover(
    path: &std::path::Path,
    metadata: &crate::decoder::TrackMetadata,
) -> crate::decoder::TrackMetadata {
    if metadata.cover_art.is_some() {
        return metadata.clone();
    }
    let Some((bytes, mime)) = external_cover_for_media(path) else {
        return metadata.clone();
    };
    let mut next = metadata.clone();
    next.cover_art = Some(bytes);
    next.cover_art_mime = Some(mime);
    next
}

struct LibraryScanOutcome {
    scanned_files: u64,
    indexed_files: u64,
    removed_files: u64,
}

fn scan_local_library(
    data: &web::Data<Arc<AppState>>,
    scan_task_id: u64,
    started_at: u64,
    root_id: i64,
    root_path: &str,
) -> Result<LibraryScanOutcome, String> {
    use rayon::prelude::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    // ── Parsed result sent from rayon workers to the DB writer thread. ──
    struct ParsedTrack {
        canonical_path: String,
        metadata: crate::decoder::TrackMetadata,
        duration_secs: Option<f64>,
        sample_rate: Option<u32>,
        channels: Option<usize>,
        mtime: f64,
        size: u64,
    }

    // Collect all supported file paths recursively.
    let mut file_paths: Vec<std::path::PathBuf> = Vec::new();
    let mut stack = vec![std::path::PathBuf::from(root_path)];
    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir)
            .map_err(|e| format!("Failed to read directory '{}': {}", dir.display(), e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if is_supported_media_path(&path) {
                file_paths.push(path);
            }
        }
    }

    let total_scanned = file_paths.len() as u64;
    if total_scanned == 0 {
        data.app_db
            .update_library_root_scan_status(
                root_id,
                "completed",
                Some(0),
                None,
                Some(now_epoch_secs()),
            )
            .map_err(|e| format!("Failed to finalize library scan state: {}", e))?;
        return Ok(LibraryScanOutcome {
            scanned_files: 0,
            indexed_files: 0,
            removed_files: 0,
        });
    }

    // Load existing snapshot for incremental skip.
    let snapshot = data.app_db.load_scan_snapshot().unwrap_or_default();

    // Channel: rayon workers → DB writer thread.
    let (tx, rx) = std::sync::mpsc::sync_channel::<ParsedTrack>(64);
    let indexed_paths = Arc::new(std::sync::Mutex::new(Vec::new()));
    let indexed_count = Arc::new(AtomicU64::new(0));

    // Spawn DB writer thread — receives parsed tracks, batch-writes to DB.
    let db = Arc::clone(&data.app_db);
    let writer_paths = Arc::clone(&indexed_paths);
    let writer_count = Arc::clone(&indexed_count);
    let writer_data = data.clone();
    let writer_root_path = root_path.to_string();
    let writer_handle = std::thread::spawn(move || {
        let mut batch: Vec<ParsedTrack> = Vec::with_capacity(50);
        let mut total_written: u64 = 0;

        loop {
            // Block until at least one item arrives.
            match rx.recv() {
                Ok(track) => {
                    batch.push(track);
                    // Drain any additional items already in the channel.
                    while batch.len() < 50 {
                        match rx.try_recv() {
                            Ok(t) => batch.push(t),
                            Err(_) => break,
                        }
                    }
                }
                Err(_) => break, // Channel closed — all workers done.
            }

            // Flush batch.
            for track in &batch {
                match db.record_media_metadata_with_scan_info(
                    &track.canonical_path,
                    &track.metadata,
                    track.duration_secs,
                    track.sample_rate,
                    track.channels,
                    Some(track.mtime),
                    Some(track.size),
                ) {
                    Ok(_) => {
                        writer_paths
                            .lock()
                            .unwrap()
                            .push(track.canonical_path.clone());
                        writer_count.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(e) => log::warn!("Failed to index '{}': {}", track.canonical_path, e),
                }
            }
            total_written += batch.len() as u64;
            batch.clear();

            // Progress reporting after each batch flush.
            persist_library_scan_task(
                &writer_data,
                scan_task_id,
                &writer_root_path,
                "scanning",
                started_at,
                now_epoch_secs(),
                Some(&serde_json::json!({
                    "root_id": root_id,
                    "scanned_files": total_written,
                    "indexed_files": writer_count.load(Ordering::Relaxed),
                })),
                None,
            );
        }

        // Final flush — remaining items after channel closed.
        for track in &batch {
            match db.record_media_metadata_with_scan_info(
                &track.canonical_path,
                &track.metadata,
                track.duration_secs,
                track.sample_rate,
                track.channels,
                Some(track.mtime),
                Some(track.size),
            ) {
                Ok(_) => {
                    writer_paths
                        .lock()
                        .unwrap()
                        .push(track.canonical_path.clone());
                    writer_count.fetch_add(1, Ordering::Relaxed);
                }
                Err(e) => log::warn!("Failed to index '{}': {}", track.canonical_path, e),
            }
        }
    });

    // ── Parallel parse phase: rayon workers send results through channel. ──
    let scanned = AtomicU64::new(0);

    file_paths.par_iter().for_each_with(tx, |tx, path| {
        scanned.fetch_add(1, Ordering::Relaxed);

        let canonical = match path.canonicalize() {
            Ok(p) => p.to_string_lossy().to_string(),
            Err(_) => path.to_string_lossy().to_string(),
        };

        // Incremental skip: check mtime + size.
        let file_meta = match std::fs::metadata(path) {
            Ok(m) => m,
            Err(_) => return,
        };
        let size = file_meta.len();
        if size < 1024 {
            return;
        }
        let mtime = file_meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as f64)
            .unwrap_or(0.0);

        if let Some((old_mtime, old_size, _has_cover)) = snapshot.get(&canonical) {
            let mtime_unchanged = old_mtime.map_or(false, |old| (old - mtime).abs() < 1.0);
            let size_unchanged = old_size.map_or(false, |old| old == size);
            if mtime_unchanged && size_unchanged {
                // File unchanged — record path directly (no DB write needed).
                indexed_paths.lock().unwrap().push(canonical);
                indexed_count.fetch_add(1, Ordering::Relaxed);
                return;
            }
        }

        let local_metadata = match crate::metadata::read_local_metadata(&canonical) {
            Ok(value) => value,
            Err(e) => {
                log::warn!("Skipping media file '{}': {}", canonical, e);
                return;
            }
        };
        let has_lofty_title = local_metadata.has_lofty_title;
        let mut metadata = metadata_with_external_cover(path, &local_metadata.metadata);
        let duration_secs = local_metadata.duration_secs;
        let sample_rate = local_metadata.sample_rate;
        let channels = local_metadata.channels;

        // Filter out short tracks with no title (likely jingles/ads).
        if !has_lofty_title && duration_secs.map_or(false, |d| d < 30.0) {
            return;
        }

        // Title/artist/album fallback.
        let file_stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("未知歌曲");
        if metadata
            .title
            .as_deref()
            .map_or(true, |t| t.trim().is_empty())
        {
            metadata.title = Some(file_stem.to_string());
        }
        if metadata
            .artist
            .as_deref()
            .map_or(true, |a| a.trim().is_empty())
        {
            metadata.artist = Some("未知艺术家".to_string());
        }
        if metadata
            .album
            .as_deref()
            .map_or(true, |a| a.trim().is_empty())
        {
            metadata.album = Some("未知专辑".to_string());
        }

        // External cover art fallback.
        if metadata.cover_art.is_none() {
            if let Some((bytes, mime)) = external_cover_for_media(path) {
                metadata.cover_art = Some(bytes);
                metadata.cover_art_mime = Some(mime);
            }
        }

        // Send to DB writer thread (blocks if channel full — backpressure).
        let _ = tx.send(ParsedTrack {
            canonical_path: canonical,
            metadata,
            duration_secs,
            sample_rate,
            channels,
            mtime,
            size,
        });
    });

    // tx is consumed by for_each_with; all per-thread clones drop when par_iter
    // completes, closing the channel so the writer thread exits its recv loop.

    // Wait for the DB writer to finish flushing all remaining items.
    writer_handle
        .join()
        .map_err(|_| "DB writer thread panicked".to_string())?;

    let final_scanned = scanned.load(Ordering::Relaxed);
    let final_indexed = indexed_count.load(Ordering::Relaxed);
    let final_indexed_paths = indexed_paths.lock().unwrap().clone();

    let removed = data
        .app_db
        .delete_local_media_not_in_root(root_path, &final_indexed_paths)
        .map_err(|e| format!("Failed to remove stale local media: {}", e))?;

    data.app_db
        .update_library_root_scan_status(
            root_id,
            "completed",
            Some(final_indexed),
            None,
            Some(now_epoch_secs()),
        )
        .map_err(|e| format!("Failed to finalize library scan state: {}", e))?;

    persist_library_scan_task(
        data,
        scan_task_id,
        root_path,
        "scanning",
        started_at,
        now_epoch_secs(),
        Some(&serde_json::json!({
            "root_id": root_id,
            "scanned_files": final_scanned,
            "indexed_files": final_indexed,
            "removed_files": removed,
        })),
        None,
    );

    Ok(LibraryScanOutcome {
        scanned_files: final_scanned,
        indexed_files: final_indexed,
        removed_files: removed,
    })
}

fn scan_webdav_library(
    data: &web::Data<Arc<AppState>>,
    scan_task_id: u64,
    started_at: u64,
    root_id: i64,
    root_path: &str,
    source_key: Option<&str>,
) -> Result<LibraryScanOutcome, String> {
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

            if scanned % 25 == 0 {
                persist_library_scan_task(
                    data,
                    scan_task_id,
                    root_path,
                    "scanning",
                    started_at,
                    now_epoch_secs(),
                    Some(&serde_json::json!({
                        "root_id": root_id,
                        "scanned_files": scanned,
                        "indexed_files": indexed,
                    })),
                    None,
                );
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

    persist_library_scan_task(
        data,
        scan_task_id,
        root_path,
        "scanning",
        started_at,
        now_epoch_secs(),
        Some(&serde_json::json!({
            "root_id": root_id,
            "scanned_files": scanned,
            "indexed_files": indexed,
        })),
        None,
    );

    Ok(LibraryScanOutcome {
        scanned_files: scanned,
        indexed_files: indexed,
        removed_files: 0,
    })
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

    let autoplay = body.autoplay.unwrap_or(false);
    match load_validated_path_for_playback(
        &data,
        &path,
        autoplay,
        if autoplay { "autoplay" } else { "load" },
    ) {
        Ok((state_response, _shared_state)) => {
            HttpResponse::Ok().json(ApiResponse::success_with_state(
                if autoplay {
                    "Track playback requested"
                } else {
                    "Track loaded"
                },
                state_response,
            ))
        }
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::error(&format!("Failed to load: {}", e))),
    }
}

async fn play(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let play_result = {
        let mut player = data.player.lock();
        player.play().map(|_| {
            let shared_state = player.shared_state();
            let snapshot = build_runtime_snapshot(&player);
            let current_path = shared_state.file_path.read().clone();
            let state_response = get_enriched_player_state(&player, &data.app_db);
            (snapshot, current_path, state_response, shared_state)
        })
    };

    match play_result {
        Ok((snapshot, current_path, state_response, shared_state)) => {
            let active_session_id = { *data.active_session_id.lock() };
            if let Some(session_id) = active_session_id {
                sync_ncm_scrobble_segment_from_shared(&data, &shared_state);
                if let Err(e) = data
                    .app_db
                    .update_playback_session(session_id, "playing", &snapshot)
                {
                    log::warn!("Failed to update playback session {}: {}", session_id, e);
                }
                if let Some(path) = current_path {
                    let _ = append_playback_history_and_emit(
                        &data,
                        &shared_state,
                        Some(session_id),
                        &path,
                        "play",
                        snapshot.position_secs,
                        None,
                    );
                }
            }
            HttpResponse::Ok().json(ApiResponse::success_with_state(
                "Playback started",
                state_response,
            ))
        }
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::error(&format!("Playback failed: {}", e))),
    }
}

async fn pause(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let pause_result = {
        let mut player = data.player.lock();
        player.pause().map(|_| {
            let shared_state = player.shared_state();
            let snapshot = build_runtime_snapshot(&player);
            let current_path = shared_state.file_path.read().clone();
            let state_response = get_enriched_player_state(&player, &data.app_db);
            (snapshot, current_path, state_response, shared_state)
        })
    };

    match pause_result {
        Ok((snapshot, current_path, state_response, shared_state)) => {
            let active_session_id = { *data.active_session_id.lock() };
            if let Some(session_id) = active_session_id {
                sync_ncm_scrobble_segment_from_shared(&data, &shared_state);
                if let Err(e) = data
                    .app_db
                    .update_playback_session(session_id, "paused", &snapshot)
                {
                    log::warn!("Failed to update playback session {}: {}", session_id, e);
                }
                if let Some(path) = current_path {
                    let _ = append_playback_history_and_emit(
                        &data,
                        &shared_state,
                        Some(session_id),
                        &path,
                        "pause",
                        snapshot.position_secs,
                        None,
                    );
                }
            }
            HttpResponse::Ok().json(ApiResponse::success_with_state(
                "Playback paused",
                state_response,
            ))
        }
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::error(&format!("Pause failed: {}", e))),
    }
}

async fn stop(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let (snapshot_before_stop, current_path, state_response, shared_state) = {
        let mut player = data.player.lock();
        let snapshot_before_stop = build_runtime_snapshot(&player);
        let shared_state = player.shared_state();
        let current_path = shared_state.file_path.read().clone();
        player.stop();
        (
            snapshot_before_stop,
            current_path,
            get_enriched_player_state(&player, &data.app_db),
            shared_state,
        )
    };
    if let Some(session_id) = data.active_session_id.lock().take() {
        finish_ncm_scrobble_session(&data, session_id, "stopped");
        if let Err(e) =
            data.app_db
                .finish_playback_session(session_id, "stopped", &snapshot_before_stop)
        {
            log::warn!("Failed to finish playback session {}: {}", session_id, e);
        }
        if let Some(path) = current_path {
            let _ = append_playback_history_and_emit(
                &data,
                &shared_state,
                Some(session_id),
                &path,
                "stop",
                snapshot_before_stop.position_secs,
                None,
            );
        }
    }
    sync_queue_snapshot_from_shared(&data, &shared_state);
    HttpResponse::Ok().json(ApiResponse::success_with_state(
        "Playback stopped",
        state_response,
    ))
}

async fn seek(data: web::Data<Arc<AppState>>, body: web::Json<SeekRequest>) -> HttpResponse {
    let target_position = body.position;
    let seek_result = {
        let mut player = data.player.lock();
        player.seek(target_position).map(|_| {
            let shared_state = player.shared_state();
            let snapshot = build_runtime_snapshot(&player);
            let current_path = shared_state.file_path.read().clone();
            let state_response = get_enriched_player_state(&player, &data.app_db);
            (snapshot, current_path, state_response, shared_state)
        })
    };

    match seek_result {
        Ok((snapshot, current_path, state_response, shared_state)) => {
            if let Some(session_id) = *data.active_session_id.lock() {
                if let Err(e) = data
                    .app_db
                    .update_playback_session(session_id, "seeking", &snapshot)
                {
                    log::warn!("Failed to update playback session {}: {}", session_id, e);
                }
                if let Some(path) = current_path {
                    let payload = serde_json::json!({ "target_position": target_position });
                    let _ = append_playback_history_and_emit(
                        &data,
                        &shared_state,
                        Some(session_id),
                        &path,
                        "seek",
                        Some(target_position),
                        Some(&payload),
                    );
                }
            }
            HttpResponse::Ok().json(ApiResponse::success_with_state(
                "Seek successful",
                state_response,
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
        get_enriched_player_state(&player, &data.app_db),
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
        get_enriched_player_state(&player, &data.app_db),
    ))
}

async fn get_state(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let player = data.player.lock();
    let state = get_enriched_player_state(&player, &data.app_db);
    HttpResponse::Ok().json(ApiResponse {
        status: "success".into(),
        message: None,
        state: Some(state),
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

    sync_queue_snapshot_from_shared(&data, &shared_state);

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
        get_enriched_player_state(&player, &data.app_db),
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
        get_enriched_player_state(&player, &data.app_db),
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
        get_enriched_player_state(&player, &data.app_db),
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
        get_enriched_player_state(&player, &data.app_db),
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

    let (queue_result, shared_state, current_path, current_position) = {
        let player = data.player.lock();
        let result = player.queue_next_with_credentials(&path, credentials);
        let shared_state = player.shared_state();
        let current_path = shared_state.file_path.read().clone();
        let current_position = shared_state.current_time_secs();
        (result, shared_state, current_path, current_position)
    };

    match queue_result {
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
            if let Some(session_id) = *data.active_session_id.lock() {
                let source_path = current_path.as_deref().unwrap_or(&path);
                let _ = append_playback_history_and_emit(
                    &data,
                    &shared_state,
                    Some(session_id),
                    source_path,
                    "queue_next",
                    Some(current_position),
                    Some(&payload),
                );
            }
            sync_queue_snapshot_from_shared(&data, &shared_state);
            emit_queue_updated_from_shared(&shared_state);
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
            if let (Some(entry_id), Some(source_path)) =
                (body.entry_id, body.source_path.as_deref())
            {
                entries
                    .iter()
                    .find(|entry| {
                        entry.entry_id == entry_id
                            && same_media_identity(&entry.source_path, source_path)
                    })
                    .cloned()
                    .or_else(|| {
                        entries
                            .into_iter()
                            .find(|entry| same_media_identity(&entry.source_path, source_path))
                    })
            } else if let Some(entry_id) = body.entry_id {
                entries.into_iter().find(|entry| entry.entry_id == entry_id)
            } else if let Some(source_path) = body.source_path.as_deref() {
                entries
                    .into_iter()
                    .find(|entry| same_media_identity(&entry.source_path, source_path))
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
        Ok((state, _shared_state)) => HttpResponse::Ok().json(ApiResponse::success_with_state(
            "Queue playback started",
            state,
        )),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&format!(
            "Failed to play queue entry: {}",
            e
        ))),
    }
}

async fn play_next_queue_entry(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let Some(current_path) = current_queue_cursor_path(&data) else {
        return HttpResponse::NotFound().json(ApiResponse::error("Next queue entry not found"));
    };
    let entry = match data
        .app_db
        .peek_next_queue_entry("active", Some(&current_path))
    {
        Ok(Some(entry)) => entry,
        Ok(None) => {
            return HttpResponse::NotFound().json(ApiResponse::error("Next queue entry not found"))
        }
        Err(e) => return HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    };

    match load_queue_entry_for_playback(&data, entry, true) {
        Ok((state, _shared_state)) => HttpResponse::Ok().json(ApiResponse::success_with_state(
            "Next queue entry started",
            state,
        )),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&format!(
            "Failed to play next queue entry: {}",
            e
        ))),
    }
}

async fn play_previous_queue_entry(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let Some(current_path) = current_queue_cursor_path(&data) else {
        return HttpResponse::NotFound().json(ApiResponse::error("Previous queue entry not found"));
    };
    let entry = match data
        .app_db
        .peek_previous_queue_entry("active", Some(&current_path))
    {
        Ok(Some(entry)) => entry,
        Ok(None) => {
            return HttpResponse::NotFound()
                .json(ApiResponse::error("Previous queue entry not found"))
        }
        Err(e) => return HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    };

    match load_queue_entry_for_playback(&data, entry, true) {
        Ok((state, _shared_state)) => HttpResponse::Ok().json(ApiResponse::success_with_state(
            "Previous queue entry started",
            state,
        )),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&format!(
            "Failed to play previous queue entry: {}",
            e
        ))),
    }
}

async fn get_queue_adjacent_entries(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let Some(current_path) = current_queue_cursor_path(&data) else {
        return HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "previous_entry_id": null,
            "next_entry_id": null
        }));
    };
    let previous = match data
        .app_db
        .peek_previous_queue_entry("active", Some(&current_path))
    {
        Ok(entry) => entry,
        Err(e) => return HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    };
    let next = match data
        .app_db
        .peek_next_queue_entry("active", Some(&current_path))
    {
        Ok(entry) => entry,
        Err(e) => return HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "previous_entry_id": previous.as_ref().map(|entry| entry.entry_id),
        "next_entry_id": next.as_ref().map(|entry| entry.entry_id)
    }))
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
    let result = if query.all.unwrap_or(false) {
        data.app_db.list_media_items()
    } else {
        data.app_db.recent_media_items(limit)
    };
    match result {
        Ok(items) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "media_items": items
        })),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn get_library_track_summaries(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let stats = match data.app_db.library_summary_stats() {
        Ok(stats) => stats,
        Err(e) => return HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    };
    match data.app_db.list_library_track_summaries() {
        Ok(tracks) => {
            let folders = data.app_db.library_folder_summaries_for_tracks(&tracks);
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "revision": stats.revision,
                "total_count": stats.total_count,
                "total_size_bytes": stats.total_size_bytes,
                "folders": folders,
                "tracks": tracks
            }))
        }
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn get_library_track_detail(
    data: web::Data<Arc<AppState>>,
    path: web::Path<LibraryTrackPath>,
) -> HttpResponse {
    match data.app_db.library_track_detail(path.track_key) {
        Ok(Some(detail)) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "track_key": detail.track_key,
            "item": detail.item
        })),
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::error("Library track not found")),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn get_library_track_cover_art(
    data: web::Data<Arc<AppState>>,
    path: web::Path<LibraryTrackPath>,
) -> HttpResponse {
    match data.app_db.media_id_for_track_key(path.track_key) {
        Ok(Some(media_id)) => get_media_cover_art_by_id(&data, &media_id),
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::error("Library track not found")),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

fn parse_library_sort_field(value: Option<&str>) -> LibrarySortField {
    match value.unwrap_or("default") {
        "title" => LibrarySortField::Title,
        "album" => LibrarySortField::Album,
        "duration" => LibrarySortField::Duration,
        "size" => LibrarySortField::Size,
        _ => LibrarySortField::Default,
    }
}

fn parse_library_sort_order(value: Option<&str>) -> LibrarySortOrder {
    match value.unwrap_or("default") {
        "asc" => LibrarySortOrder::Asc,
        "desc" => LibrarySortOrder::Desc,
        _ => LibrarySortOrder::Default,
    }
}

fn build_library_query(body: &LibraryQueueQueryRequest) -> LibraryTrackQuery {
    LibraryTrackQuery {
        search: body.search.as_ref().and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }),
        folder_path: body.folder_path.as_ref().and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }),
        sort_field: parse_library_sort_field(body.sort_field.as_deref()),
        sort_order: parse_library_sort_order(body.sort_order.as_deref()),
    }
}

fn load_replaced_queue_at_position(
    data: &web::Data<Arc<AppState>>,
    paths: &[String],
    start_index: usize,
) -> Result<StateResponse, String> {
    if paths.is_empty() {
        return Err("No library tracks matched the current view".to_string());
    }
    data.app_db.replace_queue_entries("active", paths)?;
    let entry = data
        .app_db
        .queue_entry_at_position("active", start_index as i64)?
        .ok_or_else(|| "Queue entry not found after replacing library queue".to_string())?;
    let (state, _) = load_queue_entry_for_playback(data, entry, true)
        .map_err(|e| format!("Failed to play queue entry: {}", e))?;
    Ok(state)
}

fn library_queue_start_index(
    rows: &[LibraryQueueRow],
    start_track_key: Option<i64>,
    missing_start_message: &str,
) -> Result<usize, LibraryQueueFailure> {
    match start_track_key {
        Some(track_key) => rows
            .iter()
            .position(|(row_track_key, _)| *row_track_key == track_key)
            .ok_or_else(|| LibraryQueueFailure::NotFound(missing_start_message.to_string())),
        None => Ok(0),
    }
}

fn validate_library_queue_paths(paths: &[String]) -> Result<Vec<String>, String> {
    let mut validated = Vec::with_capacity(paths.len());
    for path in paths {
        validated.push(validate_path(path)?);
    }
    Ok(validated)
}

fn play_library_queue_rows(
    data: &web::Data<Arc<AppState>>,
    rows: &[LibraryQueueRow],
    start_track_key: Option<i64>,
    empty_message: &str,
    missing_start_message: &str,
) -> Result<LibraryQueuePlayback, LibraryQueueFailure> {
    if rows.is_empty() {
        return Err(LibraryQueueFailure::NotFound(empty_message.to_string()));
    }
    let start_index = library_queue_start_index(rows, start_track_key, missing_start_message)?;
    let paths = rows
        .iter()
        .map(|(_, source_path)| source_path.clone())
        .collect::<Vec<_>>();
    let validated_paths =
        validate_library_queue_paths(&paths).map_err(LibraryQueueFailure::BadRequest)?;
    let state = load_replaced_queue_at_position(data, &validated_paths, start_index)
        .map_err(LibraryQueueFailure::Internal)?;
    Ok(LibraryQueuePlayback {
        state,
        queued_count: validated_paths.len(),
    })
}

fn library_queue_playback_response(playback: LibraryQueuePlayback) -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "state": playback.state,
        "queued_count": playback.queued_count
    }))
}

async fn replace_queue_from_library_query(
    data: web::Data<Arc<AppState>>,
    body: web::Json<LibraryQueueQueryRequest>,
) -> HttpResponse {
    let query = build_library_query(&body);
    let rows = match data.app_db.source_paths_for_library_query(&query) {
        Ok(rows) => rows,
        Err(e) => return HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    };
    match play_library_queue_rows(
        &data,
        &rows,
        body.start_track_key,
        "No library tracks matched the current view",
        "Start track is not in the current library view",
    ) {
        Ok(playback) => library_queue_playback_response(playback),
        Err(error) => error.into_response(),
    }
}

async fn replace_queue_from_track_keys(
    data: web::Data<Arc<AppState>>,
    body: web::Json<LibraryQueueTrackKeysRequest>,
) -> HttpResponse {
    if body.track_keys.is_empty() {
        return HttpResponse::BadRequest().json(ApiResponse::error("track_keys cannot be empty"));
    }
    let rows = match data.app_db.source_paths_for_track_keys(&body.track_keys) {
        Ok(rows) => rows,
        Err(e) => return HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    };
    match play_library_queue_rows(
        &data,
        &rows,
        body.start_track_key,
        "Library tracks not found",
        "Start track is not in the submitted library view",
    ) {
        Ok(playback) => library_queue_playback_response(playback),
        Err(error) => error.into_response(),
    }
}

async fn delete_media_items(
    data: web::Data<Arc<AppState>>,
    body: web::Json<MediaItemsDeleteRequest>,
) -> HttpResponse {
    if body.media_ids.is_empty() {
        return HttpResponse::BadRequest().json(ApiResponse::error("media_ids cannot be empty"));
    }

    match data.app_db.delete_media_items(&body.media_ids) {
        Ok(deleted_count) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "deleted_count": deleted_count
        })),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn list_local_playlists(data: web::Data<Arc<AppState>>) -> HttpResponse {
    match data.app_db.list_local_playlists() {
        Ok(playlists) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "playlists": playlists
        })),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn create_local_playlist(
    data: web::Data<Arc<AppState>>,
    body: web::Json<LocalPlaylistCreateRequest>,
) -> HttpResponse {
    match data
        .app_db
        .create_local_playlist(&body.name, body.description.as_deref())
    {
        Ok(playlist) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "playlist": playlist
        })),
        Err(e) => HttpResponse::BadRequest().json(ApiResponse::error(&e)),
    }
}

async fn update_local_playlist(
    data: web::Data<Arc<AppState>>,
    path: web::Path<LocalPlaylistPath>,
    body: web::Json<LocalPlaylistUpdateRequest>,
) -> HttpResponse {
    match data.app_db.update_local_playlist(
        &path.playlist_id,
        body.name.as_deref(),
        body.description.as_deref(),
    ) {
        Ok(Some(playlist)) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "playlist": playlist
        })),
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::error("Local playlist not found")),
        Err(e) => HttpResponse::BadRequest().json(ApiResponse::error(&e)),
    }
}

async fn delete_local_playlist(
    data: web::Data<Arc<AppState>>,
    path: web::Path<LocalPlaylistPath>,
) -> HttpResponse {
    match data.app_db.delete_local_playlist(&path.playlist_id) {
        Ok(true) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success"
        })),
        Ok(false) => HttpResponse::NotFound().json(ApiResponse::error("Local playlist not found")),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn get_local_playlist(
    data: web::Data<Arc<AppState>>,
    path: web::Path<LocalPlaylistPath>,
) -> HttpResponse {
    match data.app_db.get_local_playlist(&path.playlist_id) {
        Ok(Some(detail)) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "playlist": detail.playlist,
            "items": detail.items
        })),
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::error("Local playlist not found")),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn add_local_playlist_items(
    data: web::Data<Arc<AppState>>,
    path: web::Path<LocalPlaylistPath>,
    body: web::Json<LocalPlaylistItemsRequest>,
) -> HttpResponse {
    if body.media_ids.is_empty() {
        return HttpResponse::BadRequest().json(ApiResponse::error("media_ids cannot be empty"));
    }

    match data
        .app_db
        .add_media_to_local_playlist(&path.playlist_id, &body.media_ids)
    {
        Ok(added_count) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "added_count": added_count
        })),
        Err(e) if e.contains("not found") => HttpResponse::NotFound().json(ApiResponse::error(&e)),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn remove_local_playlist_items(
    data: web::Data<Arc<AppState>>,
    path: web::Path<LocalPlaylistPath>,
    body: web::Json<LocalPlaylistItemsRequest>,
) -> HttpResponse {
    if body.media_ids.is_empty() {
        return HttpResponse::BadRequest().json(ApiResponse::error("media_ids cannot be empty"));
    }

    match data
        .app_db
        .remove_media_from_local_playlist(&path.playlist_id, &body.media_ids)
    {
        Ok(removed_count) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "removed_count": removed_count
        })),
        Err(e) if e.contains("not found") => HttpResponse::NotFound().json(ApiResponse::error(&e)),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn upsert_external_media_metadata(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ExternalMediaMetadataRequest>,
) -> HttpResponse {
    let source_path = match validate_path(&body.source_path) {
        Ok(value) => value,
        Err(e) => return HttpResponse::BadRequest().json(ApiResponse::error(&e)),
    };

    match data.app_db.record_external_media_metadata(
        &source_path,
        body.title.as_deref(),
        body.artist.as_deref(),
        body.album.as_deref(),
        body.duration_secs,
        body.external_artwork_url.as_deref(),
    ) {
        Ok(media_id) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "media_id": media_id
        })),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

#[derive(Deserialize)]
struct MediaPath {
    media_id: String,
}

#[derive(Deserialize)]
struct MediaCoverArtQuery {
    media_id: String,
}

async fn get_media_cover_art(
    data: web::Data<Arc<AppState>>,
    path: web::Path<MediaPath>,
) -> HttpResponse {
    get_media_cover_art_by_id(&data, &path.media_id)
}

async fn get_media_cover_art_by_query(
    data: web::Data<Arc<AppState>>,
    query: web::Query<MediaCoverArtQuery>,
) -> HttpResponse {
    get_media_cover_art_by_id(&data, &query.media_id)
}

fn get_media_cover_art_by_id(data: &web::Data<Arc<AppState>>, media_id: &str) -> HttpResponse {
    match data.app_db.get_cover_art_for_media(media_id) {
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
        Ok(None) => match runtime_cover_art_for_media(data, media_id) {
            Some((mime, bytes)) => HttpResponse::Ok()
                .insert_header(("Content-Type", mime))
                .insert_header(("Content-Length", bytes.len().to_string()))
                .insert_header(("X-Cover-Art-Id", format!("{}:runtime-cover", media_id)))
                .body(bytes),
            None => match local_cover_art_for_media(data, media_id) {
                Ok(Some((mime, bytes))) => HttpResponse::Ok()
                    .insert_header(("Content-Type", mime))
                    .insert_header(("Content-Length", bytes.len().to_string()))
                    .insert_header(("X-Cover-Art-Id", format!("{}:local-cover", media_id)))
                    .body(bytes),
                Ok(None) => {
                    HttpResponse::NotFound().json(ApiResponse::error("Cover art not found"))
                }
                Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
            },
        },
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

fn runtime_cover_art_for_media(
    data: &web::Data<Arc<AppState>>,
    media_id: &str,
) -> Option<(String, Vec<u8>)> {
    let player = data.player.lock();
    let shared = player.shared_state();
    let current_path = shared
        .current_track_path
        .read()
        .clone()
        .or_else(|| shared.file_path.read().clone())?;
    if !same_media_identity(&current_path, media_id) {
        return None;
    }

    let metadata = shared.track_metadata.read();
    let bytes = metadata.cover_art.clone()?;
    let mime = metadata
        .cover_art_mime
        .clone()
        .unwrap_or_else(|| "application/octet-stream".to_string());
    Some((mime, bytes))
}

fn local_cover_art_for_media(
    data: &web::Data<Arc<AppState>>,
    media_id: &str,
) -> Result<Option<(String, Vec<u8>)>, String> {
    let Some(source_path) = data.app_db.source_path_for_media_id(media_id)? else {
        return Ok(None);
    };
    if source_path.starts_with("http://") || source_path.starts_with("https://") {
        return Ok(None);
    }

    let path = Path::new(&source_path);
    let local_metadata = match crate::metadata::read_local_metadata(&source_path) {
        Ok(value) => value,
        Err(e) => {
            log::warn!(
                "Cover art metadata read failed for '{}': {}",
                source_path,
                e
            );
            return Ok(None);
        }
    };
    let metadata = metadata_with_external_cover(path, &local_metadata.metadata);

    let Some(bytes) = metadata.cover_art.clone() else {
        return Ok(None);
    };
    let mime = metadata
        .cover_art_mime
        .clone()
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let duration_secs = local_metadata.duration_secs;

    data.app_db
        .record_media_metadata(&source_path, &metadata, duration_secs, None, None)?;

    Ok(Some((mime, bytes)))
}

async fn get_current_lyrics(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let (current_path, runtime_lyrics) = {
        let player = data.player.lock();
        let shared = player.shared_state();
        let current_track_path = shared.current_track_path.read().clone();
        let file_path = shared.file_path.read().clone();
        let lyrics = shared.track_metadata.read().lyrics.clone();
        (current_track_path.or(file_path), lyrics)
    };

    let Some(path) = current_path else {
        return HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "lyrics": [],
            "source": null
        }));
    };

    if path.starts_with("http://") || path.starts_with("https://") {
        return HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "lyrics": [],
            "source": null
        }));
    }

    match read_current_local_lyrics(&path, runtime_lyrics.as_deref()) {
        Ok(Some((lyric_lines, source))) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "lyrics": lyric_lines,
            "source": source
        })),
        Ok(None) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "lyrics": [],
            "source": null
        })),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

fn read_current_local_lyrics(
    path: &str,
    runtime_lyrics: Option<&str>,
) -> Result<Option<(Vec<lyrics::LyricLineDto>, String)>, String> {
    if let Some((lyric_text, source)) = read_sidecar_lyrics(path)? {
        let lyric_lines = lyrics::read_lyric_lines_from_source(&lyric_text, &source);
        if !lyric_lines.is_empty() {
            return Ok(Some((lyric_lines, source)));
        }
    }

    if let Some(lyric_lines) = runtime_lyrics.and_then(read_embedded_lyrics_if_present) {
        return Ok(Some((lyric_lines, "embedded".to_string())));
    }

    match crate::metadata::read_local_metadata(path) {
        Ok(local_metadata) => Ok(local_metadata
            .metadata
            .lyrics
            .as_deref()
            .and_then(read_embedded_lyrics_if_present)
            .map(|lines| (lines, "embedded".to_string()))),
        Err(e) => {
            log::debug!("Embedded lyric metadata read failed for '{}': {}", path, e);
            Ok(None)
        }
    }
}

fn read_embedded_lyrics_if_present(lyric_text: &str) -> Option<Vec<lyrics::LyricLineDto>> {
    let lyric_lines = lyrics::read_embedded_lyric_lines(lyric_text);
    (!lyric_lines.is_empty()).then_some(lyric_lines)
}

fn read_sidecar_lyrics(path: &str) -> Result<Option<(String, String)>, String> {
    let track_path = Path::new(path);
    let stem = match track_path.file_stem().and_then(|value| value.to_str()) {
        Some(value) if !value.trim().is_empty() => value,
        _ => return Ok(None),
    };
    let parent = match track_path.parent() {
        Some(value) => value,
        None => return Ok(None),
    };

    for extension in ["ttml", "yrc", "lrc", "srt", "ass", "ssa"] {
        let candidates = [
            parent.join(format!("{stem}.{extension}")),
            Path::new(&format!("{path}.{extension}")).to_path_buf(),
        ];

        let Some(candidate) = candidates.into_iter().find(|candidate| candidate.is_file()) else {
            continue;
        };

        let content = std::fs::read_to_string(&candidate).map_err(|error| {
            format!(
                "Failed to read lyric file '{}': {}",
                candidate.display(),
                error
            )
        })?;

        if content.trim().is_empty() {
            continue;
        }

        return Ok(Some((content, extension.to_string())));
    }

    Ok(None)
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

async fn delete_library_root(
    data: web::Data<Arc<AppState>>,
    path: web::Path<LibraryRootPath>,
) -> HttpResponse {
    match data.app_db.delete_library_root(path.root_id) {
        Ok(Some((root_path, removed_media_count))) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "root_path": root_path,
            "removed_media_count": removed_media_count
        })),
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::error("Library root not found")),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn get_library_scan_task(
    data: web::Data<Arc<AppState>>,
    path: web::Path<ScanTaskPath>,
) -> HttpResponse {
    match data.app_db.get_analysis_task(path.task_id) {
        Ok(Some(task)) if task.task_type == "library_scan" => {
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "task_id": task.task_id,
                "task": task
            }))
        }
        Ok(Some(_)) | Ok(None) => {
            HttpResponse::NotFound().json(ApiResponse::error("Library scan task not found"))
        }
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
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let root_id = match data.app_db.upsert_library_root(
        source_key.as_deref(),
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
            "source_key": source_key.as_deref(),
            "display_name": display_name,
        })),
        None,
    );

    let data_for_task = data.clone();
    let path_for_task = path.clone();
    let display_name_for_task = display_name.clone();
    let source_kind_for_task = source_kind.to_string();
    let source_key_for_task = source_key.clone();

    actix_web::rt::task::spawn_blocking(move || {
        let result = if source_kind_for_task == "local" {
            scan_local_library(
                &data_for_task,
                scan_task_id,
                started_at,
                root_id,
                &path_for_task,
            )
        } else {
            scan_webdav_library(
                &data_for_task,
                scan_task_id,
                started_at,
                root_id,
                &path_for_task,
                source_key_for_task.as_deref(),
            )
        };

        match result {
            Ok(outcome) => {
                let finished_at = now_epoch_secs();
                let payload = serde_json::json!({
                    "root_id": root_id,
                    "source_kind": source_kind_for_task,
                    "source_key": source_key_for_task.as_deref(),
                    "display_name": display_name_for_task,
                    "scanned_files": outcome.scanned_files,
                    "indexed_files": outcome.indexed_files,
                    "removed_files": outcome.removed_files,
                });
                persist_library_scan_task(
                    &data_for_task,
                    scan_task_id,
                    &path_for_task,
                    "success",
                    started_at,
                    finished_at,
                    Some(&payload),
                    None,
                );
            }
            Err(e) => {
                let finished_at = now_epoch_secs();
                let _ = data_for_task.app_db.update_library_root_scan_status(
                    root_id,
                    "error",
                    None,
                    None,
                    Some(finished_at),
                );
                persist_library_scan_task(
                    &data_for_task,
                    scan_task_id,
                    &path_for_task,
                    "error",
                    started_at,
                    finished_at,
                    Some(&serde_json::json!({
                        "root_id": root_id,
                        "source_kind": source_kind_for_task,
                        "source_key": source_key_for_task.as_deref(),
                        "display_name": display_name_for_task,
                    })),
                    Some(&e),
                );
            }
        }
    });

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "task_id": scan_task_id,
        "root_id": root_id,
        "scanned_files": 0,
        "indexed_files": 0
    }))
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

pub(super) fn append_validated_path_to_persistent_queue(
    data: &web::Data<Arc<AppState>>,
    path: &str,
) -> Result<Vec<QueueEntryRecord>, String> {
    data.app_db.append_queue_entry("active", path)?;
    emit_queue_updated(data);
    data.app_db.list_queue_entries("active")
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

    match append_validated_path_to_persistent_queue(&data, &path) {
        Ok(entries) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "queue": entries
        })),
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

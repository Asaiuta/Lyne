use super::*;
use crate::app_database::QueueEntryRecord;
use actix_web::{web, HttpResponse};

/// Typed failure for `play_from_persistent_queue` so the offload boundary
/// preserves the original response mapping (DB error -> 500 with the raw
/// message, missing entry -> 404, load error -> 500 with the load prefix).
enum QueuePlayFailure {
    Db(String),
    NotFound,
    Load(String),
}

fn select_queue_entry_for_play(
    entries: Vec<QueueEntryRecord>,
    entry_id: Option<i64>,
    source_path: Option<&str>,
) -> Option<QueueEntryRecord> {
    if let (Some(entry_id), Some(source_path)) = (entry_id, source_path) {
        entries
            .iter()
            .find(|entry| {
                entry.entry_id == entry_id && same_media_identity(&entry.source_path, source_path)
            })
            .cloned()
            .or_else(|| {
                entries
                    .into_iter()
                    .find(|entry| same_media_identity(&entry.source_path, source_path))
            })
    } else if let Some(entry_id) = entry_id {
        entries.into_iter().find(|entry| entry.entry_id == entry_id)
    } else if let Some(source_path) = source_path {
        entries
            .into_iter()
            .find(|entry| same_media_identity(&entry.source_path, source_path))
    } else {
        entries
            .into_iter()
            .find(|entry| entry.status == "queued" || entry.status == "preloading")
    }
}

/// Runs `load_queue_entry_for_playback` on the blocking pool (same pattern as
/// the NCM handlers in netease/playback_actions.rs): the call acquires the
/// `parking_lot::Mutex<AudioPlayer>` (a `!Send` guard) and performs a decoder
/// open plus several blocking SQLite writes, so it must never run inline on
/// the async executor. The player lock is acquired and released entirely
/// inside the closure (no `.await` there), so the guard never crosses an
/// await point.
async fn load_queue_entry_for_playback_offloaded(
    data: &web::Data<Arc<AppState>>,
    entry: QueueEntryRecord,
    autoplay: bool,
) -> Result<StateResponse, String> {
    let state_for_task = data.get_ref().clone();
    match actix_web::rt::task::spawn_blocking(move || {
        let data = web::Data::new(state_for_task);
        load_queue_entry_for_playback(&data, entry, autoplay)
            .map(|(state_response, _shared_state)| state_response)
    })
    .await
    {
        Ok(result) => result,
        Err(e) => Err(format!("join error {}", e)),
    }
}

pub(super) async fn queue_next(
    data: web::Data<Arc<AppState>>,
    body: web::Json<QueueNextRequest>,
) -> HttpResponse {
    let path = match validate_path(&body.path) {
        Ok(p) => p,
        Err(e) => return bad_request_response(e),
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
            if let Some(session_id) = *data.playback.active_session_id.lock() {
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
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn play_from_persistent_queue(
    data: web::Data<Arc<AppState>>,
    body: web::Json<PlayQueueRequest>,
) -> HttpResponse {
    // The queue listing is a blocking SQLite read and the load path opens a
    // decoder + writes SQLite while holding the player mutex; run the whole
    // synchronous sequence on the blocking pool (NCM handler pattern).
    let state_for_task = data.get_ref().clone();
    let entry_id = body.entry_id;
    let source_path = body.source_path.clone();
    let play_result = actix_web::rt::task::spawn_blocking(move || {
        let data = web::Data::new(state_for_task);
        let entries = data
            .app_db
            .list_queue_entries("active")
            .map_err(QueuePlayFailure::Db)?;
        let entry = select_queue_entry_for_play(entries, entry_id, source_path.as_deref())
            .ok_or(QueuePlayFailure::NotFound)?;
        load_queue_entry_for_playback(&data, entry, true)
            .map(|(state_response, _shared_state)| state_response)
            .map_err(QueuePlayFailure::Load)
    })
    .await;

    match play_result {
        Ok(Ok(state)) => HttpResponse::Ok().json(ApiResponse::success_with_state(
            "Queue playback started",
            state,
        )),
        Ok(Err(QueuePlayFailure::Db(e))) => internal_server_error_response(e),
        Ok(Err(QueuePlayFailure::NotFound)) => not_found_response("Queue entry not found"),
        Ok(Err(QueuePlayFailure::Load(e))) => {
            internal_server_error_response(format!("Failed to play queue entry: {}", e))
        }
        Err(e) => {
            internal_server_error_response(format!("Failed to play queue entry: join error {}", e))
        }
    }
}

pub(super) async fn play_next_queue_entry(data: web::Data<Arc<AppState>>) -> HttpResponse {
    // The cursor read takes the player lock and the peek is a blocking SQLite
    // read; run both on the blocking pool. A missing cursor and an empty peek
    // both map to the original 404.
    let state_for_task = data.get_ref().clone();
    let peek_result = actix_web::rt::task::spawn_blocking(move || {
        let data = web::Data::new(state_for_task);
        let Some(current_path) = current_queue_cursor_path(&data) else {
            return Ok(None);
        };
        data.app_db
            .peek_next_queue_entry("active", Some(&current_path))
    })
    .await;

    let entry = match peek_result {
        Ok(Ok(Some(entry))) => entry,
        Ok(Ok(None)) => return not_found_response("Next queue entry not found"),
        Ok(Err(e)) => return internal_server_error_response(e),
        Err(e) => {
            return internal_server_error_response(format!(
                "Failed to play next queue entry: join error {}",
                e
            ))
        }
    };

    match promote_pending_queue_entry_for_playback(&data, entry.clone()).await {
        Ok(Some((state, _shared_state))) => {
            return HttpResponse::Ok().json(ApiResponse::success_with_state(
                "Next queue entry started from preload",
                state,
            ));
        }
        Ok(None) => {}
        Err(e) => {
            log::warn!(
                "Failed to promote pending queue entry '{}', falling back to load: {}",
                entry.source_path,
                e
            );
        }
    }

    match load_queue_entry_for_playback_offloaded(&data, entry, true).await {
        Ok(state) => HttpResponse::Ok().json(ApiResponse::success_with_state(
            "Next queue entry started",
            state,
        )),
        Err(e) => internal_server_error_response(format!("Failed to play next queue entry: {}", e)),
    }
}

pub(super) async fn play_previous_queue_entry(data: web::Data<Arc<AppState>>) -> HttpResponse {
    // Same offload as `play_next_queue_entry`: player-lock cursor read plus
    // blocking SQLite peek run on the blocking pool.
    let state_for_task = data.get_ref().clone();
    let peek_result = actix_web::rt::task::spawn_blocking(move || {
        let data = web::Data::new(state_for_task);
        let Some(current_path) = current_queue_cursor_path(&data) else {
            return Ok(None);
        };
        data.app_db
            .peek_previous_queue_entry("active", Some(&current_path))
    })
    .await;

    let entry = match peek_result {
        Ok(Ok(Some(entry))) => entry,
        Ok(Ok(None)) => return not_found_response("Previous queue entry not found"),
        Ok(Err(e)) => return internal_server_error_response(e),
        Err(e) => {
            return internal_server_error_response(format!(
                "Failed to play previous queue entry: join error {}",
                e
            ))
        }
    };

    match load_queue_entry_for_playback_offloaded(&data, entry, true).await {
        Ok(state) => HttpResponse::Ok().json(ApiResponse::success_with_state(
            "Previous queue entry started",
            state,
        )),
        Err(e) => {
            internal_server_error_response(format!("Failed to play previous queue entry: {}", e))
        }
    }
}

pub(super) async fn get_queue_adjacent_entries(data: web::Data<Arc<AppState>>) -> HttpResponse {
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
        Err(e) => return internal_server_error_response(e),
    };
    let next = match data
        .app_db
        .peek_next_queue_entry("active", Some(&current_path))
    {
        Ok(entry) => entry,
        Err(e) => return internal_server_error_response(e),
    };

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "previous_entry_id": previous.as_ref().map(|entry| entry.entry_id),
        "next_entry_id": next.as_ref().map(|entry| entry.entry_id)
    }))
}

pub(super) async fn cancel_preload(data: web::Data<Arc<AppState>>) -> HttpResponse {
    data.player.lock().cancel_preload();
    HttpResponse::Ok().json(ApiResponse::success("Preload cancelled"))
}

pub(super) async fn get_queue_snapshot_domain(data: web::Data<Arc<AppState>>) -> HttpResponse {
    match data.app_db.get_queue_snapshot() {
        Ok(snapshot) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "queue_snapshot": snapshot
        })),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn get_persistent_queue(data: web::Data<Arc<AppState>>) -> HttpResponse {
    match data.app_db.list_queue_entries("active") {
        Ok(entries) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "queue": entries
        })),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn replace_persistent_queue(
    data: web::Data<Arc<AppState>>,
    body: web::Json<QueueReplaceRequest>,
) -> HttpResponse {
    let mut validated = Vec::with_capacity(body.paths.len());
    for path in &body.paths {
        match validate_path(path) {
            Ok(value) => validated.push(value),
            Err(e) => return bad_request_response(e),
        }
    }

    match data.app_db.replace_queue_entries("active", &validated) {
        Ok(()) => {
            emit_queue_updated(&data);
            get_persistent_queue(data).await
        }
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn enqueue_persistent_queue(
    data: web::Data<Arc<AppState>>,
    body: web::Json<QueueEnqueueRequest>,
) -> HttpResponse {
    let path = match validate_path(&body.path) {
        Ok(value) => value,
        Err(e) => return bad_request_response(e),
    };

    match append_validated_path_to_persistent_queue(&data, &path) {
        Ok(entries) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "queue": entries
        })),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn enqueue_persistent_queue_many(
    data: web::Data<Arc<AppState>>,
    body: web::Json<QueueEnqueueManyRequest>,
) -> HttpResponse {
    if body.paths.is_empty() {
        return bad_request_response("paths cannot be empty");
    }

    let mut validated = Vec::with_capacity(body.paths.len());
    for path in &body.paths {
        match validate_path(path) {
            Ok(value) => validated.push(value),
            Err(e) => return bad_request_response(e),
        }
    }

    match append_validated_paths_to_persistent_queue(&data, &validated) {
        Ok(entries) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "queue": entries
        })),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn remove_persistent_queue_entry(
    data: web::Data<Arc<AppState>>,
    path: web::Path<QueueEntryPath>,
) -> HttpResponse {
    match data.app_db.remove_queue_entry("active", path.entry_id) {
        Ok(()) => {
            emit_queue_updated(&data);
            get_persistent_queue(data).await
        }
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn clear_persistent_queue(data: web::Data<Arc<AppState>>) -> HttpResponse {
    match data.app_db.clear_queue("active") {
        Ok(()) => {
            emit_queue_updated(&data);
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "queue": []
            }))
        }
        Err(e) => internal_server_error_response(e),
    }
}

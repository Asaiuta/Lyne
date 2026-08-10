use super::*;
use crate::app_database::{QueueEntryInput, QueueEntryRecord};
use actix_web::{web, HttpResponse};

/// Typed failure for `play_from_persistent_queue` so the offload boundary
/// preserves the original response mapping (DB error -> 500 with the raw
/// message, missing entry -> 404, load error -> 500 with the load prefix).
enum QueuePlayFailure {
    Db(String),
    NotFound,
    Load(String),
}

fn resolve_queue_entry_input(
    data: &web::Data<Arc<AppState>>,
    path: &str,
    source_key: Option<&str>,
) -> Result<QueueEntryInput, String> {
    let resolved = resolve_media_source(&data.app_db, path, source_key)?;
    Ok(match resolved.source_key {
        Some(source_key) => QueueEntryInput::with_source_key(resolved.path, source_key),
        None => QueueEntryInput::public(resolved.path),
    })
}

fn resolve_queue_entry_inputs(
    data: &web::Data<Arc<AppState>>,
    paths: &[String],
    entries: &[QueueSourceInput],
) -> Result<Vec<QueueEntryInput>, String> {
    if !paths.is_empty() && !entries.is_empty() {
        return Err("provide either paths or entries, not both".to_string());
    }

    if entries.is_empty() {
        paths
            .iter()
            .map(|path| resolve_queue_entry_input(data, path, None))
            .collect()
    } else {
        entries
            .iter()
            .map(|entry| resolve_queue_entry_input(data, &entry.path, entry.source_key.as_deref()))
            .collect()
    }
}

fn pending_queue_entry_for_request(
    data: &web::Data<Arc<AppState>>,
    body: &QueueNextRequest,
) -> Result<Option<QueueEntryRecord>, String> {
    let candidate = if let Some(entry_id) = body.entry_id {
        data.app_db
            .list_queue_entries("active")?
            .into_iter()
            .find(|entry| entry.entry_id == entry_id)
    } else {
        data.app_db
            .peek_next_queue_entry("active", current_queue_cursor_entry_id(data))?
    };

    Ok(candidate.filter(|entry| {
        same_media_identity(&entry.source_path, &body.path)
            && body
                .source_key
                .as_deref()
                .is_none_or(|source_key| entry.source_key.as_deref() == Some(source_key))
    }))
}

fn select_queue_entry_for_play(
    entries: Vec<QueueEntryRecord>,
    entry_id: Option<i64>,
    source_path: Option<&str>,
) -> Option<QueueEntryRecord> {
    if let Some(entry_id) = entry_id {
        entries.into_iter().find(|entry| {
            entry.entry_id == entry_id
                && source_path
                    .is_none_or(|source_path| same_media_identity(&entry.source_path, source_path))
        })
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
    let queue_entry = match pending_queue_entry_for_request(&data, &body) {
        Ok(entry) => entry,
        Err(e) => return internal_server_error_response(e),
    };
    let resolved = match queue_entry.as_ref() {
        Some(entry) => resolve_queue_media_source(&data.app_db, entry),
        None => resolve_media_source(&data.app_db, &body.path, body.source_key.as_deref()),
    };
    let resolved = match resolved {
        Ok(resolved) => resolved,
        Err(e) => return bad_request_response(e),
    };
    let path = resolved.path.clone();
    let pending_entry_id = queue_entry.as_ref().map(|entry| entry.entry_id);

    if let Some(entry_id) = pending_entry_id {
        if let Err(e) = data
            .app_db
            .mark_queue_entry_status("active", entry_id, "preloading")
        {
            return internal_server_error_response(e);
        }
    }

    let (queue_result, shared_state, current_path, current_position) = {
        let player = data.player.lock();
        let result =
            player.queue_next_with_source_access(&path, &resolved.access, pending_entry_id);
        let shared_state = player.shared_state();
        let current_path = shared_state.file_path.read().clone();
        let current_position = shared_state.current_time_secs();
        (result, shared_state, current_path, current_position)
    };

    match queue_result {
        Ok(()) => {
            let payload = serde_json::json!({
                "queued_path": path,
                "source_key": resolved.source_key,
                "entry_id": pending_entry_id
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
        Err(e) => {
            if let Some(entry_id) = pending_entry_id {
                let _ = data
                    .app_db
                    .mark_queue_entry_status("active", entry_id, "queued");
            }
            internal_server_error_response(e)
        }
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
        let Some(current_entry_id) = current_queue_cursor_entry_id(&data) else {
            return Ok(None);
        };
        data.app_db
            .peek_next_queue_entry("active", Some(current_entry_id))
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
        let Some(current_entry_id) = current_queue_cursor_entry_id(&data) else {
            return Ok(None);
        };
        data.app_db
            .peek_previous_queue_entry("active", Some(current_entry_id))
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
    let Some(current_entry_id) = current_queue_cursor_entry_id(&data) else {
        return HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "previous_entry_id": null,
            "next_entry_id": null
        }));
    };
    let previous = match data
        .app_db
        .peek_previous_queue_entry("active", Some(current_entry_id))
    {
        Ok(entry) => entry,
        Err(e) => return internal_server_error_response(e),
    };
    let next = match data
        .app_db
        .peek_next_queue_entry("active", Some(current_entry_id))
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
    let entries = match resolve_queue_entry_inputs(&data, &body.paths, &body.entries) {
        Ok(entries) => entries,
        Err(e) => return bad_request_response(e),
    };

    match data
        .app_db
        .replace_queue_entries_with_sources("active", &entries)
    {
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
    let entry = match resolve_queue_entry_input(&data, &body.path, body.source_key.as_deref()) {
        Ok(entry) => entry,
        Err(e) => return bad_request_response(e),
    };

    match append_queue_entries_with_sources_to_persistent_queue(&data, &[entry]) {
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
    let entries = match resolve_queue_entry_inputs(&data, &body.paths, &body.entries) {
        Ok(entries) if entries.is_empty() => {
            return bad_request_response("queue entries cannot be empty")
        }
        Ok(entries) => entries,
        Err(e) => return bad_request_response(e),
    };

    match append_queue_entries_with_sources_to_persistent_queue(&data, &entries) {
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

#[cfg(test)]
mod tests {
    use super::select_queue_entry_for_play;
    use crate::app_database::QueueEntryRecord;

    fn entry(entry_id: i64, source_path: &str) -> QueueEntryRecord {
        QueueEntryRecord {
            queue_id: "active".to_string(),
            entry_id,
            position_index: entry_id,
            shuffle_index: None,
            source_path: source_path.to_string(),
            source_key: None,
            source_identity: "public".to_string(),
            media_id: None,
            status: "queued".to_string(),
            added_at_epoch_secs: 0,
            updated_at_epoch_secs: 0,
            title: None,
            artist: None,
            album: None,
            duration_secs: None,
            has_cover_art: false,
            external_artwork_url: None,
        }
    }

    #[test]
    fn entry_id_does_not_fall_back_to_a_duplicate_path() {
        let entries = vec![
            entry(1, "https://shared.example.test/song.flac"),
            entry(2, "https://shared.example.test/song.flac"),
        ];

        assert_eq!(
            select_queue_entry_for_play(
                entries.clone(),
                Some(2),
                Some("https://shared.example.test/song.flac"),
            )
            .unwrap()
            .entry_id,
            2
        );
        assert!(select_queue_entry_for_play(
            entries,
            Some(2),
            Some("https://other.example.test/song.flac"),
        )
        .is_none());
    }
}

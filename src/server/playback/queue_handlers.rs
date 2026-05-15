use super::*;
use actix_web::{web, HttpResponse};

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
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn play_from_persistent_queue(
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
        Err(e) => return internal_server_error_response(e),
    };

    let Some(entry) = entry else {
        return not_found_response("Queue entry not found");
    };

    match load_queue_entry_for_playback(&data, entry, true) {
        Ok((state, _shared_state)) => HttpResponse::Ok().json(ApiResponse::success_with_state(
            "Queue playback started",
            state,
        )),
        Err(e) => internal_server_error_response(format!("Failed to play queue entry: {}", e)),
    }
}

pub(super) async fn play_next_queue_entry(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let Some(current_path) = current_queue_cursor_path(&data) else {
        return not_found_response("Next queue entry not found");
    };
    let entry = match data
        .app_db
        .peek_next_queue_entry("active", Some(&current_path))
    {
        Ok(Some(entry)) => entry,
        Ok(None) => return not_found_response("Next queue entry not found"),
        Err(e) => return internal_server_error_response(e),
    };

    match load_queue_entry_for_playback(&data, entry, true) {
        Ok((state, _shared_state)) => HttpResponse::Ok().json(ApiResponse::success_with_state(
            "Next queue entry started",
            state,
        )),
        Err(e) => internal_server_error_response(format!("Failed to play next queue entry: {}", e)),
    }
}

pub(super) async fn play_previous_queue_entry(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let Some(current_path) = current_queue_cursor_path(&data) else {
        return not_found_response("Previous queue entry not found");
    };
    let entry = match data
        .app_db
        .peek_previous_queue_entry("active", Some(&current_path))
    {
        Ok(Some(entry)) => entry,
        Ok(None) => return not_found_response("Previous queue entry not found"),
        Err(e) => return internal_server_error_response(e),
    };

    match load_queue_entry_for_playback(&data, entry, true) {
        Ok((state, _shared_state)) => HttpResponse::Ok().json(ApiResponse::success_with_state(
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

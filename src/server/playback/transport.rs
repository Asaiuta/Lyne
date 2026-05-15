use super::*;
use actix_web::{web, HttpResponse};
use std::sync::atomic::Ordering;

pub(super) async fn load(
    data: web::Data<Arc<AppState>>,
    body: web::Json<LoadRequest>,
) -> HttpResponse {
    let path = match validate_path(&body.path) {
        Ok(p) => p,
        Err(e) => return bad_request_response(e),
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
        Err(e) => internal_server_error_response(format!("Failed to load: {}", e)),
    }
}

pub(super) async fn play(data: web::Data<Arc<AppState>>) -> HttpResponse {
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
        Err(e) => internal_server_error_response(format!("Playback failed: {}", e)),
    }
}

pub(super) async fn pause(data: web::Data<Arc<AppState>>) -> HttpResponse {
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
        Err(e) => internal_server_error_response(format!("Pause failed: {}", e)),
    }
}

pub(super) async fn stop(data: web::Data<Arc<AppState>>) -> HttpResponse {
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

pub(super) async fn seek(
    data: web::Data<Arc<AppState>>,
    body: web::Json<SeekRequest>,
) -> HttpResponse {
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
        Err(e) => internal_server_error_response(format!("Seek failed: {}", e)),
    }
}

pub(super) async fn set_repeat_mode(
    data: web::Data<Arc<AppState>>,
    body: web::Json<PlaybackModeRequest>,
) -> HttpResponse {
    let mode = match RepeatMode::parse(&body.mode) {
        Some(mode) => mode,
        None => {
            return bad_request_response("Invalid repeat mode. Use: off, one, all");
        }
    };

    let player = data.player.lock();
    player.set_repeat_mode(mode);
    HttpResponse::Ok().json(ApiResponse::success_with_state(
        "Repeat mode updated",
        get_enriched_player_state(&player, &data.app_db),
    ))
}

pub(super) async fn set_shuffle_mode(
    data: web::Data<Arc<AppState>>,
    body: web::Json<PlaybackModeRequest>,
) -> HttpResponse {
    let mode = match ShuffleMode::parse(&body.mode) {
        Some(mode) => mode,
        None => {
            return bad_request_response("Invalid shuffle mode. Use: off, on");
        }
    };

    let update_result = match mode {
        ShuffleMode::Off => data.app_db.unshuffle_entries("active"),
        ShuffleMode::On => data.app_db.shuffle_entries("active"),
    };
    if let Err(e) = update_result {
        return internal_server_error_response(e);
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

pub(super) async fn get_state(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let player = data.player.lock();
    let state = get_enriched_player_state(&player, &data.app_db);
    HttpResponse::Ok().json(ApiResponse {
        status: "success".into(),
        message: None,
        state: Some(state),
        devices: None,
    })
}

pub(super) async fn get_queue_status(data: web::Data<Arc<AppState>>) -> HttpResponse {
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

pub(super) async fn set_volume(
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

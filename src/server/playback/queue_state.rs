use super::*;
use crate::app_database::{media_id_for_path, QueueEntryRecord};
use crate::player::{
    pending_promotion_readiness, PendingPromotionReadiness, RepeatMode, SharedState,
};
use actix_web::web;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

const MANUAL_NEXT_PRELOAD_WAIT: Duration = Duration::from_secs(4);

pub(super) fn sync_queue_snapshot_from_shared(
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

pub(super) fn emit_queue_updated(data: &web::Data<Arc<AppState>>) {
    let player = data.player.lock();
    let shared = player.shared_state();
    emit_queue_updated_from_shared(&shared);
}

pub(super) fn emit_queue_updated_from_shared(shared: &Arc<SharedState>) {
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

pub(super) fn append_playback_history_and_emit(
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

pub(super) fn playback_runtime_snapshot_from_state(
    state: &StateResponse,
) -> PlaybackRuntimeSnapshot {
    PlaybackRuntimeSnapshot {
        position_secs: Some(state.current_time),
        duration_secs: Some(state.duration),
        volume: Some(state.volume),
        device_id: state.device_id,
        exclusive_mode: state.exclusive_mode,
    }
}

pub(crate) fn mark_current_track_as_played(data: &web::Data<Arc<AppState>>, current_path: &str) {
    let shared_state = {
        let player = data.player.lock();
        player.shared_state()
    };
    mark_current_track_as_played_from_shared(data, &shared_state, current_path);
}

fn mark_current_track_as_played_from_shared(
    data: &web::Data<Arc<AppState>>,
    shared_state: &Arc<SharedState>,
    current_path: &str,
) {
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
        emit_queue_updated_from_shared(shared_state);
    }
}

pub(super) fn load_queue_entry_for_playback(
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
        (get_player_state(&player), player.shared_state())
    };
    finish_queue_entry_playback_start(data, &entry, autoplay, state_response, shared_state)
}

pub(super) async fn promote_pending_queue_entry_for_playback(
    data: &web::Data<Arc<AppState>>,
    entry: QueueEntryRecord,
) -> Result<Option<(StateResponse, Arc<SharedState>)>, String> {
    let shared_state = {
        let player = data.player.lock();
        player.shared_state()
    };

    if !wait_for_pending_promotion_ready(&shared_state, &entry.source_path).await {
        return Ok(None);
    }

    let (promoted, state_response, shared_state) = {
        let mut player = data.player.lock();
        let promoted = player.promote_pending_if_matching(&entry.source_path)?;
        (promoted, get_player_state(&player), player.shared_state())
    };

    if !promoted {
        return Ok(None);
    }

    finish_queue_entry_playback_start(data, &entry, true, state_response, shared_state).map(Some)
}

async fn wait_for_pending_promotion_ready(shared: &SharedState, expected_path: &str) -> bool {
    let deadline = std::time::Instant::now() + MANUAL_NEXT_PRELOAD_WAIT;
    loop {
        match pending_promotion_readiness(shared, expected_path) {
            PendingPromotionReadiness::Ready => return true,
            PendingPromotionReadiness::Mismatch | PendingPromotionReadiness::Unavailable => {
                return false;
            }
            PendingPromotionReadiness::Waiting => {
                if std::time::Instant::now() >= deadline {
                    return false;
                }
                actix_web::rt::time::sleep(Duration::from_millis(10)).await;
            }
        }
    }
}

fn finish_queue_entry_playback_start(
    data: &web::Data<Arc<AppState>>,
    entry: &QueueEntryRecord,
    autoplay: bool,
    state_response: StateResponse,
    shared_state: Arc<SharedState>,
) -> Result<(StateResponse, Arc<SharedState>), String> {
    let state_response = enrich_player_state(&data.app_db, state_response);

    let media_id = data.app_db.record_media_stub(&entry.source_path);
    if let Err(e) = &media_id {
        log::warn!(
            "Failed to ensure media item for queued '{}': {}",
            entry.source_path,
            e
        );
    }
    let snapshot = playback_runtime_snapshot_from_state(&state_response);

    let previous_session = { data.playback.active_session_id.lock().take() };
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
    *data.playback.active_session_id.lock() = Some(session_id);
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

pub(crate) fn load_validated_path_for_playback(
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
        (get_player_state(&player), player.shared_state())
    };
    let state_response = enrich_player_state(&data.app_db, state_response);

    let media_id = data.app_db.record_media_stub(path);
    if let Err(e) = &media_id {
        log::warn!("Failed to ensure media item for '{}': {}", path, e);
    }
    let snapshot = playback_runtime_snapshot_from_state(&state_response);

    let previous_session = { data.playback.active_session_id.lock().take() };
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
            *data.playback.active_session_id.lock() = Some(session_id);
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

pub(super) fn same_media_identity(left: &str, right: &str) -> bool {
    media_id_for_path(left) == media_id_for_path(right)
}

pub(super) fn current_queue_cursor_path(data: &web::Data<Arc<AppState>>) -> Option<String> {
    let player = data.player.lock();
    let shared = player.shared_state();
    let current_track_path = shared.current_track_path.read().clone();
    if current_track_path.is_some() {
        return current_track_path;
    }
    let file_path = shared.file_path.read().clone();
    file_path
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
        mark_current_track_as_played_from_shared(data, &shared_state, path);
    }

    if let Some(session_id) = data.playback.active_session_id.lock().take() {
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

    emit_playback_event_from_shared(&shared_state, crate::player::EVENT_PLAYBACK_ENDED);
}

pub(super) fn handle_natural_playback_end(data: &web::Data<Arc<AppState>>) {
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
                emit_playback_event_from_shared(
                    &shared_state,
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

pub(crate) fn queue_next_from_persistent_queue(
    data: &web::Data<Arc<AppState>>,
) -> Result<Option<String>, String> {
    let (current_path, shared_state) = {
        let player = data.player.lock();
        let shared = player.shared_state();
        let current_path = shared.current_track_path.read().clone();
        (current_path, shared)
    };

    let next_entry = data
        .app_db
        .peek_next_queue_entry("active", current_path.as_deref())?;

    let Some(entry) = next_entry else {
        return Ok(None);
    };

    data.app_db
        .mark_queue_entry_status("active", entry.entry_id, "preloading")?;
    emit_queue_updated_from_shared(&shared_state);

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
            emit_queue_updated_from_shared(&shared_state);
            Err(e)
        }
    }
}

pub(crate) fn append_validated_path_to_persistent_queue(
    data: &web::Data<Arc<AppState>>,
    path: &str,
) -> Result<Vec<QueueEntryRecord>, String> {
    append_validated_paths_to_persistent_queue(data, &[path.to_string()])
}

pub(crate) fn append_validated_paths_to_persistent_queue(
    data: &web::Data<Arc<AppState>>,
    paths: &[String],
) -> Result<Vec<QueueEntryRecord>, String> {
    data.app_db.append_queue_entries("active", paths)?;
    emit_queue_updated(data);
    data.app_db.list_queue_entries("active")
}

#[cfg(test)]
mod tests {
    use super::same_media_identity;

    #[test]
    fn same_media_identity_normalizes_windows_paths() {
        assert!(same_media_identity(
            r"D:\Music\Artist\Track.FLAC",
            r"\\?\D:\Music\Artist\Track.flac"
        ));
    }
}

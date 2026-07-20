use super::*;
use actix_web::{http::StatusCode, web, HttpResponse};
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;

use crate::audio_settings::{AudioSettingsCommitError, AudioSettingsSnapshot};

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/settings", web::get().to(get_settings))
        .route("/save_settings", web::post().to(save_settings))
        .route("/audio_settings", web::get().to(get_audio_settings))
        .route(
            "/audio_settings/preview",
            web::post().to(preview_audio_settings),
        )
        .route(
            "/audio_settings/commit",
            web::post().to(commit_audio_settings),
        )
        .route(
            "/audio_settings/cancel",
            web::post().to(cancel_audio_settings_preview),
        );
}

pub(crate) fn spawn_audio_settings_preview_supervisor(
    state: &Arc<AppState>,
) -> tokio::task::JoinHandle<()> {
    let weak_state = Arc::downgrade(state);
    actix_web::rt::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(1));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            timer.tick().await;
            let Some(state) = weak_state.upgrade() else {
                break;
            };
            let mut player = state.player.lock();
            if state.audio_settings.expire_previews(&mut player) {
                log::debug!("Expired stale audio settings preview session");
            }
        }
    })
}

fn snapshot_after_expiring_previews(data: &AppState) -> AudioSettingsSnapshot {
    let mut player = data.player.lock();
    data.audio_settings.expire_previews(&mut player);
    data.audio_settings.snapshot()
}

async fn get_settings(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let snapshot = snapshot_after_expiring_previews(&data);
    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "revision": snapshot.revision,
        "settings": snapshot.desired
    }))
}

async fn get_audio_settings(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let snapshot = snapshot_after_expiring_previews(&data);
    settings_snapshot_response("Audio settings loaded", snapshot)
}

#[derive(Deserialize)]
struct SaveSettingsRequest {
    settings: PersistentSettingsUpdate,
}

async fn save_settings(
    data: web::Data<Arc<AppState>>,
    body: web::Json<SaveSettingsRequest>,
) -> HttpResponse {
    let result = {
        let mut player = data.player.lock();
        data.audio_settings
            .commit(&mut player, body.settings.clone(), None, None)
    };
    match result {
        Ok(snapshot) => settings_snapshot_response("Settings saved", snapshot),
        Err(error) => audio_settings_error_response(error),
    }
}

#[derive(Deserialize)]
struct CommitAudioSettingsRequest {
    base_revision: u64,
    settings: PersistentSettingsUpdate,
    #[serde(default)]
    preview_session_id: Option<String>,
}

async fn commit_audio_settings(
    data: web::Data<Arc<AppState>>,
    body: web::Json<CommitAudioSettingsRequest>,
) -> HttpResponse {
    let result = {
        let mut player = data.player.lock();
        data.audio_settings.commit(
            &mut player,
            body.settings.clone(),
            Some(body.base_revision),
            body.preview_session_id.as_deref(),
        )
    };
    match result {
        Ok(snapshot) => settings_snapshot_response("Audio settings committed", snapshot),
        Err(error) => audio_settings_error_response(error),
    }
}

#[derive(Deserialize)]
struct PreviewAudioSettingsRequest {
    session_id: String,
    seq: u64,
    settings: PreviewAudioSettingsPatch,
}

#[derive(Deserialize)]
struct PreviewAudioSettingsPatch {
    volume: Option<f32>,
    eq_bands: Option<std::collections::HashMap<String, f64>>,
}

async fn preview_audio_settings(
    data: web::Data<Arc<AppState>>,
    body: web::Json<PreviewAudioSettingsRequest>,
) -> HttpResponse {
    let result = {
        let mut player = data.player.lock();
        match (&body.settings.volume, &body.settings.eq_bands) {
            (Some(volume), None) => {
                data.audio_settings
                    .preview_volume(&mut player, &body.session_id, body.seq, *volume)
            }
            (None, Some(eq_bands)) => data.audio_settings.preview_eq_bands(
                &mut player,
                &body.session_id,
                body.seq,
                eq_bands.clone(),
            ),
            (None, None) => Err("Audio settings preview patch must contain one field".to_string()),
            (Some(_), Some(_)) => {
                Err("Audio settings preview patch must contain only one field".to_string())
            }
        }
    };
    match result {
        Ok((accepted, snapshot)) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "message": if accepted { "Preview applied" } else { "Stale preview ignored" },
            "accepted": accepted,
            "session_id": body.session_id,
            "seq": body.seq,
            "snapshot": snapshot
        })),
        Err(error) => bad_request_response(error),
    }
}

#[derive(Deserialize)]
struct CancelAudioSettingsPreviewRequest {
    session_id: String,
}

async fn cancel_audio_settings_preview(
    data: web::Data<Arc<AppState>>,
    body: web::Json<CancelAudioSettingsPreviewRequest>,
) -> HttpResponse {
    let result = {
        let mut player = data.player.lock();
        data.audio_settings
            .cancel_preview(&mut player, &body.session_id)
    };
    match result {
        Ok(snapshot) => settings_snapshot_response("Preview canceled", snapshot),
        Err(error) => bad_request_response(error),
    }
}

fn settings_snapshot_response(message: &str, snapshot: AudioSettingsSnapshot) -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "message": message,
        "snapshot": snapshot
    }))
}

pub(crate) fn commit_settings_update(
    data: &AppState,
    update: crate::config::EngineSettingsUpdate,
) -> Result<AudioSettingsSnapshot, AudioSettingsCommitError> {
    let mut player = data.player.lock();
    data.audio_settings.commit(&mut player, update, None, None)
}

pub(crate) fn audio_settings_error_response(error: AudioSettingsCommitError) -> HttpResponse {
    match error {
        AudioSettingsCommitError::Invalid(message) => bad_request_response(message),
        AudioSettingsCommitError::Persistence(message) => internal_server_error_response(message),
        AudioSettingsCommitError::Conflict { fields, snapshot } => {
            HttpResponse::build(StatusCode::CONFLICT).json(serde_json::json!({
                "status": "error",
                "message": format!("Audio settings conflict: {}", fields.join(", ")),
                "conflicting_fields": fields,
                "snapshot": snapshot
            }))
        }
    }
}

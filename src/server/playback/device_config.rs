use super::*;
use actix_web::{web, HttpRequest, HttpResponse};

pub(super) async fn list_devices(
    data: web::Data<Arc<AppState>>,
    _req: HttpRequest,
) -> HttpResponse {
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

pub(super) async fn configure_output(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ConfigureOutputRequest>,
) -> HttpResponse {
    let update = crate::config::EngineSettingsUpdate {
        device_id: Some(body.device_id),
        exclusive_mode: body.exclusive,
        ..crate::config::EngineSettingsUpdate::default()
    };
    if let Err(error) = crate::server::settings_handlers::commit_settings_update(&data, update) {
        return crate::server::settings_handlers::audio_settings_error_response(error);
    }

    let state_response = {
        let player = data.player.lock();
        get_player_state(&player)
    };

    let state_response = enrich_player_state(&data.app_db, state_response);
    HttpResponse::Ok().json(ApiResponse::success_with_state(
        "Output configured",
        state_response,
    ))
}

pub(super) async fn configure_upsampling(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ConfigureUpsamplingRequest>,
) -> HttpResponse {
    const MIN_SAMPLE_RATE: u32 = 8000;
    const MAX_SAMPLE_RATE: u32 = 384000;

    if let Some(sr) = body.target_samplerate {
        if sr == 0 {
            return bad_request_response(
                "Sample rate cannot be 0. Use null to disable upsampling.",
            );
        }
        if sr < MIN_SAMPLE_RATE {
            return bad_request_response(format!(
                "Sample rate {} Hz is too low. Minimum: {} Hz.",
                sr, MIN_SAMPLE_RATE
            ));
        }
        if sr > MAX_SAMPLE_RATE {
            return bad_request_response(format!(
                "Sample rate {} Hz is too high. Maximum: {} Hz.",
                sr, MAX_SAMPLE_RATE
            ));
        }
    }

    let update = crate::config::EngineSettingsUpdate {
        target_samplerate: Some(body.target_samplerate),
        ..crate::config::EngineSettingsUpdate::default()
    };
    if let Err(error) = crate::server::settings_handlers::commit_settings_update(&data, update) {
        return crate::server::settings_handlers::audio_settings_error_response(error);
    }

    let msg = match body.target_samplerate {
        Some(sr) => format!("Upsampling set to {} Hz", sr),
        None => "Upsampling disabled".into(),
    };

    HttpResponse::Ok().json(ApiResponse::success(&msg))
}

pub(super) async fn configure_resampling(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ConfigureResamplingRequest>,
) -> HttpResponse {
    let update = crate::config::EngineSettingsUpdate {
        resample_quality: body.quality.clone(),
        use_cache: body.use_cache,
        preemptive_resample: body.preemptive_resample,
        ..crate::config::EngineSettingsUpdate::default()
    };
    if let Err(error) = crate::server::settings_handlers::commit_settings_update(&data, update) {
        return crate::server::settings_handlers::audio_settings_error_response(error);
    }

    let state_response = {
        let player = data.player.lock();
        get_player_state(&player)
    };

    let state_response = enrich_player_state(&data.app_db, state_response);
    HttpResponse::Ok().json(ApiResponse::success_with_state(
        "Resampling settings updated",
        state_response,
    ))
}

pub(super) async fn configure_normalization(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ConfigureNormalizationRequest>,
) -> HttpResponse {
    let update = crate::config::EngineSettingsUpdate {
        loudness_enabled: body.enabled,
        target_lufs: body.target_lufs,
        loudness_mode: body.mode.clone(),
        preamp_db: body.preamp_db,
        ..crate::config::EngineSettingsUpdate::default()
    };
    if !update.is_empty() {
        if let Err(error) = crate::server::settings_handlers::commit_settings_update(&data, update)
        {
            return crate::server::settings_handlers::audio_settings_error_response(error);
        }
    }

    let state_response = {
        let player = data.player.lock();
        if let Some(album_gain_db) = body.album_gain_db {
            player.set_album_gain(album_gain_db);
        }
        get_player_state(&player)
    };

    let state_response = enrich_player_state(&data.app_db, state_response);
    HttpResponse::Ok().json(ApiResponse::success_with_state(
        "Normalization configured",
        state_response,
    ))
}

pub(super) async fn load_ir(
    data: web::Data<Arc<AppState>>,
    body: web::Json<LoadIrRequest>,
) -> HttpResponse {
    let path = match validate_path(&body.path) {
        Ok(p) => p,
        Err(e) => return bad_request_response(e),
    };

    let mut player = data.player.lock();
    match player.load_ir(&path) {
        Ok(()) => HttpResponse::Ok().json(ApiResponse::success("IR loaded")),
        Err(e) => {
            if e.to_ascii_lowercase().contains("not yet implemented") {
                HttpResponse::NotImplemented().json(ApiResponse::error(&e))
            } else {
                internal_server_error_response(e)
            }
        }
    }
}

pub(super) async fn unload_ir(data: web::Data<Arc<AppState>>) -> HttpResponse {
    data.player.lock().unload_ir();
    HttpResponse::Ok().json(ApiResponse::success("IR unloaded"))
}

pub(super) async fn get_loading_status(data: web::Data<Arc<AppState>>) -> HttpResponse {
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

pub(super) async fn get_ir_status(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let player = data.player.lock();

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "ir": {
            "loaded": player.is_ir_loaded()
        }
    }))
}

pub(super) async fn get_device_config_domain(data: web::Data<Arc<AppState>>) -> HttpResponse {
    match data.app_db.get_device_config("active_output") {
        Ok(config) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "device_config": config
        })),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn get_dsp_configs_domain(data: web::Data<Arc<AppState>>) -> HttpResponse {
    match data.app_db.list_dsp_configs() {
        Ok(configs) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "dsp_configs": configs
        })),
        Err(e) => internal_server_error_response(e),
    }
}

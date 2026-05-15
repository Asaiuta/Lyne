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
    let mut player = data.player.lock();

    if let Err(e) = player.select_device(body.device_id) {
        return internal_server_error_response(e);
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

    let mut player = data.player.lock();
    player.target_sample_rate = body.target_samplerate;

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
    let mut player = data.player.lock();

    if let Some(ref quality_str) = body.quality {
        let quality = match quality_str.to_lowercase().as_str() {
            "low" => crate::config::ResampleQuality::Low,
            "std" | "standard" => crate::config::ResampleQuality::Standard,
            "hq" | "high" => crate::config::ResampleQuality::High,
            "uhq" | "ultrahigh" => crate::config::ResampleQuality::UltraHigh,
            _ => {
                return bad_request_response("Invalid quality. Use: low, std, hq, uhq");
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

pub(super) async fn configure_normalization(
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

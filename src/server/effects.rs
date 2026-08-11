use super::*;
use crate::config::normalize_eq_bands;
use actix_web::{web, HttpResponse};
use std::sync::Arc;

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/set_eq", web::post().to(set_eq))
        .route("/set_eq_type", web::post().to(set_eq_type))
        .route(
            "/configure_optimizations",
            web::post().to(configure_optimizations),
        )
        .route("/crossfeed", web::get().to(get_crossfeed))
        .route("/set_crossfeed", web::post().to(set_crossfeed))
        .route("/saturation", web::get().to(get_saturation))
        .route("/set_saturation", web::post().to(set_saturation))
        .route("/dynamic_loudness", web::get().to(get_dynamic_loudness))
        .route(
            "/set_dynamic_loudness",
            web::post().to(set_dynamic_loudness),
        )
        .route("/noise_shaper_curve", web::get().to(get_noise_shaper_curve))
        .route(
            "/set_noise_shaper_curve",
            web::post().to(set_noise_shaper_curve),
        )
        .route(
            "/configure_output_bits",
            web::post().to(configure_output_bits),
        );
}

async fn set_eq(data: web::Data<Arc<AppState>>, body: web::Json<SetEqRequest>) -> HttpResponse {
    let normalized_bands = body.bands.as_ref().map(|bands| {
        normalize_eq_bands(bands.clone(), |unknown| {
            log::warn!("Unknown EQ band name: '{}'", unknown);
        })
    });

    if let Some(bands) = normalized_bands {
        let update = crate::config::EngineSettingsUpdate {
            eq_bands: Some(bands),
            ..crate::config::EngineSettingsUpdate::default()
        };
        if let Err(error) = crate::server::settings_handlers::commit_settings_update(&data, update)
        {
            return crate::server::settings_handlers::audio_settings_error_response(error);
        }
    }

    if let Some(enabled) = body.enabled {
        let mut player = data.player.lock();
        if player.is_fir_eq_enabled() {
            if !enabled {
                player.disable_fir_eq();
            }
        } else {
            player.lockfree_eq_params.set_enabled(enabled);
        }
    }

    success_response("EQ updated")
}

async fn set_eq_type(
    data: web::Data<Arc<AppState>>,
    body: web::Json<SetEqTypeRequest>,
) -> HttpResponse {
    let eq_type_upper = body.eq_type.to_uppercase();
    if !matches!(eq_type_upper.as_str(), "IIR" | "FIR") {
        return bad_request_response(format!(
            "Unknown EQ type: '{}'. Supported types: IIR, FIR",
            body.eq_type
        ));
    }
    let update = crate::config::EngineSettingsUpdate {
        eq_type: Some(eq_type_upper.clone()),
        fir_taps: (eq_type_upper == "FIR").then_some(body.fir_taps.unwrap_or(1023)),
        ..crate::config::EngineSettingsUpdate::default()
    };
    match crate::server::settings_handlers::commit_settings_update(&data, update) {
        Ok(_) => HttpResponse::Ok().json(ApiResponse::success(format!(
            "EQ type set to {}",
            eq_type_upper
        ))),
        Err(error) => crate::server::settings_handlers::audio_settings_error_response(error),
    }
}

async fn configure_optimizations(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ConfigureOptimizationsRequest>,
) -> HttpResponse {
    if let Some(dither_enabled) = body.dither_enabled {
        let update = crate::config::EngineSettingsUpdate {
            dither_enabled: Some(dither_enabled),
            ..crate::config::EngineSettingsUpdate::default()
        };
        if let Err(error) = crate::server::settings_handlers::commit_settings_update(&data, update)
        {
            return crate::server::settings_handlers::audio_settings_error_response(error);
        }
    }
    success_response("Optimizations updated")
}

async fn set_crossfeed(
    data: web::Data<Arc<AppState>>,
    body: web::Json<SetCrossfeedRequest>,
) -> HttpResponse {
    let update = crate::config::EngineSettingsUpdate {
        crossfeed_enabled: body.enabled,
        crossfeed_mix: body.mix,
        ..crate::config::EngineSettingsUpdate::default()
    };
    if !update.is_empty() {
        if let Err(error) = crate::server::settings_handlers::commit_settings_update(&data, update)
        {
            return crate::server::settings_handlers::audio_settings_error_response(error);
        }
    }
    success_response("Crossfeed updated")
}

async fn get_crossfeed(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let player = data.player.lock();
    let settings = player.get_crossfeed_info();

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "crossfeed": {
            "enabled": settings.enabled,
            "mix": settings.mix
        }
    }))
}

async fn set_saturation(
    data: web::Data<Arc<AppState>>,
    body: web::Json<SetSaturationRequest>,
) -> HttpResponse {
    let update = crate::config::EngineSettingsUpdate {
        saturation_enabled: body.enabled,
        saturation_drive: body.drive,
        saturation_mix: body.mix,
        ..crate::config::EngineSettingsUpdate::default()
    };
    if !update.is_empty() {
        if let Err(error) = crate::server::settings_handlers::commit_settings_update(&data, update)
        {
            return crate::server::settings_handlers::audio_settings_error_response(error);
        }
    }

    {
        let player = data.player.lock();
        if let Some(threshold) = body.threshold {
            player.lockfree_saturation_params.set_threshold(threshold);
        }
        if let Some(input_gain_db) = body.input_gain_db {
            player
                .lockfree_saturation_params
                .set_input_gain(input_gain_db);
        }
        if let Some(output_gain_db) = body.output_gain_db {
            player
                .lockfree_saturation_params
                .set_output_gain(output_gain_db);
        }
        if let Some(highpass_mode) = body.highpass_mode {
            player
                .lockfree_saturation_params
                .set_highpass_mode(highpass_mode);
        }
        if let Some(highpass_cutoff) = body.highpass_cutoff {
            player
                .lockfree_saturation_params
                .set_highpass_cutoff(highpass_cutoff);
        }
    }
    success_response("Saturation updated")
}

async fn get_saturation(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let player = data.player.lock();
    let settings = player.get_saturation_info();

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "saturation": settings
    }))
}

async fn set_dynamic_loudness(
    data: web::Data<Arc<AppState>>,
    body: web::Json<SetDynamicLoudnessRequest>,
) -> HttpResponse {
    if let Some(strength) = body.strength {
        if !(0.0..=1.0).contains(&strength) {
            return bad_request_response("Strength must be between 0.0 and 1.0");
        }
    }
    let update = crate::config::EngineSettingsUpdate {
        dynamic_loudness_enabled: body.enabled,
        dynamic_loudness_strength: body.strength,
        ..crate::config::EngineSettingsUpdate::default()
    };
    if !update.is_empty() {
        if let Err(error) = crate::server::settings_handlers::commit_settings_update(&data, update)
        {
            return crate::server::settings_handlers::audio_settings_error_response(error);
        }
    }
    success_response("Dynamic Loudness updated")
}

async fn get_dynamic_loudness(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let player = data.player.lock();

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "dynamic_loudness": {
            "enabled": player.is_dynamic_loudness_enabled(),
            "strength": player.get_dynamic_loudness_strength(),
            "factor": player.get_dynamic_loudness_factor(),
            "band_gains": player.get_dynamic_loudness_gains()
        }
    }))
}

async fn set_noise_shaper_curve(
    data: web::Data<Arc<AppState>>,
    body: web::Json<SetNoiseShaperCurveRequest>,
) -> HttpResponse {
    let curve = match body.curve.to_ascii_lowercase().as_str() {
        "lipshitz5" => crate::processor::NoiseShaperCurve::Lipshitz5,
        "fweighted9" => crate::processor::NoiseShaperCurve::FWeighted9,
        "modifiede9" => crate::processor::NoiseShaperCurve::ModifiedE9,
        "improvede9" => crate::processor::NoiseShaperCurve::ImprovedE9,
        "tpdfonly" => crate::processor::NoiseShaperCurve::TpdfOnly,
        _ => {
            return bad_request_response(format!(
                "Unknown noise shaper curve '{}'. Supported: Lipshitz5, FWeighted9, ModifiedE9, ImprovedE9, TpdfOnly",
                body.curve
            ));
        }
    };

    let update = crate::config::EngineSettingsUpdate {
        noise_shaper_curve: Some(format!("{:?}", curve)),
        ..crate::config::EngineSettingsUpdate::default()
    };
    if let Err(error) = crate::server::settings_handlers::commit_settings_update(&data, update) {
        return crate::server::settings_handlers::audio_settings_error_response(error);
    }
    let (enabled, bits) = {
        let player = data.player.lock();
        (player.dither_enabled, player.get_output_bits())
    };
    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "message": format!("Noise shaper curve set to {:?}", curve),
        "noise_shaper": {
            "curve": format!("{:?}", curve),
            "enabled": enabled,
            "bits": bits
        }
    }))
}

async fn get_noise_shaper_curve(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let player = data.player.lock();
    let curve = player.get_noise_shaper_curve();

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "noise_shaper": {
            "curve": curve,
            "enabled": player.dither_enabled,
            "bits": player.get_output_bits()
        }
    }))
}

async fn configure_output_bits(
    data: web::Data<Arc<AppState>>,
    body: web::Json<SetOutputBitsRequest>,
) -> HttpResponse {
    if body.bits != 16 && body.bits != 24 && body.bits != 32 {
        return bad_request_response("Invalid bit depth. Supported: 16, 24, 32");
    }

    let update = crate::config::EngineSettingsUpdate {
        output_bits: Some(body.bits),
        ..crate::config::EngineSettingsUpdate::default()
    };
    if let Err(error) = crate::server::settings_handlers::commit_settings_update(&data, update) {
        return crate::server::settings_handlers::audio_settings_error_response(error);
    }
    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "message": format!("Output bit depth set to {} bits", body.bits)
    }))
}

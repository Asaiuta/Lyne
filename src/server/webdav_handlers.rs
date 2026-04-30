use super::*;
use actix_web::{web, HttpResponse};
use std::sync::Arc;

#[derive(serde::Deserialize)]
struct WebDavSourcePath {
    source_key: String,
}

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/webdav/configure", web::post().to(webdav_configure))
        .route("/webdav/config", web::get().to(get_webdav_config))
        .route("/domain/webdav/sources", web::post().to(upsert_webdav_source))
        .route("/domain/webdav/sources", web::get().to(list_webdav_sources))
        .route("/domain/webdav/sources/default", web::post().to(set_default_webdav_source))
        .route("/domain/webdav/sources/{source_key}", web::get().to(get_webdav_source))
        .route("/domain/webdav/sources/{source_key}", web::delete().to(delete_webdav_source))
        .route("/webdav/browse", web::get().to(webdav_browse));
}

async fn webdav_configure(
    data: web::Data<Arc<AppState>>,
    body: web::Json<WebDavConfigureRequest>,
) -> HttpResponse {
    let persisted = WebDavConfig {
        base_url: body.base_url.trim_end_matches('/').to_string(),
        username: body.username.clone(),
        password: body.password.clone(),
    };
    if let Err(e) = data.app_db.save_primary_webdav_source(&persisted) {
        log::warn!("Failed to persist WebDAV config: {}", e);
        return HttpResponse::InternalServerError().json(ApiResponse::error(&e));
    }
    *data.webdav_config.lock() = persisted.clone();
    log::info!("WebDAV configured: {}", persisted.base_url);
    HttpResponse::Ok().json(ApiResponse::success("WebDAV configured"))
}

async fn webdav_browse(
    data: web::Data<Arc<AppState>>,
    query: web::Query<WebDavBrowseRequest>,
) -> HttpResponse {
    let cfg = data.webdav_config.lock().clone();
    if !cfg.is_configured() {
        return HttpResponse::BadRequest().json(ApiResponse::error("WebDAV not configured"));
    }
    let path = query.path.as_deref().unwrap_or("/").to_string();

    let cfg_clone = cfg.clone();
    let path_for_block = path.clone();
    let result = run_analysis_job(&data, move || {
        cfg_clone
            .list(&path_for_block)
            .map_err(|e| format!("WebDAV list failed: {}", e))
    })
    .await;

    match result {
        Ok(entries) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "path": path,
            "entries": entries,
        })),
        Err(e) => {
            if e.to_ascii_lowercase().contains("timed out") {
                HttpResponse::GatewayTimeout().json(ApiResponse::error(&e))
            } else {
                HttpResponse::InternalServerError().json(ApiResponse::error(&e))
            }
        }
    }
}

async fn get_webdav_config(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let cfg = data.webdav_config.lock().clone();
    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "webdav": cfg,
    }))
}

async fn list_webdav_sources(data: web::Data<Arc<AppState>>) -> HttpResponse {
    match data.app_db.list_webdav_sources() {
        Ok(sources) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "sources": sources,
        })),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn upsert_webdav_source(
    data: web::Data<Arc<AppState>>,
    body: web::Json<WebDavSourceUpsertRequest>,
) -> HttpResponse {
    let source_key = body.source_key.trim();
    if source_key.is_empty() {
        return HttpResponse::BadRequest().json(ApiResponse::error("source_key is required"));
    }

    let display_name = body
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(source_key);
    let config = WebDavConfig {
        base_url: body.base_url.trim_end_matches('/').to_string(),
        username: body.username.clone(),
        password: body.password.clone(),
    };
    if !config.is_configured() {
        return HttpResponse::BadRequest().json(ApiResponse::error("base_url is required"));
    }

    let make_default = body.is_default.unwrap_or(false);
    if let Err(e) = data
        .app_db
        .upsert_webdav_source(source_key, display_name, &config, make_default)
    {
        return HttpResponse::InternalServerError().json(ApiResponse::error(&e));
    }

    if make_default {
        *data.webdav_config.lock() = config;
    }

    match data.app_db.get_webdav_source(source_key) {
        Ok(Some(source)) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "source": source,
        })),
        Ok(None) => HttpResponse::InternalServerError()
            .json(ApiResponse::error("WebDAV source was saved but could not be reloaded")),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn get_webdav_source(
    data: web::Data<Arc<AppState>>,
    path: web::Path<WebDavSourcePath>,
) -> HttpResponse {
    match data.app_db.get_webdav_source(&path.source_key) {
        Ok(Some(source)) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "source": source,
        })),
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::error("WebDAV source not found")),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn set_default_webdav_source(
    data: web::Data<Arc<AppState>>,
    body: web::Json<WebDavDefaultRequest>,
) -> HttpResponse {
    let source_key = body.source_key.trim();
    if source_key.is_empty() {
        return HttpResponse::BadRequest().json(ApiResponse::error("source_key is required"));
    }

    match data.app_db.set_default_webdav_source(source_key) {
        Ok(Some(config)) => {
            *data.webdav_config.lock() = config;
            match data.app_db.get_webdav_source(source_key) {
                Ok(Some(source)) => HttpResponse::Ok().json(serde_json::json!({
                    "status": "success",
                    "source": source,
                })),
                Ok(None) => HttpResponse::InternalServerError()
                    .json(ApiResponse::error("Default WebDAV source was updated but could not be reloaded")),
                Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
            }
        }
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::error("WebDAV source not found")),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

async fn delete_webdav_source(
    data: web::Data<Arc<AppState>>,
    path: web::Path<WebDavSourcePath>,
) -> HttpResponse {
    match data.app_db.delete_webdav_source(&path.source_key) {
        Ok(Some(fallback_config)) => {
            *data.webdav_config.lock() = fallback_config;
            HttpResponse::Ok().json(ApiResponse::success("WebDAV source deleted"))
        }
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::error("WebDAV source not found")),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::error(&e)),
    }
}

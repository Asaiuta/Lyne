use super::*;
use actix_web::{web, HttpResponse};
use std::sync::Arc;
use std::time::Instant;

const WEBDAV_SOURCE_KEY_MAX_LEN: usize = 80;
const WEBDAV_DISPLAY_NAME_MAX_LEN: usize = 120;
const WEBDAV_BROWSE_PATH_MAX_LEN: usize = 4096;

#[derive(serde::Deserialize)]
struct WebDavSourcePath {
    source_key: String,
}

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/webdav/configure", web::post().to(webdav_configure))
        .route("/webdav/config", web::get().to(get_webdav_config))
        .route(
            "/domain/webdav/sources",
            web::post().to(upsert_webdav_source),
        )
        .route("/domain/webdav/sources", web::get().to(list_webdav_sources))
        .route(
            "/domain/webdav/sources/default",
            web::post().to(set_default_webdav_source),
        )
        .route(
            "/domain/webdav/sources/{source_key}",
            web::get().to(get_webdav_source),
        )
        .route(
            "/domain/webdav/sources/{source_key}",
            web::delete().to(delete_webdav_source),
        )
        .route("/webdav/browse", web::get().to(webdav_browse));
}

async fn webdav_configure(
    data: web::Data<Arc<AppState>>,
    body: web::Json<WebDavConfigureRequest>,
) -> HttpResponse {
    let persisted = match build_webdav_config(&body.base_url, &body.username, &body.password) {
        Ok(config) => config,
        Err(e) => return bad_request_response(e),
    };
    if let Err(e) = data.app_db.save_primary_webdav_source(&persisted) {
        log::warn!("Failed to persist WebDAV config: {}", e);
        return internal_server_error_response(e);
    }
    *data.webdav_config.lock() = persisted.clone();
    log::info!("WebDAV configured: {}", persisted.base_url);
    success_response("WebDAV configured")
}

async fn webdav_browse(
    data: web::Data<Arc<AppState>>,
    query: web::Query<WebDavBrowseRequest>,
) -> HttpResponse {
    let cfg = data.webdav_config.lock().clone();
    if !cfg.is_configured() {
        return bad_request_response("WebDAV not configured");
    }
    let path = match normalize_webdav_browse_path(query.path.as_deref()) {
        Ok(path) => path,
        Err(e) => return bad_request_response(e),
    };

    let cfg_clone = cfg.clone();
    let path_for_block = path.clone();
    let started_at = Instant::now();
    let result = run_analysis_job(&data, move |cancel_token| {
        cancel_token.check()?;
        let entries = cfg_clone
            .list(&path_for_block)
            .map_err(|e| format!("WebDAV list failed: {}", e))?;
        cancel_token.check()?;
        Ok(entries)
    })
    .await;
    record_webdav_probe(data.as_ref().as_ref(), started_at.elapsed(), result.is_ok());

    match result {
        Ok(entries) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "path": path,
            "entries": entries,
        })),
        Err(e) => {
            if is_analysis_timeout_error(&e) {
                gateway_timeout_response(e)
            } else {
                internal_server_error_response(e)
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
        Err(e) => internal_server_error_response(e),
    }
}

async fn upsert_webdav_source(
    data: web::Data<Arc<AppState>>,
    body: web::Json<WebDavSourceUpsertRequest>,
) -> HttpResponse {
    let source_key = match normalize_webdav_source_key(&body.source_key) {
        Ok(value) => value,
        Err(e) => return bad_request_response(e),
    };

    let display_name =
        match normalize_webdav_display_name(body.display_name.as_deref(), &source_key) {
            Ok(value) => value,
            Err(e) => return bad_request_response(e),
        };
    let config = match build_webdav_config(&body.base_url, &body.username, &body.password) {
        Ok(config) => config,
        Err(e) => return bad_request_response(e),
    };

    let make_default = body.is_default.unwrap_or(false);
    if let Err(e) =
        data.app_db
            .upsert_webdav_source(&source_key, &display_name, &config, make_default)
    {
        return internal_server_error_response(e);
    }

    if make_default {
        *data.webdav_config.lock() = config;
    }

    match data.app_db.get_webdav_source(&source_key) {
        Ok(Some(source)) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "source": source,
        })),
        Ok(None) => {
            internal_server_error_response("WebDAV source was saved but could not be reloaded")
        }
        Err(e) => internal_server_error_response(e),
    }
}

async fn get_webdav_source(
    data: web::Data<Arc<AppState>>,
    path: web::Path<WebDavSourcePath>,
) -> HttpResponse {
    let source_key = match normalize_webdav_source_key(&path.source_key) {
        Ok(value) => value,
        Err(e) => return bad_request_response(e),
    };
    match data.app_db.get_webdav_source(&source_key) {
        Ok(Some(source)) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "source": source,
        })),
        Ok(None) => not_found_response("WebDAV source not found"),
        Err(e) => internal_server_error_response(e),
    }
}

async fn set_default_webdav_source(
    data: web::Data<Arc<AppState>>,
    body: web::Json<WebDavDefaultRequest>,
) -> HttpResponse {
    let source_key = match normalize_webdav_source_key(&body.source_key) {
        Ok(value) => value,
        Err(e) => return bad_request_response(e),
    };

    match data.app_db.set_default_webdav_source(&source_key) {
        Ok(Some(config)) => {
            *data.webdav_config.lock() = config;
            match data.app_db.get_webdav_source(&source_key) {
                Ok(Some(source)) => HttpResponse::Ok().json(serde_json::json!({
                    "status": "success",
                    "source": source,
                })),
                Ok(None) => internal_server_error_response(
                    "Default WebDAV source was updated but could not be reloaded",
                ),
                Err(e) => internal_server_error_response(e),
            }
        }
        Ok(None) => not_found_response("WebDAV source not found"),
        Err(e) => internal_server_error_response(e),
    }
}

async fn delete_webdav_source(
    data: web::Data<Arc<AppState>>,
    path: web::Path<WebDavSourcePath>,
) -> HttpResponse {
    let source_key = match normalize_webdav_source_key(&path.source_key) {
        Ok(value) => value,
        Err(e) => return bad_request_response(e),
    };
    match data.app_db.delete_webdav_source(&source_key) {
        Ok(Some(fallback_config)) => {
            *data.webdav_config.lock() = fallback_config;
            success_response("WebDAV source deleted")
        }
        Ok(None) => not_found_response("WebDAV source not found"),
        Err(e) => internal_server_error_response(e),
    }
}

fn build_webdav_config(
    base_url: &str,
    username: &Option<String>,
    password: &Option<String>,
) -> Result<WebDavConfig, String> {
    Ok(WebDavConfig {
        base_url: normalize_webdav_base_url(base_url)?,
        username: username
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
        password: password
            .as_deref()
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
    })
}

fn normalize_webdav_base_url(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("base_url is required".to_string());
    }
    if trimmed.chars().any(char::is_control) || trimmed.contains('\\') {
        return Err("base_url contains invalid path characters".to_string());
    }
    if has_parent_path_segment(trimmed) {
        return Err("WebDAV base_url contains path traversal segments".to_string());
    }

    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("http://{}", trimmed)
    };
    let url =
        reqwest::Url::parse(&candidate).map_err(|e| format!("Invalid WebDAV base_url: {}", e))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("WebDAV base_url must use http or https".to_string());
    }
    if url.host_str().is_none() {
        return Err("WebDAV base_url must include a host".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("WebDAV base_url must not include embedded credentials".to_string());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("WebDAV base_url must not include query or fragment components".to_string());
    }

    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn normalize_webdav_source_key(source_key: &str) -> Result<String, String> {
    let trimmed = source_key.trim();
    if trimmed.is_empty() {
        return Err("source_key is required".to_string());
    }
    if trimmed.len() > WEBDAV_SOURCE_KEY_MAX_LEN {
        return Err("source_key is too long".to_string());
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(
            "source_key may only contain ASCII letters, numbers, '-', '_' or '.'".to_string(),
        );
    }
    Ok(trimmed.to_string())
}

fn normalize_webdav_display_name(
    display_name: Option<&str>,
    fallback: &str,
) -> Result<String, String> {
    let value = display_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback);
    if value.len() > WEBDAV_DISPLAY_NAME_MAX_LEN {
        return Err("display_name is too long".to_string());
    }
    if value.chars().any(char::is_control) {
        return Err("display_name contains control characters".to_string());
    }
    Ok(value.to_string())
}

fn normalize_webdav_browse_path(path: Option<&str>) -> Result<String, String> {
    let value = path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("/");
    if value.len() > WEBDAV_BROWSE_PATH_MAX_LEN {
        return Err("WebDAV browse path is too long".to_string());
    }
    let lower = value.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") || lower.contains("://") {
        return Err("WebDAV browse path must be relative to the configured source".to_string());
    }
    if value.contains('\\') || has_parent_path_segment(value) {
        return Err("WebDAV browse path contains invalid path traversal characters".to_string());
    }
    if value.chars().any(char::is_control) {
        return Err("WebDAV browse path contains control characters".to_string());
    }
    Ok(value.to_string())
}

fn has_parent_path_segment(value: &str) -> bool {
    let path = value
        .split_once("://")
        .and_then(|(_, rest)| rest.find('/').map(|slash| &rest[slash..]))
        .unwrap_or(value);
    let path = path.split(['?', '#']).next().unwrap_or(path);
    path.split('/').any(is_parent_path_segment)
}

fn is_parent_path_segment(segment: &str) -> bool {
    if segment == ".." {
        return true;
    }
    segment.to_ascii_lowercase().replace("%2e", ".") == ".."
}

#[cfg(test)]
mod tests {
    use super::{
        build_webdav_config, normalize_webdav_base_url, normalize_webdav_browse_path,
        normalize_webdav_display_name, normalize_webdav_source_key,
    };

    #[test]
    fn normalize_webdav_base_url_requires_http_url_without_credentials() {
        assert_eq!(
            normalize_webdav_base_url(" nas.example.test/dav/ ").unwrap(),
            "http://nas.example.test/dav"
        );
        assert!(normalize_webdav_base_url("ftp://nas.example.test/dav").is_err());
        assert!(normalize_webdav_base_url("https://user:pass@nas.example.test/dav").is_err());
        assert!(normalize_webdav_base_url("https://nas.example.test/dav?token=1").is_err());
        assert!(normalize_webdav_base_url("https://nas.example.test/dav/../secret").is_err());
        assert!(normalize_webdav_base_url("https://nas.example.test/dav/%2e%2e/secret").is_err());
    }

    #[test]
    fn normalize_webdav_source_key_rejects_path_like_input() {
        assert_eq!(
            normalize_webdav_source_key(" archive-1 ").unwrap(),
            "archive-1"
        );
        assert!(normalize_webdav_source_key("").is_err());
        assert!(normalize_webdav_source_key("../archive").is_err());
        assert!(normalize_webdav_source_key("archive/key").is_err());
    }

    #[test]
    fn normalize_webdav_browse_path_rejects_absolute_or_traversal_input() {
        assert_eq!(normalize_webdav_browse_path(None).unwrap(), "/");
        assert_eq!(
            normalize_webdav_browse_path(Some("music")).unwrap(),
            "music"
        );
        assert!(normalize_webdav_browse_path(Some("https://evil.example/dav")).is_err());
        assert!(normalize_webdav_browse_path(Some("/music/../secret")).is_err());
        assert!(normalize_webdav_browse_path(Some("/music/%2e%2e/secret")).is_err());
        assert!(normalize_webdav_browse_path(Some(r"\windows")).is_err());
    }

    #[test]
    fn build_webdav_config_trims_optional_credentials() {
        let config = build_webdav_config(
            "https://nas.example.test/dav/",
            &Some(" user ".to_string()),
            &Some("".to_string()),
        )
        .unwrap();

        assert_eq!(config.base_url, "https://nas.example.test/dav");
        assert_eq!(config.username.as_deref(), Some("user"));
        assert_eq!(config.password, None);
    }

    #[test]
    fn normalize_webdav_display_name_uses_source_key_fallback() {
        assert_eq!(
            normalize_webdav_display_name(Some("  "), "primary").unwrap(),
            "primary"
        );
        assert!(normalize_webdav_display_name(Some("bad\nname"), "primary").is_err());
    }
}

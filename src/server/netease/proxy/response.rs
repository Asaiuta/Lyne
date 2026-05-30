use actix_web::http::{header, StatusCode};
use actix_web::HttpResponse;
use ncm_api_rs::{ApiResponse, NcmError};
use serde_json::Value;

pub(in crate::server::netease) fn build_success_response(api_resp: ApiResponse) -> HttpResponse {
    let status = StatusCode::from_u16(api_resp.status as u16).unwrap_or(StatusCode::OK);
    let mut builder = HttpResponse::build(status);

    for cookie_str in &api_resp.cookie {
        if let Ok(val) = header::HeaderValue::from_str(cookie_str) {
            builder.append_header((header::SET_COOKIE, val));
        }
    }

    let mut body = api_resp.body;
    if !api_resp.cookie.is_empty() {
        if let Value::Object(map) = &mut body {
            if !map.contains_key("cookie") {
                let joined = join_cookie_pairs(&api_resp.cookie);
                if !joined.is_empty() {
                    map.insert("cookie".to_string(), Value::String(joined));
                }
            }
        }
    }

    builder.json(body)
}

pub(in crate::server::netease) fn join_cookie_pairs(set_cookies: &[String]) -> String {
    set_cookies
        .iter()
        .filter_map(|c| c.split(';').next().map(str::trim))
        .filter(|s| !s.is_empty() && s.contains('='))
        .collect::<Vec<_>>()
        .join("; ")
}

pub(in crate::server::netease) fn build_error_response(err: NcmError) -> HttpResponse {
    let (status, code, message) = match err {
        NcmError::AuthRequired(msg) => (StatusCode::UNAUTHORIZED, 301, msg),
        NcmError::InvalidParam(msg) => (StatusCode::BAD_REQUEST, 400, msg),
        NcmError::RateLimited(msg) => (StatusCode::TOO_MANY_REQUESTS, 503, msg),
        NcmError::Timeout(msg) => (StatusCode::GATEWAY_TIMEOUT, 504, msg),
        NcmError::Api { code, msg } => (
            StatusCode::from_u16(code as u16).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            code,
            msg,
        ),
        other => (StatusCode::INTERNAL_SERVER_ERROR, 500, other.to_string()),
    };

    json_error(status, code, &message)
}

pub(super) fn json_error(status: StatusCode, code: i64, message: &str) -> HttpResponse {
    HttpResponse::build(status).json(serde_json::json!({
        "code": code,
        "msg": message,
    }))
}

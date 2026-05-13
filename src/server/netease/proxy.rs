use super::*;
use actix_web::http::header::{self, HeaderMap};
use actix_web::{web, HttpRequest, HttpResponse};
use ncm_api_rs::{ApiClient, ApiResponse, NcmError, Query};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

const ALLOWED_DOMAIN_OVERRIDES: &[&str] = &[
    "https://music.163.com",
    "https://interface.music.163.com",
    "https://interface3.music.163.com",
];

pub(super) async fn handle_request(
    data: web::Data<Arc<AppState>>,
    req: HttpRequest,
    body: web::Bytes,
    path: web::Path<NeteasePath>,
) -> HttpResponse {
    let route = normalize_route(&path.tail);
    if route.is_empty() {
        return json_error(
            actix_web::http::StatusCode::BAD_REQUEST,
            400,
            "Missing NCM route",
        );
    }

    let content_type = req
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok());

    let mut query =
        match extract_merged_query(req.headers(), req.uri().query(), &body, content_type) {
            Ok(query) => query,
            Err(err) => return json_error(actix_web::http::StatusCode::BAD_REQUEST, 400, &err),
        };
    inject_active_ncm_cookie(&data, &mut query);

    let start = std::time::Instant::now();
    let method = route_to_method(&route);
    let result = dispatch(data.ncm_client.as_ref(), &method, &query).await;

    match result {
        Ok(response) => {
            log::info!(
                "NCM {} -> {} ({:.1?})",
                route,
                response.status,
                start.elapsed()
            );
            build_success_response(response)
        }
        Err(DispatchError::UnsupportedRoute) => json_error(
            actix_web::http::StatusCode::NOT_FOUND,
            404,
            &format!("Unsupported NCM route: {}", route),
        ),
        Err(DispatchError::Ncm(err)) => {
            log::warn!("NCM {} -> ERROR: {} ({:.1?})", route, err, start.elapsed());
            build_error_response(err)
        }
    }
}

#[derive(Debug)]
enum DispatchError {
    UnsupportedRoute,
    Ncm(NcmError),
}

async fn dispatch(
    client: &ApiClient,
    method: &str,
    query: &Query,
) -> Result<ApiResponse, DispatchError> {
    match method {
        "inner_version" => client.inner_version().await.map_err(DispatchError::Ncm),
        "login" => client.login(query).await.map_err(DispatchError::Ncm),
        "login_cellphone" => client
            .login_cellphone(query)
            .await
            .map_err(DispatchError::Ncm),
        "login_qr_key" => client.login_qr_key(query).await.map_err(DispatchError::Ncm),
        "login_qr_create" => client
            .login_qr_create(query)
            .await
            .map_err(DispatchError::Ncm),
        "login_qr_check" => client
            .login_qr_check(query)
            .await
            .map_err(DispatchError::Ncm),
        "login_refresh" => client
            .login_refresh(query)
            .await
            .map_err(DispatchError::Ncm),
        "login_status" => client.login_status(query).await.map_err(DispatchError::Ncm),
        "logout" => client.logout(query).await.map_err(DispatchError::Ncm),
        "register_anonimous" => client
            .register_anonimous(query)
            .await
            .map_err(DispatchError::Ncm),
        "register_cellphone" => client
            .register_cellphone(query)
            .await
            .map_err(DispatchError::Ncm),
        "captcha_sent" => client.captcha_sent(query).await.map_err(DispatchError::Ncm),
        "captcha_verify" => client
            .captcha_verify(query)
            .await
            .map_err(DispatchError::Ncm),
        "cellphone_existence_check" => client
            .cellphone_existence_check(query)
            .await
            .map_err(DispatchError::Ncm),
        "activate_init_profile" => client
            .activate_init_profile(query)
            .await
            .map_err(DispatchError::Ncm),
        "search" => client.search(query).await.map_err(DispatchError::Ncm),
        "cloudsearch" => client.cloudsearch(query).await.map_err(DispatchError::Ncm),
        "search_default" => client
            .search_default(query)
            .await
            .map_err(DispatchError::Ncm),
        "search_hot" => client.search_hot(query).await.map_err(DispatchError::Ncm),
        "search_hot_detail" => client
            .search_hot_detail(query)
            .await
            .map_err(DispatchError::Ncm),
        "search_suggest" => client
            .search_suggest(query)
            .await
            .map_err(DispatchError::Ncm),
        "search_suggest_pc" => client
            .search_suggest_pc(query)
            .await
            .map_err(DispatchError::Ncm),
        "search_multimatch" => client
            .search_multimatch(query)
            .await
            .map_err(DispatchError::Ncm),
        "search_match" => client.search_match(query).await.map_err(DispatchError::Ncm),
        "song_detail" => client.song_detail(query).await.map_err(DispatchError::Ncm),
        "song_music_detail" => client
            .song_music_detail(query)
            .await
            .map_err(DispatchError::Ncm),
        "check_music" => client.check_music(query).await.map_err(DispatchError::Ncm),
        "lyric" => client.lyric(query).await.map_err(DispatchError::Ncm),
        "lyric_new" => client.lyric_new(query).await.map_err(DispatchError::Ncm),
        "album" => client.album(query).await.map_err(DispatchError::Ncm),
        "album_detail" => client.album_detail(query).await.map_err(DispatchError::Ncm),
        "artist_detail" => client
            .artist_detail(query)
            .await
            .map_err(DispatchError::Ncm),
        "artists" => client.artists(query).await.map_err(DispatchError::Ncm),
        "song_url" => client.song_url(query).await.map_err(DispatchError::Ncm),
        "song_url_v1" => client.song_url_v1(query).await.map_err(DispatchError::Ncm),
        "song_url_ncmget" => client
            .song_url_ncmget(query)
            .await
            .map_err(DispatchError::Ncm),
        "song_url_match" => client
            .song_url_match(query)
            .await
            .map_err(DispatchError::Ncm),
        "playlist_detail" => client
            .playlist_detail(query)
            .await
            .map_err(DispatchError::Ncm),
        "playlist_detail_dynamic" => client
            .playlist_detail_dynamic(query)
            .await
            .map_err(DispatchError::Ncm),
        "playlist_tracks" => client
            .playlist_tracks(query)
            .await
            .map_err(DispatchError::Ncm),
        "playlist_track_all" => client
            .playlist_track_all(query)
            .await
            .map_err(DispatchError::Ncm),
        "playlist_create" => client
            .playlist_create(query)
            .await
            .map_err(DispatchError::Ncm),
        "playlist_delete" => client
            .playlist_delete(query)
            .await
            .map_err(DispatchError::Ncm),
        "playlist_subscribe" => client
            .playlist_subscribe(query)
            .await
            .map_err(DispatchError::Ncm),
        "playlist_catlist" => client
            .playlist_catlist(query)
            .await
            .map_err(DispatchError::Ncm),
        "playlist_category_list" => client
            .playlist_category_list(query)
            .await
            .map_err(DispatchError::Ncm),
        "playlist_hot" => client.playlist_hot(query).await.map_err(DispatchError::Ncm),
        "playlist_highquality_tags" => client
            .playlist_highquality_tags(query)
            .await
            .map_err(DispatchError::Ncm),
        "playlist_update" => client
            .playlist_update(query)
            .await
            .map_err(DispatchError::Ncm),
        "playlist_name_update" => client
            .playlist_name_update(query)
            .await
            .map_err(DispatchError::Ncm),
        "playlist_desc_update" => client
            .playlist_desc_update(query)
            .await
            .map_err(DispatchError::Ncm),
        "playlist_tags_update" => client
            .playlist_tags_update(query)
            .await
            .map_err(DispatchError::Ncm),
        "playlist_order_update" => client
            .playlist_order_update(query)
            .await
            .map_err(DispatchError::Ncm),
        "playlist_update_playcount" => client
            .playlist_update_playcount(query)
            .await
            .map_err(DispatchError::Ncm),
        "playlist_subscribers" => client
            .playlist_subscribers(query)
            .await
            .map_err(DispatchError::Ncm),
        "playlist_detail_rcmd_get" => client
            .playlist_detail_rcmd_get(query)
            .await
            .map_err(DispatchError::Ncm),
        "playlist_mylike" => client
            .playlist_mylike(query)
            .await
            .map_err(DispatchError::Ncm),
        "toplist" => client.toplist(query).await.map_err(DispatchError::Ncm),
        "toplist_detail" => client
            .toplist_detail(query)
            .await
            .map_err(DispatchError::Ncm),
        "toplist_detail_v2" => client
            .toplist_detail_v2(query)
            .await
            .map_err(DispatchError::Ncm),
        "toplist_artist" => client
            .toplist_artist(query)
            .await
            .map_err(DispatchError::Ncm),
        "top_playlist" => client.top_playlist(query).await.map_err(DispatchError::Ncm),
        "top_playlist_highquality" => client
            .top_playlist_highquality(query)
            .await
            .map_err(DispatchError::Ncm),
        "top_list" => client.top_list(query).await.map_err(DispatchError::Ncm),
        "user_playlist" => client
            .user_playlist(query)
            .await
            .map_err(DispatchError::Ncm),
        "user_playlist_create" => client
            .user_playlist_create(query)
            .await
            .map_err(DispatchError::Ncm),
        "user_playlist_collect" => client
            .user_playlist_collect(query)
            .await
            .map_err(DispatchError::Ncm),
        "user_account" => client.user_account(query).await.map_err(DispatchError::Ncm),
        "user_cloud" => client.user_cloud(query).await.map_err(DispatchError::Ncm),
        "user_cloud_del" => client
            .user_cloud_del(query)
            .await
            .map_err(DispatchError::Ncm),
        "user_detail" => client.user_detail(query).await.map_err(DispatchError::Ncm),
        "user_subcount" => client
            .user_subcount(query)
            .await
            .map_err(DispatchError::Ncm),
        "user_level" => client.user_level(query).await.map_err(DispatchError::Ncm),
        "likelist" => client.likelist(query).await.map_err(DispatchError::Ncm),
        "like" => client.like(query).await.map_err(DispatchError::Ncm),
        "daily_signin" => client.daily_signin(query).await.map_err(DispatchError::Ncm),
        "scrobble" => client.scrobble(query).await.map_err(DispatchError::Ncm),
        "personalized" => client.personalized(query).await.map_err(DispatchError::Ncm),
        "personalized_newsong" => client
            .personalized_newsong(query)
            .await
            .map_err(DispatchError::Ncm),
        "personalized_mv" => client
            .personalized_mv(query)
            .await
            .map_err(DispatchError::Ncm),
        "personalized_djprogram" => client
            .personalized_djprogram(query)
            .await
            .map_err(DispatchError::Ncm),
        "recommend_resource" => client
            .recommend_resource(query)
            .await
            .map_err(DispatchError::Ncm),
        "recommend_songs" => client
            .recommend_songs(query)
            .await
            .map_err(DispatchError::Ncm),
        "fm_trash" => client.fm_trash(query).await.map_err(DispatchError::Ncm),
        "personal_fm" => client.personal_fm(query).await.map_err(DispatchError::Ncm),
        "top_artists" => client.top_artists(query).await.map_err(DispatchError::Ncm),
        "album_newest" => client.album_newest(query).await.map_err(DispatchError::Ncm),
        "album_new" => client.album_new(query).await.map_err(DispatchError::Ncm),
        "top_song" => client.top_song(query).await.map_err(DispatchError::Ncm),
        "artist_list" => client.artist_list(query).await.map_err(DispatchError::Ncm),
        "dj_personalize_recommend" => client
            .dj_personalize_recommend(query)
            .await
            .map_err(DispatchError::Ncm),
        "dj_catelist" => client.dj_catelist(query).await.map_err(DispatchError::Ncm),
        "dj_category_recommend" => client
            .dj_category_recommend(query)
            .await
            .map_err(DispatchError::Ncm),
        "dj_detail" => client.dj_detail(query).await.map_err(DispatchError::Ncm),
        "dj_program" => client.dj_program(query).await.map_err(DispatchError::Ncm),
        "dj_radio_hot" => client.dj_radio_hot(query).await.map_err(DispatchError::Ncm),
        "dj_recommend" => client.dj_recommend(query).await.map_err(DispatchError::Ncm),
        "dj_recommend_type" => client
            .dj_recommend_type(query)
            .await
            .map_err(DispatchError::Ncm),
        "dj_sub" => client.dj_sub(query).await.map_err(DispatchError::Ncm),
        "dj_toplist" => client.dj_toplist(query).await.map_err(DispatchError::Ncm),
        "mv_first" => client.mv_first(query).await.map_err(DispatchError::Ncm),
        _ => Err(DispatchError::UnsupportedRoute),
    }
}

pub(super) fn normalize_route(raw: &str) -> String {
    raw.trim_matches('/').to_string()
}

pub(super) fn route_to_method(route: &str) -> String {
    route.replace('/', "_")
}

pub(super) fn extract_merged_query(
    headers: &HeaderMap,
    uri_query: Option<&str>,
    body: &[u8],
    content_type: Option<&str>,
) -> Result<Query, String> {
    let mut query = Query::new();

    if let Some(cookie_header) = headers.get(header::COOKIE) {
        if let Ok(cookie) = cookie_header.to_str() {
            if !cookie.trim().is_empty() {
                query.cookie = Some(cookie.to_string());
            }
        }
    }

    if let Some(qs) = uri_query {
        if !qs.trim().is_empty() {
            let params = parse_urlencoded(qs, "query string")?;
            merge_params(&mut query.params, params);
        }
    }

    if !body.is_empty() {
        let params = parse_body_params(body, content_type)?;
        merge_params(&mut query.params, params);
    }

    apply_query_overrides(&mut query)?;

    Ok(query)
}

fn merge_params(target: &mut HashMap<String, String>, params: HashMap<String, String>) {
    for (key, value) in params {
        target.insert(key, value);
    }
}

fn parse_body_params(
    body: &[u8],
    content_type: Option<&str>,
) -> Result<HashMap<String, String>, String> {
    let content_type = content_type.unwrap_or("");
    if content_type.contains("application/json") {
        parse_json_body(body)
    } else if content_type.contains("application/x-www-form-urlencoded") {
        let body_str =
            std::str::from_utf8(body).map_err(|e| format!("Invalid form body encoding: {}", e))?;
        parse_urlencoded(body_str, "form body")
    } else if content_type.is_empty() {
        parse_json_body(body)
    } else {
        Err(format!("Unsupported content type: {}", content_type))
    }
}

fn parse_urlencoded(input: &str, source: &str) -> Result<HashMap<String, String>, String> {
    serde_urlencoded::from_str::<HashMap<String, String>>(input)
        .map_err(|e| format!("Failed to parse {}: {}", source, e))
}

fn parse_json_body(body: &[u8]) -> Result<HashMap<String, String>, String> {
    let value: Value =
        serde_json::from_slice(body).map_err(|e| format!("Failed to parse JSON body: {}", e))?;
    let obj = value
        .as_object()
        .ok_or_else(|| "JSON body must be an object".to_string())?;
    let mut params = HashMap::new();
    for (key, value) in obj {
        params.insert(key.clone(), json_value_to_string(value));
    }
    Ok(params)
}

fn json_value_to_string(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => "".to_string(),
        _ => value.to_string(),
    }
}

pub(super) fn apply_query_overrides(query: &mut Query) -> Result<(), String> {
    if let Some(cookie) = query.params.remove("cookie") {
        if !cookie.trim().is_empty() {
            query.cookie = Some(cookie);
        }
    }

    if let Some(real_ip) = query
        .params
        .remove("realIP")
        .or_else(|| query.params.remove("real_ip"))
    {
        if !real_ip.trim().is_empty() {
            query.real_ip = Some(real_ip);
        }
    }

    if let Some(random_cn_ip) = query
        .params
        .remove("randomCNIP")
        .or_else(|| query.params.remove("random_cn_ip"))
    {
        query.random_cn_ip = parse_bool(&random_cn_ip);
    }

    if let Some(proxy) = query.params.remove("proxy") {
        if !proxy.trim().is_empty() {
            query.proxy = Some(proxy);
        }
    }

    if let Some(ua) = query.params.remove("ua") {
        if !ua.trim().is_empty() {
            query.ua = Some(ua);
        }
    }

    if let Some(e_r) = query.params.remove("e_r") {
        query.e_r = Some(parse_bool(&e_r));
    }

    if let Some(domain) = query.params.remove("domain") {
        if !domain.trim().is_empty() {
            query.domain = Some(normalize_domain_override(&domain)?);
        }
    }

    Ok(())
}

pub(super) fn normalize_domain_override(raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    let url = reqwest::Url::parse(raw)
        .map_err(|_| "Domain override must be a full https URL".to_string())?;
    if url.scheme() != "https" {
        return Err("Domain override must use https".to_string());
    }
    if url.port().is_some() {
        return Err("Domain override must not include a port".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "Domain override missing host".to_string())?;
    let normalized = format!("{}://{}", url.scheme(), host);

    if !ALLOWED_DOMAIN_OVERRIDES
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(&normalized))
    {
        return Err(format!("Domain override not allowed: {}", normalized));
    }

    Ok(normalized)
}

pub(super) fn parse_bool(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

pub(super) fn build_success_response(api_resp: ApiResponse) -> HttpResponse {
    let status = actix_web::http::StatusCode::from_u16(api_resp.status as u16)
        .unwrap_or(actix_web::http::StatusCode::OK);
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

pub(super) fn join_cookie_pairs(set_cookies: &[String]) -> String {
    set_cookies
        .iter()
        .filter_map(|c| c.split(';').next().map(str::trim))
        .filter(|s| !s.is_empty() && s.contains('='))
        .collect::<Vec<_>>()
        .join("; ")
}

pub(super) fn build_error_response(err: NcmError) -> HttpResponse {
    let (status, code, message) = match err {
        NcmError::AuthRequired(msg) => (actix_web::http::StatusCode::UNAUTHORIZED, 301, msg),
        NcmError::InvalidParam(msg) => (actix_web::http::StatusCode::BAD_REQUEST, 400, msg),
        NcmError::RateLimited(msg) => (actix_web::http::StatusCode::TOO_MANY_REQUESTS, 503, msg),
        NcmError::Timeout(msg) => (actix_web::http::StatusCode::GATEWAY_TIMEOUT, 504, msg),
        NcmError::Api { code, msg } => (
            actix_web::http::StatusCode::from_u16(code as u16)
                .unwrap_or(actix_web::http::StatusCode::INTERNAL_SERVER_ERROR),
            code,
            msg,
        ),
        other => (
            actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
            500,
            other.to_string(),
        ),
    };

    json_error(status, code, &message)
}

fn json_error(status: actix_web::http::StatusCode, code: i64, message: &str) -> HttpResponse {
    HttpResponse::build(status).json(serde_json::json!({
        "code": code,
        "msg": message,
    }))
}

use super::*;
use actix_web::http::header::{self, HeaderMap};
use actix_web::{web, HttpRequest, HttpResponse};
use ncm_api_rs::{ApiClient, ApiResponse, NcmError, Query};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

const ALLOWED_DOMAIN_OVERRIDES: &[&str] = &[
    "https://music.163.com",
    "https://interface.music.163.com",
    "https://interface3.music.163.com",
];

#[derive(Deserialize)]
struct NeteasePath {
    tail: String,
}

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/api/netease/{tail:.*}", web::get().to(handle_request))
        .route("/api/netease/{tail:.*}", web::post().to(handle_request));
}

async fn handle_request(
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

    let query = match extract_merged_query(req.headers(), req.uri().query(), &body, content_type) {
        Ok(query) => query,
        Err(err) => {
            return json_error(
                actix_web::http::StatusCode::BAD_REQUEST,
                400,
                &err,
            )
        }
    };

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
        "inner_version" => client
            .inner_version()
            .await
            .map_err(DispatchError::Ncm),
        "login" => client.login(query).await.map_err(DispatchError::Ncm),
        "login_cellphone" => client
            .login_cellphone(query)
            .await
            .map_err(DispatchError::Ncm),
        "login_qr_key" => client
            .login_qr_key(query)
            .await
            .map_err(DispatchError::Ncm),
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
        "login_status" => client
            .login_status(query)
            .await
            .map_err(DispatchError::Ncm),
        "logout" => client.logout(query).await.map_err(DispatchError::Ncm),
        "register_anonimous" => client
            .register_anonimous(query)
            .await
            .map_err(DispatchError::Ncm),
        "register_cellphone" => client
            .register_cellphone(query)
            .await
            .map_err(DispatchError::Ncm),
        "captcha_sent" => client
            .captcha_sent(query)
            .await
            .map_err(DispatchError::Ncm),
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
        "cloudsearch" => client
            .cloudsearch(query)
            .await
            .map_err(DispatchError::Ncm),
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
        "search_match" => client
            .search_match(query)
            .await
            .map_err(DispatchError::Ncm),
        "song_detail" => client
            .song_detail(query)
            .await
            .map_err(DispatchError::Ncm),
        "song_music_detail" => client
            .song_music_detail(query)
            .await
            .map_err(DispatchError::Ncm),
        "check_music" => client
            .check_music(query)
            .await
            .map_err(DispatchError::Ncm),
        "lyric" => client.lyric(query).await.map_err(DispatchError::Ncm),
        "lyric_new" => client
            .lyric_new(query)
            .await
            .map_err(DispatchError::Ncm),
        "album" => client.album(query).await.map_err(DispatchError::Ncm),
        "album_detail" => client
            .album_detail(query)
            .await
            .map_err(DispatchError::Ncm),
        "artist_detail" => client
            .artist_detail(query)
            .await
            .map_err(DispatchError::Ncm),
        "artists" => client.artists(query).await.map_err(DispatchError::Ncm),
        "song_url" => client
            .song_url(query)
            .await
            .map_err(DispatchError::Ncm),
        "song_url_v1" => client
            .song_url_v1(query)
            .await
            .map_err(DispatchError::Ncm),
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
        "playlist_hot" => client
            .playlist_hot(query)
            .await
            .map_err(DispatchError::Ncm),
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
        "toplist" => client
            .toplist(query)
            .await
            .map_err(DispatchError::Ncm),
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
        "top_playlist" => client
            .top_playlist(query)
            .await
            .map_err(DispatchError::Ncm),
        "top_playlist_highquality" => client
            .top_playlist_highquality(query)
            .await
            .map_err(DispatchError::Ncm),
        "top_list" => client
            .top_list(query)
            .await
            .map_err(DispatchError::Ncm),
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
        // -------- Phase 9: identity, user data chain, activity --------
        // Map directly to the ncm-api-rs methods called out in
        // .trellis/tasks/05-05-ncm-align-identity/research.md.
        "user_account" => client
            .user_account(query)
            .await
            .map_err(DispatchError::Ncm),
        "user_detail" => client
            .user_detail(query)
            .await
            .map_err(DispatchError::Ncm),
        "user_subcount" => client
            .user_subcount(query)
            .await
            .map_err(DispatchError::Ncm),
        "user_level" => client
            .user_level(query)
            .await
            .map_err(DispatchError::Ncm),
        "likelist" => client
            .likelist(query)
            .await
            .map_err(DispatchError::Ncm),
        "daily_signin" => client
            .daily_signin(query)
            .await
            .map_err(DispatchError::Ncm),
        "scrobble" => client
            .scrobble(query)
            .await
            .map_err(DispatchError::Ncm),
        "personalized" => client
            .personalized(query)
            .await
            .map_err(DispatchError::Ncm),
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
        "personal_fm" => client
            .personal_fm(query)
            .await
            .map_err(DispatchError::Ncm),
        "top_artists" => client
            .top_artists(query)
            .await
            .map_err(DispatchError::Ncm),
        "album_newest" => client
            .album_newest(query)
            .await
            .map_err(DispatchError::Ncm),
        "album_new" => client
            .album_new(query)
            .await
            .map_err(DispatchError::Ncm),
        "top_song" => client
            .top_song(query)
            .await
            .map_err(DispatchError::Ncm),
        "artist_list" => client
            .artist_list(query)
            .await
            .map_err(DispatchError::Ncm),
        "dj_personalize_recommend" => client
            .dj_personalize_recommend(query)
            .await
            .map_err(DispatchError::Ncm),
        "dj_recommend" => client
            .dj_recommend(query)
            .await
            .map_err(DispatchError::Ncm),
        "mv_first" => client
            .mv_first(query)
            .await
            .map_err(DispatchError::Ncm),
        _ => Err(DispatchError::UnsupportedRoute),
    }
}

fn normalize_route(raw: &str) -> String {
    raw.trim_matches('/').to_string()
}

fn route_to_method(route: &str) -> String {
    route.replace('/', "_")
}

fn extract_merged_query(
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

fn parse_body_params(body: &[u8], content_type: Option<&str>) -> Result<HashMap<String, String>, String> {
    let content_type = content_type.unwrap_or("");
    if content_type.contains("application/json") {
        parse_json_body(body)
    } else if content_type.contains("application/x-www-form-urlencoded") {
        let body_str = std::str::from_utf8(body)
            .map_err(|e| format!("Invalid form body encoding: {}", e))?;
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
    let value: Value = serde_json::from_slice(body)
        .map_err(|e| format!("Failed to parse JSON body: {}", e))?;
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

fn apply_query_overrides(query: &mut Query) -> Result<(), String> {
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

fn normalize_domain_override(raw: &str) -> Result<String, String> {
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
        return Err(format!(
            "Domain override not allowed: {}",
            normalized
        ));
    }

    Ok(normalized)
}

fn parse_bool(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn build_success_response(api_resp: ApiResponse) -> HttpResponse {
    let status = actix_web::http::StatusCode::from_u16(api_resp.status as u16)
        .unwrap_or(actix_web::http::StatusCode::OK);
    let mut builder = HttpResponse::build(status);

    for cookie_str in &api_resp.cookie {
        if let Ok(val) = header::HeaderValue::from_str(cookie_str) {
            builder.append_header((header::SET_COOKIE, val));
        }
    }

    // Mirror the joined cookie string into the JSON body so JS callers can
    // capture sessions even when the upstream sets HttpOnly cookies (which
    // `document.cookie` can't read). This is required for multi-account flows
    // — see `apps/desktop/src/shared/state/NcmAccountContext.tsx`.
    //
    // We never overwrite a `cookie` field already present in the body — some
    // upstream endpoints (e.g. `/login/qr/check`) populate it themselves.
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

/// Convert a list of raw `Set-Cookie` header values into the compact
/// `NAME1=VALUE1; NAME2=VALUE2` form expected by an outbound `Cookie` header.
///
/// We discard everything after the first `;` of each entry (Path/HttpOnly/etc)
/// and join the surviving `name=value` pairs with `"; "`.
fn join_cookie_pairs(set_cookies: &[String]) -> String {
    set_cookies
        .iter()
        .filter_map(|c| c.split(';').next().map(str::trim))
        .filter(|s| !s.is_empty() && s.contains('='))
        .collect::<Vec<_>>()
        .join("; ")
}

fn build_error_response(err: NcmError) -> HttpResponse {
    let (status, code, message) = match err {
        NcmError::AuthRequired(msg) => (
            actix_web::http::StatusCode::UNAUTHORIZED,
            301,
            msg,
        ),
        NcmError::InvalidParam(msg) => (
            actix_web::http::StatusCode::BAD_REQUEST,
            400,
            msg,
        ),
        NcmError::RateLimited(msg) => (
            actix_web::http::StatusCode::TOO_MANY_REQUESTS,
            503,
            msg,
        ),
        NcmError::Timeout(msg) => (
            actix_web::http::StatusCode::GATEWAY_TIMEOUT,
            504,
            msg,
        ),
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

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::http::{header::HeaderValue, StatusCode};
    use serde_json::json;

    fn header_map_with_cookie(cookie: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(header::COOKIE, HeaderValue::from_str(cookie).unwrap());
        headers
    }

    #[test]
    fn route_to_method_replaces_slashes() {
        assert_eq!(normalize_route("/login/qr/key/"), "login/qr/key");
        assert_eq!(route_to_method("login/qr/key"), "login_qr_key");
    }

    #[test]
    fn phase9_identity_routes_resolve_to_dispatch_keys() {
        // Every Phase 9 route below MUST land on a dispatch arm in `dispatch()`.
        // The mapping is `path → snake_case method name`. If you rename a
        // dispatch arm you must update both sides.
        let cases = [
            ("/user/account", "user_account"),
            ("/user/detail", "user_detail"),
            ("/user/subcount", "user_subcount"),
            ("/user/level", "user_level"),
            ("/likelist", "likelist"),
            ("/daily_signin", "daily_signin"),
            ("/scrobble", "scrobble"),
        ];
        for (path, expected) in cases {
            let normalized = normalize_route(path);
            let method = route_to_method(&normalized);
            assert_eq!(
                method, expected,
                "route {} should resolve to method {}",
                path, expected
            );
        }
    }

    #[test]
    fn home_feed_routes_resolve_to_dispatch_keys() {
        // Routes that power the Apple-Music-style recommend home feed. Each
        // pair must land on a dispatch arm in `dispatch()`.
        let cases = [
            ("/personalized", "personalized"),
            ("/personalized/newsong", "personalized_newsong"),
            ("/personalized/mv", "personalized_mv"),
            ("/personalized/djprogram", "personalized_djprogram"),
            ("/recommend/resource", "recommend_resource"),
            ("/recommend/songs", "recommend_songs"),
            ("/personal_fm", "personal_fm"),
            ("/top/artists", "top_artists"),
            ("/album/newest", "album_newest"),
            ("/dj/personalize/recommend", "dj_personalize_recommend"),
            ("/dj/recommend", "dj_recommend"),
            ("/mv/first", "mv_first"),
        ];
        for (path, expected) in cases {
            let normalized = normalize_route(path);
            let method = route_to_method(&normalized);
            assert_eq!(
                method, expected,
                "route {} should resolve to method {}",
                path, expected
            );
        }
    }

    #[test]
    fn splayer_discover_routes_resolve_to_dispatch_keys() {
        // SPlayer Discover tabs call these NCM endpoints:
        // playlists, toplists, artists, and newest music.
        let cases = [
            ("/top/playlist", "top_playlist"),
            ("/top/playlist/highquality", "top_playlist_highquality"),
            ("/toplist/detail", "toplist_detail"),
            ("/artist/list", "artist_list"),
            ("/album/new", "album_new"),
            ("/top/song", "top_song"),
        ];
        for (path, expected) in cases {
            let normalized = normalize_route(path);
            let method = route_to_method(&normalized);
            assert_eq!(
                method, expected,
                "route {} should resolve to method {}",
                path, expected
            );
        }
    }

    #[test]
    fn merged_query_prefers_body_then_cookie_param() {
        let headers = header_map_with_cookie("foo=header; other=1");
        let body = br#"{"foo":"body","cookie":"foo=param; traced=1","ua":"pc"}"#;
        let query = extract_merged_query(
            &headers,
            Some("foo=query&realIP=1.2.3.4"),
            body,
            Some("application/json"),
        )
        .expect("query should parse");

        assert_eq!(query.cookie.as_deref(), Some("foo=param; traced=1"));
        assert_eq!(query.real_ip.as_deref(), Some("1.2.3.4"));
        assert_eq!(query.ua.as_deref(), Some("pc"));
        assert_eq!(query.params.get("foo").map(String::as_str), Some("body"));
    }

    #[test]
    fn apply_query_overrides_extracts_known_fields() {
        let mut query = Query::new()
            .param("randomCNIP", "true")
            .param("proxy", "http://127.0.0.1:9000")
            .param("e_r", "1")
            .param("domain", "https://music.163.com");

        apply_query_overrides(&mut query).expect("overrides should parse");

        assert!(query.random_cn_ip);
        assert_eq!(query.proxy.as_deref(), Some("http://127.0.0.1:9000"));
        assert_eq!(query.e_r, Some(true));
        assert_eq!(query.domain.as_deref(), Some("https://music.163.com"));
        assert!(query.params.is_empty());
    }

    #[test]
    fn domain_override_requires_https_and_allowlist() {
        let http_err = normalize_domain_override("http://music.163.com")
            .expect_err("http should be rejected");
        assert!(http_err.contains("https"));

        let host_err = normalize_domain_override("https://example.com")
            .expect_err("non-allowlisted host should be rejected");
        assert!(host_err.contains("not allowed"));
    }

    #[actix_web::test]
    async fn success_response_forwards_set_cookie_headers() {
        let response = build_success_response(ApiResponse {
            status: 200,
            body: json!({ "code": 200 }),
            cookie: vec!["foo=bar; Path=/; HttpOnly".to_string()],
        });

        assert_eq!(response.status(), StatusCode::OK);
        let cookies: Vec<_> = response.headers().get_all(header::SET_COOKIE).collect();
        assert_eq!(cookies.len(), 1);
        assert_eq!(cookies[0].to_str().ok(), Some("foo=bar; Path=/; HttpOnly"));
    }

    #[actix_web::test]
    async fn success_response_injects_joined_cookie_into_body() {
        let response = build_success_response(ApiResponse {
            status: 200,
            body: json!({ "code": 200 }),
            cookie: vec![
                "MUSIC_U=abc123; Path=/; HttpOnly".to_string(),
                "MUSIC_A_T=def456; Path=/; HttpOnly".to_string(),
            ],
        });

        let bytes = actix_web::body::to_bytes(response.into_body())
            .await
            .expect("body should serialize");
        let parsed: Value = serde_json::from_slice(&bytes).expect("body is JSON");
        assert_eq!(
            parsed.get("cookie").and_then(Value::as_str),
            Some("MUSIC_U=abc123; MUSIC_A_T=def456"),
            "joined cookie pairs (without attributes) should appear in body"
        );
    }

    #[actix_web::test]
    async fn success_response_preserves_upstream_cookie_field() {
        // /login/qr/check populates `cookie` itself; we must not clobber it.
        let response = build_success_response(ApiResponse {
            status: 200,
            body: json!({ "code": 803, "cookie": "from_upstream=1" }),
            cookie: vec!["from_set_cookie=2; Path=/".to_string()],
        });

        let bytes = actix_web::body::to_bytes(response.into_body())
            .await
            .expect("body should serialize");
        let parsed: Value = serde_json::from_slice(&bytes).expect("body is JSON");
        assert_eq!(
            parsed.get("cookie").and_then(Value::as_str),
            Some("from_upstream=1"),
            "upstream-provided cookie field must take precedence"
        );
    }

    #[test]
    fn join_cookie_pairs_strips_attributes() {
        let cookies = vec![
            "MUSIC_U=abc; Path=/; HttpOnly; SameSite=Lax".to_string(),
            "MUSIC_A_T=def; Domain=.music.163.com; Secure".to_string(),
            "  ".to_string(),                       // whitespace -> dropped
            "garbage_no_equals; Path=/".to_string(), // no `=` -> dropped
        ];
        assert_eq!(
            join_cookie_pairs(&cookies),
            "MUSIC_U=abc; MUSIC_A_T=def"
        );
    }

    #[actix_web::test]
    async fn error_response_normalizes_invalid_param() {
        let response = build_error_response(NcmError::InvalidParam("bad input".to_string()));
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let body = actix_web::body::to_bytes(response.into_body())
            .await
            .expect("body should serialize");
        assert_eq!(body, br#"{"code":400,"msg":"bad input"}"#.as_slice());
    }
}

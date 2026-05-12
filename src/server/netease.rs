use super::lyrics::{self, LyricLineDto};
use super::*;
use crate::app_database::{NcmAccountRecord, NcmAccountUpsert};
use actix_web::http::header::{self, HeaderMap};
use actix_web::{web, HttpRequest, HttpResponse};
use ncm_api_rs::{ApiClient, ApiResponse, NcmError, Query};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

const ALLOWED_DOMAIN_OVERRIDES: &[&str] = &[
    "https://music.163.com",
    "https://interface.music.163.com",
    "https://interface3.music.163.com",
];
const RADAR_PLAYLIST_IDS: &[i64] = &[
    3136952023, 8402996200, 5320167908, 5327906368, 5362359247, 5300458264, 5341776086,
];

#[derive(Deserialize)]
struct NeteasePath {
    tail: String,
}

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.route(
        "/domain/ncm/track/resolve",
        web::post().to(resolve_ncm_track),
    )
    .route(
        "/domain/ncm/track/supplement",
        web::post().to(resolve_ncm_track_supplement),
    )
    .route("/domain/ncm/home_feed", web::post().to(get_ncm_home_feed))
    .route(
        "/domain/ncm/discover/playlists",
        web::post().to(list_ncm_discover_playlists),
    )
    .route(
        "/domain/ncm/discover/albums",
        web::post().to(list_ncm_discover_albums),
    )
    .route(
        "/domain/ncm/discover/artists",
        web::post().to(list_ncm_discover_artists),
    )
    .route(
        "/domain/ncm/discover/toplists",
        web::post().to(list_ncm_discover_toplists),
    )
    .route(
        "/domain/ncm/discover/songs",
        web::post().to(list_ncm_discover_songs),
    )
    .route(
        "/domain/ncm/discover/playlist_categories",
        web::post().to(get_ncm_discover_playlist_categories),
    )
    .route("/domain/ncm/accounts", web::get().to(list_ncm_accounts))
    .route("/domain/ncm/accounts", web::post().to(upsert_ncm_account))
    .route(
        "/domain/ncm/accounts/active",
        web::post().to(set_active_ncm_account),
    )
    .route(
        "/domain/ncm/accounts/refresh",
        web::post().to(refresh_active_ncm_account),
    )
    .route(
        "/domain/ncm/accounts/logout",
        web::post().to(logout_active_ncm_account),
    )
    .route(
        "/domain/ncm/accounts/daily_signin",
        web::post().to(daily_signin_active_ncm_account),
    )
    .route(
        "/domain/ncm/user/playlists",
        web::post().to(list_ncm_user_playlists),
    )
    .route(
        "/domain/ncm/search/tracks",
        web::post().to(search_ncm_tracks),
    )
    .route(
        "/domain/ncm/search/playlists",
        web::post().to(search_ncm_playlists),
    )
    .route(
        "/domain/ncm/playlist/tracks",
        web::post().to(list_ncm_playlist_tracks),
    )
    .route(
        "/domain/ncm/recommend/songs/tracks",
        web::post().to(list_ncm_daily_song_tracks),
    )
    .route(
        "/domain/ncm/song/details/tracks",
        web::post().to(list_ncm_song_detail_tracks),
    )
    .route(
        "/domain/ncm/personal_fm/tracks",
        web::post().to(list_ncm_personal_fm_tracks),
    )
    .route(
        "/domain/ncm/album/tracks",
        web::post().to(list_ncm_album_tracks),
    )
    .route(
        "/domain/ncm/artist/tracks",
        web::post().to(list_ncm_artist_tracks),
    )
    .route(
        "/domain/ncm/user/likelist",
        web::post().to(list_ncm_likelist_ids),
    )
    .route(
        "/domain/ncm/accounts/{user_id}",
        web::delete().to(delete_ncm_account),
    )
    .route("/api/netease/{tail:.*}", web::get().to(handle_request))
    .route("/api/netease/{tail:.*}", web::post().to(handle_request));
}

#[derive(Deserialize)]
struct ResolveNcmTrackRequest {
    song_id: i64,
    level: Option<String>,
    cookie: Option<String>,
    source_page_url: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration_secs: Option<f64>,
    artwork_url: Option<String>,
}

#[derive(Deserialize)]
struct ResolveNcmTrackSupplementRequest {
    song_id: i64,
    cookie: Option<String>,
}

#[derive(Deserialize)]
struct HomeFeedRequest {
    user_id: Option<i64>,
}

#[derive(Deserialize)]
struct DiscoverPlaylistsRequest {
    cat: Option<String>,
    kind: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    before: Option<i64>,
}

#[derive(Deserialize)]
struct DiscoverAlbumsRequest {
    area: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Deserialize)]
struct DiscoverArtistsRequest {
    #[serde(rename = "type")]
    artist_type: Option<i64>,
    area: Option<i64>,
    initial: Option<Value>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Deserialize)]
struct DiscoverSongsRequest {
    #[serde(rename = "type")]
    song_type: Option<i64>,
}

#[derive(Deserialize)]
struct UpsertNcmAccountRequest {
    user_id: i64,
    nickname: Option<String>,
    avatar_url: Option<String>,
    cookie: String,
    vip_type: Option<i64>,
    level: Option<i64>,
    signin_at_ms: Option<i64>,
}

#[derive(Deserialize)]
struct ActiveNcmAccountRequest {
    user_id: i64,
}

#[derive(Deserialize)]
struct NcmAccountPath {
    user_id: i64,
}

#[derive(Deserialize)]
struct UserPlaylistsRequest {
    uid: i64,
    limit: Option<i64>,
    offset: Option<i64>,
    mode: Option<String>,
}

#[derive(Deserialize)]
struct SearchTracksRequest {
    keywords: String,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Deserialize)]
struct PlaylistTracksRequest {
    id: i64,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Deserialize)]
struct EntityTracksRequest {
    id: i64,
}

#[derive(Deserialize)]
struct SongDetailTracksRequest {
    ids: Vec<i64>,
}

#[derive(Deserialize)]
struct LikelistRequest {
    uid: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct ResolvedNcmTrack {
    song_id: i64,
    stream_url: String,
    source_page_url: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    cover_url: Option<String>,
    duration_secs: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct ResolvedNcmTrackSupplement {
    song_id: i64,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    cover_url: Option<String>,
    lyrics: Vec<LyricLineDto>,
    detail_error: Option<String>,
    lyrics_error: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
struct NcmTrackDetail {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    cover_url: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
struct NcmProfileSnapshot {
    user_id: i64,
    nickname: Option<String>,
    avatar_url: Option<String>,
    vip_type: Option<i64>,
    level: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct NcmPlaylistSummary {
    id: i64,
    name: String,
    creator: Option<String>,
    cover_url: Option<String>,
    track_count: Option<i64>,
    subscribed: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct NcmTrackSummary {
    id: String,
    song_id: i64,
    source_path: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration_secs: Option<f64>,
    artwork_url: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
struct NcmHomeFeed {
    daily_picks: Vec<NcmHomeFeedCard>,
    daily_song_covers: Vec<NcmHomeTrackCover>,
    liked_song_covers: Vec<NcmHomeTrackCover>,
    personal_fm_covers: Vec<NcmHomeTrackCover>,
    personal_fm_preview: Option<NcmHomePersonalFmPreview>,
    radar_playlists: Vec<NcmHomeFeedCard>,
    recommended_playlists: Vec<NcmHomeFeedCard>,
    new_albums: Vec<NcmHomeFeedCard>,
    featured_artists: Vec<NcmHomeFeedCard>,
    recommended_mvs: Vec<NcmHomeFeedCard>,
    podcasts: Vec<NcmHomeFeedCard>,
    errors: Vec<NcmHomeFeedError>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct NcmHomeFeedCard {
    id: i64,
    title: String,
    subtitle: Option<String>,
    cover_url: Option<String>,
    play_count: Option<f64>,
    description: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct NcmHomeTrackCover {
    id: i64,
    url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct NcmHomePersonalFmPreview {
    title: String,
    artist: Option<String>,
    album: Option<String>,
    cover_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct NcmHomeFeedError {
    section: String,
    message: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct NcmDiscoverCard {
    id: i64,
    title: String,
    subtitle: Option<String>,
    cover_url: Option<String>,
    cursor: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct NcmDiscoverToplistTrack {
    title: String,
    artist: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct NcmDiscoverToplist {
    id: i64,
    title: String,
    subtitle: Option<String>,
    description: Option<String>,
    cover_url: Option<String>,
    tracks: Vec<NcmDiscoverToplistTrack>,
    is_official: bool,
    cursor: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
struct NcmDiscoverPlaylistCategories {
    categories: HashMap<i64, String>,
    entries: Vec<NcmDiscoverPlaylistCategoryEntry>,
    hq_names: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct NcmDiscoverPlaylistCategoryEntry {
    name: String,
    category: i64,
    hot: bool,
}

async fn list_ncm_accounts(data: web::Data<Arc<AppState>>) -> HttpResponse {
    match data.app_db.list_ncm_accounts() {
        Ok((accounts, active_user_id)) => account_state_response(accounts, active_user_id),
        Err(err) => HttpResponse::InternalServerError().json(serde_json::json!({
            "status": "error",
            "message": err
        })),
    }
}

async fn upsert_ncm_account(
    data: web::Data<Arc<AppState>>,
    body: web::Json<UpsertNcmAccountRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    if request.user_id <= 0 {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "status": "error",
            "message": "NCM user id must be positive"
        }));
    }
    let input = NcmAccountUpsert {
        user_id: request.user_id,
        nickname: request.nickname,
        avatar_url: request.avatar_url,
        cookie: request.cookie,
        vip_type: request.vip_type,
        level: request.level,
        signin_at_ms: request.signin_at_ms,
    };

    match data.app_db.upsert_ncm_account(&input) {
        Ok(_) => list_ncm_accounts(data).await,
        Err(err) => HttpResponse::InternalServerError().json(serde_json::json!({
            "status": "error",
            "message": err
        })),
    }
}

async fn set_active_ncm_account(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ActiveNcmAccountRequest>,
) -> HttpResponse {
    match data.app_db.set_active_ncm_account(body.user_id) {
        Ok(account) => {
            refresh_account_with_ncm(&data, &account, false).await;
            list_ncm_accounts(data).await
        }
        Err(err) => HttpResponse::NotFound().json(serde_json::json!({
            "status": "error",
            "message": err
        })),
    }
}

async fn refresh_active_ncm_account(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let account = match data.app_db.active_ncm_account() {
        Ok(Some(account)) => account,
        Ok(None) => {
            return HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "accounts": [],
                "active_user_id": null
            }));
        }
        Err(err) => {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "status": "error",
                "message": err
            }));
        }
    };

    refresh_account_with_ncm(&data, &account, true).await;
    list_ncm_accounts(data).await
}

async fn logout_active_ncm_account(data: web::Data<Arc<AppState>>) -> HttpResponse {
    if let Ok(Some(account)) = data.app_db.active_ncm_account() {
        if let Some(cookie) = non_empty_cookie(&account.cookie) {
            let query = Query::new().cookie(&cookie);
            if let Err(err) = data.ncm_client.logout(&query).await {
                log::warn!("NCM logout for user {} failed: {}", account.user_id, err);
            }
        }
        if let Err(err) = data.app_db.delete_ncm_account(account.user_id) {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "status": "error",
                "message": err
            }));
        }
    }
    list_ncm_accounts(data).await
}

async fn daily_signin_active_ncm_account(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let account = match data.app_db.active_ncm_account() {
        Ok(Some(account)) => account,
        Ok(None) => {
            return HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "accounts": [],
                "active_user_id": null
            }));
        }
        Err(err) => {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "status": "error",
                "message": err
            }));
        }
    };

    let Some(cookie) = non_empty_cookie(&account.cookie) else {
        return list_ncm_accounts(data).await;
    };

    let query = Query::new().cookie(&cookie).param("type", "0");
    match data.ncm_client.daily_signin(&query).await {
        Ok(_) => {
            if let Err(err) = data.app_db.mark_ncm_account_signed_in(account.user_id) {
                return HttpResponse::InternalServerError().json(serde_json::json!({
                    "status": "error",
                    "message": err
                }));
            }
        }
        Err(err) => {
            log::warn!(
                "NCM daily signin for user {} failed: {}",
                account.user_id,
                err
            );
            return build_error_response(err);
        }
    }

    list_ncm_accounts(data).await
}

async fn delete_ncm_account(
    data: web::Data<Arc<AppState>>,
    path: web::Path<NcmAccountPath>,
) -> HttpResponse {
    match data.app_db.delete_ncm_account(path.user_id) {
        Ok(()) => list_ncm_accounts(data).await,
        Err(err) => HttpResponse::InternalServerError().json(serde_json::json!({
            "status": "error",
            "message": err
        })),
    }
}

async fn list_ncm_user_playlists(
    data: web::Data<Arc<AppState>>,
    body: web::Json<UserPlaylistsRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    if request.uid <= 0 {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "status": "error",
            "message": "NCM user id must be positive"
        }));
    }

    let mut query = Query::new().param("uid", &request.uid.to_string());
    if let Some(limit) = request.limit.filter(|value| *value > 0) {
        query = query.param("limit", &limit.to_string());
    }
    if let Some(offset) = request.offset.filter(|value| *value >= 0) {
        query = query.param("offset", &offset.to_string());
    }
    if let Some(cookie) = active_ncm_cookie(&data) {
        query.cookie = Some(cookie);
    }

    match data.ncm_client.user_playlist(&query).await {
        Ok(response) => {
            let mode =
                request.mode.as_deref().map(str::trim).filter(|value| {
                    *value == "created-playlists" || *value == "collected-playlists"
                });
            let playlists = filter_playlist_summaries(read_user_playlists(&response.body), mode);
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "playlists": playlists
            }))
        }
        Err(err) => build_error_response(err),
    }
}

async fn get_ncm_home_feed(
    data: web::Data<Arc<AppState>>,
    body: web::Json<HomeFeedRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    if request.user_id.is_some_and(|user_id| user_id <= 0) {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "status": "error",
            "message": "NCM user id must be positive"
        }));
    }

    let active_cookie = active_ncm_cookie(&data);
    let mut feed = NcmHomeFeed::default();

    if request.user_id.is_some() && active_cookie.is_some() {
        let mut query = Query::new();
        attach_cookie(&mut query, active_cookie.as_deref());
        match data.ncm_client.recommend_resource(&query).await {
            Ok(response) => feed.daily_picks = read_recommend_resource_cards(&response.body),
            Err(err) => push_home_feed_error(&mut feed.errors, "daily_picks", err),
        }

        let mut query = Query::new();
        attach_cookie(&mut query, active_cookie.as_deref());
        match data.ncm_client.recommend_songs(&query).await {
            Ok(response) => {
                let tracks = read_daily_song_tracks(&response.body);
                feed.daily_song_covers = track_covers(&tracks);
            }
            Err(err) => push_home_feed_error(&mut feed.errors, "daily_song_covers", err),
        }

        if let Some(user_id) = request.user_id {
            let mut query = Query::new().param("uid", &user_id.to_string());
            attach_cookie(&mut query, active_cookie.as_deref());
            match data.ncm_client.likelist(&query).await {
                Ok(response) => {
                    let ids = read_likelist_ids(&response.body);
                    if !ids.is_empty() {
                        let mut detail_query = Query::new().param(
                            "ids",
                            &ids.iter()
                                .take(9)
                                .map(i64::to_string)
                                .collect::<Vec<_>>()
                                .join(","),
                        );
                        attach_cookie(&mut detail_query, active_cookie.as_deref());
                        match data.ncm_client.song_detail(&detail_query).await {
                            Ok(detail_response) => {
                                let tracks = read_song_detail_tracks(&detail_response.body);
                                feed.liked_song_covers = track_covers(&tracks);
                            }
                            Err(err) => {
                                push_home_feed_error(&mut feed.errors, "liked_song_covers", err)
                            }
                        }
                    }
                }
                Err(err) => push_home_feed_error(&mut feed.errors, "liked_song_covers", err),
            }
        }

        let mut query = Query::new();
        attach_cookie(&mut query, active_cookie.as_deref());
        match data.ncm_client.personal_fm(&query).await {
            Ok(response) => {
                let tracks = read_personal_fm_tracks(&response.body);
                feed.personal_fm_covers = track_covers(&tracks);
                feed.personal_fm_preview = personal_fm_preview(&tracks);
            }
            Err(err) => push_home_feed_error(&mut feed.errors, "personal_fm", err),
        }
    }

    for playlist_id in RADAR_PLAYLIST_IDS {
        let mut query = Query::new().param("id", &playlist_id.to_string());
        attach_cookie(&mut query, active_cookie.as_deref());
        match data.ncm_client.playlist_detail(&query).await {
            Ok(response) => {
                if let Some(card) = read_radar_playlist_card(&response.body) {
                    feed.radar_playlists.push(card);
                }
            }
            Err(err) => push_home_feed_error(&mut feed.errors, "radar_playlists", err),
        }
    }

    let mut query = Query::new().param("limit", "21");
    attach_cookie(&mut query, active_cookie.as_deref());
    match data.ncm_client.personalized(&query).await {
        Ok(response) => {
            feed.recommended_playlists = read_personalized_playlist_cards(&response.body)
                .into_iter()
                .filter(|item| !item.title.contains("雷达"))
                .collect();
        }
        Err(err) => push_home_feed_error(&mut feed.errors, "recommended_playlists", err),
    }

    let mut query = Query::new().param("limit", "12");
    attach_cookie(&mut query, active_cookie.as_deref());
    match data.ncm_client.album_newest(&query).await {
        Ok(response) => feed.new_albums = read_newest_album_cards(&response.body),
        Err(err) => push_home_feed_error(&mut feed.errors, "new_albums", err),
    }

    let mut query = Query::new().param("limit", "10");
    attach_cookie(&mut query, active_cookie.as_deref());
    match data.ncm_client.top_artists(&query).await {
        Ok(response) => feed.featured_artists = read_top_artist_cards(&response.body),
        Err(err) => push_home_feed_error(&mut feed.errors, "featured_artists", err),
    }

    let mut query = Query::new();
    attach_cookie(&mut query, active_cookie.as_deref());
    match data.ncm_client.personalized_mv(&query).await {
        Ok(response) => feed.recommended_mvs = read_personalized_mv_cards(&response.body),
        Err(err) => push_home_feed_error(&mut feed.errors, "recommended_mvs", err),
    }

    let mut query = Query::new();
    attach_cookie(&mut query, active_cookie.as_deref());
    match data.ncm_client.personalized_djprogram(&query).await {
        Ok(response) => feed.podcasts = read_personalized_dj_cards(&response.body),
        Err(err) => push_home_feed_error(&mut feed.errors, "podcasts", err),
    }

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "feed": feed
    }))
}

async fn list_ncm_discover_playlists(
    data: web::Data<Arc<AppState>>,
    body: web::Json<DiscoverPlaylistsRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    let kind = request
        .kind
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("normal");
    if kind != "normal" && kind != "hq" {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "status": "error",
            "message": "NCM discover playlist kind must be normal or hq"
        }));
    }

    let cat = request
        .cat
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("全部歌单");
    let limit = request.limit.filter(|value| *value > 0).unwrap_or(50);
    let offset = request.offset.filter(|value| *value >= 0).unwrap_or(0);
    let mut query = Query::new()
        .param("cat", cat)
        .param("limit", &limit.to_string());
    if kind == "hq" {
        if let Some(before) = request.before.filter(|value| *value > 0) {
            query = query.param("before", &before.to_string());
        }
    } else {
        query = query
            .param("order", "hot")
            .param("offset", &offset.to_string());
    }
    inject_active_ncm_cookie(&data, &mut query);

    let result = if kind == "hq" {
        data.ncm_client.top_playlist_highquality(&query).await
    } else {
        data.ncm_client.top_playlist(&query).await
    };

    match result {
        Ok(response) => {
            let items = read_discover_playlist_cards(&response.body);
            let has_more = read_page_has_more(&response.body, limit, offset, items.len());
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "items": items,
                "has_more": has_more
            }))
        }
        Err(err) => build_error_response(err),
    }
}

async fn list_ncm_discover_albums(
    data: web::Data<Arc<AppState>>,
    body: web::Json<DiscoverAlbumsRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    let area = request
        .area
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("ALL");
    let limit = request.limit.filter(|value| *value > 0).unwrap_or(50);
    let offset = request.offset.filter(|value| *value >= 0).unwrap_or(0);
    let mut query = Query::new()
        .param("area", area)
        .param("limit", &limit.to_string())
        .param("offset", &offset.to_string());
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.album_new(&query).await {
        Ok(response) => {
            let items = read_discover_album_cards(&response.body);
            let has_more = read_page_has_more(&response.body, limit, offset, items.len());
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "items": items,
                "has_more": has_more
            }))
        }
        Err(err) => build_error_response(err),
    }
}

async fn list_ncm_discover_artists(
    data: web::Data<Arc<AppState>>,
    body: web::Json<DiscoverArtistsRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    let limit = request.limit.filter(|value| *value > 0).unwrap_or(50);
    let offset = request.offset.filter(|value| *value >= 0).unwrap_or(0);
    let mut query = Query::new()
        .param("type", &request.artist_type.unwrap_or(-1).to_string())
        .param("area", &request.area.unwrap_or(-1).to_string())
        .param("limit", &limit.to_string())
        .param("offset", &offset.to_string());
    if let Some(initial) = request.initial.as_ref().and_then(discover_initial_param) {
        query = query.param("initial", &initial);
    }
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.artist_list(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "items": read_discover_artist_cards(&response.body)
        })),
        Err(err) => build_error_response(err),
    }
}

async fn list_ncm_discover_toplists(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let mut query = Query::new();
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.toplist_detail(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "toplists": read_discover_toplists(&response.body)
        })),
        Err(err) => build_error_response(err),
    }
}

async fn list_ncm_discover_songs(
    data: web::Data<Arc<AppState>>,
    body: web::Json<DiscoverSongsRequest>,
) -> HttpResponse {
    let song_type = body.song_type.unwrap_or(0);
    if !matches!(song_type, 0 | 7 | 96 | 16 | 8) {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "status": "error",
            "message": "NCM discover song type is invalid"
        }));
    }

    let mut query = Query::new().param("type", &song_type.to_string());
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.top_song(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "tracks": read_top_song_tracks(&response.body)
        })),
        Err(err) => build_error_response(err),
    }
}

async fn get_ncm_discover_playlist_categories(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let mut cat_query = Query::new();
    let mut hq_query = Query::new();
    inject_active_ncm_cookie(&data, &mut cat_query);
    inject_active_ncm_cookie(&data, &mut hq_query);

    let (cat_result, hq_result) = tokio::join!(
        data.ncm_client.playlist_catlist(&cat_query),
        data.ncm_client.playlist_highquality_tags(&hq_query)
    );

    let cat_response = match cat_result {
        Ok(response) => response,
        Err(err) => return build_error_response(err),
    };
    let hq_body = match hq_result {
        Ok(response) => response.body,
        Err(err) => {
            log::warn!("NCM discover highquality tags failed: {}", err);
            serde_json::json!({})
        }
    };

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "categories": read_discover_playlist_categories(&cat_response.body, &hq_body)
    }))
}

async fn search_ncm_tracks(
    data: web::Data<Arc<AppState>>,
    body: web::Json<SearchTracksRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    let keywords = request.keywords.trim();
    if keywords.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "status": "error",
            "message": "NCM search keywords must not be empty"
        }));
    }

    let mut query = Query::new().param("keywords", keywords).param("type", "1");
    if let Some(limit) = request.limit.filter(|value| *value > 0) {
        query = query.param("limit", &limit.to_string());
    }
    if let Some(offset) = request.offset.filter(|value| *value >= 0) {
        query = query.param("offset", &offset.to_string());
    }
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.search(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "tracks": read_search_tracks(&response.body)
        })),
        Err(err) => build_error_response(err),
    }
}

async fn search_ncm_playlists(
    data: web::Data<Arc<AppState>>,
    body: web::Json<SearchTracksRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    let keywords = request.keywords.trim();
    if keywords.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "status": "error",
            "message": "NCM search keywords must not be empty"
        }));
    }

    let mut query = Query::new()
        .param("keywords", keywords)
        .param("type", "1000");
    if let Some(limit) = request.limit.filter(|value| *value > 0) {
        query = query.param("limit", &limit.to_string());
    }
    if let Some(offset) = request.offset.filter(|value| *value >= 0) {
        query = query.param("offset", &offset.to_string());
    }
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.search(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "playlists": read_search_playlists(&response.body)
        })),
        Err(err) => build_error_response(err),
    }
}

async fn list_ncm_playlist_tracks(
    data: web::Data<Arc<AppState>>,
    body: web::Json<PlaylistTracksRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    if request.id <= 0 {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "status": "error",
            "message": "NCM playlist id must be positive"
        }));
    }

    let mut query = Query::new().param("id", &request.id.to_string());
    if let Some(limit) = request.limit.filter(|value| *value > 0) {
        query = query.param("limit", &limit.to_string());
    }
    if let Some(offset) = request.offset.filter(|value| *value >= 0) {
        query = query.param("offset", &offset.to_string());
    }
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.playlist_track_all(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "tracks": read_playlist_tracks(&response.body)
        })),
        Err(err) => build_error_response(err),
    }
}

async fn list_ncm_daily_song_tracks(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let mut query = Query::new();
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.recommend_songs(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "tracks": read_daily_song_tracks(&response.body)
        })),
        Err(err) => build_error_response(err),
    }
}

async fn list_ncm_song_detail_tracks(
    data: web::Data<Arc<AppState>>,
    body: web::Json<SongDetailTracksRequest>,
) -> HttpResponse {
    let ids = body
        .ids
        .iter()
        .copied()
        .filter(|id| *id > 0)
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "status": "error",
            "message": "NCM song ids must include at least one positive id"
        }));
    }

    let mut query = Query::new().param(
        "ids",
        &ids.iter().map(i64::to_string).collect::<Vec<_>>().join(","),
    );
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.song_detail(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "tracks": read_song_detail_tracks(&response.body)
        })),
        Err(err) => build_error_response(err),
    }
}

async fn list_ncm_personal_fm_tracks(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let mut query = Query::new();
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.personal_fm(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "tracks": read_personal_fm_tracks(&response.body)
        })),
        Err(err) => build_error_response(err),
    }
}

async fn list_ncm_album_tracks(
    data: web::Data<Arc<AppState>>,
    body: web::Json<EntityTracksRequest>,
) -> HttpResponse {
    let id = body.id;
    if id <= 0 {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "status": "error",
            "message": "NCM album id must be positive"
        }));
    }

    let mut query = Query::new().param("id", &id.to_string());
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.album(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "tracks": read_song_detail_tracks(&response.body)
        })),
        Err(err) => build_error_response(err),
    }
}

async fn list_ncm_artist_tracks(
    data: web::Data<Arc<AppState>>,
    body: web::Json<EntityTracksRequest>,
) -> HttpResponse {
    let id = body.id;
    if id <= 0 {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "status": "error",
            "message": "NCM artist id must be positive"
        }));
    }

    let mut query = Query::new().param("id", &id.to_string());
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.artists(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "tracks": read_artist_tracks(&response.body)
        })),
        Err(err) => build_error_response(err),
    }
}

async fn list_ncm_likelist_ids(
    data: web::Data<Arc<AppState>>,
    body: web::Json<LikelistRequest>,
) -> HttpResponse {
    let uid = body.uid;
    if uid <= 0 {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "status": "error",
            "message": "NCM user id must be positive"
        }));
    }

    let mut query = Query::new().param("uid", &uid.to_string());
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.likelist(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "ids": read_likelist_ids(&response.body)
        })),
        Err(err) => build_error_response(err),
    }
}

async fn resolve_ncm_track(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ResolveNcmTrackRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    if request.song_id <= 0 {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "status": "error",
            "message": "NCM song id must be positive"
        }));
    }

    let level = request
        .level
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("exhigh");
    let cookie = request
        .cookie
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| active_ncm_cookie(&data));

    let mut url_query = Query::new()
        .param("id", &request.song_id.to_string())
        .param("level", level);
    let mut detail_query = Query::new().param("ids", &request.song_id.to_string());
    if let Some(cookie) = cookie.as_deref() {
        url_query.cookie = Some(cookie.to_string());
        detail_query.cookie = Some(cookie.to_string());
    }

    let start = std::time::Instant::now();
    let (url_result, detail_result) = tokio::join!(
        data.ncm_client.song_url_v1(&url_query),
        data.ncm_client.song_detail(&detail_query)
    );

    let url_response = match url_result {
        Ok(response) => response,
        Err(err) => {
            log::warn!(
                "NCM resolve track {} URL -> ERROR: {} ({:.1?})",
                request.song_id,
                err,
                start.elapsed()
            );
            return build_error_response(err);
        }
    };

    let stream_url = match read_song_url(&url_response.body) {
        Some(url) => match super::validate_path(&url) {
            Ok(value) => value,
            Err(err) => {
                return HttpResponse::BadGateway().json(serde_json::json!({
                    "status": "error",
                    "message": format!("NCM song URL rejected: {}", err)
                }));
            }
        },
        None => {
            return HttpResponse::BadGateway().json(serde_json::json!({
                "status": "error",
                "message": "NCM song URL unavailable"
            }));
        }
    };

    let detail = match detail_result {
        Ok(response) => read_song_detail(&response.body, request.song_id),
        Err(err) => {
            log::warn!(
                "NCM resolve track {} detail -> ERROR: {} ({:.1?})",
                request.song_id,
                err,
                start.elapsed()
            );
            None
        }
    }
    .unwrap_or_default();

    let track = ResolvedNcmTrack {
        song_id: request.song_id,
        stream_url,
        source_page_url: request.source_page_url,
        title: detail.title.or(request.title),
        artist: detail.artist.or(request.artist),
        album: detail.album.or(request.album),
        cover_url: detail.cover_url.or(request.artwork_url),
        duration_secs: request.duration_secs,
    };

    if let Err(err) = data.app_db.record_external_media_metadata(
        &track.stream_url,
        track.title.as_deref(),
        track.artist.as_deref(),
        track.album.as_deref(),
        track.duration_secs,
        track.cover_url.as_deref(),
    ) {
        log::warn!(
            "Failed to persist NCM metadata for song {}: {}",
            track.song_id,
            err
        );
    }
    if let Err(err) = data.app_db.record_ncm_track_source(
        &track.stream_url,
        track.song_id,
        Some(track.source_page_url.as_str()),
    ) {
        log::warn!(
            "Failed to persist NCM track source for song {}: {}",
            track.song_id,
            err
        );
    }

    log::info!(
        "NCM resolve track {} -> OK ({:.1?})",
        track.song_id,
        start.elapsed()
    );

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "track": track
    }))
}

async fn resolve_ncm_track_supplement(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ResolveNcmTrackSupplementRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    if request.song_id <= 0 {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "status": "error",
            "message": "NCM song id must be positive"
        }));
    }

    let cookie = request
        .cookie
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| active_ncm_cookie(&data));
    let mut detail_query = Query::new().param("ids", &request.song_id.to_string());
    let mut lyrics_query = Query::new().param("id", &request.song_id.to_string());
    if let Some(cookie) = cookie.as_deref() {
        detail_query.cookie = Some(cookie.to_string());
        lyrics_query.cookie = Some(cookie.to_string());
    }

    let start = std::time::Instant::now();
    let (detail_result, lyrics_result) = tokio::join!(
        data.ncm_client.song_detail(&detail_query),
        data.ncm_client.lyric_new(&lyrics_query)
    );

    let (detail, detail_error) = match detail_result {
        Ok(response) => (read_song_detail(&response.body, request.song_id), None),
        Err(err) => {
            let message = err.to_string();
            log::warn!(
                "NCM supplement track {} detail -> ERROR: {} ({:.1?})",
                request.song_id,
                message,
                start.elapsed()
            );
            (None, Some(message))
        }
    };
    let (lyrics, lyrics_error) = match lyrics_result {
        Ok(response) => (lyrics::read_lyric_lines_from_payload(&response.body), None),
        Err(err) => {
            let message = err.to_string();
            log::warn!(
                "NCM supplement track {} lyrics -> ERROR: {} ({:.1?})",
                request.song_id,
                message,
                start.elapsed()
            );
            (Vec::new(), Some(message))
        }
    };
    let detail = detail.unwrap_or_default();

    log::info!(
        "NCM supplement track {} -> OK ({:.1?})",
        request.song_id,
        start.elapsed()
    );

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "supplement": ResolvedNcmTrackSupplement {
            song_id: request.song_id,
            title: detail.title,
            artist: detail.artist,
            album: detail.album,
            cover_url: detail.cover_url,
            lyrics,
            detail_error,
            lyrics_error,
        }
    }))
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
        // -------- Phase 9: identity, user data chain, activity --------
        // Map directly to the ncm-api-rs methods called out in
        // .trellis/tasks/05-05-ncm-align-identity/research.md.
        "user_account" => client.user_account(query).await.map_err(DispatchError::Ncm),
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
        "dj_recommend" => client.dj_recommend(query).await.map_err(DispatchError::Ncm),
        "mv_first" => client.mv_first(query).await.map_err(DispatchError::Ncm),
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

fn read_song_url(payload: &Value) -> Option<String> {
    payload
        .get("data")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("url"))
        .and_then(read_non_empty_string)
}

fn read_song_detail(payload: &Value, fallback_song_id: i64) -> Option<NcmTrackDetail> {
    let songs = payload.get("songs")?.as_array()?;
    let target = songs
        .iter()
        .find(|song| {
            song.get("id")
                .and_then(Value::as_i64)
                .is_some_and(|id| id == fallback_song_id)
        })
        .or_else(|| songs.first())?;
    let album = target
        .get("al")
        .and_then(Value::as_object)
        .or_else(|| target.get("album").and_then(Value::as_object));

    Some(NcmTrackDetail {
        title: target.get("name").and_then(read_non_empty_string),
        artist: read_artists(target.get("ar"))
            .or_else(|| read_artists(target.get("artists")))
            .or_else(|| {
                target
                    .get("artist")
                    .and_then(|artist| artist.get("name"))
                    .and_then(read_non_empty_string)
            }),
        album: album
            .and_then(|album| album.get("name"))
            .and_then(read_non_empty_string),
        cover_url: album
            .and_then(|album| album.get("picUrl"))
            .and_then(read_non_empty_string)
            .or_else(|| target.get("picUrl").and_then(read_non_empty_string)),
    })
}

fn read_non_empty_string(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn read_artists(value: Option<&Value>) -> Option<String> {
    let names = value?
        .as_array()?
        .iter()
        .filter_map(|item| item.get("name").and_then(read_non_empty_string))
        .collect::<Vec<_>>();
    if names.is_empty() {
        None
    } else {
        Some(names.join(", "))
    }
}

fn account_state_response(
    accounts: Vec<NcmAccountRecord>,
    active_user_id: Option<i64>,
) -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "accounts": accounts,
        "active_user_id": active_user_id
    }))
}

async fn refresh_account_with_ncm(
    data: &web::Data<Arc<AppState>>,
    account: &NcmAccountRecord,
    refresh_login_first: bool,
) {
    let Some(cookie) = non_empty_cookie(&account.cookie) else {
        return;
    };
    let query = Query::new().cookie(&cookie);

    if refresh_login_first {
        if let Err(err) = data.ncm_client.login_refresh(&query).await {
            log::warn!(
                "NCM login refresh for user {} failed: {}",
                account.user_id,
                err
            );
        }
    }

    match data.ncm_client.user_account(&query).await {
        Ok(response) => {
            if let Some(snapshot) = read_profile_snapshot(&response.body) {
                if snapshot.user_id != account.user_id {
                    log::warn!(
                        "NCM account refresh returned mismatched user id: expected {}, got {}",
                        account.user_id,
                        snapshot.user_id
                    );
                    return;
                }
                if let Err(err) = data.app_db.update_ncm_account_profile(
                    account.user_id,
                    snapshot.nickname.as_deref(),
                    snapshot.avatar_url.as_deref(),
                    snapshot.vip_type,
                    snapshot.level,
                ) {
                    log::warn!(
                        "Failed to persist refreshed NCM profile for user {}: {}",
                        account.user_id,
                        err
                    );
                }
            }
        }
        Err(err) => {
            log::warn!(
                "NCM account profile refresh for user {} failed: {}",
                account.user_id,
                err
            );
        }
    }
}

fn read_profile_snapshot(payload: &Value) -> Option<NcmProfileSnapshot> {
    let root = payload.as_object()?;
    let data = root.get("data").and_then(Value::as_object).unwrap_or(root);
    let profile = data.get("profile").and_then(Value::as_object);
    let account = data.get("account").and_then(Value::as_object);
    let user_id = profile
        .and_then(|value| value.get("userId"))
        .and_then(Value::as_i64)
        .or_else(|| {
            account
                .and_then(|value| value.get("id"))
                .and_then(Value::as_i64)
        })?;

    Some(NcmProfileSnapshot {
        user_id,
        nickname: profile
            .and_then(|value| value.get("nickname"))
            .and_then(read_non_empty_string)
            .or_else(|| {
                account
                    .and_then(|value| value.get("userName"))
                    .and_then(read_non_empty_string)
            }),
        avatar_url: profile
            .and_then(|value| value.get("avatarUrl"))
            .and_then(read_non_empty_string),
        vip_type: profile
            .and_then(|value| value.get("vipType"))
            .and_then(Value::as_i64)
            .or_else(|| {
                account
                    .and_then(|value| value.get("vipType"))
                    .and_then(Value::as_i64)
            }),
        level: data.get("level").and_then(Value::as_i64),
    })
}

fn read_user_playlists(payload: &Value) -> Vec<NcmPlaylistSummary> {
    payload
        .get("playlist")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_playlist_summary)
        .collect()
}

fn read_playlist_summary(value: &Value) -> Option<NcmPlaylistSummary> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let name = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmPlaylistSummary {
        id,
        name,
        creator: item
            .get("creator")
            .and_then(|creator| creator.get("nickname"))
            .and_then(read_non_empty_string),
        cover_url: item.get("coverImgUrl").and_then(read_non_empty_string),
        track_count: item.get("trackCount").and_then(Value::as_i64),
        subscribed: item
            .get("subscribed")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

fn filter_playlist_summaries(
    playlists: Vec<NcmPlaylistSummary>,
    mode: Option<&str>,
) -> Vec<NcmPlaylistSummary> {
    match mode {
        Some("created-playlists") => playlists
            .into_iter()
            .filter(|playlist| !playlist.subscribed)
            .collect(),
        Some("collected-playlists") => playlists
            .into_iter()
            .filter(|playlist| playlist.subscribed)
            .collect(),
        _ => playlists,
    }
}

fn read_discover_playlist_cards(payload: &Value) -> Vec<NcmDiscoverCard> {
    payload
        .get("playlists")
        .or_else(|| payload.get("result"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_discover_playlist_card)
        .collect()
}

fn read_discover_album_cards(payload: &Value) -> Vec<NcmDiscoverCard> {
    payload
        .get("albums")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_discover_album_card)
        .collect()
}

fn read_discover_artist_cards(payload: &Value) -> Vec<NcmDiscoverCard> {
    payload
        .get("artists")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_discover_artist_card)
        .collect()
}

fn read_discover_toplists(payload: &Value) -> Vec<NcmDiscoverToplist> {
    payload
        .get("list")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_discover_toplist)
        .collect()
}

fn read_discover_playlist_card(value: &Value) -> Option<NcmDiscoverCard> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmDiscoverCard {
        id,
        title,
        subtitle: item
            .get("creator")
            .and_then(|creator| creator.get("nickname"))
            .and_then(read_non_empty_string)
            .or_else(|| item.get("copywriter").and_then(read_non_empty_string)),
        cover_url: item
            .get("coverImgUrl")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("picUrl").and_then(read_non_empty_string)),
        cursor: read_discover_cursor(item),
    })
}

fn read_discover_album_card(value: &Value) -> Option<NcmDiscoverCard> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmDiscoverCard {
        id,
        title,
        subtitle: item
            .get("artist")
            .and_then(|artist| artist.get("name"))
            .and_then(read_non_empty_string)
            .or_else(|| read_artists(item.get("artists")))
            .or_else(|| read_artists(item.get("ar"))),
        cover_url: item.get("picUrl").and_then(read_non_empty_string),
        cursor: read_discover_cursor(item),
    })
}

fn read_discover_artist_card(value: &Value) -> Option<NcmDiscoverCard> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmDiscoverCard {
        id,
        title,
        subtitle: None,
        cover_url: item
            .get("picUrl")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("img1v1Url").and_then(read_non_empty_string)),
        cursor: None,
    })
}

fn read_discover_toplist(value: &Value) -> Option<NcmDiscoverToplist> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmDiscoverToplist {
        id,
        title,
        subtitle: item.get("updateTip").and_then(read_non_empty_string),
        description: item.get("description").and_then(read_non_empty_string),
        cover_url: item
            .get("coverImgUrl")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("picUrl").and_then(read_non_empty_string)),
        tracks: item
            .get("tracks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(read_discover_toplist_track)
            .collect(),
        is_official: item
            .get("ToplistType")
            .and_then(read_non_empty_string)
            .is_some(),
        cursor: read_discover_cursor(item),
    })
}

fn read_discover_toplist_track(value: &Value) -> Option<NcmDiscoverToplistTrack> {
    let item = value.as_object()?;
    let title = item
        .get("first")
        .and_then(read_non_empty_string)
        .or_else(|| item.get("name").and_then(read_non_empty_string))?;
    Some(NcmDiscoverToplistTrack {
        title,
        artist: item
            .get("second")
            .and_then(read_non_empty_string)
            .or_else(|| read_artists(item.get("ar")))
            .or_else(|| read_artists(item.get("artists"))),
    })
}

fn read_discover_playlist_categories(
    cat_payload: &Value,
    hq_payload: &Value,
) -> NcmDiscoverPlaylistCategories {
    let categories = cat_payload
        .get("categories")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(key, value)| Some((key.parse::<i64>().ok()?, read_non_empty_string(value)?)))
        .collect::<HashMap<_, _>>();
    let entries = cat_payload
        .get("sub")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_discover_playlist_category_entry)
        .collect();
    let hq_names = hq_payload
        .get("tags")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("name").and_then(read_non_empty_string))
        .collect();
    NcmDiscoverPlaylistCategories {
        categories,
        entries,
        hq_names,
    }
}

fn read_discover_playlist_category_entry(
    value: &Value,
) -> Option<NcmDiscoverPlaylistCategoryEntry> {
    let item = value.as_object()?;
    Some(NcmDiscoverPlaylistCategoryEntry {
        name: item.get("name").and_then(read_non_empty_string)?,
        category: item.get("category").and_then(Value::as_i64).unwrap_or(0),
        hot: item.get("hot").and_then(Value::as_bool).unwrap_or(false),
    })
}

fn read_discover_cursor(item: &serde_json::Map<String, Value>) -> Option<i64> {
    item.get("updateTime")
        .and_then(Value::as_i64)
        .or_else(|| item.get("trackNumberUpdateTime").and_then(Value::as_i64))
        .or_else(|| item.get("trackUpdateTime").and_then(Value::as_i64))
        .or_else(|| item.get("publishTime").and_then(Value::as_i64))
}

fn read_page_has_more(payload: &Value, limit: i64, offset: i64, item_count: usize) -> bool {
    payload
        .get("more")
        .and_then(Value::as_bool)
        .or_else(|| payload.get("hasMore").and_then(Value::as_bool))
        .or_else(|| {
            payload
                .get("total")
                .and_then(Value::as_i64)
                .map(|total| offset.saturating_add(limit) < total)
        })
        .unwrap_or(item_count as i64 >= limit)
}

fn discover_initial_param(value: &Value) -> Option<String> {
    match value {
        Value::Number(number) => number.as_i64().map(|value| value.to_string()),
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        _ => None,
    }
}

fn read_personalized_playlist_cards(payload: &Value) -> Vec<NcmHomeFeedCard> {
    payload
        .get("result")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_personalized_playlist_card)
        .collect()
}

fn read_recommend_resource_cards(payload: &Value) -> Vec<NcmHomeFeedCard> {
    payload
        .get("recommend")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_recommend_resource_card)
        .collect()
}

fn read_newest_album_cards(payload: &Value) -> Vec<NcmHomeFeedCard> {
    payload
        .get("albums")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_newest_album_card)
        .collect()
}

fn read_top_artist_cards(payload: &Value) -> Vec<NcmHomeFeedCard> {
    payload
        .get("artists")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_top_artist_card)
        .collect()
}

fn read_personalized_mv_cards(payload: &Value) -> Vec<NcmHomeFeedCard> {
    payload
        .get("result")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_personalized_mv_card)
        .collect()
}

fn read_personalized_dj_cards(payload: &Value) -> Vec<NcmHomeFeedCard> {
    payload
        .get("result")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_personalized_dj_card)
        .collect()
}

fn read_personalized_playlist_card(value: &Value) -> Option<NcmHomeFeedCard> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmHomeFeedCard {
        id,
        title,
        subtitle: item
            .get("creator")
            .and_then(|creator| creator.get("nickname"))
            .and_then(read_non_empty_string)
            .or_else(|| item.get("copywriter").and_then(read_non_empty_string)),
        cover_url: item.get("picUrl").and_then(read_non_empty_string),
        play_count: item.get("playCount").and_then(Value::as_f64),
        description: item
            .get("copywriter")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("description").and_then(read_non_empty_string)),
    })
}

fn read_recommend_resource_card(value: &Value) -> Option<NcmHomeFeedCard> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmHomeFeedCard {
        id,
        title,
        subtitle: item
            .get("creator")
            .and_then(|creator| creator.get("nickname"))
            .and_then(read_non_empty_string),
        cover_url: item.get("picUrl").and_then(read_non_empty_string),
        play_count: item
            .get("playcount")
            .and_then(Value::as_f64)
            .or_else(|| item.get("playCount").and_then(Value::as_f64)),
        description: item
            .get("copywriter")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("description").and_then(read_non_empty_string)),
    })
}

fn read_newest_album_card(value: &Value) -> Option<NcmHomeFeedCard> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmHomeFeedCard {
        id,
        title,
        subtitle: item
            .get("artist")
            .and_then(|artist| artist.get("name"))
            .and_then(read_non_empty_string)
            .or_else(|| read_artists(item.get("artists"))),
        cover_url: item.get("picUrl").and_then(read_non_empty_string),
        play_count: None,
        description: item.get("description").and_then(read_non_empty_string),
    })
}

fn read_top_artist_card(value: &Value) -> Option<NcmHomeFeedCard> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmHomeFeedCard {
        id,
        title,
        subtitle: None,
        cover_url: item
            .get("picUrl")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("img1v1Url").and_then(read_non_empty_string)),
        play_count: None,
        description: None,
    })
}

fn read_personalized_mv_card(value: &Value) -> Option<NcmHomeFeedCard> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmHomeFeedCard {
        id,
        title,
        subtitle: item
            .get("artistName")
            .and_then(read_non_empty_string)
            .or_else(|| read_artists(item.get("artists"))),
        cover_url: item
            .get("picUrl")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("cover").and_then(read_non_empty_string)),
        play_count: item.get("playCount").and_then(Value::as_f64),
        description: item
            .get("copywriter")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("description").and_then(read_non_empty_string)),
    })
}

fn read_personalized_dj_card(value: &Value) -> Option<NcmHomeFeedCard> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmHomeFeedCard {
        id,
        title,
        subtitle: item
            .get("copywriter")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("description").and_then(read_non_empty_string)),
        cover_url: item.get("picUrl").and_then(read_non_empty_string),
        play_count: item.get("playCount").and_then(Value::as_f64),
        description: item
            .get("copywriter")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("description").and_then(read_non_empty_string)),
    })
}

fn read_radar_playlist_card(payload: &Value) -> Option<NcmHomeFeedCard> {
    let playlist = payload.get("playlist")?.as_object()?;
    let id = playlist.get("id").and_then(Value::as_i64)?;
    let title = playlist.get("name").and_then(read_non_empty_string)?;
    Some(NcmHomeFeedCard {
        id,
        title,
        subtitle: playlist
            .get("creator")
            .and_then(|creator| creator.get("nickname"))
            .and_then(read_non_empty_string),
        cover_url: playlist.get("coverImgUrl").and_then(read_non_empty_string),
        play_count: playlist.get("playCount").and_then(Value::as_f64),
        description: playlist.get("description").and_then(read_non_empty_string),
    })
}

fn track_covers(tracks: &[NcmTrackSummary]) -> Vec<NcmHomeTrackCover> {
    tracks
        .iter()
        .map(|track| NcmHomeTrackCover {
            id: track.song_id,
            url: track.artwork_url.clone(),
        })
        .collect()
}

fn personal_fm_preview(tracks: &[NcmTrackSummary]) -> Option<NcmHomePersonalFmPreview> {
    let track = tracks.first()?;
    let title = track.title.clone()?;
    Some(NcmHomePersonalFmPreview {
        title,
        artist: track.artist.clone(),
        album: track.album.clone(),
        cover_url: track.artwork_url.clone(),
    })
}

fn read_search_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    payload
        .get("result")
        .and_then(|result| result.get("songs"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_track_summary)
        .collect()
}

fn read_search_playlists(payload: &Value) -> Vec<NcmPlaylistSummary> {
    payload
        .get("result")
        .and_then(|result| result.get("playlists"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_playlist_summary)
        .collect()
}

fn read_playlist_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    let root_songs = payload.get("songs").and_then(Value::as_array);
    let playlist_tracks = payload
        .get("playlist")
        .and_then(|playlist| playlist.get("tracks"))
        .and_then(Value::as_array);
    root_songs
        .or(playlist_tracks)
        .into_iter()
        .flatten()
        .filter_map(read_track_summary)
        .collect()
}

fn read_daily_song_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    payload
        .get("data")
        .and_then(|data| data.get("dailySongs"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_track_summary)
        .collect()
}

fn read_top_song_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    payload
        .get("data")
        .or_else(|| payload.get("result"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_wrapped_track_summary)
        .collect()
}

fn read_song_detail_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    payload
        .get("songs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_track_summary)
        .collect()
}

fn read_personal_fm_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    payload
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_track_summary)
        .collect()
}

fn read_wrapped_track_summary(value: &Value) -> Option<NcmTrackSummary> {
    let item = value.as_object()?;
    let song = item.get("song").and_then(Value::as_object).unwrap_or(item);
    let mut rebuilt = song.clone();
    if !rebuilt.contains_key("id") {
        if let Some(id) = item.get("id") {
            rebuilt.insert("id".to_string(), id.clone());
        }
    }
    if !rebuilt.contains_key("name") {
        if let Some(name) = item.get("name") {
            rebuilt.insert("name".to_string(), name.clone());
        }
    }
    if !rebuilt.contains_key("picUrl") {
        if let Some(pic_url) = item.get("picUrl") {
            rebuilt.insert("picUrl".to_string(), pic_url.clone());
        }
    }
    if !rebuilt.contains_key("al") {
        if let Some(album) = song.get("al").or_else(|| song.get("album")) {
            rebuilt.insert("al".to_string(), album.clone());
        }
    }
    if !rebuilt.contains_key("ar") {
        let artists = song.get("ar").or_else(|| song.get("artists"));
        if let Some(artists) = artists {
            rebuilt.insert("ar".to_string(), artists.clone());
        }
    }
    if !rebuilt.contains_key("dt") {
        if let Some(duration) = song.get("dt").or_else(|| song.get("duration")) {
            rebuilt.insert("dt".to_string(), duration.clone());
        }
    }
    read_track_summary(&Value::Object(rebuilt))
}

fn read_artist_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    payload
        .get("hotSongs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_track_summary)
        .collect()
}

fn read_likelist_ids(payload: &Value) -> Vec<i64> {
    payload
        .get("data")
        .and_then(|data| data.get("ids"))
        .or_else(|| payload.get("ids"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_i64)
        .collect()
}

fn read_track_summary(value: &Value) -> Option<NcmTrackSummary> {
    let item = value.as_object()?;
    let song_id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    let album = item
        .get("al")
        .and_then(Value::as_object)
        .or_else(|| item.get("album").and_then(Value::as_object));
    let duration_ms = item
        .get("dt")
        .and_then(Value::as_f64)
        .or_else(|| item.get("duration").and_then(Value::as_f64));

    Some(NcmTrackSummary {
        id: format!("ncm-song-{}", song_id),
        song_id,
        source_path: format!("https://music.163.com/#/song?id={}", song_id),
        title: Some(title),
        artist: read_artists(item.get("ar"))
            .or_else(|| read_artists(item.get("artists")))
            .or_else(|| {
                item.get("artist")
                    .and_then(|artist| artist.get("name"))
                    .and_then(read_non_empty_string)
            }),
        album: album
            .and_then(|album| album.get("name"))
            .and_then(read_non_empty_string)
            .or_else(|| item.get("album").and_then(read_non_empty_string)),
        duration_secs: duration_ms.map(|value| value / 1000.0),
        artwork_url: album
            .and_then(|album| album.get("picUrl"))
            .and_then(read_non_empty_string)
            .or_else(|| item.get("picUrl").and_then(read_non_empty_string)),
    })
}

fn non_empty_cookie(cookie: &str) -> Option<String> {
    let trimmed = cookie.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn active_ncm_cookie(data: &web::Data<Arc<AppState>>) -> Option<String> {
    match data.app_db.active_ncm_cookie() {
        Ok(cookie) => cookie,
        Err(err) => {
            log::warn!("Failed to read active NCM cookie: {}", err);
            None
        }
    }
}

fn inject_active_ncm_cookie(data: &web::Data<Arc<AppState>>, query: &mut Query) {
    let suppress = query
        .params
        .remove("_ncm_no_active_cookie")
        .or_else(|| query.params.remove("no_active_cookie"))
        .is_some_and(|value| parse_bool(&value));
    if suppress || query.cookie.is_some() {
        return;
    }
    if let Some(cookie) = active_ncm_cookie(data) {
        query.cookie = Some(cookie);
    }
}

fn attach_cookie(query: &mut Query, cookie: Option<&str>) {
    if let Some(cookie) = cookie.filter(|value| !value.trim().is_empty()) {
        query.cookie = Some(cookie.to_string());
    }
}

fn push_home_feed_error(errors: &mut Vec<NcmHomeFeedError>, section: &'static str, err: NcmError) {
    let message = err.to_string();
    log::warn!("NCM home feed section {} failed: {}", section, message);
    errors.push(NcmHomeFeedError {
        section: section.to_string(),
        message,
    });
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
        return Err(format!("Domain override not allowed: {}", normalized));
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
    fn read_song_url_extracts_first_stream_url() {
        let payload = json!({
            "data": [
                { "id": 42, "url": "https://m701.music.126.net/song.flac" }
            ]
        });

        assert_eq!(
            read_song_url(&payload).as_deref(),
            Some("https://m701.music.126.net/song.flac")
        );
    }

    #[test]
    fn read_song_detail_prefers_matching_song_and_modern_fields() {
        let payload = json!({
            "songs": [
                {
                    "id": 1,
                    "name": "Wrong",
                    "ar": [{ "name": "Wrong Artist" }],
                    "al": { "name": "Wrong Album", "picUrl": "wrong.jpg" }
                },
                {
                    "id": 42,
                    "name": "Needle",
                    "ar": [{ "name": "A" }, { "name": "B" }],
                    "al": { "name": "Album", "picUrl": "cover.jpg" }
                }
            ]
        });

        assert_eq!(
            read_song_detail(&payload, 42),
            Some(NcmTrackDetail {
                title: Some("Needle".to_string()),
                artist: Some("A, B".to_string()),
                album: Some("Album".to_string()),
                cover_url: Some("cover.jpg".to_string()),
            })
        );
    }

    #[test]
    fn read_song_detail_supports_legacy_fields() {
        let payload = json!({
            "songs": [
                {
                    "id": 42,
                    "name": "Legacy",
                    "artists": [{ "name": "Legacy Artist" }],
                    "album": { "name": "Legacy Album" },
                    "picUrl": "legacy.jpg"
                }
            ]
        });

        assert_eq!(
            read_song_detail(&payload, 42),
            Some(NcmTrackDetail {
                title: Some("Legacy".to_string()),
                artist: Some("Legacy Artist".to_string()),
                album: Some("Legacy Album".to_string()),
                cover_url: Some("legacy.jpg".to_string()),
            })
        );
    }

    #[test]
    fn read_profile_snapshot_supports_wrapped_login_status_shape() {
        let payload = json!({
            "data": {
                "account": { "id": 42, "userName": "fallback", "vipType": 10 },
                "profile": {
                    "userId": 42,
                    "nickname": "Ada",
                    "avatarUrl": "https://example.test/a.jpg",
                    "vipType": 11
                },
                "level": 8
            }
        });

        assert_eq!(
            read_profile_snapshot(&payload),
            Some(NcmProfileSnapshot {
                user_id: 42,
                nickname: Some("Ada".to_string()),
                avatar_url: Some("https://example.test/a.jpg".to_string()),
                vip_type: Some(11),
                level: Some(8),
            })
        );
    }

    #[test]
    fn read_user_playlists_returns_sanitized_summaries() {
        let payload = json!({
            "playlist": [
                {
                    "id": 1,
                    "name": "Created",
                    "creator": { "nickname": "Ada" },
                    "coverImgUrl": "cover-a.jpg",
                    "trackCount": 12,
                    "subscribed": false
                },
                {
                    "id": 2,
                    "name": "Collected",
                    "creator": { "nickname": "Grace" },
                    "coverImgUrl": "cover-b.jpg",
                    "trackCount": 34,
                    "subscribed": true
                }
            ]
        });

        let playlists = read_user_playlists(&payload);
        assert_eq!(playlists.len(), 2);
        assert_eq!(playlists[0].name, "Created");
        assert_eq!(
            filter_playlist_summaries(playlists.clone(), Some("collected-playlists")),
            vec![NcmPlaylistSummary {
                id: 2,
                name: "Collected".to_string(),
                creator: Some("Grace".to_string()),
                cover_url: Some("cover-b.jpg".to_string()),
                track_count: Some(34),
                subscribed: true,
            }]
        );
    }

    #[test]
    fn read_search_tracks_returns_stable_track_dto() {
        let payload = json!({
            "result": {
                "songs": [
                    {
                        "id": 42,
                        "name": "Needle",
                        "ar": [{ "name": "A" }, { "name": "B" }],
                        "al": { "name": "Album", "picUrl": "cover.jpg" },
                        "dt": 180000
                    },
                    { "id": 43 }
                ]
            }
        });

        assert_eq!(
            read_search_tracks(&payload),
            vec![NcmTrackSummary {
                id: "ncm-song-42".to_string(),
                song_id: 42,
                source_path: "https://music.163.com/#/song?id=42".to_string(),
                title: Some("Needle".to_string()),
                artist: Some("A, B".to_string()),
                album: Some("Album".to_string()),
                duration_secs: Some(180.0),
                artwork_url: Some("cover.jpg".to_string()),
            }]
        );
    }

    #[test]
    fn read_search_playlists_returns_sanitized_summaries() {
        let payload = json!({
            "result": {
                "playlists": [
                    {
                        "id": 100,
                        "name": "Mix",
                        "creator": { "nickname": "Ada" },
                        "coverImgUrl": "cover.jpg",
                        "trackCount": 12
                    },
                    { "id": 101 }
                ]
            }
        });

        assert_eq!(
            read_search_playlists(&payload),
            vec![NcmPlaylistSummary {
                id: 100,
                name: "Mix".to_string(),
                creator: Some("Ada".to_string()),
                cover_url: Some("cover.jpg".to_string()),
                track_count: Some(12),
                subscribed: false,
            }]
        );
    }

    #[test]
    fn read_playlist_tracks_supports_root_songs_and_legacy_fields() {
        let payload = json!({
            "songs": [
                {
                    "id": 7,
                    "name": "Legacy",
                    "artists": [{ "name": "Legacy Artist" }],
                    "album": { "name": "Legacy Album", "picUrl": "legacy.jpg" },
                    "duration": 90000
                }
            ]
        });

        assert_eq!(
            read_playlist_tracks(&payload),
            vec![NcmTrackSummary {
                id: "ncm-song-7".to_string(),
                song_id: 7,
                source_path: "https://music.163.com/#/song?id=7".to_string(),
                title: Some("Legacy".to_string()),
                artist: Some("Legacy Artist".to_string()),
                album: Some("Legacy Album".to_string()),
                duration_secs: Some(90.0),
                artwork_url: Some("legacy.jpg".to_string()),
            }]
        );
    }

    #[test]
    fn read_discover_cards_support_common_section_shapes() {
        let playlists = json!({
            "playlists": [{
                "id": 1,
                "name": "Playlist",
                "creator": { "nickname": "Ada" },
                "coverImgUrl": "playlist.jpg",
                "updateTime": 1710000000000_i64
            }],
            "more": true
        });
        let albums = json!({
            "albums": [{
                "id": 2,
                "name": "Album",
                "artists": [{ "name": "Artist" }],
                "picUrl": "album.jpg",
                "publishTime": 1710000000001_i64
            }],
            "total": 100
        });
        let artists = json!({
            "artists": [{
                "id": 3,
                "name": "Singer",
                "img1v1Url": "artist.jpg"
            }]
        });

        let playlist_card = &read_discover_playlist_cards(&playlists)[0];
        assert_eq!(playlist_card.subtitle.as_deref(), Some("Ada"));
        assert_eq!(playlist_card.cursor, Some(1710000000000));
        assert!(read_page_has_more(&playlists, 50, 0, 1));

        let album_card = &read_discover_album_cards(&albums)[0];
        assert_eq!(album_card.subtitle.as_deref(), Some("Artist"));
        assert_eq!(album_card.cursor, Some(1710000000001));
        assert!(read_page_has_more(&albums, 50, 0, 1));

        let artist_card = &read_discover_artist_cards(&artists)[0];
        assert_eq!(artist_card.cover_url.as_deref(), Some("artist.jpg"));
    }

    #[test]
    fn read_discover_toplists_categories_and_wrapped_tracks() {
        let toplists = json!({
            "list": [{
                "id": 4,
                "name": "Hot",
                "updateTip": "daily",
                "description": "desc",
                "coverImgUrl": "top.jpg",
                "ToplistType": "S",
                "tracks": [
                    { "first": "Song", "second": "Artist" },
                    { "name": "Modern", "ar": [{ "name": "A" }, { "name": "B" }] }
                ]
            }]
        });
        let categories = json!({
            "categories": { "0": "语种" },
            "sub": [{ "name": "华语", "category": 0, "hot": true }]
        });
        let hq_tags = json!({
            "tags": [{ "name": "华语" }]
        });
        let top_songs = json!({
            "data": [{
                "song": {
                    "id": 5,
                    "name": "Top Song",
                    "artists": [{ "name": "Singer" }],
                    "album": { "name": "Album", "picUrl": "song.jpg" },
                    "duration": 210000
                }
            }]
        });

        let toplist = &read_discover_toplists(&toplists)[0];
        assert!(toplist.is_official);
        assert_eq!(toplist.tracks[1].artist.as_deref(), Some("A, B"));

        let category_state = read_discover_playlist_categories(&categories, &hq_tags);
        assert_eq!(
            category_state.categories.get(&0).map(String::as_str),
            Some("语种")
        );
        assert_eq!(category_state.entries[0].name, "华语");
        assert_eq!(category_state.hq_names, vec!["华语".to_string()]);

        assert_eq!(
            read_top_song_tracks(&top_songs),
            vec![NcmTrackSummary {
                id: "ncm-song-5".to_string(),
                song_id: 5,
                source_path: "https://music.163.com/#/song?id=5".to_string(),
                title: Some("Top Song".to_string()),
                artist: Some("Singer".to_string()),
                album: Some("Album".to_string()),
                duration_secs: Some(210.0),
                artwork_url: Some("song.jpg".to_string()),
            }]
        );
    }

    #[test]
    fn read_home_feed_cards_support_common_section_shapes() {
        let personalized = json!({
            "result": [{
                "id": 1,
                "name": "Playlist",
                "copywriter": "copy",
                "picUrl": "playlist.jpg",
                "playCount": 1234,
                "description": "desc"
            }]
        });
        let resource = json!({
            "recommend": [{
                "id": 2,
                "name": "Daily",
                "creator": { "nickname": "Ada" },
                "picUrl": "daily.jpg",
                "playcount": 4321
            }]
        });
        let albums = json!({
            "albums": [{
                "id": 3,
                "name": "Album",
                "artist": { "name": "Artist" },
                "picUrl": "album.jpg"
            }]
        });
        let artists = json!({
            "artists": [{
                "id": 4,
                "name": "Singer",
                "img1v1Url": "artist.jpg"
            }]
        });
        let mvs = json!({
            "result": [{
                "id": 5,
                "name": "MV",
                "artistName": "Director",
                "cover": "mv.jpg",
                "playCount": 55
            }]
        });
        let djs = json!({
            "result": [{
                "id": 6,
                "name": "Podcast",
                "copywriter": "story",
                "picUrl": "podcast.jpg",
                "playCount": 66
            }]
        });

        assert_eq!(
            read_personalized_playlist_cards(&personalized)[0].title,
            "Playlist"
        );
        assert_eq!(
            read_recommend_resource_cards(&resource)[0]
                .subtitle
                .as_deref(),
            Some("Ada")
        );
        assert_eq!(
            read_newest_album_cards(&albums)[0].subtitle.as_deref(),
            Some("Artist")
        );
        assert_eq!(
            read_top_artist_cards(&artists)[0].cover_url.as_deref(),
            Some("artist.jpg")
        );
        assert_eq!(
            read_personalized_mv_cards(&mvs)[0].cover_url.as_deref(),
            Some("mv.jpg")
        );
        assert_eq!(
            read_personalized_dj_cards(&djs)[0].description.as_deref(),
            Some("story")
        );
    }

    #[test]
    fn read_home_feed_radar_and_personal_fm_preview() {
        let radar = json!({
            "playlist": {
                "id": 7,
                "name": "Radar",
                "creator": { "nickname": "NetEase" },
                "coverImgUrl": "radar.jpg",
                "playCount": 777,
                "description": "fresh"
            }
        });
        let track = NcmTrackSummary {
            id: "ncm-song-8".to_string(),
            song_id: 8,
            source_path: "https://music.163.com/#/song?id=8".to_string(),
            title: Some("FM".to_string()),
            artist: Some("Artist".to_string()),
            album: Some("Album".to_string()),
            duration_secs: Some(30.0),
            artwork_url: Some("fm.jpg".to_string()),
        };

        let card = read_radar_playlist_card(&radar).expect("radar card");
        assert_eq!(card.title, "Radar");
        assert_eq!(card.cover_url.as_deref(), Some("radar.jpg"));
        assert_eq!(
            track_covers(&[track.clone()]),
            vec![NcmHomeTrackCover {
                id: 8,
                url: Some("fm.jpg".to_string())
            }]
        );
        assert_eq!(
            personal_fm_preview(&[track]).map(|preview| preview.title),
            Some("FM".to_string())
        );
    }

    #[test]
    fn read_daily_personal_and_artist_tracks_use_expected_roots() {
        let song = json!({
            "id": 9,
            "name": "Rooted",
            "artists": [{ "name": "Artist" }],
            "album": { "name": "Album", "picUrl": "cover.jpg" },
            "duration": 60000
        });

        assert_eq!(
            read_daily_song_tracks(&json!({ "data": { "dailySongs": [song.clone()] } })).len(),
            1
        );
        assert_eq!(
            read_personal_fm_tracks(&json!({ "data": [song.clone()] })).len(),
            1
        );
        assert_eq!(read_artist_tracks(&json!({ "hotSongs": [song] })).len(), 1);
    }

    #[test]
    fn read_likelist_ids_supports_wrapped_and_root_shapes() {
        assert_eq!(
            read_likelist_ids(&json!({ "data": { "ids": [1, 2, "bad", 3] } })),
            vec![1, 2, 3]
        );
        assert_eq!(read_likelist_ids(&json!({ "ids": [4, 5] })), vec![4, 5]);
    }

    #[test]
    fn domain_override_requires_https_and_allowlist() {
        let http_err =
            normalize_domain_override("http://music.163.com").expect_err("http should be rejected");
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
            "  ".to_string(),                        // whitespace -> dropped
            "garbage_no_equals; Path=/".to_string(), // no `=` -> dropped
        ];
        assert_eq!(join_cookie_pairs(&cookies), "MUSIC_U=abc; MUSIC_A_T=def");
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

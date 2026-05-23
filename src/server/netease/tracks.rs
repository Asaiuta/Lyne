use super::*;

const ARTIST_TRACK_PAGE_SIZE: i64 = 50;
const ARTIST_TRACK_PAGE_SIZE_MAX: i64 = 100;

pub(super) async fn list_ncm_daily_song_tracks(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let mut query = Query::new();
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.recommend_songs(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "tracks": read_daily_song_tracks(&response.body)
        })),
        Err(err) => ncm_upstream_error_response(err),
    }
}

pub(super) async fn list_ncm_song_detail_tracks(
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
        return bad_request_response("NCM song ids must include at least one positive id");
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
        Err(err) => ncm_upstream_error_response(err),
    }
}

pub(super) async fn list_ncm_personal_fm_tracks(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let mut query = Query::new();
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.personal_fm(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "tracks": read_personal_fm_tracks(&response.body)
        })),
        Err(err) => ncm_upstream_error_response(err),
    }
}

pub(super) async fn list_ncm_heartbeat_tracks(
    data: web::Data<Arc<AppState>>,
    body: web::Json<HeartbeatTracksRequest>,
) -> HttpResponse {
    if body.song_id <= 0 {
        return bad_request_response("NCM heartbeat trigger song id must be positive");
    }
    if body.playlist_id <= 0 {
        return bad_request_response("NCM heartbeat playlist id must be positive");
    }

    let start_song_id = body.start_song_id.unwrap_or(body.song_id);
    let count = body.count.unwrap_or(1).max(1).min(50);

    let mut query = Query::new()
        .param("id", &body.song_id.to_string())
        .param("pid", &body.playlist_id.to_string())
        .param("sid", &start_song_id.to_string())
        .param("count", &count.to_string());
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.playmode_intelligence_list(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "tracks": read_heartbeat_tracks(&response.body)
        })),
        Err(err) => ncm_upstream_error_response(err),
    }
}

pub(super) async fn trash_ncm_personal_fm_track(
    data: web::Data<Arc<AppState>>,
    body: web::Json<PersonalFmTrashRequest>,
) -> HttpResponse {
    let song_id = body.song_id;
    if song_id <= 0 {
        return bad_request_response("NCM personal FM song id must be positive");
    }

    let mut query = Query::new().param("id", &song_id.to_string());
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.fm_trash(&query).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success"
        })),
        Err(err) => ncm_upstream_error_response(err),
    }
}

pub(super) async fn dislike_ncm_daily_song(
    data: web::Data<Arc<AppState>>,
    body: web::Json<DailySongDislikeRequest>,
) -> HttpResponse {
    let song_id = body.song_id;
    if song_id <= 0 {
        return bad_request_response("NCM daily song id must be positive");
    }

    let mut query = Query::new().param("id", &song_id.to_string());
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.recommend_songs_dislike(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "track": read_daily_dislike_replacement(&response.body)
        })),
        Err(err) => ncm_upstream_error_response(err),
    }
}

pub(super) async fn list_ncm_album_tracks(
    data: web::Data<Arc<AppState>>,
    body: web::Json<EntityTracksRequest>,
) -> HttpResponse {
    let id = body.id;
    if id <= 0 {
        return bad_request_response("NCM album id must be positive");
    }

    let mut query = Query::new().param("id", &id.to_string());
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.album(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "tracks": read_song_detail_tracks(&response.body)
        })),
        Err(err) => ncm_upstream_error_response(err),
    }
}

pub(super) async fn list_ncm_artist_tracks(
    data: web::Data<Arc<AppState>>,
    body: web::Json<EntityTracksRequest>,
) -> HttpResponse {
    let id = body.id;
    if id <= 0 {
        return bad_request_response("NCM artist id must be positive");
    }

    let limit = body
        .limit
        .unwrap_or(ARTIST_TRACK_PAGE_SIZE)
        .clamp(1, ARTIST_TRACK_PAGE_SIZE_MAX);
    let offset = body.offset.unwrap_or(0).max(0);
    let order = match body.order.as_deref() {
        Some("time") => "time",
        _ => "hot",
    };

    let mut query = Query::new()
        .param("id", &id.to_string())
        .param("limit", &limit.to_string())
        .param("offset", &offset.to_string())
        .param("order", order);
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.artist_songs(&query).await {
        Ok(response) => {
            let tracks = read_artist_tracks(&response.body);
            let has_more = read_page_has_more(&response.body, limit, offset, tracks.len());
            HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "tracks": tracks,
            "has_more": has_more
            }))
        }
        Err(err) => ncm_upstream_error_response(err),
    }
}

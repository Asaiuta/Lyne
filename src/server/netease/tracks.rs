use super::*;

pub(super) async fn list_ncm_daily_song_tracks(data: web::Data<Arc<AppState>>) -> HttpResponse {
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
        Err(err) => build_error_response(err),
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
        Err(err) => build_error_response(err),
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
        Err(err) => build_error_response(err),
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
        Err(err) => build_error_response(err),
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

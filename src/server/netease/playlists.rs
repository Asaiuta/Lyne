use super::*;

pub(super) async fn list_ncm_user_playlists(
    data: web::Data<Arc<AppState>>,
    body: web::Json<UserPlaylistsRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    if request.uid <= 0 {
        return bad_request_response("NCM user id must be positive");
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
            let playlists =
                filter_playlist_summaries(read_user_playlists(&response.body), request.uid, mode);
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "playlists": playlists
            }))
        }
        Err(err) => ncm_upstream_error_response(err),
    }
}

pub(super) async fn get_ncm_playlist_detail(
    data: web::Data<Arc<AppState>>,
    body: web::Json<PlaylistDetailRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    if request.id <= 0 {
        return bad_request_response("NCM playlist id must be positive");
    }

    let mut query = Query::new().param("id", &request.id.to_string());
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.playlist_detail(&query).await {
        Ok(response) => match response
            .body
            .get("playlist")
            .and_then(read_playlist_summary)
        {
            Some(playlist) => HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "playlist": playlist
            })),
            None => bad_gateway_response("Invalid NCM playlist detail payload"),
        },
        Err(err) => ncm_upstream_error_response(err),
    }
}

pub(super) async fn list_ncm_playlist_tracks(
    data: web::Data<Arc<AppState>>,
    body: web::Json<PlaylistTracksRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    if request.id <= 0 {
        return bad_request_response("NCM playlist id must be positive");
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
        Err(err) => ncm_upstream_error_response(err),
    }
}

pub(super) async fn update_ncm_playlist_tracks(
    data: web::Data<Arc<AppState>>,
    body: web::Json<PlaylistTrackUpdateRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    if request.playlist_id <= 0 {
        return bad_request_response("NCM playlist id must be positive");
    }

    let song_ids = request
        .song_ids
        .into_iter()
        .filter(|id| *id > 0)
        .collect::<Vec<_>>();
    if song_ids.is_empty() {
        return bad_request_response("NCM song ids must include at least one positive id");
    }

    let op = request
        .op
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("add");
    if op != "add" && op != "del" {
        return bad_request_response("NCM playlist track op must be add or del");
    }

    let mut query = Query::new()
        .param("pid", &request.playlist_id.to_string())
        .param(
            "tracks",
            &song_ids
                .iter()
                .map(i64::to_string)
                .collect::<Vec<_>>()
                .join(","),
        )
        .param("op", op);
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.playlist_tracks(&query).await {
        Ok(response) => {
            let code = response
                .body
                .get("code")
                .and_then(serde_json::Value::as_i64);
            if code.is_some_and(|value| value != 200) {
                let message = response
                    .body
                    .get("message")
                    .or_else(|| response.body.get("msg"))
                    .and_then(read_non_empty_string)
                    .unwrap_or_else(|| "Failed to update NCM playlist tracks".to_string());
                return bad_gateway_response(message);
            }

            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "updated_count": song_ids.len()
            }))
        }
        Err(err) => ncm_upstream_error_response(err),
    }
}

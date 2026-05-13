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
            let mode = request
                .mode
                .as_deref()
                .map(str::trim)
                .filter(|value| {
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
        Err(err) => build_error_response(err),
    }
}

use super::*;

pub(super) async fn list_ncm_likelist_ids(
    data: web::Data<Arc<AppState>>,
    body: web::Json<LikelistRequest>,
) -> HttpResponse {
    let uid = body.uid;
    if uid <= 0 {
        return bad_request_response("NCM user id must be positive");
    }

    let mut query = Query::new().param("uid", &uid.to_string());
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.likelist(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "ids": read_likelist_ids(&response.body)
        })),
        Err(err) => ncm_upstream_error_response(err),
    }
}

pub(super) async fn list_ncm_cloud_tracks(
    data: web::Data<Arc<AppState>>,
    body: web::Json<CloudTracksRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    let mut query = Query::new();
    if let Some(limit) = request.limit.filter(|value| *value > 0) {
        query = query.param("limit", &limit.to_string());
    }
    if let Some(offset) = request.offset.filter(|value| *value >= 0) {
        query = query.param("offset", &offset.to_string());
    }
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.user_cloud(&query).await {
        Ok(response) => {
            let page = read_cloud_tracks_page(&response.body);
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "tracks": page.tracks,
                "count": page.count,
                "size_bytes": page.size_bytes,
                "max_size_bytes": page.max_size_bytes
            }))
        }
        Err(err) => ncm_upstream_error_response(err),
    }
}

pub(super) async fn delete_ncm_cloud_track(
    data: web::Data<Arc<AppState>>,
    body: web::Json<CloudDeleteRequest>,
) -> HttpResponse {
    let song_id = body.song_id;
    if song_id <= 0 {
        return bad_request_response("NCM cloud song id must be positive");
    }

    let mut query = Query::new().param("id", &song_id.to_string());
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.user_cloud_del(&query).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success"
        })),
        Err(err) => ncm_upstream_error_response(err),
    }
}

use super::*;

pub(super) async fn search_ncm_tracks(
    data: web::Data<Arc<AppState>>,
    body: web::Json<SearchTracksRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    let keywords = request.keywords.trim();
    if keywords.is_empty() {
        return bad_request_response("NCM search keywords must not be empty");
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

pub(super) async fn search_ncm_playlists(
    data: web::Data<Arc<AppState>>,
    body: web::Json<SearchTracksRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    let keywords = request.keywords.trim();
    if keywords.is_empty() {
        return bad_request_response("NCM search keywords must not be empty");
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

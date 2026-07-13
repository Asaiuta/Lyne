use super::types::NcmTrackSummary;
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

    let response = match data.ncm_client.cloudsearch(&query).await {
        Ok(response) => response,
        Err(err) => {
            log::warn!(
                "NCM cloudsearch tracks failed, falling back to search: {}",
                err
            );
            match data.ncm_client.search(&query).await {
                Ok(response) => response,
                Err(search_err) => {
                    log::warn!(
                        "NCM search fallback after cloudsearch failed: {}",
                        search_err
                    );
                    return ncm_upstream_error_response(err);
                }
            }
        }
    };
    let tracks =
        enrich_missing_search_track_artwork(&data, read_search_tracks(&response.body)).await;

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "tracks": tracks
    }))
}

async fn enrich_missing_search_track_artwork(
    data: &web::Data<Arc<AppState>>,
    mut tracks: Vec<NcmTrackSummary>,
) -> Vec<NcmTrackSummary> {
    let ids = missing_artwork_song_ids(&tracks);
    if ids.is_empty() {
        return tracks;
    }

    let mut detail_query = Query::new().param(
        "ids",
        &ids.iter().map(i64::to_string).collect::<Vec<_>>().join(","),
    );
    inject_active_ncm_cookie(data, &mut detail_query);

    match data.ncm_client.song_detail(&detail_query).await {
        Ok(response) => {
            let details = read_song_detail_tracks(&response.body);
            merge_missing_search_track_artwork(&mut tracks, &details);
        }
        Err(err) => {
            log::warn!(
                "NCM search cover fallback for {} tracks -> ERROR: {}",
                ids.len(),
                err
            );
        }
    }

    tracks
}

fn missing_artwork_song_ids(tracks: &[NcmTrackSummary]) -> Vec<i64> {
    let mut ids = Vec::new();
    for track in tracks {
        if track.artwork_url.is_some() || ids.contains(&track.song_id) {
            continue;
        }
        ids.push(track.song_id);
    }
    ids
}

pub(super) fn merge_missing_search_track_artwork(
    tracks: &mut [NcmTrackSummary],
    details: &[NcmTrackSummary],
) {
    for track in tracks
        .iter_mut()
        .filter(|track| track.artwork_url.is_none())
    {
        let Some(detail) = details
            .iter()
            .find(|detail| detail.song_id == track.song_id && detail.artwork_url.is_some())
        else {
            continue;
        };
        track.artwork_url = detail.artwork_url.clone();
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
        Err(err) => ncm_upstream_error_response(err),
    }
}

use super::*;

pub(super) async fn resolve_ncm_track(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ResolveNcmTrackRequest>,
) -> HttpResponse {
    match resolve_ncm_track_inner(&data, body.into_inner()).await {
        Ok(track) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "track": track
        })),
        Err(err) => ncm_track_resolve_error_response(err),
    }
}

pub(super) async fn play_ncm_track(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ResolveNcmTrackRequest>,
) -> HttpResponse {
    let track = match resolve_ncm_track_inner(&data, body.into_inner()).await {
        Ok(track) => track,
        Err(err) => return ncm_track_resolve_error_response(err),
    };

    match crate::server::playback::load_validated_path_for_playback(
        &data,
        &track.stream_url,
        true,
        "ncm_autoplay",
    ) {
        Ok((state, _shared_state)) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "track": track,
            "state": state
        })),
        Err(err) => internal_server_error_response(format!("Failed to play NCM track: {}", err)),
    }
}

pub(super) async fn enqueue_ncm_track(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ResolveNcmTrackRequest>,
) -> HttpResponse {
    let track = match resolve_ncm_track_inner(&data, body.into_inner()).await {
        Ok(track) => track,
        Err(err) => return ncm_track_resolve_error_response(err),
    };

    match crate::server::playback::append_validated_path_to_persistent_queue(
        &data,
        &track.stream_url,
    ) {
        Ok(queue) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "track": track,
            "queue": queue
        })),
        Err(err) => internal_server_error_response(format!("Failed to enqueue NCM track: {}", err)),
    }
}

async fn resolve_ncm_track_inner(
    data: &web::Data<Arc<AppState>>,
    request: ResolveNcmTrackRequest,
) -> Result<ResolvedNcmTrack, NcmTrackResolveError> {
    if request.song_id <= 0 {
        return Err(NcmTrackResolveError::BadRequest(
            "NCM song id must be positive".to_string(),
        ));
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
        .or_else(|| active_ncm_cookie(data));

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
            return Err(NcmTrackResolveError::Upstream(err));
        }
    };

    let stream_url = match read_song_url(&url_response.body) {
        Some(url) => match crate::server::validate_path(&url) {
            Ok(value) => value,
            Err(err) => {
                return Err(NcmTrackResolveError::BadGateway(format!(
                    "NCM song URL rejected: {}",
                    err
                )));
            }
        },
        None => {
            return Err(NcmTrackResolveError::BadGateway(
                "NCM song URL unavailable".to_string(),
            ));
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

    Ok(track)
}

fn ncm_track_resolve_error_response(err: NcmTrackResolveError) -> HttpResponse {
    match err {
        NcmTrackResolveError::BadRequest(message) => bad_request_response(message),
        NcmTrackResolveError::BadGateway(message) => bad_gateway_response(message),
        NcmTrackResolveError::Upstream(err) => build_error_response(err),
    }
}

pub(super) async fn resolve_ncm_track_supplement(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ResolveNcmTrackSupplementRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    if request.song_id <= 0 {
        return bad_request_response("NCM song id must be positive");
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

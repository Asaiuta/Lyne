use super::{
    active_ncm_cookie, ncm_upstream_error_response, quality_fallback_ladder, read_song_detail,
    read_song_dynamic_cover_url, read_song_url_rich, AppState, NcmTrackDetail,
    NcmTrackResolveError, NcmUrlInfo, ResolveNcmTrackLyricsRequest, ResolveNcmTrackRequest,
    ResolveNcmTrackSupplementRequest, ResolvedNcmTrack, ResolvedNcmTrackLyrics,
    ResolvedNcmTrackSupplement,
};
use crate::server::lyrics;
use crate::server::{bad_gateway_response, bad_request_response, internal_server_error_response};
use actix_web::{web, HttpResponse};
use ncm_api_rs::{NcmError, Query};
use std::sync::Arc;

/// Fetches and parses the `song/url/v1` response for a single quality tier.
async fn fetch_ncm_url_info(
    data: &web::Data<Arc<AppState>>,
    song_id: i64,
    level: &str,
    cookie: Option<&str>,
) -> Result<Option<NcmUrlInfo>, NcmError> {
    let mut query = Query::new()
        .param("id", &song_id.to_string())
        .param("level", level);
    if let Some(cookie) = cookie {
        query.cookie = Some(cookie.to_string());
    }
    let response = data.ncm_client.song_url_v1(&query).await?;
    Ok(read_song_url_rich(&response.body))
}

/// Accepts a resolved URL only when it is playable and either non-trial or
/// trials are explicitly allowed by the caller.
fn accept_ncm_url(info: Option<NcmUrlInfo>, allow_trial: bool) -> Option<NcmUrlInfo> {
    let info = info?;
    if info.url.is_some() && (!info.is_trial || allow_trial) {
        Some(info)
    } else {
        None
    }
}

/// Whether a resolved stream source is a remote URL (vs a local cache file path).
fn is_remote_url(stream_url: &str) -> bool {
    let lower = stream_url.trim_start().to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

/// Fetches song detail metadata (title/artist/album/cover), tolerating upstream
/// failures by returning the default (empty) detail.
async fn fetch_ncm_detail(
    data: &web::Data<Arc<AppState>>,
    song_id: i64,
    cookie: Option<&str>,
) -> NcmTrackDetail {
    let mut query = Query::new().param("ids", &song_id.to_string());
    if let Some(cookie) = cookie {
        query.cookie = Some(cookie.to_string());
    }
    match data.ncm_client.song_detail(&query).await {
        Ok(response) => read_song_detail(&response.body, song_id).unwrap_or_default(),
        Err(err) => {
            log::warn!("NCM resolve track {} detail -> ERROR: {}", song_id, err);
            NcmTrackDetail::default()
        }
    }
}

/// Persists external-media metadata and the URL -> NCM song id mapping for a
/// resolved track. Best-effort: logs and continues on failure.
async fn persist_resolved_track(data: &web::Data<Arc<AppState>>, track: &ResolvedNcmTrack) {
    if let Err(err) = data
        .repo
        .record_external_media_metadata(
            track.stream_url.clone(),
            track.title.clone(),
            track.artist.clone(),
            track.album.clone(),
            track.duration_secs,
            track.cover_url.clone(),
        )
        .await
    {
        log::warn!(
            "Failed to persist NCM metadata for song {}: {}",
            track.song_id,
            err
        );
    }
    if let Err(err) = data
        .repo
        .record_ncm_track_source(
            track.stream_url.clone(),
            track.song_id,
            Some(track.source_page_url.clone()),
        )
        .await
    {
        log::warn!(
            "Failed to persist NCM track source for song {}: {}",
            track.song_id,
            err
        );
    }
}

pub(super) async fn resolve_ncm_track(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ResolveNcmTrackRequest>,
) -> HttpResponse {
    match resolve_ncm_track_inner(&data, body.into_inner(), false).await {
        Ok(track) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "track": track
        })),
        Err(err) => ncm_track_resolve_error_response(err),
    }
}

/// Loads a resolved stream URL into the player on the blocking pool.
///
/// `load_validated_path_for_playback` is fully synchronous: it acquires the
/// `parking_lot::Mutex<AudioPlayer>` (a `!Send` guard) and performs a decoder
/// open plus several blocking SQLite writes. Offloading it keeps the async
/// executor free; the player lock is acquired and released entirely inside the
/// closure (no `.await`), so the `!Send` guard never crosses an await point.
async fn load_ncm_stream(
    data: &web::Data<Arc<AppState>>,
    stream_url: &str,
) -> Result<crate::server::StateResponse, String> {
    let state_for_task = data.get_ref().clone();
    let stream_url = stream_url.to_string();
    actix_web::rt::task::spawn_blocking(move || {
        let data = web::Data::new(state_for_task);
        crate::server::playback::load_public_path_for_playback(
            &data,
            &stream_url,
            true,
            "ncm_autoplay",
        )
        .map(|(state, _shared_state)| state)
    })
    .await
    .map_err(|err| format!("join error {}", err))?
}

pub(super) async fn play_ncm_track(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ResolveNcmTrackRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    let mut track = match resolve_ncm_track_inner(&data, request.clone(), false).await {
        Ok(track) => track,
        Err(err) => return ncm_track_resolve_error_response(err),
    };

    let mut load_result = load_ncm_stream(&data, &track.stream_url).await;

    // A failed open most often means an expired anonymous URL or a stale/corrupt
    // cached file. Re-resolve once with the cache bypassed (forcing a fresh
    // remote URL) and retry. A second failure is reported.
    if let Err(first_err) = &load_result {
        log::warn!(
            "NCM play track {} failed to open ({}); re-resolving fresh and retrying",
            track.song_id,
            first_err
        );
        // If the failed source was a local cache file, delete it so the fresh
        // download can rebuild it (otherwise the cache would keep serving the
        // broken file on every play). Remote URLs (http/https) are left alone.
        if !is_remote_url(&track.stream_url) {
            if let Err(err) = std::fs::remove_file(&track.stream_url) {
                log::warn!(
                    "Failed to remove broken NCM cache file for song {}: {}",
                    track.song_id,
                    err
                );
            }
        }
        match resolve_ncm_track_inner(&data, request, true).await {
            Ok(fresh_track) => {
                track = fresh_track;
                load_result = load_ncm_stream(&data, &track.stream_url).await;
            }
            Err(err) => {
                log::warn!(
                    "NCM play track {} re-resolve failed: {:?}",
                    track.song_id,
                    err
                );
            }
        }
    }

    match load_result {
        Ok(state) => HttpResponse::Ok().json(serde_json::json!({
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
    let track = match resolve_ncm_track_inner(&data, body.into_inner(), false).await {
        Ok(track) => track,
        Err(err) => return ncm_track_resolve_error_response(err),
    };

    // `append_validated_path_to_persistent_queue` does blocking SQLite writes and
    // a `data.player.lock()` inside `emit_queue_updated`. Offload the whole
    // synchronous call so it never blocks the async executor; the player lock is
    // acquired/released inside the closure (no `.await`), so the `!Send` guard
    // never crosses an await. Only owned `Send` data crosses the boundary.
    let state_for_task = data.get_ref().clone();
    let stream_url = track.stream_url.clone();
    let enqueue_result = actix_web::rt::task::spawn_blocking(move || {
        let data = web::Data::new(state_for_task);
        crate::server::playback::append_queue_entries_with_sources_to_persistent_queue(
            &data,
            &[crate::app_database::QueueEntryInput::public(stream_url)],
        )
    })
    .await;

    match enqueue_result {
        Ok(Ok(queue)) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "track": track,
            "queue": queue
        })),
        Ok(Err(err)) => {
            internal_server_error_response(format!("Failed to enqueue NCM track: {}", err))
        }
        Err(err) => internal_server_error_response(format!(
            "Failed to enqueue NCM track: join error {}",
            err
        )),
    }
}

async fn resolve_ncm_track_inner(
    data: &web::Data<Arc<AppState>>,
    request: ResolveNcmTrackRequest,
    bypass_cache: bool,
) -> Result<ResolvedNcmTrack, NcmTrackResolveError> {
    if request.song_id <= 0 {
        return Err(NcmTrackResolveError::BadRequest(
            "NCM song id must be positive".to_string(),
        ));
    }

    // Application-level online configuration (cache / fallback / trial).
    let online = data.online_settings.get();

    let level = request
        .level
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(online.default_level.as_str());
    let cookie = request
        .cookie
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| active_ncm_cookie(data));

    // Fallback descends the quality ladder when a tier yields no playable URL;
    // trial-only (grey) previews are rejected (unless explicitly allowed) so we
    // never play a 30s clip as if it were the full track.
    let fallback_enabled = online.quality_fallback_enabled;
    let allow_trial = online.allow_trial_playback;

    // A. Cache hit: serve the locally cached file (at or above the requested
    // tier) and skip URL resolution entirely. Metadata still comes from the
    // detail endpoint so the UI stays consistent. Skipped when `bypass_cache`
    // is set (e.g. a retry after a stale cached file failed to open).
    if !bypass_cache {
        if let Some(cached) = data.ncm_audio_cache.lookup(request.song_id, level) {
            match crate::server::validate_path(&cached.path.to_string_lossy()) {
                Ok(local_path) => {
                    let detail = fetch_ncm_detail(data, request.song_id, cookie.as_deref()).await;
                    let track = ResolvedNcmTrack {
                        song_id: request.song_id,
                        stream_url: local_path,
                        source_page_url: request.source_page_url,
                        title: detail.title.or(request.title),
                        artist: detail.artist.or(request.artist),
                        album: detail.album.or(request.album),
                        cover_url: detail.cover_url.or(request.artwork_url),
                        duration_secs: request.duration_secs,
                        actual_level: Some(cached.level),
                    };
                    persist_resolved_track(data, &track).await;
                    log::info!("NCM resolve track {} -> CACHE HIT", track.song_id);
                    return Ok(track);
                }
                Err(err) => {
                    // Stale/invalid cached path: fall through to a fresh resolve.
                    log::warn!(
                        "NCM cached path for song {} rejected ({}); resolving fresh",
                        request.song_id,
                        err
                    );
                }
            }
        }
    }

    let detail_query = {
        let mut detail_query = Query::new().param("ids", &request.song_id.to_string());
        if let Some(cookie) = cookie.as_deref() {
            detail_query.cookie = Some(cookie.to_string());
        }
        detail_query
    };

    let start = std::time::Instant::now();

    // First attempt at the requested tier, resolved in parallel with the song
    // detail lookup (which is tier-independent).
    let first_url_future = fetch_ncm_url_info(data, request.song_id, level, cookie.as_deref());
    let (first_url_result, detail_result) =
        tokio::join!(first_url_future, data.ncm_client.song_detail(&detail_query));

    // A transport-level failure on the first call surfaces as an upstream error,
    // matching the prior behaviour (do not mask infrastructure problems).
    let first_info = match first_url_result {
        Ok(info) => info,
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

    let mut chosen = accept_ncm_url(first_info, allow_trial);

    // Walk the rest of the ladder only when the requested tier was unusable.
    if chosen.is_none() && fallback_enabled {
        for tier in quality_fallback_ladder(level)
            .into_iter()
            .filter(|tier| !tier.eq_ignore_ascii_case(level))
        {
            match fetch_ncm_url_info(data, request.song_id, tier, cookie.as_deref()).await {
                Ok(info) => {
                    if let Some(found) = accept_ncm_url(info, allow_trial) {
                        chosen = Some(found);
                        break;
                    }
                }
                Err(err) => {
                    log::warn!(
                        "NCM resolve track {} fallback tier {} -> ERROR: {}",
                        request.song_id,
                        tier,
                        err
                    );
                }
            }
        }
    }

    let chosen = match chosen {
        Some(info) => info,
        None => {
            return Err(NcmTrackResolveError::BadGateway(
                "NCM song URL unavailable after fallback".to_string(),
            ));
        }
    };

    let raw_url = match chosen.url.as_deref() {
        Some(url) => url,
        None => {
            return Err(NcmTrackResolveError::BadGateway(
                "NCM song URL unavailable".to_string(),
            ));
        }
    };

    let stream_url = match crate::server::validate_path(raw_url) {
        Ok(value) => value,
        Err(err) => {
            return Err(NcmTrackResolveError::BadGateway(format!(
                "NCM song URL rejected: {}",
                err
            )));
        }
    };
    let actual_level = chosen.level.clone();

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
        actual_level,
    };

    // D. Schedule a background cache download of the freshly resolved remote
    // stream so the next playback resolves to a local file. Fire-and-forget;
    // never affects this request's latency. Uses the resolved tier (falling
    // back to the requested tier label) for the cache key.
    let cache_tier = track
        .actual_level
        .clone()
        .unwrap_or_else(|| level.to_string());
    data.ncm_audio_cache
        .spawn_download(track.song_id, cache_tier, track.stream_url.clone());

    persist_resolved_track(data, &track).await;

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
        NcmTrackResolveError::Upstream(err) => ncm_upstream_error_response(err),
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
    let mut dynamic_cover_query = Query::new().param("id", &request.song_id.to_string());
    if let Some(cookie) = cookie.as_deref() {
        detail_query.cookie = Some(cookie.to_string());
        dynamic_cover_query.cookie = Some(cookie.to_string());
    }

    let start = std::time::Instant::now();
    let dynamic_cover_enabled = request.dynamic_cover.unwrap_or(false);
    let dynamic_cover_future = async {
        if dynamic_cover_enabled {
            Some(
                data.ncm_client
                    .song_dynamic_cover(&dynamic_cover_query)
                    .await,
            )
        } else {
            None
        }
    };
    let (detail_result, dynamic_cover_result) = tokio::join!(
        data.ncm_client.song_detail(&detail_query),
        dynamic_cover_future
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
    let detail = detail.unwrap_or_default();
    let (dynamic_cover_url, dynamic_cover_error) = match dynamic_cover_result {
        Some(Ok(response)) => (read_song_dynamic_cover_url(&response.body), None),
        Some(Err(err)) => {
            let message = err.to_string();
            log::warn!(
                "NCM supplement track {} dynamic cover -> ERROR: {} ({:.1?})",
                request.song_id,
                message,
                start.elapsed()
            );
            (None, Some(message))
        }
        None => (None, None),
    };

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
            alias: detail.alias,
            artist: detail.artist,
            artists: detail.artists,
            album: detail.album,
            album_id: detail.album_id,
            cover_url: detail.cover_url,
            dynamic_cover_url,
            detail_error,
            dynamic_cover_error,
        }
    }))
}

pub(super) async fn resolve_ncm_track_lyrics(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ResolveNcmTrackLyricsRequest>,
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
    let mut lyrics_query = Query::new().param("id", &request.song_id.to_string());
    if let Some(cookie) = cookie.as_deref() {
        lyrics_query.cookie = Some(cookie.to_string());
    }

    let start = std::time::Instant::now();
    match data.ncm_client.lyric_new(&lyrics_query).await {
        Ok(response) => {
            let lyrics = lyrics::read_lyric_lines_from_payload(&response.body);
            log::info!(
                "NCM lyrics track {} -> OK ({:.1?})",
                request.song_id,
                start.elapsed()
            );
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "lyrics": ResolvedNcmTrackLyrics {
                    song_id: request.song_id,
                    lyrics,
                }
            }))
        }
        Err(err) => {
            log::warn!(
                "NCM lyrics track {} -> ERROR: {} ({:.1?})",
                request.song_id,
                err,
                start.elapsed()
            );
            ncm_upstream_error_response(err)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::is_remote_url;

    #[test]
    fn is_remote_url_distinguishes_urls_from_local_paths() {
        assert!(is_remote_url("https://m701.music.126.net/song.flac"));
        assert!(is_remote_url("http://example.com/x"));
        assert!(is_remote_url("HTTPS://EXAMPLE.COM/x"));
        assert!(!is_remote_url(r"D:\AI\cache\42_lossless.flac"));
        assert!(!is_remote_url("/home/user/cache/42_lossless.flac"));
        assert!(!is_remote_url(r"\\?\D:\cache\song.mp3"));
    }
}

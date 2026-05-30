use super::{
    bad_gateway_response, bad_request_response, gateway_timeout_response,
    too_many_requests_response, unauthorized_response, AppState,
};
use actix_web::{web, HttpResponse};
use ncm_api_rs::{NcmError, Query};
use std::sync::Arc;

mod accounts;
mod cloud;
mod discover;
mod parsers;
mod playback_actions;
mod playlists;
mod proxy;
mod routes;
mod search;
mod tracks;
mod types;

use accounts::{
    clear_active_ncm_account, daily_signin_active_ncm_account, delete_ncm_account,
    list_ncm_accounts, logout_active_ncm_account, refresh_active_ncm_account,
    set_active_ncm_account, upsert_ncm_account,
};
use cloud::{
    delete_ncm_cloud_track, list_ncm_cloud_tracks, list_ncm_likelist_ids, match_ncm_cloud_track,
};
use discover::{
    get_ncm_discover_playlist_categories, get_ncm_home_feed, list_ncm_discover_albums,
    list_ncm_discover_artists, list_ncm_discover_playlists, list_ncm_discover_songs,
    list_ncm_discover_toplists,
};
use parsers::{
    discover_initial_param, filter_playlist_summaries, personal_fm_preview, read_artist_tracks,
    read_cloud_tracks_page, read_daily_dislike_replacement, read_daily_song_tracks,
    read_discover_album_cards, read_discover_artist_cards, read_discover_playlist_cards,
    read_discover_playlist_categories, read_discover_toplists, read_heartbeat_tracks,
    read_likelist_ids, read_newest_album_cards, read_non_empty_string, read_page_has_more,
    read_personal_fm_tracks, read_personalized_dj_cards, read_personalized_mv_cards,
    read_personalized_playlist_cards, read_playlist_summary, read_playlist_tracks,
    read_radar_playlist_card, read_recommend_resource_cards, read_search_playlists,
    read_search_tracks, read_song_detail, read_song_detail_tracks, read_song_dynamic_cover_url,
    read_song_url, read_top_artist_cards, read_top_song_tracks, read_user_playlists, track_covers,
};
use playback_actions::{
    enqueue_ncm_track, play_ncm_track, resolve_ncm_track, resolve_ncm_track_supplement,
};
use playlists::{
    get_ncm_playlist_detail, list_ncm_playlist_tracks, list_ncm_user_playlists,
    update_ncm_playlist_tracks,
};
use proxy::{handle_request, parse_bool};
use search::{search_ncm_playlists, search_ncm_tracks};
use tracks::{
    dislike_ncm_daily_song, list_ncm_album_tracks, list_ncm_artist_tracks,
    list_ncm_daily_song_tracks, list_ncm_heartbeat_tracks, list_ncm_personal_fm_tracks,
    list_ncm_song_detail_tracks, trash_ncm_personal_fm_track,
};
use types::NcmProfileSnapshot;
use types::{
    ActiveNcmAccountRequest, CloudDeleteRequest, CloudMatchRequest, CloudTracksRequest,
    DailySongDislikeRequest, DiscoverAlbumsRequest, DiscoverArtistsRequest,
    DiscoverPlaylistsRequest, DiscoverSongsRequest, EntityTracksRequest, HeartbeatTracksRequest,
    HomeFeedRequest, LikelistRequest, NcmAccountPath, NcmAccountStateResponse, NcmHomeFeed,
    NcmHomeFeedCard, NcmHomeFeedError, NcmHomePersonalFmPreview, NcmHomeTrackCover,
    NcmTrackResolveError, PersonalFmTrashRequest, PlaylistDetailRequest,
    PlaylistTrackUpdateRequest, PlaylistTracksRequest, ResolveNcmTrackRequest,
    ResolveNcmTrackSupplementRequest, ResolvedNcmTrack, ResolvedNcmTrackSupplement,
    SearchTracksRequest, SongDetailTracksRequest, UpsertNcmAccountRequest, UserPlaylistsRequest,
};

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    routes::configure_routes(cfg);
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
        .or_else(|| query.params.remove("noCookie"))
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

/// Canonical envelope mapping for upstream NCM errors emitted by `/domain/ncm/*` handlers.
///
/// Domain endpoints promise the AudioPlayer `{status, message}` shape on error
/// (see `.trellis/spec/backend/error-handling.md`). The raw `/api/netease/*` proxy
/// keeps the upstream `{code, msg}` shape and must NOT route through this helper.
fn ncm_upstream_error_response(err: NcmError) -> HttpResponse {
    match err {
        NcmError::AuthRequired(msg) => unauthorized_response(msg),
        NcmError::InvalidParam(msg) => bad_request_response(msg),
        NcmError::RateLimited(msg) => too_many_requests_response(msg),
        NcmError::Timeout(msg) => gateway_timeout_response(msg),
        NcmError::Api { msg, .. } => bad_gateway_response(msg),
        other => bad_gateway_response(other.to_string()),
    }
}

/// Search NCM by `title` (optionally narrowed by `artist`) and return parsed
/// lyric lines for the best-matching song. Returns an empty vec when nothing is
/// found or the upstream call fails — callers treat empty as "no online lyrics".
///
/// Used as an online fallback for local tracks that ship no embedded/sidecar
/// lyrics (see `playback::resolve_current_lyrics`).
pub(crate) async fn fetch_online_lyrics_for_metadata(
    data: &web::Data<Arc<AppState>>,
    title: &str,
    artist: Option<&str>,
) -> Vec<crate::server::lyrics::LyricLine> {
    let title = title.trim();
    if title.is_empty() {
        return Vec::new();
    }
    let artist = artist.map(str::trim).filter(|value| !value.is_empty());
    let keywords = match artist {
        Some(artist) => format!("{title} {artist}"),
        None => title.to_string(),
    };

    let mut search_query = Query::new()
        .param("keywords", &keywords)
        .param("type", "1")
        .param("limit", "10");
    inject_active_ncm_cookie(data, &mut search_query);

    let song_id = match data.ncm_client.search(&search_query).await {
        Ok(response) => {
            match pick_best_lyrics_match(&read_search_tracks(&response.body), title, artist) {
                Some(song_id) => song_id,
                None => return Vec::new(),
            }
        }
        Err(err) => {
            log::warn!("Online lyric search for '{keywords}' -> ERROR: {err}");
            return Vec::new();
        }
    };

    let mut lyric_query = Query::new().param("id", &song_id.to_string());
    inject_active_ncm_cookie(data, &mut lyric_query);
    match data.ncm_client.lyric_new(&lyric_query).await {
        Ok(response) => crate::server::lyrics::read_lyric_lines_from_payload(&response.body),
        Err(err) => {
            log::warn!("Online lyric fetch for song {song_id} -> ERROR: {err}");
            Vec::new()
        }
    }
}

/// Pick the NCM song id whose title/artist best match the local track. Scores an
/// exact title match highest, a partial title match next, and adds a point when
/// the artist also overlaps; falls back to the first usable result on a tie.
fn pick_best_lyrics_match(
    tracks: &[types::NcmTrackSummary],
    title: &str,
    artist: Option<&str>,
) -> Option<i64> {
    let title_lc = title.to_lowercase();
    let artist_lc = artist.map(str::to_lowercase);
    let mut best: Option<(i32, i64)> = None;
    for track in tracks {
        if track.song_id <= 0 {
            continue;
        }
        let mut score = 0;
        if let Some(track_title) = track.title.as_deref() {
            let track_title = track_title.to_lowercase();
            if track_title == title_lc {
                score += 4;
            } else if track_title.contains(&title_lc) || title_lc.contains(&track_title) {
                score += 2;
            }
        }
        if let (Some(artist_lc), Some(track_artist)) =
            (artist_lc.as_deref(), track.artist.as_deref())
        {
            let track_artist = track_artist.to_lowercase();
            if track_artist.contains(artist_lc) || artist_lc.contains(&track_artist) {
                score += 1;
            }
        }
        if best.is_none_or(|(best_score, _)| score > best_score) {
            best = Some((score, track.song_id));
        }
    }
    best.map(|(_, song_id)| song_id)
}

#[cfg(test)]
mod tests;

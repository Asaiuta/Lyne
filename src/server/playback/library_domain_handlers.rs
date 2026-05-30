use super::*;
use crate::app_database::{
    LibraryTrackGroupKind, LibraryTrackGroupsQuery, LibraryTrackViewQuery, LibraryTrackViewRange,
    LibraryTrackViewSort, LibraryTrackViewSortField, LibraryTrackViewSortOrder,
};
use actix_web::{web, HttpResponse};
use std::sync::atomic::Ordering;

pub(super) async fn get_recent_analysis_tasks(
    data: web::Data<Arc<AppState>>,
    query: web::Query<LimitQuery>,
) -> HttpResponse {
    let limit = query.limit.unwrap_or(50).clamp(1, 500);
    match data
        .app_db
        .recent_analysis_tasks_by_type(query.task_type.as_deref(), limit)
    {
        Ok(tasks) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "tasks": tasks
        })),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn get_playback_history(
    data: web::Data<Arc<AppState>>,
    query: web::Query<LimitQuery>,
) -> HttpResponse {
    let limit = query.limit.unwrap_or(50).clamp(1, 500);
    match data.app_db.recent_playback_history(limit) {
        Ok(history) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "history": history
        })),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn get_playback_sessions(
    data: web::Data<Arc<AppState>>,
    query: web::Query<LimitQuery>,
) -> HttpResponse {
    let limit = query.limit.unwrap_or(50).clamp(1, 500);
    match data.app_db.recent_playback_sessions(limit) {
        Ok(sessions) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "sessions": sessions
        })),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn get_media_items(
    data: web::Data<Arc<AppState>>,
    query: web::Query<LimitQuery>,
) -> HttpResponse {
    let limit = query.limit.unwrap_or(100).clamp(1, 1000);
    let result = if query.all.unwrap_or(false) {
        data.app_db.list_media_items()
    } else {
        data.app_db.recent_media_items(limit)
    };
    match result {
        Ok(items) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "media_items": items
        })),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn get_library_track_summaries(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let stats = match data.app_db.library_summary_stats() {
        Ok(stats) => stats,
        Err(e) => return internal_server_error_response(e),
    };
    match data.app_db.list_library_track_summaries() {
        Ok(tracks) => {
            let folders = data.app_db.library_folder_summaries_for_tracks(&tracks);
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "revision": stats.revision,
                "total_count": stats.total_count,
                "total_size_bytes": stats.total_size_bytes,
                "folders": folders,
                "tracks": tracks
            }))
        }
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn get_library_track_view(
    data: web::Data<Arc<AppState>>,
    body: web::Json<LibraryTrackViewRequest>,
) -> HttpResponse {
    let query = LibraryTrackViewQuery {
        queries: body.queries.clone(),
        folder_path: body.folder_path.clone(),
        sort: LibraryTrackViewSort {
            field: match body.sort.field {
                LibraryTrackViewSortFieldRequest::Default => LibraryTrackViewSortField::Default,
                LibraryTrackViewSortFieldRequest::Title => LibraryTrackViewSortField::Title,
                LibraryTrackViewSortFieldRequest::Artist => LibraryTrackViewSortField::Artist,
                LibraryTrackViewSortFieldRequest::Album => LibraryTrackViewSortField::Album,
                LibraryTrackViewSortFieldRequest::TrackNumber => {
                    LibraryTrackViewSortField::TrackNumber
                }
                LibraryTrackViewSortFieldRequest::Filename => LibraryTrackViewSortField::Filename,
                LibraryTrackViewSortFieldRequest::Duration => LibraryTrackViewSortField::Duration,
                LibraryTrackViewSortFieldRequest::Size => LibraryTrackViewSortField::Size,
                LibraryTrackViewSortFieldRequest::CreateTime => {
                    LibraryTrackViewSortField::CreateTime
                }
                LibraryTrackViewSortFieldRequest::UpdatedTime => {
                    LibraryTrackViewSortField::UpdatedTime
                }
            },
            order: match body.sort.order {
                LibraryTrackViewSortOrderRequest::Default => LibraryTrackViewSortOrder::Default,
                LibraryTrackViewSortOrderRequest::Asc => LibraryTrackViewSortOrder::Asc,
                LibraryTrackViewSortOrderRequest::Desc => LibraryTrackViewSortOrder::Desc,
            },
        },
        range: body.range.as_ref().map(|range| LibraryTrackViewRange {
            start: range.start,
            end: range.end,
        }),
        include_media_ids: body.include_media_ids,
    };

    match data.app_db.library_track_view(query) {
        Ok(view) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "revision": view.revision,
            "library_total_count": view.library_total_count,
            "library_total_size_bytes": view.library_total_size_bytes,
            "total_count": view.total_count,
            "total_size_bytes": view.total_size_bytes,
            "folders": view.folders,
            "rows": view.rows,
            "media_ids": view.media_ids
        })),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn get_library_track_groups(
    data: web::Data<Arc<AppState>>,
    body: web::Json<LibraryTrackGroupsRequest>,
) -> HttpResponse {
    let query = LibraryTrackGroupsQuery {
        kind: match body.kind {
            LibraryTrackGroupKindRequest::Artists => LibraryTrackGroupKind::Artists,
            LibraryTrackGroupKindRequest::Albums => LibraryTrackGroupKind::Albums,
        },
        queries: body.queries.clone(),
        folder_path: body.folder_path.clone(),
        sort: LibraryTrackViewSort {
            field: match body.sort.field {
                LibraryTrackViewSortFieldRequest::Default => LibraryTrackViewSortField::Default,
                LibraryTrackViewSortFieldRequest::Title => LibraryTrackViewSortField::Title,
                LibraryTrackViewSortFieldRequest::Artist => LibraryTrackViewSortField::Artist,
                LibraryTrackViewSortFieldRequest::Album => LibraryTrackViewSortField::Album,
                LibraryTrackViewSortFieldRequest::TrackNumber => {
                    LibraryTrackViewSortField::TrackNumber
                }
                LibraryTrackViewSortFieldRequest::Filename => LibraryTrackViewSortField::Filename,
                LibraryTrackViewSortFieldRequest::Duration => LibraryTrackViewSortField::Duration,
                LibraryTrackViewSortFieldRequest::Size => LibraryTrackViewSortField::Size,
                LibraryTrackViewSortFieldRequest::CreateTime => {
                    LibraryTrackViewSortField::CreateTime
                }
                LibraryTrackViewSortFieldRequest::UpdatedTime => {
                    LibraryTrackViewSortField::UpdatedTime
                }
            },
            order: match body.sort.order {
                LibraryTrackViewSortOrderRequest::Default => LibraryTrackViewSortOrder::Default,
                LibraryTrackViewSortOrderRequest::Asc => LibraryTrackViewSortOrder::Asc,
                LibraryTrackViewSortOrderRequest::Desc => LibraryTrackViewSortOrder::Desc,
            },
        },
        selected_group_key: body.selected_group_key.clone(),
    };

    match data.app_db.library_track_groups(query) {
        Ok(view) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "revision": view.revision,
            "library_total_count": view.library_total_count,
            "library_total_size_bytes": view.library_total_size_bytes,
            "total_count": view.total_count,
            "total_size_bytes": view.total_size_bytes,
            "folders": view.folders,
            "groups": view.groups,
            "selected_group_key": view.selected_group_key,
            "rows": view.rows
        })),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn get_library_track_detail(
    data: web::Data<Arc<AppState>>,
    path: web::Path<LibraryTrackPath>,
) -> HttpResponse {
    match data.app_db.library_track_detail(path.track_key) {
        Ok(Some(detail)) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "track_key": detail.track_key,
            "item": detail.item
        })),
        Ok(None) => not_found_response("Library track not found"),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn get_library_track_cover_art(
    data: web::Data<Arc<AppState>>,
    path: web::Path<LibraryTrackPath>,
) -> HttpResponse {
    match data.app_db.media_id_for_track_key(path.track_key) {
        Ok(Some(media_id)) => get_media_cover_art_by_id(&data, &media_id),
        Ok(None) => not_found_response("Library track not found"),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn replace_queue_from_media_ids(
    data: web::Data<Arc<AppState>>,
    body: web::Json<LibraryQueueMediaIdsRequest>,
) -> HttpResponse {
    if body.media_ids.is_empty() {
        return bad_request_response("media_ids cannot be empty");
    }
    let media_ids = media_ids_with_start(&body.media_ids, body.start_media_id.as_deref());
    let rows = match data.app_db.source_paths_for_media_ids(&media_ids) {
        Ok(rows) => rows,
        Err(e) => return internal_server_error_response(e),
    };
    match play_media_queue_rows(
        &data,
        &rows,
        body.start_media_id.as_deref(),
        "Library tracks not found",
    ) {
        Ok(playback) => library_queue_playback_response(playback),
        Err(error) => error.into_response(),
    }
}

fn media_ids_with_start(media_ids: &[String], start_media_id: Option<&str>) -> Vec<String> {
    let Some(start_media_id) = start_media_id else {
        return media_ids.to_vec();
    };
    if media_ids.iter().any(|value| value == start_media_id) {
        return media_ids.to_vec();
    }

    let mut ids = Vec::with_capacity(media_ids.len() + 1);
    ids.push(start_media_id.to_string());
    ids.extend_from_slice(media_ids);
    ids
}

pub(super) async fn enqueue_queue_from_media_ids(
    data: web::Data<Arc<AppState>>,
    body: web::Json<LibraryQueueMediaIdsRequest>,
) -> HttpResponse {
    if body.media_ids.is_empty() {
        return bad_request_response("media_ids cannot be empty");
    }
    let rows = match data.app_db.source_paths_for_media_ids(&body.media_ids) {
        Ok(rows) => rows,
        Err(e) => return internal_server_error_response(e),
    };
    if rows.is_empty() {
        return not_found_response("Library tracks not found");
    }

    let paths = rows
        .into_iter()
        .map(|(_, source_path)| source_path)
        .collect::<Vec<_>>();
    match append_validated_paths_to_persistent_queue(&data, &paths) {
        Ok(entries) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "queue": entries
        })),
        Err(e) => internal_server_error_response(e),
    }
}

#[cfg(test)]
mod tests {
    use super::media_ids_with_start;

    #[test]
    fn media_ids_with_start_keeps_submitted_order_when_start_exists() {
        let ids = media_ids_with_start(
            &["a".to_string(), "b".to_string(), "c".to_string()],
            Some("b"),
        );

        assert_eq!(ids, vec!["a".to_string(), "b".to_string(), "c".to_string()]);
    }

    #[test]
    fn media_ids_with_start_prepends_missing_start_media() {
        let ids = media_ids_with_start(
            &["a".to_string(), "b".to_string(), "c".to_string()],
            Some("z"),
        );

        assert_eq!(
            ids,
            vec![
                "z".to_string(),
                "a".to_string(),
                "b".to_string(),
                "c".to_string()
            ]
        );
    }

    #[test]
    fn media_ids_with_start_leaves_ids_without_start_media() {
        let ids = media_ids_with_start(&["a".to_string(), "b".to_string(), "c".to_string()], None);

        assert_eq!(ids, vec!["a".to_string(), "b".to_string(), "c".to_string()]);
    }
}

pub(super) async fn delete_media_items(
    data: web::Data<Arc<AppState>>,
    body: web::Json<MediaItemsDeleteRequest>,
) -> HttpResponse {
    if body.media_ids.is_empty() {
        return bad_request_response("media_ids cannot be empty");
    }

    match data.app_db.delete_media_items(&body.media_ids) {
        Ok(deleted_count) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "deleted_count": deleted_count
        })),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn list_local_playlists(data: web::Data<Arc<AppState>>) -> HttpResponse {
    match data.app_db.list_local_playlists() {
        Ok(playlists) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "playlists": playlists
        })),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn create_local_playlist(
    data: web::Data<Arc<AppState>>,
    body: web::Json<LocalPlaylistCreateRequest>,
) -> HttpResponse {
    match data
        .app_db
        .create_local_playlist(&body.name, body.description.as_deref())
    {
        Ok(playlist) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "playlist": playlist
        })),
        Err(e) => bad_request_response(e),
    }
}

pub(super) async fn update_local_playlist(
    data: web::Data<Arc<AppState>>,
    path: web::Path<LocalPlaylistPath>,
    body: web::Json<LocalPlaylistUpdateRequest>,
) -> HttpResponse {
    match data.app_db.update_local_playlist(
        &path.playlist_id,
        body.name.as_deref(),
        body.description.as_deref(),
    ) {
        Ok(Some(playlist)) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "playlist": playlist
        })),
        Ok(None) => not_found_response("Local playlist not found"),
        Err(e) => bad_request_response(e),
    }
}

pub(super) async fn delete_local_playlist(
    data: web::Data<Arc<AppState>>,
    path: web::Path<LocalPlaylistPath>,
) -> HttpResponse {
    match data.app_db.delete_local_playlist(&path.playlist_id) {
        Ok(true) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success"
        })),
        Ok(false) => not_found_response("Local playlist not found"),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn get_local_playlist(
    data: web::Data<Arc<AppState>>,
    path: web::Path<LocalPlaylistPath>,
) -> HttpResponse {
    match data.app_db.get_local_playlist(&path.playlist_id) {
        Ok(Some(detail)) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "playlist": detail.playlist,
            "items": detail.items
        })),
        Ok(None) => not_found_response("Local playlist not found"),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn add_local_playlist_items(
    data: web::Data<Arc<AppState>>,
    path: web::Path<LocalPlaylistPath>,
    body: web::Json<LocalPlaylistItemsRequest>,
) -> HttpResponse {
    if body.media_ids.is_empty() {
        return bad_request_response("media_ids cannot be empty");
    }

    match data
        .app_db
        .add_media_to_local_playlist(&path.playlist_id, &body.media_ids)
    {
        Ok(added_count) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "added_count": added_count
        })),
        Err(e) if e.contains("not found") => not_found_response(e),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn remove_local_playlist_items(
    data: web::Data<Arc<AppState>>,
    path: web::Path<LocalPlaylistPath>,
    body: web::Json<LocalPlaylistItemsRequest>,
) -> HttpResponse {
    if body.media_ids.is_empty() {
        return bad_request_response("media_ids cannot be empty");
    }

    match data
        .app_db
        .remove_media_from_local_playlist(&path.playlist_id, &body.media_ids)
    {
        Ok(removed_count) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "removed_count": removed_count
        })),
        Err(e) if e.contains("not found") => not_found_response(e),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn upsert_external_media_metadata(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ExternalMediaMetadataRequest>,
) -> HttpResponse {
    let source_path = match validate_path(&body.source_path) {
        Ok(value) => value,
        Err(e) => return bad_request_response(e),
    };

    match data.app_db.record_external_media_metadata(
        &source_path,
        body.title.as_deref(),
        body.artist.as_deref(),
        body.album.as_deref(),
        body.duration_secs,
        body.external_artwork_url.as_deref(),
    ) {
        Ok(media_id) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "media_id": media_id
        })),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn get_media_cover_art(
    data: web::Data<Arc<AppState>>,
    path: web::Path<MediaPath>,
) -> HttpResponse {
    get_media_cover_art_by_id(&data, &path.media_id)
}

pub(super) async fn get_media_cover_art_by_query(
    data: web::Data<Arc<AppState>>,
    query: web::Query<MediaCoverArtQuery>,
) -> HttpResponse {
    get_media_cover_art_by_id(&data, &query.media_id)
}

pub(super) async fn resolve_current_lyrics(
    data: web::Data<Arc<AppState>>,
    body: web::Json<CurrentLyricsRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    let (current_path, runtime_lyrics, title, artist) = {
        let player = data.player.lock();
        let shared = player.shared_state();
        let current_track_path = shared.current_track_path.read().clone();
        let file_path = shared.file_path.read().clone();
        let metadata = shared.track_metadata.read();
        let lyrics = metadata.lyrics.clone();
        let title = metadata.title.clone();
        let artist = metadata.artist.clone();
        (current_track_path.or(file_path), lyrics, title, artist)
    };

    let local_override = match request.song_id {
        Some(song_id) => match read_local_override_lyrics(&request.lyric_dirs, song_id) {
            Ok(value) => value,
            Err(e) => return internal_server_error_response(e),
        },
        None => None,
    };
    if let Some((lyric_lines, source)) = local_override {
        return HttpResponse::Ok().json(lyrics::CurrentLyricsResponse::success(
            lyric_lines,
            Some(source),
        ));
    }

    let Some(path) = current_path else {
        return HttpResponse::Ok().json(lyrics::CurrentLyricsResponse::success(Vec::new(), None));
    };

    if path.starts_with("http://") || path.starts_with("https://") {
        return HttpResponse::Ok().json(lyrics::CurrentLyricsResponse::success(Vec::new(), None));
    }

    let local_lyrics = match read_current_local_lyrics(&path, runtime_lyrics.as_deref()) {
        Ok(value) => value,
        Err(e) => return internal_server_error_response(e),
    };
    if let Some((lyric_lines, source)) = local_lyrics {
        return HttpResponse::Ok().json(lyrics::CurrentLyricsResponse::success(
            lyric_lines,
            Some(source),
        ));
    }

    // Online fallback: local files with no embedded/sidecar lyrics resolve via an
    // NCM title/artist search, cached on disk so replays are instant and offline.
    if let Some(title) = title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let cache_dir = &data.runtime_paths.cache_dir;
        let artist = artist.as_deref();
        if let Some(lyric_lines) = read_cached_online_lyrics(cache_dir, title, artist) {
            return HttpResponse::Ok().json(lyrics::CurrentLyricsResponse::success(
                lyric_lines,
                Some("ncm-cache".to_string()),
            ));
        }
        let lyric_lines =
            crate::server::netease::fetch_online_lyrics_for_metadata(&data, title, artist).await;
        if !lyric_lines.is_empty() {
            write_cached_online_lyrics(cache_dir, title, artist, &lyric_lines);
            return HttpResponse::Ok().json(lyrics::CurrentLyricsResponse::success(
                lyric_lines,
                Some("ncm".to_string()),
            ));
        }
    }

    HttpResponse::Ok().json(lyrics::CurrentLyricsResponse::success(Vec::new(), None))
}

pub(super) async fn get_library_roots(data: web::Data<Arc<AppState>>) -> HttpResponse {
    match data.app_db.list_library_roots() {
        Ok(roots) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "roots": roots
        })),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn delete_library_root(
    data: web::Data<Arc<AppState>>,
    path: web::Path<LibraryRootPath>,
) -> HttpResponse {
    match data.app_db.delete_library_root(path.root_id) {
        Ok(Some((root_path, removed_media_count))) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "root_path": root_path,
            "removed_media_count": removed_media_count
        })),
        Ok(None) => not_found_response("Library root not found"),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn get_library_scan_task(
    data: web::Data<Arc<AppState>>,
    path: web::Path<ScanTaskPath>,
) -> HttpResponse {
    match data.app_db.get_analysis_task(path.task_id) {
        Ok(Some(task)) if task.task_type == "library_scan" => {
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "task_id": task.task_id,
                "task": task
            }))
        }
        Ok(Some(_)) | Ok(None) => not_found_response("Library scan task not found"),
        Err(e) => internal_server_error_response(e),
    }
}

pub(super) async fn cancel_library_scan_task(
    data: web::Data<Arc<AppState>>,
    path: web::Path<ScanTaskPath>,
) -> HttpResponse {
    let task_id = path.task_id;
    cancel_scan_task_token(&data, task_id);

    let task = match data.app_db.get_analysis_task(task_id) {
        Ok(Some(task)) if task.task_type == "library_scan" => task,
        Ok(Some(_)) | Ok(None) => return not_found_response("Library scan task not found"),
        Err(e) => return internal_server_error_response(e),
    };

    match task.status.as_str() {
        "queued" | "running" | "scanning" => {
            let updated_at = now_epoch_secs();
            if let Some(root_id) = task
                .result
                .as_ref()
                .and_then(|value| value.get("root_id").and_then(|root_id| root_id.as_i64()))
            {
                let _ = data.app_db.update_library_root_scan_status(
                    root_id,
                    "canceled",
                    None,
                    None,
                    Some(updated_at),
                );
            }
            persist_library_scan_task(
                &data,
                task_id,
                &task.source_path,
                "canceled",
                task.created_at_epoch_secs,
                updated_at,
                task.result.as_ref(),
                Some("Canceled by client"),
            );
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "task_id": task_id,
                "message": "Library scan task canceled"
            }))
        }
        _ => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "task_id": task_id,
            "message": "Task already finished"
        })),
    }
}

pub(super) async fn scan_library_root(
    data: web::Data<Arc<AppState>>,
    body: web::Json<LibraryScanRequest>,
) -> HttpResponse {
    let permit = match Arc::clone(&data.analysis.library_scan_semaphore).try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => {
            return too_many_requests_response(
                "Too many library scans in progress, please retry later",
            );
        }
    };
    let started_at = now_epoch_secs();
    let scan_task_id = data
        .analysis
        .scan_task_counter
        .fetch_add(1, Ordering::Relaxed)
        + 1;
    let requested_path = body.path.trim();
    let is_remote = requested_path.starts_with("http://")
        || requested_path.starts_with("https://")
        || requested_path.starts_with('/');
    let path = if is_remote {
        requested_path.to_string()
    } else {
        match validate_path(requested_path) {
            Ok(value) => value,
            Err(e) => return bad_request_response(e),
        }
    };

    let display_name = body.display_name.clone().unwrap_or_else(|| {
        std::path::Path::new(&path)
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.to_string())
            .unwrap_or_else(|| path.clone())
    });
    let source_kind = if is_remote { "webdav" } else { "local" };
    let source_key = body
        .source_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let root_id = match data.app_db.upsert_library_root(
        source_key.as_deref(),
        &path,
        source_kind,
        &display_name,
        "scanning",
    ) {
        Ok(value) => value,
        Err(e) => return internal_server_error_response(e),
    };

    if let Err(e) = data.app_db.update_library_root_scan_status(
        root_id,
        "scanning",
        None,
        Some(now_epoch_secs()),
        None,
    ) {
        return internal_server_error_response(e);
    }
    persist_library_scan_task(
        &data,
        scan_task_id,
        &path,
        "scanning",
        started_at,
        started_at,
        Some(&serde_json::json!({
            "root_id": root_id,
            "source_kind": source_kind,
            "source_key": source_key.as_deref(),
            "display_name": display_name,
        })),
        None,
    );

    let cancel_token = AnalysisCancelToken::new();
    register_scan_task_cancel(&data, scan_task_id, cancel_token.clone());

    let data_for_task = data.clone();
    let path_for_task = path.clone();
    let display_name_for_task = display_name.clone();
    let source_kind_for_task = source_kind.to_string();
    let source_key_for_task = source_key.clone();

    actix_web::rt::task::spawn_blocking(move || {
        let _permit = permit;
        let result = if source_kind_for_task == "local" {
            scan_local_library(
                &data_for_task,
                scan_task_id,
                started_at,
                root_id,
                &path_for_task,
                cancel_token.clone(),
            )
        } else {
            scan_webdav_library(
                &data_for_task,
                scan_task_id,
                started_at,
                root_id,
                &path_for_task,
                source_key_for_task.as_deref(),
                cancel_token.clone(),
            )
        };

        match result {
            Ok(outcome) => {
                let finished_at = now_epoch_secs();
                let payload = serde_json::json!({
                    "root_id": root_id,
                    "source_kind": source_kind_for_task,
                    "source_key": source_key_for_task.as_deref(),
                    "display_name": display_name_for_task,
                    "scanned_files": outcome.scanned_files,
                    "indexed_files": outcome.indexed_files,
                    "removed_files": outcome.removed_files,
                });
                persist_library_scan_task(
                    &data_for_task,
                    scan_task_id,
                    &path_for_task,
                    "success",
                    started_at,
                    finished_at,
                    Some(&payload),
                    None,
                );
            }
            Err(e) => {
                let finished_at = now_epoch_secs();
                let status = if is_analysis_cancelled_error(&e) {
                    "canceled"
                } else {
                    "error"
                };
                let _ = data_for_task.app_db.update_library_root_scan_status(
                    root_id,
                    status,
                    None,
                    None,
                    Some(finished_at),
                );
                persist_library_scan_task(
                    &data_for_task,
                    scan_task_id,
                    &path_for_task,
                    status,
                    started_at,
                    finished_at,
                    Some(&serde_json::json!({
                        "root_id": root_id,
                        "source_kind": source_kind_for_task,
                        "source_key": source_key_for_task.as_deref(),
                        "display_name": display_name_for_task,
                    })),
                    Some(&e),
                );
            }
        }
        remove_scan_task_cancel(&data_for_task, scan_task_id);
        clear_local_scan_seen_set(&data_for_task, scan_task_id);
    });

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "task_id": scan_task_id,
        "root_id": root_id,
        "scanned_files": 0,
        "indexed_files": 0
    }))
}

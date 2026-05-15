use super::*;
use crate::app_database::{LibrarySortField, LibrarySortOrder, LibraryTrackQuery};
use actix_web::HttpResponse;

pub(super) fn build_library_query(body: &LibraryQueueQueryRequest) -> LibraryTrackQuery {
    LibraryTrackQuery {
        search: body.search.as_ref().and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }),
        folder_path: body.folder_path.as_ref().and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }),
        sort_field: parse_library_sort_field(body.sort_field.as_deref()),
        sort_order: parse_library_sort_order(body.sort_order.as_deref()),
    }
}

fn parse_library_sort_field(value: Option<&str>) -> LibrarySortField {
    match value.unwrap_or("default") {
        "title" => LibrarySortField::Title,
        "album" => LibrarySortField::Album,
        "duration" => LibrarySortField::Duration,
        "size" => LibrarySortField::Size,
        _ => LibrarySortField::Default,
    }
}

fn parse_library_sort_order(value: Option<&str>) -> LibrarySortOrder {
    match value.unwrap_or("default") {
        "asc" => LibrarySortOrder::Asc,
        "desc" => LibrarySortOrder::Desc,
        _ => LibrarySortOrder::Default,
    }
}

fn load_replaced_queue_at_position(
    data: &web::Data<Arc<AppState>>,
    paths: &[String],
    start_index: usize,
) -> Result<StateResponse, String> {
    if paths.is_empty() {
        return Err("No library tracks matched the current view".to_string());
    }
    data.app_db.replace_queue_entries("active", paths)?;
    let entry = data
        .app_db
        .queue_entry_at_position("active", start_index as i64)?
        .ok_or_else(|| "Queue entry not found after replacing library queue".to_string())?;
    let (state, _) = load_queue_entry_for_playback(data, entry, true)
        .map_err(|e| format!("Failed to play queue entry: {}", e))?;
    Ok(state)
}

fn library_queue_start_index(
    rows: &[LibraryQueueRow],
    start_track_key: Option<i64>,
    missing_start_message: &str,
) -> Result<usize, LibraryQueueFailure> {
    match start_track_key {
        Some(track_key) => rows
            .iter()
            .position(|(row_track_key, _)| *row_track_key == track_key)
            .ok_or_else(|| LibraryQueueFailure::NotFound(missing_start_message.to_string())),
        None => Ok(0),
    }
}

fn validate_library_queue_paths(paths: &[String]) -> Result<Vec<String>, String> {
    let mut validated = Vec::with_capacity(paths.len());
    for path in paths {
        validated.push(validate_path(path)?);
    }
    Ok(validated)
}

pub(super) fn play_library_queue_rows(
    data: &web::Data<Arc<AppState>>,
    rows: &[LibraryQueueRow],
    start_track_key: Option<i64>,
    empty_message: &str,
    missing_start_message: &str,
) -> Result<LibraryQueuePlayback, LibraryQueueFailure> {
    if rows.is_empty() {
        return Err(LibraryQueueFailure::NotFound(empty_message.to_string()));
    }
    let start_index = library_queue_start_index(rows, start_track_key, missing_start_message)?;
    let paths = rows
        .iter()
        .map(|(_, source_path)| source_path.clone())
        .collect::<Vec<_>>();
    let validated_paths =
        validate_library_queue_paths(&paths).map_err(LibraryQueueFailure::BadRequest)?;
    let state = load_replaced_queue_at_position(data, &validated_paths, start_index)
        .map_err(LibraryQueueFailure::Internal)?;
    Ok(LibraryQueuePlayback {
        state,
        queued_count: validated_paths.len(),
    })
}

pub(super) fn library_queue_playback_response(playback: LibraryQueuePlayback) -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "state": playback.state,
        "queued_count": playback.queued_count
    }))
}

#[cfg(test)]
mod tests {
    use super::library_queue_start_index;
    use crate::server::playback::types::LibraryQueueFailure;

    #[test]
    fn library_queue_start_index_defaults_to_first_track() {
        let rows = vec![
            (10, "D:/music/a.flac".to_string()),
            (20, "D:/music/b.flac".to_string()),
        ];

        let start_index = library_queue_start_index(&rows, None, "missing").unwrap();

        assert_eq!(start_index, 0);
    }

    #[test]
    fn library_queue_start_index_finds_requested_track() {
        let rows = vec![
            (10, "D:/music/a.flac".to_string()),
            (20, "D:/music/b.flac".to_string()),
        ];

        let start_index = library_queue_start_index(&rows, Some(20), "missing").unwrap();

        assert_eq!(start_index, 1);
    }

    #[test]
    fn library_queue_start_index_rejects_missing_requested_track() {
        let rows = vec![(10, "D:/music/a.flac".to_string())];

        let error = library_queue_start_index(&rows, Some(20), "missing track").unwrap_err();

        match error {
            LibraryQueueFailure::NotFound(message) => assert_eq!(message, "missing track"),
            other => panic!("expected NotFound, got {other:?}"),
        }
    }
}

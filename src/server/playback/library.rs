use super::*;
use actix_web::HttpResponse;

pub(super) fn load_replaced_queue_at_position(
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

fn media_queue_start_index(
    rows: &[MediaQueueRow],
    start_media_id: Option<&str>,
) -> Result<usize, LibraryQueueFailure> {
    let Some(media_id) = start_media_id else {
        return Ok(0);
    };
    let normalized_media_id = crate::app_database::media_id_for_path(media_id);
    rows.iter()
        .position(|(row_media_id, _)| {
            crate::app_database::media_id_for_path(row_media_id) == normalized_media_id
        })
        .ok_or_else(|| {
            LibraryQueueFailure::NotFound(format!(
                "Library queue start media '{}' is no longer in the resolved view",
                media_id
            ))
        })
}

fn validate_library_queue_paths(paths: &[String]) -> Result<Vec<String>, String> {
    let mut validated = Vec::with_capacity(paths.len());
    for path in paths {
        validated.push(validate_path(path)?);
    }
    Ok(validated)
}

pub(super) fn play_media_queue_rows(
    data: &web::Data<Arc<AppState>>,
    rows: &[MediaQueueRow],
    start_media_id: Option<&str>,
    empty_message: &str,
) -> Result<LibraryQueuePlayback, LibraryQueueFailure> {
    if rows.is_empty() {
        return Err(LibraryQueueFailure::NotFound(empty_message.to_string()));
    }
    let start_index = media_queue_start_index(rows, start_media_id)?;
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
    use super::{media_queue_start_index, LibraryQueueFailure};

    #[test]
    fn media_queue_start_index_defaults_to_first_track() {
        let rows = vec![
            ("media-a".to_string(), "D:/music/a.flac".to_string()),
            ("media-b".to_string(), "D:/music/b.flac".to_string()),
        ];

        let start_index = media_queue_start_index(&rows, None).unwrap();

        assert_eq!(start_index, 0);
    }

    #[test]
    fn media_queue_start_index_finds_requested_media_id() {
        let rows = vec![
            ("media-a".to_string(), "D:/music/a.flac".to_string()),
            ("media-b".to_string(), "D:/music/b.flac".to_string()),
        ];

        let start_index = media_queue_start_index(&rows, Some("media-b")).unwrap();

        assert_eq!(start_index, 1);
    }

    #[test]
    fn media_queue_start_index_matches_forward_slash_extended_windows_media_id() {
        let rows = vec![
            ("d:/music/a.flac".to_string(), "D:/music/a.flac".to_string()),
            (
                "d:/music/artist/track.flac".to_string(),
                "D:/Music/Artist/Track.flac".to_string(),
            ),
        ];

        let start_index =
            media_queue_start_index(&rows, Some("//?/D:/Music/Artist/Track.FLAC")).unwrap();

        assert_eq!(start_index, 1);
    }

    #[test]
    fn media_queue_start_index_rejects_missing_explicit_media() {
        let rows = vec![("media-a".to_string(), "D:/music/a.flac".to_string())];

        let error = media_queue_start_index(&rows, Some("media-b")).unwrap_err();

        match error {
            LibraryQueueFailure::NotFound(message) => assert!(message.contains("media-b")),
            other => panic!("unexpected error: {:?}", other),
        }
    }
}

use super::*;
use crate::app_database::QueueEntryInput;
use crate::playlist;
use actix_web::{web, HttpResponse};

fn public_playlist_queue_entries(entries: &[playlist::PlaylistEntry]) -> Vec<QueueEntryInput> {
    entries
        .iter()
        .map(|entry| QueueEntryInput::public(entry.path.clone()))
        .collect()
}

pub(super) async fn load_playlist(
    data: web::Data<Arc<AppState>>,
    body: web::Json<PlaylistLoadRequest>,
) -> HttpResponse {
    let result = match playlist::load_playlist(&body.path, validate_path) {
        Ok(result) => result,
        Err(e) => return bad_request_response(e),
    };

    let queue_entries = public_playlist_queue_entries(&result.entries);

    let update_result = match body.mode {
        PlaylistLoadMode::ParseOnly => Ok(()),
        PlaylistLoadMode::Append => data
            .app_db
            .append_queue_entries_with_sources("active", &queue_entries),
        PlaylistLoadMode::Replace => data
            .app_db
            .replace_queue_entries_with_sources("active", &queue_entries),
    };

    match update_result {
        Ok(()) => {
            if !matches!(body.mode, PlaylistLoadMode::ParseOnly) {
                emit_queue_updated(&data);
            }
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "tracks": result.entries,
                "count": queue_entries.len(),
                "rejected": result.rejected
            }))
        }
        Err(e) => internal_server_error_response(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::test_app_state_for_analysis;
    use crate::webdav::WebDavConfig;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn playlist_test_dir() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "audio-player-playlist-source-{}-{nonce}",
            std::process::id()
        ))
    }

    fn add_webdav_membership(data: &AppState, media_url: &str) {
        data.app_db
            .upsert_webdav_source(
                "nas",
                "NAS",
                &WebDavConfig {
                    base_url: "https://media.example.test/dav/music".to_string(),
                    username: Some("alice".to_string()),
                    password: Some("secret".to_string()),
                },
                true,
            )
            .unwrap();
        let root_id = data
            .app_db
            .upsert_library_root(Some("nas"), "/music", "webdav", "NAS", "completed")
            .unwrap();
        let media_id = data.app_db.record_media_stub(media_url).unwrap();
        data.app_db.begin_library_scan_seen_set(1).unwrap();
        data.app_db
            .mark_library_scan_seen_media_ids(1, &[media_id])
            .unwrap();
        data.app_db
            .finalize_library_root_scan(root_id, 1, 1)
            .unwrap();
    }

    fn assert_public_queue_entry(data: &AppState, media_url: &str) {
        let entries = data.app_db.list_queue_entries("active").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source_path, media_url);
        assert!(entries[0].source_key.is_none());
        assert_eq!(entries[0].source_identity, "public");
    }

    #[actix_web::test]
    async fn playlist_append_and_replace_persist_public_source_identity() {
        let temp_dir = playlist_test_dir();
        std::fs::create_dir_all(&temp_dir).unwrap();
        let playlist_path = temp_dir.join("public.m3u");
        let media_url = "https://media.example.test/dav/music/song.flac";
        std::fs::write(&playlist_path, format!("{media_url}\n")).unwrap();

        let data = web::Data::new(test_app_state_for_analysis(&temp_dir, 1, 1));
        add_webdav_membership(data.get_ref(), media_url);

        let queue_entries = public_playlist_queue_entries(&[playlist::PlaylistEntry {
            path: media_url.to_string(),
            title: None,
            duration: None,
        }]);
        assert_eq!(queue_entries.len(), 1);
        assert!(queue_entries[0].source_key.is_none());
        assert!(!queue_entries[0].infer_source_key);

        let append_response = load_playlist(
            data.clone(),
            web::Json(PlaylistLoadRequest {
                path: playlist_path.to_string_lossy().into_owned(),
                mode: PlaylistLoadMode::Append,
            }),
        )
        .await;
        assert!(append_response.status().is_success());
        assert_public_queue_entry(data.get_ref(), media_url);

        let replace_response = load_playlist(
            data.clone(),
            web::Json(PlaylistLoadRequest {
                path: playlist_path.to_string_lossy().into_owned(),
                mode: PlaylistLoadMode::Replace,
            }),
        )
        .await;
        assert!(replace_response.status().is_success());
        assert_public_queue_entry(data.get_ref(), media_url);

        std::fs::remove_dir_all(temp_dir).unwrap();
    }
}

use super::*;
use crate::playlist;
use actix_web::{web, HttpResponse};

pub(super) async fn load_playlist(
    data: web::Data<Arc<AppState>>,
    body: web::Json<PlaylistLoadRequest>,
) -> HttpResponse {
    let result = match playlist::load_playlist(&body.path, validate_path) {
        Ok(result) => result,
        Err(e) => return bad_request_response(e),
    };

    let paths: Vec<String> = result
        .entries
        .iter()
        .map(|entry| entry.path.clone())
        .collect();

    let update_result = match body.mode {
        PlaylistLoadMode::ParseOnly => Ok(()),
        PlaylistLoadMode::Append => data.app_db.append_queue_entries("active", &paths),
        PlaylistLoadMode::Replace => data.app_db.replace_queue_entries("active", &paths),
    };

    match update_result {
        Ok(()) => {
            if !matches!(body.mode, PlaylistLoadMode::ParseOnly) {
                emit_queue_updated(&data);
            }
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "tracks": result.entries,
                "count": paths.len(),
                "rejected": result.rejected
            }))
        }
        Err(e) => internal_server_error_response(e),
    }
}

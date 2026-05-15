use super::*;
use actix_web::{web, HttpResponse};

pub(super) fn cleanup_scan_tasks(data: &web::Data<Arc<AppState>>) {
    let now = now_epoch_secs();
    let ttl = data.scan_task_ttl_secs;
    let max_entries = data.scan_task_max_entries;

    let mut tasks = data.scan_tasks.lock();

    tasks.retain(|_, task| {
        let finished = task.status == "success" || task.status == "error";
        if !finished {
            return true;
        }
        now.saturating_sub(task.updated_at_epoch_secs) <= ttl
    });

    if tasks.len() > max_entries {
        let mut entries: Vec<(u64, bool, u64)> = tasks
            .iter()
            .map(|(id, task)| {
                let finished = task.status == "success" || task.status == "error";
                (*id, finished, task.updated_at_epoch_secs)
            })
            .collect();

        entries.sort_by_key(|(_, finished, updated_at)| (!*finished, *updated_at));
        let remove_count = tasks.len().saturating_sub(max_entries);

        for (id, _, _) in entries.into_iter().take(remove_count) {
            tasks.remove(&id);
        }
    }
}

pub(super) fn upsert_scan_task_record(
    data: &web::Data<Arc<AppState>>,
    task_id: u64,
    source_path: &str,
    task: &ScanTaskRecord,
    store_result: bool,
) {
    if let Err(e) = data.app_db.upsert_analysis_task(
        task_id,
        "scan_loudness",
        source_path,
        &task.status,
        store_result,
        task.created_at_epoch_secs,
        task.updated_at_epoch_secs,
        task.result.as_ref(),
        task.error.as_deref(),
    ) {
        log::warn!("Failed to persist scan task {}: {}", task_id, e);
    }
}

pub(super) fn persist_library_scan_task(
    data: &web::Data<Arc<AppState>>,
    task_id: u64,
    source_path: &str,
    status: &str,
    created_at_epoch_secs: u64,
    updated_at_epoch_secs: u64,
    result: Option<&serde_json::Value>,
    error: Option<&str>,
) {
    if let Err(e) = data.app_db.upsert_analysis_task(
        task_id,
        "library_scan",
        source_path,
        status,
        true,
        created_at_epoch_secs,
        updated_at_epoch_secs,
        result,
        error,
    ) {
        log::warn!("Failed to persist library scan task {}: {}", task_id, e);
    }
}

pub(super) fn task_is_canceled(data: &web::Data<Arc<AppState>>, task_id: u64) -> bool {
    data.scan_tasks
        .lock()
        .get(&task_id)
        .map(|task| task.status == "canceled")
        .unwrap_or(false)
}

pub(super) fn analysis_error_response(e: &str) -> HttpResponse {
    if e.to_ascii_lowercase().contains("timed out") {
        gateway_timeout_response(e)
    } else {
        internal_server_error_response(e)
    }
}

pub(super) fn is_supported_media_path(path: &std::path::Path) -> bool {
    const SUPPORTED_EXTENSIONS: &[&str] = &[
        "mp3", "flac", "wav", "aac", "m4a", "ogg", "opus", "wma", "ape", "wv", "alac", "aiff",
        "aif", "dsf", "dff", "mpc", "tak", "tta", "ac3", "dts", "thd", "truehd", "mka", "mkv",
        "mp4", "m4v", "mov", "webm", "asf", "amr", "au", "ra", "rm", "3gp",
    ];

    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            SUPPORTED_EXTENSIONS
                .iter()
                .any(|candidate| candidate.eq_ignore_ascii_case(ext))
        })
        .unwrap_or(false)
}

pub(super) fn is_supported_media_href(path: &str) -> bool {
    const SUPPORTED_EXTENSIONS: &[&str] = &[
        "flac", "mp3", "wav", "m4a", "aac", "ogg", "opus", "aiff", "aif", "wma", "alac",
    ];

    let trimmed = path.split('?').next().unwrap_or(path).trim_end_matches('/');
    let ext = trimmed.rsplit('.').next().unwrap_or("");
    SUPPORTED_EXTENSIONS
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(ext))
}

pub(super) fn track_loudness_to_json(
    track_loudness: &crate::processor::TrackLoudness,
) -> serde_json::Value {
    serde_json::json!({
        "track_id": track_loudness.track_id,
        "file_path": track_loudness.file_path,
        "integrated_lufs": track_loudness.integrated_lufs,
        "true_peak_dbtp": track_loudness.true_peak_dbtp,
        "loudness_range": track_loudness.loudness_range,
        "track_gain_db": track_loudness.track_gain_db,
    })
}

pub(super) fn try_get_cached_loudness(
    data: &web::Data<Arc<AppState>>,
    path: &str,
) -> Option<crate::processor::TrackLoudness> {
    let db_guard = data.loudness_db.lock();
    let db = db_guard.as_ref()?;

    match db.needs_scan(path) {
        Ok(false) => match db.get(path) {
            Ok(Some(track)) => {
                log::info!("Using cached loudness for: {}", path);
                Some(track)
            }
            Ok(None) => None,
            Err(e) => {
                log::warn!("Loudness cache read failed for '{}': {}", path, e);
                None
            }
        },
        Ok(true) => None,
        Err(e) => {
            log::warn!("Loudness cache validation failed for '{}': {}", path, e);
            None
        }
    }
}

pub(super) fn try_store_loudness(
    data: &web::Data<Arc<AppState>>,
    track: &crate::processor::TrackLoudness,
) {
    let db_guard = data.loudness_db.lock();
    if let Some(db) = db_guard.as_ref() {
        if let Err(e) = db.upsert(track) {
            log::warn!(
                "Failed to store loudness cache for '{}': {}",
                track.file_path,
                e
            );
        }
    }
}

pub(super) fn analyze_track_loudness(
    path: String,
    credentials: Option<crate::decoder::HttpCredentials>,
) -> Result<crate::processor::TrackLoudness, String> {
    use crate::decoder::StreamingDecoder;
    use crate::processor::{LoudnessMeter, TrackLoudness, DEFAULT_STREAMING_TARGET_LUFS};

    let mut decoder = StreamingDecoder::open_with_credentials(&path, credentials.as_ref())
        .map_err(|e| format!("Failed to open file: {}", e))?;

    let sample_rate = decoder.info.sample_rate;
    let channels = decoder.info.channels;
    let mut meter = LoudnessMeter::new(channels, sample_rate);

    let mut total_samples = 0usize;
    while let Some(chunk) = decoder.decode_next().map_err(|e| e.to_string())? {
        meter.process(&chunk);
        total_samples += chunk.len();
    }

    let integrated_lufs = meter.integrated_loudness();
    let integrated_lufs = if integrated_lufs.is_finite() {
        integrated_lufs
    } else {
        -70.0
    };
    let loudness_range = meter.loudness_range();
    let true_peak_linear = meter.true_peak().max(1e-10);
    let true_peak_dbtp = 20.0 * true_peak_linear.log10();

    let track_loudness = TrackLoudness::new(
        &path,
        integrated_lufs,
        true_peak_dbtp,
        if loudness_range > 0.0 {
            Some(loudness_range)
        } else {
            None
        },
        DEFAULT_STREAMING_TARGET_LUFS,
    );

    log::info!(
        "Loudness scan complete: {} -> {:.1} LUFS, {:.1} dBTP, {} samples",
        path,
        integrated_lufs,
        true_peak_dbtp,
        total_samples
    );

    Ok(track_loudness)
}

#[cfg(test)]
mod tests {
    use super::{analysis_error_response, is_supported_media_href, is_supported_media_path};
    use std::path::Path;

    #[test]
    fn supported_media_checks_match_common_extensions() {
        assert!(is_supported_media_path(Path::new("D:/music/test.FLAC")));
        assert!(is_supported_media_href(
            "https://example.com/audio/test.m4a"
        ));
        assert!(!is_supported_media_href("https://example.com/readme.txt"));
    }

    #[test]
    fn timeout_analysis_errors_map_to_gateway_timeout() {
        let response = analysis_error_response("operation timed out after 30s");
        assert_eq!(response.status(), 504);
    }
}

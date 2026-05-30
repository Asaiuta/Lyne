use super::*;
use actix_web::{web, HttpResponse};

pub(super) fn cleanup_scan_tasks(data: &web::Data<Arc<AppState>>) {
    let now = now_epoch_secs();
    let ttl = data.analysis.scan_task_ttl_secs;
    let max_entries = data.analysis.scan_task_max_entries;
    let mut removed_task_ids = Vec::new();

    let mut tasks = data.analysis.scan_tasks.lock();

    tasks.retain(|task_id, task| {
        let finished = is_terminal_scan_status(&task.status);
        if !finished {
            return true;
        }
        let keep = now.saturating_sub(task.updated_at_epoch_secs) <= ttl;
        if !keep {
            removed_task_ids.push(*task_id);
        }
        keep
    });

    if tasks.len() > max_entries {
        let mut entries: Vec<(u64, bool, u64)> = tasks
            .iter()
            .map(|(id, task)| {
                let finished = is_terminal_scan_status(&task.status);
                (*id, finished, task.updated_at_epoch_secs)
            })
            .collect();

        entries.sort_by_key(|(_, finished, updated_at)| (!*finished, *updated_at));
        let remove_count = tasks.len().saturating_sub(max_entries);

        for (id, _, _) in entries.into_iter().take(remove_count) {
            if tasks.remove(&id).is_some() {
                removed_task_ids.push(id);
            }
        }
    }

    let live_task_ids: std::collections::HashSet<u64> = tasks.keys().copied().collect();
    drop(tasks);
    let mut cancels = data.analysis.scan_task_cancels.lock();
    for task_id in removed_task_ids {
        cancels.remove(&task_id);
    }
    cancels.retain(|task_id, _| live_task_ids.contains(task_id));
}

fn is_terminal_scan_status(status: &str) -> bool {
    matches!(status, "success" | "error" | "canceled" | "timeout")
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
    data.analysis
        .scan_tasks
        .lock()
        .get(&task_id)
        .map(|task| task.status == "canceled")
        .unwrap_or(false)
}

pub(super) fn register_scan_task_cancel(
    data: &web::Data<Arc<AppState>>,
    task_id: u64,
    token: AnalysisCancelToken,
) {
    data.analysis
        .scan_task_cancels
        .lock()
        .insert(task_id, token);
}

pub(super) fn remove_scan_task_cancel(data: &web::Data<Arc<AppState>>, task_id: u64) {
    data.analysis.scan_task_cancels.lock().remove(&task_id);
}

pub(super) fn cancel_scan_task_token(data: &web::Data<Arc<AppState>>, task_id: u64) {
    if let Some(token) = data.analysis.scan_task_cancels.lock().get(&task_id) {
        token.cancel();
    }
}

pub(super) fn analysis_error_response(e: &str) -> HttpResponse {
    if is_analysis_timeout_error(e) {
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
    let db = data.analysis.loudness_db.as_ref()?;

    match db.get_fresh(path) {
        Ok(Some(track)) => {
            log::info!("Using cached loudness for: {}", path);
            Some(track)
        }
        Ok(None) => None,
        Err(e) => {
            log::warn!("Loudness cache read failed for '{}': {}", path, e);
            None
        }
    }
}

pub(super) fn try_store_loudness(
    data: &web::Data<Arc<AppState>>,
    track: &crate::processor::TrackLoudness,
) {
    if let Some(db) = data.analysis.loudness_db.as_ref() {
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
    cancel_token: AnalysisCancelToken,
) -> Result<crate::processor::TrackLoudness, String> {
    use crate::decoder::StreamingDecoder;
    use crate::processor::{LoudnessMeter, TrackLoudness, DEFAULT_STREAMING_TARGET_LUFS};

    cancel_token.check()?;
    let mut decoder = StreamingDecoder::open_with_credentials_and_cancel(
        &path,
        credentials.as_ref(),
        Some(cancel_token.decode_token()),
    )
    .map_err(|e| format!("Failed to open file: {}", e))?;

    let sample_rate = decoder.info.sample_rate;
    let channels = decoder.info.channels;
    let mut meter = LoudnessMeter::new(channels, sample_rate);

    let mut total_samples = 0usize;
    let mut chunk = Vec::new();
    loop {
        cancel_token.check()?;
        chunk.clear();
        let Some(sample_count) = decoder
            .decode_next_into(&mut chunk)
            .map_err(|e| e.to_string())?
        else {
            break;
        };
        if sample_count == 0 {
            continue;
        }
        meter.process(&chunk);
        total_samples += sample_count;
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

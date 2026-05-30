use super::*;
use actix_web::{web, HttpResponse};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::fs;
use std::sync::OnceLock;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct AutomixCacheKey {
    path: String,
    mode: crate::processor::AutomixAnalysisMode,
    max_analyze_time_millis: u64,
    len: u64,
    modified_epoch_millis: u128,
}

static AUTOMIX_ANALYSIS_CACHE: OnceLock<
    Mutex<HashMap<AutomixCacheKey, crate::processor::AutomixAnalysis>>,
> = OnceLock::new();

pub(super) async fn analyze_automix_track(
    data: web::Data<Arc<AppState>>,
    body: web::Json<AutomixAnalyzeRequest>,
) -> HttpResponse {
    let path = match validate_path(&body.path) {
        Ok(p) => p,
        Err(e) => return bad_request_response(e),
    };
    let options = crate::processor::AutomixAnalysisOptions {
        mode: body.mode,
        max_analyze_time_sec: body.max_analyze_time_sec.unwrap_or(60.0),
    }
    .normalized();
    let cache_key = automix_cache_key(&path, options.mode, options.max_analyze_time_sec);

    if let Some(cache_key) = cache_key.as_ref() {
        if let Some(analysis) = get_cached_automix(cache_key) {
            return HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "source": "cache",
                "analysis": analysis,
            }));
        }
    }

    let credentials = {
        let cfg = data.webdav_config.lock();
        cfg.http_credentials()
    };
    let path_for_job = path.clone();
    let credentials_for_job = credentials.clone();
    let options_for_job = options.clone();

    let result = run_analysis_job(&data, move |cancel_token| {
        crate::processor::analyze_automix_with_cancel(
            path_for_job,
            credentials_for_job,
            options_for_job,
            Some(cancel_token.decode_token()),
        )
    })
    .await;

    match result {
        Ok(analysis) => {
            if let Some(cache_key) = cache_key {
                store_cached_automix(cache_key, analysis.clone());
            }
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "source": "fresh",
                "analysis": analysis,
            }))
        }
        Err(e) => analysis_error_response(&e),
    }
}

fn automix_cache() -> &'static Mutex<HashMap<AutomixCacheKey, crate::processor::AutomixAnalysis>> {
    AUTOMIX_ANALYSIS_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_cached_automix(key: &AutomixCacheKey) -> Option<crate::processor::AutomixAnalysis> {
    automix_cache().lock().get(key).cloned()
}

fn store_cached_automix(key: AutomixCacheKey, analysis: crate::processor::AutomixAnalysis) {
    automix_cache().lock().insert(key, analysis);
}

fn automix_cache_key(
    path: &str,
    mode: crate::processor::AutomixAnalysisMode,
    max_analyze_time_sec: f64,
) -> Option<AutomixCacheKey> {
    let metadata = fs::metadata(path).ok()?;
    let modified_epoch_millis = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0);

    Some(AutomixCacheKey {
        path: path.to_string(),
        mode,
        max_analyze_time_millis: (max_analyze_time_sec * 1_000.0).round() as u64,
        len: metadata.len(),
        modified_epoch_millis,
    })
}

#[cfg(test)]
mod tests {
    use super::automix_cache_key;
    use crate::processor::AutomixAnalysisMode;
    use std::fs::{self, OpenOptions};
    use std::io::Write;

    #[test]
    fn automix_cache_key_changes_when_file_changes() {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "audioplayer-automix-cache-key-{}.tmp",
            std::process::id()
        ));
        fs::write(&path, b"head").unwrap();
        let path_str = path.to_string_lossy().to_string();
        let first = automix_cache_key(&path_str, AutomixAnalysisMode::Full, 60.0).unwrap();

        let mut file = OpenOptions::new().append(true).open(&path).unwrap();
        file.write_all(b"-tail").unwrap();
        file.flush().unwrap();

        let second = automix_cache_key(&path_str, AutomixAnalysisMode::Full, 60.0).unwrap();
        fs::remove_file(&path).unwrap();

        assert_ne!(first, second);
    }

    #[test]
    fn automix_cache_key_separates_head_and_full_modes() {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "audioplayer-automix-cache-mode-{}.tmp",
            std::process::id()
        ));
        fs::write(&path, b"same").unwrap();
        let path_str = path.to_string_lossy().to_string();

        let head = automix_cache_key(&path_str, AutomixAnalysisMode::Head, 60.0).unwrap();
        let full = automix_cache_key(&path_str, AutomixAnalysisMode::Full, 60.0).unwrap();
        fs::remove_file(&path).unwrap();

        assert_ne!(head, full);
    }
}

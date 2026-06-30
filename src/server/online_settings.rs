//! Application-level online settings (NetEase Cloud Music resolve/cache).
//!
//! Deliberately separate from `EngineSettings` / `PersistentSettings`, which map
//! to the audio-engine-core DSP config (a git dependency). These knobs are app
//! concerns — online audio cache, quality fallback, trial playback — so they
//! live in their own JSON file and manager.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use actix_web::{web, HttpResponse};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use super::AppState;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct OnlineSettings {
    /// Cache resolved NCM streams to disk for instant re-play.
    pub cache_enabled: bool,
    /// Byte budget for the online audio cache (LRU eviction beyond this).
    pub cache_max_bytes: u64,
    /// Descend the quality ladder when the requested tier is unavailable.
    pub quality_fallback_enabled: bool,
    /// Allow playing trial-only (grey) previews instead of treating them as
    /// unavailable.
    pub allow_trial_playback: bool,
    /// Quality tier used when a resolve request does not specify one.
    pub default_level: String,
}

impl Default for OnlineSettings {
    fn default() -> Self {
        Self {
            cache_enabled: true,
            cache_max_bytes: super::netease::DEFAULT_NCM_AUDIO_CACHE_MAX_BYTES,
            quality_fallback_enabled: true,
            allow_trial_playback: false,
            default_level: "exhigh".to_string(),
        }
    }
}

impl OnlineSettings {
    fn load_from_file(path: &Path) -> Self {
        match std::fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|err| {
                log::warn!("Invalid online settings ({}); using defaults", err);
                Self::default()
            }),
            Err(_) => Self::default(),
        }
    }

    fn save(&self, path: &Path) -> Result<(), String> {
        let text = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::write(path, text).map_err(|e| e.to_string())
    }
}

/// Thread-safe holder that persists changes to disk.
pub struct OnlineSettingsManager {
    settings: Mutex<OnlineSettings>,
    path: PathBuf,
}

impl OnlineSettingsManager {
    pub fn load(path: PathBuf) -> Self {
        let settings = OnlineSettings::load_from_file(&path);
        Self {
            settings: Mutex::new(settings),
            path,
        }
    }

    pub fn get(&self) -> OnlineSettings {
        self.settings.lock().clone()
    }

    /// Replaces the settings and persists them. Returns the stored value.
    pub fn update(&self, next: OnlineSettings) -> Result<OnlineSettings, String> {
        {
            let mut guard = self.settings.lock();
            *guard = next.clone();
        }
        next.save(&self.path)?;
        Ok(next)
    }
}

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/online_settings", web::get().to(get_online_settings))
        .route("/online_settings", web::post().to(save_online_settings));
}

async fn get_online_settings(data: web::Data<Arc<AppState>>) -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "settings": data.online_settings.get(),
    }))
}

async fn save_online_settings(
    data: web::Data<Arc<AppState>>,
    body: web::Json<OnlineSettings>,
) -> HttpResponse {
    match data.online_settings.update(body.into_inner()) {
        Ok(settings) => {
            // Apply cache-affecting knobs live so changes take effect without a
            // restart.
            data.ncm_audio_cache
                .set_config(settings.cache_enabled, settings.cache_max_bytes);
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "settings": settings,
            }))
        }
        Err(err) => crate::server::internal_server_error_response(format!(
            "Failed to save online settings: {}",
            err
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_online_settings_are_safe() {
        let s = OnlineSettings::default();
        assert!(s.cache_enabled);
        assert!(s.quality_fallback_enabled);
        assert!(!s.allow_trial_playback);
        assert_eq!(s.default_level, "exhigh");
    }

    #[test]
    fn load_missing_file_returns_defaults() {
        let path = std::env::temp_dir().join("lyne_online_settings_missing.json");
        let _ = std::fs::remove_file(&path);
        assert_eq!(
            OnlineSettings::load_from_file(&path),
            OnlineSettings::default()
        );
    }

    #[test]
    fn update_round_trips_through_disk() {
        let path =
            std::env::temp_dir().join(format!("lyne_online_settings_{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let manager = OnlineSettingsManager::load(path.clone());

        let mut next = OnlineSettings::default();
        next.allow_trial_playback = true;
        next.default_level = "lossless".to_string();
        next.cache_enabled = false;
        manager.update(next.clone()).unwrap();

        // Reloading from disk preserves the change.
        let reloaded = OnlineSettingsManager::load(path.clone());
        assert_eq!(reloaded.get(), next);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn unknown_fields_and_partial_json_fall_back_to_defaults_per_field() {
        // `#[serde(default)]` fills omitted fields.
        let partial = serde_json::json!({ "allow_trial_playback": true }).to_string();
        let parsed: OnlineSettings = serde_json::from_str(&partial).unwrap();
        assert!(parsed.allow_trial_playback);
        assert!(parsed.cache_enabled); // defaulted
        assert_eq!(parsed.default_level, "exhigh"); // defaulted
    }
}

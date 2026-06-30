//! On-disk cache for resolved NCM audio streams.
//!
//! When a track URL resolves successfully the stream is downloaded to a local
//! cache directory in the background (fire-and-forget). Subsequent playbacks
//! resolve to the cached file instead of re-fetching the (expiring) remote URL,
//! which removes the network round-trip and the anonymous-token expiry risk.
//!
//! Unlike SPlayer's equivalent, this cache enforces a byte budget with LRU
//! eviction so it cannot grow without bound. The index lives entirely on the
//! filesystem (`{song_id}_{level}.{ext}`) — no SQLite schema, so the whole
//! directory can be deleted to reset the cache.

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use super::quality_rank;

/// Default online-audio cache budget (4 GiB). Independent of the decoder frame
/// cache (`DEFAULT_CACHE_MAX_BYTES`), which governs in-memory decoded frames.
pub(crate) const DEFAULT_NCM_AUDIO_CACHE_MAX_BYTES: u64 = 4 * 1024 * 1024 * 1024;

const CACHEABLE_EXTENSIONS: [&str; 6] = ["mp3", "flac", "m4a", "aac", "ogg", "wav"];

/// A cached audio file together with the quality tier it was stored at.
pub(crate) struct CachedAudio {
    pub(crate) path: PathBuf,
    pub(crate) level: String,
}

pub struct NcmAudioCache {
    dir: PathBuf,
    /// Byte budget; updatable at runtime from online settings.
    max_bytes: AtomicU64,
    /// Whether caching is active; updatable at runtime from online settings.
    enabled: AtomicBool,
    /// Cache keys (`{song_id}_{level}`) with an in-flight background download,
    /// so concurrent resolves of the same track download it only once.
    in_flight: Mutex<HashSet<String>>,
}

impl NcmAudioCache {
    pub(crate) fn new(dir: PathBuf, max_bytes: u64, enabled: bool) -> Self {
        Self {
            dir,
            max_bytes: AtomicU64::new(max_bytes),
            enabled: AtomicBool::new(enabled),
            in_flight: Mutex::new(HashSet::new()),
        }
    }

    /// Applies runtime configuration changes (from online settings).
    pub(crate) fn set_config(&self, enabled: bool, max_bytes: u64) {
        self.enabled.store(enabled, Ordering::Relaxed);
        self.max_bytes.store(max_bytes, Ordering::Relaxed);
    }

    /// Returns the cached file for `song_id` at the highest tier that is at or
    /// above `requested_level` (per the quality ladder), or `None` on a miss.
    pub(crate) fn lookup(&self, song_id: i64, requested_level: &str) -> Option<CachedAudio> {
        if !self.enabled.load(Ordering::Relaxed) {
            return None;
        }
        // Unknown requested tier -> accept any cached tier.
        let requested_rank = quality_rank(requested_level).unwrap_or(usize::MAX);

        let mut best: Option<(usize, PathBuf, String)> = None;
        for entry in fs::read_dir(&self.dir).ok()?.flatten() {
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy();
            let Some((sid, level)) = parse_cache_name(&name) else {
                continue;
            };
            if sid != song_id {
                continue;
            }
            let Some(rank) = quality_rank(&level) else {
                continue;
            };
            // Accept tiers at least as good as requested (rank <= requested_rank).
            if rank > requested_rank {
                continue;
            }
            // Among acceptable tiers prefer the highest quality (smallest rank).
            if best
                .as_ref()
                .is_none_or(|(best_rank, _, _)| rank < *best_rank)
            {
                best = Some((rank, entry.path(), level));
            }
        }

        best.map(|(_, path, level)| CachedAudio { path, level })
    }

    /// Schedules a background download of `url` into the cache at `level`.
    /// Fire-and-forget: never blocks the caller and never affects first-play
    /// latency. Deduplicates concurrent downloads of the same key.
    pub(crate) fn spawn_download(self: &Arc<Self>, song_id: i64, level: String, url: String) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }
        let key = cache_key(song_id, &level);

        {
            let mut in_flight = match self.in_flight.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            if !in_flight.insert(key.clone()) {
                return; // already downloading
            }
        }

        let this = Arc::clone(self);
        // Blocking HTTP + filesystem work goes on the blocking pool; the handle
        // is intentionally dropped (fire-and-forget).
        let _ = actix_web::rt::task::spawn_blocking(move || {
            match this.download_blocking(song_id, &level, &url) {
                Ok(path) => log::info!("NCM audio cache stored {} ({})", key, path.display()),
                Err(err) => log::warn!("NCM audio cache {} failed: {}", key, err),
            }
            let mut in_flight = match this.in_flight.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            in_flight.remove(&key);
        });
    }

    fn download_blocking(&self, song_id: i64, level: &str, url: &str) -> Result<PathBuf, String> {
        fs::create_dir_all(&self.dir).map_err(|e| format!("create cache dir: {}", e))?;

        let ext = infer_extension(url);
        let final_path = self.dir.join(format!("{}_{}.{}", song_id, level, ext));
        if final_path.exists() {
            return Ok(final_path); // raced with another download
        }

        let response =
            reqwest::blocking::get(url).map_err(|e| format!("download request: {}", e))?;
        if !response.status().is_success() {
            return Err(format!("download status {}", response.status()));
        }
        let bytes = response
            .bytes()
            .map_err(|e| format!("download body: {}", e))?;
        if bytes.is_empty() {
            return Err("empty download body".to_string());
        }

        let tmp_path = self.dir.join(format!("{}_{}.{}.part", song_id, level, ext));
        fs::write(&tmp_path, &bytes).map_err(|e| format!("write temp file: {}", e))?;
        fs::rename(&tmp_path, &final_path).map_err(|e| {
            let _ = fs::remove_file(&tmp_path);
            format!("rename temp file: {}", e)
        })?;

        self.enforce_budget();
        Ok(final_path)
    }

    /// Evicts least-recently-modified files until the directory is within budget.
    fn enforce_budget(&self) {
        let entries = match fs::read_dir(&self.dir) {
            Ok(entries) => entries,
            Err(_) => return,
        };

        let mut files: Vec<(SystemTime, u64, PathBuf)> = Vec::new();
        let mut total: u64 = 0;
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            if !meta.is_file() {
                continue;
            }
            let len = meta.len();
            let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            total += len;
            files.push((modified, len, path));
        }

        if total <= self.max_bytes.load(Ordering::Relaxed) {
            return;
        }

        // Oldest first.
        files.sort_by_key(|(modified, _, _)| *modified);
        let max_bytes = self.max_bytes.load(Ordering::Relaxed);
        for (_, len, path) in files {
            if total <= max_bytes {
                break;
            }
            if fs::remove_file(&path).is_ok() {
                total = total.saturating_sub(len);
                log::debug!("NCM audio cache evicted {}", path.display());
            }
        }
    }
}

fn cache_key(song_id: i64, level: &str) -> String {
    format!("{}_{}", song_id, level)
}

/// Parses `{song_id}_{level}.{ext}` into `(song_id, level)`. Returns `None` for
/// partial (`.part`) files or any name not matching the pattern.
fn parse_cache_name(name: &str) -> Option<(i64, String)> {
    let (file_stem, ext) = name.rsplit_once('.')?;
    if ext.eq_ignore_ascii_case("part") {
        return None;
    }
    let (song_id, level) = file_stem.split_once('_')?;
    let song_id: i64 = song_id.parse().ok()?;
    if level.is_empty() {
        return None;
    }
    Some((song_id, level.to_string()))
}

fn infer_extension(url: &str) -> String {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let ext = path
        .rsplit('.')
        .next()
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if CACHEABLE_EXTENSIONS.contains(&ext.as_str()) {
        ext
    } else {
        "mp3".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_cache_name_extracts_id_and_level() {
        assert_eq!(
            parse_cache_name("12345_lossless.flac"),
            Some((12345, "lossless".to_string()))
        );
        assert_eq!(
            parse_cache_name("7_standard.mp3"),
            Some((7, "standard".to_string()))
        );
    }

    #[test]
    fn parse_cache_name_rejects_partial_and_malformed() {
        assert_eq!(parse_cache_name("12345_lossless.flac.part"), None);
        assert_eq!(parse_cache_name("nodot"), None);
        assert_eq!(parse_cache_name("nounderscore.mp3"), None);
        assert_eq!(parse_cache_name("abc_lossless.flac"), None);
    }

    #[test]
    fn infer_extension_whitelists_known_audio_types() {
        assert_eq!(infer_extension("https://x/y/song.flac"), "flac");
        assert_eq!(infer_extension("https://x/y/song.MP3?token=1"), "mp3");
        assert_eq!(infer_extension("https://x/y/song.weird"), "mp3");
        assert_eq!(infer_extension("https://x/y/noext"), "mp3");
    }

    #[test]
    fn lookup_prefers_highest_tier_at_or_above_request() {
        let dir = std::env::temp_dir().join(format!("lyne_ncm_cache_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("42_standard.mp3"), b"x").unwrap();
        fs::write(dir.join("42_lossless.flac"), b"x").unwrap();
        fs::write(dir.join("42_exhigh.mp3"), b"x").unwrap();

        let cache = NcmAudioCache::new(dir.clone(), 1024, true);

        // Requesting exhigh: lossless (higher) is acceptable and preferred as the
        // highest available tier at or above the request.
        let hit = cache.lookup(42, "exhigh").expect("hit");
        assert_eq!(hit.level, "lossless");

        // Requesting standard: every cached tier is at or above standard, so the
        // highest available (lossless) wins.
        let hit = cache.lookup(42, "standard").expect("hit");
        assert_eq!(hit.level, "lossless");

        // Requesting a tier above everything cached -> miss.
        assert!(cache.lookup(42, "jymaster").is_none());

        // Different song id -> miss.
        assert!(cache.lookup(99, "standard").is_none());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn lookup_disabled_cache_returns_none() {
        let cache = NcmAudioCache::new(std::env::temp_dir(), 1024, false);
        assert!(cache.lookup(1, "standard").is_none());
    }
}

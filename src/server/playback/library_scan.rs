use super::analysis::{
    is_supported_media_href, is_supported_media_path, persist_library_scan_task,
};
use super::*;
use actix_web::web;
use rayon::prelude::*;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

pub(super) struct LibraryScanOutcome {
    pub(super) scanned_files: u64,
    pub(super) indexed_files: u64,
    pub(super) removed_files: u64,
}

struct ParsedTrack {
    canonical_path: String,
    metadata: crate::decoder::TrackMetadata,
    duration_secs: Option<f64>,
    sample_rate: Option<u32>,
    channels: Option<usize>,
    mtime: f64,
    size: u64,
}

fn external_cover_for_media(path: &Path) -> Option<(Vec<u8>, String)> {
    const COVER_NAMES: &[&str] = &["cover", "folder", "front", "album"];
    const COVER_EXTENSIONS: &[(&str, &str)] = &[
        ("jpg", "image/jpeg"),
        ("jpeg", "image/jpeg"),
        ("png", "image/png"),
        ("webp", "image/webp"),
    ];

    let dir = path.parent()?;
    let stem = path.file_stem().and_then(|value| value.to_str());
    let mut candidates = Vec::new();
    if let Some(stem) = stem {
        for (ext, _) in COVER_EXTENSIONS {
            candidates.push(dir.join(format!("{}.{}", stem, ext)));
        }
    }
    for name in COVER_NAMES {
        for (ext, _) in COVER_EXTENSIONS {
            candidates.push(dir.join(format!("{}.{}", name, ext)));
        }
    }

    for candidate in candidates {
        if !candidate.is_file() {
            continue;
        }
        let ext = candidate
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let mime = COVER_EXTENSIONS
            .iter()
            .find(|(candidate_ext, _)| *candidate_ext == ext)
            .map(|(_, mime)| (*mime).to_string())
            .unwrap_or_else(|| "application/octet-stream".to_string());
        match std::fs::read(&candidate) {
            Ok(bytes) => return Some((bytes, mime)),
            Err(e) => log::warn!(
                "Failed to read external cover '{}': {}",
                candidate.display(),
                e
            ),
        }
    }

    None
}

pub(super) fn metadata_with_external_cover(
    path: &Path,
    metadata: &crate::decoder::TrackMetadata,
) -> crate::decoder::TrackMetadata {
    if metadata.cover_art.is_some() {
        return metadata.clone();
    }
    let Some((bytes, mime)) = external_cover_for_media(path) else {
        return metadata.clone();
    };
    let mut next = metadata.clone();
    next.cover_art = Some(bytes);
    next.cover_art_mime = Some(mime);
    next
}

pub(super) fn scan_local_library(
    data: &web::Data<Arc<AppState>>,
    scan_task_id: u64,
    started_at: u64,
    root_id: i64,
    root_path: &str,
) -> Result<LibraryScanOutcome, String> {
    let file_paths = collect_supported_local_media_paths(root_path)?;
    let total_scanned = file_paths.len() as u64;
    if total_scanned == 0 {
        data.app_db
            .update_library_root_scan_status(
                root_id,
                "completed",
                Some(0),
                None,
                Some(now_epoch_secs()),
            )
            .map_err(|e| format!("Failed to finalize library scan state: {}", e))?;
        return Ok(LibraryScanOutcome {
            scanned_files: 0,
            indexed_files: 0,
            removed_files: 0,
        });
    }

    let snapshot = data.app_db.load_scan_snapshot().unwrap_or_default();
    let (tx, rx) = std::sync::mpsc::sync_channel::<ParsedTrack>(64);
    let indexed_paths = Arc::new(std::sync::Mutex::new(Vec::new()));
    let indexed_count = Arc::new(AtomicU64::new(0));

    let writer_handle = spawn_local_scan_writer(
        data,
        rx,
        Arc::clone(&indexed_paths),
        Arc::clone(&indexed_count),
        scan_task_id,
        started_at,
        root_id,
        root_path,
    );

    let scanned = AtomicU64::new(0);
    file_paths.par_iter().for_each_with(tx, |tx, path| {
        scanned.fetch_add(1, Ordering::Relaxed);

        let canonical = match path.canonicalize() {
            Ok(p) => p.to_string_lossy().to_string(),
            Err(_) => path.to_string_lossy().to_string(),
        };

        let file_meta = match std::fs::metadata(path) {
            Ok(m) => m,
            Err(_) => return,
        };
        let size = file_meta.len();
        if size < 1024 {
            return;
        }
        let mtime = file_meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as f64)
            .unwrap_or(0.0);

        if let Some((old_mtime, old_size, _has_cover)) = snapshot.get(&canonical) {
            let mtime_unchanged = old_mtime.map_or(false, |old| (old - mtime).abs() < 1.0);
            let size_unchanged = old_size.map_or(false, |old| old == size);
            if mtime_unchanged && size_unchanged {
                indexed_paths.lock().unwrap().push(canonical);
                indexed_count.fetch_add(1, Ordering::Relaxed);
                return;
            }
        }

        let local_metadata = match crate::metadata::read_local_metadata(&canonical) {
            Ok(value) => value,
            Err(e) => {
                log::warn!("Skipping media file '{}': {}", canonical, e);
                return;
            }
        };
        let has_lofty_title = local_metadata.has_lofty_title;
        let mut metadata = metadata_with_external_cover(path, &local_metadata.metadata);
        let duration_secs = local_metadata.duration_secs;
        let sample_rate = local_metadata.sample_rate;
        let channels = local_metadata.channels;

        if !has_lofty_title && duration_secs.map_or(false, |d| d < 30.0) {
            return;
        }

        let file_stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("未知歌曲");
        if metadata
            .title
            .as_deref()
            .map_or(true, |t| t.trim().is_empty())
        {
            metadata.title = Some(file_stem.to_string());
        }
        if metadata
            .artist
            .as_deref()
            .map_or(true, |a| a.trim().is_empty())
        {
            metadata.artist = Some("未知艺术家".to_string());
        }
        if metadata
            .album
            .as_deref()
            .map_or(true, |a| a.trim().is_empty())
        {
            metadata.album = Some("未知专辑".to_string());
        }

        if metadata.cover_art.is_none() {
            if let Some((bytes, mime)) = external_cover_for_media(path) {
                metadata.cover_art = Some(bytes);
                metadata.cover_art_mime = Some(mime);
            }
        }

        let _ = tx.send(ParsedTrack {
            canonical_path: canonical,
            metadata,
            duration_secs,
            sample_rate,
            channels,
            mtime,
            size,
        });
    });

    writer_handle
        .join()
        .map_err(|_| "DB writer thread panicked".to_string())?;

    let final_scanned = scanned.load(Ordering::Relaxed);
    let final_indexed = indexed_count.load(Ordering::Relaxed);
    let final_indexed_paths = indexed_paths.lock().unwrap().clone();

    let removed = data
        .app_db
        .delete_local_media_not_in_root(root_path, &final_indexed_paths)
        .map_err(|e| format!("Failed to remove stale local media: {}", e))?;

    data.app_db
        .update_library_root_scan_status(
            root_id,
            "completed",
            Some(final_indexed),
            None,
            Some(now_epoch_secs()),
        )
        .map_err(|e| format!("Failed to finalize library scan state: {}", e))?;

    persist_library_scan_task(
        data,
        scan_task_id,
        root_path,
        "scanning",
        started_at,
        now_epoch_secs(),
        Some(&serde_json::json!({
            "root_id": root_id,
            "scanned_files": final_scanned,
            "indexed_files": final_indexed,
            "removed_files": removed,
        })),
        None,
    );

    Ok(LibraryScanOutcome {
        scanned_files: final_scanned,
        indexed_files: final_indexed,
        removed_files: removed,
    })
}

fn collect_supported_local_media_paths(root_path: &str) -> Result<Vec<std::path::PathBuf>, String> {
    let mut file_paths = Vec::new();
    let mut stack = vec![std::path::PathBuf::from(root_path)];
    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir)
            .map_err(|e| format!("Failed to read directory '{}': {}", dir.display(), e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if is_supported_media_path(&path) {
                file_paths.push(path);
            }
        }
    }
    Ok(file_paths)
}

fn spawn_local_scan_writer(
    data: &web::Data<Arc<AppState>>,
    rx: std::sync::mpsc::Receiver<ParsedTrack>,
    indexed_paths: Arc<std::sync::Mutex<Vec<String>>>,
    indexed_count: Arc<AtomicU64>,
    scan_task_id: u64,
    started_at: u64,
    root_id: i64,
    root_path: &str,
) -> std::thread::JoinHandle<()> {
    let db = Arc::clone(&data.app_db);
    let writer_data = data.clone();
    let writer_root_path = root_path.to_string();
    std::thread::spawn(move || {
        let mut batch: Vec<ParsedTrack> = Vec::with_capacity(50);
        let mut total_written: u64 = 0;

        loop {
            match rx.recv() {
                Ok(track) => {
                    batch.push(track);
                    while batch.len() < 50 {
                        match rx.try_recv() {
                            Ok(t) => batch.push(t),
                            Err(_) => break,
                        }
                    }
                }
                Err(_) => break,
            }

            write_parsed_track_batch(&db, &indexed_paths, &indexed_count, &batch);
            total_written += batch.len() as u64;
            batch.clear();

            persist_library_scan_task(
                &writer_data,
                scan_task_id,
                &writer_root_path,
                "scanning",
                started_at,
                now_epoch_secs(),
                Some(&serde_json::json!({
                    "root_id": root_id,
                    "scanned_files": total_written,
                    "indexed_files": indexed_count.load(Ordering::Relaxed),
                })),
                None,
            );
        }

        write_parsed_track_batch(&db, &indexed_paths, &indexed_count, &batch);
    })
}

fn write_parsed_track_batch(
    db: &Arc<crate::app_database::AppDatabase>,
    indexed_paths: &Arc<std::sync::Mutex<Vec<String>>>,
    indexed_count: &Arc<AtomicU64>,
    batch: &[ParsedTrack],
) {
    for track in batch {
        match db.record_media_metadata_with_scan_info(
            &track.canonical_path,
            &track.metadata,
            track.duration_secs,
            track.sample_rate,
            track.channels,
            Some(track.mtime),
            Some(track.size),
        ) {
            Ok(_) => {
                indexed_paths
                    .lock()
                    .unwrap()
                    .push(track.canonical_path.clone());
                indexed_count.fetch_add(1, Ordering::Relaxed);
            }
            Err(e) => log::warn!("Failed to index '{}': {}", track.canonical_path, e),
        }
    }
}

pub(super) fn scan_webdav_library(
    data: &web::Data<Arc<AppState>>,
    scan_task_id: u64,
    started_at: u64,
    root_id: i64,
    root_path: &str,
    source_key: Option<&str>,
) -> Result<LibraryScanOutcome, String> {
    let webdav_cfg = if let Some(source_key) = source_key {
        data.app_db
            .load_webdav_source_config(source_key)?
            .map(|source| source.config)
            .ok_or_else(|| format!("WebDAV source '{}' not found", source_key))?
    } else {
        data.webdav_config.lock().clone()
    };

    if !webdav_cfg.is_configured() {
        return Err("WebDAV source is not configured".to_string());
    }

    let credentials = webdav_cfg.http_credentials();
    let mut scanned = 0_u64;
    let mut indexed = 0_u64;
    let mut stack = vec![root_path.to_string()];

    while let Some(path) = stack.pop() {
        let entries = webdav_cfg
            .list(&path)
            .map_err(|e| format!("Failed to browse WebDAV path '{}': {}", path, e))?;

        for entry in entries {
            if entry.is_dir {
                let child_path = if entry.href.is_empty() {
                    continue;
                } else {
                    entry.href.clone()
                };
                if child_path != path {
                    stack.push(child_path);
                }
                continue;
            }

            if !is_supported_media_href(&entry.url) {
                continue;
            }

            scanned += 1;
            match crate::decoder::StreamingDecoder::open_with_credentials(
                &entry.url,
                credentials.as_ref(),
            ) {
                Ok(decoder) => {
                    let info = decoder.info.clone();
                    match data.app_db.record_media_metadata(
                        &entry.url,
                        &info.metadata,
                        info.duration_secs,
                        Some(info.sample_rate),
                        Some(info.channels),
                    ) {
                        Ok(_) => indexed += 1,
                        Err(e) => log::warn!("Failed to index remote media '{}': {}", entry.url, e),
                    }
                }
                Err(e) => log::warn!("Skipping remote media '{}': {}", entry.url, e),
            }

            if scanned % 25 == 0 {
                persist_library_scan_task(
                    data,
                    scan_task_id,
                    root_path,
                    "scanning",
                    started_at,
                    now_epoch_secs(),
                    Some(&serde_json::json!({
                        "root_id": root_id,
                        "scanned_files": scanned,
                        "indexed_files": indexed,
                    })),
                    None,
                );
            }
        }
    }

    data.app_db
        .update_library_root_scan_status(
            root_id,
            "completed",
            Some(indexed),
            None,
            Some(now_epoch_secs()),
        )
        .map_err(|e| format!("Failed to finalize remote library scan state: {}", e))?;

    persist_library_scan_task(
        data,
        scan_task_id,
        root_path,
        "scanning",
        started_at,
        now_epoch_secs(),
        Some(&serde_json::json!({
            "root_id": root_id,
            "scanned_files": scanned,
            "indexed_files": indexed,
        })),
        None,
    );

    Ok(LibraryScanOutcome {
        scanned_files: scanned,
        indexed_files: indexed,
        removed_files: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::{external_cover_for_media, metadata_with_external_cover};
    use std::fs;

    #[test]
    fn metadata_with_external_cover_uses_sidecar_art_when_missing() {
        let temp_dir = std::env::temp_dir().join(format!(
            "audio_player_library_scan_test_{}",
            std::process::id()
        ));
        let _ = fs::create_dir_all(&temp_dir);

        let cover_path = temp_dir.join("cover.jpg");
        fs::write(&cover_path, [1_u8, 2, 3, 4]).unwrap();

        let track_path = temp_dir.join("song.flac");
        let metadata = crate::decoder::TrackMetadata::default();

        let enriched = metadata_with_external_cover(&track_path, &metadata);

        assert_eq!(enriched.cover_art.as_deref(), Some(&[1_u8, 2, 3, 4][..]));
        assert_eq!(enriched.cover_art_mime.as_deref(), Some("image/jpeg"));
        assert_eq!(
            external_cover_for_media(&track_path).map(|(bytes, mime)| (bytes, mime)),
            Some((vec![1_u8, 2, 3, 4], "image/jpeg".to_string()))
        );

        let _ = fs::remove_file(cover_path);
        let _ = fs::remove_dir_all(temp_dir);
    }
}

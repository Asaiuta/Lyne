use super::analysis::{
    is_supported_media_href, is_supported_media_path, persist_library_scan_task,
};
use super::*;
use actix_web::web;
use crossbeam::channel::{bounded, Receiver, SendTimeoutError, Sender};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

const UNKNOWN_SONG_TITLE: &str = "Unknown Song";
const LOCAL_SCAN_CHANNEL_CAPACITY: usize = 64;
const LOCAL_SCAN_DB_BATCH_SIZE: usize = 500;
const LOCAL_SCAN_DB_BATCH_MAX_BYTES: usize = 64 * 1024 * 1024;
const LOCAL_SCAN_EMBEDDED_COVER_FILE_CACHE_MIN_BYTES: usize = 64 * 1024;
const LOCAL_SCAN_PROGRESS_INTERVAL: u64 = 25;
const LOCAL_SCAN_CHANNEL_RETRY_MS: u64 = 100;

pub(super) struct LibraryScanOutcome {
    pub(super) scanned_files: u64,
    pub(super) indexed_files: u64,
    pub(super) removed_files: u64,
}

struct ParsedTrack {
    canonical_path: String,
    metadata: crate::decoder::TrackMetadata,
    cover_art_file: Option<LocalCoverArtFile>,
    duration_secs: Option<f64>,
    sample_rate: Option<u32>,
    channels: Option<usize>,
    bitrate_bps: Option<f64>,
    bits_per_sample: Option<u32>,
    mtime: f64,
    size: u64,
}

struct LocalCoverArtFile {
    path: String,
    mime_type: Option<String>,
    byte_len: u64,
}

struct ExternalCoverFile {
    path: PathBuf,
    mime_type: String,
    byte_len: u64,
}

struct LocalScanWriteSummary {
    indexed_count: u64,
    write_failures: Vec<String>,
}

struct LocalScanBatchResult {
    indexed_delta: u64,
    failures: Vec<String>,
}

enum LocalScanWriteItem {
    Seen(String),
    Parsed(ParsedTrack),
}

impl ParsedTrack {
    fn estimated_batch_bytes(&self) -> usize {
        self.canonical_path.len()
            + estimated_metadata_bytes(&self.metadata)
            + self.cover_art_file.as_ref().map_or(0, |cover| {
                cover.path.len()
                    + cover.mime_type.as_ref().map_or(0, String::len)
                    + std::mem::size_of::<LocalCoverArtFile>()
            })
            + std::mem::size_of::<Self>()
    }
}

impl LocalScanWriteItem {
    fn estimated_batch_bytes(&self) -> usize {
        match self {
            LocalScanWriteItem::Seen(path) => path.len() + std::mem::size_of::<String>(),
            LocalScanWriteItem::Parsed(track) => track.estimated_batch_bytes(),
        }
    }
}

fn estimated_metadata_bytes(metadata: &crate::decoder::TrackMetadata) -> usize {
    metadata.title.as_ref().map_or(0, String::len)
        + metadata.artist.as_ref().map_or(0, String::len)
        + metadata.album.as_ref().map_or(0, String::len)
        + metadata.genre.as_ref().map_or(0, String::len)
        + metadata.cover_art.as_ref().map_or(0, Vec::len)
        + metadata.cover_art_mime.as_ref().map_or(0, String::len)
        + metadata.lyrics.as_ref().map_or(0, String::len)
        + std::mem::size_of::<crate::decoder::TrackMetadata>()
}

fn external_cover_file_for_media(path: &Path, max_bytes: u64) -> Option<ExternalCoverFile> {
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
    let mut seen_candidates = HashSet::new();
    if let Some(stem) = stem {
        for (ext, _) in COVER_EXTENSIONS {
            let candidate = dir.join(format!("{}.{}", stem, ext));
            if seen_candidates.insert(candidate.clone()) {
                candidates.push(candidate);
            }
        }
    }
    for name in COVER_NAMES {
        for (ext, _) in COVER_EXTENSIONS {
            let candidate = dir.join(format!("{}.{}", name, ext));
            if seen_candidates.insert(candidate.clone()) {
                candidates.push(candidate);
            }
        }
    }

    for candidate in candidates {
        if !candidate.is_file() {
            continue;
        }
        let byte_len = match std::fs::metadata(&candidate) {
            Ok(metadata) if metadata.len() > max_bytes => {
                log::warn!(
                    "Skipping external cover '{}' because it is {} bytes (limit: {} bytes)",
                    candidate.display(),
                    metadata.len(),
                    max_bytes
                );
                continue;
            }
            Ok(metadata) => metadata.len(),
            Err(e) => {
                log::warn!(
                    "Failed to read external cover metadata '{}': {}",
                    candidate.display(),
                    e
                );
                continue;
            }
        };
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
        return Some(ExternalCoverFile {
            path: candidate,
            mime_type: mime,
            byte_len,
        });
    }

    None
}

fn external_cover_for_media(path: &Path, max_bytes: u64) -> Option<(Vec<u8>, String)> {
    let cover = external_cover_file_for_media(path, max_bytes)?;
    match std::fs::read(&cover.path) {
        Ok(bytes) => Some((bytes, cover.mime_type)),
        Err(e) => {
            log::warn!(
                "Failed to read external cover '{}': {}",
                cover.path.display(),
                e
            );
            None
        }
    }
}

fn persist_local_scan_cover_art(
    cache_dir: &Path,
    canonical_path: &str,
    metadata: &mut crate::decoder::TrackMetadata,
) -> Option<LocalCoverArtFile> {
    let bytes = metadata.cover_art.as_ref()?;
    if bytes.len() < LOCAL_SCAN_EMBEDDED_COVER_FILE_CACHE_MIN_BYTES {
        return None;
    }
    let mime_type = metadata.cover_art_mime.clone();
    let extension = cover_cache_extension(mime_type.as_deref());
    let file_name = format!("{}.{}", cover_cache_key(canonical_path), extension);
    let file_path = cache_dir.join(file_name);
    if let Err(e) = std::fs::create_dir_all(cache_dir) {
        log::warn!(
            "Falling back to database cover storage because cover cache dir '{}' could not be created: {}",
            cache_dir.display(),
            e
        );
        return None;
    }
    if let Err(e) = std::fs::write(&file_path, bytes) {
        log::warn!(
            "Falling back to database cover storage because cover cache file '{}' could not be written: {}",
            file_path.display(),
            e
        );
        return None;
    }

    let byte_len = bytes.len() as u64;
    metadata.cover_art = None;
    Some(LocalCoverArtFile {
        path: file_path.to_string_lossy().to_string(),
        mime_type,
        byte_len,
    })
}

fn scan_cover_art_file_reference(
    path: &Path,
    canonical_path: &str,
    metadata: &mut crate::decoder::TrackMetadata,
    max_bytes: u64,
    cache_dir: &Path,
) -> Option<LocalCoverArtFile> {
    if metadata.cover_art.is_some() {
        return persist_local_scan_cover_art(cache_dir, canonical_path, metadata);
    }
    let cover = external_cover_file_for_media(path, max_bytes)?;
    metadata.cover_art_mime = Some(cover.mime_type.clone());
    Some(LocalCoverArtFile {
        path: cover.path.to_string_lossy().to_string(),
        mime_type: Some(cover.mime_type),
        byte_len: cover.byte_len,
    })
}

fn cover_cache_key(canonical_path: &str) -> String {
    use sha2::{Digest, Sha256};

    let media_id = crate::app_database::media_id_for_path(canonical_path);
    let mut hasher = Sha256::new();
    hasher.update(media_id.as_bytes());
    hex::encode(hasher.finalize())
}

fn cover_cache_extension(mime_type: Option<&str>) -> &'static str {
    match mime_type.unwrap_or("").to_ascii_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        _ => "bin",
    }
}

fn cached_cover_file_is_available(file_path: Option<&str>) -> bool {
    file_path.map_or(true, |path| Path::new(path).is_file())
}

pub(super) fn metadata_with_external_cover(
    path: &Path,
    metadata: &crate::decoder::TrackMetadata,
    max_bytes: u64,
) -> crate::decoder::TrackMetadata {
    if metadata.cover_art.is_some() {
        return metadata.clone();
    }
    let Some((bytes, mime)) = external_cover_for_media(path, max_bytes) else {
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
    cancel_token: AnalysisCancelToken,
) -> Result<LibraryScanOutcome, String> {
    cancel_token.check()?;
    data.app_db
        .begin_local_scan_seen_set(scan_task_id)
        .map_err(|e| format!("Failed to prepare local library scan seen set: {}", e))?;

    let snapshot = Arc::new(
        data.app_db
            .load_scan_snapshot()
            .map_err(|e| format!("Failed to load local library scan snapshot: {}", e))?,
    );
    let scanned_count = Arc::new(AtomicU64::new(0));
    let worker_count = data.analysis.library_scan_max_workers.max(1);
    let cover_max_bytes = data.analysis.library_scan_cover_max_bytes.max(1);
    let cover_cache_dir = data.runtime_paths.cache_dir.join("local-cover-art");
    let (path_tx, path_rx) = bounded::<PathBuf>(LOCAL_SCAN_CHANNEL_CAPACITY);
    let (write_tx, write_rx) = bounded::<LocalScanWriteItem>(LOCAL_SCAN_CHANNEL_CAPACITY);

    let writer_handle = spawn_local_scan_writer(
        data,
        write_rx,
        Arc::clone(&scanned_count),
        scan_task_id,
        started_at,
        root_id,
        root_path,
        cancel_token.clone(),
    );
    let worker_handles = spawn_local_scan_workers(
        worker_count,
        path_rx,
        write_tx.clone(),
        snapshot,
        Arc::clone(&scanned_count),
        cancel_token.clone(),
        cover_max_bytes,
        cover_cache_dir,
    );
    drop(write_tx);

    let walk_result = walk_supported_local_media_paths(root_path, &path_tx, &cancel_token);
    drop(path_tx);

    let worker_result = join_local_scan_workers(worker_handles);
    let writer_result = join_local_scan_writer(writer_handle);

    if let Err(e) = walk_result {
        clear_local_scan_seen_set(data, scan_task_id);
        return Err(e);
    }
    if let Err(e) = worker_result {
        clear_local_scan_seen_set(data, scan_task_id);
        return Err(e);
    }
    let write_summary = match writer_result {
        Ok(summary) => summary,
        Err(e) => {
            clear_local_scan_seen_set(data, scan_task_id);
            return Err(e);
        }
    };
    if !write_summary.write_failures.is_empty() {
        clear_local_scan_seen_set(data, scan_task_id);
        return Err(format!(
            "Failed to index {} local media item(s): {}",
            write_summary.write_failures.len(),
            write_summary.write_failures.join("; ")
        ));
    }

    cancel_token.check()?;
    let final_scanned = scanned_count.load(Ordering::Relaxed);
    let final_indexed = write_summary.indexed_count;
    let removed = data
        .app_db
        .delete_local_media_not_seen_in_root(root_path, scan_task_id)
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

fn walk_supported_local_media_paths(
    root_path: &str,
    tx: &Sender<PathBuf>,
    cancel_token: &AnalysisCancelToken,
) -> Result<(), String> {
    for entry in jwalk::WalkDir::new(root_path).skip_hidden(true).into_iter() {
        cancel_token.check()?;
        let entry =
            entry.map_err(|e| format!("Failed to walk local library '{}': {}", root_path, e))?;
        let path = entry.path();
        let file_type = entry.file_type();
        if file_type.is_symlink() {
            log::warn!(
                "Skipping symlink during local library scan: '{}'",
                path.display()
            );
            continue;
        }
        if file_type.is_file() && is_supported_media_path(&path) {
            send_with_cancel(tx, path, cancel_token)?;
        }
    }
    Ok(())
}

fn spawn_local_scan_workers(
    worker_count: usize,
    path_rx: Receiver<PathBuf>,
    write_tx: Sender<LocalScanWriteItem>,
    snapshot: Arc<HashMap<String, (Option<f64>, Option<u64>, Option<String>)>>,
    scanned_count: Arc<AtomicU64>,
    cancel_token: AnalysisCancelToken,
    cover_max_bytes: u64,
    cover_cache_dir: PathBuf,
) -> Vec<std::thread::JoinHandle<Result<(), String>>> {
    (0..worker_count)
        .map(|_| {
            let path_rx = path_rx.clone();
            let write_tx = write_tx.clone();
            let snapshot = Arc::clone(&snapshot);
            let scanned_count = Arc::clone(&scanned_count);
            let cancel_token = cancel_token.clone();
            let cover_cache_dir = cover_cache_dir.clone();
            std::thread::spawn(move || {
                for path in path_rx.iter() {
                    cancel_token.check()?;
                    if let Some(item) = process_local_scan_path(
                        &path,
                        &snapshot,
                        &scanned_count,
                        &cancel_token,
                        cover_max_bytes,
                        &cover_cache_dir,
                    )? {
                        send_with_cancel(&write_tx, item, &cancel_token)?;
                    }
                }
                Ok(())
            })
        })
        .collect()
}

fn process_local_scan_path(
    path: &Path,
    snapshot: &HashMap<String, (Option<f64>, Option<u64>, Option<String>)>,
    scanned_count: &AtomicU64,
    cancel_token: &AnalysisCancelToken,
    cover_max_bytes: u64,
    cover_cache_dir: &Path,
) -> Result<Option<LocalScanWriteItem>, String> {
    cancel_token.check()?;
    scanned_count.fetch_add(1, Ordering::Relaxed);

    let canonical_path = local_scan_source_path(path, snapshot);

    let file_meta = match std::fs::metadata(path) {
        Ok(value) => value,
        Err(e) => {
            log::warn!(
                "Skipping media file '{}' because metadata could not be read: {}",
                canonical_path,
                e
            );
            return Ok(None);
        }
    };
    let size = file_meta.len();
    if size < 1024 {
        return Ok(None);
    }
    let mtime = file_meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as f64)
        .unwrap_or(0.0);

    if let Some((old_mtime, old_size, cover_file_path)) = snapshot.get(&canonical_path) {
        let mtime_unchanged = old_mtime.map_or(false, |old| (old - mtime).abs() < 1.0);
        let size_unchanged = old_size.map_or(false, |old| old == size);
        if mtime_unchanged
            && size_unchanged
            && cached_cover_file_is_available(cover_file_path.as_deref())
        {
            return Ok(Some(LocalScanWriteItem::Seen(canonical_path)));
        }
    }

    let local_metadata = match crate::metadata::read_local_metadata(&canonical_path) {
        Ok(value) => value,
        Err(e) => {
            log::warn!("Skipping media file '{}': {}", canonical_path, e);
            return Ok(None);
        }
    };
    let has_lofty_title = local_metadata.has_lofty_title;
    let duration_secs = local_metadata.duration_secs;
    let sample_rate = local_metadata.sample_rate;
    let channels = local_metadata.channels;
    let bitrate_bps = local_metadata.bitrate_bps;
    let bits_per_sample = local_metadata.bits_per_sample;

    if !has_lofty_title && duration_secs.map_or(false, |duration| duration < 30.0) {
        return Ok(None);
    }

    cancel_token.check()?;
    let mut metadata = local_metadata.metadata;
    let cover_art_file = scan_cover_art_file_reference(
        path,
        &canonical_path,
        &mut metadata,
        cover_max_bytes,
        cover_cache_dir,
    );
    cancel_token.check()?;

    let file_stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(UNKNOWN_SONG_TITLE);
    if metadata
        .title
        .as_deref()
        .map_or(true, |title| title.trim().is_empty())
    {
        metadata.title = Some(file_stem.to_string());
    }
    if metadata
        .artist
        .as_deref()
        .map_or(true, |artist| artist.trim().is_empty())
    {
        metadata.artist = None;
    }
    if metadata
        .album
        .as_deref()
        .map_or(true, |album| album.trim().is_empty())
    {
        metadata.album = None;
    }

    Ok(Some(LocalScanWriteItem::Parsed(ParsedTrack {
        canonical_path,
        metadata,
        cover_art_file,
        duration_secs,
        sample_rate,
        channels,
        bitrate_bps,
        bits_per_sample,
        mtime,
        size,
    })))
}

fn local_scan_source_path(
    path: &Path,
    snapshot: &HashMap<String, (Option<f64>, Option<u64>, Option<String>)>,
) -> String {
    let source_path = path.to_string_lossy().to_string();
    if snapshot.is_empty() || snapshot.contains_key(&source_path) {
        return source_path;
    }

    match path.canonicalize() {
        Ok(value) => {
            let canonical_path = value.to_string_lossy().to_string();
            if snapshot.contains_key(&canonical_path) {
                canonical_path
            } else {
                source_path
            }
        }
        Err(_) => source_path,
    }
}

fn spawn_local_scan_writer(
    data: &web::Data<Arc<AppState>>,
    rx: Receiver<LocalScanWriteItem>,
    scanned_count: Arc<AtomicU64>,
    scan_task_id: u64,
    started_at: u64,
    root_id: i64,
    root_path: &str,
    cancel_token: AnalysisCancelToken,
) -> std::thread::JoinHandle<Result<LocalScanWriteSummary, String>> {
    let db = Arc::clone(&data.app_db);
    let writer_data = data.clone();
    let writer_root_path = root_path.to_string();
    std::thread::spawn(move || {
        let mut batch = Vec::with_capacity(LOCAL_SCAN_CHANNEL_CAPACITY);
        let mut batch_bytes = 0_usize;
        let mut indexed_count = 0_u64;
        let mut write_failures = Vec::new();
        let mut last_progress_scanned = 0_u64;

        loop {
            match rx.recv() {
                Ok(item) => {
                    batch_bytes += item.estimated_batch_bytes();
                    batch.push(item);
                    while batch.len() < LOCAL_SCAN_DB_BATCH_SIZE
                        && batch_bytes < LOCAL_SCAN_DB_BATCH_MAX_BYTES
                    {
                        match rx.try_recv() {
                            Ok(item) => {
                                batch_bytes += item.estimated_batch_bytes();
                                batch.push(item);
                            }
                            Err(_) => break,
                        }
                    }
                }
                Err(_) => break,
            }

            cancel_token.check()?;
            let result = write_local_scan_batch(&db, scan_task_id, &batch, &cancel_token)?;
            indexed_count += result.indexed_delta;
            write_failures.extend(result.failures);
            batch.clear();
            batch_bytes = 0;

            let scanned = scanned_count.load(Ordering::Relaxed);
            if scanned.saturating_sub(last_progress_scanned) >= LOCAL_SCAN_PROGRESS_INTERVAL {
                last_progress_scanned = scanned;
                persist_library_scan_task(
                    &writer_data,
                    scan_task_id,
                    &writer_root_path,
                    "scanning",
                    started_at,
                    now_epoch_secs(),
                    Some(&serde_json::json!({
                        "root_id": root_id,
                        "scanned_files": scanned,
                        "indexed_files": indexed_count,
                    })),
                    None,
                );
            }
        }

        cancel_token.check()?;
        Ok(LocalScanWriteSummary {
            indexed_count,
            write_failures,
        })
    })
}

fn write_local_scan_batch(
    db: &Arc<crate::app_database::AppDatabase>,
    scan_task_id: u64,
    batch: &[LocalScanWriteItem],
    cancel_token: &AnalysisCancelToken,
) -> Result<LocalScanBatchResult, String> {
    let mut failures = Vec::new();
    let mut seen_paths = Vec::with_capacity(batch.len());
    let mut indexed_delta = 0_u64;
    let mut parsed_paths = Vec::new();
    let mut parsed_records = Vec::new();

    for item in batch {
        cancel_token.check()?;
        match item {
            LocalScanWriteItem::Seen(path) => {
                seen_paths.push(path.clone());
                indexed_delta += 1;
            }
            LocalScanWriteItem::Parsed(track) => {
                parsed_paths.push(track.canonical_path.as_str());
                parsed_records.push(crate::app_database::MediaMetadataScanInput {
                    source_path: &track.canonical_path,
                    metadata: &track.metadata,
                    duration_secs: track.duration_secs,
                    sample_rate: track.sample_rate,
                    channels: track.channels,
                    bitrate_bps: track.bitrate_bps,
                    bits_per_sample: track.bits_per_sample,
                    mtime: Some(track.mtime),
                    size_bytes: Some(track.size),
                    cover_art_file: track.cover_art_file.as_ref().map(|cover| {
                        crate::app_database::MediaMetadataCoverArtFileInput {
                            path: cover.path.as_str(),
                            mime_type: cover.mime_type.as_deref(),
                            byte_len: cover.byte_len,
                        }
                    }),
                });
            }
        }
    }

    cancel_token.check()?;
    let parsed_report = db.record_local_scan_metadata_batch(&parsed_records)?;
    if parsed_report.fallback_count > 0 {
        log::debug!(
            "Local scan metadata batch used safe identity fallback for {} of {} records",
            parsed_report.fallback_count,
            parsed_report.results.len()
        );
    }
    for (path, result) in parsed_paths.into_iter().zip(parsed_report.results) {
        match result {
            Ok(_) => {
                seen_paths.push(path.to_string());
                indexed_delta += 1;
            }
            Err(e) => {
                let message = format!("{} ({})", path, e);
                log::warn!("Failed to index '{}': {}", path, e);
                failures.push(message);
            }
        }
    }

    cancel_token.check()?;
    db.mark_local_scan_seen_paths(scan_task_id, &seen_paths)
        .map_err(|e| format!("Failed to persist local scan seen set: {}", e))?;

    Ok(LocalScanBatchResult {
        indexed_delta,
        failures,
    })
}

fn join_local_scan_workers(
    handles: Vec<std::thread::JoinHandle<Result<(), String>>>,
) -> Result<(), String> {
    for handle in handles {
        join_local_scan_thread(handle)??;
    }
    Ok(())
}

fn join_local_scan_writer(
    handle: std::thread::JoinHandle<Result<LocalScanWriteSummary, String>>,
) -> Result<LocalScanWriteSummary, String> {
    join_local_scan_thread(handle)?
}

fn join_local_scan_thread<T>(handle: std::thread::JoinHandle<T>) -> Result<T, String> {
    handle.join().map_err(|payload| {
        let msg = payload
            .downcast_ref::<&'static str>()
            .copied()
            .map(str::to_string)
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "(non-string panic payload)".to_string());
        format!("Local library scan thread panicked: {}", msg)
    })
}

fn send_with_cancel<T>(
    tx: &Sender<T>,
    value: T,
    cancel_token: &AnalysisCancelToken,
) -> Result<(), String> {
    let mut pending = value;
    loop {
        cancel_token.check()?;
        match tx.send_timeout(pending, Duration::from_millis(LOCAL_SCAN_CHANNEL_RETRY_MS)) {
            Ok(()) => return Ok(()),
            Err(SendTimeoutError::Timeout(value)) => pending = value,
            Err(SendTimeoutError::Disconnected(_)) => {
                return Err("Local library scan pipeline stopped".to_string())
            }
        }
    }
}

pub(super) fn clear_local_scan_seen_set(data: &web::Data<Arc<AppState>>, scan_task_id: u64) {
    if let Err(e) = data.app_db.clear_local_scan_seen_set(scan_task_id) {
        log::warn!(
            "Failed to clear local library scan seen set for task {}: {}",
            scan_task_id,
            e
        );
    }
}

pub(super) fn scan_webdav_library(
    data: &web::Data<Arc<AppState>>,
    scan_task_id: u64,
    started_at: u64,
    root_id: i64,
    root_path: &str,
    source_key: Option<&str>,
    cancel_token: AnalysisCancelToken,
) -> Result<LibraryScanOutcome, String> {
    cancel_token.check()?;
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
    let mut index_failures = Vec::new();
    let mut stack = vec![root_path.to_string()];

    while let Some(path) = stack.pop() {
        cancel_token.check()?;
        let browse_started_at = std::time::Instant::now();
        let entries = webdav_cfg.list(&path).map_err(|e| {
            record_webdav_probe(data.as_ref().as_ref(), browse_started_at.elapsed(), false);
            format!("Failed to browse WebDAV path '{}': {}", path, e)
        })?;
        record_webdav_probe(data.as_ref().as_ref(), browse_started_at.elapsed(), true);
        cancel_token.check()?;

        for entry in entries {
            cancel_token.check()?;
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
            cancel_token.check()?;
            match crate::decoder::StreamingDecoder::open_with_credentials_and_cancel(
                &entry.url,
                credentials.as_ref(),
                Some(cancel_token.decode_token()),
            ) {
                Ok(decoder) => {
                    cancel_token.check()?;
                    let info = decoder.info.clone();
                    match data.app_db.record_media_metadata(
                        &entry.url,
                        &info.metadata,
                        info.duration_secs,
                        Some(info.sample_rate),
                        Some(info.channels),
                    ) {
                        Ok(_) => indexed += 1,
                        Err(e) => {
                            log::warn!("Failed to index remote media '{}': {}", entry.url, e);
                            index_failures.push(format!("{} ({})", entry.url, e));
                        }
                    }
                }
                Err(e) => log::warn!("Skipping remote media '{}': {}", entry.url, e),
            }

            if scanned % LOCAL_SCAN_PROGRESS_INTERVAL == 0 {
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

    if !index_failures.is_empty() {
        return Err(format!(
            "Failed to index {} remote media item(s): {}",
            index_failures.len(),
            index_failures.join("; ")
        ));
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
    use super::{
        external_cover_for_media, local_scan_source_path, metadata_with_external_cover,
        persist_local_scan_cover_art, process_local_scan_path, walk_supported_local_media_paths,
        LocalScanWriteItem, LOCAL_SCAN_EMBEDDED_COVER_FILE_CACHE_MIN_BYTES, UNKNOWN_SONG_TITLE,
    };
    use crate::server::{analysis_cancelled_error, AnalysisCancelToken};
    use crossbeam::channel::bounded;
    use std::collections::HashMap;
    use std::fs;
    use std::path::Path;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn unique_temp_dir(name: &str) -> std::path::PathBuf {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "audio_player_library_scan_{}_{}_{}",
            name,
            std::process::id(),
            suffix
        ))
    }

    #[test]
    fn metadata_with_external_cover_uses_sidecar_art_when_missing() {
        let temp_dir = unique_temp_dir("cover");
        let _ = fs::create_dir_all(&temp_dir);

        let cover_path = temp_dir.join("cover.jpg");
        fs::write(&cover_path, [1_u8, 2, 3, 4]).unwrap();

        let track_path = temp_dir.join("song.flac");
        let metadata = crate::decoder::TrackMetadata::default();

        let enriched = metadata_with_external_cover(&track_path, &metadata, 1024);

        assert_eq!(enriched.cover_art.as_deref(), Some(&[1_u8, 2, 3, 4][..]));
        assert_eq!(enriched.cover_art_mime.as_deref(), Some("image/jpeg"));
        assert_eq!(
            external_cover_for_media(&track_path, 1024).map(|(bytes, mime)| (bytes, mime)),
            Some((vec![1_u8, 2, 3, 4], "image/jpeg".to_string()))
        );

        let _ = fs::remove_file(cover_path);
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn metadata_with_external_cover_skips_sidecar_art_over_budget() {
        let temp_dir = unique_temp_dir("large_cover");
        let _ = fs::create_dir_all(&temp_dir);

        let cover_path = temp_dir.join("cover.jpg");
        fs::write(&cover_path, [1_u8, 2, 3, 4]).unwrap();

        let track_path = temp_dir.join("song.flac");
        let metadata = crate::decoder::TrackMetadata::default();

        let enriched = metadata_with_external_cover(&track_path, &metadata, 3);

        assert!(enriched.cover_art.is_none());
        assert!(external_cover_for_media(&track_path, 3).is_none());

        let _ = fs::remove_file(cover_path);
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn persist_local_scan_cover_art_writes_cache_file_and_strips_db_blob_payload() {
        let temp_dir = unique_temp_dir("cover_cache");
        let cache_dir = temp_dir.join("cache");
        let cover_bytes = vec![5_u8; LOCAL_SCAN_EMBEDDED_COVER_FILE_CACHE_MIN_BYTES];
        let mut metadata = crate::decoder::TrackMetadata {
            cover_art: Some(cover_bytes.clone()),
            cover_art_mime: Some("image/png".to_string()),
            ..crate::decoder::TrackMetadata::default()
        };

        let cover = persist_local_scan_cover_art(
            &cache_dir,
            "D:/Music/Artist/Album/Track.flac",
            &mut metadata,
        )
        .expect("cover file should be cached");

        assert!(metadata.cover_art.is_none());
        assert_eq!(metadata.cover_art_mime.as_deref(), Some("image/png"));
        assert_eq!(
            cover.byte_len,
            LOCAL_SCAN_EMBEDDED_COVER_FILE_CACHE_MIN_BYTES as u64
        );
        assert_eq!(cover.mime_type.as_deref(), Some("image/png"));
        assert!(cover.path.ends_with(".png"));
        assert_eq!(fs::read(&cover.path).unwrap(), cover_bytes);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn unchanged_local_scan_marks_seen_when_file_backed_cover_exists() {
        let temp_dir = unique_temp_dir("cover_seen");
        fs::create_dir_all(&temp_dir).unwrap();
        let track_path = temp_dir.join("song.flac");
        fs::write(&track_path, vec![0_u8; 2048]).unwrap();
        let cover_path = temp_dir.join("cover.jpg");
        fs::write(&cover_path, [1_u8, 2, 3]).unwrap();
        let canonical_path = track_path
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let metadata = fs::metadata(&track_path).unwrap();
        let mtime = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as f64)
            .unwrap_or(0.0);
        let mut snapshot = HashMap::new();
        snapshot.insert(
            canonical_path.clone(),
            (
                Some(mtime),
                Some(metadata.len()),
                Some(cover_path.to_string_lossy().to_string()),
            ),
        );

        let scanned_count = AtomicU64::new(0);
        let token = AnalysisCancelToken::new();
        let result = process_local_scan_path(
            &track_path,
            &snapshot,
            &scanned_count,
            &token,
            1024,
            &temp_dir.join("cache"),
        )
        .unwrap();

        assert!(matches!(result, Some(LocalScanWriteItem::Seen(path)) if path == canonical_path));
        assert_eq!(scanned_count.load(Ordering::Relaxed), 1);
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn local_scan_source_path_skips_canonicalize_for_empty_snapshot() {
        let path = Path::new("D:/Music/Artist/Track.flac");
        let snapshot = HashMap::new();

        assert_eq!(
            local_scan_source_path(path, &snapshot),
            path.to_string_lossy()
        );
    }

    #[test]
    fn local_scan_source_path_falls_back_to_snapshot_canonical_identity() {
        let temp_dir = unique_temp_dir("canonical_fallback");
        fs::create_dir_all(&temp_dir).unwrap();
        let track_path = temp_dir.join("song.flac");
        fs::write(&track_path, vec![0_u8; 2048]).unwrap();
        let canonical_path = track_path
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let mut snapshot = HashMap::new();
        snapshot.insert(canonical_path.clone(), (Some(0.0), Some(2048), None));

        assert_eq!(
            local_scan_source_path(&track_path, &snapshot),
            canonical_path
        );

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn unchanged_local_scan_reprocesses_missing_file_backed_cover() {
        let temp_dir = unique_temp_dir("cover_missing");
        fs::create_dir_all(&temp_dir).unwrap();
        let track_path = temp_dir.join("song.flac");
        fs::write(&track_path, vec![0_u8; 2048]).unwrap();
        let canonical_path = track_path
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let metadata = fs::metadata(&track_path).unwrap();
        let mtime = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as f64)
            .unwrap_or(0.0);
        let mut snapshot = HashMap::new();
        snapshot.insert(
            canonical_path,
            (
                Some(mtime),
                Some(metadata.len()),
                Some(temp_dir.join("missing.jpg").to_string_lossy().to_string()),
            ),
        );

        let scanned_count = AtomicU64::new(0);
        let token = AnalysisCancelToken::new();
        let result = process_local_scan_path(
            &track_path,
            &snapshot,
            &scanned_count,
            &token,
            1024,
            &temp_dir.join("cache"),
        )
        .unwrap();

        assert!(result.is_none());
        assert_eq!(scanned_count.load(Ordering::Relaxed), 1);
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn local_scan_walker_skips_symlink_directories() {
        let temp_dir = unique_temp_dir("walk");
        let nested_dir = temp_dir.join("nested");
        fs::create_dir_all(&nested_dir).unwrap();
        let track_path = nested_dir.join("song.flac");
        let text_path = nested_dir.join("notes.txt");
        fs::write(&track_path, b"fake audio").unwrap();
        fs::write(&text_path, b"not audio").unwrap();

        let linked_dir = temp_dir.join("linked");
        create_dir_symlink(&nested_dir, &linked_dir);

        let (tx, rx) = bounded(8);
        let token = AnalysisCancelToken::new();
        walk_supported_local_media_paths(temp_dir.to_str().unwrap(), &tx, &token).unwrap();
        drop(tx);
        let mut paths = rx.iter().collect::<Vec<_>>();
        paths.sort();

        assert_eq!(paths, vec![track_path]);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn local_scan_walker_skips_hidden_directories() {
        let temp_dir = unique_temp_dir("hidden_walk");
        let visible_dir = temp_dir.join("visible");
        let hidden_dir = temp_dir.join(".hidden");
        fs::create_dir_all(&visible_dir).unwrap();
        fs::create_dir_all(&hidden_dir).unwrap();
        let visible_track = visible_dir.join("song.flac");
        fs::write(&visible_track, b"fake audio").unwrap();
        fs::write(hidden_dir.join("hidden.flac"), b"fake audio").unwrap();

        let (tx, rx) = bounded(8);
        let token = AnalysisCancelToken::new();
        walk_supported_local_media_paths(temp_dir.to_str().unwrap(), &tx, &token).unwrap();
        drop(tx);
        let paths = rx.iter().collect::<Vec<_>>();

        assert_eq!(paths, vec![visible_track]);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn local_scan_walker_respects_cancellation() {
        let temp_dir = unique_temp_dir("cancel");
        fs::create_dir_all(&temp_dir).unwrap();
        fs::write(temp_dir.join("song.flac"), b"fake audio").unwrap();

        let (tx, rx) = bounded(8);
        let token = AnalysisCancelToken::new();
        token.cancel();
        let result = walk_supported_local_media_paths(temp_dir.to_str().unwrap(), &tx, &token);

        assert_eq!(result, Err(analysis_cancelled_error()));
        assert!(rx.is_empty());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn missing_library_metadata_keeps_artist_and_album_empty() {
        let track_path = Path::new("D:/music/Example Song.flac");
        let mut metadata = crate::decoder::TrackMetadata::default();

        let file_stem = track_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(UNKNOWN_SONG_TITLE);
        if metadata
            .title
            .as_deref()
            .map_or(true, |title| title.trim().is_empty())
        {
            metadata.title = Some(file_stem.to_string());
        }
        if metadata
            .artist
            .as_deref()
            .map_or(true, |artist| artist.trim().is_empty())
        {
            metadata.artist = None;
        }
        if metadata
            .album
            .as_deref()
            .map_or(true, |album| album.trim().is_empty())
        {
            metadata.album = None;
        }

        assert_eq!(metadata.title.as_deref(), Some("Example Song"));
        assert_eq!(metadata.artist, None);
        assert_eq!(metadata.album, None);
    }

    #[cfg(unix)]
    fn create_dir_symlink(target: &Path, link: &Path) {
        let _ = std::os::unix::fs::symlink(target, link);
    }

    #[cfg(windows)]
    fn create_dir_symlink(target: &Path, link: &Path) {
        let _ = std::os::windows::fs::symlink_dir(target, link);
    }
}

use std::hint::black_box;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crossbeam::channel::{bounded, Receiver, Sender};
use rusqlite::{params, Connection};

const ROOT_PATH: &str = "D:/bench/library";
const LOCAL_SCAN_DB_BATCH_SIZE: usize = 50;
const LOCAL_SCAN_CHANNEL_CAPACITY: usize = 64;
const BYTES_PER_MIB: f64 = 1024.0 * 1024.0;

#[derive(Clone, Default)]
struct BenchTrackMetadata {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    track_number: Option<u32>,
    disc_number: Option<u32>,
    genre: Option<String>,
    year: Option<u32>,
    cover_art: Option<Vec<u8>>,
    cover_art_mime: Option<String>,
}

#[derive(Clone)]
struct SyntheticTrack {
    source_path: String,
    metadata: BenchTrackMetadata,
    duration_secs: Option<f64>,
    sample_rate: Option<u32>,
    channels: Option<usize>,
    bitrate_bps: Option<f64>,
    bits_per_sample: Option<u32>,
    mtime: f64,
    size_bytes: u64,
}

struct BenchDatabase {
    conn: Connection,
}

struct DbFixture {
    db: Option<BenchDatabase>,
    dir: PathBuf,
}

struct PipelineReport {
    indexed: usize,
    removed_stale: u64,
    worker_count: usize,
    records_per_sec: f64,
    elapsed: Duration,
}

struct DbWriteReport {
    records: usize,
    records_per_sec: f64,
    elapsed: Duration,
}

struct DbWriteComparisonReport {
    records: usize,
    legacy_records_per_sec: f64,
    legacy_elapsed: Duration,
    batch_records_per_sec: f64,
    batch_elapsed: Duration,
    speedup: f64,
}

struct SeenSetReport {
    records: usize,
    removed_stale: u64,
    insert_records_per_sec: f64,
    cleanup_records_per_sec: f64,
    insert_elapsed: Duration,
    cleanup_elapsed: Duration,
}

struct CancelReport {
    total_files: usize,
    cancel_after: usize,
    processed_total: usize,
    processed_after_cancel: usize,
    cancel_latency: Duration,
}

struct CoverReport {
    scenario: &'static str,
    iterations: usize,
    cover_bytes: u64,
    accepted: usize,
    rejected: usize,
    ns_per_check: f64,
    elapsed: Duration,
}

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let quick = args.iter().any(|arg| arg == "--quick");
    let heavy = args.iter().any(|arg| arg == "--heavy");
    let enforce = args.iter().any(|arg| arg == "--enforce");

    let sizes = if heavy {
        vec![1_000, 10_000, 100_000]
    } else {
        vec![1_000, 10_000]
    };
    let worker_counts = if heavy { vec![1, 4, 8] } else { vec![1, 4] };

    println!(
        "backend_library_scan_perf mode={} sizes={:?} worker_counts={:?} coverage=synthetic_local_scan_pipeline_db_writer_temp_seen_set_cancel_cover_budget",
        mode_name(quick, heavy),
        sizes,
        worker_counts
    );
    println!(
        "backend_library_scan_note includes=app_database_equivalent_media_upsert,temp_seen_set_delete,metadata_worker_channels,sidecar_cover_limit,cancel_boundary excludes=real_audio_decode,real_user_library,webdav_network"
    );

    for &size in &sizes {
        let tracks = synthetic_tracks(size);
        for &worker_count in &worker_counts {
            let report = measure_pipeline(&tracks, worker_count);
            println!(
                "library_scan_pipeline files={} worker_count={} batch_size={} indexed={} removed_stale={} records_per_sec={:.3} elapsed_ms={:.3}",
                size,
                report.worker_count,
                LOCAL_SCAN_DB_BATCH_SIZE,
                report.indexed,
                report.removed_stale,
                report.records_per_sec,
                report.elapsed.as_secs_f64() * 1_000.0
            );
            if enforce {
                assert_eq!(report.indexed, size);
                assert_eq!(report.removed_stale, 1);
            }
        }

        let db_write = measure_db_write(&tracks);
        println!(
            "library_scan_db_writer files={} records={} records_per_sec={:.3} elapsed_ms={:.3}",
            size,
            db_write.records,
            db_write.records_per_sec,
            db_write.elapsed.as_secs_f64() * 1_000.0
        );
        if enforce {
            assert_eq!(db_write.records, size);
        }

        let write_comparison = measure_db_write_comparison(&tracks);
        println!(
            "library_scan_db_writer_comparison files={} records={} legacy_records_per_sec={:.3} legacy_elapsed_ms={:.3} batch_records_per_sec={:.3} batch_elapsed_ms={:.3} speedup={:.3}",
            size,
            write_comparison.records,
            write_comparison.legacy_records_per_sec,
            write_comparison.legacy_elapsed.as_secs_f64() * 1_000.0,
            write_comparison.batch_records_per_sec,
            write_comparison.batch_elapsed.as_secs_f64() * 1_000.0,
            write_comparison.speedup
        );
        if enforce {
            assert_eq!(write_comparison.records, size);
            assert!(write_comparison.speedup >= 1.0);
        }

        let seen_set = measure_seen_set(&tracks);
        println!(
            "library_scan_temp_seen_set files={} inserted={} removed_stale={} insert_records_per_sec={:.3} cleanup_records_per_sec={:.3} insert_elapsed_ms={:.3} cleanup_elapsed_ms={:.3}",
            size,
            seen_set.records,
            seen_set.removed_stale,
            seen_set.insert_records_per_sec,
            seen_set.cleanup_records_per_sec,
            seen_set.insert_elapsed.as_secs_f64() * 1_000.0,
            seen_set.cleanup_elapsed.as_secs_f64() * 1_000.0
        );
        if enforce {
            assert_eq!(seen_set.records, size);
            assert_eq!(seen_set.removed_stale, 1);
        }
    }

    let cancel_total = if heavy { 25_000 } else { 10_000 };
    for worker_count in worker_counts {
        let report = measure_cancel_boundary(cancel_total, 250, worker_count);
        println!(
            "library_scan_cancel_boundary files={} worker_count={} cancel_after={} processed_total={} processed_after_cancel={} cancel_latency_us={:.3}",
            report.total_files,
            worker_count,
            report.cancel_after,
            report.processed_total,
            report.processed_after_cancel,
            report.cancel_latency.as_secs_f64() * 1_000_000.0
        );
        if enforce {
            let after_cancel_limit = LOCAL_SCAN_CHANNEL_CAPACITY * worker_count + worker_count;
            assert!(report.processed_total <= report.total_files);
            assert!(report.processed_total <= report.cancel_after + after_cancel_limit);
            assert!(report.processed_after_cancel <= after_cancel_limit);
        }
    }

    let cover_iterations = if heavy { 2_000 } else { 500 };
    for report in measure_cover_limits(cover_iterations) {
        println!(
            "library_scan_cover_limit scenario={} iterations={} cover_bytes={} accepted={} rejected={} cover_mib={:.6} ns_per_check={:.3} elapsed_ms={:.3}",
            report.scenario,
            report.iterations,
            report.cover_bytes,
            report.accepted,
            report.rejected,
            report.cover_bytes as f64 / BYTES_PER_MIB,
            report.ns_per_check,
            report.elapsed.as_secs_f64() * 1_000.0
        );
        if enforce {
            match report.scenario {
                "missing_sidecar" | "oversized_sidecar" => assert_eq!(report.accepted, 0),
                "small_sidecar" => assert_eq!(report.accepted, report.iterations),
                _ => {}
            }
        }
    }
}

fn mode_name(quick: bool, heavy: bool) -> &'static str {
    if quick {
        "quick"
    } else if heavy {
        "heavy"
    } else {
        "full"
    }
}

fn measure_pipeline(tracks: &[SyntheticTrack], worker_count: usize) -> PipelineReport {
    let mut fixture = DbFixture::new("pipeline");
    let db = fixture.db_mut();
    let stale_path = format!("{}/stale/old.flac", ROOT_PATH);
    db.record_track(&synthetic_track_for_path(stale_path, usize::MAX));

    let scan_task_id = unique_task_id();
    let (path_tx, path_rx) = bounded::<SyntheticTrack>(LOCAL_SCAN_CHANNEL_CAPACITY);
    let (write_tx, write_rx) = bounded::<SyntheticTrack>(LOCAL_SCAN_CHANNEL_CAPACITY);

    let started = Instant::now();
    db.begin_local_scan_seen_set(scan_task_id);
    let feeder_tracks = tracks.to_vec();
    let feeder = std::thread::spawn(move || {
        for track in feeder_tracks {
            if path_tx.send(track).is_err() {
                break;
            }
        }
    });
    let workers = spawn_workers(worker_count, path_rx, write_tx.clone());
    drop(write_tx);

    let mut indexed = 0usize;
    let mut batch = Vec::with_capacity(LOCAL_SCAN_DB_BATCH_SIZE);
    for track in write_rx.iter() {
        batch.push(track);
        if batch.len() >= LOCAL_SCAN_DB_BATCH_SIZE {
            db.write_batch(scan_task_id, &batch);
            indexed += batch.len();
            batch.clear();
        }
    }
    if !batch.is_empty() {
        db.write_batch(scan_task_id, &batch);
        indexed += batch.len();
    }
    feeder.join().expect("feeder should not panic");
    for worker in workers {
        worker.join().expect("worker should not panic");
    }
    let removed_stale = db.delete_local_media_not_seen_in_root(ROOT_PATH, scan_task_id);
    let elapsed = started.elapsed();

    fixture.close();
    PipelineReport {
        indexed,
        removed_stale,
        worker_count,
        records_per_sec: records_per_sec(indexed, elapsed),
        elapsed,
    }
}

fn spawn_workers(
    worker_count: usize,
    path_rx: Receiver<SyntheticTrack>,
    write_tx: Sender<SyntheticTrack>,
) -> Vec<std::thread::JoinHandle<()>> {
    (0..worker_count)
        .map(|_| {
            let path_rx = path_rx.clone();
            let write_tx = write_tx.clone();
            std::thread::spawn(move || {
                for track in path_rx.iter() {
                    let parsed = synthesize_worker_metadata(black_box(track));
                    if write_tx.send(parsed).is_err() {
                        break;
                    }
                }
            })
        })
        .collect()
}

fn measure_db_write(tracks: &[SyntheticTrack]) -> DbWriteReport {
    let mut fixture = DbFixture::new("db-write");
    let db = fixture.db_mut();
    let started = Instant::now();
    for chunk in tracks.chunks(LOCAL_SCAN_DB_BATCH_SIZE) {
        db.write_batch(unique_task_id(), chunk);
    }
    let elapsed = started.elapsed();
    fixture.close();
    DbWriteReport {
        records: tracks.len(),
        records_per_sec: records_per_sec(tracks.len(), elapsed),
        elapsed,
    }
}

fn measure_db_write_comparison(tracks: &[SyntheticTrack]) -> DbWriteComparisonReport {
    let legacy_elapsed = {
        let mut fixture = DbFixture::new("db-write-legacy");
        let db = fixture.db_mut();
        let started = Instant::now();
        for track in tracks {
            db.write_one_with_transaction(track);
        }
        let elapsed = started.elapsed();
        fixture.close();
        elapsed
    };

    let batch_elapsed = {
        let mut fixture = DbFixture::new("db-write-batch");
        let db = fixture.db_mut();
        let started = Instant::now();
        for chunk in tracks.chunks(LOCAL_SCAN_DB_BATCH_SIZE) {
            db.write_batch_without_seen_set(chunk);
        }
        let elapsed = started.elapsed();
        fixture.close();
        elapsed
    };

    let legacy_records_per_sec = records_per_sec(tracks.len(), legacy_elapsed);
    let batch_records_per_sec = records_per_sec(tracks.len(), batch_elapsed);
    DbWriteComparisonReport {
        records: tracks.len(),
        legacy_records_per_sec,
        legacy_elapsed,
        batch_records_per_sec,
        batch_elapsed,
        speedup: if legacy_records_per_sec <= 0.0 {
            0.0
        } else {
            batch_records_per_sec / legacy_records_per_sec
        },
    }
}

fn measure_seen_set(tracks: &[SyntheticTrack]) -> SeenSetReport {
    let mut fixture = DbFixture::new("seen-set");
    let db = fixture.db_mut();
    for chunk in tracks.chunks(LOCAL_SCAN_DB_BATCH_SIZE) {
        db.write_batch(unique_task_id(), chunk);
    }
    let stale_path = format!("{}/stale/old.flac", ROOT_PATH);
    db.record_track(&synthetic_track_for_path(stale_path, usize::MAX));

    let scan_task_id = unique_task_id();
    let paths = tracks
        .iter()
        .map(|track| track.source_path.clone())
        .collect::<Vec<_>>();

    db.begin_local_scan_seen_set(scan_task_id);
    let insert_started = Instant::now();
    db.mark_local_scan_seen_paths(scan_task_id, &paths);
    let insert_elapsed = insert_started.elapsed();

    let cleanup_started = Instant::now();
    let removed_stale = db.delete_local_media_not_seen_in_root(ROOT_PATH, scan_task_id);
    let cleanup_elapsed = cleanup_started.elapsed();

    fixture.close();
    SeenSetReport {
        records: tracks.len(),
        removed_stale,
        insert_records_per_sec: records_per_sec(tracks.len(), insert_elapsed),
        cleanup_records_per_sec: records_per_sec(tracks.len(), cleanup_elapsed),
        insert_elapsed,
        cleanup_elapsed,
    }
}

fn measure_cancel_boundary(
    total_files: usize,
    cancel_after: usize,
    worker_count: usize,
) -> CancelReport {
    let cancel = Arc::new(AtomicBool::new(false));
    let processed = Arc::new(AtomicUsize::new(0));
    let processed_at_cancel = Arc::new(AtomicUsize::new(0));
    let (tx, rx) = bounded::<usize>(LOCAL_SCAN_CHANNEL_CAPACITY);
    let mut workers = Vec::with_capacity(worker_count);

    for _ in 0..worker_count {
        let rx = rx.clone();
        let cancel = Arc::clone(&cancel);
        let processed = Arc::clone(&processed);
        workers.push(std::thread::spawn(move || {
            for value in rx.iter() {
                if cancel.load(Ordering::Acquire) {
                    break;
                }
                black_box(value.wrapping_mul(31).rotate_left(3));
                processed.fetch_add(1, Ordering::AcqRel);
            }
        }));
    }

    for index in 0..cancel_after.min(total_files) {
        tx.send(index).expect("send pre-cancel synthetic path");
    }
    let cancel_started = Instant::now();
    processed_at_cancel.store(processed.load(Ordering::Acquire), Ordering::Release);
    cancel.store(true, Ordering::Release);
    for index in cancel_after..total_files {
        if tx.try_send(index).is_err() {
            break;
        }
    }
    drop(tx);
    for worker in workers {
        worker.join().expect("cancel worker should not panic");
    }
    let cancel_latency = cancel_started.elapsed();
    let total_processed = processed.load(Ordering::Acquire);
    let processed_before_cancel = processed_at_cancel.load(Ordering::Acquire);

    CancelReport {
        total_files,
        cancel_after,
        processed_total: total_processed,
        processed_after_cancel: total_processed.saturating_sub(processed_before_cancel),
        cancel_latency,
    }
}

fn measure_cover_limits(iterations: usize) -> Vec<CoverReport> {
    let dir = unique_temp_dir("cover-limit");
    std::fs::create_dir_all(&dir).expect("create cover benchmark dir");
    let track_path = dir.join("song.flac");
    std::fs::write(&track_path, b"fake audio placeholder").expect("write placeholder track");

    let missing = measure_cover_limit_scenario("missing_sidecar", &track_path, 0, 8, iterations);

    let cover_path = dir.join("cover.jpg");
    std::fs::write(&cover_path, [1_u8, 2, 3, 4]).expect("write small cover");
    let small = measure_cover_limit_scenario("small_sidecar", &track_path, 4, 8, iterations);
    let oversized =
        measure_cover_limit_scenario("oversized_sidecar", &track_path, 4, 3, iterations);

    let _ = std::fs::remove_dir_all(&dir);
    vec![missing, small, oversized]
}

fn measure_cover_limit_scenario(
    scenario: &'static str,
    track_path: &Path,
    cover_bytes: u64,
    max_bytes: u64,
    iterations: usize,
) -> CoverReport {
    let metadata = BenchTrackMetadata::default();
    let mut accepted = 0usize;
    let mut rejected = 0usize;
    let started = Instant::now();
    for _ in 0..iterations {
        let enriched = metadata_with_external_cover(black_box(track_path), &metadata, max_bytes);
        if enriched.cover_art.is_some() {
            accepted += 1;
        } else {
            rejected += 1;
        }
        black_box(enriched);
    }
    let elapsed = started.elapsed();
    CoverReport {
        scenario,
        iterations,
        cover_bytes,
        accepted,
        rejected,
        ns_per_check: elapsed.as_nanos() as f64 / iterations.max(1) as f64,
        elapsed,
    }
}

fn metadata_with_external_cover(
    path: &Path,
    metadata: &BenchTrackMetadata,
    max_bytes: u64,
) -> BenchTrackMetadata {
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

fn external_cover_for_media(path: &Path, max_bytes: u64) -> Option<(Vec<u8>, String)> {
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

    candidates.sort();
    candidates.dedup();
    for candidate in candidates {
        if !candidate.is_file() {
            continue;
        }
        if std::fs::metadata(&candidate).ok()?.len() > max_bytes {
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
        if let Ok(bytes) = std::fs::read(&candidate) {
            return Some((bytes, mime));
        }
    }
    None
}

fn synthesize_worker_metadata(mut track: SyntheticTrack) -> SyntheticTrack {
    if track.metadata.title.is_none() {
        track.metadata.title = Some("Synthetic Track".to_string());
    }
    track
}

fn synthetic_tracks(count: usize) -> Vec<SyntheticTrack> {
    (0..count)
        .map(|index| {
            let source_path = format!(
                "{}/artist_{:03}/album_{:03}/track_{:06}.flac",
                ROOT_PATH,
                index % 128,
                index % 512,
                index
            );
            synthetic_track_for_path(source_path, index)
        })
        .collect()
}

fn synthetic_track_for_path(source_path: String, index: usize) -> SyntheticTrack {
    SyntheticTrack {
        source_path,
        metadata: BenchTrackMetadata {
            title: Some(format!("Synthetic Track {:06}", index)),
            artist: Some(format!("Artist {:03}", index % 128)),
            album: Some(format!("Album {:03}", index % 512)),
            track_number: Some((index % 99 + 1) as u32),
            disc_number: Some(1),
            genre: Some("Bench".to_string()),
            year: Some(2026),
            ..BenchTrackMetadata::default()
        },
        duration_secs: Some(180.0 + (index % 240) as f64),
        sample_rate: Some(if index % 5 == 0 { 96_000 } else { 48_000 }),
        channels: Some(2),
        bitrate_bps: Some(900_000.0 + (index % 100) as f64 * 1_000.0),
        bits_per_sample: Some(24),
        mtime: 1_780_000_000_000.0 + index as f64,
        size_bytes: 32_000_000 + (index % 10_000) as u64,
    }
}

fn records_per_sec(records: usize, elapsed: Duration) -> f64 {
    let seconds = elapsed.as_secs_f64();
    if seconds <= 0.0 {
        0.0
    } else {
        records as f64 / seconds
    }
}

fn unique_task_id() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "audio_player_{}_{}_{}",
        name,
        std::process::id(),
        suffix
    ))
}

fn media_id_for_path(path: &str) -> String {
    normalize_media_path_for_id(path)
        .replace('\\', "/")
        .to_lowercase()
}

fn normalize_media_path_for_id(path: &str) -> &str {
    path.strip_prefix(r"\\?\UNC\")
        .map(strip_leading_separator)
        .or_else(|| path.strip_prefix("//?/UNC/").map(strip_leading_separator))
        .or_else(|| path.strip_prefix(r"\\?\"))
        .or_else(|| path.strip_prefix("//?/"))
        .unwrap_or(path)
}

fn strip_leading_separator(value: &str) -> &str {
    value
        .strip_prefix('\\')
        .or_else(|| value.strip_prefix('/'))
        .unwrap_or(value)
}

fn now_epoch_secs_i64() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0)
}

impl BenchDatabase {
    fn open(path: &Path) -> Self {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create benchmark db parent");
        }
        let conn = Connection::open(path).expect("open benchmark sqlite db");
        conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS media_items (
                media_id TEXT PRIMARY KEY,
                source_path TEXT NOT NULL UNIQUE,
                source_kind TEXT NOT NULL,
                title TEXT,
                artist TEXT,
                album TEXT,
                track_number INTEGER,
                disc_number INTEGER,
                genre TEXT,
                year INTEGER,
                duration_secs REAL,
                sample_rate INTEGER,
                channels INTEGER,
                bitrate_bps REAL,
                bits_per_sample INTEGER,
                external_artwork_url TEXT,
                added_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                mtime REAL,
                size_bytes INTEGER
            );
            CREATE TABLE IF NOT EXISTS cover_art_cache (
                cover_art_id TEXT PRIMARY KEY,
                media_id TEXT NOT NULL,
                mime_type TEXT,
                image_bytes BLOB NOT NULL,
                byte_len INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(media_id) REFERENCES media_items(media_id) ON DELETE CASCADE
            );
            "#,
        )
        .expect("init benchmark schema");
        Self { conn }
    }

    fn record_track(&mut self, track: &SyntheticTrack) -> String {
        let media_id = media_id_for_path(&track.source_path);
        let source_kind = if track.source_path.starts_with("http://")
            || track.source_path.starts_with("https://")
        {
            "remote"
        } else {
            "local"
        };
        let now = now_epoch_secs_i64();
        self.conn
            .execute(
                r#"
                INSERT INTO media_items (media_id, source_path, source_kind, added_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?4)
                ON CONFLICT(media_id) DO UPDATE SET
                    source_path = excluded.source_path,
                    source_kind = excluded.source_kind,
                    updated_at = excluded.updated_at
                "#,
                params![media_id, track.source_path, source_kind, now],
            )
            .expect("record media stub");
        self.conn
            .execute(
                r#"
                UPDATE media_items
                SET title = COALESCE(NULLIF(?2, ''), title),
                    artist = COALESCE(NULLIF(?3, ''), artist),
                    album = COALESCE(NULLIF(?4, ''), album),
                    track_number = ?5,
                    disc_number = ?6,
                    genre = ?7,
                    year = ?8,
                    duration_secs = COALESCE(?9, duration_secs),
                    sample_rate = COALESCE(?10, sample_rate),
                    channels = COALESCE(?11, channels),
                    bitrate_bps = COALESCE(?12, bitrate_bps),
                    bits_per_sample = COALESCE(?13, bits_per_sample),
                    mtime = COALESCE(?15, mtime),
                    size_bytes = COALESCE(?16, size_bytes),
                    updated_at = ?14
                WHERE media_id = ?1
                "#,
                params![
                    media_id,
                    track.metadata.title,
                    track.metadata.artist,
                    track.metadata.album,
                    track.metadata.track_number.map(|v| v as i64),
                    track.metadata.disc_number.map(|v| v as i64),
                    track.metadata.genre,
                    track.metadata.year.map(|v| v as i64),
                    track.duration_secs,
                    track.sample_rate.map(|v| v as i64),
                    track.channels.map(|v| v as i64),
                    track.bitrate_bps,
                    track.bits_per_sample.map(|v| v as i64),
                    now,
                    track.mtime,
                    Some(track.size_bytes as i64),
                ],
            )
            .expect("record media metadata");
        if let Some(ref art) = track.metadata.cover_art {
            let cover_art_id = format!("{}:cover", media_id);
            self.conn
                .execute(
                    r#"
                    INSERT INTO cover_art_cache (cover_art_id, media_id, mime_type, image_bytes, byte_len, created_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                    ON CONFLICT(cover_art_id) DO UPDATE SET
                        mime_type = excluded.mime_type,
                        image_bytes = excluded.image_bytes,
                        byte_len = excluded.byte_len,
                        created_at = excluded.created_at
                    "#,
                    params![
                        cover_art_id,
                        media_id,
                        track.metadata.cover_art_mime,
                        art,
                        art.len() as i64,
                        now,
                    ],
                )
                .expect("record cover art");
        }
        media_id_for_path(&track.source_path)
    }

    fn write_one_with_transaction(&mut self, track: &SyntheticTrack) {
        let tx = self
            .conn
            .transaction()
            .expect("start benchmark legacy write tx");
        record_track_in_tx(&tx, track);
        tx.commit().expect("commit benchmark legacy write tx");
    }

    fn write_batch_without_seen_set(&mut self, batch: &[SyntheticTrack]) {
        if batch.is_empty() {
            return;
        }
        let tx = self
            .conn
            .transaction()
            .expect("start benchmark batch write tx");
        for track in batch {
            record_track_in_tx(&tx, track);
        }
        tx.commit().expect("commit benchmark batch write tx");
    }

    fn write_batch(&mut self, scan_task_id: u64, batch: &[SyntheticTrack]) {
        self.write_batch_without_seen_set(batch);
        let seen_paths = batch
            .iter()
            .map(|track| track.source_path.clone())
            .collect::<Vec<_>>();
        self.mark_local_scan_seen_paths(scan_task_id, &seen_paths);
    }

    fn begin_local_scan_seen_set(&mut self, scan_task_id: u64) {
        self.ensure_local_scan_seen_table();
        self.conn
            .execute(
                "DELETE FROM temp.local_scan_seen WHERE task_id = ?1",
                params![scan_task_id as i64],
            )
            .expect("reset local scan seen set");
    }

    fn mark_local_scan_seen_paths(&mut self, scan_task_id: u64, source_paths: &[String]) {
        if source_paths.is_empty() {
            return;
        }
        self.ensure_local_scan_seen_table();
        let tx = self.conn.transaction().expect("start seen tx");
        {
            let mut stmt = tx
                .prepare(
                    "INSERT OR IGNORE INTO temp.local_scan_seen (task_id, media_id) VALUES (?1, ?2)",
                )
                .expect("prepare seen insert");
            for source_path in source_paths {
                stmt.execute(params![scan_task_id as i64, media_id_for_path(source_path)])
                    .expect("insert seen path");
            }
        }
        tx.commit().expect("commit seen tx");
    }

    fn delete_local_media_not_seen_in_root(&mut self, root_path: &str, scan_task_id: u64) -> u64 {
        self.ensure_local_scan_seen_table();
        let tx = self.conn.transaction().expect("start cleanup tx");
        let root_media_id = media_id_for_path(root_path)
            .trim_end_matches('/')
            .to_string();
        let root_id_prefix = format!("{}/", root_media_id);
        let removed = tx
            .execute(
                r#"
                DELETE FROM media_items
                WHERE source_kind = 'local'
                  AND (
                    media_id = ?1
                    OR substr(media_id, 1, ?2) = ?3
                  )
                  AND NOT EXISTS (
                    SELECT 1
                    FROM temp.local_scan_seen seen
                    WHERE seen.task_id = ?4
                      AND seen.media_id = media_items.media_id
                  )
                "#,
                params![
                    root_media_id,
                    root_id_prefix.len() as i64,
                    root_id_prefix,
                    scan_task_id as i64,
                ],
            )
            .expect("delete stale media");
        tx.execute(
            "DELETE FROM temp.local_scan_seen WHERE task_id = ?1",
            params![scan_task_id as i64],
        )
        .expect("clear seen set");
        tx.commit().expect("commit cleanup tx");
        removed as u64
    }

    fn ensure_local_scan_seen_table(&self) {
        self.conn
            .execute_batch(
                r#"
                CREATE TEMP TABLE IF NOT EXISTS local_scan_seen (
                    task_id INTEGER NOT NULL,
                    media_id TEXT NOT NULL,
                    PRIMARY KEY (task_id, media_id)
                );
                "#,
            )
            .expect("prepare local scan seen table");
    }
}

fn record_track_in_tx(tx: &rusqlite::Transaction<'_>, track: &SyntheticTrack) -> String {
    let media_id = media_id_for_path(&track.source_path);
    let source_kind =
        if track.source_path.starts_with("http://") || track.source_path.starts_with("https://") {
            "remote"
        } else {
            "local"
        };
    let now = now_epoch_secs_i64();
    tx.execute(
        r#"
        INSERT INTO media_items (media_id, source_path, source_kind, added_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?4)
        ON CONFLICT(media_id) DO UPDATE SET
            source_path = excluded.source_path,
            source_kind = excluded.source_kind,
            updated_at = excluded.updated_at
        "#,
        params![media_id, track.source_path, source_kind, now],
    )
    .expect("record media stub in tx");
    tx.execute(
        r#"
        UPDATE media_items
        SET title = COALESCE(NULLIF(?2, ''), title),
            artist = COALESCE(NULLIF(?3, ''), artist),
            album = COALESCE(NULLIF(?4, ''), album),
            track_number = ?5,
            disc_number = ?6,
            genre = ?7,
            year = ?8,
            duration_secs = COALESCE(?9, duration_secs),
            sample_rate = COALESCE(?10, sample_rate),
            channels = COALESCE(?11, channels),
            bitrate_bps = COALESCE(?12, bitrate_bps),
            bits_per_sample = COALESCE(?13, bits_per_sample),
            mtime = COALESCE(?15, mtime),
            size_bytes = COALESCE(?16, size_bytes),
            updated_at = ?14
        WHERE media_id = ?1
        "#,
        params![
            media_id,
            track.metadata.title,
            track.metadata.artist,
            track.metadata.album,
            track.metadata.track_number.map(|v| v as i64),
            track.metadata.disc_number.map(|v| v as i64),
            track.metadata.genre,
            track.metadata.year.map(|v| v as i64),
            track.duration_secs,
            track.sample_rate.map(|v| v as i64),
            track.channels.map(|v| v as i64),
            track.bitrate_bps,
            track.bits_per_sample.map(|v| v as i64),
            now,
            track.mtime,
            Some(track.size_bytes as i64),
        ],
    )
    .expect("record media metadata in tx");
    media_id_for_path(&track.source_path)
}

impl DbFixture {
    fn new(name: &str) -> Self {
        let dir = unique_temp_dir(name);
        let db = BenchDatabase::open(&dir.join("app.db"));
        Self { db: Some(db), dir }
    }

    fn db_mut(&mut self) -> &mut BenchDatabase {
        self.db.as_mut().expect("db fixture is open")
    }

    fn close(&mut self) {
        self.db.take();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

impl Drop for DbFixture {
    fn drop(&mut self) {
        self.close();
    }
}

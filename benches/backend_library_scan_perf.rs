use std::hint::black_box;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crossbeam::channel::{bounded, Receiver, Sender};
use image::{DynamicImage, ImageBuffer, ImageFormat, Rgb};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

const ROOT_PATH: &str = "D:/bench/library";
const LOCAL_SCAN_DB_BATCH_SIZE: usize = 500;
const LOCAL_SCAN_CHANNEL_CAPACITY: usize = 64;
const BYTES_PER_MIB: f64 = 1024.0 * 1024.0;
const SCAN_STREAM_BATCH_SIZE: usize = 50;

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

struct DbFastPathComparisonReport {
    records: usize,
    identity_records_per_sec: f64,
    identity_elapsed: Duration,
    fast_records_per_sec: f64,
    fast_elapsed: Duration,
    fallback_count: usize,
    speedup: f64,
}

struct DbBatchSizeReport {
    records: usize,
    batch_size: usize,
    records_per_sec: f64,
    elapsed: Duration,
    fallback_count: usize,
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

struct CoverStorageReport {
    records: usize,
    cover_bytes: usize,
    blob_db_records_per_sec: f64,
    blob_db_elapsed: Duration,
    file_write_records_per_sec: f64,
    file_write_elapsed: Duration,
    file_ref_db_records_per_sec: f64,
    file_ref_db_elapsed: Duration,
}

struct WalkTraversalReport {
    total_files: usize,
    hidden_files: usize,
    manual_all_count: usize,
    manual_skip_hidden_count: usize,
    manual_collect_count: usize,
    jwalk_skip_hidden_count: usize,
    manual_all_elapsed: Duration,
    manual_skip_hidden_elapsed: Duration,
    manual_collect_elapsed: Duration,
    jwalk_skip_hidden_elapsed: Duration,
    manual_collect_path_bytes: usize,
    jwalk_collect_path_bytes: usize,
}

struct CoverResizeReport {
    iterations: usize,
    source_width: u32,
    source_height: u32,
    target_width: u32,
    target_height: u32,
    source_bytes: usize,
    average_resized_bytes: usize,
    resize_elapsed: Duration,
    resize_records_per_sec: f64,
    size_ratio: f64,
}

struct ScanStreamingReport {
    records: usize,
    batch_size: usize,
    batch_events: usize,
    progress_events: usize,
    batch_payload_bytes: usize,
    progress_payload_bytes: usize,
    batch_serialize_elapsed: Duration,
    progress_serialize_elapsed: Duration,
    payload_overhead_ratio: f64,
    serialize_overhead_ratio: f64,
}

#[derive(Serialize)]
struct ScanBatchEvent<'a> {
    #[serde(rename = "type")]
    event_type: &'static str,
    task_id: u64,
    scanned_files: usize,
    indexed_files: usize,
    tracks: Vec<ScanTrackEvent<'a>>,
}

#[derive(Serialize)]
struct ScanTrackEvent<'a> {
    media_id: &'a str,
    title: Option<&'a str>,
    artist: Option<&'a str>,
    album: Option<&'a str>,
    duration_secs: Option<f64>,
    has_cover_art: bool,
}

#[derive(Serialize)]
struct ScanProgressEvent {
    #[serde(rename = "type")]
    event_type: &'static str,
    task_id: u64,
    scanned_files: usize,
    indexed_files: usize,
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
        "backend_library_scan_perf mode={} sizes={:?} worker_counts={:?} coverage=synthetic_local_scan_pipeline_db_writer_temp_seen_set_cancel_cover_budget_cover_storage_walk_resize_streaming",
        mode_name(quick, heavy),
        sizes,
        worker_counts
    );
    println!(
        "backend_library_scan_note includes=app_database_equivalent_media_upsert,temp_seen_set_delete,metadata_worker_channels,sidecar_cover_limit,cover_file_ref_storage,manual_vs_jwalk_walk,image_resize,scan_stream_event_payload,cancel_boundary excludes=real_audio_decode,real_user_library,webdav_network,actual_websocket_io"
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

        let fast_comparison = measure_db_fast_path_comparison(&tracks, LOCAL_SCAN_DB_BATCH_SIZE);
        println!(
            "library_scan_db_writer_fast_path files={} records={} batch_size={} identity_records_per_sec={:.3} identity_elapsed_ms={:.3} fast_records_per_sec={:.3} fast_elapsed_ms={:.3} fallback_count={} speedup={:.3}",
            size,
            fast_comparison.records,
            LOCAL_SCAN_DB_BATCH_SIZE,
            fast_comparison.identity_records_per_sec,
            fast_comparison.identity_elapsed.as_secs_f64() * 1_000.0,
            fast_comparison.fast_records_per_sec,
            fast_comparison.fast_elapsed.as_secs_f64() * 1_000.0,
            fast_comparison.fallback_count,
            fast_comparison.speedup
        );
        if enforce {
            assert_eq!(fast_comparison.records, size);
            assert_eq!(fast_comparison.fallback_count, 0);
        }

        for sweep in measure_fast_batch_size_sweep(&tracks) {
            println!(
                "library_scan_db_writer_batch_size files={} records={} batch_size={} records_per_sec={:.3} elapsed_ms={:.3} fallback_count={}",
                size,
                sweep.records,
                sweep.batch_size,
                sweep.records_per_sec,
                sweep.elapsed.as_secs_f64() * 1_000.0,
                sweep.fallback_count
            );
            if enforce {
                assert_eq!(sweep.records, size);
                assert_eq!(sweep.fallback_count, 0);
            }
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

    let cover_storage_records = if heavy { 5_000 } else { 1_000 };
    let cover_storage_bytes = 64 * 1024;
    let cover_storage = measure_cover_storage(cover_storage_records, cover_storage_bytes);
    println!(
        "library_scan_cover_storage records={} cover_bytes={} total_cover_mib={:.3} blob_db_records_per_sec={:.3} blob_db_elapsed_ms={:.3} file_write_records_per_sec={:.3} file_write_elapsed_ms={:.3} file_ref_db_records_per_sec={:.3} file_ref_db_elapsed_ms={:.3}",
        cover_storage.records,
        cover_storage.cover_bytes,
        cover_storage.records as f64 * cover_storage.cover_bytes as f64 / BYTES_PER_MIB,
        cover_storage.blob_db_records_per_sec,
        cover_storage.blob_db_elapsed.as_secs_f64() * 1_000.0,
        cover_storage.file_write_records_per_sec,
        cover_storage.file_write_elapsed.as_secs_f64() * 1_000.0,
        cover_storage.file_ref_db_records_per_sec,
        cover_storage.file_ref_db_elapsed.as_secs_f64() * 1_000.0
    );
    if enforce {
        assert_eq!(cover_storage.records, cover_storage_records);
        assert_eq!(cover_storage.cover_bytes, cover_storage_bytes);
    }

    let walk_total_files = if heavy { 50_000 } else { 5_000 };
    let walk_hidden_files = walk_total_files / 10;
    let walk = measure_walk_traversal(walk_total_files, walk_hidden_files);
    println!(
        "library_scan_walk_traversal total_files={} hidden_files={} manual_all_count={} manual_all_ms={:.3} manual_skip_hidden_count={} manual_skip_hidden_ms={:.3} manual_collect_count={} manual_collect_ms={:.3} manual_collect_path_bytes={} jwalk_skip_hidden_count={} jwalk_skip_hidden_ms={:.3} jwalk_collect_path_bytes={} hidden_semantic_delta={}",
        walk.total_files,
        walk.hidden_files,
        walk.manual_all_count,
        walk.manual_all_elapsed.as_secs_f64() * 1_000.0,
        walk.manual_skip_hidden_count,
        walk.manual_skip_hidden_elapsed.as_secs_f64() * 1_000.0,
        walk.manual_collect_count,
        walk.manual_collect_elapsed.as_secs_f64() * 1_000.0,
        walk.manual_collect_path_bytes,
        walk.jwalk_skip_hidden_count,
        walk.jwalk_skip_hidden_elapsed.as_secs_f64() * 1_000.0,
        walk.jwalk_collect_path_bytes,
        walk.manual_all_count.saturating_sub(walk.jwalk_skip_hidden_count)
    );
    if enforce {
        assert_eq!(walk.manual_all_count, walk_total_files);
        assert_eq!(
            walk.manual_skip_hidden_count,
            walk_total_files - walk_hidden_files
        );
        assert_eq!(walk.manual_collect_count, walk.manual_skip_hidden_count);
        assert_eq!(walk.jwalk_skip_hidden_count, walk.manual_skip_hidden_count);
    }

    let resize_iterations = if heavy { 250 } else { 50 };
    let resize = measure_cover_resize(resize_iterations, 1024, 1024, 256, 256);
    println!(
        "library_scan_cover_resize iterations={} source_px={}x{} target_px={}x{} source_bytes={} resized_avg_bytes={} size_ratio={:.3} records_per_sec={:.3} elapsed_ms={:.3}",
        resize.iterations,
        resize.source_width,
        resize.source_height,
        resize.target_width,
        resize.target_height,
        resize.source_bytes,
        resize.average_resized_bytes,
        resize.size_ratio,
        resize.resize_records_per_sec,
        resize.resize_elapsed.as_secs_f64() * 1_000.0
    );
    if enforce {
        assert_eq!(resize.iterations, resize_iterations);
        assert!(resize.average_resized_bytes > 0);
        assert!(resize.average_resized_bytes < resize.source_bytes);
    }

    for size in sizes {
        let tracks = synthetic_tracks(size);
        let streaming = measure_scan_streaming_events(&tracks, SCAN_STREAM_BATCH_SIZE);
        println!(
            "library_scan_streaming_ui records={} batch_size={} batch_events={} progress_events={} batch_payload_bytes={} progress_payload_bytes={} batch_serialize_ms={:.3} progress_serialize_ms={:.3} payload_overhead_ratio={:.3} serialize_overhead_ratio={:.3}",
            streaming.records,
            streaming.batch_size,
            streaming.batch_events,
            streaming.progress_events,
            streaming.batch_payload_bytes,
            streaming.progress_payload_bytes,
            streaming.batch_serialize_elapsed.as_secs_f64() * 1_000.0,
            streaming.progress_serialize_elapsed.as_secs_f64() * 1_000.0,
            streaming.payload_overhead_ratio,
            streaming.serialize_overhead_ratio
        );
        if enforce {
            assert_eq!(streaming.records, size);
            assert_eq!(
                streaming.batch_events,
                size.div_ceil(SCAN_STREAM_BATCH_SIZE)
            );
            assert!(streaming.batch_payload_bytes >= streaming.progress_payload_bytes);
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

fn measure_db_fast_path_comparison(
    tracks: &[SyntheticTrack],
    batch_size: usize,
) -> DbFastPathComparisonReport {
    let identity_elapsed = {
        let mut fixture = DbFixture::new("db-write-identity-reconcile");
        let db = fixture.db_mut();
        let started = Instant::now();
        for chunk in tracks.chunks(batch_size) {
            db.write_identity_batch_without_seen_set(chunk);
        }
        let elapsed = started.elapsed();
        fixture.close();
        elapsed
    };

    let (fast_elapsed, fallback_count) = {
        let mut fixture = DbFixture::new("db-write-fast-local-scan");
        let db = fixture.db_mut();
        let started = Instant::now();
        let mut fallback_count = 0_usize;
        for chunk in tracks.chunks(batch_size) {
            fallback_count += db.write_fast_local_scan_batch_without_seen_set(chunk);
        }
        let elapsed = started.elapsed();
        fixture.close();
        (elapsed, fallback_count)
    };

    let identity_records_per_sec = records_per_sec(tracks.len(), identity_elapsed);
    let fast_records_per_sec = records_per_sec(tracks.len(), fast_elapsed);
    DbFastPathComparisonReport {
        records: tracks.len(),
        identity_records_per_sec,
        identity_elapsed,
        fast_records_per_sec,
        fast_elapsed,
        fallback_count,
        speedup: if identity_records_per_sec <= 0.0 {
            0.0
        } else {
            fast_records_per_sec / identity_records_per_sec
        },
    }
}

fn measure_fast_batch_size_sweep(tracks: &[SyntheticTrack]) -> Vec<DbBatchSizeReport> {
    [50_usize, 100, 250, 500]
        .into_iter()
        .filter(|batch_size| *batch_size <= tracks.len().max(1))
        .map(|batch_size| {
            let mut fixture = DbFixture::new(&format!("db-write-fast-batch-size-{}", batch_size));
            let db = fixture.db_mut();
            let started = Instant::now();
            let mut fallback_count = 0_usize;
            for chunk in tracks.chunks(batch_size) {
                fallback_count += db.write_fast_local_scan_batch_without_seen_set(chunk);
            }
            let elapsed = started.elapsed();
            fixture.close();
            DbBatchSizeReport {
                records: tracks.len(),
                batch_size,
                records_per_sec: records_per_sec(tracks.len(), elapsed),
                elapsed,
                fallback_count,
            }
        })
        .collect()
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

fn measure_cover_storage(records: usize, cover_bytes: usize) -> CoverStorageReport {
    let tracks = synthetic_tracks_with_cover(records, cover_bytes);
    let blob_db_elapsed = {
        let mut fixture = DbFixture::new("cover-storage-blob");
        let db = fixture.db_mut();
        let started = Instant::now();
        for chunk in tracks.chunks(LOCAL_SCAN_DB_BATCH_SIZE) {
            db.write_cover_blob_batch_without_seen_set(chunk);
        }
        let elapsed = started.elapsed();
        fixture.close();
        elapsed
    };

    let (file_write_elapsed, file_paths, cache_dir) = {
        let cache_dir = unique_temp_dir("cover-storage-files");
        std::fs::create_dir_all(&cache_dir).expect("create cover storage files dir");
        let started = Instant::now();
        let file_paths = write_cover_files_for_tracks(&cache_dir, &tracks);
        (started.elapsed(), file_paths, cache_dir)
    };

    let file_ref_db_elapsed = {
        let mut fixture = DbFixture::new("cover-storage-file-ref");
        let db = fixture.db_mut();
        let started = Instant::now();
        for (track_chunk, path_chunk) in tracks
            .chunks(LOCAL_SCAN_DB_BATCH_SIZE)
            .zip(file_paths.chunks(LOCAL_SCAN_DB_BATCH_SIZE))
        {
            db.write_cover_file_ref_batch_without_seen_set(track_chunk, path_chunk);
        }
        let elapsed = started.elapsed();
        fixture.close();
        elapsed
    };
    let _ = std::fs::remove_dir_all(cache_dir);

    CoverStorageReport {
        records,
        cover_bytes,
        blob_db_records_per_sec: records_per_sec(records, blob_db_elapsed),
        blob_db_elapsed,
        file_write_records_per_sec: records_per_sec(records, file_write_elapsed),
        file_write_elapsed,
        file_ref_db_records_per_sec: records_per_sec(records, file_ref_db_elapsed),
        file_ref_db_elapsed,
    }
}

fn write_cover_files_for_tracks(cache_dir: &Path, tracks: &[SyntheticTrack]) -> Vec<String> {
    tracks
        .iter()
        .map(|track| {
            let media_id = media_id_for_path(&track.source_path);
            let path = cache_dir.join(format!("{}.jpg", cover_cache_key(&media_id)));
            std::fs::write(
                &path,
                track
                    .metadata
                    .cover_art
                    .as_ref()
                    .expect("cover storage track should have art"),
            )
            .expect("write benchmark cover cache file");
            path.to_string_lossy().to_string()
        })
        .collect()
}

fn measure_walk_traversal(total_files: usize, hidden_files: usize) -> WalkTraversalReport {
    let root = create_walk_fixture(total_files, hidden_files);

    let started = Instant::now();
    let manual_all_count = manual_walk_count(&root, false);
    let manual_all_elapsed = started.elapsed();

    let started = Instant::now();
    let manual_skip_hidden_count = manual_walk_count(&root, true);
    let manual_skip_hidden_elapsed = started.elapsed();

    let started = Instant::now();
    let manual_collected = manual_walk_collect(&root, true);
    let manual_collect_elapsed = started.elapsed();
    let manual_collect_count = manual_collected.len();
    let manual_collect_path_bytes = total_path_bytes(&manual_collected);

    let started = Instant::now();
    let jwalk_collected = jwalk_collect_supported_paths(&root);
    let jwalk_skip_hidden_elapsed = started.elapsed();
    let jwalk_skip_hidden_count = jwalk_collected.len();
    let jwalk_collect_path_bytes = total_path_bytes(&jwalk_collected);

    let _ = std::fs::remove_dir_all(&root);

    WalkTraversalReport {
        total_files,
        hidden_files,
        manual_all_count,
        manual_skip_hidden_count,
        manual_collect_count,
        jwalk_skip_hidden_count,
        manual_all_elapsed,
        manual_skip_hidden_elapsed,
        manual_collect_elapsed,
        jwalk_skip_hidden_elapsed,
        manual_collect_path_bytes,
        jwalk_collect_path_bytes,
    }
}

fn create_walk_fixture(total_files: usize, hidden_files: usize) -> PathBuf {
    let root = unique_temp_dir("walk-traversal");
    let visible_files = total_files.saturating_sub(hidden_files);
    for index in 0..visible_files {
        let dir = root
            .join(format!("artist_{:03}", index % 128))
            .join(format!("album_{:03}", index % 64));
        std::fs::create_dir_all(&dir).expect("create visible walk fixture dir");
        std::fs::write(dir.join(format!("track_{:06}.flac", index)), b"audio")
            .expect("write visible walk fixture file");
    }
    for index in 0..hidden_files {
        let dir = root
            .join(format!(".hidden_{:03}", index % 16))
            .join(format!("album_{:03}", index % 16));
        std::fs::create_dir_all(&dir).expect("create hidden walk fixture dir");
        std::fs::write(dir.join(format!("track_{:06}.flac", index)), b"audio")
            .expect("write hidden walk fixture file");
    }
    root
}

fn manual_walk_count(root: &Path, skip_hidden: bool) -> usize {
    let mut count = 0_usize;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            if skip_hidden && is_hidden_name(&file_name) {
                continue;
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file() && is_supported_bench_media_path(&path) {
                count += 1;
            }
        }
    }
    black_box(count)
}

fn manual_walk_collect(root: &Path, skip_hidden: bool) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            if skip_hidden && is_hidden_name(&file_name) {
                continue;
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file() && is_supported_bench_media_path(&path) {
                paths.push(path);
            }
        }
    }
    black_box(paths)
}

fn jwalk_collect_supported_paths(root: &Path) -> Vec<PathBuf> {
    jwalk::WalkDir::new(root)
        .skip_hidden(true)
        .into_iter()
        .flatten()
        .filter(|entry| entry.file_type().is_file() && is_supported_bench_media_path(&entry.path()))
        .map(|entry| entry.path())
        .collect()
}

fn is_hidden_name(value: &std::ffi::OsStr) -> bool {
    value.to_str().map_or(false, |name| name.starts_with('.'))
}

fn is_supported_bench_media_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "flac" | "mp3" | "wav"))
        .unwrap_or(false)
}

fn total_path_bytes(paths: &[PathBuf]) -> usize {
    paths
        .iter()
        .map(|path| path.to_string_lossy().len() + std::mem::size_of::<PathBuf>())
        .sum()
}

fn measure_cover_resize(
    iterations: usize,
    source_width: u32,
    source_height: u32,
    target_width: u32,
    target_height: u32,
) -> CoverResizeReport {
    let source = synthetic_jpeg(source_width, source_height);
    let source_bytes = source.len();
    let mut output_bytes = 0_usize;
    let started = Instant::now();
    for _ in 0..iterations {
        let resized = resize_cover_to_jpeg(&source, target_width, target_height);
        output_bytes += resized.len();
        black_box(resized);
    }
    let resize_elapsed = started.elapsed();
    let average_resized_bytes = output_bytes / iterations.max(1);
    CoverResizeReport {
        iterations,
        source_width,
        source_height,
        target_width,
        target_height,
        source_bytes,
        average_resized_bytes,
        resize_elapsed,
        resize_records_per_sec: records_per_sec(iterations, resize_elapsed),
        size_ratio: average_resized_bytes as f64 / source_bytes.max(1) as f64,
    }
}

fn synthetic_jpeg(width: u32, height: u32) -> Vec<u8> {
    let image = ImageBuffer::from_fn(width, height, |x, y| {
        Rgb([
            ((x * 31 + y * 17) % 251) as u8,
            ((x * 7 + y * 29) % 241) as u8,
            ((x * 13 + y * 11) % 239) as u8,
        ])
    });
    write_dynamic_image_to_jpeg(&DynamicImage::ImageRgb8(image))
}

fn resize_cover_to_jpeg(bytes: &[u8], width: u32, height: u32) -> Vec<u8> {
    let decoded = image::load_from_memory(bytes).expect("decode synthetic jpeg");
    let resized = decoded.resize(width, height, image::imageops::FilterType::Lanczos3);
    write_dynamic_image_to_jpeg(&resized)
}

fn write_dynamic_image_to_jpeg(image: &DynamicImage) -> Vec<u8> {
    let mut cursor = Cursor::new(Vec::new());
    image
        .write_to(&mut cursor, ImageFormat::Jpeg)
        .expect("encode synthetic jpeg");
    cursor.into_inner()
}

fn measure_scan_streaming_events(
    tracks: &[SyntheticTrack],
    batch_size: usize,
) -> ScanStreamingReport {
    let media_ids = tracks
        .iter()
        .map(|track| media_id_for_path(&track.source_path))
        .collect::<Vec<_>>();

    let mut batch_payload_bytes = 0_usize;
    let started = Instant::now();
    for (batch_index, chunk) in tracks.chunks(batch_size).enumerate() {
        let start = batch_index * batch_size;
        let event = ScanBatchEvent {
            event_type: "library_scan_batch",
            task_id: 42,
            scanned_files: start + chunk.len(),
            indexed_files: start + chunk.len(),
            tracks: chunk
                .iter()
                .enumerate()
                .map(|(offset, track)| ScanTrackEvent {
                    media_id: &media_ids[start + offset],
                    title: track.metadata.title.as_deref(),
                    artist: track.metadata.artist.as_deref(),
                    album: track.metadata.album.as_deref(),
                    duration_secs: track.duration_secs,
                    has_cover_art: track.metadata.cover_art.is_some(),
                })
                .collect(),
        };
        batch_payload_bytes += serde_json::to_vec(&event)
            .expect("serialize scan batch event")
            .len();
    }
    let batch_serialize_elapsed = started.elapsed();

    let mut progress_payload_bytes = 0_usize;
    let mut progress_events = 0_usize;
    let started = Instant::now();
    for scanned in (25..=tracks.len()).step_by(25) {
        let event = ScanProgressEvent {
            event_type: "library_scan_progress",
            task_id: 42,
            scanned_files: scanned,
            indexed_files: scanned,
        };
        progress_payload_bytes += serde_json::to_vec(&event)
            .expect("serialize scan progress event")
            .len();
        progress_events += 1;
    }
    if tracks.len() % 25 != 0 {
        let event = ScanProgressEvent {
            event_type: "library_scan_progress",
            task_id: 42,
            scanned_files: tracks.len(),
            indexed_files: tracks.len(),
        };
        progress_payload_bytes += serde_json::to_vec(&event)
            .expect("serialize final scan progress event")
            .len();
        progress_events += 1;
    }
    let progress_serialize_elapsed = started.elapsed();

    ScanStreamingReport {
        records: tracks.len(),
        batch_size,
        batch_events: tracks.len().div_ceil(batch_size),
        progress_events,
        batch_payload_bytes,
        progress_payload_bytes,
        batch_serialize_elapsed,
        progress_serialize_elapsed,
        payload_overhead_ratio: ratio(batch_payload_bytes, progress_payload_bytes),
        serialize_overhead_ratio: ratio_duration(
            batch_serialize_elapsed,
            progress_serialize_elapsed,
        ),
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

fn synthetic_tracks_with_cover(count: usize, cover_bytes: usize) -> Vec<SyntheticTrack> {
    let art = (0..cover_bytes)
        .map(|index| (index % 251) as u8)
        .collect::<Vec<_>>();
    synthetic_tracks(count)
        .into_iter()
        .map(|mut track| {
            track.metadata.cover_art = Some(art.clone());
            track.metadata.cover_art_mime = Some("image/jpeg".to_string());
            track
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

fn ratio(numerator: usize, denominator: usize) -> f64 {
    if denominator == 0 {
        0.0
    } else {
        numerator as f64 / denominator as f64
    }
}

fn ratio_duration(numerator: Duration, denominator: Duration) -> f64 {
    let denominator = denominator.as_secs_f64();
    if denominator <= 0.0 {
        0.0
    } else {
        numerator.as_secs_f64() / denominator
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

fn cover_cache_key(media_id: &str) -> String {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(media_id.as_bytes());
    hex::encode(hasher.finalize())
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
            PRAGMA synchronous = NORMAL;
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
                image_bytes BLOB,
                file_path TEXT,
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
                    INSERT INTO cover_art_cache (cover_art_id, media_id, mime_type, image_bytes, file_path, byte_len, created_at)
                    VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6)
                    ON CONFLICT(cover_art_id) DO UPDATE SET
                        mime_type = excluded.mime_type,
                        image_bytes = excluded.image_bytes,
                        file_path = excluded.file_path,
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

    fn write_cover_blob_batch_without_seen_set(&mut self, batch: &[SyntheticTrack]) {
        if batch.is_empty() {
            return;
        }
        let tx = self
            .conn
            .transaction()
            .expect("start benchmark cover blob tx");
        for track in batch {
            let media_id = record_track_in_tx(&tx, track);
            insert_cover_blob_in_tx(&tx, &media_id, track);
        }
        tx.commit().expect("commit benchmark cover blob tx");
    }

    fn write_cover_file_ref_batch_without_seen_set(
        &mut self,
        batch: &[SyntheticTrack],
        file_paths: &[String],
    ) {
        if batch.is_empty() {
            return;
        }
        assert_eq!(batch.len(), file_paths.len());
        let tx = self
            .conn
            .transaction()
            .expect("start benchmark cover file ref tx");
        for (track, file_path) in batch.iter().zip(file_paths) {
            let media_id = record_track_in_tx(&tx, track);
            insert_cover_file_ref_in_tx(&tx, &media_id, track, file_path);
        }
        tx.commit().expect("commit benchmark cover file ref tx");
    }

    fn write_identity_batch_without_seen_set(&mut self, batch: &[SyntheticTrack]) {
        if batch.is_empty() {
            return;
        }
        let tx = self
            .conn
            .transaction()
            .expect("start benchmark identity batch write tx");
        for track in batch {
            record_track_identity_in_savepoint(&tx, track);
        }
        tx.commit()
            .expect("commit benchmark identity batch write tx");
    }

    fn write_fast_local_scan_batch_without_seen_set(&mut self, batch: &[SyntheticTrack]) -> usize {
        if batch.is_empty() {
            return 0;
        }
        let tx = self
            .conn
            .transaction()
            .expect("start benchmark fast local scan batch write tx");
        let fallback_count = if record_track_fast_local_scan_batch_savepoint(&tx, batch) {
            0
        } else {
            let mut fallback_count = 0_usize;
            for track in batch {
                if !record_track_fast_local_scan_in_savepoint(&tx, track) {
                    fallback_count += 1;
                    record_track_identity_in_savepoint(&tx, track);
                }
            }
            fallback_count
        };
        tx.commit()
            .expect("commit benchmark fast local scan batch write tx");
        fallback_count
    }

    fn write_batch(&mut self, scan_task_id: u64, batch: &[SyntheticTrack]) {
        let _fallback_count = self.write_fast_local_scan_batch_without_seen_set(batch);
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

fn record_track_identity_in_savepoint(
    tx: &rusqlite::Transaction<'_>,
    track: &SyntheticTrack,
) -> String {
    tx.execute_batch("SAVEPOINT media_metadata_record")
        .expect("start benchmark identity savepoint");
    let media_id = media_id_for_path(&track.source_path);
    record_track_stub_with_identity(tx, &media_id, track);
    update_track_metadata_in_tx(tx, &media_id, track);
    tx.execute_batch("RELEASE SAVEPOINT media_metadata_record")
        .expect("release benchmark identity savepoint");
    media_id
}

fn record_track_fast_local_scan_batch_savepoint(
    tx: &rusqlite::Transaction<'_>,
    batch: &[SyntheticTrack],
) -> bool {
    tx.execute_batch("SAVEPOINT local_scan_metadata_batch")
        .expect("start benchmark fast batch savepoint");
    for track in batch {
        let media_id = media_id_for_path(&track.source_path);
        if tx
            .execute(
                r#"
                INSERT INTO media_items (media_id, source_path, source_kind, added_at, updated_at)
                VALUES (?1, ?2, 'local', ?3, ?3)
                ON CONFLICT(media_id) DO UPDATE SET
                    source_path = excluded.source_path,
                    source_kind = 'local',
                    updated_at = excluded.updated_at
                "#,
                params![media_id, track.source_path, now_epoch_secs_i64()],
            )
            .is_err()
        {
            tx.execute_batch(
                "ROLLBACK TO SAVEPOINT local_scan_metadata_batch; RELEASE SAVEPOINT local_scan_metadata_batch;",
            )
            .expect("rollback benchmark fast batch savepoint");
            return false;
        }
        update_track_metadata_in_tx(tx, &media_id, track);
    }
    tx.execute_batch("RELEASE SAVEPOINT local_scan_metadata_batch")
        .expect("release benchmark fast batch savepoint");
    true
}

fn record_track_fast_local_scan_in_savepoint(
    tx: &rusqlite::Transaction<'_>,
    track: &SyntheticTrack,
) -> bool {
    tx.execute_batch("SAVEPOINT media_metadata_record")
        .expect("start benchmark fast savepoint");
    let media_id = media_id_for_path(&track.source_path);
    let result = tx.execute(
        r#"
        INSERT INTO media_items (media_id, source_path, source_kind, added_at, updated_at)
        VALUES (?1, ?2, 'local', ?3, ?3)
        ON CONFLICT(media_id) DO UPDATE SET
            source_path = excluded.source_path,
            source_kind = 'local',
            updated_at = excluded.updated_at
        "#,
        params![media_id, track.source_path, now_epoch_secs_i64()],
    );
    match result {
        Ok(_) => {
            update_track_metadata_in_tx(tx, &media_id, track);
            tx.execute_batch("RELEASE SAVEPOINT media_metadata_record")
                .expect("release benchmark fast savepoint");
            true
        }
        Err(_) => {
            tx.execute_batch(
                "ROLLBACK TO SAVEPOINT media_metadata_record; RELEASE SAVEPOINT media_metadata_record;",
            )
            .expect("rollback benchmark fast savepoint");
            false
        }
    }
}

fn record_track_stub_with_identity(
    tx: &rusqlite::Transaction<'_>,
    media_id: &str,
    track: &SyntheticTrack,
) {
    let source_kind =
        if track.source_path.starts_with("http://") || track.source_path.starts_with("https://") {
            "remote"
        } else {
            "local"
        };
    let existing_by_id = tx
        .query_row(
            "SELECT media_id FROM media_items WHERE media_id = ?1",
            params![media_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .expect("read benchmark media item by id");
    let existing_by_path = tx
        .query_row(
            "SELECT media_id FROM media_items WHERE source_path = ?1",
            params![track.source_path],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .expect("read benchmark media item by source path");
    if let (None, Some(path_media_id)) = (existing_by_id.as_deref(), existing_by_path.as_deref()) {
        if path_media_id != media_id {
            tx.execute(
                "UPDATE media_items SET source_path = ?1, updated_at = ?2 WHERE media_id = ?3",
                params![
                    format!("{}#legacy-media-id:{}", track.source_path, path_media_id),
                    now_epoch_secs_i64(),
                    path_media_id
                ],
            )
            .expect("release benchmark legacy source path");
        }
    }

    tx.execute(
        r#"
        INSERT INTO media_items (media_id, source_path, source_kind, added_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?4)
        ON CONFLICT(media_id) DO UPDATE SET
            source_path = excluded.source_path,
            source_kind = excluded.source_kind,
            updated_at = excluded.updated_at
        "#,
        params![
            media_id,
            track.source_path,
            source_kind,
            now_epoch_secs_i64()
        ],
    )
    .expect("record benchmark media stub with identity");
}

fn update_track_metadata_in_tx(
    tx: &rusqlite::Transaction<'_>,
    media_id: &str,
    track: &SyntheticTrack,
) {
    let now = now_epoch_secs_i64();
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
    .expect("update benchmark media metadata");
}

fn insert_cover_blob_in_tx(tx: &rusqlite::Transaction<'_>, media_id: &str, track: &SyntheticTrack) {
    let Some(ref art) = track.metadata.cover_art else {
        return;
    };
    let cover_art_id = format!("{}:cover", media_id);
    tx.execute(
        r#"
        INSERT INTO cover_art_cache (cover_art_id, media_id, mime_type, image_bytes, file_path, byte_len, created_at)
        VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6)
        ON CONFLICT(cover_art_id) DO UPDATE SET
            mime_type = excluded.mime_type,
            image_bytes = excluded.image_bytes,
            file_path = excluded.file_path,
            byte_len = excluded.byte_len,
            created_at = excluded.created_at
        "#,
        params![
            cover_art_id,
            media_id,
            track.metadata.cover_art_mime,
            art,
            art.len() as i64,
            now_epoch_secs_i64(),
        ],
    )
    .expect("insert benchmark cover blob");
}

fn insert_cover_file_ref_in_tx(
    tx: &rusqlite::Transaction<'_>,
    media_id: &str,
    track: &SyntheticTrack,
    file_path: &str,
) {
    let byte_len = track
        .metadata
        .cover_art
        .as_ref()
        .map_or(0_i64, |art| art.len() as i64);
    let cover_art_id = format!("{}:cover", media_id);
    tx.execute(
        r#"
        INSERT INTO cover_art_cache (cover_art_id, media_id, mime_type, image_bytes, file_path, byte_len, created_at)
        VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6)
        ON CONFLICT(cover_art_id) DO UPDATE SET
            mime_type = excluded.mime_type,
            image_bytes = excluded.image_bytes,
            file_path = excluded.file_path,
            byte_len = excluded.byte_len,
            created_at = excluded.created_at
        "#,
        params![
            cover_art_id,
            media_id,
            track.metadata.cover_art_mime,
            file_path,
            byte_len,
            now_epoch_secs_i64(),
        ],
    )
    .expect("insert benchmark cover file ref");
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

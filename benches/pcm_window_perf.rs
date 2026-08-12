use std::alloc::{GlobalAlloc, Layout, System};
use std::hint::{black_box, spin_loop};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::Instant;

use audio_engine::bench_provenance::{
    collect as collect_provenance, Provenance, ProvenanceRequest,
};
use audio_engine::player::bench_support::{
    create_pcm_window_for_bench, PcmWindowAccessError, PcmWindowGeometry,
};
use crossbeam::queue::ArrayQueue;
use serde::Serialize;

const CHANNELS: usize = 2;
const SLOT_COUNT: usize = 64;
const EPOCH: u64 = 1;

struct CountingAllocator;

static COUNT_ALLOCATIONS: AtomicBool = AtomicBool::new(false);
static ALLOCATION_COUNT: AtomicU64 = AtomicU64::new(0);
static ALLOCATION_BYTES: AtomicU64 = AtomicU64::new(0);

// SAFETY: every operation delegates to `System` with the original pointer and
// layout. The extra relaxed counters are observational and do not affect
// allocator ownership or synchronization.
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        // SAFETY: delegated with the caller-provided valid allocation layout.
        let ptr = unsafe { System.alloc(layout) };
        record_allocation(ptr, layout.size());
        ptr
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        // SAFETY: delegated with the caller-provided valid allocation layout.
        let ptr = unsafe { System.alloc_zeroed(layout) };
        record_allocation(ptr, layout.size());
        ptr
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        // SAFETY: delegated with the pointer/layout pair and size supplied by
        // the allocator caller.
        let new_ptr = unsafe { System.realloc(ptr, layout, new_size) };
        record_allocation(new_ptr, new_size);
        new_ptr
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: delegated with the same pointer/layout contract as received.
        unsafe { System.dealloc(ptr, layout) };
    }
}

#[global_allocator]
static GLOBAL_ALLOCATOR: CountingAllocator = CountingAllocator;

#[derive(Clone, Copy, Debug, Serialize)]
struct AllocationStats {
    count: u64,
    bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
struct LatencySummary {
    count: usize,
    p50: u64,
    p95: u64,
    p99: u64,
    p99_9: u64,
    p99_99: u64,
    max: u64,
}

#[derive(Clone, Debug, Serialize)]
struct TransportReport {
    name: &'static str,
    iterations: usize,
    sequential_ns_per_slot: f64,
    cross_thread_ns_per_slot: f64,
    sequential_latency_ns: LatencySummary,
    cross_thread_consumer_wait_latency_ns: LatencySummary,
    warm_allocations: AllocationStats,
}

struct CrossThreadReport {
    ns_per_slot: f64,
    consumer_wait_latency_ns: LatencySummary,
}

#[derive(Debug, Serialize)]
struct BenchmarkReport {
    schema_version: u32,
    benchmark: &'static str,
    mode: &'static str,
    channels: usize,
    slot_count: usize,
    slot_frames: usize,
    slot_samples: usize,
    slot_payload_bytes: usize,
    current_queue: TransportReport,
    pcm_window: TransportReport,
    provenance: Provenance,
}

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let quick = args.iter().any(|arg| arg == "--quick");
    let heavy = args.iter().any(|arg| arg == "--heavy");
    let enforce = args.iter().any(|arg| arg == "--enforce");
    let report_path = args
        .windows(2)
        .find(|pair| pair[0] == "--report")
        .map(|pair| PathBuf::from(&pair[1]));
    let (mode, iterations) = if quick {
        ("quick", 500)
    } else if heavy {
        ("heavy", 20_000)
    } else {
        ("full", 5_000)
    };

    let geometry = PcmWindowGeometry::for_slot_count(CHANNELS, SLOT_COUNT)
        .expect("benchmark geometry must be valid");
    let source = Arc::new(synthetic_slot(geometry.slot_frames(), CHANNELS));

    let current_queue = benchmark_current_queue(iterations, &source);
    let pcm_window = benchmark_pcm_window(iterations, &source, geometry);

    println!(
        "pcm_window_perf mode={mode} channels={CHANNELS} slots={SLOT_COUNT} slot_frames={} slot_bytes={} iterations={iterations}",
        geometry.slot_frames(),
        geometry.slot_payload_bytes()
    );
    print_transport(&current_queue);
    print_transport(&pcm_window);

    if enforce {
        assert!(
            current_queue.warm_allocations.count >= (iterations as u64) * 2,
            "allocated queue baseline must expose at least one Vec and Arc allocation per slot"
        );
        assert_eq!(
            pcm_window.warm_allocations.count, 0,
            "PCM window must allocate zero objects per published slot after construction"
        );
        assert_eq!(
            pcm_window.warm_allocations.bytes, 0,
            "PCM window must allocate zero bytes per published slot after construction"
        );
    }

    if let Some(path) = report_path {
        let provenance = collect_provenance(&ProvenanceRequest {
            binary_path: None,
            fixture_paths: Vec::new(),
            profile: Some(mode),
            attribution: vec!["in-process", "allocation-count-only", "no-latency-claim"],
        });
        write_report(
            path,
            BenchmarkReport {
                schema_version: 1,
                benchmark: "pcm_window_perf",
                mode,
                channels: CHANNELS,
                slot_count: SLOT_COUNT,
                slot_frames: geometry.slot_frames(),
                slot_samples: geometry.slot_samples(),
                slot_payload_bytes: geometry.slot_payload_bytes(),
                current_queue,
                pcm_window,
                provenance,
            },
        );
    }
}

fn benchmark_current_queue(iterations: usize, source: &Arc<Vec<f64>>) -> TransportReport {
    let queue = ArrayQueue::new(SLOT_COUNT);
    for _ in 0..SLOT_COUNT / 2 {
        queue
            .push(Arc::new(source.as_ref().clone()))
            .expect("warm queue push");
        black_box(queue.pop().expect("warm queue pop"));
    }

    let started_at = Instant::now();
    for _ in 0..iterations {
        queue
            .push(Arc::new(source.as_ref().clone()))
            .expect("queue has immediate consumer capacity");
        let chunk = queue.pop().expect("published queue chunk");
        black_box(chunk[0]);
    }
    let sequential_ns_per_slot = started_at.elapsed().as_nanos() as f64 / iterations as f64;

    let mut latency_samples = Vec::with_capacity(iterations);
    for _ in 0..iterations {
        let started_at = Instant::now();
        queue
            .push(Arc::new(source.as_ref().clone()))
            .expect("queue has immediate consumer capacity");
        let chunk = queue.pop().expect("published queue chunk");
        black_box(chunk[0]);
        latency_samples.push(elapsed_ns(started_at));
    }

    let warm_allocations = count_allocations(|| {
        for _ in 0..iterations {
            queue
                .push(Arc::new(source.as_ref().clone()))
                .expect("queue has immediate consumer capacity");
            black_box(queue.pop().expect("published queue chunk"));
        }
    });

    let cross_thread = current_queue_cross_thread(iterations, source);
    TransportReport {
        name: "array_queue_arc_vec",
        iterations,
        sequential_ns_per_slot,
        cross_thread_ns_per_slot: cross_thread.ns_per_slot,
        sequential_latency_ns: summarize_latency(latency_samples),
        cross_thread_consumer_wait_latency_ns: cross_thread.consumer_wait_latency_ns,
        warm_allocations,
    }
}

fn benchmark_pcm_window(
    iterations: usize,
    source: &Arc<Vec<f64>>,
    geometry: PcmWindowGeometry,
) -> TransportReport {
    let sequential_ns_per_slot = {
        let mut parts = create_pcm_window_for_bench(geometry, EPOCH, 0).expect("window allocation");
        let started_at = Instant::now();
        for sequence in 0..iterations as u64 {
            publish_and_consume(&mut parts.writer, &mut parts.reader, sequence, source);
        }
        started_at.elapsed().as_nanos() as f64 / iterations as f64
    };

    let sequential_latency_ns = {
        let mut parts = create_pcm_window_for_bench(geometry, EPOCH, 0).expect("window allocation");
        let mut samples = Vec::with_capacity(iterations);
        for sequence in 0..iterations as u64 {
            let started_at = Instant::now();
            publish_and_consume(&mut parts.writer, &mut parts.reader, sequence, source);
            samples.push(elapsed_ns(started_at));
        }
        summarize_latency(samples)
    };

    let warm_allocations = {
        let mut parts = create_pcm_window_for_bench(geometry, EPOCH, 0).expect("window allocation");
        count_allocations(|| {
            for sequence in 0..iterations as u64 {
                publish_and_consume(&mut parts.writer, &mut parts.reader, sequence, source);
            }
        })
    };

    let cross_thread = pcm_window_cross_thread(iterations, source, geometry);
    TransportReport {
        name: "preallocated_pcm_window",
        iterations,
        sequential_ns_per_slot,
        cross_thread_ns_per_slot: cross_thread.ns_per_slot,
        sequential_latency_ns,
        cross_thread_consumer_wait_latency_ns: cross_thread.consumer_wait_latency_ns,
        warm_allocations,
    }
}

fn publish_and_consume(
    writer: &mut audio_engine::player::bench_support::PcmWindowWriter,
    reader: &mut audio_engine::player::bench_support::PcmWindowReader,
    sequence: u64,
    source: &[f64],
) {
    let reclaim_before = sequence.saturating_sub(SLOT_COUNT as u64).saturating_add(1);
    let mut slot = writer
        .try_claim(EPOCH, sequence, reclaim_before)
        .expect("sequential slot claim");
    slot.append_interleaved(source).expect("slot copy");
    slot.publish().expect("slot publication");
    let read = reader
        .try_claim_sequence(EPOCH, sequence)
        .expect("exact slot claim");
    black_box(read.samples()[0]);
    read.release();
}

fn current_queue_cross_thread(iterations: usize, source: &Arc<Vec<f64>>) -> CrossThreadReport {
    let queue = Arc::new(ArrayQueue::new(SLOT_COUNT));
    let barrier = Arc::new(Barrier::new(3));
    let producer_queue = Arc::clone(&queue);
    let producer_barrier = Arc::clone(&barrier);
    let producer_source = Arc::clone(source);
    let producer = thread::spawn(move || {
        producer_barrier.wait();
        for _ in 0..iterations {
            let mut chunk = Arc::new(producer_source.as_ref().clone());
            loop {
                match producer_queue.push(chunk) {
                    Ok(()) => break,
                    Err(returned) => {
                        chunk = returned;
                        spin_loop();
                    }
                }
            }
        }
    });

    let consumer_queue = Arc::clone(&queue);
    let consumer_barrier = Arc::clone(&barrier);
    let consumer = thread::spawn(move || {
        let mut wait_samples = Vec::with_capacity(iterations);
        consumer_barrier.wait();
        for _ in 0..iterations {
            let waiting_since = Instant::now();
            loop {
                if let Some(chunk) = consumer_queue.pop() {
                    black_box(chunk[0]);
                    wait_samples.push(elapsed_ns(waiting_since));
                    break;
                }
                spin_loop();
            }
        }
        wait_samples
    });

    barrier.wait();
    let started_at = Instant::now();
    producer.join().expect("queue producer thread");
    let wait_samples = consumer.join().expect("queue consumer thread");
    CrossThreadReport {
        ns_per_slot: started_at.elapsed().as_nanos() as f64 / iterations as f64,
        consumer_wait_latency_ns: summarize_latency(wait_samples),
    }
}

fn pcm_window_cross_thread(
    iterations: usize,
    source: &Arc<Vec<f64>>,
    geometry: PcmWindowGeometry,
) -> CrossThreadReport {
    let parts = create_pcm_window_for_bench(geometry, EPOCH, 0).expect("window allocation");
    let barrier = Arc::new(Barrier::new(3));
    let consumed_sequence = Arc::new(AtomicU64::new(0));

    let producer_barrier = Arc::clone(&barrier);
    let producer_consumed = Arc::clone(&consumed_sequence);
    let producer_source = Arc::clone(source);
    let mut writer = parts.writer;
    let producer = thread::spawn(move || {
        producer_barrier.wait();
        for sequence in 0..iterations as u64 {
            loop {
                let reclaim_before = producer_consumed.load(Ordering::Acquire);
                match writer.try_claim(EPOCH, sequence, reclaim_before) {
                    Ok(mut slot) => {
                        slot.append_interleaved(&producer_source)
                            .expect("slot copy");
                        slot.publish().expect("slot publication");
                        break;
                    }
                    Err(
                        PcmWindowAccessError::SlotBusy { .. }
                        | PcmWindowAccessError::SlotNotReclaimable { .. },
                    ) => spin_loop(),
                    Err(error) => panic!("unexpected producer claim error: {error}"),
                }
            }
        }
    });

    let consumer_barrier = Arc::clone(&barrier);
    let consumer_consumed = Arc::clone(&consumed_sequence);
    let mut reader = parts.reader;
    let consumer = thread::spawn(move || {
        let mut wait_samples = Vec::with_capacity(iterations);
        consumer_barrier.wait();
        for sequence in 0..iterations as u64 {
            let waiting_since = Instant::now();
            loop {
                match reader.try_claim_sequence(EPOCH, sequence) {
                    Ok(slot) => {
                        black_box(slot.samples()[0]);
                        slot.release();
                        consumer_consumed.store(sequence + 1, Ordering::Release);
                        wait_samples.push(elapsed_ns(waiting_since));
                        break;
                    }
                    Err(
                        PcmWindowAccessError::SlotBusy { .. }
                        | PcmWindowAccessError::SequenceUnavailable { .. },
                    ) => spin_loop(),
                    Err(error) => panic!("unexpected consumer claim error: {error}"),
                }
            }
        }
        wait_samples
    });

    barrier.wait();
    let started_at = Instant::now();
    producer.join().expect("window producer thread");
    let wait_samples = consumer.join().expect("window consumer thread");
    black_box(parts.window);
    CrossThreadReport {
        ns_per_slot: started_at.elapsed().as_nanos() as f64 / iterations as f64,
        consumer_wait_latency_ns: summarize_latency(wait_samples),
    }
}

fn count_allocations(operation: impl FnOnce()) -> AllocationStats {
    ALLOCATION_COUNT.store(0, Ordering::Relaxed);
    ALLOCATION_BYTES.store(0, Ordering::Relaxed);
    COUNT_ALLOCATIONS.store(true, Ordering::Release);
    operation();
    COUNT_ALLOCATIONS.store(false, Ordering::Release);
    AllocationStats {
        count: ALLOCATION_COUNT.load(Ordering::Relaxed),
        bytes: ALLOCATION_BYTES.load(Ordering::Relaxed),
    }
}

fn record_allocation(ptr: *mut u8, bytes: usize) {
    if !ptr.is_null() && COUNT_ALLOCATIONS.load(Ordering::Relaxed) {
        ALLOCATION_COUNT.fetch_add(1, Ordering::Relaxed);
        ALLOCATION_BYTES.fetch_add(bytes as u64, Ordering::Relaxed);
    }
}

fn summarize_latency(mut samples: Vec<u64>) -> LatencySummary {
    samples.sort_unstable();
    LatencySummary {
        count: samples.len(),
        p50: nearest_rank(&samples, 0.50),
        p95: nearest_rank(&samples, 0.95),
        p99: nearest_rank(&samples, 0.99),
        p99_9: nearest_rank(&samples, 0.999),
        p99_99: nearest_rank(&samples, 0.9999),
        max: samples.last().copied().unwrap_or(0),
    }
}

fn nearest_rank(sorted: &[u64], percentile: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let rank = (percentile * sorted.len() as f64).ceil() as usize;
    sorted[rank.saturating_sub(1).min(sorted.len() - 1)]
}

fn elapsed_ns(started_at: Instant) -> u64 {
    started_at.elapsed().as_nanos().min(u128::from(u64::MAX)) as u64
}

fn synthetic_slot(frames: usize, channels: usize) -> Vec<f64> {
    (0..frames * channels)
        .map(|sample| ((sample % 1024) as f64 - 512.0) / 512.0)
        .collect()
}

fn print_transport(report: &TransportReport) {
    println!(
        "pcm_window_transport name={} sequential_ns_per_slot={:.3} cross_thread_ns_per_slot={:.3} alloc_count={} alloc_bytes={} sequential_p50_ns={} sequential_p95_ns={} sequential_p99_ns={} sequential_p99_9_ns={} sequential_p99_99_ns={} sequential_max_ns={} cross_thread_wait_p50_ns={} cross_thread_wait_p95_ns={} cross_thread_wait_p99_ns={} cross_thread_wait_p99_9_ns={} cross_thread_wait_p99_99_ns={} cross_thread_wait_max_ns={}",
        report.name,
        report.sequential_ns_per_slot,
        report.cross_thread_ns_per_slot,
        report.warm_allocations.count,
        report.warm_allocations.bytes,
        report.sequential_latency_ns.p50,
        report.sequential_latency_ns.p95,
        report.sequential_latency_ns.p99,
        report.sequential_latency_ns.p99_9,
        report.sequential_latency_ns.p99_99,
        report.sequential_latency_ns.max,
        report.cross_thread_consumer_wait_latency_ns.p50,
        report.cross_thread_consumer_wait_latency_ns.p95,
        report.cross_thread_consumer_wait_latency_ns.p99,
        report.cross_thread_consumer_wait_latency_ns.p99_9,
        report.cross_thread_consumer_wait_latency_ns.p99_99,
        report.cross_thread_consumer_wait_latency_ns.max
    );
}

fn write_report(path: PathBuf, report: BenchmarkReport) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap_or_else(|error| {
            panic!(
                "failed to create PCM window benchmark report directory '{}': {error}",
                parent.display()
            )
        });
    }
    let json = serde_json::to_vec_pretty(&report).expect("PCM window report JSON serialization");
    std::fs::write(&path, json).unwrap_or_else(|error| {
        panic!(
            "failed to write PCM window benchmark report '{}': {error}",
            path.display()
        )
    });
    println!("pcm_window_report path={}", path.display());
}

use audio_engine::player::bench_support::benchmark_persistent_source_seeks_for_bench;

fn percentile(samples: &mut [u64], value: f64) -> u64 {
    samples.sort_unstable();
    samples[((samples.len() - 1) as f64 * value).ceil() as usize]
}

fn main() {
    let quick = std::env::args().any(|arg| arg == "--quick");
    let iterations = if quick { 20 } else { 200 };
    let (mut persistent, mut reopen) = benchmark_persistent_source_seeks_for_bench(iterations);
    let persistent_p50 = percentile(&mut persistent, 0.50);
    let persistent_p99 = percentile(&mut persistent, 0.99);
    let reopen_p50 = percentile(&mut reopen, 0.50);
    let reopen_p99 = percentile(&mut reopen, 0.99);
    println!("source_seek_perf iterations={} persistent_worker_count=1 persistent_open_probe_count=1 reopen_open_probe_count={} persistent_p50_ns={} persistent_p99_ns={} reopen_p50_ns={} reopen_p99_ns={}", iterations, iterations, persistent_p50, persistent_p99, reopen_p50, reopen_p99);
    assert!(persistent_p50 <= reopen_p50);
}

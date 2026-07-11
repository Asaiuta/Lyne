use audio_engine::player::bench_support::benchmark_resident_window_seeks_for_bench;

fn percentile(sorted: &[u64], percentile: f64) -> u64 {
    let index = ((sorted.len() - 1) as f64 * percentile).ceil() as usize;
    sorted[index]
}

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let quick = args.iter().any(|arg| arg == "--quick");
    let enforce = args.iter().any(|arg| arg == "--enforce");
    let iterations = if quick { 200 } else { 2_000 };
    let callback_period_ns = 512_u64 * 1_000_000_000 / 48_000;
    let gate_ns = callback_period_ns + 1_000_000;
    let mut p99_values = Vec::new();

    println!(
        "window_seek_perf iterations={} callback_period_ns={} gate_ns={} coverage=request_to_applied,first_audible_target",
        iterations, callback_period_ns, gate_ns
    );
    for (scenario, mut samples) in benchmark_resident_window_seeks_for_bench(iterations) {
        samples.sort_unstable();
        let p50 = percentile(&samples, 0.50);
        let p99 = percentile(&samples, 0.99);
        let max = *samples.last().expect("seek samples");
        p99_values.push(p99);
        println!(
            "window_seek scenario={} p50_ns={} p99_ns={} max_ns={} applied_exact=true",
            scenario, p50, p99, max
        );
        if enforce {
            assert!(
                p99 <= gate_ns,
                "{scenario} p99 {p99} exceeded gate {gate_ns}"
            );
        }
    }
    if enforce {
        let min = *p99_values.iter().min().expect("seek p99 values");
        let max = *p99_values.iter().max().expect("seek p99 values");
        assert!(max <= min.saturating_mul(4).max(min + 25_000));
    }
}

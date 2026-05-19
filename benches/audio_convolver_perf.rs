use std::hint::black_box;
use std::time::{Duration, Instant};

use audio_engine::processor::FFTConvolver;

const SAMPLE_RATE: f64 = 48_000.0;

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let quick = args.iter().any(|arg| arg == "--quick");
    let enforce = args.iter().any(|arg| arg == "--enforce");

    let iterations = if quick { 60 } else { 240 };
    let frames = if quick { 2_048 } else { 8_192 };
    let ir_frames = 256;

    println!("audio_convolver_perf frames={frames} ir_frames={ir_frames} iterations={iterations}");

    for channels in [2, 6] {
        let report = benchmark_convolver(channels, ir_frames, frames, iterations);
        println!(
            "convolver channels={} process_into={:.3} ns/sample process_inplace={:.3} ns/sample allocating_process={:.3} ns/sample wrapper_overhead={:.2}%",
            channels,
            report.process_into_ns_per_sample,
            report.process_inplace_ns_per_sample,
            report.allocating_process_ns_per_sample,
            report.wrapper_overhead_percent,
        );

        if enforce {
            assert!(
                report.wrapper_overhead_percent >= 0.0,
                "allocating wrapper unexpectedly faster for {} channels: {:.2}%",
                channels,
                report.wrapper_overhead_percent
            );
        }
    }
}

struct ConvolverReport {
    process_into_ns_per_sample: f64,
    process_inplace_ns_per_sample: f64,
    allocating_process_ns_per_sample: f64,
    wrapper_overhead_percent: f64,
}

fn benchmark_convolver(
    channels: usize,
    ir_frames: usize,
    frames: usize,
    iterations: usize,
) -> ConvolverReport {
    let ir = synthetic_ir(ir_frames, channels);
    let input = synthetic_input(frames, channels);
    let mut output = vec![0.0; input.len()];
    let mut inplace_buffer = input.clone();

    let mut into_conv = FFTConvolver::new(&ir, channels);
    let mut inplace_conv = FFTConvolver::new(&ir, channels);
    let mut allocating_conv = FFTConvolver::new(&ir, channels);

    let into_duration = measure(
        || {
            into_conv.process_into(black_box(&input), black_box(&mut output));
            black_box(output[0])
        },
        iterations,
    );

    let inplace_duration = measure(
        || {
            inplace_buffer.copy_from_slice(&input);
            inplace_conv.process_inplace(black_box(&mut inplace_buffer));
            black_box(inplace_buffer[0])
        },
        iterations,
    );

    let allocating_duration = measure(
        || {
            let output = allocating_conv.process(black_box(&input));
            black_box(output[0])
        },
        iterations,
    );

    let samples = frames * channels * iterations;
    let process_into_ns_per_sample = nanos_per_unit(into_duration, samples);
    let process_inplace_ns_per_sample = nanos_per_unit(inplace_duration, samples);
    let allocating_process_ns_per_sample = nanos_per_unit(allocating_duration, samples);

    ConvolverReport {
        process_into_ns_per_sample,
        process_inplace_ns_per_sample,
        allocating_process_ns_per_sample,
        wrapper_overhead_percent: (allocating_process_ns_per_sample - process_into_ns_per_sample)
            / process_into_ns_per_sample
            * 100.0,
    }
}

fn measure<T>(mut run: impl FnMut() -> T, iterations: usize) -> Duration {
    let start = Instant::now();
    for _ in 0..iterations {
        black_box(run());
    }
    start.elapsed()
}

fn nanos_per_unit(duration: Duration, units: usize) -> f64 {
    duration.as_nanos() as f64 / units as f64
}

fn synthetic_ir(frames: usize, channels: usize) -> Vec<f64> {
    let mut ir = Vec::with_capacity(frames * channels);
    for frame in 0..frames {
        let decay = (-(frame as f64) / 64.0).exp();
        for ch in 0..channels {
            let phase = (ch + 1) as f64 * 0.11;
            let tap = ((frame as f64 + 1.0) * phase).sin() * decay * 0.08;
            ir.push(if frame == 0 { 1.0 } else { tap });
        }
    }
    ir
}

fn synthetic_input(frames: usize, channels: usize) -> Vec<f64> {
    let mut seed = 0xBAD5_EED_u64;
    let mut out = Vec::with_capacity(frames * channels);

    for frame in 0..frames {
        let t = frame as f64 / SAMPLE_RATE;
        let sine = (2.0 * std::f64::consts::PI * 997.0 * t).sin() * 0.25;
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        let noise = (((seed >> 33) as f64 / u32::MAX as f64) * 2.0 - 1.0) * 0.03;
        for ch in 0..channels {
            out.push((sine + noise) * (1.0 - ch as f64 * 0.015));
        }
    }

    out
}

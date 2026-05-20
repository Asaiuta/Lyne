use std::hint::black_box;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use audio_engine::player::{SharedState, SpectrumBatch};
use audio_engine::processor::SpectrumAnalyzer;
use crossbeam::channel;

const CHANNELS: usize = 2;
const SAMPLE_RATE: u32 = 48_000;
const FFT_SIZE: usize = 2048;
const NUM_BINS: usize = 64;
const BUFFER_FRAMES: [usize; 4] = [64, 128, 256, 512];

struct Report {
    ns_per_input_sample: f64,
    ns_per_buffer: f64,
    elapsed: Duration,
}

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let quick = args.iter().any(|arg| arg == "--quick");
    let heavy = args.iter().any(|arg| arg == "--heavy");
    let enforce = args.iter().any(|arg| arg == "--enforce");

    let (callback_iterations, background_iterations, trials) = if quick {
        (1_000, 1_000, 1)
    } else if heavy {
        (20_000, 20_000, 5)
    } else {
        (5_000, 5_000, 3)
    };

    println!(
        "audio_spectrum_handoff_perf mode={} sample_rate={} channels={} fft_size={} bins={} coverage=spectrum_callback_and_background",
        if quick {
            "quick"
        } else if heavy {
            "heavy"
        } else {
            "full"
        },
        SAMPLE_RATE,
        CHANNELS,
        FFT_SIZE,
        NUM_BINS
    );
    println!(
        "audio_spectrum_handoff_note callback_path=downmix_first_1024_samples_clone_try_send background_path=batch_accumulate_fft_arc_swap_publish excludes=websocket_serialization"
    );

    for frames in BUFFER_FRAMES {
        let data = synthetic_interleaved(frames, CHANNELS);

        let pack = best_of(trials, || {
            measure_callback_pack_only(&data, frames, callback_iterations)
        });
        println!(
            "spectrum_callback scenario=pack_only frames={} samples={} iterations={} trials={} ns_per_input_sample={:.3} ns_per_buffer={:.3} elapsed_ms={:.3}",
            frames,
            frames * CHANNELS,
            callback_iterations,
            trials,
            pack.ns_per_input_sample,
            pack.ns_per_buffer,
            pack.elapsed.as_secs_f64() * 1_000.0
        );

        let send = best_of(trials, || {
            measure_callback_pack_try_send(&data, frames, callback_iterations)
        });
        println!(
            "spectrum_callback scenario=pack_clone_try_send frames={} samples={} iterations={} trials={} ns_per_input_sample={:.3} ns_per_buffer={:.3} elapsed_ms={:.3}",
            frames,
            frames * CHANNELS,
            callback_iterations,
            trials,
            send.ns_per_input_sample,
            send.ns_per_buffer,
            send.elapsed.as_secs_f64() * 1_000.0
        );

        let background = best_of(trials, || {
            measure_background_accumulate_analyze_publish(frames, background_iterations)
        });
        println!(
            "spectrum_background scenario=accumulate_analyze_publish frames={} samples={} iterations={} trials={} ns_per_input_sample={:.3} ns_per_buffer={:.3} elapsed_ms={:.3}",
            frames,
            frames * CHANNELS,
            background_iterations,
            trials,
            background.ns_per_input_sample,
            background.ns_per_buffer,
            background.elapsed.as_secs_f64() * 1_000.0
        );
    }

    let analyze = best_analyzer_only(trials, background_iterations);
    println!(
        "spectrum_analyzer scenario=analyze_2048_bins64 iterations={} trials={} ns_per_analyze={:.3} ns_per_mono_spectrum_sample={:.3} ns_per_stereo_output_sample_amortized={:.3} elapsed_ms={:.3}",
        background_iterations,
        trials,
        analyze.ns_per_buffer,
        analyze.ns_per_buffer / FFT_SIZE as f64,
        analyze.ns_per_input_sample,
        analyze.elapsed.as_secs_f64() * 1_000.0
    );

    if enforce {
        assert!(
            analyze.ns_per_buffer.is_finite() && analyze.ns_per_buffer > 0.0,
            "spectrum analyzer benchmark produced invalid timing"
        );
    }
}

fn best_of<F>(trials: usize, mut run: F) -> Report
where
    F: FnMut() -> Report,
{
    let mut best: Option<Report> = None;
    for _ in 0..trials {
        let report = run();
        if best.as_ref().map_or(true, |current| {
            report.ns_per_input_sample < current.ns_per_input_sample
        }) {
            best = Some(report);
        }
    }
    best.expect("at least one trial")
}

fn best_analyzer_only(trials: usize, iterations: usize) -> Report {
    best_of(trials, || measure_analyzer_only(iterations))
}

fn measure_callback_pack_only(data: &[f32], frames: usize, iterations: usize) -> Report {
    let mut batch = SpectrumBatch::new();
    let start = Instant::now();

    for _ in 0..iterations {
        fill_spectrum_batch(black_box(data), CHANNELS, data.len(), &mut batch);
        black_box(batch.as_slice());
    }

    report(start.elapsed(), frames, iterations)
}

fn measure_callback_pack_try_send(data: &[f32], frames: usize, iterations: usize) -> Report {
    let (tx, rx) = channel::bounded::<SpectrumBatch>(256);
    let mut batch = SpectrumBatch::new();
    let start = Instant::now();

    for _ in 0..iterations {
        fill_spectrum_batch(black_box(data), CHANNELS, data.len(), &mut batch);
        if !batch.is_empty() {
            let _ = tx.try_send(batch.clone());
        }
        while rx.try_recv().is_ok() {}
    }

    report(start.elapsed(), frames, iterations)
}

fn measure_background_accumulate_analyze_publish(frames: usize, iterations: usize) -> Report {
    let shared = Arc::new(SharedState::new());
    shared
        .sample_rate
        .store(SAMPLE_RATE as u64, Ordering::Relaxed);

    let batch = synthetic_batch(frames);
    let mut buffer = Vec::with_capacity(FFT_SIZE);
    let mut analyzer = SpectrumAnalyzer::new(FFT_SIZE, NUM_BINS);
    let start = Instant::now();

    for _ in 0..iterations {
        consume_batch(
            black_box(&batch),
            &mut buffer,
            &mut analyzer,
            shared.as_ref(),
        );
    }

    report(start.elapsed(), frames, iterations)
}

fn measure_analyzer_only(iterations: usize) -> Report {
    let samples = synthetic_mono(FFT_SIZE);
    let mut analyzer = SpectrumAnalyzer::new(FFT_SIZE, NUM_BINS);
    analyzer.analyze(&samples, SAMPLE_RATE);

    let start = Instant::now();
    for _ in 0..iterations {
        black_box(analyzer.analyze(black_box(&samples), SAMPLE_RATE));
    }

    let elapsed = start.elapsed();
    let ns_per_analyze = elapsed.as_nanos() as f64 / iterations as f64;
    Report {
        ns_per_input_sample: ns_per_analyze / (FFT_SIZE * CHANNELS) as f64,
        ns_per_buffer: ns_per_analyze,
        elapsed,
    }
}

fn consume_batch(
    batch: &SpectrumBatch,
    buffer: &mut Vec<f64>,
    analyzer: &mut SpectrumAnalyzer,
    shared: &SharedState,
) {
    let mut batch_samples = batch.as_slice();
    while !batch_samples.is_empty() {
        let needed = FFT_SIZE - buffer.len();
        let take = needed.min(batch_samples.len());
        buffer.extend_from_slice(&batch_samples[..take]);
        batch_samples = &batch_samples[take..];

        if buffer.len() < FFT_SIZE {
            continue;
        }

        let spectrum = analyzer.analyze(buffer, SAMPLE_RATE);
        shared.spectrum_data.store(Arc::new(spectrum.to_vec()));
        buffer.clear();
    }
}

fn fill_spectrum_batch(
    data: &[f32],
    channels: usize,
    samples_written: usize,
    batch: &mut SpectrumBatch,
) {
    if samples_written == 0 {
        return;
    }

    let take = samples_written.min(1024);
    batch.clear();
    for i in (0..take).step_by(channels) {
        let mut sum = 0.0;
        for c in 0..channels {
            if i + c < data.len() {
                sum += data[i + c] as f64;
            }
        }
        if !batch.push(sum / channels as f64) {
            break;
        }
    }
}

fn report(elapsed: Duration, frames: usize, iterations: usize) -> Report {
    let ns_per_buffer = elapsed.as_nanos() as f64 / iterations as f64;
    Report {
        ns_per_input_sample: ns_per_buffer / (frames * CHANNELS) as f64,
        ns_per_buffer,
        elapsed,
    }
}

fn synthetic_interleaved(frames: usize, channels: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(frames * channels);
    for frame in 0..frames {
        let t = frame as f64 / SAMPLE_RATE as f64;
        let left = (2.0 * std::f64::consts::PI * 440.0 * t).sin() * 0.25;
        let right = (2.0 * std::f64::consts::PI * 880.0 * t).sin() * 0.20;
        out.push(left as f32);
        if channels > 1 {
            out.push(right as f32);
        }
    }
    out
}

fn synthetic_batch(frames: usize) -> SpectrumBatch {
    let mut batch = SpectrumBatch::new();
    for sample in synthetic_mono(frames) {
        assert!(batch.push(sample));
    }
    batch
}

fn synthetic_mono(frames: usize) -> Vec<f64> {
    (0..frames)
        .map(|frame| {
            let t = frame as f64 / SAMPLE_RATE as f64;
            (2.0 * std::f64::consts::PI * 997.0 * t).sin() * 0.3
        })
        .collect()
}

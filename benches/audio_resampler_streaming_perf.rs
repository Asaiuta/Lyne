use audio_engine::bench_gate::{self, GateContext, GateMetric, GateMode};

use std::path::Path;

use std::hint::black_box;
use std::time::{Duration, Instant};

use audio_engine::player::bench_support::{
    resample_append_for_bench, resample_into_for_bench, resample_output_capacity_for_bench,
};
use audio_engine::processor::StreamingResampler;

const CHANNELS: usize = 2;
const BUFFER_FRAMES: [usize; 3] = [128, 256, 512];
const WARMUP_BUFFERS: usize = 64;

#[derive(Clone, Copy)]
struct Scenario {
    name: &'static str,
    from_rate: u32,
    to_rate: u32,
}

const SCENARIOS: [Scenario; 3] = [
    Scenario {
        name: "equal_rate_48k",
        from_rate: 48_000,
        to_rate: 48_000,
    },
    Scenario {
        name: "music_44k1_to_48k",
        from_rate: 44_100,
        to_rate: 48_000,
    },
    Scenario {
        name: "upsample_48k_to_96k",
        from_rate: 48_000,
        to_rate: 96_000,
    },
];

/// The production driver paths over the core's `StreamingProcessor` contract.
///
/// `audio-engine-core` 1.0 removed the old `process_chunk_*` inherent methods;
/// every consumer now goes through `player::resample_stream`. These variants
/// are those exact helpers, so the benchmark still covers the realtime
/// caller-owned-output path and the offline appending path.
#[derive(Clone, Copy)]
enum ApiPath {
    /// Realtime path: whole input block into caller-owned output storage.
    Into,
    /// Realtime path with output storage sized exactly to the per-call bound,
    /// as the audio callback reserves it.
    IntoExactCapacity,
    /// Offline path: append into an owned buffer with reused scratch.
    Append,
}

impl ApiPath {
    fn name(self) -> &'static str {
        match self {
            Self::Into => "resample_into",
            Self::IntoExactCapacity => "resample_into_exact_capacity",
            Self::Append => "resample_append",
        }
    }

    fn all() -> &'static [Self] {
        &[Self::Into, Self::IntoExactCapacity, Self::Append]
    }
}

struct Report {
    ns_per_input_sample: f64,
    ns_per_input_buffer: f64,
    output_frames: usize,
    elapsed: Duration,
}

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let quick = args.iter().any(|arg| arg == "--quick");
    let heavy = args.iter().any(|arg| arg == "--heavy");
    let (gate_mode, gate_spec, gate_self_test) = bench_gate::parse_args(&args);
    if gate_self_test {
        bench_gate::gate_self_test().expect("gate self-test failed");
        println!("bench_gate self_test=passed");
        return;
    }

    let (iterations, trials) = if quick {
        (400, 1)
    } else if heavy {
        (4_000, 5)
    } else {
        (1_200, 3)
    };

    println!(
        "audio_resampler_streaming_perf mode={} channels={} coverage=streaming_resampler_only",
        if quick {
            "quick"
        } else if heavy {
            "heavy"
        } else {
            "full"
        },
        CHANNELS
    );
    println!(
        "audio_resampler_streaming_note excludes=decoder,callback_dsp_chain,cpal_device_write,gapless_state_machine"
    );

    let mut gate_candidate = None; // (ns_per_input_sample, from_rate)
    for scenario in SCENARIOS {
        for frames in BUFFER_FRAMES {
            let input = synthetic_buffer(frames, CHANNELS, scenario.from_rate);
            for &api in ApiPath::all() {
                let report = benchmark_api(scenario, api, frames, &input, iterations, trials);
                println!(
                    "resampler_streaming scenario={} api={} frames={} input_samples={} from_rate={} to_rate={} output_frames={} iterations={} trials={} ns_per_input_sample={:.3} ns_per_input_buffer={:.3} elapsed_ms={:.3}",
                    scenario.name,
                    api.name(),
                    frames,
                    frames * CHANNELS,
                    scenario.from_rate,
                    scenario.to_rate,
                    report.output_frames,
                    iterations,
                    trials,
                    report.ns_per_input_sample,
                    report.ns_per_input_buffer,
                    report.elapsed.as_secs_f64() * 1_000.0
                );

                if scenario.name == "music_44k1_to_48k"
                    && matches!(api, ApiPath::Into)
                    && frames == 512
                {
                    gate_candidate = Some((report.ns_per_input_sample, 44_100));
                }
            }
        }
    }

    if matches!(gate_mode, GateMode::Check | GateMode::Gate) {
        let (ns_per_input_sample, from_rate) = gate_candidate.expect("gate scenario executed");
        let metric = GateMetric {
            // Name kept stable so this gate stays comparable with its recorded
            // budget and prior evidence. Its measured path is now the realtime
            // `resample_into` driver, which replaced the removed
            // `process_chunk_borrowed` inherent method in core 1.0.
            name: "music_44k1_to_48k_borrowed_512_ns_per_input_sample",
            value_ns: ns_per_input_sample,
        };
        let ctx = GateContext {
            frame_period_ns: 512.0 * 1_000_000_000.0 / f64::from(from_rate),
            deadline_miss_rate: None,
            p9999_ns: None,
        };
        let exit_code = bench_gate::finish(
            "audio_resampler_streaming_perf",
            gate_mode,
            gate_spec.as_deref().map(Path::new),
            &[metric],
            &ctx,
        )
        .0
        .kind
        .exit_code();
        if exit_code != 0 {
            std::process::exit(exit_code);
        }
    }
}

fn benchmark_api(
    scenario: Scenario,
    api: ApiPath,
    frames: usize,
    input: &[f64],
    iterations: usize,
    trials: usize,
) -> Report {
    let mut best: Option<Report> = None;

    for _ in 0..trials {
        let mut resampler = StreamingResampler::new(CHANNELS, scenario.from_rate, scenario.to_rate)
            .expect("valid resampler rates");
        warm_resampler(&mut resampler, api, input);
        let report = measure_resampler(&mut resampler, api, frames, input, iterations);

        if best
            .as_ref()
            .map_or(true, |b| report.ns_per_input_sample < b.ns_per_input_sample)
        {
            best = Some(report);
        }
    }

    best.expect("at least one trial")
}

fn warm_resampler(resampler: &mut StreamingResampler, api: ApiPath, input: &[f64]) {
    let mut output = vec![0.0; streaming_output_capacity(resampler, api, input.len())];
    let mut append_output = Vec::with_capacity(output.len());
    let mut append_scratch = Vec::new();

    for _ in 0..WARMUP_BUFFERS {
        run_api(
            resampler,
            api,
            input,
            &mut output,
            &mut append_output,
            &mut append_scratch,
        );
    }
}

fn measure_resampler(
    resampler: &mut StreamingResampler,
    api: ApiPath,
    frames: usize,
    input: &[f64],
    iterations: usize,
) -> Report {
    let mut output = vec![0.0; streaming_output_capacity(resampler, api, input.len())];
    let mut append_output = Vec::with_capacity(output.len());
    let mut append_scratch = Vec::new();
    let mut output_frames = 0usize;
    let start = Instant::now();

    for _ in 0..iterations {
        output_frames = run_api(
            resampler,
            api,
            black_box(input),
            &mut output,
            &mut append_output,
            &mut append_scratch,
        );
    }

    let elapsed = start.elapsed();
    let ns_per_input_buffer = elapsed.as_nanos() as f64 / iterations as f64;
    let ns_per_input_sample = ns_per_input_buffer / (frames * CHANNELS) as f64;

    Report {
        ns_per_input_sample,
        ns_per_input_buffer,
        output_frames,
        elapsed,
    }
}

fn streaming_output_capacity(
    resampler: &StreamingResampler,
    api: ApiPath,
    input_samples: usize,
) -> usize {
    let input_frames = input_samples / CHANNELS;
    let exact = resample_output_capacity_for_bench(resampler, input_frames, CHANNELS)
        .expect("resampler output capacity");
    match api {
        // Production sizes the realtime leftover from exactly this bound.
        ApiPath::IntoExactCapacity => exact,
        // A deliberately generous caller scratch, so these paths measure the
        // driver rather than capacity edge behavior.
        ApiPath::Into | ApiPath::Append => exact.saturating_mul(8).saturating_add(8192),
    }
}

fn run_api(
    resampler: &mut StreamingResampler,
    api: ApiPath,
    input: &[f64],
    output: &mut [f64],
    append_output: &mut Vec<f64>,
    append_scratch: &mut Vec<f64>,
) -> usize {
    match api {
        ApiPath::Into | ApiPath::IntoExactCapacity => {
            let samples = resample_into_for_bench(resampler, input, output, CHANNELS)
                .expect("benchmark resample_into");
            black_box(&output[..samples]);
            samples / CHANNELS
        }
        ApiPath::Append => {
            append_output.clear();
            resample_append_for_bench(resampler, input, append_output, append_scratch, CHANNELS)
                .expect("benchmark resample_append");
            black_box(&append_output);
            append_output.len() / CHANNELS
        }
    }
}

fn synthetic_buffer(frames: usize, channels: usize, sample_rate: u32) -> Vec<f64> {
    let mut out = Vec::with_capacity(frames * channels);
    let sample_rate = sample_rate as f64;
    let mut left_phase = 0.0_f64;
    let mut right_phase = 0.0_f64;

    for frame in 0..frames {
        let t = frame as f64 / sample_rate;
        left_phase += std::f64::consts::TAU * (330.0 + 17.0 * (t * 2.5).sin()) / sample_rate;
        right_phase += std::f64::consts::TAU * (550.0 + 23.0 * (t * 1.7).cos()) / sample_rate;
        let envelope = 0.7 + 0.15 * (std::f64::consts::TAU * 1.1 * t).sin();
        let left = (left_phase.sin() * 0.6 + (left_phase * 2.0).sin() * 0.05) * envelope;
        let right = (right_phase.sin() * 0.55 - (right_phase * 3.0).cos() * 0.04) * envelope;

        out.push(left.clamp(-0.95, 0.95));
        if channels > 1 {
            out.push(right.clamp(-0.95, 0.95));
        }
        for ch in 2..channels {
            out.push((left * (1.0 - ch as f64 * 0.05)).clamp(-0.95, 0.95));
        }
    }

    out
}

use std::hint::black_box;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use audio_engine::StreamingDecoder;

const CHANNELS: usize = 2;
const SAMPLE_RATE: u32 = 48_000;
const DURATION_SECONDS: usize = 10;
const TOTAL_FRAMES: usize = SAMPLE_RATE as usize * DURATION_SECONDS;

#[derive(Clone, Copy)]
enum Scenario {
    OpenOnly,
    DecodeNextIntoDrain,
    DecodeNextIntoPreloadAppend,
    DecodeNextVecWrapper,
}

impl Scenario {
    fn name(self) -> &'static str {
        match self {
            Self::OpenOnly => "open_only",
            Self::DecodeNextIntoDrain => "decode_next_into_drain",
            Self::DecodeNextIntoPreloadAppend => "decode_next_into_preload_append",
            Self::DecodeNextVecWrapper => "decode_next_vec_wrapper",
        }
    }

    fn all() -> &'static [Self] {
        &[
            Self::OpenOnly,
            Self::DecodeNextIntoDrain,
            Self::DecodeNextIntoPreloadAppend,
            Self::DecodeNextVecWrapper,
        ]
    }
}

struct Report {
    ns_per_output_sample: f64,
    ns_per_file: f64,
    decoded_samples: usize,
    chunks: usize,
    elapsed: Duration,
}

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let quick = args.iter().any(|arg| arg == "--quick");
    let heavy = args.iter().any(|arg| arg == "--heavy");
    let enforce = args.iter().any(|arg| arg == "--enforce");

    let (iterations, trials) = if quick {
        (5, 1)
    } else if heavy {
        (60, 5)
    } else {
        (20, 3)
    };

    let fixture = ensure_pcm_wav_fixture();

    println!(
        "audio_decode_preload_perf mode={} fixture={} sample_rate={} channels={} duration_seconds={} coverage=streaming_decoder_pcm_wav",
        if quick {
            "quick"
        } else if heavy {
            "heavy"
        } else {
            "full"
        },
        fixture.display(),
        SAMPLE_RATE,
        CHANNELS,
        DURATION_SECONDS
    );
    println!(
        "audio_decode_preload_note generated_fixture=pcm_s16_wav lower_bound_for_compressed_formats excludes=resampler,dsp_chain,cpal_device_write"
    );

    for &scenario in Scenario::all() {
        let report = best_of(trials, || {
            benchmark_scenario(scenario, &fixture, iterations)
        });
        println!(
            "decode_preload scenario={} iterations={} trials={} decoded_samples={} chunks={} ns_per_output_sample={:.3} ns_per_file={:.3} elapsed_ms={:.3}",
            scenario.name(),
            iterations,
            trials,
            report.decoded_samples,
            report.chunks,
            report.ns_per_output_sample,
            report.ns_per_file,
            report.elapsed.as_secs_f64() * 1_000.0
        );

        if enforce && matches!(scenario, Scenario::DecodeNextIntoPreloadAppend) {
            assert_eq!(
                report.decoded_samples,
                TOTAL_FRAMES * CHANNELS,
                "decode benchmark did not decode the whole fixture"
            );
        }
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
            report.ns_per_output_sample < current.ns_per_output_sample
        }) {
            best = Some(report);
        }
    }
    best.expect("at least one trial")
}

fn benchmark_scenario(scenario: Scenario, fixture: &Path, iterations: usize) -> Report {
    let mut decoded_samples = 0usize;
    let mut chunks = 0usize;
    let start = Instant::now();

    for _ in 0..iterations {
        match scenario {
            Scenario::OpenOnly => {
                let decoder = StreamingDecoder::open(black_box(fixture)).expect("fixture opens");
                decoded_samples = decoder.info.total_frames.unwrap_or(TOTAL_FRAMES as u64) as usize
                    * decoder.info.channels;
                chunks = 0;
                black_box(decoder.info.sample_rate);
            }
            Scenario::DecodeNextIntoDrain => {
                let (samples, chunk_count) = decode_next_into_drain(fixture);
                decoded_samples = samples;
                chunks = chunk_count;
            }
            Scenario::DecodeNextIntoPreloadAppend => {
                let (samples, chunk_count) = decode_next_into_preload_append(fixture);
                decoded_samples = samples;
                chunks = chunk_count;
            }
            Scenario::DecodeNextVecWrapper => {
                let (samples, chunk_count) = decode_next_vec_wrapper(fixture);
                decoded_samples = samples;
                chunks = chunk_count;
            }
        }
    }

    let elapsed = start.elapsed();
    let ns_per_file = elapsed.as_nanos() as f64 / iterations as f64;
    let divisor = decoded_samples.max(1) as f64;
    Report {
        ns_per_output_sample: ns_per_file / divisor,
        ns_per_file,
        decoded_samples,
        chunks,
        elapsed,
    }
}

fn decode_next_into_drain(fixture: &Path) -> (usize, usize) {
    let mut decoder = StreamingDecoder::open(fixture).expect("fixture opens");
    let mut chunk = Vec::new();
    let mut decoded_samples = 0usize;
    let mut chunks = 0usize;

    while let Some(appended) = decoder.decode_next_into(&mut chunk).expect("decode packet") {
        decoded_samples += appended;
        chunks += 1;
        black_box(&chunk);
        chunk.clear();
    }

    (decoded_samples, chunks)
}

fn decode_next_into_preload_append(fixture: &Path) -> (usize, usize) {
    let mut decoder = StreamingDecoder::open(fixture).expect("fixture opens");
    let total_frames = decoder.info.total_frames.unwrap_or(TOTAL_FRAMES as u64) as usize;
    let mut all_samples = Vec::with_capacity(total_frames * decoder.info.channels);
    let mut chunk = Vec::new();
    let mut chunks = 0usize;

    while decoder
        .decode_next_into(&mut chunk)
        .expect("decode packet")
        .is_some()
    {
        all_samples.extend_from_slice(&chunk);
        chunks += 1;
        chunk.clear();
    }

    let decoded_samples = all_samples.len();
    black_box(all_samples);
    (decoded_samples, chunks)
}

fn decode_next_vec_wrapper(fixture: &Path) -> (usize, usize) {
    let mut decoder = StreamingDecoder::open(fixture).expect("fixture opens");
    let mut decoded_samples = 0usize;
    let mut chunks = 0usize;

    while let Some(chunk) = decoder.decode_next().expect("decode packet") {
        decoded_samples += chunk.len();
        chunks += 1;
        black_box(chunk);
    }

    (decoded_samples, chunks)
}

fn ensure_pcm_wav_fixture() -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("bench-fixtures");
    std::fs::create_dir_all(&dir).expect("create fixture dir");
    let path = dir.join("decoder_sine_48k_stereo_10s_s16.wav");

    if path.exists() {
        return path;
    }

    write_pcm_wav(&path).expect("write generated wav fixture");
    path
}

fn write_pcm_wav(path: &Path) -> std::io::Result<()> {
    let mut file = std::fs::File::create(path)?;
    let bytes_per_sample = 2u16;
    let bits_per_sample = bytes_per_sample * 8;
    let block_align = CHANNELS as u16 * bytes_per_sample;
    let byte_rate = SAMPLE_RATE * block_align as u32;
    let data_bytes = (TOTAL_FRAMES * CHANNELS * bytes_per_sample as usize) as u32;

    file.write_all(b"RIFF")?;
    file.write_all(&0u32.to_le_bytes())?;
    file.write_all(b"WAVE")?;
    file.write_all(b"fmt ")?;
    file.write_all(&16u32.to_le_bytes())?;
    file.write_all(&1u16.to_le_bytes())?;
    file.write_all(&(CHANNELS as u16).to_le_bytes())?;
    file.write_all(&SAMPLE_RATE.to_le_bytes())?;
    file.write_all(&byte_rate.to_le_bytes())?;
    file.write_all(&block_align.to_le_bytes())?;
    file.write_all(&bits_per_sample.to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&data_bytes.to_le_bytes())?;

    for frame in 0..TOTAL_FRAMES {
        let t = frame as f64 / SAMPLE_RATE as f64;
        let left = (2.0 * std::f64::consts::PI * 440.0 * t).sin() * 0.45;
        let right = (2.0 * std::f64::consts::PI * 660.0 * t).sin() * 0.40;
        write_i16_sample(&mut file, left)?;
        write_i16_sample(&mut file, right)?;
    }

    let file_len = file.seek(SeekFrom::End(0))?;
    let riff_size = (file_len - 8) as u32;
    file.seek(SeekFrom::Start(4))?;
    file.write_all(&riff_size.to_le_bytes())?;
    Ok(())
}

fn write_i16_sample(file: &mut std::fs::File, sample: f64) -> std::io::Result<()> {
    let scaled = (sample.clamp(-1.0, 1.0) * i16::MAX as f64).round() as i16;
    file.write_all(&scaled.to_le_bytes())
}

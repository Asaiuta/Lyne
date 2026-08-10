//! Persistent local streaming session assembled from the isolated v2 planes.

use std::sync::Arc;
use std::time::Duration;

use thiserror::Error;

use crate::config::{PhaseResponse, ResampleQuality};
use crate::decoder::StreamingDecoder;
use crate::processor::StreamingResampler;

use super::memory::{process_decoded_memory_ledger, DecodedMemoryOwner, DecodedMemoryReservation};
use super::pcm_window::{
    PcmWindow, PcmWindowAccessError, PcmWindowGeometry, PcmWindowParts, PcmWindowReader,
    PcmWindowWriter,
};
use super::producer::{
    PersistentProducerHandle, ProducerCommand, ProducerCommandKind, ProducerWorkerControl,
    WindowPublishError, WindowSlotPublisher,
};
use super::rt_view::{
    ProducerSnapshot, StreamingDecodeState, StreamingRtView, WindowIdentitySnapshot, WindowSeekKind,
};
use super::source::{
    OpenedSource, StreamRecoveryPolicy, StreamSourceCapabilities, StreamSourceIdentity,
};

const MIN_BACKPRESSURE_PARK: Duration = Duration::from_micros(250);
const MAX_BACKPRESSURE_PARK: Duration = Duration::from_millis(8);

#[derive(Clone, Copy)]
pub(crate) struct LocalSessionConfig {
    pub target_output_sample_rate: Option<u32>,
    pub epoch: u64,
    pub origin_frame: u64,
    pub phase_response: PhaseResponse,
    pub resample_quality: ResampleQuality,
    /// Memory-ledger owner for the session window. Preload sessions charge
    /// `PendingPlayback` so active + pending budgets stay visible separately.
    pub window_owner: super::memory::DecodedMemoryOwner,
}

#[derive(Debug, Error)]
pub(crate) enum StreamingSessionError {
    #[error("failed to spawn persistent producer: {0}")]
    Spawn(#[from] std::io::Error),
    #[error("decoder probe failed: {0}")]
    Decoder(String),
    #[error("memory reservation failed: {0}")]
    Reservation(String),
    #[error("source channels {source_channels} do not match window channels {window_channels}")]
    ChannelMismatch {
        source_channels: usize,
        window_channels: usize,
    },
}

#[derive(Debug, Error)]
enum WorkerError {
    #[error("decoder error: {0}")]
    Decoder(String),
    #[error("resampler error: {0}")]
    Resampler(String),
    #[error("memory reservation error: {0}")]
    Reservation(String),
    #[error("window error: {0:?}")]
    Window(PcmWindowAccessError),
    #[error("source channels {source_channels} do not match window channels {window_channels}")]
    ChannelMismatch {
        source_channels: usize,
        window_channels: usize,
    },
}

pub struct PersistentStreamingSession {
    pub(crate) rt: Arc<StreamingRtView>,
    pub(crate) window: Arc<PcmWindow>,
    pub(crate) reader: PcmWindowReader,
    pub(crate) identity: StreamSourceIdentity,
    pub(crate) capabilities: StreamSourceCapabilities,
    pub(crate) recovery: StreamRecoveryPolicy,
    pub(crate) producer: PersistentProducerHandle,
    pub(crate) source_sample_rate: u32,
    pub(crate) output_sample_rate: u32,
    pub(crate) channels: usize,
    pub(crate) total_frames: u64,
}

impl std::fmt::Debug for PersistentStreamingSession {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PersistentStreamingSession")
            .field("identity", &self.identity)
            .field("capabilities", &self.capabilities)
            .field("recovery", &self.recovery)
            .field("producer_generation", &self.producer.generation())
            .finish_non_exhaustive()
    }
}

impl PersistentStreamingSession {
    /// Promote the session's primary window to the active memory owner. Called
    /// by the audio thread when a preloaded session becomes the active one.
    pub(crate) fn reown_window(&self, owner: super::memory::DecodedMemoryOwner) {
        self.window.reown(owner);
    }

    pub(crate) fn start_local_with_capacity(
        opened: OpenedSource,
        capacity_bytes: usize,
        config: LocalSessionConfig,
    ) -> Result<Self, StreamingSessionError> {
        let OpenedSource {
            generation,
            source,
            capabilities,
            identity,
            recovery,
        } = opened;
        let builder = StreamingDecoder::probe_opened_source(source, None)
            .map_err(|error| StreamingSessionError::Decoder(error.to_string()))?;
        let geometry = PcmWindowGeometry::for_capacity_bytes(builder.info.channels, capacity_bytes)
            .map_err(|error| StreamingSessionError::Reservation(error.to_string()))?;
        let parts = PcmWindow::create(
            geometry,
            config.epoch,
            config.origin_frame,
            config.window_owner,
        )
        .map_err(|error| StreamingSessionError::Reservation(error.to_string()))?;
        Self::start_local_from_builder(
            generation,
            capabilities,
            identity,
            recovery,
            builder,
            parts,
            config,
        )
    }

    pub(crate) fn start_local(
        opened: OpenedSource,
        parts: PcmWindowParts,
        config: LocalSessionConfig,
    ) -> Result<Self, StreamingSessionError> {
        let OpenedSource {
            generation,
            source,
            capabilities,
            identity,
            recovery,
        } = opened;
        let builder = StreamingDecoder::probe_opened_source(source, None)
            .map_err(|error| StreamingSessionError::Decoder(error.to_string()))?;
        Self::start_local_from_builder(
            generation,
            capabilities,
            identity,
            recovery,
            builder,
            parts,
            config,
        )
    }

    fn start_local_from_builder(
        generation: u64,
        capabilities: StreamSourceCapabilities,
        identity: StreamSourceIdentity,
        recovery: StreamRecoveryPolicy,
        builder: audio_engine_core::decoder::StreamingDecoderBuilder,
        parts: PcmWindowParts,
        config: LocalSessionConfig,
    ) -> Result<Self, StreamingSessionError> {
        let PcmWindowParts {
            window,
            writer,
            reader,
        } = parts;
        let channels = builder.info.channels;
        if channels != writer.geometry().channels() {
            return Err(StreamingSessionError::ChannelMismatch {
                source_channels: channels,
                window_channels: writer.geometry().channels(),
            });
        }
        let source_sample_rate = builder.info.sample_rate;
        let output_sample_rate = config
            .target_output_sample_rate
            .unwrap_or(source_sample_rate);
        let total_frames = builder.info.total_frames.map_or(0, |frames| {
            if source_sample_rate == output_sample_rate {
                frames
            } else {
                let numerator = u128::from(frames) * u128::from(output_sample_rate);
                let denominator = u128::from(source_sample_rate.max(1));
                numerator.div_ceil(denominator).min(u128::from(u64::MAX)) as u64
            }
        });
        let decoder_reservation = process_decoded_memory_ledger()
            .try_reserve(
                DecodedMemoryOwner::ProducerScratch,
                builder
                    .staging_buffer_bytes()
                    .map_err(|error| StreamingSessionError::Decoder(error.to_string()))?,
            )
            .map_err(|error| StreamingSessionError::Reservation(error.to_string()))?;
        let rt = Arc::new(StreamingRtView::new());
        rt.install_window(Some(Arc::clone(&window)));
        rt.publish_identity(WindowIdentitySnapshot {
            generation,
            epoch: config.epoch,
            active: true,
        });
        rt.publish_producer(ProducerSnapshot {
            retained_start_frame: config.origin_frame,
            produced_end_frame: config.origin_frame,
            decode_state: StreamingDecodeState::Loading,
        });

        let worker_rt = Arc::clone(&rt);
        let producer = PersistentProducerHandle::spawn(generation, move |mut control| {
            worker_rt.record_worker_spawned();
            let failed = run_worker(
                builder,
                decoder_reservation,
                writer,
                config,
                output_sample_rate,
                capabilities.startup_frames,
                &worker_rt,
                &mut control,
            )
            .is_err();
            if failed && !control.is_cancelled() {
                let previous = worker_rt.producer();
                worker_rt.publish_producer(ProducerSnapshot {
                    decode_state: StreamingDecodeState::Failed,
                    ..previous
                });
            }
            worker_rt.record_worker_exited(control.is_cancelled(), failed);
        })?;

        Ok(Self {
            rt,
            window,
            reader,
            identity,
            capabilities,
            recovery,
            producer,
            source_sample_rate,
            output_sample_rate,
            channels,
            total_frames,
        })
    }
}

fn run_worker(
    builder: audio_engine_core::decoder::StreamingDecoderBuilder,
    decoder_reservation: DecodedMemoryReservation,
    writer: PcmWindowWriter,
    config: LocalSessionConfig,
    output_sample_rate: u32,
    startup_frames: u64,
    rt: &StreamingRtView,
    control: &mut ProducerWorkerControl,
) -> Result<(), WorkerError> {
    let channels = builder.info.channels;
    let input_rate = builder.info.sample_rate;
    let mut decoder = builder
        .build()
        .map_err(|error| WorkerError::Decoder(error.to_string()))?;
    let (mut resampler, resampler_reservation) = if input_rate != output_sample_rate {
        let bytes =
            StreamingResampler::working_buffer_bytes(channels, input_rate, output_sample_rate)
                .map_err(|error| WorkerError::Resampler(error.to_string()))?;
        let reservation = reserve(DecodedMemoryOwner::ResamplerCarry, bytes)?;
        let value = StreamingResampler::with_quality(
            channels,
            input_rate,
            output_sample_rate,
            config.phase_response,
            config.resample_quality,
        )
        .map_err(|error| WorkerError::Resampler(error.to_string()))?;
        (Some(value), Some(reservation))
    } else {
        (None, None)
    };
    let _reservations = (decoder_reservation, resampler_reservation);
    let mut epoch = config.epoch;
    let mut origin_frame = config.origin_frame;
    let mut publisher = WindowSlotPublisher::new(writer, epoch, origin_frame);
    let mut discard_output_frames = 0_u64;
    let mut activation_target = None;
    let mut at_eof = false;
    let mut pending_command = None;
    let mut park = MIN_BACKPRESSURE_PARK;

    'worker: loop {
        if control.is_cancelled() {
            return Ok(());
        }
        let mut handled_command = false;
        if let Some(command) = pending_command.take().or_else(|| control.take_latest()) {
            if command.kind == ProducerCommandKind::SourceSeek {
                if command.generation != rt.identity().generation {
                    log::warn!(
                        "v2 src-seek: drop gen {} vs identity {}",
                        command.generation,
                        rt.identity().generation
                    );
                } else {
                    apply_source_seek(
                        command,
                        &mut decoder,
                        resampler.as_mut(),
                        &mut publisher,
                        input_rate,
                        output_sample_rate,
                        &mut epoch,
                        &mut origin_frame,
                        &mut discard_output_frames,
                        &mut activation_target,
                        rt,
                    )?;
                    log::info!(
                        "v2 src-seek: applied serial={} target={} epoch={}",
                        command.serial,
                        command.target_frame,
                        epoch
                    );
                    control.publish_source_seek_applied(command.serial);
                    rt.record_source_seek_applied();
                    park = MIN_BACKPRESSURE_PARK;
                    at_eof = false;
                    handled_command = true;
                }
            }
        }
        if at_eof && !handled_command {
            control.park_timeout(MAX_BACKPRESSURE_PARK);
            continue;
        }
        update_reclaim_boundary(&mut publisher, rt, origin_frame);
        let Some(decoded) = decoder
            .decode_next_borrowed()
            .map_err(|error| WorkerError::Decoder(error.to_string()))?
        else {
            if let Some(resampler) = resampler.as_mut() {
                if let Some(command) = append_all(
                    &mut publisher,
                    resampler.flush_borrowed().samples,
                    rt,
                    control,
                    origin_frame,
                    startup_frames,
                    &mut park,
                )? {
                    pending_command = Some(command);
                    continue 'worker;
                }
            }
            let progress = publisher.finish_partial().map_err(window_error)?;
            publish_progress(
                rt,
                origin_frame,
                progress.produced_end_frame,
                startup_frames,
                true,
            );
            if let Some(command) = control.take_latest() {
                pending_command = Some(command);
                at_eof = false;
                continue 'worker;
            }
            activate_source_seek_if_ready(
                rt,
                epoch,
                &mut activation_target,
                StreamingDecodeState::EndOfStream,
            );
            at_eof = true;
            control.park_timeout(MAX_BACKPRESSURE_PARK);
            continue;
        };
        let mut output = if let Some(resampler) = resampler.as_mut() {
            resampler.process_chunk_borrowed(decoded).samples
        } else {
            decoded
        };
        if discard_output_frames != 0 {
            let output_frames = output.len() / channels;
            let discarded = output_frames.min(discard_output_frames as usize);
            output = &output[discarded * channels..];
            discard_output_frames -= discarded as u64;
            if output.is_empty() {
                continue;
            }
        }
        if let Some(command) = append_all(
            &mut publisher,
            output,
            rt,
            control,
            origin_frame,
            startup_frames,
            &mut park,
        )? {
            pending_command = Some(command);
            continue 'worker;
        }
        if let Some(command) = control.take_latest() {
            pending_command = Some(command);
            continue 'worker;
        }
        activate_source_seek_if_ready(
            rt,
            epoch,
            &mut activation_target,
            rt.producer().decode_state,
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn apply_source_seek(
    command: ProducerCommand,
    decoder: &mut StreamingDecoder,
    resampler: Option<&mut StreamingResampler>,
    publisher: &mut WindowSlotPublisher,
    input_rate: u32,
    output_rate: u32,
    epoch: &mut u64,
    origin_frame: &mut u64,
    discard_output_frames: &mut u64,
    activation_target: &mut Option<u64>,
    rt: &StreamingRtView,
) -> Result<(), WorkerError> {
    let target_frame = command.target_frame;
    decoder
        .seek(target_frame as f64 / f64::from(output_rate))
        .map_err(|error| WorkerError::Decoder(error.to_string()))?;
    if let Some(resampler) = resampler {
        resampler.reset();
    }
    let realized_output_frame = decoder
        .current_frame()
        .saturating_mul(u64::from(output_rate))
        / u64::from(input_rate.max(1));
    *discard_output_frames = target_frame.saturating_sub(realized_output_frame);
    *epoch = epoch
        .checked_add(1)
        .ok_or_else(|| WorkerError::Decoder("streaming epoch overflow".to_string()))?;
    *origin_frame = target_frame;
    rt.publish_identity(WindowIdentitySnapshot {
        generation: command.generation,
        epoch: *epoch,
        active: false,
    });
    publisher
        .reset_epoch(*epoch, target_frame)
        .map_err(WorkerError::Window)?;
    rt.publish_render_cursor(target_frame);
    rt.publish_producer(ProducerSnapshot {
        retained_start_frame: target_frame,
        produced_end_frame: target_frame,
        decode_state: StreamingDecodeState::Loading,
    });
    *activation_target = Some(target_frame);
    Ok(())
}

fn activate_source_seek_if_ready(
    rt: &StreamingRtView,
    epoch: u64,
    activation_target: &mut Option<u64>,
    state: StreamingDecodeState,
) {
    if !matches!(
        state,
        StreamingDecodeState::Ready | StreamingDecodeState::EndOfStream
    ) {
        return;
    }
    let Some(target_frame) = activation_target.take() else {
        return;
    };
    let generation = rt.identity().generation;
    rt.publish_identity(WindowIdentitySnapshot {
        generation,
        epoch,
        active: true,
    });
    rt.request_seek(target_frame, generation, epoch, WindowSeekKind::Forward);
}

fn reserve(
    owner: DecodedMemoryOwner,
    bytes: usize,
) -> Result<DecodedMemoryReservation, WorkerError> {
    process_decoded_memory_ledger()
        .try_reserve(owner, bytes)
        .map_err(|error| WorkerError::Reservation(error.to_string()))
}

fn update_reclaim_boundary(
    publisher: &mut WindowSlotPublisher,
    rt: &StreamingRtView,
    origin_frame: u64,
) {
    let geometry = publisher.geometry();
    let cursor_sequence = geometry
        .sequence_for_frame(origin_frame, rt.render_cursor().max(origin_frame))
        .unwrap_or(0);
    let retained_slots = (geometry.slot_count() / 2).max(1) as u64;
    let mut reclaim_before = cursor_sequence.saturating_sub(retained_slots);
    if let Some(request) = rt.seek_request() {
        let applied_serial = rt.applied_seek().map_or(0, |applied| applied.serial);
        if request.kind == super::rt_view::WindowSeekKind::Backward
            && request.serial > applied_serial
        {
            if let Ok(target_sequence) =
                geometry.sequence_for_frame(origin_frame, request.target_frame)
            {
                reclaim_before = reclaim_before.min(target_sequence);
            }
        }
    }
    publisher.set_reclaim_before_sequence(reclaim_before);
    let previous = rt.producer();
    rt.publish_producer(ProducerSnapshot {
        retained_start_frame: origin_frame
            .saturating_add(reclaim_before.saturating_mul(geometry.slot_frames() as u64)),
        ..previous
    });
}

fn append_all(
    publisher: &mut WindowSlotPublisher,
    mut samples: &[f64],
    rt: &StreamingRtView,
    control: &mut ProducerWorkerControl,
    origin_frame: u64,
    startup_frames: u64,
    park: &mut Duration,
) -> Result<Option<ProducerCommand>, WorkerError> {
    while !samples.is_empty() {
        if let Some(command) = control.take_latest() {
            return Ok(Some(command));
        }
        update_reclaim_boundary(publisher, rt, origin_frame);
        match publisher.append_borrowed(samples) {
            Ok(progress) => {
                publish_progress(
                    rt,
                    origin_frame,
                    progress.produced_end_frame,
                    startup_frames,
                    false,
                );
                *park = MIN_BACKPRESSURE_PARK;
                return Ok(None);
            }
            Err(error) => {
                let consumed = error.progress.consumed_samples;
                publish_progress(
                    rt,
                    origin_frame,
                    error.progress.produced_end_frame,
                    startup_frames,
                    false,
                );
                samples = &samples[consumed..];
                if control.is_cancelled() {
                    return Ok(None);
                }
                if !matches!(
                    error.source,
                    PcmWindowAccessError::SlotBusy { .. }
                        | PcmWindowAccessError::SlotNotReclaimable { .. }
                ) {
                    return Err(window_error(error));
                }
                control.park_timeout(*park);
                *park = (*park * 2).min(MAX_BACKPRESSURE_PARK);
            }
        }
    }
    Ok(None)
}

fn window_error(error: WindowPublishError) -> WorkerError {
    WorkerError::Window(error.source)
}

fn publish_progress(
    rt: &StreamingRtView,
    origin_frame: u64,
    produced_end_frame: u64,
    startup_frames: u64,
    eof: bool,
) {
    let previous = rt.producer();
    rt.publish_producer(ProducerSnapshot {
        retained_start_frame: previous.retained_start_frame,
        produced_end_frame,
        decode_state: if eof {
            StreamingDecodeState::EndOfStream
        } else if produced_end_frame.saturating_sub(origin_frame) >= startup_frames {
            StreamingDecodeState::Ready
        } else {
            StreamingDecodeState::Loading
        },
    });
}

#[cfg(test)]
mod tests {
    use std::io::Write;
    use std::mem::size_of;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicBool;
    use std::sync::{Mutex, MutexGuard, OnceLock};
    use std::time::Instant;

    use crate::decoder::DecodeCancelToken;

    use super::*;
    use crate::player::streaming::memory::DecodedMemoryOwner;
    use crate::player::streaming::pcm_window::PcmWindowGeometry;
    use crate::player::streaming::producer::ProducerReaper;
    use crate::player::streaming::source::{
        LocalFileSourceFactory, OpenRequest, StreamFetchPolicy, StreamOpenIntent,
        StreamSourceFactory,
    };

    struct TempWav {
        path: PathBuf,
    }

    impl TempWav {
        fn pcm16(channels: u16, sample_rate: u32, samples: &[i16]) -> Self {
            let path = std::env::temp_dir().join(format!(
                "lyne-stream-session-{}-{:?}-{}.wav",
                std::process::id(),
                std::thread::current().id(),
                samples.len()
            ));
            let data_bytes = samples.len() * size_of::<i16>();
            let mut bytes = Vec::with_capacity(44 + data_bytes);
            bytes.extend_from_slice(b"RIFF");
            bytes.extend_from_slice(&(36_u32 + data_bytes as u32).to_le_bytes());
            bytes.extend_from_slice(b"WAVEfmt ");
            bytes.extend_from_slice(&16_u32.to_le_bytes());
            bytes.extend_from_slice(&1_u16.to_le_bytes());
            bytes.extend_from_slice(&channels.to_le_bytes());
            bytes.extend_from_slice(&sample_rate.to_le_bytes());
            let byte_rate = sample_rate * u32::from(channels) * 2;
            bytes.extend_from_slice(&byte_rate.to_le_bytes());
            bytes.extend_from_slice(&(channels * 2).to_le_bytes());
            bytes.extend_from_slice(&16_u16.to_le_bytes());
            bytes.extend_from_slice(b"data");
            bytes.extend_from_slice(&(data_bytes as u32).to_le_bytes());
            for sample in samples {
                bytes.extend_from_slice(&sample.to_le_bytes());
            }
            let mut file = std::fs::File::create(&path).expect("create WAV fixture");
            file.write_all(&bytes).expect("write WAV fixture");
            file.flush().expect("flush WAV fixture");
            Self { path }
        }

        fn open(&self, generation: u64) -> OpenedSource {
            LocalFileSourceFactory
                .open(OpenRequest {
                    generation,
                    intent: StreamOpenIntent::InitialPlayback,
                    path: &self.path,
                    cancel: DecodeCancelToken::new(Arc::new(AtomicBool::new(false))),
                    credentials: None,
                    expected_identity: None,
                    fetch_policy: StreamFetchPolicy::LocalOnly,
                })
                .expect("open WAV fixture")
        }
    }

    impl Drop for TempWav {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
        }
    }

    fn config(output_sample_rate: u32) -> LocalSessionConfig {
        LocalSessionConfig {
            window_owner: DecodedMemoryOwner::ActiveWindow,
            target_output_sample_rate: Some(output_sample_rate),
            epoch: 3,
            origin_frame: 17,
            phase_response: PhaseResponse::default(),
            resample_quality: ResampleQuality::default(),
        }
    }

    fn wait_until(timeout: Duration, predicate: impl Fn() -> bool) {
        let deadline = Instant::now() + timeout;
        while !predicate() {
            assert!(Instant::now() < deadline, "condition timed out");
            std::thread::yield_now();
        }
    }

    fn session_test_guard() -> MutexGuard<'static, ()> {
        static GUARD: OnceLock<Mutex<()>> = OnceLock::new();
        GUARD
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[test]
    fn local_session_publishes_exact_pcm_and_reaches_eof() {
        let _guard = session_test_guard();
        let fixture = TempWav::pcm16(1, 44_100, &[0, 16_384, -16_384, 32_767]);
        let parts = PcmWindow::create(
            PcmWindowGeometry::for_slot_count(1, 1).expect("geometry"),
            3,
            17,
            DecodedMemoryOwner::ActiveWindow,
        )
        .expect("window");
        let mut session =
            PersistentStreamingSession::start_local(fixture.open(7), parts, config(44_100))
                .expect("start session");

        wait_until(Duration::from_secs(2), || {
            session.rt.producer().decode_state == StreamingDecodeState::EndOfStream
        });
        let slot = session.reader.try_claim_sequence(3, 0).expect("claim PCM");
        assert_eq!(slot.valid_frames(), 4);
        let samples = slot.samples();
        assert_eq!(samples[0], 0.0);
        assert!((samples[1] - 0.5).abs() < 0.000_001);
        assert!((samples[2] + 0.5).abs() < 0.000_001);
        assert!(samples[3] > 0.999);
        assert_eq!(session.source_sample_rate, 44_100);
        assert_eq!(session.output_sample_rate, 44_100);
        assert_eq!(session.channels, 1);
        assert_eq!(session.total_frames, 4);
    }

    #[test]
    fn session_without_target_rate_uses_probed_source_rate() {
        let _guard = session_test_guard();
        let fixture = TempWav::pcm16(1, 48_000, &[0, 0, 0, 0]);
        let parts = PcmWindow::create(
            PcmWindowGeometry::for_slot_count(1, 1).expect("geometry"),
            3,
            17,
            DecodedMemoryOwner::ActiveWindow,
        )
        .expect("window");
        let mut session_config = config(44_100);
        session_config.target_output_sample_rate = None;
        let session =
            PersistentStreamingSession::start_local(fixture.open(12), parts, session_config)
                .expect("start session");

        assert_eq!(session.source_sample_rate, 48_000);
        assert_eq!(session.output_sample_rate, 48_000);
        assert_eq!(session.total_frames, 4);
    }

    #[test]
    fn audio_thread_ready_and_eof_state_machine_is_one_shot() {
        let _guard = session_test_guard();
        let fixture = TempWav::pcm16(1, 44_100, &[0, 0, 0, 0]);
        let parts = PcmWindow::create(
            PcmWindowGeometry::for_slot_count(1, 1).expect("geometry"),
            3,
            17,
            DecodedMemoryOwner::ActiveWindow,
        )
        .expect("window");
        let session =
            PersistentStreamingSession::start_local(fixture.open(13), parts, config(44_100))
                .expect("start session");
        wait_until(Duration::from_secs(2), || {
            session.rt.producer().decode_state == StreamingDecodeState::EndOfStream
        });
        let shared = crate::player::state::SharedState::new();
        shared
            .is_loading
            .store(true, std::sync::atomic::Ordering::Release);
        shared
            .streaming_active
            .store(true, std::sync::atomic::Ordering::Release);
        let mut ready_generation = 0;
        let mut autoplay_pending = true;

        session.rt.publish_producer(ProducerSnapshot {
            retained_start_frame: 17,
            produced_end_frame: 17,
            decode_state: StreamingDecodeState::Loading,
        });
        assert!(!crate::player::audio_thread::apply_streaming_session_state(
            &shared,
            &session,
            &mut ready_generation,
            &mut autoplay_pending,
        ));
        assert!(shared.is_loading.load(std::sync::atomic::Ordering::Acquire));

        session.rt.publish_producer(ProducerSnapshot {
            retained_start_frame: 17,
            produced_end_frame: 21,
            decode_state: StreamingDecodeState::Ready,
        });
        assert!(crate::player::audio_thread::apply_streaming_session_state(
            &shared,
            &session,
            &mut ready_generation,
            &mut autoplay_pending,
        ));
        assert!(!shared.is_loading.load(std::sync::atomic::Ordering::Acquire));
        assert!(!autoplay_pending);
        assert!(!crate::player::audio_thread::apply_streaming_session_state(
            &shared,
            &session,
            &mut ready_generation,
            &mut autoplay_pending,
        ));

        session.rt.publish_producer(ProducerSnapshot {
            retained_start_frame: 17,
            produced_end_frame: 21,
            decode_state: StreamingDecodeState::EndOfStream,
        });
        assert!(!crate::player::audio_thread::apply_streaming_session_state(
            &shared,
            &session,
            &mut ready_generation,
            &mut autoplay_pending,
        ));
        assert!(shared
            .streaming_decode_finished
            .load(std::sync::atomic::Ordering::Acquire));
        assert!(shared
            .streaming_active
            .load(std::sync::atomic::Ordering::Acquire));

        shared
            .is_loading
            .store(true, std::sync::atomic::Ordering::Release);
        shared
            .state
            .store(crate::player::state::PlayerState::Playing);
        autoplay_pending = true;
        session.rt.publish_producer(ProducerSnapshot {
            retained_start_frame: 17,
            produced_end_frame: 21,
            decode_state: StreamingDecodeState::Failed,
        });
        assert!(!crate::player::audio_thread::apply_streaming_session_state(
            &shared,
            &session,
            &mut ready_generation,
            &mut autoplay_pending,
        ));
        assert!(!shared.is_loading.load(std::sync::atomic::Ordering::Acquire));
        assert_eq!(
            shared.state.load(),
            crate::player::state::PlayerState::Stopped
        );
        assert!(!autoplay_pending);
    }

    #[test]
    fn cancellation_reaps_worker_and_releases_decoder_reservation() {
        let _guard = session_test_guard();
        let geometry = PcmWindowGeometry::for_slot_count(1, 1).expect("geometry");
        let fixture = TempWav::pcm16(1, 44_100, &vec![1; geometry.slot_frames() * 3]);
        let baseline = process_decoded_memory_ledger().snapshot().reserved_by_owner
            [DecodedMemoryOwner::ProducerScratch as usize];
        let parts =
            PcmWindow::create(geometry, 3, 17, DecodedMemoryOwner::ActiveWindow).expect("window");
        let session =
            PersistentStreamingSession::start_local(fixture.open(8), parts, config(44_100))
                .expect("start session");

        wait_until(Duration::from_secs(2), || {
            session.rt.producer().produced_end_frame >= 17 + geometry.slot_frames() as u64
        });
        assert!(
            process_decoded_memory_ledger().snapshot().reserved_by_owner
                [DecodedMemoryOwner::ProducerScratch as usize]
                > baseline
        );
        wait_until(Duration::from_secs(1), || {
            session.rt.seek_telemetry().workers_live == 1
        });
        let worker_rt = Arc::clone(&session.rt);
        session.producer.request_source_seek(2_000);

        let PersistentStreamingSession { producer, .. } = session;
        let reaper = ProducerReaper::new().expect("start reaper");
        let reaper_handle = reaper.handle().expect("reaper handle");
        assert!(producer.retire(&reaper_handle).is_ok(), "submit producer");
        wait_until(Duration::from_secs(2), || reaper_handle.reaped_count() == 1);
        let telemetry = worker_rt.seek_telemetry();
        assert_eq!(telemetry.workers_spawned, 1);
        assert_eq!(telemetry.workers_live, 0);
        assert_eq!(telemetry.workers_cancelled, 1);
        assert_eq!(
            process_decoded_memory_ledger().snapshot().reserved_by_owner
                [DecodedMemoryOwner::ProducerScratch as usize],
            baseline
        );
    }

    #[test]
    fn resampled_worker_holds_and_releases_exact_carry_reservation() {
        let _guard = session_test_guard();
        let geometry = PcmWindowGeometry::for_slot_count(1, 4).expect("geometry");
        let fixture = TempWav::pcm16(1, 44_100, &vec![1; geometry.slot_frames() * 3]);
        let baseline = process_decoded_memory_ledger().snapshot().reserved_by_owner
            [DecodedMemoryOwner::ResamplerCarry as usize];
        let parts =
            PcmWindow::create(geometry, 3, 17, DecodedMemoryOwner::ActiveWindow).expect("window");
        let mut session =
            PersistentStreamingSession::start_local(fixture.open(10), parts, config(48_000))
                .expect("start resampled session");

        wait_until(Duration::from_secs(2), || {
            session.rt.producer().produced_end_frame >= 17 + geometry.slot_frames() as u64
        });
        assert!(
            process_decoded_memory_ledger().snapshot().reserved_by_owner
                [DecodedMemoryOwner::ResamplerCarry as usize]
                > baseline
        );
        let generation = session.producer.generation();
        session.producer.request_source_seek(8_000);
        wait_until(Duration::from_secs(2), || {
            let identity = session.rt.identity();
            identity.epoch > 3 && identity.active && session.window.origin_frame() == 8_000
        });
        assert_eq!(session.producer.generation(), generation);
        let slot = session
            .reader
            .try_claim_frame(session.rt.identity().epoch, 8_000)
            .expect("claim resampled source-seek target");
        assert!(!slot.samples().is_empty());
        slot.release();

        let PersistentStreamingSession { producer, .. } = session;
        let reaper = ProducerReaper::new().expect("start reaper");
        let reaper_handle = reaper.handle().expect("reaper handle");
        assert!(producer.retire(&reaper_handle).is_ok(), "submit producer");
        wait_until(Duration::from_secs(2), || reaper_handle.reaped_count() == 1);
        assert_eq!(
            process_decoded_memory_ledger().snapshot().reserved_by_owner
                [DecodedMemoryOwner::ResamplerCarry as usize],
            baseline
        );
    }

    #[test]
    fn source_seek_commands_keep_the_same_persistent_worker() {
        let _guard = session_test_guard();
        let geometry = PcmWindowGeometry::for_slot_count(1, 4).expect("geometry");
        let samples = (0..geometry.slot_frames() * 3)
            .map(|frame| (frame % 30_000) as i16)
            .collect::<Vec<_>>();
        let fixture = TempWav::pcm16(1, 44_100, &samples);
        let parts =
            PcmWindow::create(geometry, 3, 17, DecodedMemoryOwner::ActiveWindow).expect("window");
        let mut session =
            PersistentStreamingSession::start_local(fixture.open(11), parts, config(44_100))
                .expect("start session");

        wait_until(Duration::from_secs(2), || {
            session.rt.producer().produced_end_frame >= 17 + geometry.slot_frames() as u64
        });
        let generation = session.producer.generation();
        let shared = crate::player::state::SharedState::new();
        shared
            .state
            .store(crate::player::state::PlayerState::Paused);
        let first_serial = session.producer.request_source_seek(4_000);
        let latest_serial = crate::player::audio_thread::request_persistent_source_seek(
            &session,
            8_000.0 / 44_100.0,
        );
        assert!(latest_serial > first_serial);
        assert_eq!(session.producer.generation(), generation);
        assert_eq!(
            shared.state.load(),
            crate::player::state::PlayerState::Paused
        );
        let deadline = Instant::now() + Duration::from_secs(2);
        while !{
            let identity = session.rt.identity();
            identity.epoch > 3
                && identity.active
                && session.rt.producer().produced_end_frame >= 8_000
        } {
            assert!(
                Instant::now() < deadline,
                "source seek timed out: identity={:?} producer={:?} window_epoch={} origin={}",
                session.rt.identity(),
                session.rt.producer(),
                session.window.epoch(),
                session.window.origin_frame(),
            );
            std::thread::yield_now();
        }
        assert_eq!(session.window.origin_frame(), 8_000);
        assert_eq!(session.producer.generation(), generation);
        assert_eq!(session.producer.applied_source_seek_serial(), latest_serial);
        let telemetry = session.rt.seek_telemetry();
        assert_eq!(telemetry.source_seek_requests, 1);
        assert!(telemetry.source_seek_applied >= 1);
        let epoch = session.rt.identity().epoch;
        let slot = session
            .reader
            .try_claim_frame(epoch, 8_000)
            .expect("claim exact source-seek target");
        let expected = f64::from(samples[8_000]) / 32_768.0;
        assert!((slot.samples()[0] - expected).abs() < 1.0e-9);
        slot.release();

        let near_eof_target = samples.len() as u64 - 10;
        let previous_epoch = epoch;
        let near_eof_serial = session.producer.request_source_seek(near_eof_target);
        wait_until(Duration::from_secs(2), || {
            let identity = session.rt.identity();
            session.producer.applied_source_seek_serial() >= near_eof_serial
                && identity.epoch > previous_epoch
                && identity.active
                && session.rt.producer().decode_state == StreamingDecodeState::EndOfStream
        });
        assert_eq!(session.window.origin_frame(), near_eof_target);
        assert_eq!(
            session.rt.producer().produced_end_frame,
            samples.len() as u64
        );
        let near_eof_epoch = session.rt.identity().epoch;
        let near_eof_slot = session
            .reader
            .try_claim_frame(near_eof_epoch, near_eof_target)
            .expect("claim near-EOF target");
        let expected_near_eof = f64::from(samples[near_eof_target as usize]) / 32_768.0;
        assert!((near_eof_slot.samples()[0] - expected_near_eof).abs() < 1.0e-9);
        assert_eq!(near_eof_slot.valid_frames(), 10);
        near_eof_slot.release();

        let PersistentStreamingSession { producer, .. } = session;
        let reaper = ProducerReaper::new().expect("start reaper");
        let reaper_handle = reaper.handle().expect("reaper handle");
        assert!(producer.retire(&reaper_handle).is_ok(), "submit producer");
        wait_until(Duration::from_secs(2), || reaper_handle.reaped_count() == 1);
        assert_eq!(reaper_handle.submitted_count(), 1);
    }

    #[test]
    fn backward_request_protects_reclaim_floor_until_applied() {
        let _guard = session_test_guard();
        let geometry = PcmWindowGeometry::for_slot_count(1, 4).expect("geometry");
        let parts = PcmWindow::create(geometry, 3, 1_000, DecodedMemoryOwner::ActiveWindow)
            .expect("window");
        let mut publisher = WindowSlotPublisher::new(parts.writer, 3, 1_000);
        let rt = StreamingRtView::new();
        rt.publish_producer(ProducerSnapshot {
            retained_start_frame: 1_000,
            produced_end_frame: 1_000 + geometry.slot_frames() as u64 * 12,
            decode_state: StreamingDecodeState::Ready,
        });
        rt.publish_render_cursor(1_000 + geometry.slot_frames() as u64 * 10);

        update_reclaim_boundary(&mut publisher, &rt, 1_000);
        assert_eq!(
            rt.producer().retained_start_frame,
            1_000 + geometry.slot_frames() as u64 * 8
        );

        let target = 1_000 + geometry.slot_frames() as u64 * 6;
        let serial = rt.request_seek(
            target,
            9,
            3,
            super::super::rt_view::WindowSeekKind::Backward,
        );
        update_reclaim_boundary(&mut publisher, &rt, 1_000);
        assert_eq!(rt.producer().retained_start_frame, target);
        for _ in 0..8 {
            rt.publish_render_cursor(1_000 + geometry.slot_frames() as u64 * 11);
            update_reclaim_boundary(&mut publisher, &rt, 1_000);
            assert_eq!(rt.producer().retained_start_frame, target);
        }

        rt.publish_applied_seek(super::super::rt_view::AppliedWindowSeek {
            serial,
            result: super::super::rt_view::WindowSeekResult::Applied,
            audible_frame: target,
            observed_generation: 9,
            observed_epoch: 3,
        });
        update_reclaim_boundary(&mut publisher, &rt, 1_000);
        assert_eq!(
            rt.producer().retained_start_frame,
            1_000 + geometry.slot_frames() as u64 * 9
        );
    }

    #[test]
    fn audio_thread_routes_only_resident_targets_to_window_mailbox() {
        let _guard = session_test_guard();
        let fixture = TempWav::pcm16(1, 44_100, &[0, 0, 0, 0]);
        let parts = PcmWindow::create(
            PcmWindowGeometry::for_slot_count(1, 1).expect("geometry"),
            3,
            0,
            DecodedMemoryOwner::ActiveWindow,
        )
        .expect("window");
        let session =
            PersistentStreamingSession::start_local(fixture.open(14), parts, config(44_100))
                .expect("start session");
        wait_until(Duration::from_secs(2), || {
            session.rt.producer().decode_state == StreamingDecodeState::EndOfStream
        });
        session.rt.publish_producer(ProducerSnapshot {
            retained_start_frame: 1_000,
            produced_end_frame: 5_000,
            decode_state: StreamingDecodeState::Ready,
        });
        let shared = crate::player::state::SharedState::new();
        shared
            .playback_clock
            .callback
            .position_frames
            .store(3_000, std::sync::atomic::Ordering::Release);

        assert!(crate::player::audio_thread::request_resident_window_seek(
            &shared,
            &session,
            4_000.0 / 44_100.0,
        )
        .is_some());
        assert_eq!(
            session.rt.seek_request().expect("forward request").kind,
            super::super::rt_view::WindowSeekKind::Forward
        );
        assert_eq!(session.rt.seek_telemetry().source_seek_requests, 0);
        assert_eq!(session.rt.seek_telemetry().source_seek_applied, 0);
        assert!(crate::player::audio_thread::request_resident_window_seek(
            &shared,
            &session,
            2_000.0 / 44_100.0,
        )
        .is_some());
        assert_eq!(
            session.rt.seek_request().expect("backward request").kind,
            super::super::rt_view::WindowSeekKind::Backward
        );
        assert!(crate::player::audio_thread::request_resident_window_seek(
            &shared,
            &session,
            999.0 / 44_100.0,
        )
        .is_none());
        assert!(crate::player::audio_thread::request_resident_window_seek(
            &shared,
            &session,
            5_000.0 / 44_100.0,
        )
        .is_none());
    }

    #[test]
    fn channel_mismatch_fails_before_worker_spawn() {
        let _guard = session_test_guard();
        let fixture = TempWav::pcm16(2, 44_100, &[0, 0, 0, 0]);
        let parts = PcmWindow::create(
            PcmWindowGeometry::for_slot_count(1, 1).expect("geometry"),
            3,
            17,
            DecodedMemoryOwner::ActiveWindow,
        )
        .expect("window");
        let error = PersistentStreamingSession::start_local(fixture.open(9), parts, config(44_100))
            .expect_err("reject mismatched channels");
        assert!(matches!(
            error,
            StreamingSessionError::ChannelMismatch {
                source_channels: 2,
                window_channels: 1
            }
        ));
    }
}

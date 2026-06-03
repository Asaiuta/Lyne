//! Player state management
//!
//! Contains shared state, commands, and device info.

use crate::processor::{DspChain, NoiseShaperCurve};
use arc_swap::{ArcSwap, ArcSwapOption};
use crossbeam::queue::ArrayQueue;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

// ============ Event Flag Constants (Task E) ============

pub const EVENT_LOAD_COMPLETE: u32 = 1 << 0;
pub const EVENT_LOAD_ERROR: u32 = 1 << 1;
pub const EVENT_TRACK_CHANGED: u32 = 1 << 2;
pub const EVENT_PLAYBACK_ENDED: u32 = 1 << 3;
pub const EVENT_NEEDS_PRELOAD: u32 = 1 << 4;
pub const EVENT_NEEDS_PRELOAD_RESET: u32 = 1 << 5;
pub const EVENT_QUEUE_UPDATED: u32 = 1 << 6;
pub const EVENT_TRACK_EOF: u32 = 1 << 7;
pub const EVENT_PLAYBACK_STARTED: u32 = 1 << 8;
pub const EVENT_PLAYBACK_PAUSED: u32 = 1 << 9;
pub const EVENT_PLAYBACK_STOPPED: u32 = 1 << 10;
pub const EVENT_PLAYBACK_SEEKED: u32 = 1 << 11;
pub const EVENT_PLAYBACK_HISTORY_UPDATED: u32 = 1 << 12;

pub const AUDIO_COMMAND_CODE_STOP: u64 = 1;
pub const AUDIO_COMMAND_CODE_STOP_FOR_LOAD: u64 = 2;
pub const AUDIO_COMMAND_CODE_STREAMING_LOAD_READY: u64 = 3;
pub const AUDIO_COMMAND_CODE_ENSURE_PLAYBACK_PROGRESS: u64 = 4;
pub(crate) const PLAYBACK_PROGRESS_AFTER_PLAY_GRACE_MS: u64 = 300;
pub(crate) const PLAYBACK_PROGRESS_REPLAY_GRACE_MS: u64 = 150;
pub(crate) const PLAYBACK_PROGRESS_REPLAY_COMMAND_GRACE_MS: u64 = 250;

// ============ Commands & State ============

pub(crate) fn playback_phase_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

/// Load result for async loading
#[derive(Debug, Clone)]
pub struct CachedLoudness {
    pub integrated_lufs: f64,
    pub true_peak_dbtp: f64,
    pub loudness_range: Option<f64>,
}

impl CachedLoudness {
    pub fn from_track(track: &crate::processor::TrackLoudness) -> Option<Self> {
        if !track.integrated_lufs.is_finite() {
            return None;
        }

        Some(Self {
            integrated_lufs: track.integrated_lufs,
            true_peak_dbtp: track.true_peak_dbtp,
            loudness_range: track.loudness_range,
        })
    }

    pub fn gain_for_target(&self, target_lufs: f64) -> Option<f64> {
        let gain = target_lufs - self.integrated_lufs;
        gain.is_finite().then_some(gain)
    }
}

#[derive(Debug, Clone)]
pub struct LoadResult {
    pub samples: Vec<f64>,
    pub sample_rate: u32,
    pub channels: usize,
    pub total_frames: u64,
    pub file_path: String,
    pub cached_loudness: Option<CachedLoudness>,
    /// Track metadata (title, artist, album, cover art)
    pub metadata: crate::decoder::TrackMetadata,
}

#[derive(Debug, Clone)]
pub struct StreamingTrackStart {
    pub sample_rate: u32,
    pub channels: usize,
    pub total_frames: u64,
    pub start_frame: u64,
    pub file_path: String,
    pub cached_loudness: Option<CachedLoudness>,
    pub metadata: crate::decoder::TrackMetadata,
    pub memory_mode: bool,
}

#[derive(Debug)]
pub struct StreamingAudioChunk {
    pub generation: u64,
    pub samples: Arc<Vec<f64>>,
}

/// A heap-backed resource retired by the realtime audio callback.
///
/// Dropping a large `Vec<f64>` or a `DspChain` frees heap memory, which can block
/// on the allocator — forbidden on the audio thread (see backend quality
/// guidelines). The callback hands these here via
/// [`SharedState::retire_audio_resource`] and the audio command loop drops them
/// off the realtime thread.
pub enum RetiredAudioResource {
    /// A decoded playback buffer swapped out (e.g. at a gapless track change).
    Buffer(Arc<Vec<f64>>),
    /// A DSP chain replaced on a format change.
    Chain(DspChain),
    /// A streaming chunk fully consumed (or discarded as stale) by the callback.
    Chunk(Arc<Vec<f64>>),
}

/// Commands sent to the audio thread
#[derive(Debug, Clone)]
pub enum AudioCommand {
    Play,
    Pause,
    Stop,
    StopForLoad,
    Shutdown,
    Seek(f64),
    EnsurePlaybackProgress {
        generation: u64,
        replay_attempted: bool,
    },
    SetExternalIrConvolver {
        ir_data: Vec<f64>,
        channels: usize,
    },
    ClearExternalIrConvolver,
    SetFirConvolver {
        ir_data: Vec<f64>,
        channels: usize,
    },
    ClearFirConvolver,
    SetNoiseShaperCurve {
        curve: NoiseShaperCurve,
    },
    SetTargetLufs(f64),
    RefreshLoadedLoudness,
    LoadComplete {
        generation: u64,
        result: LoadResult,
    },
    StreamingLoadReady {
        generation: u64,
        track: StreamingTrackStart,
        autoplay: bool,
    },
    StreamingLoadFinished {
        generation: u64,
        samples: Option<Vec<f64>>,
        total_frames: u64,
    },
    LoadError {
        generation: u64,
        message: String,
    },
}

/// Repeat behavior at the end of a track or queue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[repr(u8)]
pub enum RepeatMode {
    Off = 0,
    One = 1,
    All = 2,
}

impl RepeatMode {
    pub fn from_u8(value: u8) -> Self {
        match value {
            1 => RepeatMode::One,
            2 => RepeatMode::All,
            _ => RepeatMode::Off,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            RepeatMode::Off => "off",
            RepeatMode::One => "one",
            RepeatMode::All => "all",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.to_ascii_lowercase().as_str() {
            "off" => Some(RepeatMode::Off),
            "one" | "repeat_one" => Some(RepeatMode::One),
            "all" | "repeat_all" => Some(RepeatMode::All),
            _ => None,
        }
    }
}

/// Shuffle behavior for persistent queue ordering.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[repr(u8)]
pub enum ShuffleMode {
    Off = 0,
    On = 1,
    Heartbeat = 2,
}

impl ShuffleMode {
    pub fn from_u8(value: u8) -> Self {
        match value {
            1 => ShuffleMode::On,
            2 => ShuffleMode::Heartbeat,
            _ => ShuffleMode::Off,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            ShuffleMode::Off => "off",
            ShuffleMode::On => "on",
            ShuffleMode::Heartbeat => "heartbeat",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.to_ascii_lowercase().as_str() {
            "off" => Some(ShuffleMode::Off),
            "on" => Some(ShuffleMode::On),
            "heartbeat" => Some(ShuffleMode::Heartbeat),
            _ => None,
        }
    }
}

/// State of the audio player
#[derive(Debug, Clone, Copy, PartialEq)]
#[repr(u8)]
pub enum PlayerState {
    Stopped = 0,
    Playing = 1,
    Paused = 2,
}

impl PlayerState {
    /// Convert from u8 (for atomic storage)
    pub fn from_u8(val: u8) -> Self {
        match val {
            1 => PlayerState::Playing,
            2 => PlayerState::Paused,
            _ => PlayerState::Stopped,
        }
    }
}

/// Atomic wrapper for PlayerState (P0 fix: replaces RwLock<PlayerState>)
///
/// Using AtomicU8 ensures that the audio callback can always update state
/// without risk of lock contention. This prevents EVENT_PLAYBACK_ENDED from
/// being silently dropped when try_write() would have failed.
pub struct AtomicPlayerState {
    inner: AtomicU8,
}

impl AtomicPlayerState {
    pub fn new(state: PlayerState) -> Self {
        Self {
            inner: AtomicU8::new(state as u8),
        }
    }

    #[inline]
    pub fn load(&self) -> PlayerState {
        PlayerState::from_u8(self.inner.load(Ordering::Acquire))
    }

    #[inline]
    pub fn store(&self, state: PlayerState) {
        self.inner.store(state as u8, Ordering::Release);
    }

    /// Compare-and-swap: only update if current state matches expected.
    /// Returns true if the swap was successful.
    #[inline]
    pub fn compare_exchange(&self, expected: PlayerState, new: PlayerState) -> bool {
        self.inner
            .compare_exchange(
                expected as u8,
                new as u8,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }
}

/// Shared state between audio thread and main thread
pub struct SharedState {
    pub state: AtomicPlayerState,
    pub position_frames: AtomicU64,
    pub sample_rate: AtomicU64,
    pub channels: AtomicU64,
    pub total_frames: AtomicU64,
    pub spectrum_data: ArcSwap<Vec<f32>>,
    /// Audio sample buffer — lock-free via ArcSwap for realtime-safe reads
    /// from the audio callback. Writers (load, gapless swap) call .store()
    /// which is an atomic pointer swap; readers call .load() which never blocks.
    pub audio_buffer: ArcSwap<Vec<f64>>,
    pub streaming_chunks: ArrayQueue<StreamingAudioChunk>,
    pub streaming_active: AtomicBool,
    pub streaming_decode_finished: AtomicBool,
    pub streaming_memory_mode: AtomicBool,
    pub streaming_full_buffer_published: AtomicBool,
    pub streaming_generation: AtomicU64,
    pub streaming_first_chunk_ms: AtomicU64,
    pub streaming_ready_sent_ms: AtomicU64,
    pub streaming_ready_ms: AtomicU64,
    pub streaming_finished_ms: AtomicU64,
    pub exclusive_mode: AtomicBool,
    pub prefer_default_output_config: AtomicBool,
    pub device_id: std::sync::atomic::AtomicI64,
    pub volume: std::sync::atomic::AtomicU64,
    pub file_path: RwLock<Option<String>>,
    pub eq_type: RwLock<String>,
    pub noise_shaper_curve: RwLock<NoiseShaperCurve>,

    // Gapless playback fields
    /// Pending audio buffer for gapless transition — lock-free via ArcSwap.
    /// The preload thread stores the decoded next-track samples here;
    /// the audio callback atomically swaps it into audio_buffer at track boundary.
    pub pending_buffer: ArcSwapOption<Vec<f64>>,
    pub pending_total_frames: AtomicU64,
    pub pending_sample_rate: AtomicU64,
    pub pending_channels: AtomicU64,
    pub pending_file_path: RwLock<Option<String>>,
    pub needs_preload: AtomicBool,
    pub pending_ready: AtomicBool,
    pub dsp_reset_pending: AtomicBool,
    /// Signal to cancel ongoing preload thread (Defect 31 fix)
    pub cancel_preload_signal: AtomicBool,
    /// Pending target gain for next track (set during gapless preload, applied after buffer swap)
    /// Fixes Defect 22: Prevents premature gain update during gapless preload
    pub pending_target_gain_db: std::sync::atomic::AtomicU64, // Stored as bits of f64

    // Gapless: deferred metadata for main-thread pickup after track switch.
    // Audio callback sets gapless_swap_pending=true; main thread (WS pusher) reads these
    // and copies into file_path / track_metadata / current_track_path, then clears.
    pub gapless_swap_pending: AtomicBool,

    // Async loading state
    pub is_loading: AtomicBool,
    pub load_progress: AtomicU64, // Percentage (0-100)
    pub load_error: RwLock<Option<String>>,
    pub load_error_count: AtomicU64,
    pub last_decode_duration_ms: AtomicU64,
    pub last_decode_input_frames: AtomicU64,
    pub last_decode_output_samples: AtomicU64,
    pub last_decode_chunk_count: AtomicU64,
    pub last_decode_throughput_frames_per_sec: AtomicU64,
    pub load_request_started_ms: AtomicU64,
    pub load_request_returned_ms: AtomicU64,
    pub decode_started_ms: AtomicU64,
    pub decode_finished_ms: AtomicU64,
    pub loudness_started_ms: AtomicU64,
    pub loudness_finished_ms: AtomicU64,
    pub background_loudness_started_ms: AtomicU64,
    pub background_loudness_finished_ms: AtomicU64,
    pub background_loudness_applied_ms: AtomicU64,
    pub load_complete_applied_ms: AtomicU64,
    pub output_prepare_started_ms: AtomicU64,
    pub output_prepare_finished_ms: AtomicU64,
    pub stream_build_started_ms: AtomicU64,
    pub stream_build_finished_ms: AtomicU64,
    pub stream_play_returned_ms: AtomicU64,
    pub stream_play_generation: AtomicU64,
    pub streaming_ready_play_requested_ms: AtomicU64,
    pub streaming_ready_play_completed_ms: AtomicU64,
    pub streaming_ready_play_start_playback_ms: AtomicU64,
    pub streaming_ready_play_skipped_ms: AtomicU64,
    pub audio_command_stop_received_ms: AtomicU64,
    pub audio_command_stop_completed_ms: AtomicU64,
    pub audio_command_stop_for_load_received_ms: AtomicU64,
    pub audio_command_stop_for_load_completed_ms: AtomicU64,
    pub audio_command_streaming_ready_received_ms: AtomicU64,
    pub audio_command_streaming_ready_completed_ms: AtomicU64,
    pub audio_command_ensure_progress_received_ms: AtomicU64,
    pub audio_command_ensure_progress_completed_ms: AtomicU64,
    pub playback_recovery_requested_ms: AtomicU64,
    pub playback_recovery_count: AtomicU64,
    pub audio_command_received_count: AtomicU64,
    pub audio_command_completed_count: AtomicU64,
    pub audio_command_last_received_code: AtomicU64,
    pub audio_command_last_completed_code: AtomicU64,
    pub active_stream_source_sample_rate: AtomicU64,
    pub active_stream_output_sample_rate: AtomicU64,
    pub active_stream_channels: AtomicU64,
    pub active_stream_device_id: std::sync::atomic::AtomicI64,
    pub active_stream_exclusive_mode: AtomicBool,
    pub active_stream_prefer_default_output_config: AtomicBool,
    pub active_stream_running: AtomicBool,
    pub parked_output_stream_count: AtomicU64,
    pub parked_output_stream_release_count: AtomicU64,
    pub output_callback_activity_count: AtomicU64,
    pub output_callback_after_play_ms: AtomicU64,
    pub output_callback_silenced_inactive_count: AtomicU64,
    pub output_callback_silenced_loading_count: AtomicU64,
    pub output_callback_silenced_stream_mismatch_count: AtomicU64,
    pub first_callback_after_play_ms: AtomicU64,
    pub first_position_advanced_ms: AtomicU64,
    pub playback_progress_generation: AtomicU64,
    pub decode_budget_rejection_count: AtomicU64,
    pub audio_underrun_count: AtomicU64,
    pub audio_underrun_silence_frames: AtomicU64,
    pub ws_spectrum_event_count: AtomicU64,
    pub ws_position_event_count: AtomicU64,

    // WebSocket event flags — unified bitmask (Task E)
    // Writers: audio thread or async tasks use fetch_or(EVENT_*, Release)
    // Reader: WebSocket pusher uses swap(0, AcqRel) to atomically take all events
    pub event_flags: std::sync::atomic::AtomicU32,
    /// Monotonic EOF signal for backend supervisors. This is separate from
    /// event_flags because WebSocket handlers consume event_flags with swap().
    pub playback_end_count: AtomicU64,
    pub current_track_path: RwLock<Option<String>>, // Current track for notifications
    pub repeat_mode: AtomicU8,
    pub shuffle_mode: AtomicU8,

    // Track metadata
    pub track_metadata: RwLock<crate::decoder::TrackMetadata>,
    pub pending_metadata: RwLock<Option<crate::decoder::TrackMetadata>>,
    pub current_cached_loudness: RwLock<Option<CachedLoudness>>,
    pub pending_cached_loudness: RwLock<Option<CachedLoudness>>,
    /// Monotonic generation for explicit track loads. Async decode results must
    /// match this value before they are allowed to replace current playback.
    pub load_generation: AtomicU64,
    /// Monotonic generation for gapless preload jobs. Cancelling or starting a
    /// new preload invalidates older preload worker threads.
    pub preload_generation: AtomicU64,

    // Output format info (Defect 37 fix: for NoiseShaper bit depth)
    pub output_bits: std::sync::atomic::AtomicU32,

    // H-channel fix: signal callback to swap in a prebuilt DspChain when format changes
    pub dsp_needs_rebuild: AtomicBool,
    pub pending_dsp_chain: ArrayQueue<DspChain>,

    // Realtime drop offload: the audio callback pushes heap-backed resources here
    // (swapped-out buffers, replaced DSP chains, consumed streaming chunks) instead
    // of dropping them inline; the audio command loop drains and drops them off the
    // realtime thread. See `RetiredAudioResource`.
    pub retired_resources: ArrayQueue<RetiredAudioResource>,
    /// Diagnostics: times the graveyard was full and a resource had to be dropped
    /// on the realtime thread as a last resort.
    pub retired_resource_drop_in_rt_count: AtomicU64,
}

impl SharedState {
    pub fn new() -> Self {
        Self {
            state: AtomicPlayerState::new(PlayerState::Stopped),
            position_frames: AtomicU64::new(0),
            sample_rate: AtomicU64::new(44100),
            channels: AtomicU64::new(2),
            total_frames: AtomicU64::new(0),
            spectrum_data: ArcSwap::new(Arc::new(vec![0.0; 64])),
            audio_buffer: ArcSwap::new(Arc::new(Vec::new())),
            streaming_chunks: ArrayQueue::new(128),
            streaming_active: AtomicBool::new(false),
            streaming_decode_finished: AtomicBool::new(false),
            streaming_memory_mode: AtomicBool::new(false),
            streaming_full_buffer_published: AtomicBool::new(false),
            streaming_generation: AtomicU64::new(0),
            streaming_first_chunk_ms: AtomicU64::new(0),
            streaming_ready_sent_ms: AtomicU64::new(0),
            streaming_ready_ms: AtomicU64::new(0),
            streaming_finished_ms: AtomicU64::new(0),
            exclusive_mode: AtomicBool::new(false),
            prefer_default_output_config: AtomicBool::new(false),
            device_id: std::sync::atomic::AtomicI64::new(-1),
            volume: std::sync::atomic::AtomicU64::new(1_000_000),
            file_path: RwLock::new(None),
            eq_type: RwLock::new("IIR".to_string()),
            noise_shaper_curve: RwLock::new(NoiseShaperCurve::Lipshitz5),

            pending_buffer: ArcSwapOption::empty(),
            pending_total_frames: AtomicU64::new(0),
            pending_sample_rate: AtomicU64::new(44100),
            pending_channels: AtomicU64::new(2),
            pending_file_path: RwLock::new(None),
            needs_preload: AtomicBool::new(false),
            pending_ready: AtomicBool::new(false),
            dsp_reset_pending: AtomicBool::new(false),
            cancel_preload_signal: AtomicBool::new(false),
            pending_target_gain_db: std::sync::atomic::AtomicU64::new(0_f64.to_bits()),

            gapless_swap_pending: AtomicBool::new(false),

            is_loading: AtomicBool::new(false),
            load_progress: AtomicU64::new(0),
            load_error: RwLock::new(None),
            load_error_count: AtomicU64::new(0),
            last_decode_duration_ms: AtomicU64::new(0),
            last_decode_input_frames: AtomicU64::new(0),
            last_decode_output_samples: AtomicU64::new(0),
            last_decode_chunk_count: AtomicU64::new(0),
            last_decode_throughput_frames_per_sec: AtomicU64::new(0),
            load_request_started_ms: AtomicU64::new(0),
            load_request_returned_ms: AtomicU64::new(0),
            decode_started_ms: AtomicU64::new(0),
            decode_finished_ms: AtomicU64::new(0),
            loudness_started_ms: AtomicU64::new(0),
            loudness_finished_ms: AtomicU64::new(0),
            background_loudness_started_ms: AtomicU64::new(0),
            background_loudness_finished_ms: AtomicU64::new(0),
            background_loudness_applied_ms: AtomicU64::new(0),
            load_complete_applied_ms: AtomicU64::new(0),
            output_prepare_started_ms: AtomicU64::new(0),
            output_prepare_finished_ms: AtomicU64::new(0),
            stream_build_started_ms: AtomicU64::new(0),
            stream_build_finished_ms: AtomicU64::new(0),
            stream_play_returned_ms: AtomicU64::new(0),
            stream_play_generation: AtomicU64::new(0),
            streaming_ready_play_requested_ms: AtomicU64::new(0),
            streaming_ready_play_completed_ms: AtomicU64::new(0),
            streaming_ready_play_start_playback_ms: AtomicU64::new(0),
            streaming_ready_play_skipped_ms: AtomicU64::new(0),
            audio_command_stop_received_ms: AtomicU64::new(0),
            audio_command_stop_completed_ms: AtomicU64::new(0),
            audio_command_stop_for_load_received_ms: AtomicU64::new(0),
            audio_command_stop_for_load_completed_ms: AtomicU64::new(0),
            audio_command_streaming_ready_received_ms: AtomicU64::new(0),
            audio_command_streaming_ready_completed_ms: AtomicU64::new(0),
            audio_command_ensure_progress_received_ms: AtomicU64::new(0),
            audio_command_ensure_progress_completed_ms: AtomicU64::new(0),
            playback_recovery_requested_ms: AtomicU64::new(0),
            playback_recovery_count: AtomicU64::new(0),
            audio_command_received_count: AtomicU64::new(0),
            audio_command_completed_count: AtomicU64::new(0),
            audio_command_last_received_code: AtomicU64::new(0),
            audio_command_last_completed_code: AtomicU64::new(0),
            active_stream_source_sample_rate: AtomicU64::new(0),
            active_stream_output_sample_rate: AtomicU64::new(0),
            active_stream_channels: AtomicU64::new(0),
            active_stream_device_id: std::sync::atomic::AtomicI64::new(-1),
            active_stream_exclusive_mode: AtomicBool::new(false),
            active_stream_prefer_default_output_config: AtomicBool::new(false),
            active_stream_running: AtomicBool::new(false),
            parked_output_stream_count: AtomicU64::new(0),
            parked_output_stream_release_count: AtomicU64::new(0),
            output_callback_activity_count: AtomicU64::new(0),
            output_callback_after_play_ms: AtomicU64::new(0),
            output_callback_silenced_inactive_count: AtomicU64::new(0),
            output_callback_silenced_loading_count: AtomicU64::new(0),
            output_callback_silenced_stream_mismatch_count: AtomicU64::new(0),
            first_callback_after_play_ms: AtomicU64::new(0),
            first_position_advanced_ms: AtomicU64::new(0),
            playback_progress_generation: AtomicU64::new(0),
            decode_budget_rejection_count: AtomicU64::new(0),
            audio_underrun_count: AtomicU64::new(0),
            audio_underrun_silence_frames: AtomicU64::new(0),
            ws_spectrum_event_count: AtomicU64::new(0),
            ws_position_event_count: AtomicU64::new(0),

            event_flags: std::sync::atomic::AtomicU32::new(0),
            playback_end_count: AtomicU64::new(0),
            current_track_path: RwLock::new(None),
            repeat_mode: AtomicU8::new(RepeatMode::Off as u8),
            shuffle_mode: AtomicU8::new(ShuffleMode::Off as u8),

            track_metadata: RwLock::new(crate::decoder::TrackMetadata::default()),
            pending_metadata: RwLock::new(None),
            current_cached_loudness: RwLock::new(None),
            pending_cached_loudness: RwLock::new(None),
            load_generation: AtomicU64::new(0),
            preload_generation: AtomicU64::new(0),
            output_bits: std::sync::atomic::AtomicU32::new(24), // Default 24-bit
            dsp_needs_rebuild: AtomicBool::new(false),
            pending_dsp_chain: ArrayQueue::new(1),
            retired_resources: ArrayQueue::new(256),
            retired_resource_drop_in_rt_count: AtomicU64::new(0),
        }
    }

    /// Hand a heap-backed resource to the non-realtime drop queue.
    ///
    /// Safe to call from the audio callback: pushing is wait-free and never
    /// allocates. If the queue is momentarily full the resource is dropped in
    /// place as a last resort and counted via `retired_resource_drop_in_rt_count`.
    pub fn retire_audio_resource(&self, resource: RetiredAudioResource) {
        if self.retired_resources.push(resource).is_err() {
            // The rejected resource drops here (on the realtime thread) as the
            // `Err` payload of `push` goes out of scope — last-resort fallback.
            self.retired_resource_drop_in_rt_count
                .fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Drop every resource retired by the audio callback. Call only from a
    /// non-realtime thread (the audio command loop).
    pub fn drain_retired_audio_resources(&self) {
        while self.retired_resources.pop().is_some() {}
    }

    pub fn current_time_secs(&self) -> f64 {
        let pos = self.position_frames.load(Ordering::Relaxed);
        let sr = self.sample_rate.load(Ordering::Relaxed).max(1);
        pos as f64 / sr as f64
    }

    pub fn duration_secs(&self) -> f64 {
        let total = self.total_frames.load(Ordering::Relaxed);
        let sr = self.sample_rate.load(Ordering::Relaxed).max(1);
        total as f64 / sr as f64
    }

    pub fn reset_load_phase_timestamps(&self) {
        self.load_request_started_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
        self.load_request_returned_ms.store(0, Ordering::Relaxed);
        self.decode_started_ms.store(0, Ordering::Relaxed);
        self.decode_finished_ms.store(0, Ordering::Relaxed);
        self.loudness_started_ms.store(0, Ordering::Relaxed);
        self.loudness_finished_ms.store(0, Ordering::Relaxed);
        self.background_loudness_started_ms
            .store(0, Ordering::Relaxed);
        self.background_loudness_finished_ms
            .store(0, Ordering::Relaxed);
        self.background_loudness_applied_ms
            .store(0, Ordering::Relaxed);
        self.load_complete_applied_ms.store(0, Ordering::Relaxed);
        self.output_prepare_started_ms.store(0, Ordering::Relaxed);
        self.output_prepare_finished_ms.store(0, Ordering::Relaxed);
        self.stream_build_started_ms.store(0, Ordering::Relaxed);
        self.stream_build_finished_ms.store(0, Ordering::Relaxed);
        self.stream_play_returned_ms.store(0, Ordering::Relaxed);
        self.stream_play_generation.store(0, Ordering::Relaxed);
        self.streaming_ready_play_requested_ms
            .store(0, Ordering::Relaxed);
        self.streaming_ready_play_completed_ms
            .store(0, Ordering::Relaxed);
        self.streaming_ready_play_start_playback_ms
            .store(0, Ordering::Relaxed);
        self.streaming_ready_play_skipped_ms
            .store(0, Ordering::Relaxed);
        self.audio_command_ensure_progress_received_ms
            .store(0, Ordering::Relaxed);
        self.audio_command_ensure_progress_completed_ms
            .store(0, Ordering::Relaxed);
        self.playback_recovery_requested_ms
            .store(0, Ordering::Relaxed);
        self.first_callback_after_play_ms
            .store(0, Ordering::Relaxed);
        self.output_callback_after_play_ms
            .store(0, Ordering::Relaxed);
        self.first_position_advanced_ms.store(0, Ordering::Relaxed);
        self.streaming_first_chunk_ms.store(0, Ordering::Relaxed);
        self.streaming_ready_sent_ms.store(0, Ordering::Relaxed);
        self.streaming_ready_ms.store(0, Ordering::Relaxed);
        self.streaming_finished_ms.store(0, Ordering::Relaxed);
    }

    pub fn reset_streaming_state(&self) {
        self.streaming_active.store(false, Ordering::Release);
        self.streaming_decode_finished
            .store(false, Ordering::Release);
        self.streaming_memory_mode.store(false, Ordering::Release);
        self.streaming_full_buffer_published
            .store(false, Ordering::Release);
        while self.streaming_chunks.pop().is_some() {}
        self.streaming_first_chunk_ms.store(0, Ordering::Relaxed);
        self.streaming_ready_sent_ms.store(0, Ordering::Relaxed);
        self.streaming_ready_ms.store(0, Ordering::Relaxed);
        self.streaming_finished_ms.store(0, Ordering::Relaxed);
    }

    pub fn mark_load_request_returned(&self) {
        self.load_request_returned_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_decode_started(&self) {
        self.decode_started_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_decode_finished(&self) {
        self.decode_finished_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_streaming_first_chunk(&self) {
        let _ = self.streaming_first_chunk_ms.compare_exchange(
            0,
            playback_phase_time_ms(),
            Ordering::AcqRel,
            Ordering::Acquire,
        );
    }

    pub fn mark_streaming_ready_sent(&self) {
        self.streaming_ready_sent_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_streaming_ready(&self) {
        self.streaming_ready_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_streaming_finished(&self) {
        self.streaming_finished_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_loudness_started(&self) {
        self.loudness_started_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_loudness_finished(&self) {
        self.loudness_finished_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_background_loudness_started(&self) {
        self.background_loudness_started_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_background_loudness_finished(&self) {
        self.background_loudness_finished_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_background_loudness_applied(&self) {
        self.background_loudness_applied_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_load_complete_applied(&self) {
        self.load_complete_applied_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_output_prepare_started(&self) {
        self.output_prepare_started_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_output_prepare_finished(&self) {
        self.output_prepare_finished_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_stream_build_started(&self) {
        self.stream_build_started_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_stream_build_finished(&self) {
        self.stream_build_finished_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_stream_play_returned(&self) {
        self.first_callback_after_play_ms
            .store(0, Ordering::Relaxed);
        self.output_callback_after_play_ms
            .store(0, Ordering::Relaxed);
        self.first_position_advanced_ms.store(0, Ordering::Relaxed);
        self.stream_play_returned_ms
            .store(playback_phase_time_ms(), Ordering::Release);
        self.stream_play_generation.store(
            self.load_generation.load(Ordering::Acquire),
            Ordering::Release,
        );
    }

    pub fn mark_streaming_ready_play_requested(&self) {
        self.streaming_ready_play_requested_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_streaming_ready_play_completed(&self) {
        self.streaming_ready_play_completed_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_streaming_ready_play_start_playback(&self) {
        self.streaming_ready_play_start_playback_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_streaming_ready_play_skipped(&self) {
        self.streaming_ready_play_skipped_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    fn mark_audio_command_received(&self, code: u64) {
        self.audio_command_received_count
            .fetch_add(1, Ordering::Relaxed);
        self.audio_command_last_received_code
            .store(code, Ordering::Relaxed);
    }

    fn mark_audio_command_completed(&self, code: u64) {
        self.audio_command_completed_count
            .fetch_add(1, Ordering::Relaxed);
        self.audio_command_last_completed_code
            .store(code, Ordering::Relaxed);
    }

    pub fn mark_audio_command_stop_received(&self) {
        self.mark_audio_command_received(AUDIO_COMMAND_CODE_STOP);
        self.audio_command_stop_received_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_audio_command_stop_completed(&self) {
        self.mark_audio_command_completed(AUDIO_COMMAND_CODE_STOP);
        self.audio_command_stop_completed_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_audio_command_stop_for_load_received(&self) {
        self.mark_audio_command_received(AUDIO_COMMAND_CODE_STOP_FOR_LOAD);
        self.audio_command_stop_for_load_received_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_audio_command_stop_for_load_completed(&self) {
        self.mark_audio_command_completed(AUDIO_COMMAND_CODE_STOP_FOR_LOAD);
        self.audio_command_stop_for_load_completed_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_audio_command_streaming_ready_received(&self) {
        self.mark_audio_command_received(AUDIO_COMMAND_CODE_STREAMING_LOAD_READY);
        self.audio_command_streaming_ready_received_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_audio_command_streaming_ready_completed(&self) {
        self.mark_audio_command_completed(AUDIO_COMMAND_CODE_STREAMING_LOAD_READY);
        self.audio_command_streaming_ready_completed_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_audio_command_ensure_progress_received(&self) {
        self.mark_audio_command_received(AUDIO_COMMAND_CODE_ENSURE_PLAYBACK_PROGRESS);
        self.audio_command_ensure_progress_received_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_audio_command_ensure_progress_completed(&self) {
        self.mark_audio_command_completed(AUDIO_COMMAND_CODE_ENSURE_PLAYBACK_PROGRESS);
        self.audio_command_ensure_progress_completed_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_playback_recovery_requested(&self) {
        self.playback_recovery_count.fetch_add(1, Ordering::Relaxed);
        self.playback_recovery_requested_ms
            .store(playback_phase_time_ms(), Ordering::Relaxed);
    }

    pub fn mark_active_output_stream(
        &self,
        source_sample_rate: u32,
        output_sample_rate: u32,
        channels: usize,
    ) {
        self.active_stream_source_sample_rate
            .store(u64::from(source_sample_rate), Ordering::Release);
        self.active_stream_output_sample_rate
            .store(u64::from(output_sample_rate), Ordering::Release);
        self.active_stream_channels
            .store(channels as u64, Ordering::Release);
        self.active_stream_device_id
            .store(self.device_id.load(Ordering::Relaxed), Ordering::Release);
        self.active_stream_exclusive_mode.store(
            self.exclusive_mode.load(Ordering::Relaxed),
            Ordering::Release,
        );
        self.active_stream_prefer_default_output_config.store(
            self.prefer_default_output_config.load(Ordering::Relaxed),
            Ordering::Release,
        );
        self.active_stream_running.store(true, Ordering::Release);
    }

    pub fn clear_active_output_stream(&self) {
        self.active_stream_source_sample_rate
            .store(0, Ordering::Release);
        self.active_stream_output_sample_rate
            .store(0, Ordering::Release);
        self.active_stream_channels.store(0, Ordering::Release);
        self.active_stream_device_id.store(-1, Ordering::Release);
        self.active_stream_exclusive_mode
            .store(false, Ordering::Release);
        self.active_stream_prefer_default_output_config
            .store(false, Ordering::Release);
        self.active_stream_running.store(false, Ordering::Release);
    }

    pub fn set_parked_output_stream_count(&self, count: usize) {
        self.parked_output_stream_count
            .store(count as u64, Ordering::Release);
    }

    pub fn mark_parked_output_streams_released(&self, count: usize) {
        self.parked_output_stream_count.store(0, Ordering::Release);
        self.parked_output_stream_release_count
            .fetch_add(count as u64, Ordering::Relaxed);
    }

    pub fn mark_active_output_stream_running(&self) {
        self.active_stream_running.store(true, Ordering::Release);
    }

    pub fn mark_active_output_stream_paused(&self) {
        self.active_stream_running.store(false, Ordering::Release);
    }

    pub fn active_output_stream_matches_current(&self) -> bool {
        self.active_stream_source_sample_rate
            .load(Ordering::Acquire)
            == self.sample_rate.load(Ordering::Relaxed)
            && self.active_stream_channels.load(Ordering::Acquire)
                == self.channels.load(Ordering::Relaxed)
            && self.active_stream_device_id.load(Ordering::Acquire)
                == self.device_id.load(Ordering::Relaxed)
            && self.active_stream_exclusive_mode.load(Ordering::Acquire)
                == self.exclusive_mode.load(Ordering::Relaxed)
            && self
                .active_stream_prefer_default_output_config
                .load(Ordering::Acquire)
                == self.prefer_default_output_config.load(Ordering::Relaxed)
    }

    pub fn mark_output_callback_activity(&self) {
        self.output_callback_activity_count
            .fetch_add(1, Ordering::Relaxed);
        if !self.current_generation_stream_play_returned()
            || self.output_callback_after_play_ms.load(Ordering::Relaxed) != 0
        {
            return;
        }

        let _ = self.output_callback_after_play_ms.compare_exchange(
            0,
            playback_phase_time_ms(),
            Ordering::AcqRel,
            Ordering::Acquire,
        );
    }

    pub fn mark_output_callback_silenced_inactive(&self) {
        self.output_callback_silenced_inactive_count
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn mark_output_callback_silenced_loading(&self) {
        self.output_callback_silenced_loading_count
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn mark_output_callback_silenced_stream_mismatch(&self) {
        self.output_callback_silenced_stream_mismatch_count
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn output_callback_observed_after_current_play(&self) -> bool {
        self.current_generation_stream_play_returned()
            && self.output_callback_after_play_ms.load(Ordering::Acquire) != 0
    }

    pub fn mark_first_callback_after_play(&self) {
        if !self.current_generation_stream_play_returned()
            || self.first_callback_after_play_ms.load(Ordering::Relaxed) != 0
        {
            return;
        }

        let _ = self.first_callback_after_play_ms.compare_exchange(
            0,
            playback_phase_time_ms(),
            Ordering::AcqRel,
            Ordering::Acquire,
        );
        self.mark_playback_progress_generation();
    }

    pub fn mark_first_position_advanced_after_play(&self) {
        if !self.current_generation_stream_play_returned()
            || self.first_position_advanced_ms.load(Ordering::Relaxed) != 0
        {
            return;
        }

        let _ = self.first_position_advanced_ms.compare_exchange(
            0,
            playback_phase_time_ms(),
            Ordering::AcqRel,
            Ordering::Acquire,
        );
        self.mark_playback_progress_generation();
    }

    fn current_generation_stream_play_returned(&self) -> bool {
        let generation = self.load_generation.load(Ordering::Acquire);
        if generation == 0 {
            return false;
        }
        self.stream_play_generation.load(Ordering::Acquire) == generation
            && self.stream_play_returned_ms.load(Ordering::Acquire) != 0
    }

    fn mark_playback_progress_generation(&self) {
        let generation = self.load_generation.load(Ordering::Acquire);
        if generation == 0 {
            return;
        }
        if self.playback_progress_generation.load(Ordering::Relaxed) != generation {
            self.playback_progress_generation
                .store(generation, Ordering::Release);
        }
    }

    pub fn repeat_mode(&self) -> RepeatMode {
        RepeatMode::from_u8(self.repeat_mode.load(Ordering::Acquire))
    }

    pub fn set_repeat_mode(&self, mode: RepeatMode) {
        self.repeat_mode.store(mode as u8, Ordering::Release);
    }

    pub fn shuffle_mode(&self) -> ShuffleMode {
        ShuffleMode::from_u8(self.shuffle_mode.load(Ordering::Acquire))
    }

    pub fn set_shuffle_mode(&self, mode: ShuffleMode) {
        self.shuffle_mode.store(mode as u8, Ordering::Release);
    }
}

impl Default for SharedState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeat_mode_parses_and_round_trips_atomic_value() {
        assert_eq!(RepeatMode::parse("off"), Some(RepeatMode::Off));
        assert_eq!(RepeatMode::parse("one"), Some(RepeatMode::One));
        assert_eq!(RepeatMode::parse("all"), Some(RepeatMode::All));
        assert_eq!(RepeatMode::parse("bogus"), None);
        assert_eq!(RepeatMode::from_u8(99), RepeatMode::Off);
        assert_eq!(RepeatMode::All.as_str(), "all");

        let shared = SharedState::new();
        shared.set_repeat_mode(RepeatMode::One);
        assert_eq!(shared.repeat_mode(), RepeatMode::One);
    }

    #[test]
    fn shuffle_mode_parses_and_round_trips_atomic_value() {
        assert_eq!(ShuffleMode::parse("off"), Some(ShuffleMode::Off));
        assert_eq!(ShuffleMode::parse("on"), Some(ShuffleMode::On));
        assert_eq!(
            ShuffleMode::parse("heartbeat"),
            Some(ShuffleMode::Heartbeat)
        );
        assert_eq!(ShuffleMode::parse("bogus"), None);
        assert_eq!(ShuffleMode::from_u8(99), ShuffleMode::Off);
        assert_eq!(ShuffleMode::from_u8(2), ShuffleMode::Heartbeat);
        assert_eq!(ShuffleMode::On.as_str(), "on");
        assert_eq!(ShuffleMode::Heartbeat.as_str(), "heartbeat");

        let shared = SharedState::new();
        shared.set_shuffle_mode(ShuffleMode::Heartbeat);
        assert_eq!(shared.shuffle_mode(), ShuffleMode::Heartbeat);
    }

    #[test]
    fn load_phase_reset_clears_previous_timestamps() {
        let shared = SharedState::new();
        shared.mark_decode_started();
        shared.mark_output_prepare_started();
        shared.mark_streaming_first_chunk();
        shared.mark_stream_play_returned();
        shared.mark_audio_command_ensure_progress_received();
        shared.mark_audio_command_ensure_progress_completed();
        shared.mark_playback_recovery_requested();

        shared.reset_load_phase_timestamps();

        assert!(shared.load_request_started_ms.load(Ordering::Relaxed) > 0);
        assert_eq!(shared.decode_started_ms.load(Ordering::Relaxed), 0);
        assert_eq!(shared.output_prepare_started_ms.load(Ordering::Relaxed), 0);
        assert_eq!(shared.streaming_first_chunk_ms.load(Ordering::Relaxed), 0);
        assert_eq!(shared.stream_play_returned_ms.load(Ordering::Relaxed), 0);
        assert_eq!(
            shared.output_callback_after_play_ms.load(Ordering::Relaxed),
            0
        );
        assert_eq!(shared.first_position_advanced_ms.load(Ordering::Relaxed), 0);
        assert_eq!(
            shared
                .audio_command_ensure_progress_received_ms
                .load(Ordering::Relaxed),
            0
        );
        assert_eq!(
            shared
                .audio_command_ensure_progress_completed_ms
                .load(Ordering::Relaxed),
            0
        );
        assert_eq!(
            shared
                .playback_recovery_requested_ms
                .load(Ordering::Relaxed),
            0
        );
    }

    #[test]
    fn reset_streaming_state_drains_queue_and_clears_flags() {
        let shared = SharedState::new();
        shared.streaming_active.store(true, Ordering::Relaxed);
        shared
            .streaming_decode_finished
            .store(true, Ordering::Relaxed);
        shared.mark_streaming_first_chunk();
        shared.mark_streaming_ready();
        shared
            .streaming_chunks
            .push(StreamingAudioChunk {
                generation: 1,
                samples: Arc::new(vec![0.0; 4]),
            })
            .expect("queue should have capacity");

        shared.reset_streaming_state();

        assert!(!shared.streaming_active.load(Ordering::Relaxed));
        assert!(!shared.streaming_decode_finished.load(Ordering::Relaxed));
        assert!(shared.streaming_chunks.pop().is_none());
        assert_eq!(shared.streaming_first_chunk_ms.load(Ordering::Relaxed), 0);
        assert_eq!(shared.streaming_ready_ms.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn first_callback_phase_requires_stream_play_marker() {
        let shared = SharedState::new();
        shared.load_generation.store(3, Ordering::Release);
        shared.mark_first_callback_after_play();
        assert_eq!(
            shared.first_callback_after_play_ms.load(Ordering::Relaxed),
            0
        );

        shared.mark_stream_play_returned();
        shared.mark_first_callback_after_play();
        assert!(shared.first_callback_after_play_ms.load(Ordering::Relaxed) > 0);
    }

    #[test]
    fn output_callback_phase_records_callback_before_audio_gate() {
        let shared = SharedState::new();
        shared.load_generation.store(5, Ordering::Release);
        shared.mark_output_callback_activity();
        assert_eq!(
            shared.output_callback_after_play_ms.load(Ordering::Relaxed),
            0
        );
        assert_eq!(
            shared
                .output_callback_activity_count
                .load(Ordering::Relaxed),
            1
        );

        shared.mark_stream_play_returned();
        shared.mark_output_callback_activity();
        assert!(shared.output_callback_after_play_ms.load(Ordering::Relaxed) > 0);
        assert!(shared.output_callback_observed_after_current_play());

        shared.mark_stream_play_returned();
        assert_eq!(
            shared.output_callback_after_play_ms.load(Ordering::Relaxed),
            0
        );
        assert!(!shared.output_callback_observed_after_current_play());
    }

    #[test]
    fn playback_progress_generation_survives_later_play_marker_reset() {
        let shared = SharedState::new();
        shared.load_generation.store(7, Ordering::Release);
        shared.mark_stream_play_returned();
        shared.mark_first_position_advanced_after_play();

        assert_eq!(
            shared.playback_progress_generation.load(Ordering::Acquire),
            7
        );
        assert!(shared.first_position_advanced_ms.load(Ordering::Relaxed) > 0);

        shared.mark_stream_play_returned();

        assert_eq!(shared.first_position_advanced_ms.load(Ordering::Relaxed), 0);
        assert_eq!(
            shared.playback_progress_generation.load(Ordering::Acquire),
            7
        );
    }

    #[test]
    fn active_output_stream_key_tracks_runtime_format_and_mode() {
        let shared = SharedState::new();
        shared.sample_rate.store(44_100, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        shared.device_id.store(3, Ordering::Relaxed);
        shared.exclusive_mode.store(false, Ordering::Relaxed);
        shared
            .prefer_default_output_config
            .store(false, Ordering::Relaxed);

        shared.mark_active_output_stream(44_100, 44_100, 2);
        assert!(shared.active_output_stream_matches_current());

        shared.sample_rate.store(48_000, Ordering::Relaxed);
        assert!(!shared.active_output_stream_matches_current());

        shared.sample_rate.store(44_100, Ordering::Relaxed);
        shared
            .prefer_default_output_config
            .store(true, Ordering::Relaxed);
        assert!(!shared.active_output_stream_matches_current());

        shared
            .prefer_default_output_config
            .store(false, Ordering::Relaxed);
        shared.exclusive_mode.store(true, Ordering::Relaxed);
        assert!(!shared.active_output_stream_matches_current());

        shared.clear_active_output_stream();
        assert_eq!(
            shared
                .active_stream_source_sample_rate
                .load(Ordering::Acquire),
            0
        );
    }
}

/// Audio device info
#[derive(Debug, Clone, Serialize)]
pub struct AudioDeviceInfo {
    pub id: usize,
    pub name: String,
    pub is_default: bool,
    pub sample_rate: Option<u32>,
}

//! Player state management
//!
//! Contains shared state, commands, device info, and cache utilities.

use crate::config::{DEFAULT_CACHE_MAX_BYTES, ENV_AUDIO_CACHE_MAX_BYTES};
use crate::processor::{DspChain, NoiseShaperCurve};
use arc_swap::{ArcSwap, ArcSwapOption};
use crossbeam::queue::ArrayQueue;
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;

// ============ Cache System ============

const CACHE_MAGIC: &[u8; 4] = b"VCP1";
const CACHE_VERSION: u32 = 1;
const CACHE_HEADER_SIZE: usize = 32;
const CACHE_SAMPLE_BYTES: usize = std::mem::size_of::<f64>();
const CACHE_MIN_FILE_SIZE: usize = CACHE_HEADER_SIZE + CACHE_SAMPLE_BYTES;
pub fn configured_cache_max_bytes() -> u64 {
    std::env::var(ENV_AUDIO_CACHE_MAX_BYTES)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(DEFAULT_CACHE_MAX_BYTES)
}

/// Calculate CRC32 checksum for cache validation
fn calculate_checksum(data: &[f64]) -> u32 {
    let mut hasher = crc32fast::Hasher::new();
    for sample in data {
        hasher.update(&sample.to_bits().to_le_bytes());
    }
    hasher.finalize()
}

fn read_u32_from_bytes(bytes: &[u8], offset: usize) -> Option<u32> {
    let arr: [u8; 4] = bytes.get(offset..offset + 4)?.try_into().ok()?;
    Some(u32::from_le_bytes(arr))
}

fn read_u64_from_bytes(bytes: &[u8], offset: usize) -> Option<u64> {
    let arr: [u8; 8] = bytes.get(offset..offset + 8)?.try_into().ok()?;
    Some(u64::from_le_bytes(arr))
}

/// Save samples to cache with header validation
pub fn save_cache_with_header(
    path: &Path,
    samples: &[f64],
    sample_rate: u32,
    channels: u32,
) -> std::io::Result<()> {
    if channels == 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "cache channels must be greater than zero",
        ));
    }
    let channels_usize = channels as usize;
    if samples.len() % channels_usize != 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "sample count must be divisible by channel count",
        ));
    }

    let frame_count = (samples.len() / channels_usize) as u64;
    let checksum = calculate_checksum(samples);

    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let mut file = fs::File::create(path)?;

    // Write header explicitly (avoids unsafe transmute and padding issues)
    let mut header_bytes = [0u8; CACHE_HEADER_SIZE];
    header_bytes[0..4].copy_from_slice(CACHE_MAGIC);
    header_bytes[4..8].copy_from_slice(&CACHE_VERSION.to_le_bytes());
    header_bytes[8..12].copy_from_slice(&sample_rate.to_le_bytes());
    header_bytes[12..16].copy_from_slice(&channels.to_le_bytes());
    header_bytes[16..24].copy_from_slice(&frame_count.to_le_bytes());
    header_bytes[24..28].copy_from_slice(&checksum.to_le_bytes());
    // bytes 28..32 are reserved (already zero)
    file.write_all(&header_bytes)?;

    for sample in samples {
        file.write_all(&sample.to_le_bytes())?;
    }

    log::info!(
        "Saved {} samples to cache with header validation",
        samples.len()
    );
    Ok(())
}

/// Load samples from cache with header validation
///
/// FIX for Defect 34: Actually verify the CRC32 checksum instead of ignoring it.
/// FIX for Defect 6: Compute CRC32 incrementally while reading samples from file,
/// avoiding a separate full pass over potentially huge buffers (e.g., 1.8 GB for
/// 10 min 192kHz stereo). This eliminates the startup lag from the previous
/// two-pass approach (read all → checksum all).
pub fn load_cache_with_header(path: &Path, expected_sr: u32, expected_ch: u32) -> Option<Vec<f64>> {
    let mut file = fs::File::open(path).ok()?;
    let metadata = file.metadata().ok()?;
    let file_size = usize::try_from(metadata.len()).ok()?;

    if file_size < CACHE_MIN_FILE_SIZE {
        log::warn!("Cache file too small: {} bytes", file_size);
        return None;
    }

    let mut header_bytes = [0u8; CACHE_HEADER_SIZE];
    file.read_exact(&mut header_bytes).ok()?;

    let magic = &header_bytes[0..4];
    let version = read_u32_from_bytes(&header_bytes, 4)?;
    let sample_rate = read_u32_from_bytes(&header_bytes, 8)?;
    let channels = read_u32_from_bytes(&header_bytes, 12)?;
    let frame_count = read_u64_from_bytes(&header_bytes, 16)?;
    let stored_checksum = read_u32_from_bytes(&header_bytes, 24)?;

    if magic != CACHE_MAGIC {
        log::warn!("Invalid cache magic: {:?}", magic);
        return None;
    }

    if version != CACHE_VERSION {
        log::warn!("Cache version mismatch: {} != {}", version, CACHE_VERSION);
        return None;
    }

    if sample_rate != expected_sr {
        log::warn!(
            "Cache sample rate mismatch: {} != {}",
            sample_rate,
            expected_sr
        );
        return None;
    }

    if channels != expected_ch {
        log::warn!(
            "Cache channel count mismatch: {} != {}",
            channels,
            expected_ch
        );
        return None;
    }

    let (sample_count, expected_data_size) = match cache_data_layout(frame_count, channels) {
        Some(layout) => layout,
        None => {
            log::warn!(
                "Invalid cache layout: frame_count={}, channels={}",
                frame_count,
                channels
            );
            return None;
        }
    };
    let expected_file_size = match CACHE_HEADER_SIZE.checked_add(expected_data_size) {
        Some(size) => size,
        None => {
            log::warn!(
                "Invalid cache file size calculation: frame_count={}, channels={}",
                frame_count,
                channels
            );
            return None;
        }
    };
    if file_size != expected_file_size {
        log::warn!(
            "Cache file size mismatch: expected {}, got {}",
            expected_file_size,
            file_size
        );
        return None;
    }

    // FIX for Defect 6: Stream CRC32 computation while reading samples
    // in a single pass, instead of reading all then checksumming all.
    let mut samples = Vec::with_capacity(sample_count);
    let mut hasher = crc32fast::Hasher::new();
    let mut sample_bytes = [0u8; CACHE_SAMPLE_BYTES];

    for _ in 0..sample_count {
        if file.read_exact(&mut sample_bytes).is_err() {
            log::warn!("Failed to read all samples from cache");
            return None;
        }
        hasher.update(&sample_bytes);
        samples.push(f64::from_le_bytes(sample_bytes));
    }

    // Verify checksum computed during read
    let computed_checksum = hasher.finalize();
    if computed_checksum != stored_checksum {
        log::warn!(
            "Cache checksum mismatch: stored={}, computed={}. File may be corrupted.",
            stored_checksum,
            computed_checksum
        );
        return None;
    }

    log::info!(
        "Loaded {} samples from validated cache (streaming checksum verified)",
        samples.len()
    );
    Some(samples)
}

fn cache_data_layout(frame_count: u64, channels: u32) -> Option<(usize, usize)> {
    if channels == 0 {
        return None;
    }
    let frames = usize::try_from(frame_count).ok()?;
    let channel_count = usize::try_from(channels).ok()?;
    let sample_count = frames.checked_mul(channel_count)?;
    let data_size = sample_count.checked_mul(CACHE_SAMPLE_BYTES)?;
    Some((sample_count, data_size))
}

pub fn prune_cache_dir_to_limit(cache_dir: &Path, max_bytes: u64) -> Result<u64, String> {
    let mut entries = collect_cache_entries(cache_dir)?;
    let mut total_bytes = entries.iter().map(|entry| entry.size_bytes).sum::<u64>();
    if total_bytes <= max_bytes {
        return Ok(0);
    }

    entries.sort_by_key(|entry| entry.modified_epoch_secs);
    let mut removed = 0_u64;

    for entry in entries {
        if total_bytes <= max_bytes {
            break;
        }
        match fs::remove_file(&entry.path) {
            Ok(()) => {
                total_bytes = total_bytes.saturating_sub(entry.size_bytes);
                removed += 1;
            }
            Err(e) => {
                return Err(format!("Failed to remove old cache file: {}", e));
            }
        }
    }

    if removed > 0 {
        log::info!(
            "Pruned {} cache files to keep runtime cache under {} bytes",
            removed,
            max_bytes
        );
    }

    Ok(removed)
}

#[derive(Debug)]
struct CacheEntry {
    path: PathBuf,
    size_bytes: u64,
    modified_epoch_secs: u64,
}

fn collect_cache_entries(cache_dir: &Path) -> Result<Vec<CacheEntry>, String> {
    let read_dir = match fs::read_dir(cache_dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("Failed to read cache directory: {}", e)),
    };

    let mut entries = Vec::new();
    for entry in read_dir {
        let entry = entry.map_err(|e| format!("Failed to read cache directory entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("bin") {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to inspect cache file: {}", e))?;
        if !metadata.is_file() {
            continue;
        }
        let modified_epoch_secs = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        entries.push(CacheEntry {
            path,
            size_bytes: metadata.len(),
            modified_epoch_secs,
        });
    }

    Ok(entries)
}

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

// ============ Commands & State ============

/// Load result for async loading
#[derive(Debug, Clone)]
pub struct LoadResult {
    pub samples: Vec<f64>,
    pub sample_rate: u32,
    pub channels: usize,
    pub total_frames: u64,
    pub file_path: String,
    pub loudness_info: Option<crate::processor::LoudnessInfo>,
    /// Track metadata (title, artist, album, cover art)
    pub metadata: crate::decoder::TrackMetadata,
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
    SetExternalIrConvolver { ir_data: Vec<f64>, channels: usize },
    ClearExternalIrConvolver,
    SetFirConvolver { ir_data: Vec<f64>, channels: usize },
    ClearFirConvolver,
    SetNoiseShaperCurve { curve: NoiseShaperCurve },
    LoadComplete { generation: u64, result: LoadResult },
    LoadError { generation: u64, message: String },
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
}

impl ShuffleMode {
    pub fn from_u8(value: u8) -> Self {
        match value {
            1 => ShuffleMode::On,
            _ => ShuffleMode::Off,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            ShuffleMode::Off => "off",
            ShuffleMode::On => "on",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.to_ascii_lowercase().as_str() {
            "off" => Some(ShuffleMode::Off),
            "on" => Some(ShuffleMode::On),
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
    pub spectrum_data: Mutex<Vec<f32>>,
    /// Audio sample buffer — lock-free via ArcSwap for realtime-safe reads
    /// from the audio callback. Writers (load, gapless swap) call .store()
    /// which is an atomic pointer swap; readers call .load() which never blocks.
    pub audio_buffer: ArcSwap<Vec<f64>>,
    pub exclusive_mode: AtomicBool,
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
}

impl SharedState {
    pub fn new() -> Self {
        Self {
            state: AtomicPlayerState::new(PlayerState::Stopped),
            position_frames: AtomicU64::new(0),
            sample_rate: AtomicU64::new(44100),
            channels: AtomicU64::new(2),
            total_frames: AtomicU64::new(0),
            spectrum_data: Mutex::new(vec![0.0; 64]),
            audio_buffer: ArcSwap::new(Arc::new(Vec::new())),
            exclusive_mode: AtomicBool::new(false),
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
            load_generation: AtomicU64::new(0),
            preload_generation: AtomicU64::new(0),
            output_bits: std::sync::atomic::AtomicU32::new(24), // Default 24-bit
            dsp_needs_rebuild: AtomicBool::new(false),
            pending_dsp_chain: ArrayQueue::new(1),
        }
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
        assert_eq!(ShuffleMode::parse("bogus"), None);
        assert_eq!(ShuffleMode::from_u8(99), ShuffleMode::Off);
        assert_eq!(ShuffleMode::On.as_str(), "on");

        let shared = SharedState::new();
        shared.set_shuffle_mode(ShuffleMode::On);
        assert_eq!(shared.shuffle_mode(), ShuffleMode::On);
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

#[cfg(test)]
mod cache_policy_tests {
    use super::{
        load_cache_with_header, prune_cache_dir_to_limit, save_cache_with_header, CACHE_HEADER_SIZE,
        CACHE_MAGIC, CACHE_SAMPLE_BYTES, CACHE_VERSION,
    };
    use std::fs;
    use std::io::Write;

    #[test]
    fn prune_cache_dir_removes_old_bin_files_until_under_limit() {
        let cache_dir = std::env::temp_dir().join("audio_player_cache_policy");
        let _ = fs::remove_dir_all(&cache_dir);
        fs::create_dir_all(&cache_dir).unwrap();

        write_file(&cache_dir.join("old.bin"), 8);
        write_file(&cache_dir.join("new.bin"), 8);
        write_file(&cache_dir.join("keep.txt"), 8);

        let removed = prune_cache_dir_to_limit(&cache_dir, 8).unwrap();

        assert_eq!(removed, 1);
        assert_eq!(bin_cache_bytes(&cache_dir), 8);
        assert!(cache_dir.join("keep.txt").exists());

        let _ = fs::remove_dir_all(&cache_dir);
    }

    #[test]
    fn load_cache_rejects_overflowing_header_layout() {
        let cache_dir = std::env::temp_dir().join("audio_player_cache_overflow");
        let _ = fs::remove_dir_all(&cache_dir);
        fs::create_dir_all(&cache_dir).unwrap();
        let cache_path = cache_dir.join("corrupt.bin");

        let mut header_bytes = [0_u8; CACHE_HEADER_SIZE];
        header_bytes[0..4].copy_from_slice(CACHE_MAGIC);
        header_bytes[4..8].copy_from_slice(&CACHE_VERSION.to_le_bytes());
        header_bytes[8..12].copy_from_slice(&44_100_u32.to_le_bytes());
        header_bytes[12..16].copy_from_slice(&2_u32.to_le_bytes());
        header_bytes[16..24].copy_from_slice(&u64::MAX.to_le_bytes());

        let mut file = fs::File::create(&cache_path).unwrap();
        file.write_all(&header_bytes).unwrap();
        file.write_all(&[0_u8; CACHE_SAMPLE_BYTES]).unwrap();

        assert!(load_cache_with_header(&cache_path, 44_100, 2).is_none());

        let _ = fs::remove_dir_all(&cache_dir);
    }

    #[test]
    fn save_cache_rejects_invalid_channel_layouts() {
        let cache_dir = std::env::temp_dir().join("audio_player_cache_invalid_layout");
        let _ = fs::remove_dir_all(&cache_dir);
        fs::create_dir_all(&cache_dir).unwrap();
        let cache_path = cache_dir.join("invalid.bin");

        assert!(save_cache_with_header(&cache_path, &[0.0], 44_100, 0).is_err());
        assert!(save_cache_with_header(&cache_path, &[0.0], 44_100, 2).is_err());

        let _ = fs::remove_dir_all(&cache_dir);
    }

    fn write_file(path: &std::path::Path, len: usize) {
        let mut file = fs::File::create(path).unwrap();
        file.write_all(&vec![1_u8; len]).unwrap();
    }

    fn bin_cache_bytes(path: &std::path::Path) -> u64 {
        fs::read_dir(path)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("bin"))
            .map(|path| fs::metadata(path).unwrap().len())
            .sum()
    }
}

//! Library Root
//!
//! This module exposes the audio engine as a library for direct Rust integration
//! or communication with the JS frontend via the server module.

pub mod app_database;
pub mod config;
pub mod decoder;
pub mod migration;
pub mod pipeline;
pub mod player;
pub mod playlist;
pub mod processor;
pub mod runtime;
pub mod server;
pub mod settings;
#[cfg(windows)]
pub mod wasapi_output;
pub mod webdav;

// Re-exports for convenience
pub use config::{LoudnessConfig, NormalizationMode};
pub use decoder::StreamingDecoder;
pub use pipeline::AudioPipeline;
pub use player::{AudioDeviceInfo, AudioPlayer, PlayerState, SharedState};
pub use processor::{
    AtomicLoudnessState, DatabaseStats, Equalizer, FFTConvolver, GainRamp, LoudnessDatabase,
    LoudnessInfo, LoudnessMeter, LoudnessNormalizer, NoiseShaper, PeakLimiter, Resampler,
    SpectrumAnalyzer, StreamingResampler, TrackLoudness, TruePeakDetector, VolumeController,
    CURRENT_SCAN_VERSION,
};

/// Library version
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

// Note: Python bindings have been removed as the engine now communicates
// directly with the JS frontend via WebSocket/HTTP.

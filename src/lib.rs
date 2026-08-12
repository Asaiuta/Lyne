//! Library Root
//!
//! This module exposes the audio engine as a library for direct Rust integration
//! or communication with the JS frontend via the server module.

pub mod app_database;
pub mod audio_settings;
#[doc(hidden)]
pub mod bench_gate;
#[doc(hidden)]
pub mod bench_provenance;
pub mod config;
pub mod diagnostics;
pub mod metadata;
pub mod migration;
pub mod player;
pub mod playlist;
pub mod runtime;
pub mod server;
pub mod settings;
#[cfg(windows)]
pub mod wasapi_output;
pub mod webdav;

pub use audio_engine_core::{decoder, pipeline, processor};

// Re-exports for convenience
pub use config::{LoudnessConfig, NormalizationMode};
pub use decoder::StreamingDecoder;
pub use player::{AudioDeviceInfo, AudioPlayer, PlayerState, SharedState};
pub use processor::{
    analyze_automix, AtomicLoudnessState, AutomixAnalysis, AutomixAnalysisMode,
    AutomixAnalysisOptions, DatabaseStats, Equalizer, FFTConvolver, LoudnessDatabase, LoudnessInfo,
    LoudnessMeter, LoudnessNormalizer, NoiseShaper, PeakLimiter, Resampler, SpectrumAnalyzer,
    StreamingResampler, TrackLoudness, TruePeakDetector, CURRENT_SCAN_VERSION,
};

/// Library version
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

// Note: Python bindings have been removed as the engine now communicates
// directly with the JS frontend via WebSocket/HTTP.

//! Reusable audio-engine core.
//!
//! This crate owns app-agnostic decoder, DSP, and streaming pipeline building
//! blocks. The application/server crate layers playback control, persistence,
//! HTTP/WebSocket routes, and runtime directory handling on top.

pub mod config;
pub mod decoder;
pub mod diagnostics;
pub mod pipeline;
pub mod processor;
pub mod runtime;

pub use config::{LoudnessConfig, NormalizationMode};
pub use decoder::StreamingDecoder;
pub use pipeline::AudioPipeline;
pub use processor::{
    analyze_automix, AtomicLoudnessState, AutomixAnalysis, AutomixAnalysisMode,
    AutomixAnalysisOptions, DatabaseStats, Equalizer, FFTConvolver, GainRamp, LoudnessDatabase,
    LoudnessInfo, LoudnessMeter, LoudnessNormalizer, NoiseShaper, PeakLimiter, Resampler,
    SpectrumAnalyzer, StreamingResampler, TrackLoudness, TruePeakDetector, VolumeController,
    CURRENT_SCAN_VERSION,
};

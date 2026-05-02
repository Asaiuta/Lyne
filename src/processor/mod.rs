//! Audio Processor Module
//!
//! High-performance audio processing pipeline using Rayon for parallelization.
//! Restored SoX VHQ Resampler and High-Order Noise Shaping for f64 Hi-Fi path.
//!
//! # Modules
//!
//! ## Core Processors
//! - [`resampler`] - SoX VHQ polyphase resampling
//! - [`eq`] - 10-band parametric IIR equalizer
//! - [`dsp`] - Volume control and noise shaping
//! - [`spectrum`] - FFT spectrum analyzer
//! - [`convolver`] - FFT convolution for FIR filters
//! - [`loudness`] - EBU R128 loudness normalization
//! - [`dynamic_loudness`] - ISO 226 dynamic loudness compensation (Fletcher-Munson)
//! - [`saturation`] - Tube/tape saturation for analog warmth
//! - [`crossfeed`] - Bauer binaural crossfeed for headphones
//! - [`fir_eq`] - FIR EQ with linear/minimum phase options
//!
//! ## Unified Abstraction (Lock-Free Design)
//! - [`traits`] - AudioProcessor trait and ProcessResult enum
//! - [`lockfree_params`] - Lock-free parameter structures for thread-safe parameter passing
//! - [`adapters`] - Processor adapters implementing AudioProcessor trait
//! - [`dsp_chain`] - Composable DSP processing chain

mod convolver;
mod crossfeed;
mod dsp;
mod dynamic_loudness;
mod eq;
mod fir_eq;
mod loudness;
mod loudness_db;
mod resampler;
mod saturation;
mod spectrum;

// New unified abstraction modules
pub mod adapters;
pub mod dsp_chain;
pub mod lockfree_params;
pub mod traits;

// Re-export all public items for backward compatibility
pub use convolver::FFTConvolver;
pub use crossfeed::{Crossfeed, CrossfeedSettings};
pub use dsp::{db_to_linear, linear_to_db, NoiseShaper, NoiseShaperCurve, VolumeController};
pub use dynamic_loudness::{AtomicDynamicLoudnessState, DynamicLoudness, LOUDNESS_BANDS};
pub use eq::{BiquadSection, Equalizer};
pub use fir_eq::{FirEq, FirPhaseMode, STANDARD_BANDS};
pub use loudness::{
    AtomicLoudnessState, GainRamp, LoudnessInfo, LoudnessMeter, LoudnessNormalizer, PeakLimiter,
    TruePeakDetector,
};
pub use loudness_db::{
    DatabaseStats, LoudnessDatabase, TrackLoudness, CURRENT_SCAN_VERSION,
    DEFAULT_BROADCAST_TARGET_LUFS, DEFAULT_STREAMING_TARGET_LUFS,
};
pub use resampler::{Resampler, ResamplerError, StreamingResampler};
pub use saturation::{Saturation, SaturationSettings, SaturationType};
pub use spectrum::SpectrumAnalyzer;

// Re-export unified abstraction types
pub use adapters::{
    CrossfeedProcessor, DynamicLoudnessProcessor, EqProcessor, NoiseShaperProcessor,
    PassThroughProcessor, PeakLimiterProcessor, SaturationProcessor, VolumeProcessor,
};
pub use dsp_chain::{ChainStats, DspChain, DspChainBuilder, ProcessorStats};
pub use lockfree_params::{
    AtomicCrossfeedParams, AtomicDynamicLoudnessParams, AtomicDynamicLoudnessTelemetry,
    AtomicEqParams, AtomicNoiseShaperParams, AtomicPeakLimiterParams, AtomicSaturationParams,
    AtomicVolumeParams, CrossfeedParamsSnapshot, DynamicLoudnessParamsSnapshot, EqParamsSnapshot,
    NoiseShaperParamsSnapshot, PeakLimiterParamsSnapshot, SaturationParamsSnapshot,
    SaturationTypeValue, VolumeParamsSnapshot, EQ_BANDS,
};
pub use traits::{AudioProcessor, ChannelAware, LockfreeParams, ProcessResult, SampleRateAware};

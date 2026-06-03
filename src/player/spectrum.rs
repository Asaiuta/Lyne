//! Spectrum analysis thread
//!
//! Receives audio samples via channel and performs FFT analysis
//! for visualization purposes.

use crossbeam::channel::Receiver;
use std::sync::atomic::Ordering;

use super::state::SharedState;
use crate::processor::SpectrumAnalyzer;
use std::sync::Arc;

// Mono samples carried per callback batch. The audio callback copies an entire
// `SpectrumBatch` by value into the channel each invocation, so this is sized to the
// most one stereo callback produces (output is downmixed to mono) rather than to the
// full output buffer — keeping that per-callback copy small. The spectrum thread
// accumulates batches into its 2048-sample FFT window regardless of batch size.
pub const SPECTRUM_BATCH_CAPACITY: usize = 512;

#[derive(Clone)]
pub struct SpectrumBatch {
    samples: [f64; SPECTRUM_BATCH_CAPACITY],
    len: usize,
}

impl SpectrumBatch {
    pub fn new() -> Self {
        Self {
            samples: [0.0; SPECTRUM_BATCH_CAPACITY],
            len: 0,
        }
    }

    pub fn clear(&mut self) {
        self.len = 0;
    }

    pub fn push(&mut self, sample: f64) -> bool {
        if self.len >= SPECTRUM_BATCH_CAPACITY {
            return false;
        }

        self.samples[self.len] = sample;
        self.len += 1;
        true
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn as_slice(&self) -> &[f64] {
        &self.samples[..self.len]
    }
}

/// Spectrum analysis thread entry point
///
/// Receives mono samples from the audio callback, buffers them,
/// and performs FFT analysis at regular intervals. Results are
/// stored in SharedState for WebSocket transmission.
pub fn spectrum_thread_main(
    rx: Receiver<SpectrumBatch>,
    shared: Arc<SharedState>,
    mut analyzer: SpectrumAnalyzer,
) {
    let window_size = 2048;
    let mut buffer = Vec::with_capacity(window_size);

    loop {
        match rx.recv() {
            Ok(batch) => {
                let mut batch_samples = batch.as_slice();
                while !batch_samples.is_empty() {
                    let needed = window_size - buffer.len();
                    let take = needed.min(batch_samples.len());
                    buffer.extend_from_slice(&batch_samples[..take]);
                    batch_samples = &batch_samples[take..];

                    if buffer.len() < window_size {
                        continue;
                    }

                    let sr = shared.sample_rate.load(Ordering::Relaxed) as u32;
                    let spectrum_data = analyzer.analyze(&buffer, sr);
                    shared.spectrum_data.store(Arc::new(spectrum_data.to_vec()));
                    buffer.clear();
                }
            }
            Err(_) => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spectrum_batch_stops_at_fixed_capacity() {
        let mut batch = SpectrumBatch::new();
        for i in 0..SPECTRUM_BATCH_CAPACITY {
            assert!(batch.push(i as f64));
        }

        assert!(!batch.push(99.0));
        assert_eq!(batch.as_slice().len(), SPECTRUM_BATCH_CAPACITY);

        batch.clear();
        assert!(batch.is_empty());
    }
}

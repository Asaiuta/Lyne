//! Spectrum analysis thread
//!
//! Receives audio samples via channel and performs FFT analysis
//! for visualization purposes.

use crossbeam::channel::Receiver;
use std::sync::atomic::Ordering;

use super::state::SharedState;
use crate::processor::SpectrumAnalyzer;
use std::sync::Arc;

/// Spectrum analysis thread entry point
///
/// Receives mono samples from the audio callback, buffers them,
/// and performs FFT analysis at regular intervals. Results are
/// stored in SharedState for WebSocket transmission.
pub fn spectrum_thread_main(
    rx: Receiver<f64>,
    shared: Arc<SharedState>,
    mut analyzer: SpectrumAnalyzer,
) {
    let window_size = 2048;
    let mut buffer = Vec::with_capacity(window_size);

    loop {
        match rx.recv() {
            Ok(sample) => {
                buffer.push(sample);
                if buffer.len() >= window_size {
                    let sr = shared.sample_rate.load(Ordering::Relaxed) as u32;
                    let spectrum_data = analyzer.analyze(&buffer, sr);
                    let mut shared_spectrum = shared.spectrum_data.lock();
                    shared_spectrum.clear();
                    shared_spectrum.extend_from_slice(spectrum_data);
                    buffer.clear();
                }
            }
            Err(_) => break,
        }
    }
}

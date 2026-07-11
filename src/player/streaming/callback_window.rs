//! Allocation-free PCM-window rendering primitive for realtime callbacks.

use std::sync::Arc;

use super::pcm_window::{PcmWindow, PcmWindowAccessError, PcmWindowReader};
use super::rt_view::{StreamingRtView, WindowIdentitySnapshot};

#[derive(Default)]
pub(crate) struct CallbackWindowCache {
    generation: u64,
    epoch: u64,
    reader: Option<PcmWindowReader>,
}

impl CallbackWindowCache {
    pub(crate) fn refresh(
        &mut self,
        rt: &StreamingRtView,
        mut retire: impl FnMut(Arc<PcmWindow>),
    ) -> WindowIdentitySnapshot {
        let identity = rt.identity();
        if identity.generation != self.generation {
            if let Some(reader) = self.reader.take() {
                retire(reader.into_window());
            }
            self.reader = if identity.active {
                rt.load_window_after_generation_change()
                    .map(PcmWindowReader::from_window)
            } else {
                None
            };
            self.generation = identity.generation;
        }
        self.epoch = identity.epoch;
        identity
    }

    pub(crate) fn reader_mut(&mut self) -> Option<&mut PcmWindowReader> {
        self.reader.as_mut()
    }

    #[cfg(test)]
    fn generation(&self) -> u64 {
        self.generation
    }
}

#[derive(Debug)]
pub(crate) struct WindowRenderProgress {
    pub(crate) rendered_frames: usize,
    pub(crate) next_frame: u64,
    pub(crate) shortfall: Option<PcmWindowAccessError>,
}

pub(crate) fn render_window_frames(
    reader: &mut PcmWindowReader,
    epoch: u64,
    start_frame: u64,
    output: &mut [f64],
) -> WindowRenderProgress {
    let channels = reader.geometry().channels();
    if !output.len().is_multiple_of(channels) {
        return WindowRenderProgress {
            rendered_frames: 0,
            next_frame: start_frame,
            shortfall: Some(PcmWindowAccessError::IncompleteFrame {
                samples: output.len(),
                channels,
            }),
        };
    }

    let requested_frames = output.len() / channels;
    let mut rendered_frames = 0;
    let mut next_frame = start_frame;
    while rendered_frames < requested_frames {
        let slot = match reader.try_claim_frame(epoch, next_frame) {
            Ok(slot) => slot,
            Err(error) => {
                return WindowRenderProgress {
                    rendered_frames,
                    next_frame,
                    shortfall: Some(error),
                };
            }
        };
        let remaining = &mut output[rendered_frames * channels..];
        let copied_frames = slot
            .copy_frames(slot.requested_frame_offset(), remaining)
            .expect("claimed frame offset and aligned output are valid");
        slot.release();
        rendered_frames += copied_frames;
        next_frame = next_frame.saturating_add(copied_frames as u64);
    }

    WindowRenderProgress {
        rendered_frames,
        next_frame,
        shortfall: None,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use crate::player::streaming::pcm_window::{PcmWindow, PcmWindowGeometry};
    use crate::player::streaming::rt_view::WindowIdentitySnapshot;

    fn published_window(slot_count: usize) -> (PcmWindowReader, usize) {
        let geometry = PcmWindowGeometry::for_slot_count(2, slot_count).expect("geometry");
        let parts = PcmWindow::create(geometry, 5, 100).expect("window");
        let mut writer = parts.writer;
        for sequence in 0..slot_count as u64 {
            let mut slot = writer
                .try_claim_owned(5, sequence, sequence)
                .expect("claim write slot");
            let frame_base = sequence as usize * geometry.slot_frames();
            let mut samples = vec![0.0; geometry.slot_samples()];
            for (frame, pair) in samples.chunks_exact_mut(2).enumerate() {
                pair[0] = (frame_base + frame) as f64;
                pair[1] = -((frame_base + frame) as f64);
            }
            slot.append_interleaved(&samples).expect("append slot");
            slot.publish().expect("publish slot");
        }
        (parts.reader, geometry.slot_frames())
    }

    #[test]
    fn renders_exact_cross_slot_span_and_advances_absolute_cursor() {
        let (mut reader, slot_frames) = published_window(2);
        let start_offset = slot_frames - 2;
        let mut output = [0.0; 12];
        let progress = render_window_frames(&mut reader, 5, 100 + start_offset as u64, &mut output);

        assert_eq!(progress.rendered_frames, 6);
        assert_eq!(progress.next_frame, 100 + start_offset as u64 + 6);
        assert!(progress.shortfall.is_none());
        for (index, pair) in output.chunks_exact(2).enumerate() {
            let frame = (start_offset + index) as f64;
            assert_eq!(pair, [frame, -frame]);
        }
    }

    #[test]
    fn shortfall_keeps_unwritten_tail_and_reports_exact_cursor() {
        let (mut reader, slot_frames) = published_window(1);
        let mut output = [7.0; 8];
        let progress =
            render_window_frames(&mut reader, 5, 100 + slot_frames as u64 - 2, &mut output);

        assert_eq!(progress.rendered_frames, 2);
        assert_eq!(progress.next_frame, 100 + slot_frames as u64);
        assert!(progress.shortfall.is_some());
        assert_eq!(
            &output[..4],
            &[
                (slot_frames - 2) as f64,
                -((slot_frames - 2) as f64),
                (slot_frames - 1) as f64,
                -((slot_frames - 1) as f64)
            ]
        );
        assert_eq!(&output[4..], &[7.0; 4]);
    }

    #[test]
    fn consecutive_callbacks_can_continue_within_the_same_slot() {
        let (mut reader, _) = published_window(1);
        let mut first = [0.0; 8];
        let first_progress = render_window_frames(&mut reader, 5, 100, &mut first);
        assert_eq!(first_progress.rendered_frames, 4);

        let mut second = [0.0; 8];
        let second_progress =
            render_window_frames(&mut reader, 5, first_progress.next_frame, &mut second);
        assert_eq!(second_progress.rendered_frames, 4);
        assert_eq!(second_progress.next_frame, 108);
        assert_eq!(second, [4.0, -4.0, 5.0, -5.0, 6.0, -6.0, 7.0, -7.0]);
    }

    #[test]
    fn cache_clones_only_on_generation_change_and_retires_displaced_window() {
        let geometry = PcmWindowGeometry::for_slot_count(2, 1).expect("geometry");
        let first = PcmWindow::create(geometry, 1, 0).expect("first window");
        let second = PcmWindow::create(geometry, 2, 0).expect("second window");
        let rt = StreamingRtView::new();
        rt.install_window(Some(Arc::clone(&first.window)));
        rt.publish_identity(WindowIdentitySnapshot {
            generation: 1,
            epoch: 1,
            active: true,
        });
        let retired = AtomicUsize::new(0);
        let mut cache = CallbackWindowCache::default();

        cache.refresh(&rt, |_| {
            retired.fetch_add(1, Ordering::Relaxed);
        });
        let after_install = Arc::strong_count(&first.window);
        for _ in 0..32 {
            cache.refresh(&rt, |_| {
                retired.fetch_add(1, Ordering::Relaxed);
            });
        }
        assert_eq!(Arc::strong_count(&first.window), after_install);
        assert_eq!(retired.load(Ordering::Relaxed), 0);

        rt.install_window(Some(Arc::clone(&second.window)));
        rt.publish_identity(WindowIdentitySnapshot {
            generation: 2,
            epoch: 2,
            active: true,
        });
        cache.refresh(&rt, |_| {
            retired.fetch_add(1, Ordering::Relaxed);
        });

        assert_eq!(cache.generation(), 2);
        assert!(cache.reader_mut().is_some());
        assert_eq!(retired.load(Ordering::Relaxed), 1);
    }
}

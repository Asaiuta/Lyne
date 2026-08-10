#[test]
    fn v_gapless_swap_consumes_pending_rt_and_resets_position() {
        use crate::player::streaming::pcm_window::{PcmWindow, PcmWindowGeometry};
        use crate::player::streaming::rt_view::{
            ProducerSnapshot, StreamingDecodeState, WindowIdentitySnapshot,
        };

        let geometry = PcmWindowGeometry::for_slot_count(2, 1).expect("geometry");

        // Active session at EOF.
        let active_parts = PcmWindow::create(geometry, 1, 0).expect("active window");
        let mut active_writer = active_parts.writer;
        let mut active_slot = active_writer.try_claim_owned(1, 0, 0).expect("active claim");
        active_slot
            .append_interleaved(&vec![0.5; geometry.slot_samples()])
            .expect("append");
        active_slot.publish().expect("publish");
        let active_rt = Arc::new(StreamingRtView::new());
        active_rt.install_window(Some(active_parts.window));
        active_rt.publish_identity(WindowIdentitySnapshot {
            generation: 1,
            epoch: 1,
            active: true,
        });
        active_rt.publish_producer(ProducerSnapshot {
            retained_start_frame: 0,
            produced_end_frame: geometry.slot_frames() as u64,
            decode_state: StreamingDecodeState::EndOfStream,
        });

        // Pending preloaded session, Ready.
        let pending_parts = PcmWindow::create(geometry, 1, 0).expect("pending window");
        let mut pending_writer = pending_parts.writer;
        let mut pending_slot =
            pending_writer.try_claim_owned(1, 0, 0).expect("pending claim");
        pending_slot
            .append_interleaved(&vec![0.25; geometry.slot_samples()])
            .expect("pending append");
        pending_slot.publish().expect("pending publish");
        let pending_rt = Arc::new(StreamingRtView::new());
        pending_rt.install_window(Some(pending_parts.window));
        pending_rt.publish_identity(WindowIdentitySnapshot {
            generation: 1,
            epoch: 1,
            active: true,
        });
        pending_rt.publish_producer(ProducerSnapshot {
            retained_start_frame: 0,
            produced_end_frame: geometry.slot_frames() as u64,
            decode_state: StreamingDecodeState::Ready,
        });

        let shared = SharedState::new();
        shared.streaming_generation.store(1, Ordering::Release);
        shared.load_generation.store(1, Ordering::Release);
        shared.streaming_active.store(true, Ordering::Release);
        shared.streaming_v2_enabled.store(true, Ordering::Release);
        shared.publish_streaming_v2_rt(Some(Arc::clone(&active_rt)));
        shared.streaming_pending_v2_rt.store(Some(Arc::clone(&pending_rt)));
        shared.streaming_pending_ready.store(true, Ordering::Release);
        shared.streaming_pending_generation.store(1, Ordering::Release);
        shared.streaming_pending_total_frames.store(2_000, Ordering::Release);
        shared.streaming_pending_channels.store(2, Ordering::Release);
        shared.total_frames.store(500, Ordering::Release);
        shared
            .playback_clock
            .callback
            .position_frames
            .store(geometry.slot_frames() as u64, Ordering::Release);
        shared.state.store(PlayerState::Playing);

        let mut scratch = CallbackScratch::new(2);
        let mut chain = DspChain::with_capacity(0, 44_100.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        let mut current_pos = geometry.slot_frames();

        // EOF frame: swap fires, this callback is silent.
        let mut swap_frame = [1.0; 8];
        let written = render_streaming_audio_output(
            &mut swap_frame,
            &shared,
            &mut chain,
            &loudness,
            2,
            &mut None,
            &mut scratch,
            OutputPath::Direct,
            &mut current_pos,
            0,
        );
        assert_eq!(written, 8);
        assert_eq!(swap_frame, [0.0; 8]);
        assert!(shared.streaming_swap_requested.load(Ordering::Acquire));
        assert!(!shared.streaming_pending_ready.load(Ordering::Acquire));
        assert!(shared.streaming_pending_v2_rt.load_full().is_none());
        assert!(
            Arc::ptr_eq(
                shared.streaming_v2_rt.load_full().as_ref().unwrap(),
                &pending_rt
            ),
            "pending RT must be promoted to the active slot"
        );
        assert_eq!(shared.total_frames.load(Ordering::Acquire), 2_000);
        assert_eq!(
            shared
                .playback_clock
                .callback
                .position_frames
                .load(Ordering::Acquire),
            0
        );
        assert!(shared.gapless_swap_pending.load(Ordering::Acquire));

        // Next callback renders from the swapped-in pending window at frame 0.
        shared.streaming_swap_requested.store(false, Ordering::Release);
        let mut next_output = [0.0; 8];
        let mut next_pos = 0;
        let second_written = render_streaming_audio_output(
            &mut next_output,
            &shared,
            &mut chain,
            &loudness,
            2,
            &mut None,
            &mut scratch,
            OutputPath::Direct,
            &mut next_pos,
            0,
        );
        assert_eq!(second_written, 8);
        assert!(next_output.iter().all(|s| (*s - 0.25).abs() < 0.000_1));
        assert_eq!(next_pos, 4);
        assert!(shared.streaming_active.load(Ordering::Acquire));
    }

    #[test]
    fn v_gapless_swap_ignores_stale_pending_generation() {
        use crate::player::streaming::pcm_window::{PcmWindow, PcmWindowGeometry};
        use crate::player::streaming::rt_view::{
            ProducerSnapshot, StreamingDecodeState, WindowIdentitySnapshot,
        };

        let geometry = PcmWindowGeometry::for_slot_count(2, 1).expect("geometry");
        let active_parts = PcmWindow::create(geometry, 1, 0).expect("active window");
        let mut active_writer = active_parts.writer;
        let mut active_slot = active_writer.try_claim_owned(1, 0, 0).expect("active claim");
        active_slot
            .append_interleaved(&vec![0.5; geometry.slot_samples()])
            .expect("append");
        active_slot.publish().expect("publish");
        let active_rt = Arc::new(StreamingRtView::new());
        active_rt.install_window(Some(active_parts.window));
        active_rt.publish_identity(WindowIdentitySnapshot {
            generation: 1,
            epoch: 1,
            active: true,
        });
        active_rt.publish_producer(ProducerSnapshot {
            retained_start_frame: 0,
            produced_end_frame: geometry.slot_frames() as u64,
            decode_state: StreamingDecodeState::EndOfStream,
        });

        let pending_parts = PcmWindow::create(geometry, 2, 0).expect("pending window");
        let mut pending_writer = pending_parts.writer;
        let mut pending_slot =
            pending_writer.try_claim_owned(2, 0, 0).expect("pending claim");
        pending_slot
            .append_interleaved(&vec![0.25; geometry.slot_samples()])
            .expect("append");
        pending_slot.publish().expect("publish");
        let pending_rt = Arc::new(StreamingRtView::new());
        pending_rt.install_window(Some(pending_parts.window));
        pending_rt.publish_identity(WindowIdentitySnapshot {
            generation: 1,
            epoch: 1,
            active: true,
        });
        pending_rt.publish_producer(ProducerSnapshot {
            retained_start_frame: 0,
            produced_end_frame: geometry.slot_frames() as u64,
            decode_state: StreamingDecodeState::Ready,
        });

        let shared = SharedState::new();
        shared.streaming_generation.store(1, Ordering::Release);
        shared.load_generation.store(2, Ordering::Release); // track changed
        shared.streaming_v2_enabled.store(true, Ordering::Release);
        shared.publish_streaming_v2_rt(Some(Arc::clone(&active_rt)));
        shared.streaming_pending_v2_rt.store(Some(Arc::clone(&pending_rt)));
        shared.streaming_pending_ready.store(true, Ordering::Release);
        shared.streaming_pending_generation.store(1, Ordering::Release);
        shared.streaming_pending_total_frames.store(2_000, Ordering::Release);
        shared.streaming_pending_channels.store(2, Ordering::Release);
        shared
            .playback_clock
            .callback
            .position_frames
            .store(geometry.slot_frames() as u64, Ordering::Release);
        shared.state.store(PlayerState::Playing);

        let mut scratch = CallbackScratch::new(2);
        let mut chain = DspChain::with_capacity(0, 44_100.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        let mut current_pos = geometry.slot_frames();
        let mut output = [1.0; 8];
        let written = render_streaming_audio_output(
            &mut output,
            &shared,
            &mut chain,
            &loudness,
            2,
            &mut None,
            &mut scratch,
            OutputPath::Direct,
            &mut current_pos,
            0,
        );
        assert_eq!(written, 8);
        assert_eq!(output, [0.0; 8]);
        // Stale pending is reaped, never swapped in.
        assert!(!shared.streaming_swap_requested.load(Ordering::Acquire));
        assert!(shared.streaming_pending_v2_rt.load_full().is_none());
        assert!(
            !Arc::ptr_eq(
                shared.streaming_v2_rt.load_full().as_ref().unwrap(),
                &pending_rt
            )
        );
        assert_eq!(shared.state.load(Ordering::Acquire), PlayerState::Stopped);
    }
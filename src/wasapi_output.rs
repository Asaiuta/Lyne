//! WASAPI Exclusive Mode Audio Output
//!
//! This module provides true WASAPI exclusive mode playback on Windows.
//! When exclusive mode is enabled, the application gets direct, unmixed access
//! to the audio hardware, bypassing the Windows audio mixer.

#[cfg(windows)]
pub mod wasapi_exclusive {
    use crossbeam::channel::{bounded, Receiver, Sender};
    use parking_lot::RwLock;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::Arc;
    use std::thread::{self, JoinHandle};

    use crate::config::{PhaseResponse, ResampleQuality};
    use crate::processor::{AtomicNoiseShaperParams, NoiseShaperProcessor};
    use wasapi::{
        calculate_period_100ns, initialize_mta, DeviceEnumerator, Direction, SampleType,
        StreamMode, WaveFormat,
    };

    /// Commands for the WASAPI playback thread
    pub enum WasapiCommand {
        Play,
        Pause,
        Stop,
        Shutdown,
        Seek(u64), // Used purely for notifying the UI/logs if needed, actual seek is handled by `audio_callback`
    }

    /// State of WASAPI playback
    #[derive(Debug, Clone, Copy, PartialEq)]
    pub enum WasapiState {
        Stopped,
        Playing,
        Paused,
    }

    /// Shared state between WASAPI thread and main audio player
    pub struct WasapiSharedState {
        pub state: RwLock<WasapiState>,
        pub position_frames: AtomicU64,
        pub sample_rate: AtomicU64,
        pub channels: AtomicU64,
        pub total_frames: AtomicU64,
        pub is_active: AtomicBool,
    }

    impl WasapiSharedState {
        pub fn new() -> Self {
            Self {
                state: RwLock::new(WasapiState::Stopped),
                position_frames: AtomicU64::new(0),
                sample_rate: AtomicU64::new(44100),
                channels: AtomicU64::new(2),
                total_frames: AtomicU64::new(0),
                is_active: AtomicBool::new(false),
            }
        }
    }

    impl Default for WasapiSharedState {
        fn default() -> Self {
            Self::new()
        }
    }

    pub type DspCallback = Box<dyn FnMut(&mut [f32], usize) -> bool + Send>;

    #[inline]
    fn copy_f32_slice_to_le_bytes(src: &[f32], dst: &mut [u8]) {
        let byte_len = src.len() * std::mem::size_of::<f32>();
        debug_assert!(dst.len() >= byte_len);

        if cfg!(target_endian = "little") {
            // SAFETY: f32 is a plain 4-byte scalar, src is valid for byte_len
            // bytes, and Windows/WASAPI targets are little-endian. The resulting
            // byte slice is read-only and copied before src is mutated again.
            let src_bytes =
                unsafe { std::slice::from_raw_parts(src.as_ptr().cast::<u8>(), byte_len) };
            dst[..byte_len].copy_from_slice(src_bytes);
        } else {
            for (sample, out) in src.iter().zip(dst[..byte_len].chunks_exact_mut(4)) {
                out.copy_from_slice(&sample.to_le_bytes());
            }
        }
    }

    fn write_f32_samples_to_wasapi_bytes(
        src: &[f32],
        dst: &mut [u8],
        bits_per_sample: u16,
        is_float: bool,
    ) {
        if is_float && bits_per_sample == 32 {
            copy_f32_slice_to_le_bytes(src, dst);
        } else if bits_per_sample == 32 {
            for (i, sample) in src.iter().enumerate() {
                let sample_i32 =
                    (*sample as f64 * 2147483647.0).clamp(-2147483647.0, 2147483647.0) as i32;
                let bytes = sample_i32.to_le_bytes();
                let offset = i * 4;
                if offset + 4 <= dst.len() {
                    dst[offset..offset + 4].copy_from_slice(&bytes);
                }
            }
        } else if bits_per_sample == 24 {
            for (i, sample) in src.iter().enumerate() {
                let sample_i32 = (*sample as f64 * 8388607.0).clamp(-8388607.0, 8388607.0) as i32;
                let bytes = sample_i32.to_le_bytes();
                let offset = i * 3;
                if offset + 3 <= dst.len() {
                    dst[offset..offset + 3].copy_from_slice(&bytes[0..3]);
                }
            }
        } else if bits_per_sample == 16 {
            for (i, sample) in src.iter().enumerate() {
                let sample_i16 = (*sample as f64 * 32767.0).clamp(-32767.0, 32767.0) as i16;
                let bytes = sample_i16.to_le_bytes();
                let offset = i * 2;
                if offset + 2 <= dst.len() {
                    dst[offset..offset + 2].copy_from_slice(&bytes);
                }
            }
        }
    }

    const COMMON_WASAPI_SAMPLE_RATES: [usize; 6] = [192000, 176400, 96000, 88200, 48000, 44100];
    const MAX_WASAPI_SAMPLE_RATE_CANDIDATES: usize = COMMON_WASAPI_SAMPLE_RATES.len() + 1;

    fn build_candidate_sample_rates(
        requested_sample_rate: usize,
    ) -> ([usize; MAX_WASAPI_SAMPLE_RATE_CANDIDATES], usize) {
        let mut rates = [0usize; MAX_WASAPI_SAMPLE_RATE_CANDIDATES];
        let mut len = 0usize;

        rates[len] = requested_sample_rate;
        len += 1;

        for rate in COMMON_WASAPI_SAMPLE_RATES {
            if !rates[..len].contains(&rate) {
                rates[len] = rate;
                len += 1;
            }
        }

        (rates, len)
    }

    pub struct WasapiExclusivePlayer {
        shared_state: Arc<WasapiSharedState>,
        cmd_tx: Sender<WasapiCommand>,
        thread_handle: Option<JoinHandle<()>>,
        #[allow(dead_code)]
        device_id: Option<usize>,
    }

    impl WasapiExclusivePlayer {
        /// Create a new WASAPI exclusive mode player
        pub fn new(
            device_id: Option<usize>,
            sample_rate: u32,
            channels: usize,
            resample_quality: ResampleQuality,
            noise_shaper_params: Arc<AtomicNoiseShaperParams>,
            dsp_callback: DspCallback,
        ) -> Result<Self, String> {
            let shared_state = Arc::new(WasapiSharedState::new());
            shared_state
                .sample_rate
                .store(sample_rate as u64, Ordering::Relaxed);
            shared_state
                .channels
                .store(channels as u64, Ordering::Relaxed);

            let (cmd_tx, cmd_rx) = bounded(16);

            let state_clone = Arc::clone(&shared_state);
            let dev_id = device_id;

            let thread_handle = thread::Builder::new()
                .name("wasapi-exclusive".to_string())
                .spawn(move || {
                    wasapi_thread_main(
                        cmd_rx,
                        state_clone,
                        dev_id,
                        resample_quality,
                        noise_shaper_params,
                        dsp_callback,
                    );
                })
                .map_err(|e| format!("Failed to spawn WASAPI thread: {}", e))?;

            Ok(Self {
                shared_state,
                cmd_tx,
                thread_handle: Some(thread_handle),
                device_id,
            })
        }

        /// Get shared state reference
        pub fn shared_state(&self) -> Arc<WasapiSharedState> {
            Arc::clone(&self.shared_state)
        }

        /// Start playback
        pub fn play(&self) -> Result<(), String> {
            self.cmd_tx
                .send(WasapiCommand::Play)
                .map_err(|e| format!("Failed to send play command: {}", e))
        }

        /// Pause playback
        pub fn pause(&self) -> Result<(), String> {
            self.cmd_tx
                .send(WasapiCommand::Pause)
                .map_err(|e| format!("Failed to send pause command: {}", e))
        }

        /// Stop playback
        pub fn stop(&self) -> Result<(), String> {
            self.cmd_tx
                .send(WasapiCommand::Stop)
                .map_err(|e| format!("Failed to send stop command: {}", e))
        }

        /// Check if exclusive mode is active
        #[allow(dead_code)]
        pub fn is_active(&self) -> bool {
            self.shared_state.is_active.load(Ordering::Relaxed)
        }

        /// Get current playback state
        pub fn get_state(&self) -> WasapiState {
            *self.shared_state.state.read()
        }

        /// Seek to position
        #[allow(dead_code)]
        pub fn seek(&self, frame: u64) -> Result<(), String> {
            self.cmd_tx
                .send(WasapiCommand::Seek(frame))
                .map_err(|e| format!("Failed to send seek command: {}", e))
        }
    }

    impl Drop for WasapiExclusivePlayer {
        fn drop(&mut self) {
            let _ = self.cmd_tx.send(WasapiCommand::Shutdown);
            if let Some(handle) = self.thread_handle.take() {
                let _ = handle.join();
            }
        }
    }

    /// Main WASAPI playback thread
    fn wasapi_thread_main(
        cmd_rx: Receiver<WasapiCommand>,
        shared_state: Arc<WasapiSharedState>,
        device_id: Option<usize>,
        resample_quality: ResampleQuality,
        noise_shaper_params: Arc<AtomicNoiseShaperParams>,
        mut dsp_callback: DspCallback,
    ) {
        log::info!("WASAPI exclusive thread started");
        crate::runtime::audio_thread_init();

        // Initialize COM for this thread - returns HRESULT in wasapi 0.22
        let hr = initialize_mta();
        if hr.is_err() {
            log::error!("Failed to initialize MTA: {:?}", hr);
            return;
        }

        loop {
            match cmd_rx.recv() {
                Ok(WasapiCommand::Play) => {
                    log::info!("WASAPI: Received Play command");

                    // Get audio parameters
                    let sample_rate = shared_state.sample_rate.load(Ordering::Relaxed) as usize;
                    let channels = shared_state.channels.load(Ordering::Relaxed) as usize;

                    if channels == 0 {
                        log::error!("WASAPI: Invalid channel count");
                        continue;
                    }

                    // Start exclusive playback
                    match start_exclusive_playback(
                        &shared_state,
                        &cmd_rx,
                        sample_rate,
                        channels,
                        device_id,
                        resample_quality,
                        Arc::clone(&noise_shaper_params),
                        &mut dsp_callback,
                    ) {
                        Ok(()) => log::info!("WASAPI: Exclusive playback completed"),
                        Err(e) => log::error!("WASAPI: Playback error: {}", e),
                    }

                    shared_state.is_active.store(false, Ordering::Relaxed);
                    *shared_state.state.write() = WasapiState::Stopped;
                }
                Ok(WasapiCommand::Pause) => {
                    // Pause is handled inside the playback loop
                    log::debug!("WASAPI: Pause command received outside playback loop");
                }
                Ok(WasapiCommand::Stop) => {
                    log::info!("WASAPI: Stop command");
                    shared_state.position_frames.store(0, Ordering::Relaxed);
                    *shared_state.state.write() = WasapiState::Stopped;
                }
                Ok(WasapiCommand::Seek(frame)) => {
                    log::info!("WASAPI: Seek command to frame {}", frame);
                    let total = shared_state.total_frames.load(Ordering::Relaxed);
                    let new_pos = frame.min(total);
                    shared_state
                        .position_frames
                        .store(new_pos, Ordering::Relaxed);
                }
                Ok(WasapiCommand::Shutdown) | Err(_) => {
                    log::info!("WASAPI: Shutting down thread");
                    break;
                }
            }
        }
    }

    /// Start exclusive mode playback
    fn start_exclusive_playback(
        shared_state: &Arc<WasapiSharedState>,
        cmd_rx: &Receiver<WasapiCommand>,
        sample_rate: usize,
        channels: usize,
        device_id: Option<usize>,
        resample_quality: ResampleQuality,
        noise_shaper_params: Arc<AtomicNoiseShaperParams>,
        dsp_callback: &mut DspCallback,
    ) -> Result<(), String> {
        let enumerator = DeviceEnumerator::new()
            .map_err(|e| format!("Failed to create device enumerator: {:?}", e))?;

        // Select device by ID if specified, otherwise use default
        let device = match device_id {
            Some(id) => {
                // Get device collection and select by index
                let collection = enumerator
                    .get_device_collection(&Direction::Render)
                    .map_err(|e| format!("Failed to get device collection: {:?}", e))?;

                let count = collection
                    .get_nbr_devices()
                    .map_err(|e| format!("Failed to get device count: {:?}", e))?;

                if id >= count as usize {
                    return Err(format!(
                        "Device ID {} not found (only {} devices available)",
                        id, count
                    ));
                }

                collection
                    .get_device_at_index(id as u32)
                    .map_err(|e| format!("Failed to get device at index {}: {:?}", id, e))?
            }
            None => {
                // Use default device
                enumerator
                    .get_default_device(&Direction::Render)
                    .map_err(|e| format!("Failed to get default device: {:?}", e))?
            }
        };

        let device_name = device
            .get_friendlyname()
            .unwrap_or_else(|_| "Unknown".to_string());
        log::info!("WASAPI: Opening device '{}' in exclusive mode", device_name);

        let mut audio_client = device
            .get_iaudioclient()
            .map_err(|e| format!("Failed to get audio client: {:?}", e))?;

        // Sample rates to try, in order of preference (highest quality first).
        // Start with the requested rate, then fall back to common high-quality rates.
        let (candidate_sample_rates, candidate_sample_rate_count) =
            build_candidate_sample_rates(sample_rate);

        // Try to find a supported format across all sample rates
        let mut desired_format: Option<WaveFormat> = None;
        let mut actual_sample_rate = sample_rate;

        'outer: for &try_rate in &candidate_sample_rates[..candidate_sample_rate_count] {
            // Need to get a fresh audio client for each rate attempt
            if try_rate != sample_rate {
                audio_client = device
                    .get_iaudioclient()
                    .map_err(|e| format!("Failed to get audio client: {:?}", e))?;
            }

            // Try different formats - 32-bit float preferred, then 24-bit, then 16-bit
            let formats_to_try = [
                WaveFormat::new(32, 32, &SampleType::Float, try_rate, channels, None),
                WaveFormat::new(24, 24, &SampleType::Int, try_rate, channels, None),
                WaveFormat::new(16, 16, &SampleType::Int, try_rate, channels, None),
            ];

            for format in &formats_to_try {
                match audio_client.is_supported_exclusive_with_quirks(format) {
                    Ok(fmt) => {
                        log::info!("WASAPI: Format supported at {} Hz: {:?}", try_rate, fmt);
                        desired_format = Some(fmt);
                        actual_sample_rate = try_rate;
                        break 'outer;
                    }
                    Err(e) => {
                        log::debug!("WASAPI: Format not supported at {} Hz: {:?}", try_rate, e);
                    }
                }
            }
        }

        let desired_format = desired_format
            .ok_or_else(|| "No supported exclusive format found at any sample rate".to_string())?;

        // Initialize resampler if actual format is different from source
        let mut resampler = if actual_sample_rate != sample_rate {
            use crate::processor::StreamingResampler;
            log::info!(
                "WASAPI: Intrinsic streaming resampling {} -> {} Hz",
                sample_rate,
                actual_sample_rate
            );
            match StreamingResampler::with_quality(
                channels,
                sample_rate as u32,
                actual_sample_rate as u32,
                PhaseResponse::Linear,
                resample_quality,
            ) {
                Ok(r) => Some(r),
                Err(e) => {
                    log::error!("WASAPI: Failed to create StreamingResampler: {:?}", e);
                    None
                }
            }
        } else {
            None
        };

        let blockalign = desired_format.get_blockalign();
        let bits_per_sample = desired_format.get_bitspersample();
        // Check subformat - returns Result, so unwrap with default
        let is_float = desired_format
            .get_subformat()
            .map(|st| st == SampleType::Float)
            .unwrap_or(false);

        // Store actual output bit depth for NoiseShaper (Defect 37 fix)
        // Note: We need to pass this to AudioPlayer, but this thread doesn't have direct access.
        // The caller (audio_thread) should check this and update NoiseShaper.

        log::info!(
            "WASAPI: Using format: {} Hz, {} ch, {}-bit {}, blockalign={}",
            actual_sample_rate,
            channels,
            bits_per_sample,
            if is_float { "float" } else { "int" },
            blockalign
        );
        let mut final_noise_shaper =
            NoiseShaperProcessor::new(channels, actual_sample_rate as u32, noise_shaper_params);

        // Get device period
        let (_def_period, min_period) = audio_client
            .get_device_period()
            .map_err(|e| format!("Failed to get device period: {:?}", e))?;

        // Calculate aligned period
        // Fix for 96kHz+ popping: Don't use minimum latency.
        // Use at least 10ms (100,000 units) buffer or double the min period.
        let safe_period = std::cmp::max(100_000, 2 * min_period);
        log::info!(
            "WASAPI: Min period {}, requesting safe period {}",
            min_period,
            safe_period
        );

        let desired_period = audio_client
            .calculate_aligned_period_near(safe_period, Some(128), &desired_format)
            .map_err(|e| format!("Failed to calculate period: {:?}", e))?;

        log::info!("WASAPI: Using period {} (100ns units)", desired_period);

        // Initialize in exclusive event mode
        let mode = StreamMode::EventsExclusive {
            period_hns: desired_period,
        };

        // Try to initialize, handling buffer alignment errors
        let init_result =
            audio_client.initialize_client(&desired_format, &Direction::Render, &mode);

        if let Err(ref e) = init_result {
            // Check for buffer alignment error
            let err_str = format!("{:?}", e);
            if err_str.contains("BUFFER_SIZE_NOT_ALIGNED") {
                log::warn!("WASAPI: Buffer not aligned, adjusting...");

                let buffersize = audio_client
                    .get_buffer_size()
                    .map_err(|e| format!("Failed to get buffer size: {:?}", e))?;

                let aligned_period =
                    calculate_period_100ns(buffersize as i64, actual_sample_rate as i64);

                // Get new client and reinitialize
                audio_client = device
                    .get_iaudioclient()
                    .map_err(|e| format!("Failed to get new audio client: {:?}", e))?;

                let aligned_mode = StreamMode::EventsExclusive {
                    period_hns: aligned_period,
                };

                audio_client
                    .initialize_client(&desired_format, &Direction::Render, &aligned_mode)
                    .map_err(|e| format!("Failed to initialize after alignment: {:?}", e))?;
            } else {
                return Err(format!("Failed to initialize: {:?}", e));
            }
        }

        // Get event handle and render client
        let h_event = audio_client
            .set_get_eventhandle()
            .map_err(|e| format!("Failed to get event handle: {:?}", e))?;

        let render_client = audio_client
            .get_audiorenderclient()
            .map_err(|e| format!("Failed to get render client: {:?}", e))?;

        // Mark as active and start stream
        shared_state.is_active.store(true, Ordering::Relaxed);
        *shared_state.state.write() = WasapiState::Playing;

        audio_client
            .start_stream()
            .map_err(|e| format!("Failed to start stream: {:?}", e))?;

        log::info!("WASAPI: Exclusive stream started!");

        // Playback loop
        let mut paused = false;
        let mut resample_leftover: Vec<f32> = Vec::with_capacity(16384 * channels);
        let mut resample_leftover_pos = 0usize;
        let mut resample_output_f64: Vec<f64> = Vec::with_capacity(8192 * channels);
        let mut resample_scratch: Vec<f64> = Vec::with_capacity(16384 * channels);

        // P1-9 fix: Pre-allocate buffers used in the hot loop to avoid per-frame heap allocation
        let max_buffer_frames = 8192; // Typical max buffer size
        let mut output_f32_buffer: Vec<f32> = vec![0.0; max_buffer_frames * channels];
        let mut byte_buffer: Vec<u8> = vec![0u8; max_buffer_frames * blockalign as usize];
        let mut temp_f32_buffer: Vec<f32> = vec![0.0; 4096 * channels]; // For resampler input

        loop {
            // Check for commands (non-blocking)
            if let Ok(cmd) = cmd_rx.try_recv() {
                match cmd {
                    WasapiCommand::Pause => {
                        if !paused {
                            let _ = audio_client.stop_stream();
                            *shared_state.state.write() = WasapiState::Paused;
                            paused = true;
                            log::info!("WASAPI: Paused");
                        }
                        continue;
                    }
                    WasapiCommand::Play => {
                        if paused {
                            let _ = audio_client.start_stream();
                            *shared_state.state.write() = WasapiState::Playing;
                            paused = false;
                            log::info!("WASAPI: Resumed");
                        }
                        continue;
                    }
                    WasapiCommand::Seek(frame) => {
                        log::info!("WASAPI: Seek to frame {}", frame);

                        // Clear out our internal left-over resampling buffer so we don't play stale audio
                        resample_leftover.clear();
                        resample_leftover_pos = 0;

                        // Flush hardware buffer: stop -> start
                        // This effectively clears the buffer by letting the old data play out
                        // while the position has been updated
                        let _ = audio_client.stop_stream();
                        // Small delay to ensure buffer is cleared
                        std::thread::sleep(std::time::Duration::from_millis(1));
                        let _ = audio_client.start_stream();
                        log::debug!("WASAPI: Stream restarted after seek");
                        continue;
                    }
                    WasapiCommand::Stop | WasapiCommand::Shutdown => {
                        log::info!("WASAPI: Stopping playback");
                        let _ = audio_client.stop_stream();
                        break;
                    }
                }
            }

            if paused {
                std::thread::sleep(std::time::Duration::from_millis(10));
                continue;
            }

            // Get available buffer space
            let buffer_frame_count = match audio_client.get_available_space_in_frames() {
                Ok(count) => count,
                Err(e) => {
                    log::error!("WASAPI: Failed to get buffer space: {:?}", e);
                    break;
                }
            };

            if buffer_frame_count == 0 {
                // Wait for event
                if h_event.wait_for_event(1000).is_err() {
                    log::warn!("WASAPI: Event wait timeout");
                    continue;
                }
                continue;
            }

            let frames_to_write = buffer_frame_count as usize;
            let samples_to_write = frames_to_write * channels;

            // P1-9 fix: Resize pre-allocated buffers if needed (only grows, never shrinks)
            if output_f32_buffer.len() < samples_to_write {
                output_f32_buffer.resize(samples_to_write, 0.0);
            }
            output_f32_buffer[..samples_to_write].fill(0.0);
            let mut is_eof = false;

            if let Some(ref mut rs) = resampler {
                let mut samples_written = 0;
                while samples_written < samples_to_write {
                    if resample_leftover_pos < resample_leftover.len() {
                        let available = resample_leftover.len() - resample_leftover_pos;
                        let take = available.min(samples_to_write - samples_written);
                        let start = resample_leftover_pos;
                        let end = start + take;
                        output_f32_buffer[samples_written..samples_written + take]
                            .copy_from_slice(&resample_leftover[start..end]);
                        resample_leftover_pos += take;
                        if resample_leftover_pos >= resample_leftover.len() {
                            resample_leftover.clear();
                            resample_leftover_pos = 0;
                        }
                        samples_written += take;
                    }

                    if samples_written == samples_to_write {
                        break;
                    }

                    let output_frames_remaining = (samples_to_write - samples_written) / channels;
                    let source_frames_to_request = rs
                        .input_frames_for_output_frames(output_frames_remaining)
                        .max(256)
                        .min(8192);
                    // P1-9 fix: Reuse pre-allocated temp buffer instead of allocating per iteration
                    let temp_samples = source_frames_to_request * channels;
                    if temp_f32_buffer.len() < temp_samples {
                        temp_f32_buffer.resize(temp_samples, 0.0);
                    }
                    temp_f32_buffer[..temp_samples].fill(0.0);
                    let chunk_eof = dsp_callback(&mut temp_f32_buffer[..temp_samples], channels);
                    if chunk_eof {
                        is_eof = true;
                    }

                    // P1-9 fix: Convert f32 -> f64 using pre-allocated buffer
                    if resample_output_f64.len() < temp_samples {
                        resample_output_f64.resize(temp_samples, 0.0);
                    }
                    for (dst, src) in resample_output_f64[..temp_samples]
                        .iter_mut()
                        .zip(temp_f32_buffer[..temp_samples].iter())
                    {
                        *dst = *src as f64;
                    }
                    let temp_f64 = &resample_output_f64[..temp_samples];

                    let resampled = rs.process_chunk_borrowed(temp_f64);
                    let new_samples = resampled.samples.len();
                    if resample_leftover_pos >= resample_leftover.len() {
                        resample_leftover.clear();
                        resample_leftover_pos = 0;
                    }
                    let append_start = resample_leftover.len();
                    resample_leftover.resize(append_start + new_samples, 0.0);
                    for (dst, src) in resample_leftover[append_start..]
                        .iter_mut()
                        .zip(resampled.samples.iter())
                    {
                        *dst = *src as f32;
                    }

                    if is_eof && new_samples == 0 {
                        break;
                    }
                }
            } else {
                // P1-9 fix: Only pass the exact number of samples needed, not the full pre-allocated buffer
                is_eof = dsp_callback(&mut output_f32_buffer[..samples_to_write], channels);
            }

            if is_eof
                && output_f32_buffer[..samples_to_write]
                    .iter()
                    .all(|&x| x == 0.0)
            {
                log::info!("WASAPI: Playback complete (EOF)");
                let _ = audio_client.stop_stream();
                break;
            }

            apply_final_noise_shaper_to_f32(
                &mut final_noise_shaper,
                &mut output_f32_buffer[..samples_to_write],
                channels,
                &mut resample_scratch,
            );

            let actual_frames = frames_to_write;

            // P1-9 fix: Reuse pre-allocated byte buffer
            let data_len = actual_frames * blockalign as usize;
            if byte_buffer.len() < data_len {
                byte_buffer.resize(data_len, 0);
            }
            byte_buffer[..data_len].fill(0);
            let data = &mut byte_buffer[..data_len];

            // P1-9 fix: Only convert the actual samples needed (samples_to_write),
            // not the entire pre-allocated buffer.
            write_f32_samples_to_wasapi_bytes(
                &output_f32_buffer[..samples_to_write],
                data,
                bits_per_sample,
                is_float,
            );

            // Write to device
            if let Err(e) = render_client.write_to_device(actual_frames, data, None) {
                log::error!("WASAPI: Failed to write to device: {:?}", e);
                break;
            }

            // Wait for next buffer request
            if h_event.wait_for_event(1000).is_err() {
                log::warn!("WASAPI: Event wait timeout after write");
            }
        }

        shared_state.is_active.store(false, Ordering::Relaxed);
        Ok(())
    }

    fn apply_final_noise_shaper_to_f32(
        final_noise_shaper: &mut NoiseShaperProcessor,
        output: &mut [f32],
        channels: usize,
        scratch: &mut Vec<f64>,
    ) {
        if output.is_empty() || !final_noise_shaper.refresh_is_enabled() {
            return;
        }

        let sample_count = output.len();
        if scratch.len() < sample_count {
            scratch.resize(sample_count, 0.0);
        }
        for (dst, src) in scratch[..sample_count].iter_mut().zip(output.iter()) {
            *dst = *src as f64;
        }
        final_noise_shaper.process_cached(&mut scratch[..sample_count], channels);
        for (dst, src) in output.iter_mut().zip(scratch[..sample_count].iter()) {
            *dst = *src as f32;
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn candidate_sample_rates_keep_requested_first_and_deduplicate() {
            let (rates, len) = build_candidate_sample_rates(48000);

            assert_eq!(&rates[..len], &[48000, 192000, 176400, 96000, 88200, 44100]);
        }

        #[test]
        fn candidate_sample_rates_include_non_common_requested_rate() {
            let (rates, len) = build_candidate_sample_rates(384000);

            assert_eq!(
                &rates[..len],
                &[384000, 192000, 176400, 96000, 88200, 48000, 44100]
            );
        }

        #[test]
        fn write_output_samples_uses_bulk_32_float_bytes() {
            let samples = [0.0f32, 0.5, -1.0, 1.0];
            let mut bytes = vec![0u8; samples.len() * 4];

            write_f32_samples_to_wasapi_bytes(&samples, &mut bytes, 32, true);

            let expected = samples
                .iter()
                .flat_map(|sample| sample.to_le_bytes())
                .collect::<Vec<_>>();
            assert_eq!(bytes, expected);
        }

        #[test]
        fn write_output_samples_supports_32_bit_integer() {
            let samples = [0.0f32, 1.0, -1.0, 0.5];
            let mut bytes = vec![0u8; samples.len() * 4];

            write_f32_samples_to_wasapi_bytes(&samples, &mut bytes, 32, false);

            let expected_values = [0i32, 2147483647, -2147483647, 1073741823];
            let expected = expected_values
                .iter()
                .flat_map(|sample| sample.to_le_bytes())
                .collect::<Vec<_>>();
            assert_eq!(bytes, expected);
        }

        #[test]
        fn write_output_samples_preserves_24_bit_integer_layout() {
            let samples = [0.0f32, 1.0, -1.0, 0.5];
            let mut bytes = vec![0u8; samples.len() * 3];

            write_f32_samples_to_wasapi_bytes(&samples, &mut bytes, 24, false);

            let expected_values = [0i32, 8388607, -8388607, 4194303];
            let expected = expected_values
                .iter()
                .flat_map(|sample| sample.to_le_bytes()[0..3].to_vec())
                .collect::<Vec<_>>();
            assert_eq!(bytes, expected);
        }

        #[test]
        fn write_output_samples_preserves_16_bit_integer_layout() {
            let samples = [0.0f32, 1.0, -1.0, 0.5];
            let mut bytes = vec![0u8; samples.len() * 2];

            write_f32_samples_to_wasapi_bytes(&samples, &mut bytes, 16, false);

            let expected_values = [0i16, 32767, -32767, 16383];
            let expected = expected_values
                .iter()
                .flat_map(|sample| sample.to_le_bytes())
                .collect::<Vec<_>>();
            assert_eq!(bytes, expected);
        }

        #[test]
        fn final_noise_shaper_disabled_leaves_output_and_scratch_untouched() {
            let params = Arc::new(AtomicNoiseShaperParams::new());
            params.set_enabled(false);
            let mut processor = NoiseShaperProcessor::new(2, 48_000, params);
            let mut output = vec![0.1f32, -0.2, 0.3, -0.4];
            let expected = output.clone();
            let mut scratch = Vec::new();

            apply_final_noise_shaper_to_f32(&mut processor, &mut output, 2, &mut scratch);

            assert_eq!(output, expected);
            assert_eq!(scratch.len(), 0);
        }

        #[test]
        fn final_noise_shaper_enabled_uses_scratch_and_updates_output() {
            let params = Arc::new(AtomicNoiseShaperParams::new());
            params.set_enabled(true);
            params.set_curve(crate::processor::NoiseShaperCurve::TpdfOnly);
            let mut processor = NoiseShaperProcessor::new(2, 48_000, params);
            let mut output = vec![0.1f32, -0.2, 0.3, -0.4];
            let original = output.clone();
            let mut scratch = Vec::new();

            apply_final_noise_shaper_to_f32(&mut processor, &mut output, 2, &mut scratch);

            assert_eq!(scratch.len(), original.len());
            assert_ne!(output, original);
        }
    }
}

// Re-export for convenience
#[cfg(windows)]
pub use wasapi_exclusive::*;

// Stub for non-Windows platforms
#[cfg(not(windows))]
pub mod wasapi_exclusive {
    pub type DspCallback = Box<dyn FnMut(&mut [f32], usize) -> bool + Send>;

    #[derive(Debug, Clone, Copy, PartialEq)]
    pub enum WasapiState {
        Stopped,
        Playing,
        Paused,
    }

    pub struct WasapiExclusivePlayer;

    impl WasapiExclusivePlayer {
        pub fn new(
            _device_id: Option<usize>,
            _sample_rate: u32,
            _channels: usize,
            _resample_quality: crate::config::ResampleQuality,
            _noise_shaper_params: std::sync::Arc<crate::processor::AtomicNoiseShaperParams>,
            _dsp_callback: DspCallback,
        ) -> Result<Self, String> {
            Err("WASAPI is only available on Windows".to_string())
        }

        pub fn get_state(&self) -> WasapiState {
            WasapiState::Stopped
        }
    }
}

#[cfg(not(windows))]
pub use wasapi_exclusive::WasapiState;

use super::*;
use actix_web::http::header;
use actix_web::{web, HttpRequest, HttpResponse};
use actix_ws::{self, Message};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::oneshot;
use tokio::time::interval;

use super::auth::{bearer_header, constant_time_eq, query_token};
use crate::player::{
    EVENT_LOAD_COMPLETE, EVENT_NEEDS_PRELOAD_RESET, EVENT_PLAYBACK_ENDED,
    EVENT_PLAYBACK_HISTORY_UPDATED, EVENT_PLAYBACK_PAUSED, EVENT_PLAYBACK_SEEKED,
    EVENT_PLAYBACK_STARTED, EVENT_PLAYBACK_STOPPED, EVENT_QUEUE_UPDATED, EVENT_TRACK_CHANGED,
};

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/ws", web::get().to(websocket));
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// Validate the per-run bearer token presented during a WebSocket upgrade.
///
/// Browsers cannot attach `Authorization` headers to WebSocket handshakes, so we
/// accept any of:
/// 1. `Authorization: Bearer <token>` (programmatic / non-browser clients)
/// 2. `Sec-WebSocket-Protocol: bearer.<token>` (browser-friendly subprotocol)
/// 3. `?token=<token>` query parameter (last-resort fallback)
///
/// Returns the matched subprotocol entry (so the server can echo it back) when
/// authentication came from `Sec-WebSocket-Protocol`, or `None` otherwise.
fn authenticate_ws(req: &HttpRequest, expected: &str) -> Result<Option<String>, ()> {
    if let Some(provided) = bearer_header(req.headers().get(header::AUTHORIZATION)) {
        if constant_time_eq(provided.as_bytes(), expected.as_bytes()) {
            return Ok(None);
        }
    }
    if let Some(protocols) = req
        .headers()
        .get(header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|h| h.to_str().ok())
    {
        for entry in protocols.split(',') {
            let trimmed = entry.trim();
            if let Some(provided) = trimmed.strip_prefix("bearer.") {
                if constant_time_eq(provided.as_bytes(), expected.as_bytes()) {
                    return Ok(Some(trimmed.to_string()));
                }
            }
        }
    }
    if let Some(provided) = query_token(req.uri().query()) {
        if constant_time_eq(provided.as_bytes(), expected.as_bytes()) {
            return Ok(None);
        }
    }
    Err(())
}

async fn websocket(
    req: HttpRequest,
    stream: web::Payload,
    data: web::Data<Arc<AppState>>,
) -> Result<HttpResponse, actix_web::Error> {
    let expected_token = Arc::clone(&data.api_token);
    let chosen_protocol = match authenticate_ws(&req, &expected_token) {
        Ok(protocol) => protocol,
        Err(_) => {
            log::warn!("WebSocket upgrade rejected: missing or invalid bearer token");
            return Ok(unauthorized_response("unauthorized"));
        }
    };

    let (mut response, mut session, mut msg_stream) = actix_ws::handle(&req, stream)?;

    // Echo the negotiated subprotocol so the browser handshake completes.
    if let Some(protocol) = chosen_protocol {
        if let Ok(value) = actix_web::http::header::HeaderValue::from_str(&protocol) {
            response
                .headers_mut()
                .insert(header::SEC_WEBSOCKET_PROTOCOL, value);
        }
    }

    let shared_state = {
        let player = data.player.lock();
        player.shared_state()
    };

    let (close_tx, mut close_rx) = oneshot::channel::<()>();

    let mut session_for_recv = session.clone();
    actix_rt::spawn(async move {
        while let Some(Ok(msg)) = msg_stream.recv().await {
            match msg {
                Message::Close(_) => {
                    let _ = session_for_recv.close(None).await;
                    let _ = close_tx.send(());
                    return;
                }
                Message::Ping(bytes) => {
                    let _ = session_for_recv.pong(&bytes).await;
                }
                Message::Text(_) | Message::Binary(_) => {}
                _ => {}
            }
        }
    });

    actix_rt::spawn(async move {
        let mut timer = interval(Duration::from_millis(50));
        let mut last_spectrum: Vec<f32> = Vec::new();
        let mut idle_ticks: u32 = 0;
        let mut last_load_progress: u64 = 0;
        let mut last_preload_sent = false;
        let mut position_ticks: u32 = 0;

        loop {
            tokio::select! {
                _ = &mut close_rx => {
                    break;
                }
                _ = timer.tick() => {
                    let is_playing = matches!(
                        shared_state.state.load(),
                        crate::player::PlayerState::Playing
                    );

                    let is_loading = shared_state.is_loading.load(std::sync::atomic::Ordering::Acquire);
                    if is_loading {
                        let progress = shared_state.load_progress.load(std::sync::atomic::Ordering::Relaxed);
                        if progress != last_load_progress {
                            last_load_progress = progress;
                            let msg = serde_json::json!({
                                "type": "loading_progress",
                                "progress": progress,
                            });
                            if session.text(msg.to_string()).await.is_err() {
                                break;
                            }
                        }
                    }

                    // ── Event bitmask: atomic take-all ──
                    let events = shared_state.event_flags.swap(0, std::sync::atomic::Ordering::AcqRel);

                    if events & EVENT_LOAD_COMPLETE != 0 {
                        let error = shared_state.load_error.read().clone();
                        let file_path = shared_state.file_path.read().clone();
                        if error.is_none() {
                            if let Some(ref path) = file_path {
                                let mut metadata = shared_state.track_metadata.read().clone();
                                if let Some(lm) = crate::metadata::extract_lofty_metadata(path) {
                                    crate::metadata::merge_lofty_into(&mut metadata, &lm);
                                }
                                let _ = data.app_db.record_media_metadata(
                                    path,
                                    &metadata,
                                    Some(shared_state.duration_secs()),
                                    Some(shared_state.sample_rate.load(std::sync::atomic::Ordering::Relaxed) as u32),
                                    Some(shared_state.channels.load(std::sync::atomic::Ordering::Relaxed) as usize),
                                );
                            }
                        }
                        let msg = if let Some(err) = error {
                            serde_json::json!({
                                "type": "load_error",
                                "error": err,
                            })
                        } else {
                            serde_json::json!({
                                "type": "load_complete",
                                "file_path": file_path,
                                "duration": shared_state.duration_secs(),
                            })
                        };
                        if session.text(msg.to_string()).await.is_err() {
                            break;
                        }
                    }

                    if events & EVENT_TRACK_CHANGED != 0 {
                        // Deferred metadata copy (P0-1 fix: audio callback no longer
                        // writes RwLock — we do it here on the async/main thread)
                        if shared_state.gapless_swap_pending.swap(false, std::sync::atomic::Ordering::AcqRel) {
                            let next_path = shared_state.pending_file_path.write().take();
                            let next_metadata = shared_state.pending_metadata.write().take();
                            if let Some(ref p) = next_path {
                                *shared_state.file_path.write() = Some(p.clone());
                            }
                            if let Some(meta) = next_metadata {
                                let mut enhanced = meta.clone();
                                if let Some(ref p) = next_path {
                                    if let Some(lm) = crate::metadata::extract_lofty_metadata(p) {
                                        crate::metadata::merge_lofty_into(&mut enhanced, &lm);
                                    }
                                }
                                *shared_state.track_metadata.write() = enhanced.clone();
                            }
                            *shared_state.current_track_path.write() = next_path;
                            if let Some(ref current_path) = *shared_state.current_track_path.read() {
                                super::playback::mark_current_track_as_played(&data, current_path);
                                let _ = data.app_db.mark_queue_entry_status_by_path(
                                    "active",
                                    current_path,
                                    &["preloading", "queued"],
                                    "playing",
                                );
                            }
                        }
                        let file_path = shared_state.current_track_path.read().clone();
                        let metadata = shared_state.track_metadata.read().clone();
                        // Persist runtime metadata (and any embedded cover art) for
                        // every track change — not just gapless transitions. Otherwise
                        // non-gapless loads (e.g. clicking a track in the History page)
                        // leave `cover_art_cache` empty even though the decoder already
                        // pulled the picture, so the subsequent cover-art request 404s.
                        if let Some(ref path) = file_path {
                            let _ = data.app_db.record_media_metadata(
                                path,
                                &metadata,
                                Some(shared_state.duration_secs()),
                                Some(shared_state.sample_rate.load(std::sync::atomic::Ordering::Relaxed) as u32),
                                Some(shared_state.channels.load(std::sync::atomic::Ordering::Relaxed) as usize),
                            );
                        }
                        let msg = {
                            let player = data.player.lock();
                            let state = get_enriched_player_state(&player, &data.app_db);
                            let mut value = serde_json::to_value(state).unwrap_or_else(|_| {
                                serde_json::json!({
                                    "file_path": file_path,
                                    "duration": shared_state.duration_secs(),
                                })
                            });
                            if let serde_json::Value::Object(ref mut object) = value {
                                object.insert(
                                    "type".to_string(),
                                    serde_json::Value::String("track_changed".to_string()),
                                );
                            }
                            value
                        };
                        if session.text(msg.to_string()).await.is_err() {
                            break;
                        }
                    }

                    if events & EVENT_QUEUE_UPDATED != 0 {
                        let msg = serde_json::json!({
                            "type": "queue_updated",
                        });
                        if session.text(msg.to_string()).await.is_err() {
                            break;
                        }
                    }

                    if events & EVENT_PLAYBACK_ENDED != 0 {
                        let position = shared_state.current_time_secs();
                        let msg = serde_json::json!({
                            "type": "playback_ended",
                            "position": position,
                        });
                        if session.text(msg.to_string()).await.is_err() {
                            break;
                        }
                    }

                    if events & EVENT_PLAYBACK_STARTED != 0 {
                        let msg = serde_json::json!({
                            "type": "play",
                            "position": shared_state.current_time_secs(),
                            "timestamp": now_millis(),
                        });
                        if session.text(msg.to_string()).await.is_err() {
                            break;
                        }
                    }

                    if events & EVENT_PLAYBACK_PAUSED != 0 {
                        let msg = serde_json::json!({
                            "type": "pause",
                            "position": shared_state.current_time_secs(),
                            "timestamp": now_millis(),
                        });
                        if session.text(msg.to_string()).await.is_err() {
                            break;
                        }
                    }

                    if events & EVENT_PLAYBACK_STOPPED != 0 {
                        let msg = serde_json::json!({
                            "type": "stop",
                            "position": shared_state.current_time_secs(),
                            "timestamp": now_millis(),
                        });
                        if session.text(msg.to_string()).await.is_err() {
                            break;
                        }
                    }

                    if events & EVENT_PLAYBACK_SEEKED != 0 {
                        let msg = serde_json::json!({
                            "type": "seek",
                            "position": shared_state.current_time_secs(),
                            "timestamp": now_millis(),
                        });
                        if session.text(msg.to_string()).await.is_err() {
                            break;
                        }
                    }

                    if events & EVENT_PLAYBACK_HISTORY_UPDATED != 0 {
                        let msg = serde_json::json!({
                            "type": "playback_history_updated",
                            "timestamp": now_millis(),
                        });
                        if session.text(msg.to_string()).await.is_err() {
                            break;
                        }
                    }

                    if events & EVENT_NEEDS_PRELOAD_RESET != 0 {
                        last_preload_sent = false;
                    }

                    if !is_playing && !is_loading {
                        idle_ticks += 1;
                        if idle_ticks > 40 {
                            // N-3: Idle mode — reduce polling frequency to save CPU.
                            // Events checked above via bitmask swap will not be lost
                            // (they accumulate in the AtomicU32), but delivery may be
                            // delayed by up to 200ms. This is acceptable for idle state.
                            tokio::time::sleep(Duration::from_millis(200)).await;
                            continue;
                        }
                    } else {
                        idle_ticks = 0;
                    }

                    // Preload signaling (still uses dedicated AtomicBool for callback compatibility)
                    let needs_preload_now = shared_state.needs_preload.load(std::sync::atomic::Ordering::Acquire);
                    if needs_preload_now && !last_preload_sent {
                        match super::playback::queue_next_from_persistent_queue(&data) {
                            Ok(Some(path)) => {
                                log::info!("Auto-preloading next queue entry: {}", path);
                            }
                            Ok(None) => {}
                            Err(e) => {
                                log::warn!("Failed to auto-preload next queue entry: {}", e);
                            }
                        }

                        last_preload_sent = true;
                        let pos = shared_state.position_frames.load(std::sync::atomic::Ordering::Relaxed);
                        let total = shared_state.total_frames.load(std::sync::atomic::Ordering::Relaxed);
                        let sr = shared_state.sample_rate.load(std::sync::atomic::Ordering::Relaxed).max(1);
                        let remaining_secs = total.saturating_sub(pos) as f64 / sr as f64;

                        let msg = serde_json::json!({
                            "type": "needs_preload",
                            "remaining_secs": remaining_secs,
                        });
                        if session.text(msg.to_string()).await.is_err() {
                            break;
                        }
                    }
                    if !needs_preload_now && last_preload_sent {
                        last_preload_sent = false;
                    }

                    if is_playing {
                        position_ticks = position_ticks.saturating_add(1);
                        if position_ticks >= 20 {
                            position_ticks = 0;
                            let msg = serde_json::json!({
                                "type": "position",
                                "position": shared_state.current_time_secs(),
                                "timestamp": now_millis(),
                            });
                            if session.text(msg.to_string()).await.is_err() {
                                break;
                            }
                        }
                    } else {
                        position_ticks = 0;
                    }

                    let spectrum = shared_state.spectrum_data.lock().clone();
                    if spectrum == last_spectrum && !is_playing {
                        continue;
                    }
                    last_spectrum = spectrum.clone();

                    let msg = serde_json::json!({
                        "type": "spectrum_data",
                        "data": spectrum
                    });

                    if session.text(msg.to_string()).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    Ok(response)
}

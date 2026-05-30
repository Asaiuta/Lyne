use super::*;
use actix_web::http::header;
use actix_web::{web, HttpRequest, HttpResponse};
use actix_ws::{self, Message};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, oneshot};
use tokio::time::interval;

use super::auth::{bearer_header, constant_time_eq, query_token};
use super::ws_events;
use crate::player::{
    EVENT_LOAD_COMPLETE, EVENT_LOAD_ERROR, EVENT_NEEDS_PRELOAD_RESET, EVENT_PLAYBACK_ENDED,
    EVENT_PLAYBACK_HISTORY_UPDATED, EVENT_PLAYBACK_PAUSED, EVENT_PLAYBACK_SEEKED,
    EVENT_PLAYBACK_STARTED, EVENT_PLAYBACK_STOPPED, EVENT_QUEUE_UPDATED, EVENT_TRACK_CHANGED,
};

const WS_TICK_INTERVAL_MS: u64 = 50;
const WS_IDLE_AFTER_TICKS: u32 = 40;
const WS_IDLE_SLEEP_MS: u64 = 200;
const WS_POSITION_EVERY_TICKS: u32 = 20;
const WS_EVENT_BROADCAST_CAPACITY: usize = 256;
const INTERNAL_PRELOAD_RESET: &str = "__internal_preload_reset";

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

pub(crate) fn spawn_websocket_event_coordinator(
    state: &Arc<AppState>,
) -> actix_rt::task::JoinHandle<()> {
    let weak_state = Arc::downgrade(state);
    actix_rt::spawn(async move {
        let mut timer = interval(Duration::from_millis(WS_TICK_INTERVAL_MS));
        loop {
            timer.tick().await;
            let Some(state) = weak_state.upgrade() else {
                break;
            };
            let data = web::Data::new(state);
            let Some(shared_state) = active_shared_state(&data) else {
                continue;
            };
            let events = shared_state.event_flags.swap(0, Ordering::AcqRel);
            if events == 0 {
                continue;
            }
            handle_ws_control_events(&data, &shared_state, events);
        }
    })
}

fn active_shared_state(data: &web::Data<Arc<AppState>>) -> Option<Arc<crate::player::SharedState>> {
    let player = data.player.lock();
    Some(player.shared_state())
}

fn handle_ws_control_events(
    data: &web::Data<Arc<AppState>>,
    shared_state: &Arc<crate::player::SharedState>,
    events: u32,
) {
    let mut payloads = Vec::new();
    let timestamp = now_millis();

    if events & EVENT_LOAD_COMPLETE != 0 {
        payloads.push(handle_load_complete_event(data, shared_state));
    }

    if events & EVENT_LOAD_ERROR != 0 {
        payloads.push(handle_load_error_event(shared_state));
    }

    if events & EVENT_TRACK_CHANGED != 0 {
        payloads.push(handle_track_changed_event(data, shared_state));
    }

    if events & EVENT_QUEUE_UPDATED != 0 {
        payloads.push(ws_events::queue_updated());
    }

    if events & EVENT_PLAYBACK_ENDED != 0 {
        payloads.push(ws_events::playback_ended(shared_state.current_time_secs()));
    }

    if events & EVENT_PLAYBACK_STARTED != 0 {
        payloads.push(ws_events::play(shared_state.current_time_secs(), timestamp));
    }

    if events & EVENT_PLAYBACK_PAUSED != 0 {
        payloads.push(ws_events::pause(
            shared_state.current_time_secs(),
            timestamp,
        ));
    }

    if events & EVENT_PLAYBACK_STOPPED != 0 {
        payloads.push(ws_events::stop(shared_state.current_time_secs(), timestamp));
    }

    if events & EVENT_PLAYBACK_SEEKED != 0 {
        payloads.push(ws_events::seek(shared_state.current_time_secs(), timestamp));
    }

    if events & EVENT_PLAYBACK_HISTORY_UPDATED != 0 {
        payloads.push(ws_events::playback_history_updated(timestamp));
    }

    if events & EVENT_NEEDS_PRELOAD_RESET != 0 {
        payloads.push(preload_reset_marker());
    }

    for payload in payloads {
        publish_ws_event(data.as_ref(), payload);
    }
}

fn handle_load_error_event(shared_state: &Arc<crate::player::SharedState>) -> serde_json::Value {
    ws_events::load_error(
        shared_state
            .load_error
            .read()
            .clone()
            .unwrap_or_else(|| "Load failed".to_string()),
    )
}

fn handle_load_complete_event(
    data: &web::Data<Arc<AppState>>,
    shared_state: &Arc<crate::player::SharedState>,
) -> serde_json::Value {
    let error = shared_state.load_error.read().clone();
    let file_path = shared_state.file_path.read().clone();
    if error.is_none() {
        persist_current_runtime_metadata(data, shared_state, file_path.as_deref(), true);
    }

    if let Some(error) = error {
        ws_events::load_error(error)
    } else {
        ws_events::load_complete(file_path, shared_state.duration_secs())
    }
}

fn handle_track_changed_event(
    data: &web::Data<Arc<AppState>>,
    shared_state: &Arc<crate::player::SharedState>,
) -> serde_json::Value {
    if shared_state
        .gapless_swap_pending
        .swap(false, Ordering::AcqRel)
    {
        apply_gapless_swap_side_effects(data, shared_state);
    }

    let file_path = shared_state.current_track_path.read().clone();
    persist_current_runtime_metadata(data, shared_state, file_path.as_deref(), false);
    let raw_state = {
        let player = data.player.lock();
        get_player_state(&player)
    };
    let state = enrich_player_state(&data.app_db, raw_state);
    ws_events::track_changed(&state, file_path, shared_state.duration_secs())
}

fn apply_gapless_swap_side_effects(
    data: &web::Data<Arc<AppState>>,
    shared_state: &Arc<crate::player::SharedState>,
) {
    let next_path = shared_state.pending_file_path.write().take();
    let next_metadata = shared_state.pending_metadata.write().take();
    let next_cached_loudness = shared_state.pending_cached_loudness.write().take();
    if let Some(ref path) = next_path {
        *shared_state.file_path.write() = Some(path.clone());
    }
    if let Some(metadata) = next_metadata {
        let mut enhanced = metadata.clone();
        if let Some(ref path) = next_path {
            if let Some(lofty_metadata) = crate::metadata::extract_lofty_metadata(path) {
                crate::metadata::merge_lofty_into(&mut enhanced, &lofty_metadata);
            }
        }
        *shared_state.track_metadata.write() = enhanced;
    }
    *shared_state.current_cached_loudness.write() = next_cached_loudness;
    *shared_state.current_track_path.write() = next_path.clone();
    if let Some(ref current_path) = next_path {
        super::playback::mark_current_track_as_played(data, current_path);
        let _ = data.app_db.mark_queue_entry_status_by_path(
            "active",
            current_path,
            &["preloading", "queued"],
            "playing",
        );
    }
}

fn persist_current_runtime_metadata(
    data: &web::Data<Arc<AppState>>,
    shared_state: &Arc<crate::player::SharedState>,
    path: Option<&str>,
    enrich_lofty: bool,
) {
    let Some(path) = path else {
        return;
    };
    let mut metadata = shared_state.track_metadata.read().clone();
    if enrich_lofty {
        if let Some(lofty_metadata) = crate::metadata::extract_lofty_metadata(path) {
            crate::metadata::merge_lofty_into(&mut metadata, &lofty_metadata);
        }
    }
    if let Err(e) = data.app_db.record_media_metadata(
        path,
        &metadata,
        Some(shared_state.duration_secs()),
        Some(shared_state.sample_rate.load(Ordering::Relaxed) as u32),
        Some(shared_state.channels.load(Ordering::Relaxed) as usize),
    ) {
        log::warn!("Failed to persist runtime metadata for '{}': {}", path, e);
    }
}

fn publish_ws_event(data: &AppState, payload: serde_json::Value) {
    let _ = data.playback.ws_events.send(payload);
}

fn preload_reset_marker() -> serde_json::Value {
    serde_json::json!({ "type": INTERNAL_PRELOAD_RESET })
}

async fn websocket(
    req: HttpRequest,
    stream: web::Payload,
    data: web::Data<Arc<AppState>>,
    control: web::Data<Arc<ServerControlState>>,
) -> Result<HttpResponse, actix_web::Error> {
    let expected_token = Arc::clone(&control.api_token);
    let chosen_protocol = match authenticate_ws(&req, &expected_token) {
        Ok(protocol) => protocol,
        Err(_) => {
            log::warn!("WebSocket upgrade rejected: missing or invalid bearer token");
            return Ok(unauthorized_response("unauthorized"));
        }
    };

    let (mut response, mut session, mut msg_stream) = actix_ws::handle(&req, stream)?;

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
    let mut event_rx = data.playback.ws_events.subscribe();
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
        let mut timer = interval(Duration::from_millis(WS_TICK_INTERVAL_MS));
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
                event = event_rx.recv() => {
                    match event {
                        Ok(payload) => {
                            if handle_broadcast_ws_event(&mut session, payload, &mut last_preload_sent).await.is_err() {
                                break;
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(skipped)) => {
                            log::warn!("WebSocket client skipped {} backend event(s)", skipped);
                        }
                        Err(broadcast::error::RecvError::Closed) => break,
                    }
                }
                _ = timer.tick() => {
                    let is_playing = matches!(
                        shared_state.state.load(),
                        crate::player::PlayerState::Playing
                    );

                    let is_loading = shared_state.is_loading.load(Ordering::Acquire);
                    if is_loading {
                        let progress = shared_state.load_progress.load(Ordering::Relaxed);
                        if progress != last_load_progress {
                            last_load_progress = progress;
                            let msg = ws_events::loading_progress(progress);
                            if session.text(msg.to_string()).await.is_err() {
                                break;
                            }
                        }
                    }

                    if !is_playing && !is_loading {
                        idle_ticks += 1;
                        if idle_ticks > WS_IDLE_AFTER_TICKS {
                            tokio::time::sleep(Duration::from_millis(WS_IDLE_SLEEP_MS)).await;
                            continue;
                        }
                    } else {
                        idle_ticks = 0;
                    }

                    let needs_preload_now = shared_state.needs_preload.load(Ordering::Acquire);
                    if needs_preload_now && !last_preload_sent {
                        let pos = shared_state.position_frames.load(Ordering::Relaxed);
                        let total = shared_state.total_frames.load(Ordering::Relaxed);
                        let sr = shared_state.sample_rate.load(Ordering::Relaxed).max(1);
                        let remaining_secs = total.saturating_sub(pos) as f64 / sr as f64;

                        let msg = ws_events::needs_preload(remaining_secs);
                        if session.text(msg.to_string()).await.is_err() {
                            break;
                        }
                        last_preload_sent = true;
                    }
                    if !needs_preload_now && last_preload_sent {
                        last_preload_sent = false;
                    }

                    if is_playing {
                        position_ticks = position_ticks.saturating_add(1);
                        if position_ticks >= WS_POSITION_EVERY_TICKS {
                            position_ticks = 0;
                            let msg = ws_events::position(
                                shared_state.current_time_secs(),
                                now_millis(),
                            );
                            if session.text(msg.to_string()).await.is_err() {
                                break;
                            }
                            shared_state
                                .ws_position_event_count
                                .fetch_add(1, Ordering::Relaxed);
                        }
                    } else {
                        position_ticks = 0;
                    }

                    let spectrum = shared_state.spectrum_data.load_full();
                    if spectrum.as_slice() == last_spectrum.as_slice() && !is_playing {
                        continue;
                    }
                    last_spectrum.clear();
                    last_spectrum.extend_from_slice(spectrum.as_slice());

                    let msg = ws_events::spectrum_data(spectrum.as_slice());

                    if session.text(msg.to_string()).await.is_err() {
                        break;
                    }
                    shared_state
                        .ws_spectrum_event_count
                        .fetch_add(1, Ordering::Relaxed);
                }
            }
        }
    });

    Ok(response)
}

async fn handle_broadcast_ws_event(
    session: &mut actix_ws::Session,
    payload: serde_json::Value,
    last_preload_sent: &mut bool,
) -> Result<(), ()> {
    if payload.get("type").and_then(serde_json::Value::as_str) == Some(INTERNAL_PRELOAD_RESET) {
        *last_preload_sent = false;
        return Ok(());
    }
    session.text(payload.to_string()).await.map_err(|_| ())
}

pub(crate) fn websocket_event_broadcast_channel() -> broadcast::Sender<serde_json::Value> {
    let (sender, _) = broadcast::channel(WS_EVENT_BROADCAST_CAPACITY);
    sender
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event_type(value: &serde_json::Value) -> Option<&str> {
        value.get("type").and_then(serde_json::Value::as_str)
    }

    #[test]
    fn control_events_are_built_in_stable_order_for_fanout() {
        let temp_dir = std::env::temp_dir().join("audio_player_ws_event_order");
        let _ = std::fs::remove_dir_all(&temp_dir);
        let state = crate::server::test_app_state_for_analysis(&temp_dir, 30, 1);
        let data = web::Data::new(state);
        let player = data.player.lock();
        let shared = player.shared_state();
        drop(player);

        handle_ws_control_events(
            &data,
            &shared,
            EVENT_QUEUE_UPDATED | EVENT_PLAYBACK_STARTED | EVENT_PLAYBACK_PAUSED,
        );

        let mut rx1 = data.playback.ws_events.subscribe();
        let mut rx2 = data.playback.ws_events.subscribe();
        handle_ws_control_events(
            &data,
            &shared,
            EVENT_QUEUE_UPDATED | EVENT_PLAYBACK_STARTED | EVENT_PLAYBACK_PAUSED,
        );

        let first = rx1.try_recv().unwrap();
        let second = rx1.try_recv().unwrap();
        let third = rx1.try_recv().unwrap();
        assert_eq!(
            event_type(&first),
            Some(ws_events::event_type::QUEUE_UPDATED)
        );
        assert_eq!(event_type(&second), Some(ws_events::event_type::PLAY));
        assert_eq!(event_type(&third), Some(ws_events::event_type::PAUSE));

        assert_eq!(
            event_type(&rx2.try_recv().unwrap()),
            Some(ws_events::event_type::QUEUE_UPDATED)
        );
        assert_eq!(
            event_type(&rx2.try_recv().unwrap()),
            Some(ws_events::event_type::PLAY)
        );
        assert_eq!(
            event_type(&rx2.try_recv().unwrap()),
            Some(ws_events::event_type::PAUSE)
        );

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}

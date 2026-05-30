use super::lyrics;
use super::*;
pub(crate) use queue_state::{
    append_validated_path_to_persistent_queue, append_validated_paths_to_persistent_queue,
    load_validated_path_for_playback, mark_current_track_as_played,
    queue_next_from_persistent_queue,
};
#[path = "playback/analysis.rs"]
mod analysis;
#[path = "playback/automix_handlers.rs"]
mod automix_handlers;
#[path = "playback/device_config.rs"]
mod device_config;
#[path = "playback/library.rs"]
mod library;
#[path = "playback/library_domain_handlers.rs"]
mod library_domain_handlers;
#[path = "playback/library_scan.rs"]
mod library_scan;
#[path = "playback/loudness_handlers.rs"]
mod loudness_handlers;
#[path = "playback/media_assets.rs"]
mod media_assets;
#[path = "playback/ncm_scrobble.rs"]
mod ncm_scrobble;
#[path = "playback/playlist_handlers.rs"]
mod playlist_handlers;
#[path = "playback/queue_handlers.rs"]
mod queue_handlers;
#[path = "playback/queue_state.rs"]
mod queue_state;
#[path = "playback/routes.rs"]
mod routes;
#[path = "playback/transport.rs"]
mod transport;
#[path = "playback/types.rs"]
mod types;
use crate::player::{PlayerState, RepeatMode, SharedState, ShuffleMode};
use actix_web::web;
use analysis::*;
use automix_handlers::*;
use device_config::*;
use library::*;
use library_domain_handlers::*;
use library_scan::*;
use loudness_handlers::*;
use media_assets::*;
use ncm_scrobble::*;
use playlist_handlers::*;
use queue_handlers::*;
use queue_state::*;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use transport::*;
use types::*;

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    routes::configure_routes(cfg);
}

fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn emit_playback_event_from_shared(shared: &Arc<SharedState>, event: u32) {
    shared.event_flags.fetch_or(event, Ordering::Release);
}

pub(crate) fn spawn_playback_supervisor(state: &Arc<AppState>) -> actix_rt::task::JoinHandle<()> {
    let weak_state = Arc::downgrade(state);
    actix_rt::spawn(async move {
        let mut last_end_count: Option<u64> = None;
        let mut timer = tokio::time::interval(Duration::from_millis(100));

        loop {
            timer.tick().await;
            let Some(state) = weak_state.upgrade() else {
                break;
            };
            let data = web::Data::new(state);
            let shared_state = {
                let player = data.player.lock();
                player.shared_state()
            };
            let last_count = last_end_count
                .get_or_insert_with(|| shared_state.playback_end_count.load(Ordering::Acquire));

            let needs_preload = shared_state.needs_preload.load(Ordering::Acquire);
            let pending_ready = shared_state.pending_ready.load(Ordering::Acquire);
            if needs_preload && !pending_ready {
                match queue_next_from_persistent_queue(&data) {
                    Ok(Some(path)) => log::info!("Supervisor preloaded next queue entry: {}", path),
                    Ok(None) => {}
                    Err(e) => log::warn!("Supervisor failed to preload next queue entry: {}", e),
                }
            }

            sync_ncm_scrobble_segment_from_shared(&data, &shared_state);

            let end_count = shared_state.playback_end_count.load(Ordering::Acquire);
            while *last_count < end_count {
                *last_count += 1;
                handle_natural_playback_end(&data);
            }
        }
    })
}

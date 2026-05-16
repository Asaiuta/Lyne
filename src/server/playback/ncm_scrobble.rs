use super::*;
use actix_web::web;
use ncm_api_rs::Query;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

const NCM_SCROBBLE_MIN_LISTEN_SECS: u64 = 30;

pub(super) fn begin_ncm_scrobble_session(
    data: &web::Data<Arc<AppState>>,
    session_id: i64,
    source_path: &str,
    is_playing: bool,
) {
    let track_source = match data.app_db.ncm_track_source_for_path(source_path) {
        Ok(Some(track_source)) => track_source,
        Ok(None) => return,
        Err(err) => {
            log::warn!("Failed to read NCM track source for scrobble: {}", err);
            return;
        }
    };

    data.playback.ncm_scrobble.lock().sessions.insert(
        session_id,
        NcmScrobbleSession {
            source_path: source_path.to_string(),
            song_id: track_source.song_id,
            accumulated: Duration::ZERO,
            segment_started_at: is_playing.then(Instant::now),
        },
    );
}

pub(super) fn start_ncm_scrobble_segment(data: &web::Data<Arc<AppState>>, session_id: i64) {
    let mut state = data.playback.ncm_scrobble.lock();
    if let Some(session) = state.sessions.get_mut(&session_id) {
        if session.segment_started_at.is_none() {
            session.segment_started_at = Some(Instant::now());
        }
    }
}

pub(super) fn stop_ncm_scrobble_segment(data: &web::Data<Arc<AppState>>, session_id: i64) {
    let mut state = data.playback.ncm_scrobble.lock();
    if let Some(session) = state.sessions.get_mut(&session_id) {
        stop_ncm_scrobble_segment_inner(session);
    }
}

pub(super) fn sync_ncm_scrobble_segment_from_shared(
    data: &web::Data<Arc<AppState>>,
    shared_state: &Arc<SharedState>,
) {
    let Some(session_id) = *data.playback.active_session_id.lock() else {
        return;
    };
    let is_audible_playback = shared_state.state.load() == PlayerState::Playing
        && !shared_state.is_loading.load(Ordering::Acquire);
    if is_audible_playback {
        start_ncm_scrobble_segment(data, session_id);
    } else {
        stop_ncm_scrobble_segment(data, session_id);
    }
}

pub(super) fn finish_ncm_scrobble_session(
    data: &web::Data<Arc<AppState>>,
    session_id: i64,
    reason: &str,
) {
    let finished = {
        let mut state = data.playback.ncm_scrobble.lock();
        let Some(mut session) = state.sessions.remove(&session_id) else {
            return;
        };
        stop_ncm_scrobble_segment_inner(&mut session);
        session
    };

    let listen_secs = finished.accumulated.as_secs();
    if listen_secs < NCM_SCROBBLE_MIN_LISTEN_SECS {
        log::debug!(
            "Skipping NCM scrobble for song {} after {}s ({})",
            finished.song_id,
            listen_secs,
            reason
        );
        return;
    }

    let app_state = Arc::clone(data.get_ref());
    let source_path = finished.source_path;
    let song_id = finished.song_id;
    let reason = reason.to_string();
    actix_rt::spawn(async move {
        submit_ncm_scrobble(app_state, source_path, song_id, listen_secs, reason).await;
    });
}

fn stop_ncm_scrobble_segment_inner(session: &mut NcmScrobbleSession) {
    if let Some(started_at) = session.segment_started_at.take() {
        session.accumulated += started_at.elapsed();
    }
}

async fn submit_ncm_scrobble(
    data: Arc<AppState>,
    source_path: String,
    song_id: i64,
    listen_secs: u64,
    reason: String,
) {
    let cookie = match data.app_db.active_ncm_cookie() {
        Ok(Some(cookie)) => cookie,
        Ok(None) => {
            log::debug!(
                "Skipping NCM scrobble for song {} without active cookie",
                song_id
            );
            return;
        }
        Err(err) => {
            log::warn!("Failed to read active NCM cookie for scrobble: {}", err);
            return;
        }
    };

    let query = Query::new()
        .cookie(&cookie)
        .param("id", &song_id.to_string())
        .param("sourceid", "")
        .param("time", &listen_secs.to_string());

    match data.ncm_client.scrobble(&query).await {
        Ok(_) => {
            if let Err(err) = data
                .app_db
                .mark_ncm_track_scrobbled(&source_path, listen_secs)
            {
                log::warn!(
                    "Failed to mark NCM song {} scrobbled after submit: {}",
                    song_id,
                    err
                );
            }
            log::info!(
                "NCM scrobble song {} after {}s ({})",
                song_id,
                listen_secs,
                reason
            );
        }
        Err(err) => {
            log::warn!(
                "NCM scrobble song {} after {}s failed: {}",
                song_id,
                listen_secs,
                err
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::stop_ncm_scrobble_segment_inner;
    use crate::server::NcmScrobbleSession;
    use std::time::{Duration, Instant};

    #[test]
    fn stop_segment_accumulates_elapsed_time_once() {
        let mut session = NcmScrobbleSession {
            source_path: "ncm://track".to_string(),
            song_id: 42,
            accumulated: Duration::from_secs(5),
            segment_started_at: Some(Instant::now() - Duration::from_secs(2)),
        };

        stop_ncm_scrobble_segment_inner(&mut session);
        let after_first_stop = session.accumulated;
        stop_ncm_scrobble_segment_inner(&mut session);

        assert!(after_first_stop >= Duration::from_secs(7));
        assert_eq!(session.accumulated, after_first_stop);
        assert!(session.segment_started_at.is_none());
    }
}

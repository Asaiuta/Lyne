use serde::Serialize;
use serde_json::Value;

use super::StateResponse;

// Single source of truth for WebSocket event names and payloads.
// Frontend parser lives at `apps/desktop/src/shared/api/wsTypes.ts` and
// must mirror `KNOWN_EVENT_TYPES`. Unknown events stay non-fatal there.
pub(crate) mod event_type {
    pub(crate) const LOADING_PROGRESS: &str = "loading_progress";
    pub(crate) const LOAD_COMPLETE: &str = "load_complete";
    pub(crate) const LOAD_ERROR: &str = "load_error";
    pub(crate) const TRACK_CHANGED: &str = "track_changed";
    pub(crate) const PLAYBACK_ENDED: &str = "playback_ended";
    pub(crate) const NEEDS_PRELOAD: &str = "needs_preload";
    pub(crate) const SPECTRUM_DATA: &str = "spectrum_data";
    pub(crate) const QUEUE_UPDATED: &str = "queue_updated";
    pub(crate) const PLAY: &str = "play";
    pub(crate) const PAUSE: &str = "pause";
    pub(crate) const STOP: &str = "stop";
    pub(crate) const SEEK: &str = "seek";
    pub(crate) const POSITION: &str = "position";
    pub(crate) const PLAYBACK_HISTORY_UPDATED: &str = "playback_history_updated";
}

#[allow(dead_code)] // canonical registry of WS event names; consumed by tests and used as the contract surface
pub(crate) const KNOWN_EVENT_TYPES: &[&str] = &[
    event_type::LOADING_PROGRESS,
    event_type::LOAD_COMPLETE,
    event_type::LOAD_ERROR,
    event_type::TRACK_CHANGED,
    event_type::PLAYBACK_ENDED,
    event_type::NEEDS_PRELOAD,
    event_type::SPECTRUM_DATA,
    event_type::QUEUE_UPDATED,
    event_type::PLAY,
    event_type::PAUSE,
    event_type::STOP,
    event_type::SEEK,
    event_type::POSITION,
    event_type::PLAYBACK_HISTORY_UPDATED,
];

#[derive(Serialize)]
struct EventEnvelope {
    #[serde(rename = "type")]
    event_type: &'static str,
}

#[derive(Serialize)]
struct LoadingProgressEvent {
    #[serde(rename = "type")]
    event_type: &'static str,
    progress: u64,
}

#[derive(Serialize)]
struct LoadCompleteEvent {
    #[serde(rename = "type")]
    event_type: &'static str,
    file_path: Option<String>,
    duration: f64,
}

#[derive(Serialize)]
struct LoadErrorEvent {
    #[serde(rename = "type")]
    event_type: &'static str,
    error: String,
}

#[derive(Serialize)]
struct TrackChangedEvent<'a> {
    #[serde(rename = "type")]
    event_type: &'static str,
    #[serde(flatten)]
    state: &'a StateResponse,
}

#[derive(Serialize)]
struct TrackChangedFallbackEvent {
    #[serde(rename = "type")]
    event_type: &'static str,
    file_path: Option<String>,
    duration: f64,
}

#[derive(Serialize)]
struct PlaybackEndedEvent {
    #[serde(rename = "type")]
    event_type: &'static str,
    position: f64,
}

#[derive(Serialize)]
struct NeedsPreloadEvent {
    #[serde(rename = "type")]
    event_type: &'static str,
    remaining_secs: f64,
}

#[derive(Serialize)]
struct SpectrumDataEvent<'a> {
    #[serde(rename = "type")]
    event_type: &'static str,
    data: &'a [f32],
}

#[derive(Serialize)]
struct TimedPositionEvent {
    #[serde(rename = "type")]
    event_type: &'static str,
    position: f64,
    timestamp: u64,
}

#[derive(Serialize)]
struct PlaybackHistoryUpdatedEvent {
    #[serde(rename = "type")]
    event_type: &'static str,
    timestamp: u64,
}

fn event_value(event: impl Serialize) -> Value {
    serde_json::to_value(event).unwrap_or_else(|_| {
        serde_json::json!({
            "type": "event_serialization_error"
        })
    })
}

pub(crate) fn loading_progress(progress: u64) -> Value {
    event_value(LoadingProgressEvent {
        event_type: event_type::LOADING_PROGRESS,
        progress,
    })
}

pub(crate) fn load_complete(file_path: Option<String>, duration: f64) -> Value {
    event_value(LoadCompleteEvent {
        event_type: event_type::LOAD_COMPLETE,
        file_path,
        duration,
    })
}

pub(crate) fn load_error(error: String) -> Value {
    event_value(LoadErrorEvent {
        event_type: event_type::LOAD_ERROR,
        error,
    })
}

pub(crate) fn track_changed(
    state: &StateResponse,
    fallback_file_path: Option<String>,
    fallback_duration: f64,
) -> Value {
    serde_json::to_value(TrackChangedEvent {
        event_type: event_type::TRACK_CHANGED,
        state,
    })
    .unwrap_or_else(|_| {
        event_value(TrackChangedFallbackEvent {
            event_type: event_type::TRACK_CHANGED,
            file_path: fallback_file_path,
            duration: fallback_duration,
        })
    })
}

pub(crate) fn queue_updated() -> Value {
    event_value(EventEnvelope {
        event_type: event_type::QUEUE_UPDATED,
    })
}

pub(crate) fn playback_ended(position: f64) -> Value {
    event_value(PlaybackEndedEvent {
        event_type: event_type::PLAYBACK_ENDED,
        position,
    })
}

pub(crate) fn play(position: f64, timestamp: u64) -> Value {
    timed_position(event_type::PLAY, position, timestamp)
}

pub(crate) fn pause(position: f64, timestamp: u64) -> Value {
    timed_position(event_type::PAUSE, position, timestamp)
}

pub(crate) fn stop(position: f64, timestamp: u64) -> Value {
    timed_position(event_type::STOP, position, timestamp)
}

pub(crate) fn seek(position: f64, timestamp: u64) -> Value {
    timed_position(event_type::SEEK, position, timestamp)
}

pub(crate) fn position(position: f64, timestamp: u64) -> Value {
    timed_position(event_type::POSITION, position, timestamp)
}

fn timed_position(event_type: &'static str, position: f64, timestamp: u64) -> Value {
    event_value(TimedPositionEvent {
        event_type,
        position,
        timestamp,
    })
}

pub(crate) fn playback_history_updated(timestamp: u64) -> Value {
    event_value(PlaybackHistoryUpdatedEvent {
        event_type: event_type::PLAYBACK_HISTORY_UPDATED,
        timestamp,
    })
}

pub(crate) fn needs_preload(remaining_secs: f64) -> Value {
    event_value(NeedsPreloadEvent {
        event_type: event_type::NEEDS_PRELOAD,
        remaining_secs,
    })
}

pub(crate) fn spectrum_data(data: &[f32]) -> Value {
    event_value(SpectrumDataEvent {
        event_type: event_type::SPECTRUM_DATA,
        data,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event_type_of(value: Value) -> String {
        value
            .get("type")
            .and_then(Value::as_str)
            .expect("event type should serialize")
            .to_string()
    }

    #[test]
    fn event_type_registry_has_no_duplicates() {
        let mut unique = std::collections::BTreeSet::new();
        for event_type in KNOWN_EVENT_TYPES {
            assert!(
                unique.insert(event_type),
                "duplicate event type: {event_type}"
            );
        }
        assert_eq!(unique.len(), KNOWN_EVENT_TYPES.len());
    }

    #[test]
    fn typed_event_builders_emit_stable_names() {
        let cases = [
            (loading_progress(10), event_type::LOADING_PROGRESS),
            (
                load_complete(Some("track.flac".to_string()), 12.5),
                event_type::LOAD_COMPLETE,
            ),
            (
                load_error("decode failed".to_string()),
                event_type::LOAD_ERROR,
            ),
            (queue_updated(), event_type::QUEUE_UPDATED),
            (playback_ended(34.0), event_type::PLAYBACK_ENDED),
            (play(1.0, 1000), event_type::PLAY),
            (pause(1.0, 1000), event_type::PAUSE),
            (stop(1.0, 1000), event_type::STOP),
            (seek(1.0, 1000), event_type::SEEK),
            (position(1.0, 1000), event_type::POSITION),
            (
                playback_history_updated(1000),
                event_type::PLAYBACK_HISTORY_UPDATED,
            ),
            (needs_preload(3.0), event_type::NEEDS_PRELOAD),
            (spectrum_data(&[0.1, 0.2]), event_type::SPECTRUM_DATA),
        ];

        for (value, expected) in cases {
            assert_eq!(event_type_of(value), expected);
        }
    }
}

//! Windows System Media Transport Controls (SMTC) integration.
//!
//! The renderer is the data source: the main window pushes track metadata and
//! playback status through the `smtc_*` commands (the same bridge-push model
//! as the desktop-lyric overlay — the Tauri process has no WS client). Media
//! keys travel the other way: souvlaki's event callback is forwarded to the
//! main window as an `smtc:control` Tauri event, and the frontend routes it
//! to the existing playback handlers.
//!
//! Threading: souvlaki's `MediaControls` wraps WinRT objects, so a dedicated
//! worker thread created on enable owns them for their whole lifetime and is
//! driven by an mpsc channel. Disabling drops the channel sender and joins the
//! thread; dropping `MediaControls` detaches the handler and disables the
//! system control, so a disabled toggle leaves no residual SMTC registration.
//!
//! Non-Windows builds keep identical command signatures as no-ops (MPRIS is a
//! later increment).

#[cfg(windows)]
use std::sync::Mutex;

/// Track metadata pushed by the frontend. Field names arrive camelCase from JS.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(windows), allow(dead_code))]
pub struct SmtcMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// Absolute URL only: SMTC fetches the thumbnail itself with NO request
    /// headers, so local sidecar covers must embed `?token=` (the frontend
    /// bridge guarantees this and drops webview-relative fallbacks).
    pub cover_url: Option<String>,
    pub duration_sec: Option<f64>,
}

#[cfg(windows)]
pub struct SmtcState {
    worker: Mutex<Option<win::SmtcWorker>>,
}

#[cfg(not(windows))]
pub struct SmtcState;

impl SmtcState {
    #[cfg(windows)]
    pub fn new() -> Self {
        Self {
            worker: Mutex::new(None),
        }
    }

    #[cfg(not(windows))]
    pub fn new() -> Self {
        Self
    }
}

/// Register (or drop) the system media controls. Enabling requires the main
/// window to exist; disabling joins the worker so a follow-up enable never
/// races the teardown of the previous controls on the same HWND.
#[tauri::command]
pub fn smtc_set_enabled(
    app: tauri::AppHandle,
    state: tauri::State<'_, SmtcState>,
    enabled: bool,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut guard = state
            .worker
            .lock()
            .map_err(|_| "SMTC state lock poisoned".to_string())?;
        if enabled {
            if guard.is_none() {
                *guard = Some(win::spawn_worker(&app)?);
            }
        } else if let Some(worker) = guard.take() {
            worker.shutdown();
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = (app, state, enabled);
        Ok(())
    }
}

/// Update the metadata shown by the system media flyout. A no-op while
/// disabled (pushes racing an enable/disable toggle are benign).
#[tauri::command]
pub fn smtc_update_metadata(
    state: tauri::State<'_, SmtcState>,
    metadata: SmtcMetadata,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let guard = state
            .worker
            .lock()
            .map_err(|_| "SMTC state lock poisoned".to_string())?;
        if let Some(worker) = guard.as_ref() {
            worker.send(win::SmtcMessage::Metadata(metadata));
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = (state, metadata);
        Ok(())
    }
}

/// Update playback status + timeline position. A no-op while disabled.
#[tauri::command]
pub fn smtc_update_playback(
    state: tauri::State<'_, SmtcState>,
    playing: bool,
    position_sec: Option<f64>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let guard = state
            .worker
            .lock()
            .map_err(|_| "SMTC state lock poisoned".to_string())?;
        if let Some(worker) = guard.as_ref() {
            worker.send(win::SmtcMessage::Playback {
                playing,
                position_sec,
            });
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = (state, playing, position_sec);
        Ok(())
    }
}

#[cfg(windows)]
mod win {
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    use souvlaki::{
        MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition,
        PlatformConfig,
    };
    use tauri::{Emitter, Manager};

    use super::SmtcMetadata;

    /// Tauri event the main window listens on for forwarded media-key actions.
    const SMTC_CONTROL_EVENT: &str = "smtc:control";
    const MAIN_WINDOW_LABEL: &str = "main";

    pub(super) enum SmtcMessage {
        Metadata(SmtcMetadata),
        Playback {
            playing: bool,
            position_sec: Option<f64>,
        },
    }

    /// Owns the worker thread that owns the `MediaControls`.
    pub(super) struct SmtcWorker {
        sender: mpsc::Sender<SmtcMessage>,
        thread: thread::JoinHandle<()>,
    }

    impl SmtcWorker {
        pub(super) fn send(&self, message: SmtcMessage) {
            // A send can only fail if the worker already exited (e.g. after a WinRT
            // failure); the next enable toggle recreates it.
            let _ = self.sender.send(message);
        }

        pub(super) fn shutdown(self) {
            // Dropping the sender wakes the worker's recv() with Err, ending its
            // loop and dropping MediaControls (detach + SetIsEnabled(false)). The
            // worker only ever blocks on recv, so the join returns promptly.
            drop(self.sender);
            let _ = self.thread.join();
        }
    }

    #[derive(Clone, serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct SmtcControlPayload {
        action: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        position_sec: Option<f64>,
    }

    /// Map a souvlaki event to the frontend control action. Pure so the routing
    /// table is reviewable and unit-testable without WinRT objects.
    fn control_action(event: &MediaControlEvent) -> Option<(&'static str, Option<f64>)> {
        match event {
            MediaControlEvent::Play => Some(("play", None)),
            MediaControlEvent::Pause => Some(("pause", None)),
            MediaControlEvent::Toggle => Some(("toggle", None)),
            MediaControlEvent::Next => Some(("next", None)),
            MediaControlEvent::Previous => Some(("previous", None)),
            // SMTC "stop" has no dedicated app action; treat it as pause.
            MediaControlEvent::Stop => Some(("pause", None)),
            MediaControlEvent::SetPosition(MediaPosition(position)) => {
                Some(("seek", Some(position.as_secs_f64())))
            }
            // Directional seeks carry no absolute target and the frontend seek
            // handler is absolute-only; ignore them (Windows sends SetPosition for
            // flyout scrubbing, which is the path that matters).
            MediaControlEvent::Seek(_) | MediaControlEvent::SeekBy(..) => None,
            MediaControlEvent::SetVolume(_)
            | MediaControlEvent::OpenUri(_)
            | MediaControlEvent::Raise
            | MediaControlEvent::Quit => None,
        }
    }

    /// `Duration::from_secs_f64` panics on negative/NaN input; guard it.
    fn duration_from_secs(value: f64) -> Option<Duration> {
        (value.is_finite() && value >= 0.0).then(|| Duration::from_secs_f64(value))
    }

    fn to_media_metadata(metadata: &SmtcMetadata) -> MediaMetadata<'_> {
        MediaMetadata {
            // souvlaki only writes fields that are Some, so absent text fields must
            // map to empty strings — otherwise the previous track's title/artist
            // would linger on the flyout. The thumbnail has no such clear path
            // (an empty URI fails to parse), so a coverless track keeps the prior
            // cover; the frontend key still re-pushes once the real cover resolves.
            title: Some(metadata.title.as_deref().unwrap_or("")),
            artist: Some(metadata.artist.as_deref().unwrap_or("")),
            album: Some(metadata.album.as_deref().unwrap_or("")),
            cover_url: metadata.cover_url.as_deref(),
            duration: metadata.duration_sec.and_then(duration_from_secs),
        }
    }

    fn to_media_playback(playing: bool, position_sec: Option<f64>) -> MediaPlayback {
        let progress = position_sec.and_then(duration_from_secs).map(MediaPosition);
        if playing {
            MediaPlayback::Playing { progress }
        } else {
            MediaPlayback::Paused { progress }
        }
    }

    pub(super) fn spawn_worker(app: &tauri::AppHandle) -> Result<SmtcWorker, String> {
        let window = app
            .get_webview_window(MAIN_WINDOW_LABEL)
            .ok_or_else(|| "SMTC requires the main window".to_string())?;
        let hwnd = window
            .hwnd()
            .map_err(|error| format!("Failed to resolve main window handle: {error}"))?;
        // Carry the handle across the thread boundary as a plain integer; the raw
        // pointer form is not Send. The HWND stays valid for the app's lifetime
        // (SMTC is torn down with the window either way).
        let hwnd_value = hwnd.0 as isize;

        let app_handle = app.clone();
        let (sender, receiver) = mpsc::channel::<SmtcMessage>();
        let (ready_sender, ready_receiver) = mpsc::channel::<Result<(), String>>();

        let thread = thread::Builder::new()
            .name("smtc-worker".into())
            .spawn(move || {
                // windows-rs `factory()` self-initializes an MTA on first use, so no
                // manual COM/WinRT apartment setup is needed on this thread.
                let mut controls = match create_controls(hwnd_value, app_handle) {
                    Ok(controls) => {
                        let _ = ready_sender.send(Ok(()));
                        controls
                    }
                    Err(error) => {
                        let _ = ready_sender.send(Err(error));
                        return;
                    }
                };

                while let Ok(message) = receiver.recv() {
                    let result = match message {
                        SmtcMessage::Metadata(metadata) => controls
                            .set_metadata(to_media_metadata(&metadata))
                            .map_err(|error| error.to_string()),
                        SmtcMessage::Playback {
                            playing,
                            position_sec,
                        } => controls
                            .set_playback(to_media_playback(playing, position_sec))
                            .map_err(|error| error.to_string()),
                    };
                    if let Err(error) = result {
                        eprintln!("[audio-desktop] SMTC update failed: {error}");
                    }
                }
                // Channel closed (disable toggle or app teardown): `controls` drops
                // here, detaching the handler and disabling the system control.
            })
            .map_err(|error| format!("Failed to spawn SMTC worker thread: {error}"))?;

        match ready_receiver.recv() {
            Ok(Ok(())) => Ok(SmtcWorker { sender, thread }),
            Ok(Err(error)) => {
                let _ = thread.join();
                Err(error)
            }
            Err(_) => {
                let _ = thread.join();
                Err("SMTC worker exited before initialising".to_string())
            }
        }
    }

    fn create_controls(
        hwnd_value: isize,
        app_handle: tauri::AppHandle,
    ) -> Result<MediaControls, String> {
        let config = PlatformConfig {
            display_name: "Lyne",
            dbus_name: "lyne",
            hwnd: Some(hwnd_value as *mut std::ffi::c_void),
        };
        let mut controls = MediaControls::new(config)
            .map_err(|error| format!("Failed to create system media controls: {error}"))?;
        controls
            .attach(move |event| {
                let Some((action, position_sec)) = control_action(&event) else {
                    return;
                };
                let payload = SmtcControlPayload {
                    action,
                    position_sec,
                };
                if let Err(error) =
                    app_handle.emit_to(MAIN_WINDOW_LABEL, SMTC_CONTROL_EVENT, payload)
                {
                    eprintln!("[audio-desktop] failed to forward SMTC event: {error}");
                }
            })
            .map_err(|error| format!("Failed to attach SMTC event handler: {error}"))?;
        Ok(controls)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use souvlaki::SeekDirection;

        #[test]
        fn media_keys_map_to_frontend_actions() {
            assert_eq!(
                control_action(&MediaControlEvent::Play),
                Some(("play", None))
            );
            assert_eq!(
                control_action(&MediaControlEvent::Pause),
                Some(("pause", None))
            );
            assert_eq!(
                control_action(&MediaControlEvent::Toggle),
                Some(("toggle", None))
            );
            assert_eq!(
                control_action(&MediaControlEvent::Next),
                Some(("next", None))
            );
            assert_eq!(
                control_action(&MediaControlEvent::Previous),
                Some(("previous", None))
            );
            assert_eq!(
                control_action(&MediaControlEvent::Stop),
                Some(("pause", None))
            );
        }

        #[test]
        fn set_position_maps_to_absolute_seek_seconds() {
            let event =
                MediaControlEvent::SetPosition(MediaPosition(Duration::from_millis(93_500)));
            assert_eq!(control_action(&event), Some(("seek", Some(93.5))));
        }

        #[test]
        fn events_without_an_app_action_are_dropped() {
            assert_eq!(
                control_action(&MediaControlEvent::Seek(SeekDirection::Forward)),
                None
            );
            assert_eq!(
                control_action(&MediaControlEvent::SeekBy(
                    SeekDirection::Backward,
                    Duration::from_secs(10)
                )),
                None
            );
            assert_eq!(control_action(&MediaControlEvent::SetVolume(0.5)), None);
            assert_eq!(control_action(&MediaControlEvent::Raise), None);
            assert_eq!(control_action(&MediaControlEvent::Quit), None);
        }

        #[test]
        fn duration_guard_rejects_non_finite_and_negative_values() {
            assert_eq!(
                duration_from_secs(12.25),
                Some(Duration::from_secs_f64(12.25))
            );
            assert_eq!(duration_from_secs(0.0), Some(Duration::ZERO));
            assert_eq!(duration_from_secs(-1.0), None);
            assert_eq!(duration_from_secs(f64::NAN), None);
            assert_eq!(duration_from_secs(f64::INFINITY), None);
        }

        #[test]
        fn metadata_maps_borrowed_fields_and_duration() {
            let metadata = SmtcMetadata {
                title: Some("Song".to_string()),
                artist: Some("Artist".to_string()),
                album: None,
                cover_url: Some("http://127.0.0.1:63790/cover?token=abc".to_string()),
                duration_sec: Some(200.0),
            };
            let mapped = to_media_metadata(&metadata);
            assert_eq!(mapped.title, Some("Song"));
            assert_eq!(mapped.artist, Some("Artist"));
            // Absent text fields clear (empty string), they do not skip the write.
            assert_eq!(mapped.album, Some(""));
            assert_eq!(
                mapped.cover_url,
                Some("http://127.0.0.1:63790/cover?token=abc")
            );
            assert_eq!(mapped.duration, Some(Duration::from_secs(200)));
        }

        #[test]
        fn playback_maps_status_and_progress() {
            assert_eq!(
                to_media_playback(true, Some(1.5)),
                MediaPlayback::Playing {
                    progress: Some(MediaPosition(Duration::from_secs_f64(1.5)))
                }
            );
            assert_eq!(
                to_media_playback(false, None),
                MediaPlayback::Paused { progress: None }
            );
            // Bogus positions degrade to no progress rather than panicking.
            assert_eq!(
                to_media_playback(true, Some(f64::NAN)),
                MediaPlayback::Playing { progress: None }
            );
        }
    }
}

//! Desktop lyric overlay window.
//!
//! A second, transparent, always-on-top, frameless `WebviewWindow` (label
//! `desktop-lyric`) that renders the SPlayer-style scrolling lyric. The window
//! loads the same frontend bundle; the renderer routes to the desktop-lyric UI
//! by inspecting `getCurrentWindow().label`.
//!
//! Playback data flows main → overlay via Tauri events (see the frontend
//! `desktopLyricBridge`); these commands only own window lifecycle and the
//! click-through (lock) state.

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const DESKTOP_LYRIC_LABEL: &str = "desktop-lyric";

/// Create (or reveal) the desktop lyric overlay window.
#[tauri::command]
pub fn open_desktop_lyric(app: tauri::AppHandle) -> Result<(), String> {
  if let Some(window) = app.get_webview_window(DESKTOP_LYRIC_LABEL) {
    window.show().map_err(|error| error.to_string())?;
    let _ = window.set_focus();
    return Ok(());
  }

  let builder =
    WebviewWindowBuilder::new(&app, DESKTOP_LYRIC_LABEL, WebviewUrl::App("index.html".into()))
      .title("Lyne Desktop Lyric")
      .inner_size(820.0, 180.0)
      .min_inner_size(320.0, 96.0)
      .decorations(false)
      .transparent(true)
      .always_on_top(true)
      .skip_taskbar(true)
      .shadow(false)
      .resizable(true)
      .visible(true);

  builder.build().map_err(|error| error.to_string())?;
  Ok(())
}

/// Close the desktop lyric overlay window if it exists.
#[tauri::command]
pub fn close_desktop_lyric(app: tauri::AppHandle) -> Result<(), String> {
  if let Some(window) = app.get_webview_window(DESKTOP_LYRIC_LABEL) {
    window.close().map_err(|error| error.to_string())?;
  }
  Ok(())
}

/// Toggle click-through (lock) on the overlay so clicks pass to windows beneath.
#[tauri::command]
pub fn set_desktop_lyric_locked(app: tauri::AppHandle, locked: bool) -> Result<(), String> {
  if let Some(window) = app.get_webview_window(DESKTOP_LYRIC_LABEL) {
    window
      .set_ignore_cursor_events(locked)
      .map_err(|error| error.to_string())?;
  }
  Ok(())
}

/// Whether the overlay window currently exists.
#[tauri::command]
pub fn desktop_lyric_is_open(app: tauri::AppHandle) -> bool {
  app.get_webview_window(DESKTOP_LYRIC_LABEL).is_some()
}

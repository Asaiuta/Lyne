use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::{
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, RunEvent, Runtime, WindowEvent,
};

mod desktop_lyric;
mod sidecar;
mod smtc;

#[tauri::command]
fn reveal_path_in_folder(path: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    let canonical_target = target
        .canonicalize()
        .map_err(|error| format!("Failed to resolve path: {error}"))?;

    reveal_canonical_path_in_folder(&canonical_target)
}

#[cfg(target_os = "windows")]
fn reveal_canonical_path_in_folder(path: &Path) -> Result<(), String> {
    let mut select_arg = std::ffi::OsString::from("/select,");
    select_arg.push(path);
    let status = Command::new("explorer")
        .arg(select_arg)
        .status()
        .map_err(|error| format!("Failed to open Explorer: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("Explorer exited with status: {status}"))
    }
}

#[cfg(target_os = "macos")]
fn reveal_canonical_path_in_folder(path: &Path) -> Result<(), String> {
    let status = Command::new("open")
        .arg("-R")
        .arg(path)
        .status()
        .map_err(|error| format!("Failed to open Finder: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("Finder exited with status: {status}"))
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_canonical_path_in_folder(path: &Path) -> Result<(), String> {
    let folder = path.parent().unwrap_or(path);
    let status = Command::new("xdg-open")
        .arg(folder)
        .status()
        .map_err(|error| format!("Failed to open folder: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("xdg-open exited with status: {status}"))
    }
}

fn restore_main_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if let Err(error) = window.show() {
        eprintln!("[audio-desktop] failed to show main window from tray: {error}");
    }
    if let Err(error) = window.unminimize() {
        eprintln!("[audio-desktop] failed to unminimize main window from tray: {error}");
    }
    if let Err(error) = window.set_focus() {
        eprintln!("[audio-desktop] failed to focus main window from tray: {error}");
    }
}

fn setup_tray<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    let mut tray = TrayIconBuilder::new()
        .tooltip("Lyne")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => restore_main_window(tray.app_handle()),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

fn initialize_runtime(app: &tauri::AppHandle) -> Result<(), String> {
    setup_tray(app).map_err(|error| format!("Failed to set up the system tray: {error}"))?;

    let sidecar_state = app
        .try_state::<sidecar::SidecarState>()
        .ok_or_else(|| "Failed to access managed sidecar state during setup.".to_string())?;
    let runtime_state = app
        .try_state::<sidecar::ApiRuntimeState>()
        .ok_or_else(|| "Failed to access managed API runtime state during setup.".to_string())?;

    sidecar::start(app, &sidecar_state, &runtime_state)
}

fn publish_startup_failure(app: &tauri::AppHandle, error: String) {
    eprintln!("[audio-desktop] startup failed: {error}");
    let Some(runtime_state) = app.try_state::<sidecar::ApiRuntimeState>() else {
        eprintln!(
            "[audio-desktop] API runtime state was unavailable while publishing startup failure"
        );
        return;
    };

    if let Err(state_error) = runtime_state.mark_failed(error) {
        eprintln!("[audio-desktop] {state_error}");
    }
}

fn main() {
    let app = tauri::Builder::default()
        .manage(sidecar::SidecarState::new())
        .manage(sidecar::ApiRuntimeState::new(sidecar::generate_api_token()))
        .manage(smtc::SmtcState::new())
        .invoke_handler(tauri::generate_handler![
            sidecar::get_api_runtime_config,
            reveal_path_in_folder,
            desktop_lyric::open_desktop_lyric,
            desktop_lyric::close_desktop_lyric,
            desktop_lyric::set_desktop_lyric_locked,
            desktop_lyric::desktop_lyric_is_open,
            smtc::smtc_set_enabled,
            smtc::smtc_update_metadata,
            smtc::smtc_update_playback
        ])
        // Tie the desktop-lyric overlay's lifetime to the main window. `Destroyed`
        // covers every real close path but not minimize-to-tray, which only hides
        // the window. Closing the overlay restores last-window exit semantics.
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, WindowEvent::Destroyed) {
                if let Some(overlay) = window.app_handle().get_webview_window("desktop-lyric") {
                    let _ = overlay.close();
                }
            }
        })
        .setup(|app| {
            let app_handle = app.handle();
            if let Err(error) = initialize_runtime(app_handle) {
                // Expected startup failures are delivered to the renderer through the
                // runtime-config command. Returning Ok keeps the diagnostic window
                // alive instead of escalating into Tauri's setup-hook panic.
                publish_startup_failure(app_handle, error);
            }

            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
            if let (Some(sidecar_state), Some(runtime_state)) = (
                app_handle.try_state::<sidecar::SidecarState>(),
                app_handle.try_state::<sidecar::ApiRuntimeState>(),
            ) {
                sidecar::stop(&sidecar_state, &runtime_state);
            }
        }
        _ => {}
    });
}

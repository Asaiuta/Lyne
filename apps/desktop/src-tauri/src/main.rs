use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, RunEvent, Runtime, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

mod desktop_lyric;
mod plugin_host;
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

/// Geometry of the main window captured at hide-to-tray time so a recreated
/// window restores position/size instead of re-centering.
#[derive(Default)]
struct MainWindowGeometry {
    position: Mutex<Option<(i32, i32)>>,
    size: Mutex<Option<(u32, u32)>>,
}

/// True while the main window is deliberately destroyed into the tray. In this
/// state `ExitRequested` is prevented so the sidecar keeps playing; the tray
/// "quit" menu item clears the flag and exits for real.
static MAIN_HIDDEN_IN_TRAY: AtomicBool = AtomicBool::new(false);

fn restore_main_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.show() {
            eprintln!("[audio-desktop] failed to show main window from tray: {error}");
        }
        if let Err(error) = window.unminimize() {
            eprintln!("[audio-desktop] failed to unminimize main window from tray: {error}");
        }
        if let Err(error) = window.set_focus() {
            eprintln!("[audio-desktop] failed to focus main window from tray: {error}");
        }
        MAIN_HIDDEN_IN_TRAY.store(false, Ordering::SeqCst);
        return;
    }

    // Recreate the main window after a hide-to-tray destroy. The frontend
    // restores the previous page through its navigation persistence and
    // re-syncs playback state from the still-running sidecar.
    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Lyne")
        .inner_size(1220.0, 780.0)
        .min_inner_size(980.0, 640.0)
        .resizable(true)
        .decorations(false)
        .visible(true);

    let window = match builder.build() {
        Ok(window) => window,
        Err(error) => {
            eprintln!("[audio-desktop] failed to recreate main window: {error}");
            return;
        }
    };

    if let Some(geometry) = app.try_state::<MainWindowGeometry>() {
        let position = geometry.position.lock().unwrap().take();
        let size = geometry.size.lock().unwrap().take();
        if let Some((x, y)) = position {
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        }
        if let Some((width, height)) = size {
            let _ = window.set_size(tauri::PhysicalSize::new(width, height));
        }
    }

    #[cfg(debug_assertions)]
    window.open_devtools();

    if let Err(error) = window.show() {
        eprintln!("[audio-desktop] failed to show recreated main window: {error}");
    }
    if let Err(error) = window.set_focus() {
        eprintln!("[audio-desktop] failed to focus recreated main window: {error}");
    }
    MAIN_HIDDEN_IN_TRAY.store(false, Ordering::SeqCst);
}

fn setup_tray<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    let quit = MenuItemBuilder::with_id("quit", "退出 Lyne").build(app)?;
    let menu = MenuBuilder::new(app).item(&quit).build()?;

    let mut tray = TrayIconBuilder::new()
        .tooltip("Lyne")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if event.id.as_ref() == "quit" {
                // Real exit: clear the tray-hidden flag so ExitRequested is not
                // prevented while the window list drains.
                MAIN_HIDDEN_IN_TRAY.store(false, Ordering::SeqCst);
                app.exit(0);
            }
        })
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

    sidecar::start(app, &sidecar_state, &runtime_state)?;

    if let Err(error) = plugin_host::start(
        app,
        &app.state::<plugin_host::PluginHostState>(),
        &runtime_state,
    ) {
        eprintln!("[audio-desktop] plugin host startup degraded: {error}");
    }
    Ok(())
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
        .manage(plugin_host::PluginHostState::empty())
        .manage(smtc::SmtcState::new())
        .manage(MainWindowGeometry::default())
        .invoke_handler(tauri::generate_handler![
            sidecar::get_api_runtime_config,
            plugin_host::plugin_host_list,
            plugin_host::plugin_host_set_enabled,
            plugin_host::plugin_host_update_settings,
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
            if window.label() == "main" {
                match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        // Hide-to-tray: destroy the webview so its renderer/GPU
                        // memory is released while the app stays in the tray;
                        // the tray recreates the window on click.
                        api.prevent_close();
                        if let Some(geometry) =
                            window.app_handle().try_state::<MainWindowGeometry>()
                        {
                            if let Ok(position) = window.outer_position() {
                                *geometry.position.lock().unwrap() =
                                    Some((position.x, position.y));
                            }
                            if let Ok(size) = window.inner_size() {
                                *geometry.size.lock().unwrap() =
                                    Some((size.width, size.height));
                            }
                        }
                        MAIN_HIDDEN_IN_TRAY.store(true, Ordering::SeqCst);
                        let _ = window.destroy();
                    }
                    WindowEvent::Destroyed => {
                        if let Some(overlay) =
                            window.app_handle().get_webview_window("desktop-lyric")
                        {
                            let _ = overlay.close();
                        }
                    }
                    _ => {}
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
        RunEvent::ExitRequested { api, .. } => {
            if MAIN_HIDDEN_IN_TRAY.load(Ordering::SeqCst) {
                // The main window was destroyed into the tray; keep the app and
                // the sidecar alive so playback continues. Real exits go through
                // the tray "quit" menu item (RunEvent::Exit).
                api.prevent_exit();
            } else {
                shutdown_backends(app_handle);
            }
        }
        RunEvent::Exit => shutdown_backends(app_handle),
        _ => {}
    });
}

fn shutdown_backends<R: Runtime>(app_handle: &tauri::AppHandle<R>) {
    if let Some(plugin_state) = app_handle.try_state::<plugin_host::PluginHostState>() {
        plugin_host::stop(&plugin_state);
    }
    if let (Some(sidecar_state), Some(runtime_state)) = (
        app_handle.try_state::<sidecar::SidecarState>(),
        app_handle.try_state::<sidecar::ApiRuntimeState>(),
    ) {
        sidecar::stop(&sidecar_state, &runtime_state);
    }
}

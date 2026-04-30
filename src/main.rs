//! Main Entry Point
//!
//! Standalone server binary for the Rust audio engine.
//!
//! Note: Zero-allocation audit for audio callback is handled in audio_thread.rs
//! by wrapping the callback with assert_no_alloc::assert_no_alloc().
//! We do NOT replace the global allocator here as it would crash env_logger
//! initialization during startup.

use audio_engine::{config::AppConfig, runtime, server, settings};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let runtime_paths = runtime::RuntimePaths::resolve();
    runtime_paths
        .ensure()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    runtime_paths.apply_to_process_env();
    runtime::init_file_logger(&runtime_paths)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

    log::info!("Hi-Fi Audio Engine v2.0.0 (Full Rust)");
    log::info!("Built with: Symphonia + cpal + actix-web");
    log::info!(
        "Runtime directories: data='{}', cache='{}', logs='{}', settings='{}', loudness_db='{}', app_db='{}'",
        runtime_paths.app_data_dir.display(),
        runtime_paths.cache_dir.display(),
        runtime_paths.log_dir.display(),
        runtime_paths.settings_path.display(),
        runtime_paths.loudness_db_path.display(),
        runtime_paths.app_db_path.display()
    );

    // Parse command line args
    let args: Vec<String> = std::env::args().collect();
    let port = args
        .iter()
        .position(|a| a == "--port")
        .and_then(|i| args.get(i + 1))
        .and_then(|p| p.parse().ok())
        .unwrap_or(63789);
    
    // Load config
    let config = AppConfig::load();

    // Create settings manager
    let settings_manager = settings::create_settings_manager(&runtime_paths.settings_path);

    // Run the server
    server::run_server(port, config, settings_manager, runtime_paths).await
}

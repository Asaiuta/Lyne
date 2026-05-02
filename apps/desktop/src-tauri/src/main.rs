use std::path::PathBuf;
use std::fs::OpenOptions;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use audio_runtime_paths::{
  ENV_APP_DATA_LEGACY,
  ENV_AUDIO_APP_DATA_DIR,
  ENV_AUDIO_APP_DB_PATH,
  ENV_AUDIO_CACHE_DIR,
  ENV_AUDIO_LOG_DIR,
  ENV_AUDIO_LOUDNESS_DB_PATH,
  ENV_AUDIO_SETTINGS_PATH,
};
use tauri::{Manager, RunEvent};

struct SidecarState(Mutex<Option<Child>>);

const ENV_AUDIO_ALLOWED_ORIGINS: &str = "AUDIO_ALLOWED_ORIGINS";

struct RuntimePaths {
  app_data_dir: PathBuf,
  cache_dir: PathBuf,
  log_dir: PathBuf,
  settings_path: PathBuf,
  loudness_db_path: PathBuf,
  app_db_path: PathBuf,
}

fn server_port() -> u16 {
  std::env::var("AUDIO_SERVER_PORT")
    .ok()
    .and_then(|value| value.parse::<u16>().ok())
    .unwrap_or(63790)
}

fn sidecar_dev_fallback_path() -> PathBuf {
  PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .join("..")
    .join("..")
    .join("..")
    .join("target")
    .join("release")
    .join("audio_server.exe")
}

fn resolve_sidecar_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
  if let Ok(path) = std::env::var("AUDIO_SERVER_PATH") {
    return Some(path.into());
  }

  let bundled = app.path_resolver()
    .resolve_resource("audio_server.exe")
    .or_else(|| app.path_resolver().resolve_resource("audio_server"))
    .or_else(|| app.path_resolver().resolve_resource("_up_/_up_/_up_/target/release/audio_server.exe"));
  if bundled.is_some() {
    return bundled;
  }

  let dev_fallback = sidecar_dev_fallback_path();
  if dev_fallback.exists() {
    return Some(dev_fallback);
  }

  None
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  app
    .path_resolver()
    .app_local_data_dir()
    .or_else(|| app.path_resolver().app_data_dir())
    .ok_or_else(|| "Could not resolve application data directory.".to_string())
}

fn app_cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  app
    .path_resolver()
    .app_cache_dir()
    .or_else(|| app.path_resolver().app_local_data_dir().map(|dir| dir.join("cache")))
    .or_else(|| app.path_resolver().app_data_dir().map(|dir| dir.join("cache")))
    .ok_or_else(|| "Could not resolve application cache directory.".to_string())
}

fn runtime_paths(app: &tauri::AppHandle) -> Result<RuntimePaths, String> {
  let app_data_dir = app_data_dir(app)?;
  let cache_dir = app_cache_dir(app)?;
  let log_dir = app_data_dir.join("logs");
  let settings_path = app_data_dir.join("audio_settings.json");
  let loudness_db_path = app_data_dir.join("loudness_cache.db");
  let app_db_path = app_data_dir.join("app_state.db");

  Ok(RuntimePaths {
    app_data_dir,
    cache_dir,
    log_dir,
    settings_path,
    loudness_db_path,
    app_db_path,
  })
}

fn ensure_dir(path: &PathBuf) -> Result<(), String> {
  std::fs::create_dir_all(path)
    .map_err(|error| format!("Failed to create runtime directory '{}': {error}", path.display()))
}

fn ensure_runtime_dirs(paths: &RuntimePaths) -> Result<(), String> {
  ensure_dir(&paths.app_data_dir)?;
  ensure_dir(&paths.cache_dir)?;
  ensure_dir(&paths.log_dir)?;
  Ok(())
}

fn sidecar_stdio(paths: &RuntimePaths) -> Result<(Stdio, Stdio), String> {
  let bootstrap_log_path = paths.log_dir.join("audio_server-bootstrap.log");
  let file = OpenOptions::new()
    .create(true)
    .append(true)
    .open(&bootstrap_log_path)
    .map_err(|error| format!("Failed to open sidecar bootstrap log '{}': {error}", bootstrap_log_path.display()))?;
  let stderr = file
    .try_clone()
    .map_err(|error| format!("Failed to clone sidecar bootstrap log handle: {error}"))?;

  Ok((Stdio::from(file), Stdio::from(stderr)))
}

fn wait_for_server_ready(port: u16, timeout: Duration) -> Result<(), String> {
  let client = reqwest::blocking::Client::builder()
    .timeout(Duration::from_millis(500))
    .build()
    .map_err(|error| format!("Failed to build sidecar readiness client: {error}"))?;
  let deadline = Instant::now() + timeout;
  let url = format!("http://127.0.0.1:{port}/state");
  let mut last_error = None;

  while Instant::now() < deadline {
    match client.get(&url).send() {
      Ok(response) if response.status().is_success() => return Ok(()),
      Ok(response) => {
        last_error = Some(format!("health check returned {}", response.status()));
      }
      Err(error) => {
        last_error = Some(error.to_string());
      }
    }

    std::thread::sleep(Duration::from_millis(125));
  }

  Err(format!(
    "Audio server did not become ready within {}s{}",
    timeout.as_secs(),
    last_error
      .map(|error| format!(" ({error})"))
      .unwrap_or_default()
  ))
}

fn request_sidecar_shutdown(port: u16) {
  let client = match reqwest::blocking::Client::builder()
    .timeout(Duration::from_secs(1))
    .build()
  {
    Ok(client) => client,
    Err(_) => return,
  };

  let _ = client.post(format!("http://127.0.0.1:{port}/shutdown")).send();
}

fn spawn_sidecar(app: &tauri::AppHandle) -> Result<Child, String> {
  let port = server_port();
  let path = resolve_sidecar_path(app)
    .ok_or_else(|| "Audio server binary not found. Set AUDIO_SERVER_PATH or build the sidecar.".to_string())?;
  let sidecar_dir = path
    .parent()
    .map(PathBuf::from)
    .ok_or_else(|| format!("Audio server path '{}' has no parent directory.", path.display()))?;
  let runtime = runtime_paths(app)?;

  ensure_runtime_dirs(&runtime)?;
  let (stdout, stderr) = sidecar_stdio(&runtime)?;

  let mut command = Command::new(path);
  command
    .arg("--port")
    .arg(port.to_string())
    .env(ENV_AUDIO_APP_DATA_DIR, &runtime.app_data_dir)
    .env(ENV_APP_DATA_LEGACY, &runtime.app_data_dir)
    .env(ENV_AUDIO_CACHE_DIR, &runtime.cache_dir)
    .env(ENV_AUDIO_LOG_DIR, &runtime.log_dir)
    .env(ENV_AUDIO_SETTINGS_PATH, &runtime.settings_path)
    .env(ENV_AUDIO_LOUDNESS_DB_PATH, &runtime.loudness_db_path)
    .env(ENV_AUDIO_APP_DB_PATH, &runtime.app_db_path)
    .env(
      ENV_AUDIO_ALLOWED_ORIGINS,
      "tauri://localhost,http://localhost:5173,http://127.0.0.1:5173,https://tauri.localhost,http://tauri.localhost,null"
    )
    .current_dir(sidecar_dir)
    .stdout(stdout)
    .stderr(stderr);

  let mut child = command.spawn().map_err(|error| format!("Failed to launch audio server: {error}"))?;
  if let Err(error) = wait_for_server_ready(port, Duration::from_secs(10)) {
    let _ = child.kill();
    let _ = child.wait();
    return Err(error);
  }

  Ok(child)
}

fn stop_sidecar(state: &SidecarState) {
  if let Ok(mut guard) = state.0.lock() {
    if let Some(mut child) = guard.take() {
      request_sidecar_shutdown(server_port());

      let deadline = Instant::now() + Duration::from_secs(8);
      while Instant::now() < deadline {
        match child.try_wait() {
          Ok(Some(_)) => return,
          Ok(None) => std::thread::sleep(Duration::from_millis(100)),
          Err(_) => break,
        }
      }

      let _ = child.kill();
      let _ = child.wait();
    }
  }
}

fn main() {
  let app = tauri::Builder::default()
    .setup(|app| {
      let child = spawn_sidecar(&app.handle())?;
      app.manage(SidecarState(Mutex::new(Some(child))));
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|app_handle, event| match event {
    RunEvent::ExitRequested { .. } | RunEvent::Exit { .. } => {
      if let Some(state) = app_handle.try_state::<SidecarState>() {
        stop_sidecar(&state);
      }
    }
    _ => {}
  });
}

use std::path::PathBuf;
use std::fs::OpenOptions;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
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
use rand::RngCore;
use tauri::{path::BaseDirectory, Manager, RunEvent};

struct SidecarState {
  child: Mutex<Option<Child>>,
  shutdown_requested: AtomicBool,
}

impl SidecarState {
  fn new() -> Self {
    Self {
      child: Mutex::new(None),
      shutdown_requested: AtomicBool::new(false),
    }
  }
}

/// Per-run bearer token shared with the audio sidecar. Generated once at startup
/// and exposed to the renderer via the `get_api_token` Tauri command.
struct ApiToken(String);

const ENV_AUDIO_ALLOWED_ORIGINS: &str = "AUDIO_ALLOWED_ORIGINS";

/// Environment variable carrying the per-run bearer token to the audio sidecar.
/// Must stay in sync with `audio_engine::server::ENV_AUDIO_API_TOKEN`.
const ENV_AUDIO_API_TOKEN: &str = "AUDIO_API_TOKEN";

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

/// Generate a 256-bit cryptographically random token, hex-encoded (64 chars).
fn generate_api_token() -> String {
  let mut bytes = [0u8; 32];
  rand::rngs::OsRng.fill_bytes(&mut bytes);
  hex::encode(bytes)
}

#[tauri::command]
fn get_api_token(token: tauri::State<'_, ApiToken>) -> String {
  token.0.clone()
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

fn sidecar_target_dir_fallback_path() -> Option<PathBuf> {
  let target_dir = std::env::var_os("CARGO_TARGET_DIR")?;
  let candidate = PathBuf::from(target_dir)
    .join("release")
    .join("audio_server.exe");
  candidate.exists().then_some(candidate)
}

fn resolve_sidecar_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
  if let Ok(path) = std::env::var("AUDIO_SERVER_PATH") {
    return Some(path.into());
  }

  if let Some(path) = sidecar_target_dir_fallback_path() {
    return Some(path);
  }

  let resolver = app.path();
  let bundled = resolver
    .resolve("audio_server.exe", BaseDirectory::Resource)
    .ok()
    .or_else(|| resolver.resolve("audio_server", BaseDirectory::Resource).ok())
    .or_else(|| {
      resolver
        .resolve(
          "_up_/_up_/_up_/target/release/audio_server.exe",
          BaseDirectory::Resource,
        )
        .ok()
    });
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
  let resolver = app.path();
  resolver
    .app_local_data_dir()
    .or_else(|_| resolver.app_data_dir())
    .map_err(|error| format!("Could not resolve application data directory: {error}"))
}

fn app_cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let resolver = app.path();
  resolver
    .app_cache_dir()
    .or_else(|_| resolver.app_local_data_dir().map(|dir| dir.join("cache")))
    .or_else(|_| resolver.app_data_dir().map(|dir| dir.join("cache")))
    .map_err(|error| format!("Could not resolve application cache directory: {error}"))
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

fn sidecar_stdio(paths: &RuntimePaths) -> Result<(std::fs::File, std::fs::File), String> {
  let bootstrap_log_path = paths.log_dir.join("audio_server-bootstrap.log");
  let file = OpenOptions::new()
    .create(true)
    .append(true)
    .open(&bootstrap_log_path)
    .map_err(|error| format!("Failed to open sidecar bootstrap log '{}': {error}", bootstrap_log_path.display()))?;
  let stderr = file
    .try_clone()
    .map_err(|error| format!("Failed to clone sidecar bootstrap log handle: {error}"))?;

  Ok((file, stderr))
}

fn wait_for_server_ready(port: u16, token: &str, timeout: Duration) -> Result<(), String> {
  let client = reqwest::blocking::Client::builder()
    .timeout(Duration::from_millis(500))
    .build()
    .map_err(|error| format!("Failed to build sidecar readiness client: {error}"))?;
  let deadline = Instant::now() + timeout;
  let url = format!("http://127.0.0.1:{port}/state");
  let bearer = format!("Bearer {token}");
  let mut last_error = None;

  while Instant::now() < deadline {
    match client
      .get(&url)
      .header(reqwest::header::AUTHORIZATION, &bearer)
      .send()
    {
      Ok(response) if response.status().is_success() => return Ok(()),
      Ok(response) if response.status() == reqwest::StatusCode::UNAUTHORIZED => {
        return Err("health check returned 401 unauthorized".to_string());
      }
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

fn request_sidecar_shutdown(port: u16, token: &str) {
  let client = match reqwest::blocking::Client::builder()
    .timeout(Duration::from_secs(1))
    .build()
  {
    Ok(client) => client,
    Err(_) => return,
  };

  let _ = client
    .post(format!("http://127.0.0.1:{port}/shutdown"))
    .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
    .send();
}

#[cfg(windows)]
fn cleanup_stale_sidecar_on_port(port: u16) {
  let lookup = Command::new("powershell")
    .args([
      "-NoProfile",
      "-Command",
      &format!(
        "(Get-NetTCPConnection -LocalPort {} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess)",
        port
      ),
    ])
    .output();

  let Ok(output) = lookup else {
    return;
  };

  let stdout = String::from_utf8_lossy(&output.stdout);
  for line in stdout.lines() {
    let trimmed = line.trim();
    let Ok(pid) = trimmed.parse::<u32>() else {
      continue;
    };

    let inspect = Command::new("powershell")
      .args([
        "-NoProfile",
        "-Command",
        &format!("(Get-Process -Id {} -ErrorAction SilentlyContinue).ProcessName", pid),
      ])
      .output();

    let Ok(process_output) = inspect else {
      continue;
    };

    let process_name = String::from_utf8_lossy(&process_output.stdout).trim().to_ascii_lowercase();
    if process_name != "audio_server" {
      continue;
    }

    let _ = Command::new("taskkill")
      .args(["/PID", &pid.to_string(), "/F", "/T"])
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .status();
    eprintln!(
      "[audio-desktop] cleaned up stale audio_server pid {} on port {}",
      pid, port
    );
  }
}

#[cfg(not(windows))]
fn cleanup_stale_sidecar_on_port(_port: u16) {}

fn spawn_sidecar(app: &tauri::AppHandle, token: &str) -> Result<Child, String> {
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

  let launch_child = || -> Result<Child, String> {
    let mut command = Command::new(&path);
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
      .env(ENV_AUDIO_API_TOKEN, token)
      .env(
        ENV_AUDIO_ALLOWED_ORIGINS,
        "tauri://localhost,http://localhost:5173,http://127.0.0.1:5173,https://tauri.localhost,http://tauri.localhost,null"
      )
      .current_dir(&sidecar_dir)
      .stdout(Stdio::from(stdout.try_clone().map_err(|error| format!("Failed to clone stdout log handle: {error}"))?))
      .stderr(Stdio::from(stderr.try_clone().map_err(|error| format!("Failed to clone stderr log handle: {error}"))?));

    let mut last_error = None;
    loop {
      match command.spawn() {
        Ok(child) => {
          if let Some(error) = last_error.take() {
            eprintln!(
              "[audio-desktop] audio_server spawn hit transient permission denied before succeeding: {error}"
            );
          }
          return Ok(child);
        }
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
          last_error = Some(error);
          std::thread::sleep(Duration::from_millis(250));
        }
        Err(error) => {
          return Err(format!("Failed to launch audio server: {error}"));
        }
      }
    }
  };

  cleanup_stale_sidecar_on_port(port);
  let mut child = launch_child()?;

  match wait_for_server_ready(port, token, Duration::from_secs(10)) {
    Ok(()) => Ok(child),
    Err(error) if error.contains("401 unauthorized") => {
      let _ = child.kill();
      let _ = child.wait();
      cleanup_stale_sidecar_on_port(port);
      child = launch_child()?;
      if let Err(retry_error) = wait_for_server_ready(port, token, Duration::from_secs(10)) {
        let _ = child.kill();
        let _ = child.wait();
        Err(format!(
          "Audio server stayed on a stale auth token after retry: {retry_error}"
        ))
      } else {
        Ok(child)
      }
    }
    Err(error) => {
      let _ = child.kill();
      let _ = child.wait();
      Err(error)
    }
  }
}

fn stop_sidecar(state: &SidecarState, token: &str) {
  state.shutdown_requested.store(true, Ordering::SeqCst);

  if let Ok(mut guard) = state.child.lock() {
    if let Some(mut child) = guard.take() {
      request_sidecar_shutdown(server_port(), token);

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
  let token_value = generate_api_token();

  let app = tauri::Builder::default()
    .manage(SidecarState::new())
    .manage(ApiToken(token_value.clone()))
    .invoke_handler(tauri::generate_handler![get_api_token])
    .setup(move |app| {
      let app_handle = app.handle();
      let mut child = spawn_sidecar(&app_handle, &token_value)?;

      if let Some(state) = app_handle.try_state::<SidecarState>() {
        if state.shutdown_requested.load(Ordering::SeqCst) {
          request_sidecar_shutdown(server_port(), &token_value);
          let _ = child.kill();
          let _ = child.wait();
        } else if let Ok(mut guard) = state.child.lock() {
          *guard = Some(child);
        } else {
          let _ = child.kill();
          let _ = child.wait();
          return Err("Failed to store sidecar process handle.".to_string().into());
        }
      } else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Failed to access sidecar application state during setup.".to_string().into());
      }

      // Open devtools in debug builds to diagnose console errors
      #[cfg(debug_assertions)]
      {
        if let Some(window) = app.get_webview_window("main") {
          window.open_devtools();
        }
      }

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|app_handle, event| match event {
    RunEvent::ExitRequested { .. } | RunEvent::Exit => {
      let token = app_handle
        .try_state::<ApiToken>()
        .map(|t| t.0.clone())
        .unwrap_or_default();
      if let Some(state) = app_handle.try_state::<SidecarState>() {
        stop_sidecar(&state, &token);
      }
    }
    _ => {}
  });
}

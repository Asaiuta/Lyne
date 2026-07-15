use std::env;
use std::ffi::OsStr;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use audio_runtime_paths::{
    ENV_APP_DATA_LEGACY, ENV_AUDIO_APP_DATA_DIR, ENV_AUDIO_APP_DB_PATH, ENV_AUDIO_CACHE_DIR,
    ENV_AUDIO_LOG_DIR, ENV_AUDIO_LOUDNESS_DB_PATH, ENV_AUDIO_SETTINGS_PATH,
};
use rand::RngCore;
use serde::Serialize;
use tauri::{path::BaseDirectory, Manager};

const BOOTSTRAP_LOG_TAIL_BYTES: u64 = 8 * 1024;
const ENV_AUDIO_ALLOWED_ORIGINS: &str = "AUDIO_ALLOWED_ORIGINS";
const ENV_AUDIO_API_TOKEN: &str = "AUDIO_API_TOKEN";
const ENV_AUDIO_APP_ROOT_PID: &str = "AUDIO_APP_ROOT_PID";
const ENV_AUDIO_SERVER_PORT: &str = "AUDIO_SERVER_PORT";
const SIDECAR_DEV_PROFILE: &str = "audio-dev";
const SIDECAR_PERMISSION_DENIED_RETRY_INTERVAL: Duration = Duration::from_millis(250);
const SIDECAR_PERMISSION_DENIED_RETRY_TIMEOUT: Duration = Duration::from_secs(10);
const SIDECAR_RELEASE_PROFILE: &str = "release";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiRuntimeConfig {
    pub base_url: String,
    pub port: u16,
    pub token: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ApiRuntimeStatus {
    Pending,
    Ready { port: u16 },
    Failed { message: String },
}

pub struct ApiRuntimeState {
    token: String,
    status: Mutex<ApiRuntimeStatus>,
}

impl ApiRuntimeState {
    pub fn new(token: String) -> Self {
        Self {
            token,
            status: Mutex::new(ApiRuntimeStatus::Pending),
        }
    }

    fn token(&self) -> &str {
        &self.token
    }

    pub fn mark_ready(&self, port: u16) -> Result<(), String> {
        let mut status = self.status.lock().map_err(|_| {
            "Failed to lock API runtime state while publishing readiness.".to_string()
        })?;
        *status = ApiRuntimeStatus::Ready { port };
        Ok(())
    }

    pub fn mark_failed(&self, message: impl Into<String>) -> Result<(), String> {
        let mut status = self.status.lock().map_err(|_| {
            "Failed to lock API runtime state while publishing failure.".to_string()
        })?;
        *status = ApiRuntimeStatus::Failed {
            message: message.into(),
        };
        Ok(())
    }

    fn snapshot(&self) -> Result<ApiRuntimeConfig, String> {
        let status = self.status.lock().map_err(|_| {
            "Failed to lock API runtime state while reading configuration.".to_string()
        })?;

        match &*status {
            ApiRuntimeStatus::Pending => Err("Audio sidecar is still initializing.".to_string()),
            ApiRuntimeStatus::Ready { port } => Ok(ApiRuntimeConfig {
                base_url: format!("http://127.0.0.1:{port}"),
                port: *port,
                token: self.token.clone(),
            }),
            ApiRuntimeStatus::Failed { message } => Err(message.clone()),
        }
    }
}

struct RunningSidecar {
    child: Child,
    port: u16,
}

pub struct SidecarState {
    process: Mutex<Option<RunningSidecar>>,
    shutdown_requested: AtomicBool,
}

impl SidecarState {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
            shutdown_requested: AtomicBool::new(false),
        }
    }
}

struct ReservedSidecarPort {
    listener: TcpListener,
    port: u16,
}

impl ReservedSidecarPort {
    fn reserve() -> Result<Self, String> {
        match env::var_os(ENV_AUDIO_SERVER_PORT) {
            Some(raw) => {
                let port = parse_explicit_port(&raw)?;
                cleanup_stale_sidecar_on_port(port);
                Self::bind(port).map_err(|error| {
                    format!(
            "Explicit {ENV_AUDIO_SERVER_PORT}={port} is unavailable on 127.0.0.1: {error}"
          )
                })
            }
            None => Self::bind(0).map_err(|error| {
                format!("Failed to reserve a dynamic audio sidecar port: {error}")
            }),
        }
    }

    fn bind(port: u16) -> std::io::Result<Self> {
        let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port))?;
        let port = listener.local_addr()?.port();
        Ok(Self { listener, port })
    }

    fn port(&self) -> u16 {
        self.port
    }
}

struct RuntimePaths {
    app_data_dir: PathBuf,
    cache_dir: PathBuf,
    log_dir: PathBuf,
    settings_path: PathBuf,
    loudness_db_path: PathBuf,
    app_db_path: PathBuf,
}

struct SidecarStdio {
    stdout: File,
    stderr: File,
    log_path: PathBuf,
}

enum ReadinessError {
    Unauthorized,
    Failed(String),
}

pub fn generate_api_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

#[tauri::command]
pub fn get_api_runtime_config(
    state: tauri::State<'_, ApiRuntimeState>,
) -> Result<ApiRuntimeConfig, String> {
    state.snapshot()
}

pub fn start(
    app: &tauri::AppHandle,
    state: &SidecarState,
    runtime_state: &ApiRuntimeState,
) -> Result<(), String> {
    let mut process = spawn_sidecar(app, runtime_state.token())?;
    let port = process.port;

    if state.shutdown_requested.load(Ordering::SeqCst) {
        request_sidecar_shutdown(port, runtime_state.token());
        let _ = process.child.kill();
        let _ = process.child.wait();
        return Err(
            "Application shutdown was requested while the audio sidecar was starting.".to_string(),
        );
    }

    {
        let mut guard = state.process.lock().map_err(|_| {
            "Failed to lock sidecar state while storing the child process.".to_string()
        })?;
        *guard = Some(process);
    }

    if let Err(error) = runtime_state.mark_ready(port) {
        stop(state, runtime_state);
        return Err(error);
    }

    Ok(())
}

pub fn stop(state: &SidecarState, runtime_state: &ApiRuntimeState) {
    state.shutdown_requested.store(true, Ordering::SeqCst);

    let Ok(mut guard) = state.process.lock() else {
        eprintln!("[audio-desktop] failed to lock sidecar state during shutdown");
        return;
    };

    if let Some(mut process) = guard.take() {
        request_sidecar_shutdown(process.port, runtime_state.token());

        let deadline = Instant::now() + Duration::from_secs(8);
        while Instant::now() < deadline {
            match process.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(_) => break,
            }
        }

        let _ = process.child.kill();
        let _ = process.child.wait();
    }
}

fn parse_explicit_port(raw: &OsStr) -> Result<u16, String> {
    let value = raw.to_string_lossy();
    let port = value
        .parse::<u16>()
        .map_err(|error| format!("Invalid {ENV_AUDIO_SERVER_PORT} value '{value}': {error}"))?;
    if port == 0 {
        return Err(format!(
      "Invalid {ENV_AUDIO_SERVER_PORT} value '{value}': explicit port must be between 1 and 65535."
    ));
    }
    Ok(port)
}

fn sidecar_profile_dir() -> &'static str {
    if cfg!(debug_assertions) {
        SIDECAR_DEV_PROFILE
    } else {
        SIDECAR_RELEASE_PROFILE
    }
}

fn sidecar_repo_target_fallback_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("target")
        .join(sidecar_profile_dir())
        .join("audio_server.exe")
}

fn sidecar_target_dir_fallback_path() -> Option<PathBuf> {
    let target_dir = env::var_os("CARGO_TARGET_DIR")?;
    let target_dir = PathBuf::from(target_dir);
    let candidate = target_dir
        .join(sidecar_profile_dir())
        .join("audio_server.exe");
    if candidate.exists() {
        return Some(candidate);
    }

    if cfg!(debug_assertions) {
        let release_candidate = target_dir
            .join(SIDECAR_RELEASE_PROFILE)
            .join("audio_server.exe");
        return release_candidate.exists().then_some(release_candidate);
    }

    None
}

fn resolve_sidecar_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(path) = env::var("AUDIO_SERVER_PATH") {
        return Some(path.into());
    }

    if let Some(path) = sidecar_target_dir_fallback_path() {
        return Some(path);
    }

    let resolver = app.path();
    let bundled = resolver
        .resolve("audio_server.exe", BaseDirectory::Resource)
        .ok()
        .or_else(|| {
            resolver
                .resolve("audio_server", BaseDirectory::Resource)
                .ok()
        })
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

    let dev_fallback = sidecar_repo_target_fallback_path();
    dev_fallback.exists().then_some(dev_fallback)
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

    Ok(RuntimePaths {
        settings_path: app_data_dir.join("audio_settings.json"),
        loudness_db_path: app_data_dir.join("loudness_cache.db"),
        app_db_path: app_data_dir.join("app_state.db"),
        app_data_dir,
        cache_dir,
        log_dir,
    })
}

fn ensure_runtime_dirs(paths: &RuntimePaths) -> Result<(), String> {
    for path in [&paths.app_data_dir, &paths.cache_dir, &paths.log_dir] {
        std::fs::create_dir_all(path).map_err(|error| {
            format!(
                "Failed to create runtime directory '{}': {error}",
                path.display()
            )
        })?;
    }
    Ok(())
}

fn sidecar_stdio(paths: &RuntimePaths, port: u16, path: &Path) -> Result<SidecarStdio, String> {
    let log_path = paths.log_dir.join("audio_server-bootstrap.log");
    let mut stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| {
            format!(
                "Failed to open sidecar bootstrap log '{}': {error}",
                log_path.display()
            )
        })?;
    writeln!(
        stdout,
        "\n[audio-desktop] launching '{}' on 127.0.0.1:{port}",
        path.display()
    )
    .map_err(|error| {
        format!(
            "Failed to write launch marker to sidecar bootstrap log '{}': {error}",
            log_path.display()
        )
    })?;
    let stderr = stdout
        .try_clone()
        .map_err(|error| format!("Failed to clone sidecar bootstrap log handle: {error}"))?;

    Ok(SidecarStdio {
        stdout,
        stderr,
        log_path,
    })
}

fn spawn_sidecar(app: &tauri::AppHandle, token: &str) -> Result<RunningSidecar, String> {
    let reservation = ReservedSidecarPort::reserve()?;
    let port = reservation.port();
    let path = resolve_sidecar_path(app).ok_or_else(|| {
        "Audio server binary not found. Set AUDIO_SERVER_PATH or build the sidecar.".to_string()
    })?;
    let sidecar_dir = path.parent().map(PathBuf::from).ok_or_else(|| {
        format!(
            "Audio server path '{}' has no parent directory.",
            path.display()
        )
    })?;
    let runtime = runtime_paths(app)?;

    ensure_runtime_dirs(&runtime)?;
    let stdio = sidecar_stdio(&runtime, port, &path)?;

    let launch_child = || -> Result<Child, String> {
        let mut command = Command::new(&path);
        command
      .arg("--port")
      .arg(port.to_string())
      .env(ENV_AUDIO_APP_ROOT_PID, std::process::id().to_string())
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
        "tauri://localhost,http://localhost:5173,http://127.0.0.1:5173,https://tauri.localhost,http://tauri.localhost,null",
      )
      .current_dir(&sidecar_dir)
      .stdout(Stdio::from(stdio.stdout.try_clone().map_err(|error| {
        format!("Failed to clone sidecar stdout log handle: {error}")
      })?))
      .stderr(Stdio::from(stdio.stderr.try_clone().map_err(|error| {
        format!("Failed to clone sidecar stderr log handle: {error}")
      })?));

        let retry_deadline = Instant::now() + SIDECAR_PERMISSION_DENIED_RETRY_TIMEOUT;
        let mut last_error = None;
        let mut permission_denied_attempts = 0;
        loop {
            match command.spawn() {
                Ok(child) => {
                    if let Some(error) = last_error.take() {
                        eprintln!(
              "[audio-desktop] audio_server spawn hit {permission_denied_attempts} transient permission denied error(s) before succeeding: {error}"
            );
                    }
                    return Ok(child);
                }
                Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                    permission_denied_attempts += 1;
                    if Instant::now() >= retry_deadline {
                        return Err(format!(
              "Failed to launch audio server '{}' after retrying permission denied for {}ms ({} attempt(s)): {}",
              path.display(),
              SIDECAR_PERMISSION_DENIED_RETRY_TIMEOUT.as_millis(),
              permission_denied_attempts,
              error
            ));
                    }
                    last_error = Some(error);
                    let retry_delay = retry_deadline
                        .saturating_duration_since(Instant::now())
                        .min(SIDECAR_PERMISSION_DENIED_RETRY_INTERVAL);
                    if !retry_delay.is_zero() {
                        std::thread::sleep(retry_delay);
                    }
                }
                Err(error) => {
                    return Err(format!(
                        "Failed to launch audio server '{}': {error}",
                        path.display()
                    ));
                }
            }
        }
    };

    // Keep the selected port reserved until the child command is fully prepared.
    drop(reservation.listener);
    let mut child = launch_child()?;

    match wait_for_server_ready(
        &mut child,
        &path,
        port,
        token,
        Duration::from_secs(10),
        &stdio.log_path,
    ) {
        Ok(()) => Ok(RunningSidecar { child, port }),
        Err(ReadinessError::Unauthorized) => {
            let _ = child.kill();
            let _ = child.wait();
            cleanup_stale_sidecar_on_port(port);
            child = launch_child()?;
            match wait_for_server_ready(
                &mut child,
                &path,
                port,
                token,
                Duration::from_secs(10),
                &stdio.log_path,
            ) {
                Ok(()) => Ok(RunningSidecar { child, port }),
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    Err(format!(
                        "Audio server stayed on a stale auth token after retry: {}",
                        readiness_error_message(error)
                    ))
                }
            }
        }
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(readiness_error_message(error))
        }
    }
}

fn wait_for_server_ready(
    child: &mut Child,
    executable_path: &Path,
    port: u16,
    token: &str,
    timeout: Duration,
    log_path: &Path,
) -> Result<(), ReadinessError> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
        .map_err(|error| {
            ReadinessError::Failed(format!("Failed to build sidecar readiness client: {error}"))
        })?;
    let deadline = Instant::now() + timeout;
    let url = format!("http://127.0.0.1:{port}/state");
    let bearer = format!("Bearer {token}");
    let mut last_error = None;

    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(status)) => {
                let message = format!(
                    "Audio server '{}' exited before readiness on port {port}: {}",
                    executable_path.display(),
                    describe_exit_status(status)
                );
                return Err(ReadinessError::Failed(with_bootstrap_log_tail(
                    message, log_path,
                )));
            }
            Ok(None) => {}
            Err(error) => {
                return Err(ReadinessError::Failed(with_bootstrap_log_tail(
                    format!(
                        "Failed to inspect audio server '{}' while waiting on port {port}: {error}",
                        executable_path.display()
                    ),
                    log_path,
                )));
            }
        }

        match client
            .get(&url)
            .header(reqwest::header::AUTHORIZATION, &bearer)
            .send()
        {
            Ok(response) if response.status().is_success() => return Ok(()),
            Ok(response) if response.status() == reqwest::StatusCode::UNAUTHORIZED => {
                return Err(ReadinessError::Unauthorized);
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

    let detail = last_error
        .map(|error| format!("; last health error: {error}"))
        .unwrap_or_default();
    Err(ReadinessError::Failed(with_bootstrap_log_tail(
        format!(
            "Audio server '{}' did not become ready on port {port} within {}s{detail}",
            executable_path.display(),
            timeout.as_secs()
        ),
        log_path,
    )))
}

fn readiness_error_message(error: ReadinessError) -> String {
    match error {
        ReadinessError::Unauthorized => "health check returned 401 unauthorized".to_string(),
        ReadinessError::Failed(message) => message,
    }
}

fn describe_exit_status(status: ExitStatus) -> String {
    match status.code() {
        Some(code) => format!("exit code {code} ({})", format_windows_exit_code(code)),
        None => status.to_string(),
    }
}

fn format_windows_exit_code(code: i32) -> String {
    format!("0x{:08X}", code as u32)
}

fn with_bootstrap_log_tail(message: String, log_path: &Path) -> String {
    match read_log_tail(log_path, BOOTSTRAP_LOG_TAIL_BYTES) {
        Ok(tail) if !tail.is_empty() => format!(
            "{message}\nBootstrap log tail ({}):\n{tail}",
            log_path.display()
        ),
        Ok(_) => message,
        Err(error) => format!(
            "{message}\nFailed to read bootstrap log '{}': {error}",
            log_path.display()
        ),
    }
}

fn read_log_tail(path: &Path, max_bytes: u64) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    let start = len.saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start))?;

    let mut bytes = Vec::with_capacity((len - start) as usize);
    file.read_to_end(&mut bytes)?;
    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    if start > 0 {
        if let Some(first_newline) = text.find('\n') {
            text.drain(..=first_newline);
        }
    }
    Ok(text.trim().to_string())
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
                &format!(
                    "(Get-Process -Id {} -ErrorAction SilentlyContinue).ProcessName",
                    pid
                ),
            ])
            .output();

        let Ok(process_output) = inspect else {
            continue;
        };

        let process_name = String::from_utf8_lossy(&process_output.stdout)
            .trim()
            .to_ascii_lowercase();
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn explicit_port_must_be_a_non_zero_u16() {
        assert_eq!(parse_explicit_port(OsStr::new("18083")), Ok(18083));
        assert!(parse_explicit_port(OsStr::new("0")).is_err());
        assert!(parse_explicit_port(OsStr::new("not-a-port")).is_err());
        assert!(parse_explicit_port(OsStr::new("65536")).is_err());
    }

    #[test]
    fn dynamic_reservation_owns_the_selected_port_until_drop() {
        let reservation = ReservedSidecarPort::bind(0).expect("reserve dynamic port");
        let port = reservation.port();
        assert!(port > 0);
        assert!(TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_err());
        drop(reservation);
        let rebound = TcpListener::bind((Ipv4Addr::LOCALHOST, port)).expect("rebind released port");
        drop(rebound);
    }

    #[test]
    fn runtime_config_is_unavailable_until_ready_and_preserves_failures() {
        let state = ApiRuntimeState::new("a".repeat(64));
        assert_eq!(
            state.snapshot(),
            Err("Audio sidecar is still initializing.".to_string())
        );

        state.mark_ready(18083).expect("publish ready state");
        assert_eq!(
            state.snapshot().expect("ready snapshot"),
            ApiRuntimeConfig {
                base_url: "http://127.0.0.1:18083".to_string(),
                port: 18083,
                token: "a".repeat(64),
            }
        );

        state
            .mark_failed("sidecar failed")
            .expect("publish failed state");
        assert_eq!(state.snapshot(), Err("sidecar failed".to_string()));
    }

    #[test]
    fn windows_exit_codes_include_hex_status() {
        assert_eq!(format_windows_exit_code(-1073741515), "0xC0000135");
        assert_eq!(format_windows_exit_code(101), "0x00000065");
    }

    #[test]
    fn log_tail_is_bounded_and_drops_a_partial_first_line() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let path = env::temp_dir().join(format!(
            "lyne-sidecar-log-tail-{}-{nonce}.log",
            std::process::id()
        ));
        fs::write(&path, "first line\nsecond line\nthird line\n").expect("write fixture");

        let tail = read_log_tail(&path, 24).expect("read log tail");
        assert_eq!(tail, "second line\nthird line");
        let _ = fs::remove_file(path);
    }
}

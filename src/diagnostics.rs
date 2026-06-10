use serde::Serialize;

const BYTES_PER_MIB: u64 = 1024 * 1024;
pub const ENV_AUDIO_APP_ROOT_PID: &str = "AUDIO_APP_ROOT_PID";

pub use audio_engine_core::diagnostics::{
    decode_memory_budget, DecodeMemoryBudget, DEFAULT_DECODE_MAX_MEMORY_MB,
    ENV_DECODE_MAX_MEMORY_MB, MAX_DECODE_MAX_MEMORY_MB, MIN_DECODE_MAX_MEMORY_MB,
};

#[derive(Debug, Clone, Serialize)]
pub struct ProcessMemorySnapshot {
    pub available: bool,
    pub working_set_bytes: Option<u64>,
    pub private_bytes: Option<u64>,
    pub source: &'static str,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessCpuSnapshot {
    pub available: bool,
    pub kernel_time_ms: Option<u64>,
    pub user_time_ms: Option<u64>,
    pub total_time_ms: Option<u64>,
    pub source: &'static str,
    pub error: Option<String>,
}

pub fn process_cpu_snapshot() -> ProcessCpuSnapshot {
    platform_process_cpu_snapshot()
}

pub fn process_memory_snapshot() -> ProcessMemorySnapshot {
    platform_process_memory_snapshot()
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessTreeProcessSnapshot {
    pub pid: u32,
    pub parent_pid: u32,
    pub name: String,
    pub working_set_bytes: Option<u64>,
    pub private_bytes: Option<u64>,
    pub cpu_total_time_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessTreeSnapshot {
    pub available: bool,
    pub root_pid: u32,
    pub self_pid: u32,
    pub root_source: &'static str,
    pub source: &'static str,
    pub process_count: usize,
    pub skipped_process_count: usize,
    pub total_working_set_bytes: u64,
    pub total_private_bytes: u64,
    pub total_cpu_time_ms: u64,
    pub processes: Vec<ProcessTreeProcessSnapshot>,
    pub error: Option<String>,
}

pub fn process_tree_snapshot() -> ProcessTreeSnapshot {
    platform_process_tree_snapshot(resolve_process_tree_root())
}

#[derive(Debug, Clone, Copy)]
struct ProcessTreeRoot {
    pid: u32,
    source: &'static str,
}

fn resolve_process_tree_root() -> ProcessTreeRoot {
    let self_pid = std::process::id();
    let configured_pid = std::env::var(ENV_AUDIO_APP_ROOT_PID)
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|pid| *pid > 0);

    match configured_pid {
        Some(pid) => ProcessTreeRoot {
            pid,
            source: ENV_AUDIO_APP_ROOT_PID,
        },
        None => ProcessTreeRoot {
            pid: self_pid,
            source: "current_process",
        },
    }
}

#[cfg(windows)]
fn platform_process_memory_snapshot() -> ProcessMemorySnapshot {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::System::ProcessStatus::{
        GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    let mut counters: PROCESS_MEMORY_COUNTERS = unsafe { zeroed() };
    counters.cb = size_of::<PROCESS_MEMORY_COUNTERS>() as u32;

    // SAFETY: GetCurrentProcess returns a pseudo-handle for this process and
    // counters points to a properly initialized PROCESS_MEMORY_COUNTERS value
    // with cb set to its exact size.
    let ok = unsafe {
        GetProcessMemoryInfo(
            GetCurrentProcess(),
            &mut counters,
            size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        )
    };

    if ok == 0 {
        return ProcessMemorySnapshot {
            available: false,
            working_set_bytes: None,
            private_bytes: None,
            source: "windows_process_status",
            error: Some("GetProcessMemoryInfo failed".to_string()),
        };
    }

    ProcessMemorySnapshot {
        available: true,
        working_set_bytes: Some(counters.WorkingSetSize as u64),
        private_bytes: Some(counters.PagefileUsage as u64),
        source: "windows_process_status",
        error: None,
    }
}

#[cfg(windows)]
fn platform_process_tree_snapshot(root: ProcessTreeRoot) -> ProcessTreeSnapshot {
    use std::collections::HashMap;
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    // SAFETY: CreateToolhelp32Snapshot is called with the documented process
    // snapshot flag and a process id of 0 to enumerate all processes.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return unavailable_process_tree(root, "CreateToolhelp32Snapshot failed");
    }

    let mut entries = HashMap::new();
    let mut entry: PROCESSENTRY32W = unsafe { zeroed() };
    entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;

    // SAFETY: snapshot is a valid ToolHelp snapshot handle, and entry points to
    // a PROCESSENTRY32W with dwSize initialized to the struct size.
    let first_ok = unsafe { Process32FirstW(snapshot, &mut entry) };
    if first_ok == 0 {
        // SAFETY: snapshot is an owned handle returned by CreateToolhelp32Snapshot.
        unsafe {
            CloseHandle(snapshot);
        }
        return unavailable_process_tree(root, "Process32FirstW failed");
    }

    loop {
        entries.insert(
            entry.th32ProcessID,
            ProcessTreeEntry {
                pid: entry.th32ProcessID,
                parent_pid: entry.th32ParentProcessID,
                name: process_name_from_entry(&entry),
            },
        );

        // SAFETY: snapshot remains valid for the loop and entry is a valid
        // mutable PROCESSENTRY32W buffer.
        let next_ok = unsafe { Process32NextW(snapshot, &mut entry) };
        if next_ok == 0 {
            break;
        }
    }

    // SAFETY: snapshot is an owned handle returned by CreateToolhelp32Snapshot.
    unsafe {
        CloseHandle(snapshot);
    }

    let tree_pids = collect_process_tree_pids(root.pid, &entries);
    if tree_pids.is_empty() {
        return unavailable_process_tree(root, "Root process was not present in process snapshot");
    }

    let mut skipped_process_count = 0_usize;
    let mut processes = Vec::new();
    for pid in tree_pids {
        let Some(entry) = entries.get(&pid) else {
            continue;
        };
        let stats = inspect_process_stats(pid);
        if stats.open_failed {
            skipped_process_count = skipped_process_count.saturating_add(1);
        }
        processes.push(ProcessTreeProcessSnapshot {
            pid: entry.pid,
            parent_pid: entry.parent_pid,
            name: entry.name.clone(),
            working_set_bytes: stats.working_set_bytes,
            private_bytes: stats.private_bytes,
            cpu_total_time_ms: stats.cpu_total_time_ms,
        });
    }

    processes.sort_by_key(|process| (process.parent_pid != 0, process.parent_pid, process.pid));

    let total_working_set_bytes = processes
        .iter()
        .filter_map(|process| process.working_set_bytes)
        .fold(0_u64, u64::saturating_add);
    let total_private_bytes = processes
        .iter()
        .filter_map(|process| process.private_bytes)
        .fold(0_u64, u64::saturating_add);
    let total_cpu_time_ms = processes
        .iter()
        .filter_map(|process| process.cpu_total_time_ms)
        .fold(0_u64, u64::saturating_add);

    ProcessTreeSnapshot {
        available: true,
        root_pid: root.pid,
        self_pid: std::process::id(),
        root_source: root.source,
        source: "windows_toolhelp",
        process_count: processes.len(),
        skipped_process_count,
        total_working_set_bytes,
        total_private_bytes,
        total_cpu_time_ms,
        processes,
        error: None,
    }
}

#[cfg(windows)]
#[derive(Debug, Clone)]
struct ProcessTreeEntry {
    pid: u32,
    parent_pid: u32,
    name: String,
}

#[cfg(windows)]
#[derive(Debug, Clone, Default)]
struct ProcessStats {
    working_set_bytes: Option<u64>,
    private_bytes: Option<u64>,
    cpu_total_time_ms: Option<u64>,
    open_failed: bool,
}

#[cfg(windows)]
fn collect_process_tree_pids(
    root_pid: u32,
    entries: &std::collections::HashMap<u32, ProcessTreeEntry>,
) -> Vec<u32> {
    let mut selected = std::collections::HashSet::new();
    let mut stack = vec![root_pid];

    while let Some(pid) = stack.pop() {
        if !selected.insert(pid) {
            continue;
        }

        for entry in entries.values() {
            if entry.parent_pid == pid {
                stack.push(entry.pid);
            }
        }
    }

    let mut pids: Vec<u32> = selected
        .into_iter()
        .filter(|pid| entries.contains_key(pid))
        .collect();
    pids.sort_unstable();
    pids
}

#[cfg(windows)]
fn process_name_from_entry(
    entry: &windows_sys::Win32::System::Diagnostics::ToolHelp::PROCESSENTRY32W,
) -> String {
    let nul = entry
        .szExeFile
        .iter()
        .position(|ch| *ch == 0)
        .unwrap_or(entry.szExeFile.len());
    String::from_utf16_lossy(&entry.szExeFile[..nul])
}

#[cfg(windows)]
fn inspect_process_stats(pid: u32) -> ProcessStats {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME};
    use windows_sys::Win32::System::ProcessStatus::{
        GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
    };
    use windows_sys::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
    };

    // SAFETY: OpenProcess is called for a PID from the system process snapshot
    // with query/read access only. The returned handle is checked before use.
    let handle =
        unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid) };
    if handle.is_null() {
        return ProcessStats {
            open_failed: true,
            ..ProcessStats::default()
        };
    }

    let mut stats = ProcessStats::default();
    let mut counters: PROCESS_MEMORY_COUNTERS = unsafe { zeroed() };
    counters.cb = size_of::<PROCESS_MEMORY_COUNTERS>() as u32;

    // SAFETY: handle is a live process handle and counters is initialized with
    // the documented cb size.
    let memory_ok = unsafe {
        GetProcessMemoryInfo(
            handle,
            &mut counters,
            size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        )
    };
    if memory_ok != 0 {
        stats.working_set_bytes = Some(counters.WorkingSetSize as u64);
        stats.private_bytes = Some(counters.PagefileUsage as u64);
    }

    let mut creation = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let mut exit = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let mut kernel = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let mut user = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };

    // SAFETY: handle is a live process handle and all FILETIME pointers refer
    // to initialized local variables.
    let cpu_ok =
        unsafe { GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) };
    if cpu_ok != 0 {
        stats.cpu_total_time_ms = Some(filetime_to_ms(kernel).saturating_add(filetime_to_ms(user)));
    }

    // SAFETY: handle is an owned process handle returned by OpenProcess.
    unsafe {
        CloseHandle(handle);
    }

    stats
}

fn unavailable_process_tree(
    root: ProcessTreeRoot,
    error: impl Into<String>,
) -> ProcessTreeSnapshot {
    ProcessTreeSnapshot {
        available: false,
        root_pid: root.pid,
        self_pid: std::process::id(),
        root_source: root.source,
        source: platform_process_tree_source(),
        process_count: 0,
        skipped_process_count: 0,
        total_working_set_bytes: 0,
        total_private_bytes: 0,
        total_cpu_time_ms: 0,
        processes: Vec::new(),
        error: Some(error.into()),
    }
}

#[cfg(windows)]
fn platform_process_tree_source() -> &'static str {
    "windows_toolhelp"
}

#[cfg(windows)]
fn platform_process_cpu_snapshot() -> ProcessCpuSnapshot {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};

    let mut creation = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let mut exit = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let mut kernel = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let mut user = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };

    // SAFETY: GetCurrentProcess returns a valid pseudo-handle for this process
    // and all FILETIME pointers refer to initialized local variables.
    let ok = unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            &mut creation,
            &mut exit,
            &mut kernel,
            &mut user,
        )
    };

    if ok == 0 {
        return ProcessCpuSnapshot {
            available: false,
            kernel_time_ms: None,
            user_time_ms: None,
            total_time_ms: None,
            source: "windows_process_times",
            error: Some("GetProcessTimes failed".to_string()),
        };
    }

    let kernel_time_ms = filetime_to_ms(kernel);
    let user_time_ms = filetime_to_ms(user);

    ProcessCpuSnapshot {
        available: true,
        kernel_time_ms: Some(kernel_time_ms),
        user_time_ms: Some(user_time_ms),
        total_time_ms: Some(kernel_time_ms.saturating_add(user_time_ms)),
        source: "windows_process_times",
        error: None,
    }
}

#[cfg(windows)]
fn filetime_to_ms(value: windows_sys::Win32::Foundation::FILETIME) -> u64 {
    let ticks = (u64::from(value.dwHighDateTime) << 32) | u64::from(value.dwLowDateTime);
    ticks / 10_000
}

#[cfg(not(windows))]
fn platform_process_memory_snapshot() -> ProcessMemorySnapshot {
    ProcessMemorySnapshot {
        available: false,
        working_set_bytes: None,
        private_bytes: None,
        source: "unsupported_platform",
        error: Some("Process memory snapshot is only implemented on Windows".to_string()),
    }
}

#[cfg(not(windows))]
fn platform_process_cpu_snapshot() -> ProcessCpuSnapshot {
    ProcessCpuSnapshot {
        available: false,
        kernel_time_ms: None,
        user_time_ms: None,
        total_time_ms: None,
        source: "unsupported_platform",
        error: Some("Process CPU snapshot is only implemented on Windows".to_string()),
    }
}

#[cfg(not(windows))]
fn platform_process_tree_snapshot(root: ProcessTreeRoot) -> ProcessTreeSnapshot {
    unavailable_process_tree(root, "Process tree snapshot is only implemented on Windows")
}

#[cfg(not(windows))]
fn platform_process_tree_source() -> &'static str {
    "unsupported_platform"
}

#[derive(Debug, Clone, Serialize)]
pub struct FileFootprint {
    pub available: bool,
    pub bytes: Option<u64>,
    pub mib: Option<u64>,
    pub error: Option<String>,
}

impl FileFootprint {
    pub fn from_bytes(bytes: u64) -> Self {
        Self {
            available: true,
            bytes: Some(bytes),
            mib: Some(bytes / BYTES_PER_MIB),
            error: None,
        }
    }

    pub fn unavailable(error: impl Into<String>) -> Self {
        Self {
            available: false,
            bytes: None,
            mib: None,
            error: Some(error.into()),
        }
    }
}

pub fn file_size_snapshot(path: &std::path::Path) -> FileFootprint {
    match std::fs::metadata(path) {
        Ok(metadata) => FileFootprint::from_bytes(metadata.len()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => FileFootprint::from_bytes(0),
        Err(e) => FileFootprint::unavailable(format!("Failed to inspect file size: {}", e)),
    }
}

pub fn directory_size_snapshot(path: &std::path::Path) -> FileFootprint {
    match directory_size_bytes(path) {
        Ok(bytes) => FileFootprint::from_bytes(bytes),
        Err(e) => FileFootprint::unavailable(e),
    }
}

fn directory_size_bytes(path: &std::path::Path) -> Result<u64, String> {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => return Ok(metadata.len()),
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(format!("Failed to inspect directory size: {}", e)),
    }

    let mut total = 0_u64;
    let mut stack = vec![path.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir)
            .map_err(|e| format!("Failed to read runtime directory: {}", e))?;
        for entry in entries {
            let entry =
                entry.map_err(|e| format!("Failed to read runtime directory entry: {}", e))?;
            let metadata = entry
                .metadata()
                .map_err(|e| format!("Failed to inspect runtime directory entry: {}", e))?;
            if metadata.is_dir() {
                stack.push(entry.path());
            } else if metadata.is_file() {
                total = total.saturating_add(metadata.len());
            }
        }
    }

    Ok(total)
}

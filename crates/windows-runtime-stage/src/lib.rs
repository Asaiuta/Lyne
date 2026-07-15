use std::collections::{BTreeSet, VecDeque};
use std::env;
use std::error::Error;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub enum StageError {
    NoRuntimeCandidate {
        names: Vec<String>,
        searched: Vec<PathBuf>,
    },
    IncompleteRuntimeCandidates {
        attempts: Vec<String>,
    },
    Message(String),
}

impl StageError {
    fn message(message: impl Into<String>) -> Self {
        Self::Message(message.into())
    }

    pub fn is_no_runtime_candidate(&self) -> bool {
        matches!(self, Self::NoRuntimeCandidate { .. })
    }
}

impl fmt::Display for StageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoRuntimeCandidate { names, searched } => write!(
                formatter,
                "none of [{}] was found in [{}]",
                names.join(", "),
                display_paths(searched)
            ),
            Self::IncompleteRuntimeCandidates { attempts } => write!(
                formatter,
                "runtime candidates were found but none had a complete dependency closure: {}",
                attempts.join(" | ")
            ),
            Self::Message(message) => formatter.write_str(message),
        }
    }
}

impl Error for StageError {}

#[derive(Clone, Debug)]
pub struct StagePlan {
    pub search_dirs: Vec<PathBuf>,
    pub destinations: Vec<PathBuf>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StageReport {
    pub root: PathBuf,
    pub runtime_files: Vec<PathBuf>,
    pub copied_files: Vec<PathBuf>,
}

pub fn profile_stage_plan(target_dir: &Path, profile: &str) -> StagePlan {
    let profile_dir = target_dir.join(profile);
    StagePlan {
        search_dirs: default_search_dirs(target_dir, &profile_dir),
        destinations: vec![
            profile_dir.clone(),
            profile_dir.join("deps"),
            profile_dir.join("sidecar-runtime"),
        ],
    }
}

pub fn stage_named_runtime(names: &[&str], plan: &StagePlan) -> Result<StageReport, StageError> {
    let (root, closure) =
        find_complete_named_runtime_with(names, &plan.search_dirs, pe_import_dll_names)?;
    let copied_files = stage_files(&closure, &plan.destinations)?;
    Ok(StageReport {
        root,
        runtime_files: closure,
        copied_files,
    })
}

pub fn stage_binary_runtime(binary: &Path, plan: &StagePlan) -> Result<StageReport, StageError> {
    if !binary.is_file() {
        return Err(StageError::message(format!(
            "runtime root binary does not exist: {}",
            binary.display()
        )));
    }

    let closure = collect_runtime_closure_with(binary, &plan.search_dirs, pe_import_dll_names)?;
    let runtime_files = closure
        .into_iter()
        .filter(|path| !same_path(path, binary))
        .collect::<Vec<_>>();
    let copied_files = stage_files(&runtime_files, &plan.destinations)?;
    Ok(StageReport {
        root: binary.to_path_buf(),
        runtime_files,
        copied_files,
    })
}

pub fn default_search_dirs(target_dir: &Path, profile_dir: &Path) -> Vec<PathBuf> {
    let mut directories = Vec::new();
    let mut seen = BTreeSet::new();

    if let Some(explicit) = env::var_os("SOXR_RUNTIME_DIR") {
        push_unique_dir(&mut directories, &mut seen, PathBuf::from(explicit));
    }

    if let Some(paths) = env::var_os("PKG_CONFIG_PATH") {
        for directory in env::split_paths(&paths) {
            push_unique_dir(&mut directories, &mut seen, directory.clone());
            push_unique_dir(
                &mut directories,
                &mut seen,
                directory.join("..").join("bin"),
            );
            push_unique_dir(
                &mut directories,
                &mut seen,
                directory.join("..").join("..").join("bin"),
            );
        }
    }

    if let Some(vcpkg_root) = env::var_os("VCPKG_ROOT") {
        let root = PathBuf::from(vcpkg_root).join("installed");
        let triplet =
            env::var("VCPKG_DEFAULT_TRIPLET").unwrap_or_else(|_| "x64-windows".to_string());
        push_unique_dir(&mut directories, &mut seen, root.join(triplet).join("bin"));
        push_unique_dir(
            &mut directories,
            &mut seen,
            root.join("x64-windows").join("bin"),
        );
    }

    if let Some(user_profile) = env::var_os("USERPROFILE") {
        let msys_root = PathBuf::from(user_profile)
            .join("scoop")
            .join("apps")
            .join("msys2");
        if let Ok(entries) = fs::read_dir(msys_root) {
            for entry in entries.filter_map(Result::ok) {
                add_msys_runtime_dirs(&mut directories, &mut seen, &entry.path());
            }
        }
    }

    for root in [Path::new(r"C:\msys64"), Path::new(r"D:\msys64")] {
        add_msys_runtime_dirs(&mut directories, &mut seen, root);
    }

    if let Some(paths) = env::var_os("PATH") {
        for directory in env::split_paths(&paths) {
            push_unique_dir(&mut directories, &mut seen, directory);
        }
    }

    push_unique_dir(&mut directories, &mut seen, profile_dir.to_path_buf());
    push_unique_dir(&mut directories, &mut seen, profile_dir.join("deps"));

    if let Ok(entries) = fs::read_dir(target_dir) {
        let mut profile_dirs = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect::<Vec<_>>();
        profile_dirs.sort();
        for directory in profile_dirs {
            push_unique_dir(&mut directories, &mut seen, directory.clone());
            push_unique_dir(&mut directories, &mut seen, directory.join("deps"));
        }
    }

    directories
}

fn add_msys_runtime_dirs(directories: &mut Vec<PathBuf>, seen: &mut BTreeSet<String>, root: &Path) {
    for environment in ["mingw64", "ucrt64", "clang64"] {
        push_unique_dir(directories, seen, root.join(environment).join("bin"));
    }
}

fn push_unique_dir(
    directories: &mut Vec<PathBuf>,
    seen: &mut BTreeSet<String>,
    directory: PathBuf,
) {
    if !directory.is_dir() {
        return;
    }
    let key = path_key(&directory);
    if seen.insert(key) {
        directories.push(directory);
    }
}

fn find_complete_named_runtime_with<F>(
    names: &[&str],
    search_dirs: &[PathBuf],
    read_imports: F,
) -> Result<(PathBuf, Vec<PathBuf>), StageError>
where
    F: Fn(&Path) -> Result<Vec<String>, StageError>,
{
    let mut candidates = Vec::new();
    let mut seen = BTreeSet::new();
    for directory in search_dirs {
        for name in names {
            let candidate = directory.join(name);
            if candidate.is_file() && seen.insert(path_key(&candidate)) {
                candidates.push(candidate);
            }
        }
    }

    if candidates.is_empty() {
        return Err(StageError::NoRuntimeCandidate {
            names: names.iter().map(|name| (*name).to_string()).collect(),
            searched: search_dirs.to_vec(),
        });
    }

    let mut attempts = Vec::new();
    for candidate in candidates {
        match collect_runtime_closure_with(&candidate, search_dirs, &read_imports) {
            Ok(closure) => return Ok((candidate, closure)),
            Err(error) => attempts.push(format!("{}: {error}", candidate.display())),
        }
    }

    Err(StageError::IncompleteRuntimeCandidates { attempts })
}

fn collect_runtime_closure_with<F>(
    root: &Path,
    search_dirs: &[PathBuf],
    read_imports: F,
) -> Result<Vec<PathBuf>, StageError>
where
    F: Fn(&Path) -> Result<Vec<String>, StageError>,
{
    if !root.is_file() {
        return Err(StageError::message(format!(
            "runtime root does not exist: {}",
            root.display()
        )));
    }

    let mut ordered = Vec::new();
    let mut seen = BTreeSet::new();
    let mut queue = VecDeque::new();
    queue.push_back(root.to_path_buf());

    while let Some(file) = queue.pop_front() {
        let key = file_name_key(&file)?;
        if !seen.insert(key) {
            continue;
        }
        ordered.push(file.clone());

        for import in read_imports(&file)? {
            if is_system_dll(&import) {
                continue;
            }
            let resolved = resolve_import(&import, &file, search_dirs).ok_or_else(|| {
                StageError::message(format!(
                    "{} imports unresolved runtime DLL '{}' (searched [{}])",
                    file.display(),
                    import,
                    display_paths(search_dirs)
                ))
            })?;
            queue.push_back(resolved);
        }
    }

    Ok(ordered)
}

fn resolve_import(import: &str, importer: &Path, search_dirs: &[PathBuf]) -> Option<PathBuf> {
    let mut directories = Vec::with_capacity(search_dirs.len() + 1);
    if let Some(parent) = importer.parent() {
        directories.push(parent.to_path_buf());
    }
    directories.extend(search_dirs.iter().cloned());

    for directory in directories {
        let exact = directory.join(import);
        if exact.is_file() {
            return Some(exact);
        }
        let lower = directory.join(import.to_ascii_lowercase());
        if lower.is_file() {
            return Some(lower);
        }
        if let Ok(entries) = fs::read_dir(&directory) {
            if let Some(path) = entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .find(|path| {
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| name.eq_ignore_ascii_case(import))
                })
            {
                return Some(path);
            }
        }
    }

    None
}

fn stage_files(files: &[PathBuf], destinations: &[PathBuf]) -> Result<Vec<PathBuf>, StageError> {
    let mut copied = Vec::new();
    for destination_dir in destinations {
        fs::create_dir_all(destination_dir).map_err(|error| {
            StageError::message(format!(
                "failed to create runtime destination {}: {error}",
                destination_dir.display()
            ))
        })?;

        for source in files {
            let file_name = source.file_name().ok_or_else(|| {
                StageError::message(format!(
                    "runtime path has no file name: {}",
                    source.display()
                ))
            })?;
            let destination = destination_dir.join(file_name);
            if copy_if_needed(source, &destination)? {
                copied.push(destination);
            }
        }
    }
    Ok(copied)
}

fn copy_if_needed(source: &Path, destination: &Path) -> Result<bool, StageError> {
    if same_path(source, destination) {
        return Ok(false);
    }

    if destination.is_file() {
        let source_bytes = fs::read(source).map_err(|error| {
            StageError::message(format!("failed to read {}: {error}", source.display()))
        })?;
        let destination_bytes = fs::read(destination).map_err(|error| {
            StageError::message(format!("failed to read {}: {error}", destination.display()))
        })?;
        if source_bytes == destination_bytes {
            return Ok(false);
        }
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            StageError::message(format!("failed to create {}: {error}", parent.display()))
        })?;
    }
    fs::copy(source, destination).map_err(|error: io::Error| {
        StageError::message(format!(
            "failed to copy {} -> {}: {error}",
            source.display(),
            destination.display()
        ))
    })?;
    Ok(true)
}

fn same_path(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => path_key(&left) == path_key(&right),
        _ => false,
    }
}

fn pe_import_dll_names(path: &Path) -> Result<Vec<String>, StageError> {
    let data = fs::read(path).map_err(|error| {
        StageError::message(format!(
            "failed to read PE image {}: {error}",
            path.display()
        ))
    })?;
    if data.len() < 0x40 || &data[0..2] != b"MZ" {
        return Err(StageError::message(format!(
            "not a PE image: {}",
            path.display()
        )));
    }

    let e_lfanew = u32_at(&data, 0x3c)? as usize;
    if data.len() < e_lfanew + 24 || &data[e_lfanew..e_lfanew + 4] != b"PE\0\0" {
        return Err(StageError::message(format!(
            "invalid PE header: {}",
            path.display()
        )));
    }

    let number_of_sections = u16_at(&data, e_lfanew + 6)? as usize;
    let optional_header_size = u16_at(&data, e_lfanew + 20)? as usize;
    let optional_header_offset = e_lfanew + 24;
    let data_directory_offset = match u16_at(&data, optional_header_offset)? {
        0x20b => optional_header_offset + 112,
        0x10b => optional_header_offset + 96,
        magic => {
            return Err(StageError::message(format!(
                "unsupported PE optional-header magic {magic:#x} in {}",
                path.display()
            )))
        }
    };
    if data.len() < data_directory_offset + 16 {
        return Ok(Vec::new());
    }
    let import_rva = u32_at(&data, data_directory_offset + 8)? as usize;
    if import_rva == 0 {
        return Ok(Vec::new());
    }

    let section_offset = optional_header_offset + optional_header_size;
    let mut sections = Vec::with_capacity(number_of_sections);
    for index in 0..number_of_sections {
        let offset = section_offset + index * 40;
        if data.len() < offset + 40 {
            break;
        }
        sections.push((
            u32_at(&data, offset + 12)? as usize,
            u32_at(&data, offset + 8)? as usize,
            u32_at(&data, offset + 20)? as usize,
            u32_at(&data, offset + 16)? as usize,
        ));
    }

    let Some(mut offset) = rva_to_offset(import_rva, &sections) else {
        return Ok(Vec::new());
    };
    let mut imports = Vec::new();
    loop {
        if data.len() < offset + 20 {
            break;
        }
        let original_first_thunk = u32_at(&data, offset)?;
        let name_rva = u32_at(&data, offset + 12)? as usize;
        let first_thunk = u32_at(&data, offset + 16)?;
        if original_first_thunk == 0 && name_rva == 0 && first_thunk == 0 {
            break;
        }
        if let Some(name_offset) = rva_to_offset(name_rva, &sections) {
            if let Some(name) = read_cstring(&data, name_offset) {
                imports.push(name);
            }
        }
        offset += 20;
    }
    Ok(imports)
}

fn rva_to_offset(rva: usize, sections: &[(usize, usize, usize, usize)]) -> Option<usize> {
    for &(virtual_address, virtual_size, raw_offset, raw_size) in sections {
        let span = virtual_size.max(raw_size);
        if rva >= virtual_address && rva < virtual_address + span {
            return Some(raw_offset + (rva - virtual_address));
        }
    }
    None
}

fn read_cstring(data: &[u8], offset: usize) -> Option<String> {
    if offset >= data.len() {
        return None;
    }
    let end = data[offset..]
        .iter()
        .position(|&byte| byte == 0)
        .map(|relative| offset + relative)?;
    std::str::from_utf8(&data[offset..end])
        .ok()
        .map(ToOwned::to_owned)
}

fn is_system_dll(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with("api-ms-win-")
        || lower.starts_with("ext-ms-")
        || matches!(
            lower.as_str(),
            "kernel32.dll"
                | "kernelbase.dll"
                | "ntdll.dll"
                | "user32.dll"
                | "gdi32.dll"
                | "advapi32.dll"
                | "sechost.dll"
                | "rpcrt4.dll"
                | "msvcrt.dll"
                | "ucrtbase.dll"
                | "vcruntime140.dll"
                | "vcruntime140_1.dll"
                | "msvcp140.dll"
                | "bcrypt.dll"
                | "bcryptprimitives.dll"
                | "ws2_32.dll"
                | "ole32.dll"
                | "oleaut32.dll"
                | "combase.dll"
                | "comctl32.dll"
                | "shcore.dll"
                | "shell32.dll"
                | "shlwapi.dll"
                | "winmm.dll"
                | "imm32.dll"
                | "setupapi.dll"
                | "cfgmgr32.dll"
                | "psapi.dll"
                | "version.dll"
                | "dbghelp.dll"
                | "crypt32.dll"
                | "wintrust.dll"
                | "iphlpapi.dll"
                | "userenv.dll"
                | "dwmapi.dll"
                | "uxtheme.dll"
                | "propsys.dll"
                | "powrprof.dll"
        )
}

fn file_name_key(path: &Path) -> Result<String, StageError> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| {
            StageError::message(format!(
                "runtime path has no valid file name: {}",
                path.display()
            ))
        })
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase()
}

fn display_paths(paths: &[PathBuf]) -> String {
    paths
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

fn u16_at(data: &[u8], offset: usize) -> Result<u16, StageError> {
    let bytes = data.get(offset..offset + 2).ok_or_else(|| {
        StageError::message(format!("PE read out of bounds at u16 offset {offset}"))
    })?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn u32_at(data: &[u8], offset: usize) -> Result<u32, StageError> {
    let bytes = data.get(offset..offset + 4).ok_or_else(|| {
        StageError::message(format!("PE read out of bounds at u32 offset {offset}"))
    })?;
    Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let path = env::temp_dir().join(format!(
            "windows-runtime-stage-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create fixture directory");
        path
    }

    #[test]
    fn closure_resolves_transitive_imports_across_search_directories() {
        let fixture = temp_dir("closure");
        let root_dir = fixture.join("root");
        let dependency_dir = fixture.join("dependencies");
        fs::create_dir_all(&root_dir).expect("create root directory");
        fs::create_dir_all(&dependency_dir).expect("create dependency directory");
        let root = root_dir.join("root.exe");
        let first = dependency_dir.join("first.dll");
        let second = dependency_dir.join("second.dll");
        fs::write(&root, b"root").expect("write root");
        fs::write(&first, b"first").expect("write first dependency");
        fs::write(&second, b"second").expect("write second dependency");

        let closure =
            collect_runtime_closure_with(&root, std::slice::from_ref(&dependency_dir), |path| {
                match path.file_name().and_then(|name| name.to_str()) {
                    Some("root.exe") => Ok(vec!["first.dll".to_string()]),
                    Some("first.dll") => Ok(vec!["second.dll".to_string()]),
                    _ => Ok(Vec::new()),
                }
            })
            .expect("resolve closure");

        assert_eq!(closure, vec![root, first, second]);
        let _ = fs::remove_dir_all(fixture);
    }

    #[test]
    fn missing_transitive_import_is_an_error() {
        let fixture = temp_dir("missing");
        let root = fixture.join("root.dll");
        fs::write(&root, b"root").expect("write root");

        let error = collect_runtime_closure_with(&root, std::slice::from_ref(&fixture), |_| {
            Ok(vec!["missing.dll".to_string()])
        })
        .expect_err("missing import must fail");

        assert!(error.to_string().contains("missing.dll"));
        let _ = fs::remove_dir_all(fixture);
    }

    #[test]
    fn named_runtime_skips_an_incomplete_earlier_candidate() {
        let fixture = temp_dir("candidate");
        let first_dir = fixture.join("first");
        let second_dir = fixture.join("second");
        fs::create_dir_all(&first_dir).expect("create first directory");
        fs::create_dir_all(&second_dir).expect("create second directory");
        let first = first_dir.join("runtime.dll");
        let second = second_dir.join("runtime.dll");
        fs::write(&first, b"incomplete").expect("write first candidate");
        fs::write(&second, b"complete").expect("write second candidate");

        let (root, closure) =
            find_complete_named_runtime_with(&["runtime.dll"], &[first_dir, second_dir], |path| {
                if path == first {
                    Ok(vec!["missing.dll".to_string()])
                } else {
                    Ok(Vec::new())
                }
            })
            .expect("select complete candidate");

        assert_eq!(root, second);
        assert_eq!(closure, vec![second]);
        let _ = fs::remove_dir_all(fixture);
    }

    #[test]
    fn copy_if_needed_compares_file_contents() {
        let fixture = temp_dir("copy");
        let source = fixture.join("source.dll");
        let destination = fixture.join("destination.dll");
        fs::write(&source, b"abcd").expect("write source");
        fs::write(&destination, b"wxyz").expect("write same-length destination");

        assert!(copy_if_needed(&source, &destination).expect("replace different content"));
        assert_eq!(fs::read(&destination).expect("read destination"), b"abcd");
        assert!(!copy_if_needed(&source, &destination).expect("skip identical content"));
        let _ = fs::remove_dir_all(fixture);
    }

    #[cfg(windows)]
    #[test]
    fn current_test_executable_has_a_parseable_pe_import_table() {
        let imports = pe_import_dll_names(&env::current_exe().expect("current executable"))
            .expect("parse current test executable");
        assert!(imports.iter().any(|name| is_system_dll(name)));
    }
}

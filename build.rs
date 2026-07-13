//! Stage MinGW/MSYS2 soxr runtime DLLs next to Windows binaries and cargo benches.
//!
//! `audio-engine-core`'s build script only copies `libsoxr.dll` into the profile
//! root. Cargo runs `harness = false` benches from `target/<profile>/deps/`, and
//! Windows DLL search does not look in the profile root by default. Source/callback
//! benches therefore fail with `STATUS_DLL_NOT_FOUND` (0xC0000135) unless the full
//! soxr runtime cluster is also present under `deps/` or on PATH.
//!
//! This script copies:
//! - `libsoxr.dll`
//! - its local MinGW transitive deps (`libgomp`, `libgcc_s_seh`, `libwinpthread`, …)
//!
//! into both `target/<profile>/` and `target/<profile>/deps/`.

use std::collections::{BTreeSet, VecDeque};
use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=PATH");
    println!("cargo:rerun-if-env-changed=VCPKG_ROOT");
    println!("cargo:rerun-if-env-changed=PKG_CONFIG_PATH");

    if env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() != "windows" {
        return;
    }

    match stage_soxr_runtime() {
        Ok(paths) if !paths.is_empty() => {
            for path in paths {
                println!("cargo:rerun-if-changed={}", path.display());
            }
        }
        Ok(_) => {
            println!(
                "cargo:warning=soxr runtime DLLs were not found; Windows benches that link soxr may fail with STATUS_DLL_NOT_FOUND"
            );
        }
        Err(error) => {
            println!("cargo:warning=soxr runtime staging failed: {error}");
        }
    }
}

fn stage_soxr_runtime() -> Result<Vec<PathBuf>, String> {
    let out_dir = PathBuf::from(env::var("OUT_DIR").map_err(|error| error.to_string())?);
    let profile_dir = out_dir
        .ancestors()
        .nth(3)
        .ok_or_else(|| {
            format!(
                "unable to resolve profile dir from OUT_DIR {}",
                out_dir.display()
            )
        })?
        .to_path_buf();
    let deps_dir = profile_dir.join("deps");

    let soxr_dll = find_soxr_dll(&profile_dir)
        .ok_or_else(|| "unable to locate libsoxr.dll / soxr.dll".to_string())?;
    let runtime_dlls = collect_local_runtime_dlls(&soxr_dll)?;

    fs::create_dir_all(&deps_dir)
        .map_err(|error| format!("failed to create deps dir {}: {error}", deps_dir.display()))?;

    let mut sources = Vec::new();
    for dll in &runtime_dlls {
        sources.push(dll.clone());
        copy_if_needed(dll, &profile_dir.join(file_name(dll)?))?;
        copy_if_needed(dll, &deps_dir.join(file_name(dll)?))?;
    }

    Ok(sources)
}

fn find_soxr_dll(profile_dir: &Path) -> Option<PathBuf> {
    let mut candidates = Vec::new();

    for name in ["libsoxr.dll", "soxr.dll"] {
        candidates.push(profile_dir.join(name));
        candidates.push(profile_dir.join("deps").join(name));
    }

    if let Some(user_profile) = env::var_os("USERPROFILE") {
        let user_profile = PathBuf::from(user_profile);
        let scoop_msys2 = user_profile.join("scoop").join("apps").join("msys2");
        if let Ok(entries) = fs::read_dir(&scoop_msys2) {
            for entry in entries.filter_map(Result::ok) {
                let bin = entry.path().join("mingw64").join("bin");
                candidates.push(bin.join("libsoxr.dll"));
                candidates.push(bin.join("soxr.dll"));
            }
        }
        candidates.push(
            user_profile
                .join("scoop")
                .join("apps")
                .join("msys2")
                .join("current")
                .join("mingw64")
                .join("bin")
                .join("libsoxr.dll"),
        );
    }

    for root in [r"C:\msys64\mingw64\bin", r"D:\msys64\mingw64\bin"] {
        candidates.push(PathBuf::from(root).join("libsoxr.dll"));
        candidates.push(PathBuf::from(root).join("soxr.dll"));
    }

    if let Some(paths) = env::var_os("PATH") {
        for dir in env::split_paths(&paths) {
            candidates.push(dir.join("libsoxr.dll"));
            candidates.push(dir.join("soxr.dll"));
        }
    }

    candidates.into_iter().find(|path| path.is_file())
}

fn collect_local_runtime_dlls(root_dll: &Path) -> Result<Vec<PathBuf>, String> {
    let root_dir = root_dll
        .parent()
        .ok_or_else(|| format!("dll has no parent: {}", root_dll.display()))?;

    let mut ordered = Vec::new();
    let mut seen = BTreeSet::new();
    let mut queue = VecDeque::new();
    queue.push_back(root_dll.to_path_buf());

    while let Some(dll) = queue.pop_front() {
        let key = dll
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if key.is_empty() || !seen.insert(key.clone()) {
            continue;
        }
        if !dll.is_file() {
            return Err(format!("missing runtime dll: {}", dll.display()));
        }
        ordered.push(dll.clone());

        for import in pe_import_dll_names(&dll)? {
            if is_system_dll(&import) {
                continue;
            }
            let candidate = root_dir.join(&import);
            if candidate.is_file() {
                queue.push_back(candidate);
                continue;
            }
            // MinGW import names are usually exact; also try lowercase.
            let lower = root_dir.join(import.to_ascii_lowercase());
            if lower.is_file() {
                queue.push_back(lower);
            }
        }
    }

    Ok(ordered)
}

fn pe_import_dll_names(path: &Path) -> Result<Vec<String>, String> {
    let data = fs::read(path).map_err(|error| {
        format!(
            "failed to read {} for import parsing: {error}",
            path.display()
        )
    })?;
    if data.len() < 0x40 || &data[0..2] != b"MZ" {
        return Err(format!("not a PE image: {}", path.display()));
    }

    let e_lfanew = u32_at(&data, 0x3C)? as usize;
    if data.len() < e_lfanew + 24 || &data[e_lfanew..e_lfanew + 4] != b"PE\0\0" {
        return Err(format!("invalid PE header: {}", path.display()));
    }

    let num_sections = u16_at(&data, e_lfanew + 6)? as usize;
    let size_opt = u16_at(&data, e_lfanew + 20)? as usize;
    let opt_off = e_lfanew + 24;
    let magic = u16_at(&data, opt_off)?;
    let dd_off = match magic {
        0x20B => opt_off + 112, // PE32+
        0x10B => opt_off + 96,  // PE32
        _ => {
            return Err(format!(
                "unsupported PE magic {magic:#x} in {}",
                path.display()
            ))
        }
    };
    if data.len() < dd_off + 16 {
        return Ok(Vec::new());
    }
    let import_rva = u32_at(&data, dd_off + 8)? as usize;
    if import_rva == 0 {
        return Ok(Vec::new());
    }

    let sec_off = opt_off + size_opt;
    let mut sections = Vec::with_capacity(num_sections);
    for index in 0..num_sections {
        let off = sec_off + index * 40;
        if data.len() < off + 40 {
            break;
        }
        let vsize = u32_at(&data, off + 8)? as usize;
        let vaddr = u32_at(&data, off + 12)? as usize;
        let rsize = u32_at(&data, off + 16)? as usize;
        let roff = u32_at(&data, off + 20)? as usize;
        sections.push((vaddr, vsize, roff, rsize));
    }

    let Some(mut off) = rva_to_offset(import_rva, &sections) else {
        return Ok(Vec::new());
    };

    let mut imports = Vec::new();
    loop {
        if data.len() < off + 20 {
            break;
        }
        let name_rva = u32_at(&data, off + 12)? as usize;
        let orig = u32_at(&data, off)?;
        let first_thunk = u32_at(&data, off + 16)?;
        if orig == 0 && name_rva == 0 && first_thunk == 0 {
            break;
        }
        if let Some(name_off) = rva_to_offset(name_rva, &sections) {
            if let Some(name) = read_cstring(&data, name_off) {
                imports.push(name);
            }
        }
        off += 20;
    }
    Ok(imports)
}

fn rva_to_offset(rva: usize, sections: &[(usize, usize, usize, usize)]) -> Option<usize> {
    for &(vaddr, vsize, roff, rsize) in sections {
        let span = vsize.max(rsize);
        if rva >= vaddr && rva < vaddr + span {
            return Some(roff + (rva - vaddr));
        }
    }
    None
}

fn read_cstring(data: &[u8], off: usize) -> Option<String> {
    if off >= data.len() {
        return None;
    }
    let end = data[off..]
        .iter()
        .position(|&byte| byte == 0)
        .map(|rel| off + rel)?;
    std::str::from_utf8(&data[off..end])
        .ok()
        .map(|value| value.to_string())
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

fn copy_if_needed(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        if let (Ok(src_meta), Ok(dst_meta)) = (fs::metadata(source), fs::metadata(destination)) {
            if src_meta.len() == dst_meta.len() {
                return Ok(());
            }
        }
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create {} for {}: {error}",
                parent.display(),
                destination.display()
            )
        })?;
    }
    fs::copy(source, destination).map_err(|error: io::Error| {
        format!(
            "failed to copy {} -> {}: {error}",
            source.display(),
            destination.display()
        )
    })?;
    Ok(())
}

fn file_name(path: &Path) -> Result<&str, String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("invalid file name: {}", path.display()))
}

fn u16_at(data: &[u8], off: usize) -> Result<u16, String> {
    let bytes = data
        .get(off..off + 2)
        .ok_or_else(|| format!("PE read OOB u16 @ {off}"))?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn u32_at(data: &[u8], off: usize) -> Result<u32, String> {
    let bytes = data
        .get(off..off + 4)
        .ok_or_else(|| format!("PE read OOB u32 @ {off}"))?;
    Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

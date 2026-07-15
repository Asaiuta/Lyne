//! Stage the Windows SoXR runtime through the canonical workspace tool.

use std::env;
use std::path::PathBuf;

use windows_runtime_stage::{default_search_dirs, stage_named_runtime, StageError, StagePlan};

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    for variable in [
        "PATH",
        "PKG_CONFIG_PATH",
        "SOXR_RUNTIME_DIR",
        "USERPROFILE",
        "VCPKG_DEFAULT_TRIPLET",
        "VCPKG_ROOT",
    ] {
        println!("cargo:rerun-if-env-changed={variable}");
    }

    if env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() != "windows" {
        return;
    }

    match stage_soxr_runtime() {
        Ok(report) => {
            for source in report.runtime_files {
                println!("cargo:rerun-if-changed={}", source.display());
            }
        }
        Err(error) if error.is_no_runtime_candidate() => {
            println!(
                "cargo:warning=soxr runtime DLLs were not found; a static SoXR link may be in use, otherwise Windows binaries will fail post-link staging: {error}"
            );
        }
        Err(error) => panic!("soxr runtime staging failed: {error}"),
    }
}

fn stage_soxr_runtime() -> Result<windows_runtime_stage::StageReport, StageError> {
    let out_dir = PathBuf::from(
        env::var_os("OUT_DIR")
            .ok_or_else(|| StageError::Message("OUT_DIR is not set for build.rs".to_string()))?,
    );
    let profile_dir = out_dir.ancestors().nth(3).ok_or_else(|| {
        StageError::Message(format!(
            "unable to resolve Cargo profile directory from OUT_DIR {}",
            out_dir.display()
        ))
    })?;
    let target_dir = profile_dir.parent().ok_or_else(|| {
        StageError::Message(format!(
            "Cargo profile directory has no target parent: {}",
            profile_dir.display()
        ))
    })?;
    let plan = StagePlan {
        search_dirs: default_search_dirs(target_dir, profile_dir),
        destinations: vec![
            profile_dir.to_path_buf(),
            profile_dir.join("deps"),
            profile_dir.join("sidecar-runtime"),
        ],
    };

    stage_named_runtime(&["libsoxr.dll", "soxr.dll"], &plan)
}

use std::env;
use std::path::PathBuf;
use std::process::ExitCode;

use windows_runtime_stage::{
    profile_stage_plan, stage_binary_runtime, stage_named_runtime, StageReport,
};

struct Cli {
    target_dir: PathBuf,
    profile: String,
    root: Option<PathBuf>,
}

fn parse_cli() -> Result<Cli, String> {
    let mut target_dir = env::var_os("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("target"));
    let mut profile = "release".to_string();
    let mut root = None;
    let mut args = env::args_os().skip(1);

    while let Some(argument) = args.next() {
        match argument.to_string_lossy().as_ref() {
            "--target-dir" => {
                target_dir = PathBuf::from(
                    args.next()
                        .ok_or_else(|| "--target-dir requires a path".to_string())?,
                );
            }
            "--profile" => {
                profile = args
                    .next()
                    .ok_or_else(|| "--profile requires a value".to_string())?
                    .to_string_lossy()
                    .into_owned();
            }
            "--root" => {
                root =
                    Some(PathBuf::from(args.next().ok_or_else(|| {
                        "--root requires a PE file path".to_string()
                    })?));
            }
            "--help" | "-h" => {
                return Err(
                    "usage: stage-windows-runtime [--target-dir PATH] [--profile NAME] [--root PE_FILE]"
                        .to_string(),
                );
            }
            unknown => return Err(format!("unknown argument: {unknown}")),
        }
    }

    Ok(Cli {
        target_dir,
        profile,
        root,
    })
}

fn print_report(report: &StageReport) {
    println!("runtime root: {}", report.root.display());
    println!("resolved runtime files:");
    for file in &report.runtime_files {
        println!("  - {}", file.display());
    }
    if report.copied_files.is_empty() {
        println!("all runtime files already match their destinations");
    } else {
        println!("copied/updated files:");
        for file in &report.copied_files {
            println!("  - {}", file.display());
        }
    }
}

fn run() -> Result<(), String> {
    let cli = parse_cli()?;
    let plan = profile_stage_plan(&cli.target_dir, &cli.profile);
    let report = match cli.root {
        Some(root) => stage_binary_runtime(&root, &plan),
        None => stage_named_runtime(&["libsoxr.dll", "soxr.dll"], &plan),
    }
    .map_err(|error| error.to_string())?;
    print_report(&report);
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("stage-windows-runtime: {error}");
            ExitCode::FAILURE
        }
    }
}

//! Performance artifact provenance (PERF-005 remediation).
//!
//! One versioned, machine-readable provenance block shared conceptually by
//! Rust benchmark JSON, the Node reports and task-local Tauri probes (Node
//! mirror: `apps/desktop/scripts/provenance-utils.cjs`).
//!
//! The block records source identity (git HEAD, a privacy-safe dirty-tree
//! fingerprint, branch), build identity (profile, toolchain, binary SHA-256),
//! host identity (OS / architecture / CPU class) and input fixture hashes so
//! that artifacts from different dirty trees or binaries can be detected as
//! incomparable even when their `gitHead` matches.
//!
//! Privacy contract: `dirtyFingerprint` is a SHA-256 over the *normalized*
//! output of `git status --porcelain` — a hash, never an embedded path list.
//! File names are recorded relative to the repo root only. No tokens,
//! credentials or unrestricted user paths enter the block.

use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};

pub const PROVENANCE_SCHEMA_VERSION: u32 = 1;

/// Inputs the bench/report writer supplies; everything else is probed.
#[derive(Debug, Clone, Default)]
pub struct ProvenanceRequest<'a> {
    pub binary_path: Option<&'a Path>,
    pub fixture_paths: Vec<&'a Path>,
    pub profile: Option<&'a str>,
    pub attribution: Vec<&'a str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SourceIdentity {
    pub git_head: Option<String>,
    pub dirty: bool,
    pub dirty_fingerprint: Option<String>,
    pub branch: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BuildIdentity {
    pub profile: Option<String>,
    pub toolchain: Option<String>,
    pub binary: Option<BinaryIdentity>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BinaryIdentity {
    pub path: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FixtureIdentity {
    pub name: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HostIdentity {
    pub os: &'static str,
    pub arch: &'static str,
    pub cpu_class: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Provenance {
    pub schema_version: u32,
    pub generated_at: String,
    pub source: SourceIdentity,
    pub build: BuildIdentity,
    pub host: HostIdentity,
    pub fixtures: Vec<FixtureIdentity>,
    pub attribution: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComparisonResult {
    pub comparable: bool,
    pub mismatches: Vec<String>,
}

/// Collect provenance for the current tree. Git/rustc/file probes are
/// best-effort: failures yield `null` fields, never a panic.
pub fn collect(request: &ProvenanceRequest<'_>) -> Provenance {
    let git_head = run_git(&["rev-parse", "HEAD"]);
    let branch = run_git(&["branch", "--show-current"]);
    let (dirty_lines, dirty_fingerprint) = dirty_fingerprint();

    Provenance {
        schema_version: PROVENANCE_SCHEMA_VERSION,
        generated_at: utc_iso8601(),
        source: SourceIdentity {
            git_head,
            dirty: !dirty_lines.is_empty(),
            dirty_fingerprint,
            branch,
        },
        build: BuildIdentity {
            profile: request.profile.map(str::to_owned),
            toolchain: rustc_toolchain(),
            binary: request
                .binary_path
                .and_then(|p| hash_file(p).map(|(path, sha256)| BinaryIdentity { path, sha256 })),
        },
        host: host_identity(),
        fixtures: request
            .fixture_paths
            .iter()
            .filter_map(|p| hash_file(p).map(|(name, sha256)| FixtureIdentity { name, sha256 }))
            .collect(),
        attribution: request.attribution.iter().map(|s| (*s).to_owned()).collect(),
    }
}

/// Compare two provenance blocks for comparability eligibility. A matching
/// `gitHead` alone is *not* sufficient — the dirty-tree fingerprint must
/// match, and when present binary/toolchain/host/fixture identity must be
/// compatible.
pub fn compare(left: &Provenance, right: &Provenance) -> ComparisonResult {
    let mut mismatches = Vec::new();

    if left.schema_version != right.schema_version {
        mismatches.push(format!(
            "schema-version {} != {}",
            left.schema_version, right.schema_version
        ));
    }
    if left.source.git_head != right.source.git_head {
        mismatches.push(format!(
            "git-head {:?} != {:?}",
            left.source.git_head, right.source.git_head
        ));
    }
    match (&left.source.dirty_fingerprint, &right.source.dirty_fingerprint) {
        (Some(l), Some(r)) if l != r => mismatches.push("dirty-tree-differs".to_owned()),
        (Some(_), Some(_)) => {}
        _ => mismatches.push("missing-dirty-fingerprint".to_owned()),
    }
    match (&left.build.binary, &right.build.binary) {
        (Some(l), Some(r)) if l.sha256 != r.sha256 => {
            mismatches.push("binary-sha-differs".to_owned())
        }
        (Some(_), None) | (None, Some(_)) => {
            mismatches.push("binary-identity-missing".to_owned())
        }
        _ => {}
    }
    if left.host.os != right.host.os || left.host.arch != right.host.arch {
        mismatches.push(format!(
            "host-identity {} {} != {} {}",
            left.host.os, left.host.arch, right.host.os, right.host.arch
        ));
    }

    // Fixture pair check: for every name both sides record, hashes must match.
    for lf in &left.fixtures {
        if let Some(rf) = right.fixtures.iter().find(|rf| rf.name == lf.name) {
            if lf.sha256 != rf.sha256 && !mismatches.iter().any(|m| m == "fixture-sha-differs") {
                mismatches.push("fixture-sha-differs".to_owned());
            }
        }
    }

    ComparisonResult {
        comparable: mismatches.is_empty(),
        mismatches,
    }
}

fn dirty_fingerprint() -> (Vec<String>, Option<String>) {
    let Some(stdout) = run_git(&["status", "--porcelain"]) else {
        return (Vec::new(), None);
    };
    let mut lines: Vec<String> = stdout.lines().map(str::to_owned).collect();
    lines.sort();
    let hash = sha256_lines(&lines);
    (lines, Some(hash))
}

fn run_git(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8(out.stdout)
        .ok()
        .map(|s| s.trim().to_owned())
}

fn sha256_lines(lines: &[String]) -> String {
    let mut hasher = Sha256::new();
    for line in lines {
        hasher.update(line.as_bytes());
        hasher.update(b"\n");
    }
    format!("{:x}", hasher.finalize())
}

fn hash_file(path: &Path) -> Option<(String, String)> {
    let bytes = std::fs::read(path).ok()?;
    let sha = format!("{:x}", Sha256::digest(&bytes));
    let name = repo_relative(path);
    Some((name, sha))
}

/// Repo-root-relative name when possible (privacy + reproducibility). Uses
/// `/` separators so Node/Rust fixture identities compare equal cross-family.
fn repo_relative(path: &Path) -> String {
    if let Some(root) = run_git(&["rev-parse", "--show-toplevel"]) {
        let root = Path::new(root.trim());
        // Normalize to absolute so relative inputs (e.g. `.tmp/x.wav`) still
        // strip the absolute repo root.
        let absolute = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()
                .map(|cwd| cwd.join(path))
                .unwrap_or_else(|_| path.to_path_buf())
        };
        if let Ok(rel) = absolute.strip_prefix(root) {
            let joined = rel
                .components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            return joined;
        }
    }
    // Fallback: basename only — never an absolute user path (privacy).
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

fn rustc_toolchain() -> Option<String> {
    let out = Command::new("rustc").arg("--version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8(out.stdout).ok().map(|s| s.trim().to_owned())
}

fn host_identity() -> HostIdentity {
    HostIdentity {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        cpu_class: std::env::var("PROCESSOR_IDENTIFIER")
            .ok()
            .or_else(|| std::env::var("CPU_MODEL").ok()),
    }
}

fn utc_iso8601() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86_400;
    let sod = secs % 86_400;
    let (year, month, day) = civil_from_days(days as i64);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        sod / 3600,
        (sod % 3600) / 60,
        sod % 60
    )
}

/// Days-from-epoch to civil date (Howard Hinnant's days_from_civil inverse).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(head: &str, finger: Option<&str>, dirty: bool) -> Provenance {
        Provenance {
            schema_version: 1,
            generated_at: "2026-08-08T00:00:00Z".to_owned(),
            source: SourceIdentity {
                git_head: Some(head.to_owned()),
                dirty,
                dirty_fingerprint: finger.map(str::to_owned),
                branch: Some("feat/desktop-lyric".to_owned()),
            },
            build: BuildIdentity {
                profile: Some("release".to_owned()),
                toolchain: Some("rustc 1.85.0 (windows-x86_64)".to_owned()),
                binary: Some(BinaryIdentity {
                    path: "target/release/audio_server.exe".to_owned(),
                    sha256: "ab".repeat(32),
                }),
            },
            host: HostIdentity {
                os: "windows",
                arch: "x86_64",
                cpu_class: None,
            },
            fixtures: vec![FixtureIdentity {
                name: "fixtures/music.wav".to_owned(),
                sha256: "cd".repeat(32),
            }],
            attribution: vec!["in-process".to_owned()],
        }
    }

    #[test]
    fn identical_blocks_are_comparable() {
        let a = sample("abc", Some("fp1"), true);
        let b = sample("abc", Some("fp1"), true);
        let r = compare(&a, &b);
        assert!(r.comparable, "expected comparable: {:?}", r.mismatches);
        assert!(r.mismatches.is_empty());
    }

    #[test]
    fn same_head_different_dirty_tree_is_incomparable() {
        let a = sample("abc", Some("fp1"), true);
        let b = sample("abc", Some("fp2"), true);
        let r = compare(&a, &b);
        assert!(!r.comparable);
        assert!(r.mismatches.contains(&"dirty-tree-differs".to_owned()));
    }

    #[test]
    fn different_git_head_is_incomparable() {
        let a = sample("abc", Some("fp1"), true);
        let b = sample("def", Some("fp1"), true);
        let r = compare(&a, &b);
        assert!(!r.comparable);
        assert!(r.mismatches.iter().any(|m| m.starts_with("git-head")));
    }

    #[test]
    fn clean_vs_dirty_is_incomparable() {
        let a = sample("abc", Some("fp-clean"), false);
        let b = sample("abc", Some("fp-dirty"), true);
        let r = compare(&a, &b);
        assert!(!r.comparable);
        assert!(r.mismatches.contains(&"dirty-tree-differs".to_owned()));
    }

    #[test]
    fn missing_dirty_fingerprint_is_incomparable() {
        let a = sample("abc", None, false);
        let b = sample("abc", Some("fp"), true);
        let r = compare(&a, &b);
        assert!(!r.comparable);
        assert!(r.mismatches.contains(&"missing-dirty-fingerprint".to_owned()));
    }

    #[test]
    fn binary_sha_mismatch_is_incomparable() {
        let mut a = sample("abc", Some("fp1"), true);
        a.build.binary.as_mut().unwrap().sha256 = "ff".repeat(32);
        let b = sample("abc", Some("fp1"), true);
        let r = compare(&a, &b);
        assert!(!r.comparable);
        assert!(r.mismatches.contains(&"binary-sha-differs".to_owned()));
    }

    #[test]
    fn fixture_sha_mismatch_is_incomparable() {
        let mut a = sample("abc", Some("fp1"), true);
        a.fixtures[0].sha256 = "ee".repeat(32);
        let b = sample("abc", Some("fp1"), true);
        let r = compare(&a, &b);
        assert!(!r.comparable);
        assert!(r.mismatches.contains(&"fixture-sha-differs".to_owned()));
    }

    #[test]
    fn civil_date_roundtrip() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1));
    }

    #[test]
    fn sha256_lines_is_deterministic_and_path_free() {
        let lines_1 = vec![" M src/a.rs".to_owned(), "?? apps/x.ts".to_owned()];
        let h1 = sha256_lines(&lines_1);
        let h2 = sha256_lines(&lines_1);
        assert_eq!(h1, h2, "same input must hash identically");
        assert_eq!(h1.len(), 64);
        assert!(!h1.contains('/'));

        // Hashing never leaks raw lines; a different tree yields a different hash.
        let lines_2 = vec![" M src/a.rs".to_owned()];
        assert_ne!(h1, sha256_lines(&lines_2));
    }

    #[test]
    fn repo_relative_falls_back_to_basename_outside_repo() {
        // A path outside the repo (e.g. a temp fixture) must not leak an
        // absolute user path into provenance; basename only.
        let outside = std::env::temp_dir().join("lyne-source-seek-bench-12345.wav");
        assert_eq!(repo_relative(&outside), "lyne-source-seek-bench-12345.wav");
    }

    #[test]
    fn repo_relative_uses_forward_slashes_inside_repo() {
        // Absolute path inside the repo -> repo-relative with '/' separators.
        let absolute = std::env::current_dir()
            .expect("cwd")
            .join(".tmp")
            .join("fixture.wav");
        let relative = repo_relative(&absolute);
        assert!(
            !relative.contains('\\'),
            "repo-relative names must use '/': {relative}"
        );
        assert_eq!(relative, ".tmp/fixture.wav");
    }
}
# Thin compatibility entry point for the canonical Rust runtime stager.
[CmdletBinding()]
param(
    [string]$Profile = "release",
    [string]$TargetDir = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = if ($PSScriptRoot) {
    (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
    (Get-Location).Path
}

if ([string]::IsNullOrWhiteSpace($TargetDir)) {
    $TargetDir = Join-Path $repoRoot "target"
} elseif (-not [System.IO.Path]::IsPathRooted($TargetDir)) {
    $TargetDir = Join-Path $repoRoot $TargetDir
}

$manifestPath = Join-Path $repoRoot "crates\windows-runtime-stage\Cargo.toml"
$arguments = @(
    "run",
    "--quiet",
    "--manifest-path", $manifestPath,
    "--bin", "stage-windows-runtime",
    "--",
    "--target-dir", $TargetDir,
    "--profile", $Profile
)

Push-Location $repoRoot
try {
    & cargo @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "stage-windows-runtime failed with exit code $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

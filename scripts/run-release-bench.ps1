# Build and run a release bench with production-consistent panic=abort and staged soxr DLLs.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Bench,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$BenchArgs = @(),

    [string]$Profile = "release",
    [string]$TargetDir = "",
    [switch]$SkipBuild
)

# Allow callers to pass a cargo-style `--` separator before bench flags.
if ($BenchArgs.Count -gt 0 -and $BenchArgs[0] -eq '--') {
    $BenchArgs = @($BenchArgs | Select-Object -Skip 1)
}

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
    if ($PSScriptRoot) {
        return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
    }
    return (Get-Location).Path
}

$repoRoot = Resolve-RepoRoot
Set-Location $repoRoot

if (-not $TargetDir) {
    $TargetDir = Join-Path $repoRoot "target"
}

$stageScript = Join-Path $PSScriptRoot "stage-soxr-runtime.ps1"
& $stageScript -Profile $Profile -TargetDir $TargetDir

$profileDir = Join-Path $TargetDir $Profile
$depsDir = Join-Path $profileDir "deps"

# Ensure Windows loader can resolve MinGW deps even if a future bench lands outside deps/.
$env:PATH = @($profileDir, $depsDir, $env:PATH) -join ';'

if (-not $SkipBuild) {
    Write-Host ">>> cargo rustc --profile $Profile --bench $Bench -- -C panic=abort" -ForegroundColor Cyan
    cargo rustc --profile $Profile --bench $Bench -- -C panic=abort
    if ($LASTEXITCODE -ne 0) {
        throw "cargo rustc failed for bench '$Bench' (exit $LASTEXITCODE)"
    }
    # Re-stage after build in case core only dropped libsoxr into the profile root.
    & $stageScript -Profile $Profile -TargetDir $TargetDir | Out-Null
}

$pattern = Join-Path $depsDir ($Bench + "-*.exe")
$exe = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $exe) {
    throw "Bench executable not found: $pattern"
}

Write-Host (">>> running " + $exe.FullName + " " + ($BenchArgs -join " ")) -ForegroundColor Cyan
& $exe.FullName @BenchArgs
exit $LASTEXITCODE

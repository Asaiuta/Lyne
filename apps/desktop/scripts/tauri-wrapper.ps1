param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CliArgs
)

$ErrorActionPreference = "Stop"

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoRoot = (Resolve-Path (Join-Path $workspaceRoot "..\\..")).Path
$tauriCliPath = Join-Path $workspaceRoot "node_modules\\@tauri-apps\\cli\\tauri.js"

if (-not (Test-Path $tauriCliPath)) {
  throw "Tauri CLI entrypoint not found at '$tauriCliPath'. Run npm install in apps/desktop first."
}

$preferredCargoHome = $env:CARGO_HOME
if ([string]::IsNullOrWhiteSpace($preferredCargoHome)) {
  $preferredCargoHome = "D:\Rust\.cargo"
}
$tauriTargetDir = Join-Path $repoRoot "target"
New-Item -ItemType Directory -Force -Path $preferredCargoHome | Out-Null
New-Item -ItemType Directory -Force -Path $tauriTargetDir | Out-Null

# Keep using the machine-wide Cargo cache so Tauri dependencies do not need to
# be re-downloaded, while sharing the repo-local target directory with the
# standalone sidecar scripts so dev builds reuse the same artifacts.
$env:CARGO_HOME = $preferredCargoHome
$env:CARGO_TARGET_DIR = $tauriTargetDir

function Test-DevServerReady {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 60
  )

  $probeHosts = @("127.0.0.1", "localhost")
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    foreach ($probeHost in $probeHosts) {
      try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://$probeHost`:$Port" -TimeoutSec 2
        if ($response.StatusCode -ge 200) {
          return $true
        }
      } catch {
        # Keep probing both loopback hostnames; Vite may bind only one.
      }
    }

    try {
      $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
      if ($listener) {
        return $true
      }
    } catch {
      # Fall through to retry.
    }

    Start-Sleep -Milliseconds 500
  }

  return $false
}

function Invoke-TauriDevFallback {
  $devServerLog = Join-Path $workspaceRoot ".tauri-dev-server.log"
  $devServerErrLog = Join-Path $workspaceRoot ".tauri-dev-server.err.log"
  $cargoManifest = Join-Path $workspaceRoot "src-tauri\\Cargo.toml"
  $cargoArgs = @("run", "--manifest-path", $cargoManifest)
  $sidecarManifest = Join-Path $repoRoot "Cargo.toml"
  $sidecarProfile = "audio-dev"

  if ($CliArgs -contains "--release") {
    $cargoArgs += "--release"
    $sidecarProfile = "release"
    $sidecarBuildArgs = @("build", "--release", "--manifest-path", $sidecarManifest, "--bin", "audio_server")
  } else {
    $sidecarBuildArgs = @("build", "--profile", $sidecarProfile, "--manifest-path", $sidecarManifest, "--bin", "audio_server")
  }
  $sidecarBinaryPath = Join-Path $env:CARGO_TARGET_DIR "$sidecarProfile\\audio_server.exe"

  Get-Process -Name "audio-desktop","audio_server" -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      Stop-Process -Id $_.Id -Force -ErrorAction Stop
    } catch {
      Write-Warning "Failed to stop stale process $($_.ProcessName) (PID=$($_.Id)): $($_.Exception.Message)"
    }
  }

  & cargo @sidecarBuildArgs
  if ($LASTEXITCODE -ne 0) {
    return $LASTEXITCODE
  }

  $viteProcess = [System.Diagnostics.Process]::new()
  $viteProcess.StartInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $viteProcess.StartInfo.FileName = "cmd.exe"
  $viteProcess.StartInfo.Arguments = "/d /c npm run dev 1> `"$devServerLog`" 2> `"$devServerErrLog`""
  $viteProcess.StartInfo.WorkingDirectory = $workspaceRoot
  $viteProcess.StartInfo.UseShellExecute = $false
  $viteProcess.StartInfo.CreateNoWindow = $true
  $viteProcess.StartInfo.EnvironmentVariables["CARGO_HOME"] = $env:CARGO_HOME
  $viteProcess.StartInfo.EnvironmentVariables["CARGO_TARGET_DIR"] = $env:CARGO_TARGET_DIR
  $null = $viteProcess.Start()

  try {
    if (-not (Test-DevServerReady -Port 5173 -TimeoutSeconds 90)) {
      throw "Vite dev server did not become ready on http://127.0.0.1:5173 within 90s. See '$devServerLog' and '$devServerErrLog'."
    }

    $env:AUDIO_SERVER_PATH = $sidecarBinaryPath
    & cargo @cargoArgs
    return $LASTEXITCODE
  } finally {
    Remove-Item Env:\AUDIO_SERVER_PATH -ErrorAction SilentlyContinue
    if ($viteProcess -and -not $viteProcess.HasExited) {
      $viteProcess.Kill()
      $viteProcess.WaitForExit()
    }
    $viteProcess.Dispose()
  }
}

if ($null -ne $CliArgs -and $CliArgs.Count -gt 0 -and $CliArgs[0] -eq "dev") {
  $exitCode = Invoke-TauriDevFallback
  exit $exitCode
}

& node $tauriCliPath @CliArgs
exit $LASTEXITCODE

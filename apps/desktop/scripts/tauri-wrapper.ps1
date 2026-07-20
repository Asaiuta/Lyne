param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CliArgs
)

$ErrorActionPreference = "Stop"
$script:NetTcpInspectionAvailable = $true

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoRoot = (Resolve-Path (Join-Path $workspaceRoot "..\..")).Path
$tauriCliPath = Join-Path $workspaceRoot "node_modules\@tauri-apps\cli\tauri.js"
$viteCliPath = Join-Path $workspaceRoot "node_modules\vite\bin\vite.js"
$sidecarBuildScript = Join-Path $workspaceRoot "scripts\build-sidecar.mjs"

if (-not (Test-Path -LiteralPath $tauriCliPath)) {
  throw "Tauri CLI entrypoint not found at '$tauriCliPath'. Run npm install in apps/desktop first."
}

$preferredCargoHome = $env:CARGO_HOME
if ([string]::IsNullOrWhiteSpace($preferredCargoHome)) {
  $preferredCargoHome = "D:\Rust\.cargo"
}
$tauriTargetDir = Join-Path $repoRoot "target"
New-Item -ItemType Directory -Force -Path $preferredCargoHome | Out-Null
New-Item -ItemType Directory -Force -Path $tauriTargetDir | Out-Null

# Keep using the machine-wide Cargo cache while sharing the repo-local target
# directory with sidecar builds and the Tauri shell.
$env:CARGO_HOME = $preferredCargoHome
$env:CARGO_TARGET_DIR = $tauriTargetDir

function Get-BoundedLogTail {
  param(
    [string]$Path,
    [int]$MaxLines = 80,
    [int]$MaxCharacters = 8192
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return "<log file not created: $Path>"
  }

  try {
    $text = ((Get-Content -LiteralPath $Path -Tail $MaxLines -ErrorAction Stop) -join [Environment]::NewLine)
    if ($text.Length -gt $MaxCharacters) {
      return $text.Substring($text.Length - $MaxCharacters)
    }
    if ([string]::IsNullOrWhiteSpace($text)) {
      return "<log file is empty: $Path>"
    }
    return $text
  } catch {
    return "<failed to read '$Path': $($_.Exception.Message)>"
  }
}

function Format-ViteLogTail {
  param(
    [string]$StdoutPath,
    [string]$StderrPath
  )

  $stdoutTail = Get-BoundedLogTail -Path $StdoutPath
  $stderrTail = Get-BoundedLogTail -Path $StderrPath
  return "Vite stdout tail ($StdoutPath):`n$stdoutTail`nVite stderr tail ($StderrPath):`n$stderrTail"
}

function Get-NetstatLoopbackListeners {
  param([int]$Port)

  $netstatPath = Join-Path $env:SystemRoot "System32\netstat.exe"
  $rows = @(& $netstatPath -ano 2>$null)
  if ($LASTEXITCODE -ne 0) {
    throw "netstat failed with exit code $LASTEXITCODE"
  }

  $listeners = @()
  foreach ($row in $rows) {
    if ($row -notmatch '^\s*TCP\s+(?<local>\S+)\s+\S+\s+LISTENING\s+(?<pid>\d+)\s*$') {
      continue
    }

    $localEndpoint = $Matches.local
    $ownerProcessId = [int]$Matches.pid
    $localAddress = $null
    $localPort = $null
    if ($localEndpoint -match '^\[(?<address>.+)\]:(?<port>\d+)$') {
      $localAddress = $Matches.address
      $localPort = [int]$Matches.port
    } elseif ($localEndpoint -match '^(?<address>[^:]+):(?<port>\d+)$') {
      $localAddress = $Matches.address
      $localPort = [int]$Matches.port
    }

    if ($localPort -eq $Port -and $localAddress -in @("127.0.0.1", "::1", "0.0.0.0", "::")) {
      $listeners += [pscustomobject]@{
        LocalAddress = $localAddress
        LocalPort = $localPort
        OwningProcess = $ownerProcessId
      }
    }
  }
  return @($listeners)
}

function Get-LoopbackListeners {
  param([int]$Port)

  try {
    $loopbackAddresses = @("127.0.0.1", "::1", "0.0.0.0", "::")
    return @(
      Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
        Where-Object { $loopbackAddresses -contains [string]$_.LocalAddress }
    )
  } catch {
    try {
      $listeners = @(Get-NetstatLoopbackListeners -Port $Port)
      $script:NetTcpInspectionAvailable = $true
      return $listeners
    } catch {
      $script:NetTcpInspectionAvailable = $false
      return @()
    }
  }
}

function Format-ListenerOwner {
  param($Listener)

  $processName = "unknown"
  $processPath = "unavailable"
  try {
    $owner = Get-Process -Id $Listener.OwningProcess -ErrorAction Stop
    $processName = $owner.ProcessName
    try {
      if ($owner.Path) {
        $processPath = $owner.Path
      }
    } catch {
      # Process paths can be unavailable for elevated/system owners.
    }
  } catch {
    # The process may have exited between the TCP and process snapshots.
  }

  $address = if ([string]$Listener.LocalAddress -eq "::1" -or [string]$Listener.LocalAddress -eq "::") {
    "[$($Listener.LocalAddress)]"
  } else {
    [string]$Listener.LocalAddress
  }
  return "$address`:$($Listener.LocalPort) -> PID $($Listener.OwningProcess) ($processName, $processPath)"
}

function Assert-AddressBindable {
  param(
    [System.Net.IPAddress]$Address,
    [int]$Port
  )

  $listener = [System.Net.Sockets.TcpListener]::new($Address, $Port)
  try {
    $listener.Server.ExclusiveAddressUse = $true
    $listener.Start()
  } catch {
    throw "Vite port $Port cannot be reserved on $Address`: $($_.Exception.Message)"
  } finally {
    $listener.Stop()
  }
}

function Assert-VitePortAvailable {
  param([int]$Port)

  $listeners = @(Get-LoopbackListeners -Port $Port)
  if ($listeners.Count -gt 0) {
    $owners = @($listeners | ForEach-Object { Format-ListenerOwner -Listener $_ })
    throw "Vite port $Port is already occupied. Stop the existing listener before starting Tauri Dev:`n  $($owners -join "`n  ")"
  }

  Assert-AddressBindable -Address ([System.Net.IPAddress]::Loopback) -Port $Port
  Assert-AddressBindable -Address ([System.Net.IPAddress]::IPv6Loopback) -Port $Port
}

function Test-ViteHttpReady {
  param([int]$Port)

  foreach ($uri in @("http://127.0.0.1:$Port", "http://[::1]:$Port", "http://localhost:$Port")) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $uri -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {
      # Vite may bind one loopback family only; keep probing all candidates.
    }
  }
  return $false
}

function Wait-ViteReady {
  param(
    [System.Diagnostics.Process]$Process,
    [int]$Port,
    [string]$StdoutPath,
    [string]$StderrPath,
    [int]$TimeoutSeconds = 90
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $Process.Refresh()
    if ($Process.HasExited) {
      $logs = Format-ViteLogTail -StdoutPath $StdoutPath -StderrPath $StderrPath
      throw "The Vite process spawned for this Tauri run exited before readiness (PID=$($Process.Id), exit=$($Process.ExitCode)).`n$logs"
    }

    $listeners = @(Get-LoopbackListeners -Port $Port)
    if ($script:NetTcpInspectionAvailable -and $listeners.Count -gt 0) {
      # The wrapper starts node.exe directly, so Vite itself must own the
      # listener. Its esbuild children are never accepted as readiness proof.
      $ownedListeners = @($listeners | Where-Object { [int]$_.OwningProcess -eq $Process.Id })
      $foreignListeners = @($listeners | Where-Object { [int]$_.OwningProcess -ne $Process.Id })
      if ($foreignListeners.Count -gt 0) {
        $owners = @($foreignListeners | ForEach-Object { Format-ListenerOwner -Listener $_ })
        throw "Vite port $Port was claimed by a process outside this wrapper after preflight:`n  $($owners -join "`n  ")"
      }
      if ($ownedListeners.Count -gt 0 -and (Test-ViteHttpReady -Port $Port)) {
        return
      }
    } elseif (-not $script:NetTcpInspectionAvailable -and (Test-ViteHttpReady -Port $Port)) {
      return
    }

    Start-Sleep -Milliseconds 250
  }

  $logs = Format-ViteLogTail -StdoutPath $StdoutPath -StderrPath $StderrPath
  throw "The Vite process (PID=$($Process.Id)) stayed alive but did not become ready on loopback port $Port within ${TimeoutSeconds}s.`n$logs"
}

function Stop-ProcessTree {
  param(
    [System.Diagnostics.Process]$Process,
    [int]$ListenerPort
  )

  if ($null -eq $Process) {
    return
  }

  $rootProcessId = $Process.Id
  try {
    $Process.Refresh()
    if (-not $Process.HasExited) {
      $taskkillPath = Join-Path $env:SystemRoot "System32\taskkill.exe"
      & $taskkillPath /PID $Process.Id /T /F 2>&1 | Out-Null
      $Process.Refresh()
      if (-not $Process.HasExited) {
        $null = $Process.WaitForExit(10000)
      }
    }

    Start-Sleep -Milliseconds 200
    if ($script:NetTcpInspectionAvailable) {
      $remaining = @(
        Get-LoopbackListeners -Port $ListenerPort |
          Where-Object { [int]$_.OwningProcess -eq $rootProcessId }
      )
      if ($remaining.Count -gt 0) {
        $owners = @($remaining | ForEach-Object { Format-ListenerOwner -Listener $_ })
        Write-Warning "Vite process-tree cleanup left an owned listener:`n  $($owners -join "`n  ")"
      }
    }
  } finally {
    $Process.Dispose()
  }
}

function Stop-CheckoutDesktopProcesses {
  $targetPrefix = $env:CARGO_TARGET_DIR.TrimEnd('\') + '\'
  Get-Process -Name "audio-desktop", "audio_server" -ErrorAction SilentlyContinue | ForEach-Object {
    $processPath = $null
    try {
      $processPath = $_.Path
    } catch {
      # Do not kill a process when its checkout ownership cannot be proved.
    }
    if ($processPath -and $processPath.StartsWith($targetPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      try {
        Stop-Process -Id $_.Id -Force -ErrorAction Stop
      } catch {
        Write-Warning "Failed to stop stale checkout process $($_.ProcessName) (PID=$($_.Id)): $($_.Exception.Message)"
      }
    }
  }
}

function New-TauriDevConfigOverride {
  param([string]$ExistingConfig)

  if ([string]::IsNullOrWhiteSpace($ExistingConfig)) {
    $config = [pscustomobject]@{}
  } else {
    try {
      $config = $ExistingConfig | ConvertFrom-Json -ErrorAction Stop
    } catch {
      throw "TAURI_CONFIG contains invalid JSON: $($_.Exception.Message)"
    }
  }

  if ($null -eq $config -or $config -isnot [psobject]) {
    throw "TAURI_CONFIG must be a JSON object."
  }
  if ($null -eq $config.PSObject.Properties['bundle']) {
    $config | Add-Member -MemberType NoteProperty -Name bundle -Value ([pscustomobject]@{})
  } elseif ($null -eq $config.bundle -or $config.bundle -isnot [psobject]) {
    throw "TAURI_CONFIG.bundle must be a JSON object."
  }
  if ($null -eq $config.bundle.PSObject.Properties['resources']) {
    $config.bundle | Add-Member -MemberType NoteProperty -Name resources -Value @()
  } else {
    $config.bundle.resources = @()
  }

  return ($config | ConvertTo-Json -Depth 100 -Compress)
}

function Invoke-TauriDevFallback {
  $vitePort = 5173
  $devServerLog = Join-Path $workspaceRoot ".tauri-dev-server.log"
  $devServerErrLog = Join-Path $workspaceRoot ".tauri-dev-server.err.log"
  $cargoManifest = Join-Path $workspaceRoot "src-tauri\Cargo.toml"
  $cargoArgs = @("run", "--manifest-path", $cargoManifest, "--bin", "audio-desktop")
  $sidecarProfile = "dev"
  $sidecarOutputProfile = "audio-dev"

  if ($CliArgs -contains "--release") {
    $cargoArgs += "--release"
    $sidecarProfile = "release"
    $sidecarOutputProfile = "release"
  }
  $sidecarBinaryPath = Join-Path $env:CARGO_TARGET_DIR "$sidecarOutputProfile\audio_server.exe"

  Assert-VitePortAvailable -Port $vitePort
  Stop-CheckoutDesktopProcesses

  & node $sidecarBuildScript $sidecarProfile
  if ($LASTEXITCODE -ne 0) {
    return $LASTEXITCODE
  }

  $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
  $viteProcess = Start-Process `
    -FilePath $nodePath `
    -ArgumentList @("`"$viteCliPath`"") `
    -WorkingDirectory $workspaceRoot `
    -RedirectStandardOutput $devServerLog `
    -RedirectStandardError $devServerErrLog `
    -WindowStyle Hidden `
    -PassThru

  try {
    Wait-ViteReady `
      -Process $viteProcess `
      -Port $vitePort `
      -StdoutPath $devServerLog `
      -StderrPath $devServerErrLog

    $env:AUDIO_SERVER_PATH = $sidecarBinaryPath
    $hadTauriConfig = Test-Path Env:\TAURI_CONFIG
    $previousTauriConfig = $env:TAURI_CONFIG
    $env:TAURI_CONFIG = New-TauriDevConfigOverride -ExistingConfig $previousTauriConfig
    try {
      & cargo @cargoArgs
      $cargoExitCode = $LASTEXITCODE
    } finally {
      if ($hadTauriConfig) {
        $env:TAURI_CONFIG = $previousTauriConfig
      } else {
        Remove-Item Env:\TAURI_CONFIG -ErrorAction SilentlyContinue
      }
    }
    return $cargoExitCode
  } finally {
    Remove-Item Env:\AUDIO_SERVER_PATH -ErrorAction SilentlyContinue
    try {
      Stop-ProcessTree -Process $viteProcess -ListenerPort $vitePort
    } finally {
      # Covers forced shell termination where Tauri cannot run its Rust cleanup.
      Stop-CheckoutDesktopProcesses
    }
  }
}

if ($null -ne $CliArgs -and $CliArgs.Count -gt 0 -and $CliArgs[0] -eq "dev") {
  $exitCode = Invoke-TauriDevFallback
  exit $exitCode
}

& node $tauriCliPath @CliArgs
exit $LASTEXITCODE

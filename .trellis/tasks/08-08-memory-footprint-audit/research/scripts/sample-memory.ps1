param(
    [string]$OutDir = "research/data",
    [int]$DurationSec = 120,
    [string]$Tag = "idle",
    [int]$IntervalMs = 5000,
    [string]$DiagnosticsUrl = "http://127.0.0.1:18083/diagnostics/runtime"
)
$ErrorActionPreference = "Continue"
$out = Join-Path $OutDir ("mem-" + $Tag + "-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
mkdir -Force $OutDir | Out-Null
$csv = "$out.csv"
$jsonl = "$out.jsonl"
$start = Get-Date
$interval = $IntervalMs / 1000.0
"t_sec,audio_desktop_ws,audio_desktop_pb,audio_server_ws,audio_server_pb,webview_ws,webview_pb,total_ws,total_pb,decode_mb,decode_cap_mb" | Out-File $csv -Encoding utf8
$i = 0
while (((Get-Date) - $start).TotalSeconds -lt $DurationSec) {
    $procs = Get-CimInstance Win32_Process -Filter "Name like 'audio%' or Name like 'msedgewebview2%'" -ErrorAction SilentlyContinue |
        Select-Object Name, ProcessId, WorkingSetSize, PrivatePageCount
    $adb = [double](($procs | Where-Object { $_.Name -eq 'audio-desktop.exe' } | Measure-Object WorkingSetSize -Sum).Sum)
    $adp = [double](($procs | Where-Object { $_.Name -eq 'audio-desktop.exe' } | Measure-Object PrivatePageCount -Sum).Sum)
    $asb = [double](($procs | Where-Object { $_.Name -eq 'audio_server.exe' } | Measure-Object WorkingSetSize -Sum).Sum)
    $asp = [double](($procs | Where-Object { $_.Name -eq 'audio_server.exe' } | Measure-Object PrivatePageCount -Sum).Sum)
    $wvb = [double](($procs | Where-Object { $_.Name -eq 'msedgewebview2.exe' } | Measure-Object WorkingSetSize -Sum).Sum)
    $wvp = [double](($procs | Where-Object { $_.Name -eq 'msedgewebview2.exe' } | Measure-Object PrivatePageCount -Sum).Sum)
    $totalWs = [double](($procs | Measure-Object WorkingSetSize -Sum).Sum)
    $totalPb = [double](($procs | Measure-Object PrivatePageCount -Sum).Sum)
    $decode = ""
    $decodeCap = ""
    try {
        $d = Invoke-WebRequest -Uri $DiagnosticsUrl -UseBasicParsing -TimeoutSec 5
        $j = $d.Content | ConvertFrom-Json
        $decode = $j.decode.memory_ledger.current_bytes
        $decodeCap = $j.decode.memory_budget.max_bytes
        $j | ConvertTo-Json -Depth 6 -Compress | Out-File $jsonl -Append -Encoding utf8
    } catch { }
    $sec = [math]::Round(((Get-Date) - $start).TotalSeconds, 1)
    "$sec,$adb,$adp,$asb,$asp,$wvb,$wvp,$totalWs,$totalPb,$decode,$decodeCap" | Out-File $csv -Append -Encoding utf8
    Start-Sleep -Milliseconds $IntervalMs
    $i++
}
Write-Host "sampled $i points -> $csv (+ $jsonl)"
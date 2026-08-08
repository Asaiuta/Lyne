param([string]$Out = "webview.csv", [int]$DurationSec = 50)
$ErrorActionPreference = "SilentlyContinue"
"t_sec;pid;parent;name;ws_mb;pb_mb" | Out-File $Out -Encoding utf8
$appPid = (Get-Process -Name audio-desktop -ErrorAction SilentlyContinue | Select-Object -First 1).Id
if (-not $appPid) { Write-Host "no app"; exit 1 }
$start = Get-Date
while (((Get-Date) - $start).TotalSeconds -lt $DurationSec) {
    $pids = Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'audio|webview' }
    $all = @($pids | Where-Object { $_.ProcessId -eq $appPid -or $_.ParentProcessId -eq $appPid })
    $changed = $true
    while ($changed) { $changed = $false; foreach ($p in $pids) { if ($all.ProcessId -contains $p.ParentProcessId -and $all.ProcessId -notcontains $p.ProcessId) { $all += $p; $changed = $true } } }
    $sec = [math]::Round(((Get-Date) - $start).TotalSeconds, 1)
    foreach ($p in $all) { "$sec;$($p.ProcessId);$($p.ParentProcessId);$($p.Name);$([math]::Round($p.WorkingSetSize/1MB,1));$([math]::Round($p.PrivatePageCount/1MB,1))" | Out-File $Out -Append -Encoding utf8 }
    Start-Sleep -Seconds 5
}

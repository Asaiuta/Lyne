param(
    [string]$Out = "browse-mem.csv",
    [int]$DurationSec = 1500,
    [int]$IntervalMs = 5000
)
$ErrorActionPreference = "SilentlyContinue"
"t_sec,pid,parent,name,ws_mb,pb_mb" | Out-File $Out -Encoding utf8
$start = Get-Date
$appPid = (Get-Process -Name audio-desktop -ErrorAction SilentlyContinue | Select-Object -First 1).Id
"root pid: $appPid" | Out-File $env:TEMP\sample-tier.log -Append
while (((Get-Date) - $start).TotalSeconds -lt $DurationSec) {
    $pids = Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'audio|webview' } |
        Select-Object ProcessId, ParentProcessId, Name, WorkingSetSize, PrivatePageCount
    $all = @()
    if ($appPid) {
        $all = @($pids | Where-Object { $_.ProcessId -eq $appPid -or $_.ParentProcessId -eq $appPid })
        $changed = $true
        while ($changed) {
            $changed = $false
            foreach ($p in $pids) {
                if ($all.ProcessId -contains $p.ParentProcessId -and $all.ProcessId -notcontains $p.ProcessId) {
                    $all += $p; $changed = $true
                }
            }
        }
    }
    $sec = [math]::Round(((Get-Date) - $start).TotalSeconds, 1)
    foreach ($p in $all) {
        $ws = [math]::Round($p.WorkingSetSize / 1MB, 1)
        $pb = [math]::Round($p.PrivatePageCount / 1MB, 1)
        "$sec,$($p.ProcessId),$($p.ParentProcessId),$($p.Name),$ws,$pb" | Out-File $Out -Append -Encoding utf8
    }
    Start-Sleep -Milliseconds $IntervalMs
}
"sampled done" | Out-File $env:TEMP\sample-tier.log -Append
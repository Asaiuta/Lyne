# Stage MinGW/MSYS2 soxr runtime DLLs into Cargo profile + deps directories.
# Mirrors root build.rs so benches/servers can be fixed without a full rebuild.
[CmdletBinding()]
param(
    [string]$Profile = "release",
    [string]$TargetDir = ""
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
    if ($PSScriptRoot) {
        return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
    }
    return (Get-Location).Path
}

function Find-SoxrDll {
    param([string[]]$SearchDirs)

    $names = @("libsoxr.dll", "soxr.dll")
    foreach ($dir in $SearchDirs) {
        if (-not $dir -or -not (Test-Path $dir)) { continue }
        foreach ($name in $names) {
            $candidate = Join-Path $dir $name
            if (Test-Path $candidate) { return (Resolve-Path $candidate).Path }
        }
    }

    $userProfile = $env:USERPROFILE
    if ($userProfile) {
        $msysRoot = Join-Path $userProfile "scoop\apps\msys2"
        if (Test-Path $msysRoot) {
            Get-ChildItem -Path $msysRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                $bin = Join-Path $_.FullName "mingw64\bin"
                foreach ($name in $names) {
                    $candidate = Join-Path $bin $name
                    if (Test-Path $candidate) { return (Resolve-Path $candidate).Path }
                }
            }
        }
    }

    foreach ($root in @("C:\msys64\mingw64\bin", "D:\msys64\mingw64\bin")) {
        foreach ($name in $names) {
            $candidate = Join-Path $root $name
            if (Test-Path $candidate) { return (Resolve-Path $candidate).Path }
        }
    }

    foreach ($entry in ($env:PATH -split ';')) {
        if (-not $entry) { continue }
        foreach ($name in $names) {
            $candidate = Join-Path $entry $name
            if (Test-Path $candidate) { return (Resolve-Path $candidate).Path }
        }
    }

    return $null
}

function Get-PeImportDllNames {
    param([string]$Path)

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 0x40 -or $bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) {
        return @()
    }

    $eLfanew = [BitConverter]::ToInt32($bytes, 0x3C)
    if ($eLfanew -lt 0 -or ($eLfanew + 24) -gt $bytes.Length) { return @() }
    if ([System.Text.Encoding]::ASCII.GetString($bytes, $eLfanew, 4) -ne "PE`0`0") { return @() }

    $numSections = [BitConverter]::ToUInt16($bytes, $eLfanew + 6)
    $sizeOpt = [BitConverter]::ToUInt16($bytes, $eLfanew + 20)
    $optOff = $eLfanew + 24
    $magic = [BitConverter]::ToUInt16($bytes, $optOff)
    $ddOff = if ($magic -eq 0x20B) { $optOff + 112 } elseif ($magic -eq 0x10B) { $optOff + 96 } else { return @() }
    if (($ddOff + 16) -gt $bytes.Length) { return @() }
    $importRva = [BitConverter]::ToUInt32($bytes, $ddOff + 8)
    if ($importRva -eq 0) { return @() }

    $secOff = $optOff + $sizeOpt
    $sections = @()
    for ($i = 0; $i -lt $numSections; $i++) {
        $off = $secOff + ($i * 40)
        if (($off + 40) -gt $bytes.Length) { break }
        $sections += [pscustomobject]@{
            VAddr = [BitConverter]::ToUInt32($bytes, $off + 12)
            VSize = [BitConverter]::ToUInt32($bytes, $off + 8)
            ROff  = [BitConverter]::ToUInt32($bytes, $off + 20)
            RSize = [BitConverter]::ToUInt32($bytes, $off + 16)
        }
    }

    function Convert-RvaToOffset([uint32]$rva) {
        foreach ($section in $sections) {
            $span = [Math]::Max($section.VSize, $section.RSize)
            if ($rva -ge $section.VAddr -and $rva -lt ($section.VAddr + $span)) {
                return [int]($section.ROff + ($rva - $section.VAddr))
            }
        }
        return -1
    }

    $off = Convert-RvaToOffset $importRva
    if ($off -lt 0) { return @() }

    $imports = New-Object System.Collections.Generic.List[string]
    while (($off + 20) -le $bytes.Length) {
        $orig = [BitConverter]::ToUInt32($bytes, $off)
        $nameRva = [BitConverter]::ToUInt32($bytes, $off + 12)
        $firstThunk = [BitConverter]::ToUInt32($bytes, $off + 16)
        if ($orig -eq 0 -and $nameRva -eq 0 -and $firstThunk -eq 0) { break }
        $nameOff = Convert-RvaToOffset $nameRva
        if ($nameOff -ge 0) {
            $end = $nameOff
            while ($end -lt $bytes.Length -and $bytes[$end] -ne 0) { $end++ }
            if ($end -gt $nameOff) {
                $imports.Add([System.Text.Encoding]::ASCII.GetString($bytes, $nameOff, $end - $nameOff))
            }
        }
        $off += 20
    }
    return $imports
}

function Test-SystemDll([string]$Name) {
    $lower = $Name.ToLowerInvariant()
    if ($lower.StartsWith("api-ms-win-") -or $lower.StartsWith("ext-ms-")) { return $true }
    $system = @(
        "kernel32.dll", "kernelbase.dll", "ntdll.dll", "user32.dll", "gdi32.dll",
        "advapi32.dll", "sechost.dll", "rpcrt4.dll", "msvcrt.dll", "ucrtbase.dll",
        "vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll", "bcrypt.dll",
        "bcryptprimitives.dll", "ws2_32.dll", "ole32.dll", "oleaut32.dll", "combase.dll",
        "shell32.dll", "shlwapi.dll", "winmm.dll", "imm32.dll", "setupapi.dll",
        "cfgmgr32.dll", "psapi.dll", "version.dll", "dbghelp.dll", "crypt32.dll",
        "wintrust.dll", "iphlpapi.dll", "userenv.dll", "dwmapi.dll", "uxtheme.dll",
        "propsys.dll", "powrprof.dll"
    )
    return $system -contains $lower
}

function Collect-LocalRuntimeDlls {
    param([string]$RootDll)

    $rootDir = Split-Path -Parent $RootDll
    $ordered = New-Object System.Collections.Generic.List[string]
    $seen = New-Object "System.Collections.Generic.HashSet[string]"
    $queue = New-Object System.Collections.Generic.Queue[string]
    $queue.Enqueue($RootDll)

    while ($queue.Count -gt 0) {
        $dll = $queue.Dequeue()
        $key = [System.IO.Path]::GetFileName($dll).ToLowerInvariant()
        if (-not $seen.Add($key)) { continue }
        if (-not (Test-Path $dll)) {
            throw "Missing runtime DLL: $dll"
        }
        $ordered.Add($dll)

        foreach ($import in (Get-PeImportDllNames -Path $dll)) {
            if (Test-SystemDll $import) { continue }
            $candidate = Join-Path $rootDir $import
            if (Test-Path $candidate) {
                $queue.Enqueue((Resolve-Path $candidate).Path)
                continue
            }
            $lower = Join-Path $rootDir $import.ToLowerInvariant()
            if (Test-Path $lower) {
                $queue.Enqueue((Resolve-Path $lower).Path)
            }
        }
    }

    return $ordered
}

function Copy-IfNeeded {
    param([string]$Source, [string]$Destination)

    $destDir = Split-Path -Parent $Destination
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    if (Test-Path $Destination) {
        $srcItem = Get-Item $Source
        $dstItem = Get-Item $Destination
        if ($srcItem.Length -eq $dstItem.Length) {
            return $false
        }
    }
    Copy-Item -Path $Source -Destination $Destination -Force
    return $true
}

$repoRoot = Resolve-RepoRoot
if (-not $TargetDir) {
    $TargetDir = Join-Path $repoRoot "target"
}
$profileDir = Join-Path $TargetDir $Profile
$depsDir = Join-Path $profileDir "deps"

$soxr = Find-SoxrDll -SearchDirs @($profileDir, $depsDir)
if (-not $soxr) {
    throw "Unable to locate libsoxr.dll / soxr.dll. Install MSYS2 soxr or build once so core copies it into target/$Profile."
}

$runtimeDlls = Collect-LocalRuntimeDlls -RootDll $soxr
$copied = @()
foreach ($dll in $runtimeDlls) {
    $name = Split-Path -Leaf $dll
    if (Copy-IfNeeded -Source $dll -Destination (Join-Path $profileDir $name)) {
        $copied += (Join-Path $profileDir $name)
    }
    if (Copy-IfNeeded -Source $dll -Destination (Join-Path $depsDir $name)) {
        $copied += (Join-Path $depsDir $name)
    }
}

Write-Host "soxr runtime source: $soxr" -ForegroundColor Cyan
Write-Host "staged into: $profileDir and $depsDir" -ForegroundColor Cyan
foreach ($dll in $runtimeDlls) {
    Write-Host ("  - " + (Split-Path -Leaf $dll))
}
if ($copied.Count -eq 0) {
    Write-Host "all runtime DLLs already up to date" -ForegroundColor Green
} else {
    Write-Host ("copied/updated " + $copied.Count + " file(s)") -ForegroundColor Green
}

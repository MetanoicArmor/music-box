$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ConfigPath = Join-Path $Root "config.json"
$ExamplePath = Join-Path $Root "config.example.json"
$Port = 3000
$configFile = if (Test-Path $ConfigPath) { $ConfigPath } elseif (Test-Path $ExamplePath) { $ExamplePath } else { $null }
if ($configFile) {
    try {
        $cfg = Get-Content $configFile -Raw | ConvertFrom-Json
        if ($cfg.port) { $Port = [int]$cfg.port }
    } catch {
        Write-Host "Warning: could not read config, using port $Port" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Music Box - Stop" -ForegroundColor Cyan
Write-Host "Port: $Port" -ForegroundColor Gray
Write-Host ""

function Get-ListenerPids($port) {
    $result = @()
    $lines = netstat -ano | Select-String "LISTENING" | Select-String ":$port\s"
    foreach ($line in $lines) {
        $parts = ($line -split '\s+') | Where-Object { $_ -ne "" }
        $processId = [int]$parts[-1]
        if ($processId -gt 0) { $result += $processId }
    }
    return $result | Select-Object -Unique
}

function Stop-ProcessSafe($processId, $label) {
    try {
        $proc = Get-Process -Id $processId -ErrorAction Stop
        Write-Host "Stopping $label (PID $processId, $($proc.ProcessName))..." -ForegroundColor Yellow
        Stop-Process -Id $processId -Force -ErrorAction Stop
        Write-Host "  Stopped." -ForegroundColor Green
        return $true
    } catch {
        Write-Host "  Could not stop PID $processId : $_" -ForegroundColor Red
        return $false
    }
}

$stopped = $false

# 1. Stop Node server on configured port
$listenerPids = Get-ListenerPids $Port
if ($listenerPids.Count -eq 0) {
    Write-Host "No process listening on port $Port." -ForegroundColor Gray
} else {
    foreach ($processId in $listenerPids) {
        $name = (Get-Process -Id $processId -ErrorAction SilentlyContinue).ProcessName
        if ($name -eq "node") {
            if (Stop-ProcessSafe $processId "Music Box server") { $stopped = $true }
        } else {
            Write-Host "Port $Port is used by $name (PID $processId), not node - skipped." -ForegroundColor Yellow
            Write-Host "  To force kill: taskkill /PID $processId /F" -ForegroundColor Gray
        }
    }
}

# 2. Stop mpv (local bin copy)
$binMpv = Join-Path $Root "bin\mpv.exe"
$mpvPids = @()
if (Test-Path $binMpv) {
    $mpvPids += Get-Process -Name "mpv" -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $binMpv } |
        Select-Object -ExpandProperty Id
}

# mpv started from PATH (winget install) — kill if our pipe exists or IPC name matches
$allMpv = Get-Process -Name "mpv" -ErrorAction SilentlyContinue
foreach ($p in $allMpv) {
    if ($p.Id -notin $mpvPids) {
        $mpvPids += $p.Id
    }
}

foreach ($processId in ($mpvPids | Select-Object -Unique)) {
    if (Stop-ProcessSafe $processId "mpv player") { $stopped = $true }
}

Write-Host ""
if ($stopped) {
    Write-Host "Music Box stopped." -ForegroundColor Green
} else {
    Write-Host "Nothing to stop - Music Box is not running." -ForegroundColor Gray
}

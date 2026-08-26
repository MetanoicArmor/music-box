$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BinDir = Join-Path $Root "bin"
$MpvPath = Join-Path $BinDir "mpv.exe"
$YtdlpPath = Join-Path $BinDir "yt-dlp.exe"

if (-not (Test-Path $BinDir)) {
    New-Item -ItemType Directory -Path $BinDir | Out-Null
}

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")
}

function Find-MpvExecutable {
    if (Test-Path $MpvPath) { return $MpvPath }

    Refresh-Path
    $cmd = Get-Command mpv -ErrorAction SilentlyContinue
    if ($cmd -and (Test-Path $cmd.Source)) { return $cmd.Source }

    $candidates = @(
        (Join-Path ${env:ProgramFiles} "MPV Player\mpv.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "MPV Player\mpv.exe"),
        (Join-Path ${env:ProgramFiles} "mpv\mpv.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "mpv\mpv.exe"),
        (Join-Path ${env:LOCALAPPDATA} "Programs\mpv\mpv.exe")
    )
    foreach ($path in $candidates) {
        if ($path -and (Test-Path $path)) { return $path }
    }

    $searchBases = @(
        (Join-Path ${env:ProgramFiles} "MPV Player"),
        (Join-Path ${env:ProgramFiles(x86)} "MPV Player"),
        (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages")
    )
    foreach ($base in $searchBases) {
        if (-not (Test-Path $base)) { continue }
        $found = Get-ChildItem -Path $base -Filter "mpv.exe" -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.Length -gt 1000000 } |
            Select-Object -First 1
        if ($found) { return $found.FullName }
    }

    return $null
}

function Ensure-MpvInBin {
    $found = Find-MpvExecutable
    if (-not $found) { return $false }

    if ($found -ne $MpvPath) {
        try {
            Copy-Item $found $MpvPath -Force
            Write-Host "  mpv copied to bin\mpv.exe (from $found)" -ForegroundColor Green
        } catch {
            Write-Host "  mpv found at $found but copy failed: $_" -ForegroundColor Yellow
            return $true
        }
    } else {
        Write-Host "  mpv OK (bin\mpv.exe)" -ForegroundColor Gray
    }
    return $true
}

function Test-MpvAvailable {
    return $null -ne (Find-MpvExecutable)
}

function Install-MpvViaWinget {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        Write-Host "  winget not found" -ForegroundColor Yellow
        return $false
    }

    Write-Host "Installing mpv via winget (shinchiro.mpv)..." -ForegroundColor Yellow
    $proc = Start-Process -FilePath "winget" -ArgumentList @(
        "install", "--id", "shinchiro.mpv", "-e",
        "--accept-package-agreements", "--accept-source-agreements",
        "--disable-interactivity"
    ) -Wait -PassThru -NoNewWindow

    # 0 = installed/upgraded; -1978335189 = already installed, no upgrade
    $okExitCodes = @(0, -1978335189)
    if ($proc.ExitCode -notin $okExitCodes) {
        Write-Host "  winget exit code: $($proc.ExitCode)" -ForegroundColor Yellow
    }

    Refresh-Path
    Start-Sleep -Seconds 1
    return (Ensure-MpvInBin)
}

Write-Host "Music Box - Binary Setup" -ForegroundColor Cyan
Write-Host ""

# yt-dlp
if (-not (Test-Path $YtdlpPath)) {
    Write-Host "Downloading yt-dlp..." -ForegroundColor Yellow
    try {
        $YtdlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
        Invoke-WebRequest -Uri $YtdlpUrl -OutFile $YtdlpPath -UseBasicParsing
        Write-Host "  yt-dlp.exe installed" -ForegroundColor Green
    } catch {
        Write-Host "  Failed to download yt-dlp: $_" -ForegroundColor Red
    }
} else {
    Write-Host "  yt-dlp.exe OK" -ForegroundColor Gray
}

# mpv — try find first (already installed via winget?)
if (Ensure-MpvInBin) {
    # done
} elseif (-not (Install-MpvViaWinget)) {
    Write-Host ""
    Write-Host "  Could not find or install mpv." -ForegroundColor Red
    Write-Host "  Run manually: winget install shinchiro.mpv" -ForegroundColor Yellow
    Write-Host "  Expected location: C:\Program Files\MPV Player\mpv.exe" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Setup complete!" -ForegroundColor Cyan

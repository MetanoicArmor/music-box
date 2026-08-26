$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ReleaseName = "MusicBox"
$ReleaseDir = Join-Path $Root "release\$ReleaseName"
$ZipPath = Join-Path $Root "release\$ReleaseName-win64.zip"
$NodeVersion = "22.20.0"
$CacheDir = Join-Path $Root "release\.cache"
$NodeZip = Join-Path $CacheDir "node-v$NodeVersion-win-x64.zip"

Write-Host ""
Write-Host "Music Box - Release Build" -ForegroundColor Cyan
Write-Host ""

function Ensure-NodeRuntime {
    $RuntimeDir = Join-Path $ReleaseDir "runtime"
    $NodeExe = Join-Path $RuntimeDir "node.exe"
    if (Test-Path $NodeExe) { return }

    New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null
    New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null

    if (-not (Test-Path $NodeZip)) {
        $url = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
        Write-Host "Downloading Node.js $NodeVersion..." -ForegroundColor Yellow
        Invoke-WebRequest -Uri $url -OutFile $NodeZip -UseBasicParsing
    }

    Write-Host "Extracting Node.js runtime..." -ForegroundColor Yellow
    $TempExtract = Join-Path $CacheDir "node-extract"
    if (Test-Path $TempExtract) { Remove-Item $TempExtract -Recurse -Force }
    Expand-Archive -Path $NodeZip -DestinationPath $TempExtract -Force
    $ExtractedNode = Get-ChildItem -Path $TempExtract -Filter "node.exe" -Recurse | Select-Object -First 1
    if (-not $ExtractedNode) { throw "node.exe not found in Node archive" }
    Copy-Item $ExtractedNode.FullName $NodeExe -Force
    Write-Host "  runtime\node.exe OK" -ForegroundColor Green
}

Push-Location $Root
try {
    Write-Host "Building app..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

    if (Test-Path $ReleaseDir) {
        Remove-Item $ReleaseDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null

    Write-Host "Copying files..." -ForegroundColor Yellow
    $CopyItems = @(
        "dist",
        "scripts",
        "package.json",
        "package-lock.json",
        "config.example.json",
        "start.bat",
        "stop.bat",
        "MusicBox.bat"
    )
    foreach ($item in $CopyItems) {
        $src = Join-Path $Root $item
        if (-not (Test-Path $src)) { continue }
        Copy-Item $src (Join-Path $ReleaseDir $item) -Recurse -Force
    }

    $SchemaSrc = Join-Path $Root "server\db\schema.sql"
    $SchemaDst = Join-Path $ReleaseDir "server\db\schema.sql"
    New-Item -ItemType Directory -Path (Split-Path $SchemaDst) -Force | Out-Null
    Copy-Item $SchemaSrc $SchemaDst -Force

    Copy-Item (Join-Path $Root "README.md") (Join-Path $ReleaseDir "README.txt") -Force

    New-Item -ItemType Directory -Path (Join-Path $ReleaseDir "bin") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $ReleaseDir "media") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $ReleaseDir "data") -Force | Out-Null

    if (Test-Path (Join-Path $Root "bin\mpv.exe")) {
        Copy-Item (Join-Path $Root "bin\mpv.exe") (Join-Path $ReleaseDir "bin\mpv.exe") -Force
    }
    if (Test-Path (Join-Path $Root "bin\yt-dlp.exe")) {
        Copy-Item (Join-Path $Root "bin\yt-dlp.exe") (Join-Path $ReleaseDir "bin\yt-dlp.exe") -Force
    }

    Write-Host "Installing production dependencies..." -ForegroundColor Yellow
    Push-Location $ReleaseDir
    npm ci --omit=dev
    if ($LASTEXITCODE -ne 0) { throw "npm ci --omit=dev failed" }
    Pop-Location

    Ensure-NodeRuntime

    Write-Host "Downloading yt-dlp (if missing)..." -ForegroundColor Yellow
    $Ytdlp = Join-Path $ReleaseDir "bin\yt-dlp.exe"
    if (-not (Test-Path $Ytdlp)) {
        try {
            Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile $Ytdlp -UseBasicParsing
            Write-Host "  yt-dlp.exe OK" -ForegroundColor Green
        } catch {
            Write-Host "  yt-dlp download failed (YouTube will not work offline bundle build)" -ForegroundColor Yellow
        }
    }

    $ReadmeSrc = Join-Path $Root "scripts\release-readme.txt"
    $ReadmeDst = Join-Path $ReleaseDir "START-HERE.txt"
    $readmeText = Get-Content $ReadmeSrc -Raw -Encoding UTF8
    [System.IO.File]::WriteAllText($ReadmeDst, $readmeText, (New-Object System.Text.UTF8Encoding $true))

    if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
    Write-Host "Creating ZIP archive..." -ForegroundColor Yellow
    Compress-Archive -Path $ReleaseDir -DestinationPath $ZipPath -Force

    Write-Host ""
    Write-Host "Done!" -ForegroundColor Green
    Write-Host "  Folder: $ReleaseDir"
    Write-Host "  ZIP:    $ZipPath"
    Write-Host ""
}
finally {
    Pop-Location
}

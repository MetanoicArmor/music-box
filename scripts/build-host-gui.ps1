# Build the Qt host window and deploy it into the portable folder.
# Windows: MusicBox.exe + Qt DLLs next to it.
param(
    [Parameter(Mandatory = $true)]
    [string]$Destination
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$QtVersion = "6.8.3"
$BuildDir = Join-Path $Root "host-gui\build"

function Find-QtPrefix {
    if ($env:QT_ROOT_DIR -and (Test-Path (Join-Path $env:QT_ROOT_DIR "bin\qmake.exe"))) {
        return (Resolve-Path $env:QT_ROOT_DIR).Path
    }
    foreach ($name in @("qmake", "qmake6")) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if (-not $cmd) { continue }
        $prefix = (& $cmd.Source -query QT_INSTALL_PREFIX).Trim()
        if ($prefix -and (Test-Path (Join-Path $prefix "bin\qmake.exe"))) { return $prefix }
    }
    if (Test-Path "C:\Qt") {
        $found = Get-ChildItem "C:\Qt" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            Get-ChildItem $_.FullName -Directory -Filter "msvc*_64" -ErrorAction SilentlyContinue
        } | Where-Object { Test-Path (Join-Path $_.FullName "bin\qmake.exe") } |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

function Install-QtWithAqt {
    $Cache = Join-Path $Root "release\.cache"
    $Venv = Join-Path $Cache "aqt-venv"
    $Out = Join-Path $Cache "qt"
    New-Item -ItemType Directory -Path $Cache -Force | Out-Null
    $Python = Get-Command py -ErrorAction SilentlyContinue
    if (-not $Python) { $Python = Get-Command python -ErrorAction SilentlyContinue }
    if (-not $Python) { throw "Python is required to download Qt (or install Qt 6 and set QT_ROOT_DIR)." }
    if (-not (Test-Path (Join-Path $Venv "Scripts\aqt.exe"))) {
        if ($Python.Name -eq "py.exe" -or $Python.Name -eq "py") {
            & $Python.Source -3 -m venv $Venv
        } else {
            & $Python.Source -m venv $Venv
        }
        if ($LASTEXITCODE -ne 0) { throw "python -m venv failed" }
        & (Join-Path $Venv "Scripts\python.exe") -m pip install --disable-pip-version-check "aqtinstall==3.1.19"
        if ($LASTEXITCODE -ne 0) { throw "pip install aqtinstall failed" }
    }
    Write-Host "Downloading Qt $QtVersion..." -ForegroundColor Yellow
    & (Join-Path $Venv "Scripts\aqt.exe") install-qt windows desktop $QtVersion win64_msvc2022_64 -O $Out --internal
    if ($LASTEXITCODE -ne 0) { throw "aqt install-qt failed" }
    $qmake = Get-ChildItem $Out -Recurse -Filter "qmake.exe" | Select-Object -First 1
    if (-not $qmake) { throw "qmake.exe not found after aqt install" }
    return (Split-Path (Split-Path $qmake.FullName))
}

Write-Host "Building host window..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $Destination -Force | Out-Null

$IconScript = Join-Path $Root "scripts\generate-app-icon.py"
$Python = Get-Command py -ErrorAction SilentlyContinue
if ($Python) {
    & $Python.Source -3 $IconScript (Join-Path $Root "host-gui\assets")
} else {
    $Python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $Python) { throw "Python is required to generate application icons." }
    & $Python.Source $IconScript (Join-Path $Root "host-gui\assets")
}
if ($LASTEXITCODE -ne 0) { throw "Application icon generation failed" }

$QtPrefix = Find-QtPrefix
if (-not $QtPrefix) { $QtPrefix = Install-QtWithAqt }
$WinDeploy = Join-Path $QtPrefix "bin\windeployqt.exe"
if (-not (Test-Path $WinDeploy)) { throw "windeployqt.exe not found in $QtPrefix" }

$Cmake = Get-Command cmake -ErrorAction SilentlyContinue
if (-not $Cmake) { throw "cmake is not on PATH" }

& cmake -S (Join-Path $Root "host-gui") -B $BuildDir -A x64 "-DCMAKE_PREFIX_PATH=$QtPrefix"
if ($LASTEXITCODE -ne 0) { throw "cmake configure failed" }
& cmake --build $BuildDir --config Release --parallel
if ($LASTEXITCODE -ne 0) { throw "cmake build failed" }

$Exe = Join-Path $BuildDir "Release\MusicBox.exe"
if (-not (Test-Path $Exe)) { throw "MusicBox.exe was not produced" }
Copy-Item $Exe (Join-Path $Destination "MusicBox.exe") -Force
& $WinDeploy --release --no-translations (Join-Path $Destination "MusicBox.exe")
if ($LASTEXITCODE -ne 0) { throw "windeployqt failed" }
Write-Host "  MusicBox.exe OK" -ForegroundColor Green

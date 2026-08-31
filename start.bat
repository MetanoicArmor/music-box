@echo off
title Music Box
cd /d "%~dp0"

set "NODE_CMD=node"
if exist "%~dp0runtime\node.exe" set "NODE_CMD=%~dp0runtime\node.exe"

set "BUNDLED=0"
if exist "%~dp0runtime\node.exe" if exist "%~dp0node_modules\" if exist "%~dp0dist\client\index.html" set "BUNDLED=1"

if "%BUNDLED%"=="0" (
    where node >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Node.js not found. Install from https://nodejs.org/
        echo         Or use portable release with runtime\node.exe
        pause
        exit /b 1
    )

    if not exist "node_modules\" (
        echo Installing dependencies...
        call npm install
        if %ERRORLEVEL% neq 0 (
            echo [ERROR] npm install failed
            pause
            exit /b 1
        )
    )
)

if not exist "config.json" (
    copy config.example.json config.json
    echo Created config.json - change adminPassword!
)

call :check_mpv
if %MPV_OK%==0 (
    if "%BUNDLED%"=="1" (
        echo.
        echo [WARN] mpv not found in bin\
        echo        Install: winget install shinchiro.mpv
        echo        Then copy mpv.exe to bin\ folder
        echo        Local files can still be queued; playback needs mpv.
        echo.
    ) else (
        echo.
        echo mpv not found. Installing via winget...
        powershell -ExecutionPolicy Bypass -File scripts\setup-binaries.ps1
        if %ERRORLEVEL% neq 0 (
            echo [ERROR] Failed to install mpv. Run: winget install shinchiro.mpv
            pause
            exit /b 1
        )
        call :check_mpv
        if %MPV_OK%==0 (
            echo [ERROR] mpv still not found after setup. Restart terminal and try again.
            pause
            exit /b 1
        )
    )
)

if "%BUNDLED%"=="0" (
    echo Building...
    call npm run build
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Build failed
        pause
        exit /b 1
    )
)

echo.
echo Starting Music Box...
start "" "http://localhost:3000"
"%NODE_CMD%" dist/server/index.js
pause
exit /b 0

:check_mpv
set MPV_OK=0
if exist "bin\mpv.exe" set MPV_OK=1
if %MPV_OK%==0 where mpv >nul 2>&1 && set MPV_OK=1
if %MPV_OK%==0 if exist "%ProgramFiles%\MPV Player\mpv.exe" set MPV_OK=1
exit /b 0

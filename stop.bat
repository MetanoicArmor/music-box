@echo off
title Music Box - Stop
cd /d "%~dp0"

powershell -ExecutionPolicy Bypass -File scripts\stop-server.ps1
set EXIT_CODE=%ERRORLEVEL%

echo.
pause
exit /b %EXIT_CODE%

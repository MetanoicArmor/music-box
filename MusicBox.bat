@echo off
title Music Box
cd /d "%~dp0"
if exist "%~dp0MusicBox.exe" (
  start "" "%~dp0MusicBox.exe"
  exit /b 0
)
call start.bat

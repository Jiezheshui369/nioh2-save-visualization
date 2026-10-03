@echo off
cd /d "%~dp0"
start "Nioh 2 Save Companion" powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-local.ps1"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:13252/"

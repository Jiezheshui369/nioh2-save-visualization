@echo off
setlocal
"%~dp0Nioh2Console.exe" --remote-mvp-enable
if errorlevel 1 pause

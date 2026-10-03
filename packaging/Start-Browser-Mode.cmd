@echo off
cd /d "%~dp0"
Nioh2Console.exe --browser --port 13254
if errorlevel 1 pause

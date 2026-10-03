@echo off
setlocal
cd /d "%~dp0"
set "APP_EXE="
for %%F in (*.exe) do if /I "%%~nxF"=="Nioh2Console.exe" set "APP_EXE=%%~fF"
if not defined APP_EXE (
  echo Launcher error: application executable was not found.
  pause
  exit /b 1
)
echo Starting Nioh 2 Save Companion in phone test mode.
echo Keep this window open and use only on a trusted private network.
echo.
"%APP_EXE%" --lan
if errorlevel 1 pause

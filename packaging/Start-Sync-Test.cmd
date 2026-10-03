@echo off
cd /d "%~dp0"
for %%F in (*.exe) do if /I not "%%~nxF"=="Nioh2Console.exe" (
  start "" "%%F" --port 13254
  goto done
)
echo Application executable was not found.
:done
exit /b

@echo off
setlocal
echo Save Asset: first setup for this Windows account.
echo After your own login, create system-protected device keys on this PC.
echo No deployment, Auth0 configuration or game-save upload is performed.
choice /C YN /N /M "Continue with the previously approved device setup? [Y/N] "
if errorlevel 2 exit /b 0
"%~dp0Nioh2Console.exe" --remote-mvp-enable --remote-mvp-provision-key
if errorlevel 1 pause

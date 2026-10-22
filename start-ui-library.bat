@echo off
setlocal
cd /d "%~dp0"

where pwsh.exe >nul 2>&1
if not errorlevel 1 goto use_pwsh

where powershell.exe >nul 2>&1
if not errorlevel 1 goto use_powershell_path

if exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" goto use_system_powershell

echo 未找到 PowerShell，请确认 Windows PowerShell 或 PowerShell 7 已安装。
pause
exit /b 1

:use_pwsh
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-ui-library.ps1" -KillPortOwner
exit /b %errorlevel%

:use_powershell_path
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-ui-library.ps1" -KillPortOwner
exit /b %errorlevel%

:use_system_powershell
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-ui-library.ps1" -KillPortOwner
exit /b %errorlevel%

@echo off
setlocal
cd /d C:\E\ui
echo Starting Local UI Library...
start "UI Library Server" cmd /k "cd /d C:\E\ui && npm start"
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:4318

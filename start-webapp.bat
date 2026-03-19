@echo off
setlocal

title Codex AI Browser - Web App Server
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm was not found in PATH.
  echo Install Node.js and npm, then try again.
  pause
  exit /b 1
)

echo Starting Codex AI Browser web app server...
echo Keep this window open while using http://127.0.0.1:4321/app
echo.

npm run start

echo.
echo Server process exited.
pause

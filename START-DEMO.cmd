@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS from https://nodejs.org/ and try again.
  pause
  exit /b 1
)
if not exist .env copy .env.example .env >nul
if not exist node_modules (
  call npm.cmd ci --no-fund --no-audit
  if errorlevel 1 goto failed
)
call npm.cmd run build
if errorlevel 1 goto failed
echo Use the dashboard URL printed below. An existing session can be reused.
call npm.cmd start
if errorlevel 1 goto failed
pause
exit /b 0
:failed
echo Setup or startup failed. See README.md for Windows troubleshooting.
pause
exit /b 1

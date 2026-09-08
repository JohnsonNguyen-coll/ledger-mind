@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules (
  call npm.cmd ci --no-fund --no-audit
  if errorlevel 1 goto failed
)
call npm.cmd run setup:live
if errorlevel 1 goto failed
call npm.cmd run build
if errorlevel 1 goto failed
call npm.cmd run start:live
if errorlevel 1 goto failed
pause
exit /b 0
:failed
echo Live startup failed. Check your model API key in .env.live and see backend\docs\X402.md.
pause
exit /b 1

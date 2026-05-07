@echo off
setlocal

where pwsh >nul 2>nul
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev.ps1" -Start Backend %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev.ps1" -Start Backend %*
)

exit /b %errorlevel%

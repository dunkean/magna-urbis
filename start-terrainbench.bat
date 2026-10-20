@echo off
rem Redemarre les bancs, le moteur Rust et le service neural, sans fenetres auxiliaires.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0web\scripts\benches.ps1" start %*
if errorlevel 1 (
  pause
  exit /b 1
)

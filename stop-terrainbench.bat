@echo off
rem Arrete les serveurs de ce depot et leurs processus enfants.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0web\scripts\benches.ps1" stop
if errorlevel 1 (
  pause
  exit /b 1
)

@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Test-Sols.ps1" %*
if errorlevel 1 pause

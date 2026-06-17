@echo off
title MRI QC Sphere — Launcher
echo.
echo  ============================================
echo   MRI QC Sphere / ACR Analyzer
echo   Geometria - PIU - PSG - SNR - SNRU - T2
echo  ============================================
echo.
echo  Backend: http://localhost:8182
echo  Frontend: http://localhost:8182/frontend/
echo.
echo  Premi Ctrl+C per chiudere.
echo  ============================================
echo.

cd /d "%~dp0"

start "" http://localhost:8182/frontend/

python -m uvicorn backend.api:app --host 127.0.0.1 --port 8182 --reload --app-dir "%~dp0"

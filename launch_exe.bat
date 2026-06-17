@echo off
title MRI QC Sphere — Analyzer
cd /d "%~dp0"

:: Se esiste l'exe nella stessa cartella, usa quello
if exist "MRI_QC_Sphere.exe" (
    start "" "MRI_QC_Sphere.exe"
    exit /b
)

:: Se siamo nella cartella dist
if exist "dist\MRI_QC_Sphere\MRI_QC_Sphere.exe" (
    start "" "dist\MRI_QC_Sphere\MRI_QC_Sphere.exe"
    exit /b
)

:: Fallback: usa Python diretto
echo  Avvio con Python...
::python server.py
pause

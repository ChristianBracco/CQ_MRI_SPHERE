@echo off
title Build MRI QC Sphere — EXE standalone
echo.
echo  ============================================
echo   Build EXE standalone (PyInstaller)
echo  ============================================
echo.

cd /d "%~dp0"

:: Check PyInstaller
python -m PyInstaller --version >nul 2>&1
if errorlevel 1 (
    echo  [!] PyInstaller non trovato. Installazione...
    pip install pyinstaller
)

echo.
echo  [1/2] Pulizia build precedenti...
if exist dist rmdir /s /q dist
if exist build rmdir /s /q build

echo  [2/2] Build in corso (potrebbe richiedere 1-2 minuti)...
echo.

python -m PyInstaller ^
    --name "MRI_QC_Sphere" ^
    --onedir ^
    --console ^
    --icon=NONE ^
    --add-data "frontend;frontend" ^
    --add-data "backend;backend" ^
    --hidden-import=uvicorn.logging ^
    --hidden-import=uvicorn.loops ^
    --hidden-import=uvicorn.loops.auto ^
    --hidden-import=uvicorn.protocols ^
    --hidden-import=uvicorn.protocols.http ^
    --hidden-import=uvicorn.protocols.http.auto ^
    --hidden-import=uvicorn.protocols.websockets ^
    --hidden-import=uvicorn.protocols.websockets.auto ^
    --hidden-import=uvicorn.lifespan ^
    --hidden-import=uvicorn.lifespan.on ^
    --hidden-import=uvicorn.lifespan.off ^
    --hidden-import=multipart ^
    --hidden-import=pydicom ^
    --hidden-import=PIL ^
    --hidden-import=scipy.ndimage ^
    --hidden-import=matplotlib ^
    --hidden-import=matplotlib.backends.backend_agg ^
    --collect-submodules=pydicom ^
    --collect-data=pydicom ^
    server.py

if errorlevel 1 (
    echo.
    echo  [ERRORE] Build fallita!
    pause
    exit /b 1
)

echo.
echo  ============================================
echo   Build completata!
echo.
echo   Output: dist\MRI_QC_Sphere\
echo.
echo   Per distribuire: copia la cartella
echo   dist\MRI_QC_Sphere\ sul PC target.
echo.
echo   Per lanciare: esegui
echo   dist\MRI_QC_Sphere\MRI_QC_Sphere.exe
echo  ============================================
echo.
pause

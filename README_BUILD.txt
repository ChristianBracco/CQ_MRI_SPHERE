═══════════════════════════════════════════════════════════════
  MRI QC Sphere — Come creare l'EXE standalone
═══════════════════════════════════════════════════════════════

PREREQUISITI (solo sulla macchina di BUILD, non serve sul target):
  - Python 3.10+ installato
  - pip install pyinstaller
  - pip install -r backend/requirements.txt

═══════════════════════════════════════════════════════════════
METODO 1: Build automatica (consigliato)
═══════════════════════════════════════════════════════════════

  1. Doppio click su: build_exe.bat
  2. Attendere 1-2 minuti
  3. Output in: dist\MRI_QC_Sphere\

═══════════════════════════════════════════════════════════════
METODO 2: Build manuale
═══════════════════════════════════════════════════════════════

  cd sphere_qc
  python -m PyInstaller MRI_QC_Sphere.spec

═══════════════════════════════════════════════════════════════
DISTRIBUZIONE
═══════════════════════════════════════════════════════════════

  Copia l'INTERA cartella:  dist\MRI_QC_Sphere\
  sul PC target (USB, rete, etc.)

  Dimensione stimata: ~150-200 MB (include Python + numpy + scipy + matplotlib)

═══════════════════════════════════════════════════════════════
USO SUL PC TARGET (senza Python, senza internet)
═══════════════════════════════════════════════════════════════

  1. Doppio click su: MRI_QC_Sphere.exe
  2. Si apre una finestra console (server) + il browser automaticamente
  3. Se il browser non si apre: vai a http://localhost:8182/frontend/
  4. Per chiudere: chiudi la finestra console (o Ctrl+C)

═══════════════════════════════════════════════════════════════
NOTE
═══════════════════════════════════════════════════════════════

  - NON serve Python sul PC target
  - NON serve internet
  - Windows 10/11 x64 richiesto
  - La porta 8182 deve essere libera
  - Il file qc_history.json viene salvato nella cartella DICOM
    selezionata (per mantenere lo storico misure)
  - Se Windows Defender blocca l'exe al primo avvio:
    click "Ulteriori informazioni" → "Esegui comunque"

═══════════════════════════════════════════════════════════════

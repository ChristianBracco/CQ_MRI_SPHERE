"""
server.py — Entry point standalone per MRI QC Sphere Analyzer.
Compatibile con PyInstaller (onedir mode).
Apre automaticamente il browser.
"""
import os
import sys
import webbrowser
import threading

# Fix paths for PyInstaller frozen exe
if getattr(sys, 'frozen', False):
    # Running as compiled exe — data is in _MEIPASS or _internal
    if hasattr(sys, '_MEIPASS'):
        BASE_DIR = sys._MEIPASS
    else:
        # PyInstaller 6+: data in _internal/ next to exe
        exe_dir = os.path.dirname(sys.executable)
        internal = os.path.join(exe_dir, "_internal")
        BASE_DIR = internal if os.path.isdir(internal) else exe_dir
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Add paths so imports work
sys.path.insert(0, BASE_DIR)
sys.path.insert(0, os.path.join(BASE_DIR, "backend"))

# Set working directory to where the exe is (for qc_history.json etc.)
if getattr(sys, 'frozen', False):
    os.chdir(os.path.dirname(sys.executable))
else:
    os.chdir(BASE_DIR)

HOST = "127.0.0.1"
PORT = 8182
URL = f"http://{HOST}:{PORT}/frontend/"


def open_browser():
    """Open browser after a short delay to let server start."""
    import time
    time.sleep(2.0)
    webbrowser.open(URL)


def main():
    print()
    print("=" * 50)
    print("  MRI QC Sphere / ACR Analyzer")
    print("  Geometria - PIU - PSG - SNR - SNRU - T2")
    print("=" * 50)
    print()
    print(f"  Server: http://{HOST}:{PORT}")
    print(f"  Frontend: {URL}")
    print(f"  Base dir: {BASE_DIR}")
    print()
    print("  Premi Ctrl+C per chiudere.")
    print("=" * 50)
    print()

    # Verify frontend exists
    frontend_path = os.path.join(BASE_DIR, "frontend")
    if not os.path.isdir(frontend_path):
        print(f"  [ERRORE] Frontend non trovato in: {frontend_path}")
        print(f"  Contenuto BASE_DIR: {os.listdir(BASE_DIR)[:20]}")
        input("  Premi INVIO per uscire...")
        sys.exit(1)

    # Override FRONTEND_DIR in api module before import
    os.environ["SPHERE_QC_FRONTEND_DIR"] = frontend_path

    # Open browser in background thread
    threading.Thread(target=open_browser, daemon=True).start()

    # Import and run
    import uvicorn
    from backend.api import app

    # Re-mount frontend with correct path (in case the module-level mount used wrong path)
    from fastapi.staticfiles import StaticFiles
    # Remove existing frontend mount if any
    app.routes[:] = [r for r in app.routes if not (hasattr(r, 'path') and r.path == '/frontend')]
    app.mount("/frontend", StaticFiles(directory=frontend_path, html=True), name="frontend")

    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    main()

"""
backend/api.py — FastAPI REST backend per MRI QC Sphere/ACR Analyzer.

Avvio:
    uvicorn backend.api:app --host 127.0.0.1 --port 8182 --reload
"""
from __future__ import annotations

import io, os, sys, base64, traceback, datetime, math
from pathlib import Path
from typing import Dict, List, Optional
import json as _json
import numpy as np
import logging

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response as _StarletteResponse

# --- Numpy JSON encoder ---
class _NumpyEncoder(_json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.bool_): return bool(obj)
        if isinstance(obj, np.integer): return int(obj)
        if isinstance(obj, np.floating): return float(obj)
        if isinstance(obj, np.ndarray): return obj.tolist()
        return super().default(obj)

class NumpyJSONResponse(_StarletteResponse):
    media_type = "application/json"
    def __init__(self, content: dict, status_code: int = 200, **kwargs):
        body = _json.dumps(content, cls=_NumpyEncoder, ensure_ascii=False)
        super().__init__(content=body, status_code=status_code, **kwargs)

logger = logging.getLogger("sphere_qc_api")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

PROJECT_ROOT = str(Path(__file__).parent.parent)
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)
# Add backend to path
BACKEND_DIR = str(Path(__file__).parent)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

SERVER_DATA_DIR = Path(os.environ.get("SPHERE_QC_DATA_DIR") or PROJECT_ROOT).resolve()
HISTORY_FILE = SERVER_DATA_DIR / "qc_history.json"

from dicom_loader import DicomSlice, load_dicom_series, get_series_stats
from sphere_analysis import (
    find_phantom_circle, calculate_geometric_accuracy,
    calculate_piu, calculate_psg, calculate_snr, calculate_snru, calculate_t2,
)

# ==============================================================================
# APP
# ==============================================================================
app = FastAPI(title="MRI QC Sphere Analyzer", version="1.0.0")

class ForceCORSMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            response = _StarletteResponse(status_code=200)
        else:
            try:
                response = await call_next(request)
            except Exception:
                response = _StarletteResponse(status_code=500)
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "*"
        return response

app.add_middleware(ForceCORSMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False,
                   allow_methods=["*"], allow_headers=["*"])

FRONTEND_DIR = str(Path(__file__).parent.parent / "frontend")

# ==============================================================================
# STATE
# ==============================================================================
class AppState:
    def __init__(self):
        self.reset()
    def reset(self):
        self.all_slices: List[DicomSlice] = []
        self.slices: List[DicomSlice] = []
        self.active_sequence_uid: str = ""
        self.input_dir: str = ""
        self.selected_slice_idx: int = 0
        self.results: Dict[str, dict] = {}
        self.meta_info: dict = {}
        self.history: List[dict] = []  # trend data

state = AppState()

def _history_read_files() -> List[Path]:
    files = [HISTORY_FILE]
    legacy_project_file = Path(PROJECT_ROOT) / "qc_history.json"
    if legacy_project_file != HISTORY_FILE:
        files.append(legacy_project_file)
    return files

def _load_history_entries() -> List[dict]:
    entries: List[dict] = []
    seen = set()
    for history_file in _history_read_files():
        if not history_file.exists():
            continue
        try:
            data = _json.loads(history_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        for item in data:
            key = _history_identity(item)
            if key in seen:
                continue
            seen.add(key)
            entries.append(item)
    return entries

def _entry_date(entry: dict) -> str:
    return entry.get("analysis_date") or entry.get("date") or entry.get("study_date") or ""

def _sequence_key(entry: dict) -> str:
    meta = entry.get("meta") or {}
    return entry.get("active_sequence_uid") or "|".join([
        str(meta.get("series_instance_uid") or ""),
        str(meta.get("series_description") or meta.get("protocol") or ""),
        str(meta.get("tr_ms") or ""),
        str(meta.get("te_ms") or ""),
    ])

def _scanner_key(entry: dict) -> str:
    meta = entry.get("meta") or {}
    control = entry.get("control_info") or {}
    return "|".join([
        str(meta.get("institution") or control.get("presidio") or ""),
        str(meta.get("manufacturer") or ""),
        str(meta.get("model") or meta.get("model_name") or ""),
        str(meta.get("station") or meta.get("station_name") or ""),
        str(meta.get("magnetic_field_T") or ""),
    ])

def _history_identity(entry: dict) -> str:
    date = _entry_date(entry)
    seq = _sequence_key(entry)
    scanner = _scanner_key(entry)
    if date and seq:
        return f"{date}|{scanner}|{seq}"
    return entry.get("acquisition_id") or _json.dumps(entry, sort_keys=True, cls=_NumpyEncoder)

def _session_summary(entries: List[dict]) -> List[dict]:
    sessions: Dict[str, dict] = {}
    for entry in entries:
        date = _entry_date(entry)
        if not date:
            continue
        session = sessions.setdefault(date, {
            "date": date,
            "entries": 0,
            "sequence_count": 0,
            "complete": False,
            "sequences": {},
        })
        session["entries"] += 1
        key = _sequence_key(entry)
        if key:
            meta = entry.get("meta") or {}
            session["sequences"][key] = {
                "uid": entry.get("active_sequence_uid") or meta.get("series_instance_uid") or "",
                "description": meta.get("series_description") or meta.get("protocol") or "",
                "tr_ms": meta.get("tr_ms"),
                "te_ms": meta.get("te_ms"),
            }
    output = []
    for session in sessions.values():
        sequences = list(session["sequences"].values())
        output.append({
            "date": session["date"],
            "entries": session["entries"],
            "sequence_count": len(sequences),
            "complete": len(sequences) >= 3,
            "sequences": sequences,
        })
    return sorted(output, key=lambda item: item["date"])

def _upsert_history_entry(entries: List[dict], entry_data: dict) -> List[dict]:
    entry_key = _history_identity(entry_data)
    for idx, item in enumerate(entries):
        if _history_identity(item) == entry_key:
            entries[idx] = entry_data
            return entries
    entries.append(entry_data)
    return entries

def _dedupe_history_entries(entries: List[dict]) -> List[dict]:
    deduped: List[dict] = []
    for item in entries:
        deduped = _upsert_history_entry(deduped, item)
    return deduped

def _persist_history_entries(entries: List[dict]) -> None:
    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_FILE.write_text(_json.dumps(entries, indent=2, cls=_NumpyEncoder), encoding="utf-8")

# ==============================================================================
# PYDANTIC MODELS
# ==============================================================================
class LoadRequest(BaseModel):
    input_dir: str
    recursive: bool = True

class AnalyzeRequest(BaseModel):
    module: str
    slice_idx: int = 0
    kwargs: Optional[dict] = None

class T2Request(BaseModel):
    slice_idx_te1: int
    slice_idx_te2: int

class SequenceAnalyzeRequest(BaseModel):
    uid: str
    module: str
    slice_idx: int = 0
    kwargs: Optional[dict] = None

class MultiSequenceAnalyzeRequest(BaseModel):
    selections: Dict[str, int] = Field(default_factory=dict)
    snr_method: str = "single_lr"

class MetaInfoRequest(BaseModel):
    data_controllo: str = ""
    tipo_controllo: str = "Costanza"
    presidio: str = ""
    sala: str = ""
    operatori: str = ""
    note: str = ""

class HistoryEntry(BaseModel):
    date: str
    results: dict
    raw_metrics: dict = Field(default_factory=dict)
    acquisition_id: str = ""
    saved_at: str = ""
    analysis_date: str = ""
    study_date: str = ""
    meta: dict = Field(default_factory=dict)
    control_info: dict = Field(default_factory=dict)
    overwrite: bool = False

    model_config = {"extra": "allow"}

# ==============================================================================
# UTILITY
# ==============================================================================
def _slice_to_base64(arr: np.ndarray, wl=None, ww=None, size: int = 0) -> str:
    from PIL import Image
    arr = arr.astype(np.float32)
    if wl is None or ww is None or ww <= 1:
        finite = arr[np.isfinite(arr)]
        if finite.size == 0: finite = arr.flatten()
        p2, p98 = np.percentile(finite, 2), np.percentile(finite, 98)
        if abs(p98 - p2) < 1: p2, p98 = float(np.min(finite)), float(np.max(finite))
        wl = (p98 + p2) / 2.0
        ww = (p98 - p2)
    lo = wl - ww / 2.0
    hi = wl + ww / 2.0
    img = np.clip((arr - lo) / max(hi - lo, 1e-6) * 255.0, 0, 255).astype(np.uint8)
    pil_img = Image.fromarray(img, mode="L")
    if size > 0 and size != img.shape[0]:
        pil_img = pil_img.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    pil_img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")

def _slice_summary(sl: DicomSlice, idx: int) -> dict:
    return {
        "idx": idx, "filename": sl.filename,
        "z": round(sl.slice_location, 2),
        "thickness": round(sl.slice_thickness_mm, 2),
        "instance": sl.instance_number,
        "te_ms": sl.te_ms, "tr_ms": sl.tr_ms,
    }

def _series_groups() -> Dict[str, List[DicomSlice]]:
    groups: Dict[str, List[DicomSlice]] = {}
    for sl in state.all_slices:
        groups.setdefault(sl.series_instance_uid or "unknown", []).append(sl)
    return groups

def _series_meta(uid: str, slices: List[DicomSlice]) -> dict:
    rep = slices[0]
    return {
        "uid": uid, "description": rep.series_description,
        "tr_ms": rep.tr_ms, "te_ms": rep.te_ms,
        "n_slices": len(slices), "is_active": uid == state.active_sequence_uid,
    }

def _sequence_text(sl: DicomSlice) -> str:
    return f"{sl.series_description or ''} {sl.protocol_name or ''}".upper()

def _token_text(text: str) -> str:
    return " " + "".join(ch if ch.isalnum() else " " for ch in text.upper()) + " "

def _is_spin_echo_text(text: str) -> bool:
    text = text.upper()
    tokens = _token_text(text)
    gradient_echo_markers = [
        " GRE ", " GR ", " SPGR ", " FFE ", " TFE ", " FLASH ", " FISP ",
        " SSFP ", " DESS ", " EPI ", " T2STAR ", " T2 STAR ",
    ]
    if "T2*" in text or any(marker in tokens for marker in gradient_echo_markers):
        return False
    spin_echo_markers = [" SE ", " FSE ", " TSE ", " CSE ", " SPIN ECHO "]
    return any(marker in tokens for marker in spin_echo_markers) or "SPIN ECHO" in text

def _is_spin_echo_sequence(sl: DicomSlice) -> bool:
    return _is_spin_echo_text(_sequence_text(sl))

def _invalidate_non_spin_echo_t2(entry: dict) -> dict:
    results = entry.get("results") if isinstance(entry, dict) else None
    t2 = results.get("t2") if isinstance(results, dict) else None
    if not isinstance(t2, dict) or t2.get("error"):
        return entry

    desc1 = str(t2.get("series1_description") or "")
    desc2 = str(t2.get("series2_description") or "")
    if not desc1 or not desc2 or (_is_spin_echo_text(desc1) and _is_spin_echo_text(desc2)):
        return entry

    updated = dict(entry)
    updated_results = dict(results)
    invalid_t2 = dict(t2)
    invalid_t2["invalidated_t2_ms"] = invalid_t2.pop("t2_ms", None)
    invalid_t2["error"] = "T2 invalidato: il calcolo richiede due sequenze Spin Echo con TE diversi"
    updated_results["t2"] = invalid_t2
    updated["results"] = updated_results
    raw = dict(updated.get("raw_metrics") or {})
    raw.pop("t2", None)
    updated["raw_metrics"] = raw
    return updated

def _t2_spin_echo_series(groups: Dict[str, List[DicomSlice]]) -> List[tuple]:
    series_te = []
    for uid, slices in groups.items():
        if not slices:
            continue
        rep = slices[0]
        if rep.te_ms > 0 and _is_spin_echo_sequence(rep):
            series_te.append((uid, rep.te_ms, slices))
    return sorted(series_te, key=lambda item: item[1])

def _copy_keys(src: dict, keys: List[str]) -> dict:
    return {key: src[key] for key in keys if key in src}

def _module_raw_metrics(module: str, result: dict) -> dict:
    if not isinstance(result, dict) or result.get("error"):
        return {}

    common = _copy_keys(result, [
        "center_rc", "radius_px", "ufov_radius_px", "roi_radius_px", "mask_radius_px",
    ])

    if module == "geometric":
        return {
            **common,
            "diameters_mm": {
                "horizontal": result.get("diameter_horizontal_mm"),
                "vertical": result.get("diameter_vertical_mm"),
                "oblique_45": result.get("diameter_45_mm"),
                "oblique_135": result.get("diameter_135_mm"),
            },
            **_copy_keys(result, [
                "diameter_mean_mm", "diameter_max_mm", "diameter_min_mm",
                "nominal_diameter_mm", "max_error_mm", "line_coords",
            ]),
        }

    if module == "piu":
        return {
            **common,
            **_copy_keys(result, [
                "s_max", "s_min", "max_position_rc", "min_position_rc", "field_T",
            ]),
        }

    if module == "psg":
        return {
            **common,
            "background_means": {
                "up": result.get("s_up"),
                "down": result.get("s_down"),
                "left": result.get("s_left"),
                "right": result.get("s_right"),
            },
            **_copy_keys(result, ["signal_mean", "rois"]),
        }

    if module == "snr":
        return {
            **common,
            **_copy_keys(result, [
                "signal_mean", "noise_std_left", "noise_std_right",
                "noise_std_mean", "method", "bg_rois",
            ]),
        }

    if module == "snru":
        return {
            **common,
            **_copy_keys(result, [
                "noise_std", "snr_max", "snr_min", "rois",
            ]),
        }

    if module == "t2":
        return {
            **common,
            **_copy_keys(result, [
                "s1_mean", "s2_mean", "te1_ms", "te2_ms",
                "ratio_s1_s2", "series1_description", "series2_description",
            ]),
        }

    return {}

def _extract_raw_metrics(results: dict) -> dict:
    if not isinstance(results, dict):
        return {}

    raw = {}
    for module, result in results.items():
        module_raw = _module_raw_metrics(module, result)
        if module_raw:
            raw[module] = module_raw
    return raw

def _with_raw_metrics(entry: dict) -> dict:
    if not isinstance(entry, dict):
        return entry
    entry = _invalidate_non_spin_echo_t2(entry)

    computed = _extract_raw_metrics(entry.get("results") or {})
    if not computed:
        return entry

    existing = entry.get("raw_metrics") if isinstance(entry.get("raw_metrics"), dict) else {}
    merged = {**existing, **computed}
    if merged == existing:
        return entry

    updated = dict(entry)
    updated["raw_metrics"] = merged
    return updated

@app.on_event("startup")
async def migrate_history_raw_metrics():
    try:
        entries = _load_history_entries()
        if not entries:
            return
        hydrated = [_with_raw_metrics(item) for item in entries]
        if hydrated != entries:
            _persist_history_entries(_dedupe_history_entries(hydrated))
            logger.info("History raw_metrics migration completed for %d entries", len(hydrated))
    except Exception as e:
        logger.warning("Could not migrate history raw_metrics: %s", e)

def _analyze_slice_modules(sl: DicomSlice, snr_method: str = "single_lr") -> dict:
    arr = sl.pixel_array
    ps = sl.pixel_spacing_mm
    results = {}
    for module in ["geometric", "piu", "psg", "snr", "snru"]:
        try:
            if module == "geometric":
                results[module] = calculate_geometric_accuracy(arr, ps)
            elif module == "piu":
                r = calculate_piu(arr, ps)
                field_T = sl.magnetic_field_T or 1.5
                r["limit"] = 87.5 if field_T < 3.0 else 82.0
                r["passed"] = r["piu_percent"] >= r["limit"]
                r["field_T"] = field_T
                results[module] = r
            elif module == "psg":
                results[module] = calculate_psg(arr, ps)
            elif module == "snr":
                results[module] = calculate_snr(arr, ps, snr_method=snr_method)
            elif module == "snru":
                results[module] = calculate_snru(arr, ps)
        except Exception as e:
            results[module] = {"error": str(e)}
    return results

# ==============================================================================
# ENDPOINTS
# ==============================================================================
@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}

@app.get("/browse-fs")
async def browse_filesystem(path: str = Query("")):
    import string
    if not path:
        if sys.platform == "win32":
            drives = []
            for letter in string.ascii_uppercase:
                drive = f"{letter}:\\"
                if os.path.isdir(drive):
                    drives.append({"name": f"{letter}:", "path": drive, "is_dir": True})
            return {"current": "", "parent": "", "entries": drives}
        else:
            path = "/"
    path = os.path.abspath(path)
    if not os.path.isdir(path):
        raise HTTPException(400, f"Non è una directory: {path}")
    parent = os.path.dirname(path)
    if parent == path: parent = ""
    entries = []
    try:
        for name in sorted(os.listdir(path)):
            full = os.path.join(path, name)
            if name.startswith("."): continue
            is_dir = os.path.isdir(full)
            entries.append({"name": name, "path": full, "is_dir": is_dir})
    except PermissionError:
        pass
    dicom_count = sum(1 for e in entries if not e["is_dir"] and
                      (not "." in e["name"] or e["name"].lower().endswith((".dcm", ".ima"))))
    return {"current": path, "parent": parent, "entries": entries[:500], "dicom_file_count": dicom_count}

@app.post("/load-dicom")
async def load_dicom(req: LoadRequest):
    if not os.path.isdir(req.input_dir):
        raise HTTPException(400, f"Directory non valida: {req.input_dir}")
    try:
        state.reset()
        state.input_dir = req.input_dir
        all_loaded = load_dicom_series(req.input_dir, recursive=req.recursive)
        state.all_slices = all_loaded

        # Group by series UID
        groups = _series_groups()

        # Select first sequence
        selected_uid = max(groups.keys(), key=lambda u: len(groups[u]))
        state.active_sequence_uid = selected_uid
        state.slices = groups.get(selected_uid, all_loaded)

        sequences_info = [_series_meta(uid, grp) for uid, grp in groups.items()]

        return NumpyJSONResponse({
            "success": True, "n_slices": len(state.slices),
            "n_total_slices": len(all_loaded),
            "active_sequence_uid": selected_uid,
            "sequences": sequences_info,
            "slices": [_slice_summary(sl, i) for i, sl in enumerate(state.slices)],
        })
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, str(e))

class SetActiveSequenceRequest(BaseModel):
    uid: str

@app.post("/set-active-sequence")
async def set_active_sequence(req: SetActiveSequenceRequest):
    groups = _series_groups()
    if req.uid not in groups:
        raise HTTPException(400, f"Sequenza '{req.uid}' non trovata")
    state.active_sequence_uid = req.uid
    state.slices = groups[req.uid]
    return NumpyJSONResponse({
        "success": True, "n_slices": len(state.slices),
        "slices": [_slice_summary(sl, i) for i, sl in enumerate(state.slices)],
    })

@app.get("/slices")
async def get_slices():
    if not state.slices:
        raise HTTPException(400, "Nessuna serie caricata")
    return {"n_slices": len(state.slices),
            "slices": [_slice_summary(sl, i) for i, sl in enumerate(state.slices)]}

@app.get("/slice-image/{idx}")
async def get_slice_image(idx: int, wl: float = Query(None), ww: float = Query(None), size: int = Query(0), uid: str = Query("")):
    slices = state.slices
    if uid:
        slices = _series_groups().get(uid, [])
    if not slices or idx < 0 or idx >= len(slices):
        raise HTTPException(400, f"Indice slice non valido: {idx}")
    sl = slices[idx]
    b64 = _slice_to_base64(sl.pixel_array, wl, ww, size)
    return {"idx": idx, "image": b64}

@app.get("/slice-thumbnails")
async def get_thumbnails(wl: float = Query(None), ww: float = Query(None), size: int = Query(128)):
    if not state.slices:
        raise HTTPException(400, "Nessuna serie caricata")
    thumbs = []
    for i, sl in enumerate(state.slices):
        b64 = _slice_to_base64(sl.pixel_array, wl, ww, size)
        thumbs.append({"idx": i, "image": b64, "z": round(sl.slice_location, 2),
                       "te_ms": sl.te_ms, "tr_ms": sl.tr_ms})
    return {"thumbnails": thumbs}

@app.get("/multi-slice-thumbnails")
async def get_multi_thumbnails(wl: float = Query(None), ww: float = Query(None), size: int = Query(128)):
    if not state.all_slices:
        raise HTTPException(400, "Nessuna serie caricata")
    groups = _series_groups()
    thumbs = []
    for uid, slices in groups.items():
        for i, sl in enumerate(slices):
            b64 = _slice_to_base64(sl.pixel_array, wl, ww, size)
            thumbs.append({
                "uid": uid, "idx": i, "image": b64,
                "z": round(sl.slice_location, 2),
                "te_ms": sl.te_ms, "tr_ms": sl.tr_ms,
                "description": sl.series_description,
            })
    return {"sequences": [_series_meta(uid, grp) for uid, grp in groups.items()], "thumbnails": thumbs}

@app.get("/dicom-meta")
async def get_dicom_meta():
    if not state.slices:
        raise HTTPException(400, "Nessuna serie caricata")
    sl = state.slices[0]
    return {
        "manufacturer": sl.manufacturer, "model": sl.model_name,
        "institution": sl.institution_name, "station": sl.station_name,
        "protocol": sl.protocol_name, "tr_ms": sl.tr_ms, "te_ms": sl.te_ms,
        "magnetic_field_T": sl.magnetic_field_T,
        "pixel_spacing_mm": sl.pixel_spacing_mm,
        "slice_thickness_mm": sl.slice_thickness_mm,
        "fov_mm": sl.fov_mm, "matrix_size": sl.matrix_size,
        "study_date": sl.study_date, "series_description": sl.series_description,
        "n_slices": len(state.slices), "n_averages": sl.n_averages,
    }

@app.post("/analyze")
async def analyze_module(req: AnalyzeRequest):
    if not state.slices:
        raise HTTPException(400, "Nessuna serie caricata")
    module = req.module.lower()
    idx = req.slice_idx
    if idx < 0 or idx >= len(state.slices):
        raise HTTPException(400, f"Slice index {idx} non valido")
    sl = state.slices[idx]
    arr = sl.pixel_array
    ps = sl.pixel_spacing_mm
    kwargs = req.kwargs or {}
    try:
        if module == "geometric":
            result = calculate_geometric_accuracy(arr, ps, **kwargs)
        elif module == "piu":
            result = calculate_piu(arr, ps, **kwargs)
            field_T = sl.magnetic_field_T or 1.5
            result["limit"] = 87.5 if field_T < 3.0 else 82.0
            result["passed"] = result["piu_percent"] >= result["limit"]
            result["field_T"] = field_T
        elif module == "psg":
            result = calculate_psg(arr, ps, **kwargs)
        elif module == "snr":
            snr_method = kwargs.pop("snr_method", "single_lr")
            result = calculate_snr(arr, ps, snr_method=snr_method, **kwargs)
        elif module == "snru":
            result = calculate_snru(arr, ps, **kwargs)
        else:
            raise HTTPException(400, f"Modulo '{module}' non valido")

        overlay_b64 = _generate_overlay(module, sl, result)
        state.results[module] = result
        return NumpyJSONResponse({
            "success": True, "module": module, "results": result,
            "overlay_image": overlay_b64,
            "slice_info": {"filename": sl.filename, "z": sl.slice_location, "idx": idx},
        })
    except HTTPException: raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"Errore analisi {module}: {e}")

@app.post("/analyze-sequence")
async def analyze_sequence_module(req: SequenceAnalyzeRequest):
    groups = _series_groups()
    if req.uid not in groups:
        raise HTTPException(400, f"Sequenza '{req.uid}' non trovata")
    slices = groups[req.uid]
    if req.slice_idx < 0 or req.slice_idx >= len(slices):
        raise HTTPException(400, f"Slice index {req.slice_idx} non valido")
    previous_slices = state.slices
    previous_uid = state.active_sequence_uid
    state.slices = slices
    state.active_sequence_uid = req.uid
    try:
        return await analyze_module(AnalyzeRequest(module=req.module, slice_idx=req.slice_idx, kwargs=req.kwargs))
    finally:
        state.slices = previous_slices
        state.active_sequence_uid = previous_uid

@app.post("/analyze-t2")
async def analyze_t2(req: T2Request):
    if not state.slices:
        raise HTTPException(400, "Nessuna serie caricata")
    if req.slice_idx_te1 < 0 or req.slice_idx_te1 >= len(state.all_slices):
        raise HTTPException(400, "Slice TE1 non valida")
    if req.slice_idx_te2 < 0 or req.slice_idx_te2 >= len(state.all_slices):
        raise HTTPException(400, "Slice TE2 non valida")

    sl1 = state.all_slices[req.slice_idx_te1]
    sl2 = state.all_slices[req.slice_idx_te2]

    if not (_is_spin_echo_sequence(sl1) and _is_spin_echo_sequence(sl2)):
        raise HTTPException(400, "Il T2 va calcolato solo da due sequenze Spin Echo con TE diversi")

    if sl1.te_ms == sl2.te_ms:
        raise HTTPException(400, "Le due slice devono avere TE diversi")

    # Verifica TR compatibili (tolleranza 10%)
    if sl1.tr_ms > 0 and sl2.tr_ms > 0:
        tr_diff = abs(sl1.tr_ms - sl2.tr_ms)
        tr_mean = (sl1.tr_ms + sl2.tr_ms) / 2.0
        if tr_diff / tr_mean > 0.10:
            result = {
                "t2_ms": None,
                "error": (
                    f"TR incompatibili: serie 1 TR={sl1.tr_ms:.0f} ms (TE={sl1.te_ms:.0f} ms), "
                    f"serie 2 TR={sl2.tr_ms:.0f} ms (TE={sl2.te_ms:.0f} ms). "
                    f"Il calcolo T2 richiede due serie Spin Echo con lo stesso TR e TE diversi."
                ),
                "te1_ms": sl1.te_ms,
                "te2_ms": sl2.te_ms,
                "s1_mean": None,
                "s2_mean": None,
                "ratio_s1_s2": None,
            }
            state.results["t2"] = result
            return NumpyJSONResponse({"success": True, "module": "t2", "results": result})

    # Ensure te1 < te2
    if sl1.te_ms > sl2.te_ms:
        sl1, sl2 = sl2, sl1

    result = calculate_t2(sl1.pixel_array, sl2.pixel_array,
                          sl1.te_ms, sl2.te_ms, sl1.pixel_spacing_mm)
    state.results["t2"] = result
    return NumpyJSONResponse({"success": True, "module": "t2", "results": result})


class T2AutoRequest(BaseModel):
    slice_idx: int = 0  # slice index within active sequence


@app.post("/analyze-t2-auto")
async def analyze_t2_auto(req: T2AutoRequest):
    """Auto-detect T2 from two series with different TE at the same slice position."""
    if not state.all_slices:
        raise HTTPException(400, "Nessuna serie caricata")

    # Group all_slices by series UID
    groups: Dict[str, List[DicomSlice]] = {}
    for sl in state.all_slices:
        uid = sl.series_instance_uid or "unknown"
        groups.setdefault(uid, []).append(sl)

    # Find at least 2 Spin Echo series with different TE
    series_te = _t2_spin_echo_series(groups)

    if len(series_te) < 2:
        raise HTTPException(400, "Servono almeno 2 serie Spin Echo con TE diversi per il calcolo T2")

    # Sort by TE
    series_te.sort(key=lambda x: x[1])

    # Check we actually have different TE values
    te_values = [x[1] for x in series_te]
    unique_te = list(set(te_values))
    if len(unique_te) < 2:
        raise HTTPException(400, f"Le serie Spin Echo hanno tutte lo stesso TE ({unique_te[0]} ms)")

    # Pick the two with smallest and largest TE
    s1_uid, te1, slices1 = series_te[0]
    s2_uid, te2, slices2 = series_te[-1]

    # Verifica TR compatibili (tolleranza 10%)
    tr1 = slices1[0].tr_ms if slices1 else 0
    tr2 = slices2[0].tr_ms if slices2 else 0
    if tr1 > 0 and tr2 > 0:
        tr_diff = abs(tr1 - tr2)
        tr_mean = (tr1 + tr2) / 2.0
        if tr_diff / tr_mean > 0.10:
            result = {
                "t2_ms": None,
                "error": (
                    f"TR incompatibili: la serie con TE={te1:.0f} ms ha TR={tr1:.0f} ms, "
                    f"quella con TE={te2:.0f} ms ha TR={tr2:.0f} ms. "
                    f"Il calcolo T2 richiede due serie Spin Echo con lo stesso TR e TE diversi."
                ),
                "te1_ms": te1,
                "te2_ms": te2,
                "s1_mean": None,
                "s2_mean": None,
                "ratio_s1_s2": None,
                "series1_description": slices1[0].series_description if slices1 else "",
                "series2_description": slices2[0].series_description if slices2 else "",
            }
            state.results["t2"] = result
            return NumpyJSONResponse({"success": True, "module": "t2", "results": result})

    # Get the slice at the requested index (clamped)
    idx1 = min(req.slice_idx, len(slices1) - 1)
    idx2 = min(req.slice_idx, len(slices2) - 1)

    sl1 = slices1[idx1]
    sl2 = slices2[idx2]

    result = calculate_t2(sl1.pixel_array, sl2.pixel_array,
                          sl1.te_ms, sl2.te_ms, sl1.pixel_spacing_mm)
    result["series1_description"] = sl1.series_description
    result["series2_description"] = sl2.series_description
    state.results["t2"] = result
    return NumpyJSONResponse({"success": True, "module": "t2", "results": result})

@app.post("/analyze-all")
async def analyze_all(slice_idx: int = Query(0)):
    if not state.slices:
        raise HTTPException(400, "Nessuna serie caricata")
    if slice_idx < 0 or slice_idx >= len(state.slices):
        slice_idx = len(state.slices) // 2
    sl = state.slices[slice_idx]
    arr = sl.pixel_array
    ps = sl.pixel_spacing_mm
    results = {}
    for module in ["geometric", "piu", "psg", "snr", "snru"]:
        try:
            if module == "geometric":
                results[module] = calculate_geometric_accuracy(arr, ps)
            elif module == "piu":
                r = calculate_piu(arr, ps)
                field_T = sl.magnetic_field_T or 1.5
                r["limit"] = 87.5 if field_T < 3.0 else 82.0
                r["passed"] = r["piu_percent"] >= r["limit"]
                results[module] = r
            elif module == "psg":
                results[module] = calculate_psg(arr, ps)
            elif module == "snr":
                results[module] = calculate_snr(arr, ps)
            elif module == "snru":
                results[module] = calculate_snru(arr, ps)
        except Exception as e:
            results[module] = {"error": str(e)}
    state.results = results
    return NumpyJSONResponse({"success": True, "results": results})

@app.post("/analyze-all-sequences")
async def analyze_all_sequences(req: MultiSequenceAnalyzeRequest):
    if not state.all_slices:
        raise HTTPException(400, "Nessuna serie caricata")
    groups = _series_groups()
    results_by_sequence = {}
    for uid, slices in groups.items():
        idx = req.selections.get(uid, len(slices) // 2)
        if idx < 0 or idx >= len(slices):
            idx = len(slices) // 2
        sl = slices[idx]
        results_by_sequence[uid] = {
            "uid": uid,
            "slice_idx": idx,
            "meta": _series_meta(uid, slices),
            "results": _analyze_slice_modules(sl, req.snr_method),
        }

    t2_result = None
    try:
        series_te = _t2_spin_echo_series(groups)
        if len({x[1] for x in series_te}) >= 2:
            uid1, _te1, slices1 = series_te[0]
            uid2, _te2, slices2 = series_te[-1]
            # Verifica TR compatibili
            tr1 = slices1[0].tr_ms if slices1 else 0
            tr2 = slices2[0].tr_ms if slices2 else 0
            tr_mismatch = False
            if tr1 > 0 and tr2 > 0:
                tr_diff = abs(tr1 - tr2)
                tr_mean = (tr1 + tr2) / 2.0
                if tr_diff / tr_mean > 0.10:
                    t2_result = {
                        "t2_ms": None,
                        "error": (
                            f"TR incompatibili: la serie con TE={_te1:.0f} ms ha TR={tr1:.0f} ms, "
                            f"quella con TE={_te2:.0f} ms ha TR={tr2:.0f} ms. "
                            f"Il calcolo T2 richiede due serie Spin Echo con lo stesso TR e TE diversi."
                        ),
                        "te1_ms": _te1,
                        "te2_ms": _te2,
                        "s1_mean": None,
                        "s2_mean": None,
                        "ratio_s1_s2": None,
                        "series1_description": slices1[0].series_description if slices1 else "",
                        "series2_description": slices2[0].series_description if slices2 else "",
                    }
                    tr_mismatch = True
            if not tr_mismatch:
                idx1 = min(req.selections.get(uid1, len(slices1)//2), len(slices1)-1)
                idx2 = min(req.selections.get(uid2, len(slices2)//2), len(slices2)-1)
                sl1, sl2 = slices1[idx1], slices2[idx2]
                if sl1.te_ms > sl2.te_ms:
                    sl1, sl2 = sl2, sl1
                t2_result = calculate_t2(sl1.pixel_array, sl2.pixel_array, sl1.te_ms, sl2.te_ms, sl1.pixel_spacing_mm)
                t2_result["series1_description"] = sl1.series_description
                t2_result["series2_description"] = sl2.series_description
        else:
            t2_result = {"error": "T2 non calcolato: servono almeno 2 sequenze Spin Echo con TE diversi"}
    except Exception as e:
        t2_result = {"error": str(e)}

    return NumpyJSONResponse({
        "success": True,
        "results_by_sequence": results_by_sequence,
        "t2": t2_result,
    })

@app.post("/meta-info")
async def set_meta_info(req: MetaInfoRequest):
    state.meta_info = req.model_dump()
    return {"success": True}

@app.post("/save-history")
async def save_history(entry: HistoryEntry):
    entry_data = entry.model_dump()
    overwrite = bool(entry_data.pop("overwrite", False))
    entry_data["session_date"] = _entry_date(entry_data)
    entry_data = _with_raw_metrics(entry_data)

    existing_entries = _load_history_entries()
    duplicate = next((item for item in existing_entries if _history_identity(item) == _history_identity(entry_data)), None)
    if duplicate and not overwrite:
        return {
            "success": False,
            "duplicate": True,
            "message": "Analisi già presente nello storico. Confermare sovrascrittura.",
            "history_file": str(HISTORY_FILE),
            "existing": {
                "date": _entry_date(duplicate),
                "sequence": _sequence_key(duplicate),
                "saved_at": duplicate.get("saved_at", ""),
            },
        }

    state.history = _upsert_history_entry(state.history, entry_data)

    # Persist only to the server/app data directory so QC history is not tied to DICOM folders.
    try:
        existing = _dedupe_history_entries(_upsert_history_entry(existing_entries, entry_data))
        _persist_history_entries(existing)
    except Exception as e:
        logger.warning("Could not save history: %s", e)
    return {
        "success": True,
        "history_file": str(HISTORY_FILE),
        "total_entries": len(_load_history_entries()),
    }

@app.get("/history")
async def get_history():
    data = _load_history_entries()
    if data:
        return {"history": data, "sessions": _session_summary(data), "history_file": str(HISTORY_FILE)}
    return {"history": state.history, "sessions": _session_summary(state.history), "history_file": str(HISTORY_FILE)}

# ==============================================================================
# OVERLAY GENERATION
# ==============================================================================
def _generate_overlay(module: str, sl: DicomSlice, result: dict) -> str:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Circle, Rectangle

    arr = sl.pixel_array
    h, w = arr.shape
    dpi = 100
    fig, ax = plt.subplots(1, 1, figsize=(w/dpi, h/dpi), dpi=dpi, facecolor="#0f172a")
    p2, p98 = np.percentile(arr, 2), np.percentile(arr, 98)
    ax.imshow(arr, cmap="gray", vmin=p2, vmax=p98, interpolation="nearest",
              extent=[0, w, h, 0], origin="upper")
    ax.set_xlim(0, w); ax.set_ylim(h, 0); ax.axis("off")
    ax.set_position([0, 0, 1, 1])

    cr = result.get("center_rc", (h//2, w//2))
    r0 = result.get("radius_px", min(h, w)//3)
    ax.add_patch(Circle((cr[1], cr[0]), r0, color="cyan", fill=False, lw=1, ls="--", alpha=0.4))
    ax.plot(cr[1], cr[0], "+", color="#22d3ee", markersize=10, markeredgewidth=1.5)

    if module == "geometric":
        colors = {"horizontal": "#f97316", "vertical": "#3b82f6",
                  "oblique_45": "#22c55e", "oblique_135": "#a855f7"}
        line_coords = result.get("line_coords", {})
        for name, lc in line_coords.items():
            color = colors.get(name, "#ffffff")
            s, e = lc["start"], lc["end"]
            ax.plot([s[1], e[1]], [s[0], e[0]], color=color, lw=2, alpha=0.9)
            d_mm = result.get(f"diameter_{name}_mm", 0)
            mid_r = (s[0] + e[0]) / 2
            mid_c = (s[1] + e[1]) / 2
            ax.text(mid_c + 5, mid_r - 5, f"{d_mm:.1f}mm",
                    color=color, fontsize=7, fontweight="bold")

    elif module == "psg":
        r_ufov = result.get("ufov_radius_px", int(0.75 * r0))
        ax.add_patch(Circle((cr[1], cr[0]), r_ufov, color="#22c55e", fill=False, lw=1.5))
        rois = result.get("rois", {})
        roi_colors = {"right": "#fb923c", "left": "#fb923c", "up": "#60a5fa", "down": "#60a5fa"}
        for name, roi_data in rois.items():
            rect = roi_data["rect"]
            ax.add_patch(Rectangle((rect[1], rect[0]), rect[3], rect[2],
                                   fill=False, edgecolor=roi_colors.get(name, "#fff"), lw=1.5))

    elif module == "piu":
        r_ufov = result.get("ufov_radius_px", int(0.75 * r0))
        ax.add_patch(Circle((cr[1], cr[0]), r_ufov, color="#22c55e", fill=False, lw=1.5, ls="--"))
        max_pos = result.get("max_position_rc", (0, 0))
        min_pos = result.get("min_position_rc", (0, 0))
        r_mask = result.get("mask_radius_px", 5)
        ax.add_patch(Circle((max_pos[1], max_pos[0]), r_mask, color="#ef4444", fill=False, lw=2))
        ax.add_patch(Circle((min_pos[1], min_pos[0]), r_mask, color="#3b82f6", fill=False, lw=2))

    elif module == "snr":
        r_ufov = result.get("ufov_radius_px", int(0.75 * r0))
        ax.add_patch(Circle((cr[1], cr[0]), r_ufov, color="#eab308", fill=False, lw=1.5))
        ax.text(cr[1], cr[0], f"SNR={result.get('snr', 0):.1f}", color="#eab308",
                fontsize=10, ha="center", va="center", fontweight="bold")

    elif module == "snru":
        rois = result.get("rois", [])
        r_roi = result.get("roi_radius_px", 5)
        for roi in rois:
            rc = roi["center_rc"]
            ax.add_patch(Circle((rc[1], rc[0]), r_roi, color="#06b6d4", fill=False, lw=1.5))
            ax.text(rc[1], rc[0] + r_roi + 4, f"{roi['snr']:.0f}",
                    color="#06b6d4", fontsize=7, ha="center", fontweight="bold")

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight", pad_inches=0)
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode("ascii")

# Mount frontend
if os.path.isdir(FRONTEND_DIR):
    app.mount("/frontend", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

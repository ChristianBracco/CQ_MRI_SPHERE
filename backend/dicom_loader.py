"""
dicom_loader.py — Loader DICOM per MRI (Phantom Sfera / ACR)
"""

import os
from dataclasses import dataclass
from pathlib import Path
import numpy as np

_pydicom = None


def _get_pydicom():
    global _pydicom
    if _pydicom is None:
        import pydicom
        _pydicom = pydicom
    return _pydicom


def _safe_float(v, default=0.0):
    if v is None:
        return default
    try:
        if hasattr(v, "__iter__") and not isinstance(v, (str, bytes)):
            if len(v) == 0:
                return default
            return float(v[0])
        return float(v)
    except Exception:
        return default


def _safe_str(v, default=""):
    if v is None:
        return default
    try:
        return str(v).strip()
    except Exception:
        return default


@dataclass
class DicomSlice:
    filename: str
    pixel_array: np.ndarray
    slice_location: float
    slice_thickness_mm: float
    pixel_spacing_mm: float
    pixel_spacing_x: float
    pixel_spacing_y: float
    patient_position: str
    series_description: str
    tr_ms: float = 0.0
    te_ms: float = 0.0
    flip_angle: float = 0.0
    magnetic_field_T: float = 0.0
    bandwidth_hz: float = 0.0
    frequency_encoding_dir: str = ""
    phase_encoding_dir: str = ""
    study_date: str = ""
    study_time: str = ""
    manufacturer: str = ""
    model_name: str = ""
    institution_name: str = ""
    station_name: str = ""
    serial_number: str = ""
    operators_name: str = ""
    protocol_name: str = ""
    instance_number: int = 0
    series_instance_uid: str = ""
    body_part: str = ""
    window_center: float = 0.0
    window_width: float = 0.0
    rows: int = 0
    cols: int = 0
    fov_mm: float = 0.0
    matrix_size: int = 256
    n_averages: float = 1.0

    @property
    def image(self):
        return self.pixel_array


def _to_2d_array(ds) -> np.ndarray:
    arr = ds.pixel_array
    if arr.ndim == 3:
        if arr.shape[-1] in (3, 4):
            arr = arr[:, :, 0]
        else:
            arr = arr[arr.shape[0] // 2]
    elif arr.ndim > 3:
        arr = arr[0]
    arr = arr.astype(np.float32)
    photo = _safe_str(getattr(ds, "PhotometricInterpretation", "")).upper()
    if photo == "MONOCHROME1":
        arr = arr.max() - arr
    slope = _safe_float(getattr(ds, "RescaleSlope", 1.0), 1.0)
    intercept = _safe_float(getattr(ds, "RescaleIntercept", 0.0), 0.0)
    arr = arr * slope + intercept
    return arr


def load_dicom_slice(filepath: str) -> DicomSlice:
    pydicom = _get_pydicom()
    try:
        hdr = pydicom.dcmread(filepath, stop_before_pixels=True, force=True)
    except Exception as e:
        raise ValueError(f"Header non leggibile: {e}")

    modality = _safe_str(getattr(hdr, "Modality", "")).upper()
    if modality not in ("MR", ""):
        raise ValueError(f"Modality non MR: {modality}")

    try:
        ds = pydicom.dcmread(filepath, force=True)
    except Exception as e:
        raise ValueError(f"Errore lettura: {e}")

    if not hasattr(ds, "PixelData"):
        raise ValueError("Nessun PixelData")

    try:
        arr = _to_2d_array(ds)
    except Exception as e:
        raise ValueError(f"Errore pixel_array: {e}")

    ipp = getattr(ds, "ImagePositionPatient", None)
    if ipp is not None and len(ipp) >= 3:
        slice_location = _safe_float(ipp[2])
    else:
        slice_location = _safe_float(getattr(ds, "SliceLocation", 0.0))

    ps_x, ps_y = 1.0, 1.0
    if hasattr(ds, "PixelSpacing") and len(ds.PixelSpacing) >= 2:
        ps_x = _safe_float(ds.PixelSpacing[0], 1.0)
        ps_y = _safe_float(ds.PixelSpacing[1], 1.0)
    pixel_spacing = (ps_x + ps_y) / 2.0

    slice_thickness = _safe_float(getattr(ds, "SliceThickness", 0.0))
    patient_position = _safe_str(getattr(ds, "PatientPosition", "HFS")).upper()
    cols = arr.shape[1]
    rows = arr.shape[0]
    fov_mm = cols * ps_x
    tr = _safe_float(getattr(ds, "RepetitionTime", 0.0))
    te = _safe_float(getattr(ds, "EchoTime", 0.0))
    flip = _safe_float(getattr(ds, "FlipAngle", 0.0))
    field = _safe_float(getattr(ds, "MagneticFieldStrength", 0.0))
    bw = _safe_float(getattr(ds, "PixelBandwidth", 0.0))
    n_avg = _safe_float(getattr(ds, "NumberOfAverages", 1.0), 1.0)

    freq_dir = ""
    phase_dir = ""
    ied = getattr(ds, "InPlanePhaseEncodingDirection", None)
    if ied:
        ied_str = _safe_str(ied).upper()
        if ied_str in ("ROW", "COL", "COLUMN"):
            phase_dir = ied_str
            freq_dir = "COL" if phase_dir == "ROW" else "ROW"

    wc = _safe_float(getattr(ds, "WindowCenter", 0.0))
    ww = _safe_float(getattr(ds, "WindowWidth", 0.0))

    return DicomSlice(
        filename=os.path.basename(filepath),
        pixel_array=arr,
        slice_location=slice_location,
        slice_thickness_mm=slice_thickness,
        pixel_spacing_mm=pixel_spacing,
        pixel_spacing_x=ps_x,
        pixel_spacing_y=ps_y,
        patient_position=patient_position,
        series_description=_safe_str(getattr(ds, "SeriesDescription", "")),
        tr_ms=tr, te_ms=te, flip_angle=flip,
        magnetic_field_T=field, bandwidth_hz=bw,
        frequency_encoding_dir=freq_dir, phase_encoding_dir=phase_dir,
        study_date=_safe_str(getattr(ds, "StudyDate", "")),
        study_time=_safe_str(getattr(ds, "StudyTime", "")),
        manufacturer=_safe_str(getattr(ds, "Manufacturer", "")),
        model_name=_safe_str(getattr(ds, "ManufacturerModelName", "")),
        institution_name=_safe_str(getattr(ds, "InstitutionName", "")),
        station_name=_safe_str(getattr(ds, "StationName", "")),
        serial_number=_safe_str(getattr(ds, "DeviceSerialNumber", "")),
        operators_name=_safe_str(getattr(ds, "OperatorsName", "")),
        protocol_name=_safe_str(getattr(ds, "ProtocolName", "")),
        instance_number=int(_safe_float(getattr(ds, "InstanceNumber", 0))),
        series_instance_uid=_safe_str(getattr(ds, "SeriesInstanceUID", "")),
        body_part=_safe_str(getattr(ds, "BodyPartExamined", "")),
        window_center=wc, window_width=ww,
        rows=rows, cols=cols, fov_mm=fov_mm,
        matrix_size=max(rows, cols), n_averages=n_avg,
    )


def load_dicom_series(directory: str, recursive: bool = False) -> list:
    if not os.path.isdir(directory):
        raise ValueError(f"Directory non valida: {directory}")

    dicom_files = []
    if recursive:
        for root, dirs, files in os.walk(directory):
            for f in files:
                if not f.startswith("."):
                    dicom_files.append(os.path.join(root, f))
    else:
        for f in os.listdir(directory):
            path = os.path.join(directory, f)
            if os.path.isfile(path) and not f.startswith("."):
                dicom_files.append(path)

    slices = []
    for filepath in dicom_files:
        try:
            sl = load_dicom_slice(filepath)
            slices.append(sl)
        except Exception:
            pass

    if not slices:
        raise ValueError(f"Nessun DICOM MR valido trovato in: {directory}")

    slices.sort(key=lambda s: (s.slice_location, s.instance_number))
    return slices


def get_series_stats(slices: list) -> dict:
    if not slices:
        return {}
    locations = [s.slice_location for s in slices]
    return {
        "n_slices": len(slices),
        "pixel_spacing_mm": slices[0].pixel_spacing_mm,
        "slice_thickness_mm": slices[0].slice_thickness_mm,
        "manufacturer": slices[0].manufacturer,
        "model": slices[0].model_name,
        "tr_ms": slices[0].tr_ms,
        "te_ms": slices[0].te_ms,
        "magnetic_field_T": slices[0].magnetic_field_T,
        "fov_mm": slices[0].fov_mm,
        "matrix_size": slices[0].matrix_size,
    }

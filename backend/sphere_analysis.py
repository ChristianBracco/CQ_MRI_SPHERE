"""
sphere_analysis.py — Analisi QC per phantom sferico MRI.

Metriche implementate:
  - Accuratezza Geometrica (4 linee: H, V, 45°, 135°) + distorsione
  - PIU  (Percent Image Uniformity)
  - PSG  (Percent Signal Ghosting)
  - SNR  (Signal-to-Noise Ratio)
  - SNRU (SNR Uniformity — 5 ROI)
  - T2   (stima da due acquisizioni a TE diverso)
"""

import math
import numpy as np
from scipy import ndimage


# ==============================================================================
# PHANTOM DETECTION — Centro e raggio del disco (sezione sfera)
# ==============================================================================

def find_phantom_circle(arr: np.ndarray, pixel_spacing_mm: float = 1.0):
    """
    Trova centro e raggio del phantom sferico in sezione assiale.
    Threshold al 25% del massimo, rileva il disco brillante.

    Returns:
        (center_row, center_col, radius_px)
    """
    h, w = arr.shape
    s_max = np.max(arr)
    threshold = 0.25 * s_max

    max_span_x = 0
    i_start, i_end = 0, 0
    for j in range(h):
        above = np.where(arr[j, :] >= threshold)[0]
        if len(above) < 2:
            continue
        span = above[-1] - above[0]
        if span > max_span_x:
            max_span_x = span
            i_start = above[0]
            i_end = above[-1]

    max_span_y = 0
    j_start, j_end = 0, 0
    for i in range(w):
        above = np.where(arr[:, i] >= threshold)[0]
        if len(above) < 2:
            continue
        span = above[-1] - above[0]
        if span > max_span_y:
            max_span_y = span
            j_start = above[0]
            j_end = above[-1]

    x0 = (i_start + i_end) / 2.0
    y0 = (j_start + j_end) / 2.0
    r0 = min((i_end - i_start + 1) / 2.0, (j_end - j_start + 1) / 2.0)

    return int(round(y0)), int(round(x0)), int(round(r0))


# ==============================================================================
# ACCURATEZZA GEOMETRICA — 4 profili (H, V, 45°, 135°)
# ==============================================================================

def _measure_diameter_along_angle(arr, cr, cc, r0, angle_deg, pixel_spacing_mm):
    """
    Misura il diametro del disco lungo una direzione data (in gradi).
    Usa un profilo di intensità e rileva i bordi con gradiente.

    Returns:
        diameter_mm, (start_point, end_point) in pixel coords
    """
    h, w = arr.shape
    angle_rad = math.radians(angle_deg)
    dx = math.cos(angle_rad)
    dy = math.sin(angle_rad)

    # Crea profilo lungo la direzione dal centro ±1.3*r0
    length = int(1.3 * r0)
    n_points = 2 * length + 1
    profile = np.zeros(n_points)
    coords = []

    for i in range(n_points):
        t = i - length
        row = cr + t * dy
        col = cc + t * dx
        row_i = int(round(row))
        col_i = int(round(col))
        if 0 <= row_i < h and 0 <= col_i < w:
            profile[i] = arr[row_i, col_i]
        coords.append((row, col))

    # Gradiente per trovare i bordi
    grad = np.gradient(profile)
    threshold = 0.25 * np.max(np.abs(grad))

    # Bordo sinistro (rising edge): primo gradiente positivo sopra soglia
    left_idx = 0
    for i in range(n_points // 2):
        if grad[i] > threshold:
            left_idx = i
            break

    # Bordo destro (falling edge): ultimo gradiente negativo sotto -soglia
    right_idx = n_points - 1
    for i in range(n_points - 1, n_points // 2, -1):
        if grad[i] < -threshold:
            right_idx = i
            break

    # Sub-pixel: interpolazione lineare al 50% del profilo
    half_max = 0.5 * np.max(profile)

    # Raffina bordo sinistro
    left_sub = float(left_idx)
    for i in range(max(0, left_idx - 3), min(n_points - 1, left_idx + 3)):
        if profile[i] < half_max <= profile[i + 1]:
            frac = (half_max - profile[i]) / max(profile[i + 1] - profile[i], 1e-6)
            left_sub = i + frac
            break

    # Raffina bordo destro
    right_sub = float(right_idx)
    for i in range(min(n_points - 1, right_idx + 3), max(0, right_idx - 3), -1):
        if profile[i] < half_max <= profile[i - 1]:
            frac = (half_max - profile[i]) / max(profile[i - 1] - profile[i], 1e-6)
            right_sub = i - frac
            break

    diameter_px = right_sub - left_sub
    diameter_mm = diameter_px * pixel_spacing_mm

    # Coordinate dei due punti estremi
    start_pt = coords[int(round(left_sub))] if int(round(left_sub)) < len(coords) else coords[0]
    end_pt = coords[int(round(right_sub))] if int(round(right_sub)) < len(coords) else coords[-1]

    return diameter_mm, (start_pt, end_pt)


def calculate_geometric_accuracy(arr: np.ndarray, pixel_spacing_mm: float = 1.0,
                                  center_rc=None, radius_px=None,
                                  nominal_diameter_mm: float = 0.0):
    """
    Accuratezza geometrica: misura diametro in 4 direzioni (H, V, 45°, 135°).

    La distorsione è calcolata come:
        distortion_percent = 100 × (D_max - D_min) / D_mean

    Per phantom sferico il diametro nominale può non essere noto;
    in tal caso si usa la media misurata come riferimento.
    """
    h, w = arr.shape
    if center_rc is None or radius_px is None:
        cr, cc, r0 = find_phantom_circle(arr, pixel_spacing_mm)
    else:
        cr, cc = center_rc
        r0 = radius_px

    directions = {
        "horizontal": 0,
        "vertical": 90,
        "oblique_45": 45,
        "oblique_135": 135,
    }

    measurements = {}
    diameters = []
    line_coords = {}

    for name, angle in directions.items():
        d_mm, (pt1, pt2) = _measure_diameter_along_angle(arr, cr, cc, r0, angle, pixel_spacing_mm)
        measurements[name] = round(d_mm, 2)
        diameters.append(d_mm)
        line_coords[name] = {"start": [round(pt1[0], 1), round(pt1[1], 1)],
                             "end": [round(pt2[0], 1), round(pt2[1], 1)]}

    d_mean = np.mean(diameters)
    d_max = np.max(diameters)
    d_min = np.min(diameters)
    distortion_percent = 100.0 * (d_max - d_min) / d_mean if d_mean > 0 else 0.0

    # Se nominale fornito, calcola errore assoluto
    if nominal_diameter_mm > 0:
        max_error_mm = max(abs(d - nominal_diameter_mm) for d in diameters)
    else:
        max_error_mm = (d_max - d_min) / 2.0
        nominal_diameter_mm = round(d_mean, 1)

    # Criterio: distorsione < 2% e errore < 2mm
    passed = distortion_percent <= 2.0 and max_error_mm <= 2.0

    return {
        "diameter_horizontal_mm": measurements["horizontal"],
        "diameter_vertical_mm": measurements["vertical"],
        "diameter_45_mm": measurements["oblique_45"],
        "diameter_135_mm": measurements["oblique_135"],
        "diameter_mean_mm": round(float(d_mean), 2),
        "diameter_max_mm": round(float(d_max), 2),
        "diameter_min_mm": round(float(d_min), 2),
        "distortion_percent": round(float(distortion_percent), 3),
        "max_error_mm": round(float(max_error_mm), 2),
        "nominal_diameter_mm": nominal_diameter_mm,
        "passed": passed,
        "center_rc": (cr, cc),
        "radius_px": r0,
        "line_coords": line_coords,
    }


# ==============================================================================
# PIU — Percent Image Uniformity
# ==============================================================================

def calculate_piu(arr: np.ndarray, pixel_spacing_mm: float = 1.0,
                  center_rc=None, radius_px=None,
                  ufov_fraction: float = 0.75,
                  ufov_radius_px=None):
    """
    PIU = 100 × [1 - (S_max - S_min) / (S_max + S_min)]

    Per la sfera, la UFOV è ridotta a 75% del raggio (default)
    per evitare artefatti di bordo.
    """
    h, w = arr.shape
    px = float(pixel_spacing_mm)

    if center_rc is None or radius_px is None:
        cr, cc, r0 = find_phantom_circle(arr, pixel_spacing_mm)
    else:
        cr, cc = center_rc
        r0 = radius_px

    # Maschera circolare 1 cm²
    r_mask_mm = math.sqrt(100.0 / math.pi)
    r_mask_px = int(math.ceil(r_mask_mm / px))

    mask_size = 2 * r_mask_px + 1
    Y_m, X_m = np.ogrid[:mask_size, :mask_size]
    mask = ((X_m - r_mask_px)**2 + (Y_m - r_mask_px)**2 <= r_mask_px**2).astype(np.float32)
    n_mask = mask.sum()

    from scipy.ndimage import convolve
    i1 = convolve(arr.astype(np.float64), mask, mode='constant', cval=0.0) / n_mask

    r_ufov = int(round(ufov_radius_px)) if ufov_radius_px else int(round(ufov_fraction * r0))
    Y, X = np.ogrid[:h, :w]
    search_radius = max(1, r_ufov - r_mask_px)
    search_mask = ((X - cc)**2 + (Y - cr)**2) <= search_radius**2

    i1_search = i1.copy()
    i1_search[~search_mask] = np.nan

    s_max = float(np.nanmax(i1_search))
    s_min = float(np.nanmin(i1_search))

    max_pos = np.unravel_index(np.nanargmax(i1_search), i1_search.shape)
    min_pos = np.unravel_index(np.nanargmin(i1_search), i1_search.shape)

    if (s_max + s_min) > 0:
        piu = 100.0 * (1.0 - (s_max - s_min) / (s_max + s_min))
    else:
        piu = 0.0

    limit = 87.5
    passed = piu >= limit

    return {
        "piu_percent": round(piu, 2),
        "s_max": round(s_max, 2),
        "s_min": round(s_min, 2),
        "max_position_rc": (int(max_pos[0]), int(max_pos[1])),
        "min_position_rc": (int(min_pos[0]), int(min_pos[1])),
        "passed": passed,
        "limit": limit,
        "center_rc": (cr, cc),
        "radius_px": r0,
        "ufov_radius_px": r_ufov,
        "mask_radius_px": r_mask_px,
    }


# ==============================================================================
# PSG — Percent Signal Ghosting
# ==============================================================================

def calculate_psg(arr: np.ndarray, pixel_spacing_mm: float = 1.0,
                  center_rc=None, radius_px=None, ghost_rois=None):
    """
    PSG(%) = 100 × |((S_top + S_bottom) - (S_left + S_right)) / (2 × S)|

    ROI layout (ACR standard):
      - Up/Down: ORIZZONTALI (larghe, basse) sopra/sotto il phantom
      - Left/Right: VERTICALI (strette, alte) a sinistra/destra del phantom

    ROI centrale: disco con R = 0.75 × R0
    4 ROI background da ~10 cm² ciascuna, a 0.1×R0 dal phantom.
    ghost_rois: dict opzionale {name: [y, x, h, w]} per override manuale.
    """
    h, w = arr.shape
    px = py = pixel_spacing_mm
    ghost_rois = ghost_rois or {}

    if center_rc is None or radius_px is None:
        cr, cc, r0 = find_phantom_circle(arr, pixel_spacing_mm)
    else:
        cr, cc = center_rc
        r0 = radius_px

    # ROI centrale (segnale)
    r_ufov = int(0.75 * r0)
    Y, X = np.ogrid[:h, :w]
    ufov_mask = ((X - cc)**2 + (Y - cr)**2) <= r_ufov**2
    signal_mean = float(np.mean(arr[ufov_mask]))

    # Background ROIs — target area 10 cm² = 1000 mm²
    gap_px = int(0.1 * r0)
    target_area_mm2 = 1000.0

    def _get_roi(name, y0, x0, roi_h, roi_w):
        """Use custom roi from ghost_rois if provided."""
        custom = ghost_rois.get(name)
        if custom and len(custom) >= 4:
            y0, x0, roi_h, roi_w = int(custom[0]), int(custom[1]), int(custom[2]), int(custom[3])
        y0 = max(0, min(h - 2, int(y0)))
        x0 = max(0, min(w - 2, int(x0)))
        roi_h = max(1, min(h - y0, int(roi_h)))
        roi_w = max(1, min(w - x0, int(roi_w)))
        roi = arr[y0:y0 + roi_h, x0:x0 + roi_w]
        mean_val = float(np.mean(roi)) if roi.size > 0 else 0.0
        return mean_val, [y0, x0, roi_h, roi_w]

    # UP — orizzontale (larga, bassa) sopra il phantom
    up_h = max(3, int(0.4 * gap_px) + 3)
    up_w = max(3, int(target_area_mm2 / (up_h * px * py)))
    up_w = min(up_w, w - 2 * gap_px)
    up_y = gap_px
    up_x = cc - up_w // 2
    s_U, rect_U = _get_roi("up", up_y, up_x, up_h, up_w)

    # DOWN — orizzontale (larga, bassa) sotto il phantom
    dn_h = up_h
    dn_w = up_w
    dn_y = cr + r0 + gap_px
    dn_x = cc - dn_w // 2
    s_D, rect_D = _get_roi("down", dn_y, dn_x, dn_h, dn_w)

    # RIGHT — verticale (stretta, alta) a destra del phantom
    rt_w = max(3, int(0.4 * gap_px) + 3)
    rt_h = max(3, int(target_area_mm2 / (rt_w * px * py)))
    rt_h = min(rt_h, h - 2 * gap_px)
    rt_x = cc + r0 + gap_px
    rt_y = cr - rt_h // 2
    s_R, rect_R = _get_roi("right", rt_y, rt_x, rt_h, rt_w)

    # LEFT — verticale (stretta, alta) a sinistra del phantom
    lt_w = rt_w
    lt_h = rt_h
    lt_x = gap_px
    lt_y = cr - lt_h // 2
    s_L, rect_L = _get_roi("left", lt_y, lt_x, lt_h, lt_w)

    # PSG formula: |((top + bottom) - (left + right)) / (2 × signal)|
    if signal_mean > 0:
        psg = 100.0 * abs((s_U + s_D) - (s_L + s_R)) / (2.0 * signal_mean)
    else:
        psg = 0.0

    passed = psg <= 2.5

    return {
        "psg_percent": round(psg, 4),
        "signal_mean": round(signal_mean, 2),
        "s_right": round(s_R, 2),
        "s_left": round(s_L, 2),
        "s_up": round(s_U, 2),
        "s_down": round(s_D, 2),
        "passed": passed,
        "limit": 2.5,
        "center_rc": (cr, cc),
        "radius_px": r0,
        "ufov_radius_px": r_ufov,
        "rois": {
            "up": {"mean": s_U, "rect": rect_U},
            "down": {"mean": s_D, "rect": rect_D},
            "left": {"mean": s_L, "rect": rect_L},
            "right": {"mean": s_R, "rect": rect_R},
        },
    }


# ==============================================================================
# SNR — Signal-to-Noise Ratio (singola immagine, metodo NEMA)
# ==============================================================================

def calculate_snr(arr: np.ndarray, pixel_spacing_mm: float = 1.0,
                  center_rc=None, radius_px=None,
                  snr_method: str = "single_lr", ghost_rois=None):
    """
    SNR con metodi multipli:
      - single_lr: 0.665 × S / mean(σ_L, σ_R)
      - single_4corner: 0.665 × S / mean(σ dei 4 angoli)
      - single_4bg: 0.665 × S / mean(σ delle 4 ROI background PSG-style)
    """
    h, w = arr.shape
    px = py = pixel_spacing_mm
    ghost_rois = ghost_rois or {}

    # Auto-detect phantom, but use custom center if provided
    _cr, _cc, _r0 = find_phantom_circle(arr, pixel_spacing_mm)
    if center_rc is not None:
        cr, cc = int(center_rc[0]), int(center_rc[1])
    else:
        cr, cc = _cr, _cc
    r0 = int(radius_px) if radius_px is not None else _r0

    # Signal: UFOV
    r_ufov = int(0.75 * r0)
    Y, X = np.ogrid[:h, :w]
    ufov_mask = ((X - cc)**2 + (Y - cr)**2) <= r_ufov**2
    signal_mean = float(np.mean(arr[ufov_mask]))

    gap_px = int(0.1 * r0)
    target_area_mm2 = 1000.0

    def _roi_std(y0, x0, roi_h, roi_w):
        y0 = max(0, min(h - 2, int(y0)))
        x0 = max(0, min(w - 2, int(x0)))
        roi_h = max(1, min(h - y0, int(roi_h)))
        roi_w = max(1, min(w - x0, int(roi_w)))
        roi = arr[y0:y0 + roi_h, x0:x0 + roi_w]
        return float(np.std(roi)) if roi.size > 0 else 1.0

    stds = []
    rois_info = {}

    if snr_method == "single_4corner":
        # 4 angoli: ROI quadrate 20x20 px ai 4 angoli
        sz = 20
        corners = [("TL", 2, 2), ("TR", 2, w-sz-2), ("BL", h-sz-2, 2), ("BR", h-sz-2, w-sz-2)]
        for name, ry, rx in corners:
            s = _roi_std(ry, rx, sz, sz)
            stds.append(s)
            rois_info[name] = {"std": round(s, 4), "rect": [ry, rx, sz, sz]}

    elif snr_method == "single_4bg":
        # 4 ROI background stile PSG
        # Right
        x_R = cc + r0 + gap_px
        w_R = max(3, w - gap_px - x_R)
        h_R = max(3, int(target_area_mm2 / (w_R * px * py)))
        stds.append(_roi_std(cr - h_R // 2, x_R, h_R, w_R))
        # Left
        x_L = gap_px
        w_L = max(3, cc - r0 - gap_px - x_L)
        h_L = max(3, int(target_area_mm2 / (w_L * px * py)))
        stds.append(_roi_std(cr - h_L // 2, x_L, h_L, w_L))
        # Up
        up_h = max(3, int(0.4 * gap_px) + 3)
        up_w = max(3, int(target_area_mm2 / (up_h * px * py)))
        stds.append(_roi_std(gap_px, cc - up_w // 2, up_h, up_w))
        # Down
        dn_y = cr + r0 + gap_px
        stds.append(_roi_std(dn_y, cc - up_w // 2, up_h, up_w))

    else:  # single_lr (default)
        # Use ghost_rois override if available
        if "right" in ghost_rois:
            gy, gx, gh, gw = ghost_rois["right"]
            std_R = _roi_std(gy, gx, gh, gw)
            stds.append(std_R)
            rois_info["right"] = {"std": round(std_R, 4), "rect": [gy, gx, gh, gw]}
        else:
            x_R = cc + r0 + gap_px
            w_R = max(3, w - gap_px - x_R)
            h_R = max(3, int(target_area_mm2 / (w_R * px * py)))
            y_R = max(0, cr - h_R // 2)
            std_R = _roi_std(y_R, x_R, h_R, w_R)
            stds.append(std_R)
            rois_info["right"] = {"std": round(std_R, 4), "rect": [y_R, x_R, h_R, w_R]}

        if "left" in ghost_rois:
            gy, gx, gh, gw = ghost_rois["left"]
            std_L = _roi_std(gy, gx, gh, gw)
            stds.append(std_L)
            rois_info["left"] = {"std": round(std_L, 4), "rect": [gy, gx, gh, gw]}
        else:
            x_L = gap_px
            w_L = max(3, cc - r0 - gap_px - x_L)
            h_L = max(3, int(target_area_mm2 / (w_L * px * py)))
            y_L = max(0, cr - h_L // 2)
            std_L = _roi_std(y_L, x_L, h_L, w_L)
            stds.append(std_L)
            rois_info["left"] = {"std": round(std_L, 4), "rect": [y_L, x_L, h_L, w_L]}

    sigma_bg = float(np.mean(stds)) if stds else 1.0
    snr = 0.665 * signal_mean / sigma_bg if sigma_bg > 0 else 0.0

    return {
        "snr": round(snr, 2),
        "signal_mean": round(signal_mean, 2),
        "noise_std_left": round(stds[1] if len(stds) > 1 else stds[0], 4) if stds else 0,
        "noise_std_right": round(stds[0], 4) if stds else 0,
        "noise_std_mean": round(sigma_bg, 4),
        "method": snr_method,
        "center_rc": (cr, cc),
        "radius_px": r0,
        "ufov_radius_px": r_ufov,
        "bg_rois": rois_info,
    }


# ==============================================================================
# SNRU — SNR Uniformity (5 ROI)
# ==============================================================================

def calculate_snru(arr: np.ndarray, pixel_spacing_mm: float = 1.0,
                   center_rc=None, radius_px=None,
                   roi_fraction: float = 0.6):
    """
    5 ROI (centro + 4 cardinali a 0.6×r0 dal centro).
    ROI area = 1 cm² ciascuna.

    SNRU = 100 × (1 - (SNR_max - SNR_min) / (SNR_max + SNR_min))
    """
    h, w = arr.shape
    px = float(pixel_spacing_mm)

    # Auto-detect phantom, but use custom center if provided
    _cr, _cc, _r0 = find_phantom_circle(arr, pixel_spacing_mm)
    if center_rc is not None:
        cr, cc = int(center_rc[0]), int(center_rc[1])
    else:
        cr, cc = _cr, _cc
    r0 = int(radius_px) if radius_px is not None else _r0

    # Raggio ROI per area 1 cm²
    r_roi_mm = math.sqrt(100.0 / math.pi)
    r_roi_px = int(math.ceil(r_roi_mm / px))

    # Background noise (estimata da aree esterne)
    gap_px = int(0.1 * r0)
    bg_x = cc + r0 + gap_px
    bg_w = max(3, min(30, w - bg_x - 2))
    bg_h = max(3, min(30, h - 2))
    bg_y = max(0, cr - bg_h // 2)
    bg_roi = arr[bg_y:bg_y + bg_h, bg_x:bg_x + bg_w]
    sigma_bg = float(np.std(bg_roi)) if bg_roi.size > 0 else 1.0

    # Posizioni 5 ROI
    dist = roi_fraction * r0
    positions = [
        ("center", cr, cc),
        ("top", cr - int(dist), cc),
        ("bottom", cr + int(dist), cc),
        ("left", cr, cc - int(dist)),
        ("right", cr, cc + int(dist)),
    ]

    Y, X = np.ogrid[:h, :w]
    rois = []
    snr_values = []

    for name, ry, rx in positions:
        mask = ((X - rx)**2 + (Y - ry)**2) <= r_roi_px**2
        if not np.any(mask):
            continue
        roi_mean = float(np.mean(arr[mask]))
        roi_snr = 0.665 * roi_mean / sigma_bg if sigma_bg > 0 else 0.0
        snr_values.append(roi_snr)
        rois.append({
            "name": name,
            "center_rc": (ry, rx),
            "mean_signal": round(roi_mean, 2),
            "snr": round(roi_snr, 2),
        })

    if len(snr_values) >= 2:
        snr_max = max(snr_values)
        snr_min = min(snr_values)
        if (snr_max + snr_min) > 0:
            snru = 100.0 * (1.0 - (snr_max - snr_min) / (snr_max + snr_min))
        else:
            snru = 0.0
    else:
        snru = 0.0
        snr_max = snr_min = 0.0

    passed = snru >= 90.0  # Criterio: SNRU >= 90%

    return {
        "snru_percent": round(snru, 2),
        "snr_max": round(snr_max, 2),
        "snr_min": round(snr_min, 2),
        "noise_std": round(sigma_bg, 4),
        "rois": rois,
        "passed": passed,
        "limit": 90.0,
        "center_rc": (cr, cc),
        "radius_px": r0,
        "roi_radius_px": r_roi_px,
    }


# ==============================================================================
# T2 — Stima da due acquisizioni a TE diverso
# ==============================================================================

def calculate_t2(arr_te1: np.ndarray, arr_te2: np.ndarray,
                 te1_ms: float, te2_ms: float,
                 pixel_spacing_mm: float = 1.0,
                 center_rc=None, radius_px=None,
                 roi_fraction: float = 0.6):
    """
    Stima T2 = (TE2 - TE1) / ln(S1/S2)

    Usando ROI circolare centrata nel phantom.
    Richiede due immagini della stessa slice con TE diversi.
    """
    if te2_ms <= te1_ms:
        return {"error": "TE2 deve essere maggiore di TE1"}

    h, w = arr_te1.shape

    if center_rc is None or radius_px is None:
        cr, cc, r0 = find_phantom_circle(arr_te1, pixel_spacing_mm)
    else:
        cr, cc = center_rc
        r0 = radius_px

    # ROI circolare al 60% del raggio
    r_roi = int(roi_fraction * r0)
    Y, X = np.ogrid[:h, :w]
    roi_mask = ((X - cc)**2 + (Y - cr)**2) <= r_roi**2

    s1 = float(np.mean(arr_te1[roi_mask]))
    s2 = float(np.mean(arr_te2[roi_mask]))

    if s1 <= 0 or s2 <= 0 or s2 >= s1:
        if s2 > s1:
            reason = (
                f"Il segnale a TE₂={te2_ms} ms (S₂={s2:.1f}) è maggiore del segnale "
                f"a TE₁={te1_ms} ms (S₁={s1:.1f}). "
                "Questo indica che le due serie hanno TR diversi: "
                "il calcolo T2 richiede due serie con lo stesso TR."
            )
        else:
            reason = "Segnali non validi per calcolo T2 (S1 deve essere > S2 > 0)"
        return {
            "t2_ms": None,
            "error": reason,
            "s1_mean": round(s1, 2),
            "s2_mean": round(s2, 2),
            "te1_ms": te1_ms,
            "te2_ms": te2_ms,
        }

    t2 = (te2_ms - te1_ms) / math.log(s1 / s2)

    return {
        "t2_ms": round(t2, 2),
        "s1_mean": round(s1, 2),
        "s2_mean": round(s2, 2),
        "te1_ms": te1_ms,
        "te2_ms": te2_ms,
        "ratio_s1_s2": round(s1 / s2, 4),
        "center_rc": (cr, cc),
        "radius_px": r0,
        "roi_radius_px": r_roi,
    }

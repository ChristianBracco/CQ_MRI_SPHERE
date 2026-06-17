"use strict";
/**
 * api.js — HTTP client per MRI QC Sphere backend
 */
const API = {
  baseUrl: "http://127.0.0.1:8182",

  async fetch(path, opts = {}) {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, { headers: {"Content-Type":"application/json"}, ...opts });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  },
  get(path) { return this.fetch(path); },
  post(path, body) { return this.fetch(path, { method:"POST", body:JSON.stringify(body) }); },

  health() { return this.get("/health"); },
  loadDicom(inputDir) { return this.post("/load-dicom", { input_dir: inputDir, recursive: true }); },
  setActiveSequence(uid) { return this.post("/set-active-sequence", { uid }); },
  getSlices() { return this.get("/slices"); },
  getSliceImage(idx, wl, ww, size) {
    let url = `/slice-image/${idx}?size=${size||0}`;
    if (wl != null && wl !== 0) url += `&wl=${wl}`;
    if (ww != null && ww !== 0) url += `&ww=${ww}`;
    return this.get(url);
  },
  getThumbnails(wl, ww, size=128) {
    let url = `/slice-thumbnails?size=${size}`;
    if (wl != null && wl !== 0) url += `&wl=${wl}`;
    if (ww != null && ww !== 0) url += `&ww=${ww}`;
    return this.get(url);
  },
  getDicomMeta() { return this.get("/dicom-meta"); },
  analyze(module, sliceIdx, kwargs) { return this.post("/analyze", { module, slice_idx: sliceIdx, kwargs: kwargs||null }); },
  analyzeT2(idxTe1, idxTe2) { return this.post("/analyze-t2", { slice_idx_te1: idxTe1, slice_idx_te2: idxTe2 }); },
  analyzeT2Auto(sliceIdx) { return this.post("/analyze-t2-auto", { slice_idx: sliceIdx }); },
  analyzeAll(sliceIdx) { return this.post(`/analyze-all?slice_idx=${sliceIdx}`, {}); },
  setMetaInfo(info) { return this.post("/meta-info", info); },
  saveHistory(entry) { return this.post("/save-history", entry); },
  getHistory() { return this.get("/history"); },
  browseFs(path="") { return this.get(`/browse-fs?path=${encodeURIComponent(path)}`); },
};

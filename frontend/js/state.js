"use strict";
/**
 * state.js — Application state
 */
const AppState = {
  currentStep: 1,
  inputDir: "",
  phantomType: "sphere", // "sphere" or "acr"
  slices: [],
  thumbnails: [],
  selectedSliceIdx: -1,
  selectedT2SliceIdx: -1, // second slice for T2
  sequences: [],
  activeSequenceUid: "",
  results: {},
  metaInfo: {},
  dicomMeta: null,
  history: [],

  modules: ["geometric", "piu", "psg", "snr", "snru", "t2"],
  moduleLabels: {
    geometric: "Accuratezza Geometrica",
    piu: "PIU — Uniformità",
    psg: "PSG — Ghosting",
    snr: "SNR",
    snru: "SNRU — Uniformità SNR",
    t2: "T2",
  },
  moduleColors: {
    geometric: "#f97316",
    piu: "#2a9d8f",
    psg: "#e63946",
    snr: "#eab308",
    snru: "#457b9d",
    t2: "#a855f7",
  },

  reset() {
    this.slices = [];
    this.thumbnails = [];
    this.selectedSliceIdx = -1;
    this.selectedT2SliceIdx = -1;
    this.results = {};
    this.dicomMeta = null;
    this.sequences = [];
  },
};

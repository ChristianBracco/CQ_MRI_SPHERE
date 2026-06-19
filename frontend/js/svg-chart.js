"use strict";
/**
 * svg-chart.js — Lightweight SVG trend chart (zero dependencies, offline).
 * Usage: SvgChart.line(container, { labels, datasets, title, yLabel })
 */
const SvgChart = (() => {
  const COLORS = ["#3b82f6","#22c55e","#f97316","#a855f7","#ef4444","#06b6d4"];
  const PAD = { top:30, right:20, bottom:40, left:55 };

  function line(container, opts) {
    const { labels=[], datasets=[], title="", width=700, height=240 } = opts;
    if (!labels.length || !datasets.length) { container.innerHTML = ""; return; }

    const W = width, H = height;
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    // Compute global y range
    let yMin = Infinity, yMax = -Infinity;
    datasets.forEach(ds => {
      ds.data.forEach(v => { if (v != null) { yMin = Math.min(yMin, v); yMax = Math.max(yMax, v); } });
    });
    (opts.limits || []).forEach(lim => {
      if (lim.value != null) { yMin = Math.min(yMin, lim.value); yMax = Math.max(yMax, lim.value); }
    });
    if (!isFinite(yMin)) { yMin = 0; yMax = 1; }
    const yPad = (yMax - yMin) * 0.1 || 1;
    yMin -= yPad; yMax += yPad;

    const xStep = labels.length > 1 ? plotW / (labels.length - 1) : plotW;
    const yScale = v => PAD.top + plotH - (v - yMin) / (yMax - yMin) * plotH;
    const xPos = i => PAD.left + i * xStep;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;font-family:sans-serif;">`;

    // Background
    svg += `<rect width="${W}" height="${H}" fill="var(--bg-card,#1e293b)" rx="6"/>`;

    // Title
    if (title) svg += `<text x="${W/2}" y="18" text-anchor="middle" fill="var(--accent-cyan,#22d3ee)" font-size="12" font-weight="600">${esc(title)}</text>`;

    // Grid lines + Y labels
    const nTicks = 5;
    for (let i = 0; i <= nTicks; i++) {
      const y = PAD.top + (plotH / nTicks) * i;
      const val = yMax - (yMax - yMin) * (i / nTicks);
      svg += `<line x1="${PAD.left}" y1="${y}" x2="${W-PAD.right}" y2="${y}" stroke="var(--border,#334155)" stroke-width="0.5"/>`;
      svg += `<text x="${PAD.left-6}" y="${y+4}" text-anchor="end" fill="var(--text-muted,#64748b)" font-size="9">${val.toFixed(1)}</text>`;
    }

    // X labels
    labels.forEach((lbl, i) => {
      const x = xPos(i);
      svg += `<text x="${x}" y="${H-8}" text-anchor="middle" fill="var(--text-muted,#64748b)" font-size="8" transform="rotate(-20 ${x} ${H-8})">${esc(lbl)}</text>`;
    });

    // Data lines + dots
    datasets.forEach((ds, di) => {
      const color = ds.color || COLORS[di % COLORS.length];
      let pathD = "";
      let dots = "";
      ds.data.forEach((v, i) => {
        if (v == null) return;
        const x = xPos(i), y = yScale(v);
        pathD += (pathD ? "L" : "M") + `${x.toFixed(1)},${y.toFixed(1)} `;
        dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${color}" stroke="var(--bg-card,#1e293b)" stroke-width="1.5"/>`;
      });
      if (pathD) svg += `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>`;
      svg += dots;
      // Legend
      const lx = PAD.left + di * 100, ly = H - 2;
      svg += `<rect x="${lx}" y="${ly-7}" width="10" height="3" fill="${color}" rx="1"/>`;
      svg += `<text x="${lx+13}" y="${ly-3}" fill="var(--text-secondary,#94a3b8)" font-size="8">${esc(ds.label||"")}</text>`;
    });

    // Limit lines
    if (opts.limits) {
      opts.limits.forEach(lim => {
        if (lim.value == null || lim.value < yMin || lim.value > yMax) return;
        const y = yScale(lim.value);
        svg += `<line x1="${PAD.left}" y1="${y}" x2="${W-PAD.right}" y2="${y}" stroke="${lim.color||'#ef4444'}" stroke-width="1" stroke-dasharray="4,3" opacity="0.7"/>`;
        svg += `<text x="${W-PAD.right+2}" y="${y+3}" fill="${lim.color||'#ef4444'}" font-size="8">${esc(lim.label||"")}</text>`;
      });
    }

    svg += `</svg>`;
    container.innerHTML = svg;
  }

  function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  return { line };
})();

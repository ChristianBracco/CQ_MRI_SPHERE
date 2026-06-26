"use strict";
/**
 * app.js — MRI QC Sphere/ACR v2
 * Fixes: proper SVG dragging, T2 auto from series, SNR method selector
 */
(async function main() {

  // ─── THEME ───
  const themeBtn=document.getElementById("btn-theme-toggle");
  let darkMode=localStorage.getItem("sphere_qc_theme")!=="light";
  applyTheme(darkMode);
  themeBtn?.addEventListener("click",()=>{darkMode=!darkMode;applyTheme(darkMode);localStorage.setItem("sphere_qc_theme",darkMode?"dark":"light");});
  function applyTheme(d){document.body.classList.toggle("theme-light",!d);themeBtn.textContent=d?"☀":"🌙";}

  // ─── PHANTOM TOGGLE ───
  const phantomToggle=document.getElementById("phantom-type-toggle"),phantomLabel=document.getElementById("phantom-type-label");
  phantomToggle?.addEventListener("change",()=>{AppState.phantomType=phantomToggle.checked?"acr":"sphere";phantomLabel.textContent=phantomToggle.checked?"ACR":"Sfera";});

  // ─── NAV ───
  document.querySelectorAll(".step-btn").forEach(b=>{b.addEventListener("click",()=>{const s=+b.dataset.step;if(s<=AppState.currentStep)UI.showStep(s);});});
  try{await API.health();UI.setApiStatus(true);}catch{UI.setApiStatus(false);}
  ensureTotalReportButton();

  function ensureTotalReportButton(){
    const printBtn=document.getElementById("btn-print");
    if(printBtn) printBtn.textContent="Stampa report compatto";
    if(document.getElementById("btn-total-report")) return;
    const toolbarRight=document.querySelector(".toolbar-right");
    if(!toolbarRight) return;
    const btn=document.createElement("button");
    btn.id="btn-total-report";
    btn.className="btn btn-xs btn-secondary";
    btn.textContent="Report CQ totale";
    toolbarRight.insertBefore(btn,toolbarRight.firstChild);
  }

  // ─── GRID SIZE ───
  const GRID_SIZES={S:80,M:120,L:180,XL:260};let gridSize="M";
  const SEQ_COLORS=["#3b82f6","#22c55e","#f97316","#a855f7","#06b6d4","#ef4444"];
  function sequenceColor(uid){const i=Math.max(0,AppState.sequences.findIndex(s=>s.uid===uid));return SEQ_COLORS[i%SEQ_COLORS.length];}
  function sequenceLabel(seq){return `${seq?.description||"Seq"} TR=${seq?.tr_ms?.toFixed?.(0)||"?"} TE=${seq?.te_ms?.toFixed?.(0)||"?"}`;}
  function currentAnalysisUid(){return AppState.activeAnalysisSequenceUid||AppState.activeSequenceUid||(AppState.sequences[0]?.uid||"");}
  function setAnalysisSequence(uid){
    AppState.activeAnalysisSequenceUid=uid;
    AppState.activeSequenceUid=uid;
    AppState.selectedSliceIdx=AppState.selectedSlicesBySequence[uid] ?? AppState.selectedSliceIdx;
    AppState.results=AppState.resultsBySequence[uid]?.results||{};
    if(AppState.sessionT2) AppState.results.t2=AppState.sessionT2;
  }
  document.querySelectorAll(".size-btn").forEach(b=>{b.addEventListener("click",()=>{document.querySelectorAll(".size-btn").forEach(x=>x.classList.remove("active"));b.classList.add("active");gridSize=b.dataset.size;document.getElementById("slice-grid").style.setProperty("--grid-size",GRID_SIZES[gridSize]+"px");});});

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: LOAD
  // ═══════════════════════════════════════════════════════════════════════════
  const inputDir=document.getElementById("input-dir"),btnLoad=document.getElementById("btn-load");
  const saved=localStorage.getItem("sphere_qc_input_dir");
  if(saved){inputDir.value=saved;btnLoad.disabled=false;}
  inputDir.addEventListener("input",()=>{btnLoad.disabled=!inputDir.value.trim();});
  inputDir.addEventListener("keydown",e=>{if(e.key==="Enter")btnLoad.click();});
  document.getElementById("btn-browse")?.addEventListener("click",openFsBrowser);

  async function openFsBrowser(){
    let cur=inputDir.value.trim()||"";const modal=document.createElement("div");modal.className="modal-overlay";
    modal.innerHTML=`<div class="modal-content"><div class="modal-header"><h3>Cartella DICOM</h3><button class="modal-close">&times;</button></div><div style="display:flex;gap:6px;margin-bottom:10px"><input type="text" id="fs-path" value="${cur}" style="flex:1"/><button class="btn btn-xs btn-primary" id="fs-go">Vai</button></div><div id="fs-entries" style="max-height:320px;overflow-y:auto;margin-bottom:10px"></div><div style="display:flex;justify-content:space-between;align-items:center"><span id="fs-info" style="font-size:10px;color:var(--text-muted)"></span><button id="fs-select" class="btn btn-primary btn-xs" disabled>Seleziona</button></div></div>`;
    document.body.appendChild(modal);modal.querySelector(".modal-close").onclick=()=>modal.remove();modal.addEventListener("click",e=>{if(e.target===modal)modal.remove();});
    const pI=modal.querySelector("#fs-path"),eD=modal.querySelector("#fs-entries"),sB=modal.querySelector("#fs-select"),iS=modal.querySelector("#fs-info");
    async function nav(p){try{const r=await API.browseFs(p);cur=r.current||"";pI.value=cur;sB.disabled=!cur;iS.textContent=r.dicom_file_count?`${r.dicom_file_count} DICOM`:"";let h="";if(r.parent!=null)h+=`<div class="fs-i" data-p="${r.parent}" style="padding:5px 8px;cursor:pointer;border-radius:3px;font-size:12px">📁 ..</div>`;for(const e of r.entries)if(e.is_dir)h+=`<div class="fs-i" data-p="${e.path}" style="padding:5px 8px;cursor:pointer;border-radius:3px;font-size:12px">📁 ${e.name}</div>`;eD.innerHTML=h;eD.querySelectorAll(".fs-i").forEach(el=>{el.ondblclick=()=>nav(el.dataset.p);el.onmouseenter=()=>el.style.background="var(--bg-hover)";el.onmouseleave=()=>el.style.background="";});}catch(e){eD.innerHTML=`<p style="color:var(--accent-red);font-size:12px">${e.message}</p>`;}}
    modal.querySelector("#fs-go").onclick=()=>nav(pI.value.trim());pI.onkeydown=e=>{if(e.key==="Enter")nav(pI.value.trim());};sB.onclick=()=>{inputDir.value=cur;btnLoad.disabled=false;modal.remove();};await nav(cur);
  }

  btnLoad.addEventListener("click",async()=>{const dir=inputDir.value.trim();if(!dir)return;localStorage.setItem("sphere_qc_input_dir",dir);UI.show("load-progress");UI.setStatus("Caricamento...");try{const resp=await API.loadDicom(dir);AppState.inputDir=dir;AppState.sequences=resp.sequences||[];AppState.activeSequenceUid=resp.active_sequence_uid||AppState.sequences[0]?.uid||"";AppState.activeAnalysisSequenceUid=AppState.activeSequenceUid;AppState.slices=resp.slices||[];AppState.resultsBySequence={};UI.hide("load-progress");try{AppState.dicomMeta=await API.getDicomMeta();}catch(e){}UI.setStatus(`${resp.n_total_slices||resp.n_slices} slice in ${AppState.sequences.length} sequenze`);setupStep2();UI.showStep(2);}catch(err){UI.hide("load-progress");UI.setStatus(`Err: ${err.message}`);alert(err.message);}});

  // ─── SERIES MODAL ───
  async function showSeriesModal(loadResp){
    const modal=document.createElement("div");modal.className="modal-overlay";
    const rows=loadResp.sequences.map(s=>`<tr class="series-row ${s.is_active?'active':''}" data-uid="${s.uid}"><td><b>${s.description||'—'}</b></td><td>${s.tr_ms?.toFixed(0)||"—"}</td><td>${s.te_ms?.toFixed(0)||"—"}</td><td>${s.n_slices}</td><td>${s.is_active?"✓":""}</td></tr>`).join("");
    modal.innerHTML=`<div class="modal-content"><div class="modal-header"><h3>Sequenze (${loadResp.sequences.length})</h3><button class="modal-close">&times;</button></div><p style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Totale ${loadResp.n_total_slices} slice</p><table class="series-table"><thead><tr><th>Descrizione</th><th>TR</th><th>TE</th><th>#</th><th></th></tr></thead><tbody>${rows}</tbody></table><div style="margin-top:10px;text-align:right"><button id="series-ok" class="btn btn-primary btn-xs">Carica</button></div></div>`;
    document.body.appendChild(modal);modal.querySelector(".modal-close").onclick=()=>{modal.remove();UI.setStatus("");};
    let selUid=loadResp.active_sequence_uid;
    modal.querySelectorAll(".series-row").forEach(r=>{r.onclick=()=>{modal.querySelectorAll(".series-row").forEach(x=>x.classList.remove("active"));r.classList.add("active");selUid=r.dataset.uid;};});
    modal.querySelector("#series-ok").onclick=async()=>{modal.remove();if(selUid!==AppState.activeSequenceUid){try{const r=await API.setActiveSequence(selUid);AppState.slices=r.slices;AppState.activeSequenceUid=selUid;try{AppState.dicomMeta=await API.getDicomMeta();}catch(e){}}catch(e){alert(e.message);}}UI.setStatus(`${AppState.slices.length} slice`);setupStep2();UI.showStep(2);};
  }
  document.getElementById("btn-change-series")?.addEventListener("click",()=>{if(AppState.sequences.length>1)showSeriesModal({sequences:AppState.sequences,n_total_slices:AppState.sequences.reduce((a,s)=>a+s.n_slices,0),active_sequence_uid:AppState.activeSequenceUid});});

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: SLICE SELECTION
  // ═══════════════════════════════════════════════════════════════════════════
  function sessionSelectionComplete(){return AppState.sequences.length>0&&AppState.sequences.every(s=>AppState.selectedSlicesBySequence[s.uid]!=null);}
  async function setupStep2(){
    const si=document.getElementById("series-info");
    if(si)si.textContent=`${AppState.sequences.length} sequenze caricate`;
    const wl=+document.getElementById("wl-val").value||null,ww=+document.getElementById("ww-val").value||null;
    try{const r=await API.getMultiThumbnails(wl,ww,GRID_SIZES[gridSize]);AppState.multiThumbnails=r.thumbnails||[];AppState.sequences=r.sequences||AppState.sequences;AppState.sequences.forEach(s=>{if(AppState.selectedSlicesBySequence[s.uid]==null)AppState.selectedSlicesBySequence[s.uid]=Math.floor((s.n_slices||1)/2);});setAnalysisSequence(currentAnalysisUid());updateT2Bar();renderSliceGrid();UI.setStatus("Seleziona una slice per sequenza");}catch(e){UI.setStatus(`Err: ${e.message}`);}
  }
  function renderSliceGrid(){
    renderSequenceSelectionSummary();
    const grid=document.getElementById("slice-grid");grid.style.setProperty("--grid-size",GRID_SIZES[gridSize]+"px");grid.innerHTML="";
    if(AppState.multiThumbnails?.length){
      AppState.multiThumbnails.forEach(t=>{const seq=AppState.sequences.find(s=>s.uid===t.uid)||{};const color=sequenceColor(t.uid);const c=document.createElement("div");c.className="slice-card multi-seq";c.style.setProperty("--seq-color",color);if(AppState.selectedSlicesBySequence[t.uid]===t.idx)c.classList.add("selected");
        c.innerHTML=`<img src="data:image/png;base64,${t.image}"/><div class="slice-info"><span>${seq.description||"Seq"}</span><span>#${t.idx}</span><span>TE=${t.te_ms||"?"}</span></div>${AppState.selectedSlicesBySequence[t.uid]===t.idx?'<span class="slice-tag">SEL</span>':""}`;
        c.addEventListener("click",()=>{AppState.selectedSlicesBySequence[t.uid]=t.idx;setAnalysisSequence(t.uid);document.getElementById("btn-confirm-slice").disabled=!sessionSelectionComplete();renderSliceGrid();updateT2Bar();});grid.appendChild(c);});
      document.getElementById("btn-confirm-slice").disabled=!sessionSelectionComplete();
      return;
    }
    AppState.thumbnails.forEach((t,i)=>{const c=document.createElement("div");c.className="slice-card";if(i===AppState.selectedSliceIdx)c.classList.add("selected");if(i===AppState.selectedT2SliceIdx)c.classList.add("selected-t2");
      c.innerHTML=`<img src="data:image/png;base64,${t.image}"/><div class="slice-info"><span>#${i}</span><span>z=${t.z}</span><span>TE=${t.te_ms||"?"}</span></div>${i===AppState.selectedSliceIdx?'<span class="slice-tag">★</span>':''}${i===AppState.selectedT2SliceIdx?'<span class="slice-tag t2">T2</span>':''}`;
      c.addEventListener("click",e=>{if(e.shiftKey){AppState.selectedT2SliceIdx=i;updateT2Bar();}else{AppState.selectedSliceIdx=i;}document.getElementById("btn-confirm-slice").disabled=AppState.selectedSliceIdx<0;renderSliceGrid();});grid.appendChild(c);});
  }
  function renderSequenceSelectionSummary(){
    const el=document.getElementById("sequence-selection-summary");if(!el)return;
    if(!AppState.sequences?.length){el.innerHTML="";return;}
    el.innerHTML=AppState.sequences.map(s=>{
      const selected=AppState.selectedSlicesBySequence[s.uid];
      const ready=selected!=null;
      return `<button type="button" class="sequence-chip ${ready?'ready':''} ${s.uid===currentAnalysisUid()?'active':''}" data-seq-chip="${s.uid}" style="--seq-color:${sequenceColor(s.uid)}"><span>${s.description||"Seq"}</span><b>#${ready?selected:"-"}</b><small>TR ${s.tr_ms?.toFixed?.(0)||"?"} / TE ${s.te_ms?.toFixed?.(0)||"?"}</small></button>`;
    }).join("");
    el.querySelectorAll("[data-seq-chip]").forEach(btn=>btn.addEventListener("click",()=>{setAnalysisSequence(btn.dataset.seqChip);renderSliceGrid();}));
  }
  function updateT2Bar(){if(AppState.selectedT2SliceIdx>=0){UI.show("t2-selection");const t1=AppState.thumbnails[AppState.selectedSliceIdx],t2=AppState.thumbnails[AppState.selectedT2SliceIdx];document.getElementById("t2-te1-info").textContent=t1?`#${AppState.selectedSliceIdx} TE=${t1.te_ms}ms`:"—";document.getElementById("t2-te2-info").textContent=t2?`#${AppState.selectedT2SliceIdx} TE=${t2.te_ms}ms`:"—";}else UI.hide("t2-selection");}
  const updateT2BarLegacy=updateT2Bar;
  updateT2Bar=function(){if(AppState.multiThumbnails?.length){UI.show("t2-selection");const parts=AppState.sequences.map(s=>`${s.description||"Seq"} #${AppState.selectedSlicesBySequence[s.uid]??"-"} TE=${s.te_ms||"?"}ms`);document.getElementById("t2-te1-info").textContent=parts.slice(0,2).join(" | ")||"-";document.getElementById("t2-te2-info").textContent=parts.slice(2).join(" | ")||"T2 auto su TE min/max";return;}updateT2BarLegacy();};
  document.getElementById("btn-refresh-thumbs")?.addEventListener("click",()=>setupStep2());
  document.getElementById("btn-wl-auto")?.addEventListener("click",()=>{document.getElementById("wl-val").value=0;document.getElementById("ww-val").value=0;setupStep2();});
  document.getElementById("btn-confirm-slice")?.addEventListener("click",()=>{if(AppState.multiThumbnails?.length){if(!sessionSelectionComplete())return;setAnalysisSequence(currentAnalysisUid());}else if(AppState.selectedSliceIdx<0)return;setupStep3();UI.showStep(3);});

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: INFO
  // ═══════════════════════════════════════════════════════════════════════════
  function setupStep3(){
    const d=document.getElementById("info-date");if(!d.value)d.value=new Date().toISOString().slice(0,10);
    if(AppState.dicomMeta){const m=AppState.dicomMeta;document.getElementById("dicom-meta-card").innerHTML=`<h3>DICOM</h3><div class="meta-grid">${[["Manufacturer",m.manufacturer],["Model",m.model],["Institution",m.institution],["Field",`${m.magnetic_field_T||"—"} T`],["TR/TE",`${m.tr_ms||"—"}/${m.te_ms||"—"} ms`],["Pixel",`${m.pixel_spacing_mm||"—"} mm`],["FOV",`${m.fov_mm||"—"} mm`],["Matrix",m.matrix_size],["Slices",m.n_slices],["Protocol",m.protocol]].map(([l,v])=>`<div class="meta-item"><span class="meta-label">${l}</span><span class="meta-value">${v||"—"}</span></div>`).join("")}</div>`;}
  }
  document.getElementById("btn-start-analysis")?.addEventListener("click",()=>{API.setMetaInfo({data_controllo:document.getElementById("info-date").value,tipo_controllo:document.getElementById("info-type").value,presidio:document.getElementById("info-presidio").value,sala:document.getElementById("info-sala").value,operatori:document.getElementById("info-operatori").value,note:document.getElementById("info-note").value}).catch(()=>{});setupStep4();UI.showStep(4);});

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════
  let activeTab="geometric",curZoom=1,curWL=0,curWW=0;
  let snrMethod="single_lr"; // single_lr | single_4corner

  function setupStep4(){
    const tb=document.getElementById("module-tabs");tb.innerHTML="";
    AppState.modules.forEach(mod=>{const btn=document.createElement("button");btn.className="tab-btn"+(mod===activeTab?" active":"");btn.innerHTML=AppState.moduleLabels[mod];const r=AppState.results[mod];if(r&&r.passed!=null)btn.innerHTML+=`<span class="dot ${r.passed?'pass':'fail'}"></span>`;btn.onclick=()=>{activeTab=mod;tb.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));btn.classList.add("active");renderModule(mod);};tb.appendChild(btn);});
    renderModule(activeTab);
  }

  function renderModule(mod){
    const content=document.getElementById("module-content"),r=AppState.results[mod];
    if(mod==="t2"){renderT2(content,r);return;}
    const seqSwitch=AppState.sequences.length>1?`<div class="sequence-switch">${AppState.sequences.map(s=>`<button class="btn btn-xs ${s.uid===currentAnalysisUid()?'btn-primary':'btn-secondary'}" data-seq="${s.uid}" style="border-left:4px solid ${sequenceColor(s.uid)}">${s.description||'Seq'} TE=${s.te_ms||'?'}</button>`).join("")}</div>`:"";

    // SNR method selector for snr tab
    const snrSel=mod==="snr"?`<select id="snr-method" style="font-size:11px;padding:3px 6px;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border);border-radius:3px"><option value="single_lr" ${snrMethod==="single_lr"?"selected":""}>LR (Left+Right)</option><option value="single_4corner" ${snrMethod==="single_4corner"?"selected":""}>4 Angoli</option><option value="single_4bg" ${snrMethod==="single_4bg"?"selected":""}>4 BG (PSG-style)</option></select>`:"";

    content.innerHTML=`${seqSwitch}<div class="module-layout"><div class="module-image-panel">
      <div class="canvas-controls">
        <button class="btn btn-primary btn-xs run-btn" id="btn-run">▶ Run</button><button class="btn btn-secondary btn-xs" id="btn-reset" title="Reset ROI alle posizioni automatiche">↺ Reset</button>${snrSel}
        <label>Zoom<input type="range" id="sl-zoom" min="0.5" max="3" step="0.1" value="${curZoom}"/></label>
        <label>WL<input type="range" id="sl-wl" min="-500" max="3000" step="10" value="${curWL}"/></label>
        <label>WW<input type="range" id="sl-ww" min="1" max="4000" step="10" value="${curWW}"/></label>
      </div>
      <div class="canvas-area" id="canvas-area"><img id="dcm-img" src="" style="transform:scale(${curZoom});transform-origin:top left"/><svg class="roi-overlay" id="roi-svg" xmlns="http://www.w3.org/2000/svg"></svg></div>
    </div><div class="module-results-panel" id="res-panel">${r?renderResults(mod,r):'<p style="color:var(--text-muted);font-size:11px">Premi ▶ Run</p>'}</div></div>`;

    loadImage();
    document.getElementById("sl-zoom")?.addEventListener("input",e=>{curZoom=+e.target.value;document.getElementById("dcm-img").style.transform=`scale(${curZoom})`;syncSvgSize();});
    document.getElementById("sl-wl")?.addEventListener("change",e=>{curWL=+e.target.value;loadImage();});
    document.getElementById("sl-ww")?.addEventListener("change",e=>{curWW=+e.target.value;loadImage();});
    document.getElementById("snr-method")?.addEventListener("change",e=>{snrMethod=e.target.value;});
    content.querySelectorAll("[data-seq]").forEach(btn=>{btn.addEventListener("click",()=>{setAnalysisSequence(btn.dataset.seq);renderModule(mod);setupStep4();});});
    document.getElementById("btn-run")?.addEventListener("click",()=>runAnalysis(mod));
    document.getElementById("btn-reset")?.addEventListener("click",()=>runAnalysisReset(mod));
    if(r)setTimeout(()=>drawROIs(mod,r),100);
  }

  async function loadImage(){
    const idx=AppState.selectedSliceIdx;if(idx<0)return;
    try{const uid=currentAnalysisUid();const r=AppState.multiThumbnails?.length?await API.getSequenceSliceImage(uid,idx,curWL||null,curWW||null,0):await API.getSliceImage(idx,curWL||null,curWW||null,0);const img=document.getElementById("dcm-img");if(img){img.src=`data:image/png;base64,${r.image}`;img.onload=syncSvgSize;}}catch(e){}
  }
  function syncSvgSize(){const img=document.getElementById("dcm-img"),svg=document.getElementById("roi-svg");if(!img||!svg||!img.naturalWidth)return;const w=img.naturalWidth*curZoom,h=img.naturalHeight*curZoom;svg.setAttribute("width",w);svg.setAttribute("height",h);svg.setAttribute("viewBox",`0 0 ${img.naturalWidth} ${img.naturalHeight}`);svg.style.width=w+"px";svg.style.height=h+"px";}

  // ═══════════════════════════════════════════════════════════════════════════
  // SVG ROI — PROPER DRAGGING (no innerHTML after appendChild)
  // ═══════════════════════════════════════════════════════════════════════════
  function svgEl(tag,attrs){const el=document.createElementNS("http://www.w3.org/2000/svg",tag);for(const[k,v] of Object.entries(attrs))el.setAttribute(k,String(v));return el;}
  function svgText(x,y,text,fill,anchor){const t=svgEl("text",{x,y,fill,"font-size":"9","font-weight":"600","pointer-events":"none","text-anchor":anchor||"start"});t.textContent=text;return t;}
  function svgPt(svg,e){const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;return p.matrixTransform(svg.getScreenCTM().inverse());}

  function makeDrag(el,type){
    el.style.cursor="move";
    el.setAttribute("data-draggable","true");
    el.addEventListener("mousedown",e=>{
      e.preventDefault();e.stopPropagation();
      const svg=el.ownerSVGElement;if(!svg)return;
      const start=svgPt(svg,e);
      let ox,oy,x1,y1,x2,y2;
      if(type==="rect"){ox=+el.getAttribute("x");oy=+el.getAttribute("y");}
      else if(type==="circle"){ox=+el.getAttribute("cx");oy=+el.getAttribute("cy");}
      else if(type==="line"){x1=+el.getAttribute("x1");y1=+el.getAttribute("y1");x2=+el.getAttribute("x2");y2=+el.getAttribute("y2");}

      function onMove(ev){
        const p=svgPt(svg,ev),dx=p.x-start.x,dy=p.y-start.y;
        if(type==="rect"){el.setAttribute("x",ox+dx);el.setAttribute("y",oy+dy);}
        else if(type==="circle"){el.setAttribute("cx",ox+dx);el.setAttribute("cy",oy+dy);}
        else if(type==="line"){el.setAttribute("x1",x1+dx);el.setAttribute("y1",y1+dy);el.setAttribute("x2",x2+dx);el.setAttribute("y2",y2+dy);}
      }
      function onUp(){document.removeEventListener("mousemove",onMove);document.removeEventListener("mouseup",onUp);reRunAfterDrag();}
      document.addEventListener("mousemove",onMove);
      document.addEventListener("mouseup",onUp);
    });
  }

  // Re-run analysis after ROI drag — ROIs stay where dragged, user presses Run
  function reRunAfterDrag(){ UI.setStatus("⚡ ROI modificata — premi ▶ Run per aggiornare i calcoli"); }

  function drawROIs(mod,r){
    const svg=document.getElementById("roi-svg");if(!svg)return;
    while(svg.firstChild)svg.removeChild(svg.firstChild);
    const cr=r.center_rc||[0,0],r0=r.radius_px||50;

    // Phantom outline — draggable for geometric, static for others
    const outline=svgEl("circle",{cx:cr[1],cy:cr[0],r:r0,stroke:"rgba(34,211,238,0.4)","stroke-dasharray":"4,3",fill:"none","stroke-width":1.2});
    if(mod==="geometric"){makeDrag(outline,"circle");} else {outline.setAttribute("pointer-events","none");}
    svg.appendChild(outline);

    if(mod==="geometric") drawGeoROIs(svg,r);
    else if(mod==="psg") drawPsgROIs(svg,r);
    else if(mod==="piu") drawPiuROIs(svg,r);
    else if(mod==="snr") drawSnrROIs(svg,r);
    else if(mod==="snru") drawSnruROIs(svg,r);
  }

  function drawGeoROIs(svg,r){
    const colors={horizontal:"#f97316",vertical:"#3b82f6",oblique_45:"#22c55e",oblique_135:"#a855f7"};
    const lc=r.line_coords||{};
    for(const[name,coords] of Object.entries(lc)){
      const c=colors[name]||"#fff",s=coords.start,e=coords.end;
      const ln=svgEl("line",{x1:s[1],y1:s[0],x2:e[1],y2:e[0],stroke:c,"stroke-width":2,"stroke-opacity":0.85});
      makeDrag(ln,"line");svg.appendChild(ln);
      const mx=(s[1]+e[1])/2,my=(s[0]+e[0])/2;
      const d_mm=r[`diameter_${name}_mm`]||0;
      svg.appendChild(svgText(mx+5,my-4,`${d_mm.toFixed(1)}mm`,c));
    }
  }

  function drawPsgROIs(svg,r){
    const cr=r.center_rc,ru=r.ufov_radius_px;
    svg.appendChild(svgEl("circle",{cx:cr[1],cy:cr[0],r:ru,stroke:"rgba(34,197,94,0.5)","stroke-dasharray":"3,2",fill:"none","stroke-width":1,"pointer-events":"none"}));
    const rois=r.rois||{},cols={up:"#60a5fa",down:"#60a5fa",left:"#fb923c",right:"#fb923c"};
    for(const[name,rd] of Object.entries(rois)){
      const rc=rd.rect;
      const el=svgEl("rect",{x:rc[1],y:rc[0],width:rc[3],height:rc[2],stroke:cols[name]||"#fff","stroke-opacity":0.8,fill:"none","stroke-width":1.5,rx:2,"data-roi":name});
      makeDrag(el,"rect");svg.appendChild(el);
      svg.appendChild(svgText(rc[1]+rc[3]/2,rc[0]+rc[2]/2+3,`${name[0].toUpperCase()} ${rd.mean.toFixed(0)}`,cols[name],"middle"));
    }
  }

  function drawPiuROIs(svg,r){
    const cr=r.center_rc,ru=r.ufov_radius_px,rm=r.mask_radius_px||5;
    svg.appendChild(svgEl("circle",{cx:cr[1],cy:cr[0],r:ru,stroke:"rgba(34,197,94,0.4)","stroke-dasharray":"3,2",fill:"none","stroke-width":1,"pointer-events":"none"}));
    const mx=r.max_position_rc||[0,0],mn=r.min_position_rc||[0,0];
    const mxC=svgEl("circle",{cx:mx[1],cy:mx[0],r:rm,stroke:"#ef4444","stroke-opacity":0.8,fill:"rgba(239,68,68,0.08)","stroke-width":1.5});makeDrag(mxC,"circle");svg.appendChild(mxC);
    svg.appendChild(svgText(mx[1],mx[0]-rm-3,`MAX ${r.s_max.toFixed(0)}`,"#ef4444","middle"));
    const mnC=svgEl("circle",{cx:mn[1],cy:mn[0],r:rm,stroke:"#3b82f6","stroke-opacity":0.8,fill:"rgba(59,130,246,0.08)","stroke-width":1.5});makeDrag(mnC,"circle");svg.appendChild(mnC);
    svg.appendChild(svgText(mn[1],mn[0]-rm-3,`MIN ${r.s_min.toFixed(0)}`,"#3b82f6","middle"));
  }

  function drawSnrROIs(svg,r){
    const cr=r.center_rc,ru=r.ufov_radius_px,r0=r.radius_px||50;
    // Signal ROI circle
    const c=svgEl("circle",{cx:cr[1],cy:cr[0],r:ru,stroke:"#eab308","stroke-opacity":0.7,fill:"rgba(234,179,8,0.04)","stroke-width":1.5});makeDrag(c,"circle");svg.appendChild(c);
    svg.appendChild(svgText(cr[1],cr[0]+4,`Signal SNR=${(r.snr||0).toFixed(1)}`,"#eab308","middle"));
    // Noise ROIs — visible rectangles
    const bgRois=r.bg_rois||{};
    const gap=Math.round(0.1*r0);
    if(Object.keys(bgRois).length>0){
      for(const[name,rd] of Object.entries(bgRois)){
        if(rd.rect){const rc=rd.rect;const el=svgEl("rect",{x:rc[1],y:rc[0],width:rc[3],height:rc[2],stroke:"#94a3b8","stroke-opacity":0.8,fill:"rgba(148,163,184,0.06)","stroke-width":1.3,rx:2,"stroke-dasharray":"4,2"});makeDrag(el,"rect");svg.appendChild(el);svg.appendChild(svgText(rc[1]+rc[3]/2,rc[0]-4,`noise ${name} σ=${rd.std.toFixed(1)}`,"#94a3b8","middle"));}
      }
    } else {
      // Fallback: draw approximate L/R noise boxes
      const rW=Math.max(15,Math.round(0.3*gap)+10),rH=Math.min(80,Math.round(0.8*r0));
      const rX=cr[1]+r0+gap,lX=Math.max(2,cr[1]-r0-gap-rW);
      const rEl=svgEl("rect",{x:rX,y:cr[0]-rH/2,width:rW,height:rH,stroke:"#94a3b8","stroke-opacity":0.7,fill:"rgba(148,163,184,0.05)","stroke-width":1.2,"stroke-dasharray":"4,2"});makeDrag(rEl,"rect");svg.appendChild(rEl);
      svg.appendChild(svgText(rX+rW/2,cr[0]-rH/2-4,`σR=${UI.fmt(r.noise_std_right,1)}`,"#94a3b8","middle"));
      const lEl=svgEl("rect",{x:lX,y:cr[0]-rH/2,width:rW,height:rH,stroke:"#94a3b8","stroke-opacity":0.7,fill:"rgba(148,163,184,0.05)","stroke-width":1.2,"stroke-dasharray":"4,2"});makeDrag(lEl,"rect");svg.appendChild(lEl);
      svg.appendChild(svgText(lX+rW/2,cr[0]-rH/2-4,`σL=${UI.fmt(r.noise_std_left,1)}`,"#94a3b8","middle"));
    }
  }

  function drawSnruROIs(svg,r){
    const rois=r.rois||[],rr=r.roi_radius_px||5;
    rois.forEach(roi=>{const rc=roi.center_rc;const c=svgEl("circle",{cx:rc[1],cy:rc[0],r:rr,stroke:"#06b6d4","stroke-opacity":0.7,fill:"rgba(6,182,212,0.04)","stroke-width":1.5});makeDrag(c,"circle");svg.appendChild(c);svg.appendChild(svgText(rc[1],rc[0]+rr+10,`${roi.name} ${roi.snr.toFixed(0)}`,"#06b6d4","middle"));});
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RUN ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════
  async function runAnalysis(mod){
    UI.setStatus(`${mod}...`);
    try{
      // Read current ROI positions from SVG to pass as kwargs
      const kwargs = collectRoiKwargs(mod);
      if(mod==="snr") kwargs.snr_method=snrMethod;
      const uid=currentAnalysisUid();
      const resp=AppState.multiThumbnails?.length?await API.analyzeSequence(uid,mod,AppState.selectedSliceIdx,kwargs):await API.analyze(mod,AppState.selectedSliceIdx,kwargs);
      AppState.results[mod]=resp.results;
      if(AppState.multiThumbnails?.length)AppState.resultsBySequence[uid]={...(AppState.resultsBySequence[uid]||{}),uid,slice_idx:AppState.selectedSliceIdx,meta:AppState.sequences.find(s=>s.uid===uid),results:{...(AppState.resultsBySequence[uid]?.results||{}),[mod]:resp.results}};
      renderModule(mod);setupStep4();UI.setStatus(`${AppState.moduleLabels[mod]} OK`);
      saveCurrentAcquisition(true).catch(()=>{});
    }catch(e){UI.setStatus(`Err: ${e.message}`);alert(e.message);}
  }

  // Reset: run analysis without custom kwargs (automatic ROI placement)
  async function runAnalysisReset(mod){
    UI.setStatus(`${mod} reset...`);
    try{
      const kwargs=mod==="snr"?{snr_method:snrMethod}:{};
      const uid=currentAnalysisUid();
      const resp=AppState.multiThumbnails?.length?await API.analyzeSequence(uid,mod,AppState.selectedSliceIdx,kwargs):await API.analyze(mod,AppState.selectedSliceIdx,kwargs);
      AppState.results[mod]=resp.results;
      if(AppState.multiThumbnails?.length)AppState.resultsBySequence[uid]={...(AppState.resultsBySequence[uid]||{}),uid,slice_idx:AppState.selectedSliceIdx,meta:AppState.sequences.find(s=>s.uid===uid),results:{...(AppState.resultsBySequence[uid]?.results||{}),[mod]:resp.results}};
      renderModule(mod);setupStep4();UI.setStatus(`${AppState.moduleLabels[mod]} reset OK`);
      saveCurrentAcquisition(true).catch(()=>{});
    }catch(e){UI.setStatus(`Err: ${e.message}`);alert(e.message);}
  }

  // Read current SVG ROI positions and build kwargs for backend
  function collectRoiKwargs(mod){
    const svg=document.getElementById("roi-svg");
    const kwargs={};
    if(!svg) return kwargs;

    if(mod==="psg"){
      const ghost_rois={};
      svg.querySelectorAll('rect[data-roi]').forEach(el=>{
        const name=el.getAttribute("data-roi");
        const y=Math.round(+el.getAttribute("y"));
        const x=Math.round(+el.getAttribute("x"));
        const h=Math.round(+el.getAttribute("height"));
        const w=Math.round(+el.getAttribute("width"));
        if(name&&h>0&&w>0) ghost_rois[name]=[y,x,h,w];
      });
      if(Object.keys(ghost_rois).length>0) kwargs.ghost_rois=ghost_rois;
    }

    if(mod==="snr"||mod==="snru"||mod==="piu"){
      // Find first draggable circle — this is the UFOV/signal circle
      const circles=svg.querySelectorAll('circle[data-draggable="true"]');
      if(circles.length>0){
        const c=circles[0];
        const cx=Math.round(+c.getAttribute("cx"));
        const cy=Math.round(+c.getAttribute("cy"));
        const r=Math.round(+c.getAttribute("r"));
        if(cx>0&&cy>0&&r>0){
          kwargs.center_rc=[cy,cx];
          // Don't pass radius_px — the signal circle is UFOV (75% of phantom)
          // Let backend auto-detect full phantom size from the image
          if(mod==="piu") kwargs.ufov_radius_px=r;
        }
      }
      // Also read noise ROI rects for SNR
      if(mod==="snr"){
        const ghost_rois={};
        svg.querySelectorAll('rect[data-draggable="true"]').forEach(el=>{
          // noise rects don't have data-roi, identify by position relative to center
          const y=Math.round(+el.getAttribute("y"));
          const x=Math.round(+el.getAttribute("x"));
          const h=Math.round(+el.getAttribute("height"));
          const w=Math.round(+el.getAttribute("width"));
          if(h>0&&w>0) ghost_rois[Object.keys(ghost_rois).length===0?"right":"left"]=[y,x,h,w];
        });
        if(Object.keys(ghost_rois).length>0) kwargs.ghost_rois=ghost_rois;
      }
    }

    if(mod==="geometric"){
      // Read any draggable circle (phantom outline if made draggable, or first circle)
      const circle=svg.querySelector('circle[data-draggable="true"]')||svg.querySelector('circle');
      if(circle){
        const cx=Math.round(+circle.getAttribute("cx"));
        const cy=Math.round(+circle.getAttribute("cy"));
        const r=Math.round(+circle.getAttribute("r"));
        if(cx>0&&cy>0&&r>0){
          kwargs.center_rc=[cy,cx];
          kwargs.radius_px=r;
        }
      }
    }

    return kwargs;
  }

  // ─── T2 TAB ───
  function renderT2(content,r){
    const seqs=AppState.sequences;
    const seqText=s=>String(`${s.description||""} ${s.protocol||""}`).toUpperCase();
    const seqTokens=s=>" "+seqText(s).replace(/[^A-Z0-9]+/g," ")+" ";
    const isSpinEcho=s=>{
      const text=seqText(s),tok=seqTokens(s);
      if(text.includes("T2*")||[" GRE "," GR "," SPGR "," FFE "," TFE "," FLASH "," FISP "," SSFP "," DESS "," EPI "," T2STAR "," T2 STAR "].some(x=>tok.includes(x))) return false;
      return [" SE "," FSE "," TSE "," CSE "," SPIN ECHO "].some(x=>tok.includes(x))||text.includes("SPIN ECHO");
    };
    const t2Seqs=seqs.filter(s=>s.te_ms>0&&isSpinEcho(s));
    const teVals=[...new Set(t2Seqs.map(s=>s.te_ms).filter(v=>v>0))].sort((a,b)=>a-b);
    const canAuto=teVals.length>=2;

    // Show available sequences for manual T2 selection
    let seqList='';
    if(seqs.length>=2){
      seqList=`<div style="margin:8px 0"><p style="font-size:11px;font-weight:600;margin-bottom:4px">Serie disponibili per T2:</p><table class="result-table" style="font-size:11px"><tr><th>Serie</th><th>TE</th><th>TR</th><th>#</th><th></th></tr>`;
      seqs.forEach((s,i)=>{
        const isCur=s.uid===AppState.activeSequenceUid;
        const se=isSpinEcho(s);
        seqList+=`<tr style="${isCur?'background:rgba(59,130,246,0.1)':''}"><td>${s.description||'—'}</td><td><b>${s.te_ms?.toFixed(0)||'?'}</b> ms</td><td>${s.tr_ms?.toFixed(0)||'?'}</td><td>${s.n_slices}</td><td>${se?'Spin Echo':'esclusa T2'} ${isCur?'★':''}</td></tr>`;
      });
      seqList+=`</table></div>`;
    }

    content.innerHTML=`<div class="module-layout"><div class="module-image-panel">
      <div class="canvas-controls">
        <button class="btn btn-primary btn-xs" id="btn-t2-auto" ${canAuto?"":"disabled"}>▶ T2 Auto</button>
        <button class="btn btn-secondary btn-xs" id="btn-t2-manual" ${AppState.selectedT2SliceIdx>=0?"":"disabled"}>▶ T2 Manuale</button>
      </div>
      ${canAuto?`<p style="font-size:12px;color:var(--accent-green);margin:8px 0">✓ Spin Echo rilevate: <b>${teVals.join(", ")}</b> ms — T2 auto disponibile</p>`:`<p style="font-size:12px;color:var(--text-muted);margin:8px 0">Servono 2+ serie Spin Echo con TE diversi per T2 auto.</p>`}
      ${seqList}
      ${AppState.selectedT2SliceIdx>=0?`<p style="font-size:11px;color:var(--accent-purple)">T2 manuale: slice #${AppState.selectedSliceIdx} vs #${AppState.selectedT2SliceIdx}</p>`:`<p style="font-size:11px;color:var(--text-muted)">Per T2 manuale: torna allo Step 2 e Shift+Click su una slice di altra serie.</p>`}
      ${r&&r.series1_description?`<p style="font-size:11px;color:var(--text-secondary);margin-top:6px">Usate: ${r.series1_description} (TE=${r.te1_ms}) vs ${r.series2_description} (TE=${r.te2_ms})</p>`:''}
    </div><div class="module-results-panel">
      ${r?`<div class="result-section"><h4 style="font-size:16px">T2${r.t2_ms!=null?' = <span style="font-size:20px;color:var(--accent-cyan)">'+r.t2_ms+'</span> ms':' — <span style="color:var(--accent-red)">errore</span>'}</h4>${r.error?'<p style="font-size:12px;color:var(--accent-red);margin:6px 0;line-height:1.4">'+r.error+'</p>':''}<table class="result-table" style="font-size:13px">
        <tr><td>TE₁</td><td class="value">${r.te1_ms||'–'} ms</td></tr><tr><td>TE₂</td><td class="value">${r.te2_ms||'–'} ms</td></tr>
        <tr><td>S₁ (TE₁)</td><td class="value">${UI.fmt(r.s1_mean)}</td></tr><tr><td>S₂ (TE₂)</td><td class="value">${UI.fmt(r.s2_mean)}</td></tr>
        <tr><td>S₁/S₂</td><td class="value">${UI.fmt(r.ratio_s1_s2,4)}</td></tr>
        <tr><td>Formula</td><td style="font-family:var(--font-mono);font-size:10px">T2 = (TE₂−TE₁) / ln(S₁/S₂)</td></tr></table></div>`:'<p style="color:var(--text-muted);font-size:13px">Premi ▶ T2 Auto per calcolare</p>'}
    </div></div>`;
    document.getElementById("btn-t2-auto")?.addEventListener("click",runT2Auto);
    document.getElementById("btn-t2-manual")?.addEventListener("click",runT2Manual);
  }

  async function runT2Auto(){
    UI.setStatus("T2 auto...");
    try{if(AppState.multiThumbnails?.length){const resp=await API.analyzeAllSequences(AppState.selectedSlicesBySequence,snrMethod);if(resp.results_by_sequence)AppState.resultsBySequence=resp.results_by_sequence;if(resp.t2)AppState.sessionT2=resp.t2;AppState.results.t2=AppState.sessionT2;renderModule("t2");setupStep4();UI.setStatus("T2 sessione OK");saveSessionAcquisition(true).catch(()=>{});return;}const r=await API.analyzeT2Auto(AppState.selectedSliceIdx);AppState.results["t2"]=r.results;renderModule("t2");setupStep4();UI.setStatus("T2 OK");saveCurrentAcquisition(true).catch(()=>{});}
    catch(e){UI.setStatus(`T2: ${e.message}`);alert("T2 auto fallito: "+e.message);}
  }
  async function runT2Manual(){
    if(AppState.selectedT2SliceIdx<0){alert("Shift+Click su una slice con TE diverso nello Step 2.");return;}
    UI.setStatus("T2 manuale...");
    try{const r=await API.analyzeT2(AppState.selectedSliceIdx,AppState.selectedT2SliceIdx);AppState.results["t2"]=r.results;renderModule("t2");setupStep4();UI.setStatus("T2 OK");saveCurrentAcquisition(true).catch(()=>{});}
    catch(e){UI.setStatus(`T2: ${e.message}`);alert(e.message);}
  }

  // Analyze All
  document.getElementById("btn-analyze-all")?.addEventListener("click",async()=>{
    UI.setStatus("Analisi completa...");
    try{if(AppState.multiThumbnails?.length){const resp=await API.analyzeAllSequences(AppState.selectedSlicesBySequence,snrMethod);AppState.resultsBySequence=resp.results_by_sequence||{};if(resp.t2)AppState.sessionT2=resp.t2;const uid=currentAnalysisUid();AppState.results=AppState.resultsBySequence[uid]?.results||{};if(AppState.sessionT2)AppState.results.t2=AppState.sessionT2;setupStep4();await saveSessionAcquisition(true);UI.setStatus("Sessione analizzata e salvata");return;}
      const resp=await API.analyzeAll(AppState.selectedSliceIdx);if(resp.results)for(const[m,r]of Object.entries(resp.results))AppState.results[m]=r;
      try{await runT2Auto();}catch(e){}
      setupStep4();await saveCurrentAcquisition(true);UI.setStatus("Completata e salvata");}catch(e){UI.setStatus(`Err: ${e.message}`);}
  });
  document.getElementById("btn-go-report")?.addEventListener("click",async()=>{try{if(AppState.multiThumbnails?.length)await saveSessionAcquisition(true);else await saveCurrentAcquisition(true);}catch(e){}if(AppState.multiThumbnails?.length)await setupTotalReport();else await setupStep5();UI.showStep(5);});

  // ═══════════════════════════════════════════════════════════════════════════
  // RESULTS RENDERING
  // ═══════════════════════════════════════════════════════════════════════════
  function renderResults(mod,r){
    if(!r)return'';let h='<div class="result-section">';
    if(mod==="geometric"){h+=`<h4>Geometria ${UI.passIcon(r.passed)}</h4><table class="result-table"><tr><th>Dir</th><th>∅ mm</th></tr><tr><td>H 0°</td><td class="value">${UI.fmt(r.diameter_horizontal_mm)}</td></tr><tr><td>V 90°</td><td class="value">${UI.fmt(r.diameter_vertical_mm)}</td></tr><tr><td>45°</td><td class="value">${UI.fmt(r.diameter_45_mm)}</td></tr><tr><td>135°</td><td class="value">${UI.fmt(r.diameter_135_mm)}</td></tr></table><table class="result-table" style="margin-top:6px"><tr><td>Media</td><td class="value">${UI.fmt(r.diameter_mean_mm)} mm</td></tr><tr><td>Distorsione</td><td class="value ${r.distortion_percent<=2?'pass':'fail'}">${UI.fmt(r.distortion_percent,3)}%</td></tr><tr><td>Err max</td><td class="value">${UI.fmt(r.max_error_mm)} mm</td></tr></table>`;}
    else if(mod==="piu"){h+=`<h4>PIU ${UI.passIcon(r.passed)}</h4><table class="result-table"><tr><td>PIU</td><td class="value ${r.passed?'pass':'fail'}">${UI.fmt(r.piu_percent)}%</td></tr><tr><td>Limite</td><td>≥ ${r.limit}%</td></tr><tr><td>S_max</td><td class="value">${UI.fmt(r.s_max)}</td></tr><tr><td>S_min</td><td class="value">${UI.fmt(r.s_min)}</td></tr></table>`;}
    else if(mod==="psg"){h+=`<h4>PSG ${UI.passIcon(r.passed)}</h4><table class="result-table"><tr><td>PSG</td><td class="value ${r.passed?'pass':'fail'}">${UI.fmt(r.psg_percent,4)}%</td></tr><tr><td>Limite</td><td>≤ ${r.limit}%</td></tr><tr><td>Signal</td><td class="value">${UI.fmt(r.signal_mean)}</td></tr><tr><td>Up</td><td class="value">${UI.fmt(r.s_up)}</td></tr><tr><td>Down</td><td class="value">${UI.fmt(r.s_down)}</td></tr><tr><td>Left</td><td class="value">${UI.fmt(r.s_left)}</td></tr><tr><td>Right</td><td class="value">${UI.fmt(r.s_right)}</td></tr></table>`;}
    else if(mod==="snr"){h+=`<h4>SNR</h4><table class="result-table"><tr><td>SNR</td><td class="value">${UI.fmt(r.snr)}</td></tr><tr><td>Metodo</td><td>${r.method||"single_lr"}</td></tr><tr><td>Signal</td><td class="value">${UI.fmt(r.signal_mean)}</td></tr><tr><td>σ L</td><td class="value">${UI.fmt(r.noise_std_left,4)}</td></tr><tr><td>σ R</td><td class="value">${UI.fmt(r.noise_std_right,4)}</td></tr><tr><td>σ mean</td><td class="value">${UI.fmt(r.noise_std_mean,4)}</td></tr></table>`;}
    else if(mod==="snru"){h+=`<h4>SNRU ${UI.passIcon(r.passed)}</h4><table class="result-table"><tr><td>SNRU</td><td class="value ${r.passed?'pass':'fail'}">${UI.fmt(r.snru_percent)}%</td></tr><tr><td>Limite</td><td>≥ ${r.limit}%</td></tr><tr><td>SNR max</td><td class="value">${UI.fmt(r.snr_max)}</td></tr><tr><td>SNR min</td><td class="value">${UI.fmt(r.snr_min)}</td></tr></table>`;if(r.rois?.length){h+=`<table class="result-table" style="margin-top:4px"><tr><th>ROI</th><th>Sig</th><th>SNR</th></tr>`;r.rois.forEach(x=>{h+=`<tr><td>${x.name}</td><td class="value">${UI.fmt(x.mean_signal)}</td><td class="value">${UI.fmt(x.snr)}</td></tr>`;});h+=`</table>`;}}
    h+='</div>';return h;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: REPORT & TREND
  // ═══════════════════════════════════════════════════════════════════════════
  function controlInfoFromForm(){
    return {
      data_controllo:document.getElementById("info-date")?.value||"",
      tipo_controllo:document.getElementById("info-type")?.value||"",
      presidio:document.getElementById("info-presidio")?.value||"",
      sala:document.getElementById("info-sala")?.value||"",
      operatori:document.getElementById("info-operatori")?.value||"",
      note:document.getElementById("info-note")?.value||""
    };
  }

  function studyDateIso(meta){
    const sd=meta?.study_date||"";
    if(/^\d{8}$/.test(sd)) return `${sd.substring(0,4)}-${sd.substring(4,6)}-${sd.substring(6,8)}`;
    return "";
  }

  function acquisitionKey(){
    const m=AppState.dicomMeta||{};
    const uid=currentAnalysisUid();
    const seq=AppState.sequences.find(s=>s.uid===uid)||{};
    return [
      AppState.inputDir||"",
      uid||"",
      m.study_date||"",
      seq.description||m.series_description||"",
      seq.description||m.protocol||"",
      seq.te_ms??m.te_ms??"",
      seq.tr_ms??m.tr_ms??"",
      AppState.selectedSliceIdx
    ].join("|");
  }

  function buildHistoryEntry(){
    const info=controlInfoFromForm();
    const m=AppState.dicomMeta||{};
    const uid=currentAnalysisUid();
    const seq=AppState.sequences.find(s=>s.uid===uid)||{};
    const date=info.data_controllo||studyDateIso(m)||new Date().toISOString().slice(0,10);
    return {
      date,
      analysis_date:date,
      study_date:studyDateIso(m),
      acquisition_id:acquisitionKey(),
      saved_at:new Date().toISOString(),
      phantom_type:AppState.phantomType,
      selected_slice_idx:AppState.selectedSliceIdx,
      input_dir:AppState.inputDir,
      active_sequence_uid:uid,
      meta:{...m,series_description:seq.description||m.series_description,protocol:seq.description||m.protocol,tr_ms:seq.tr_ms??m.tr_ms,te_ms:seq.te_ms??m.te_ms,n_slices:seq.n_slices??m.n_slices},
      control_info:info,
      results:AppState.results
    };
  }

  async function saveCurrentAcquisition(silent=false){
    const analyzed=Object.keys(AppState.results||{}).filter(k=>AppState.results[k]&&!AppState.results[k].error);
    if(analyzed.length===0) return null;
    const resp=await saveHistoryWithDuplicatePrompt(buildHistoryEntry());
    if(!silent&&resp?.success!==false) UI.setStatus("Salvato");
    return resp;
  }

  async function saveHistoryWithDuplicatePrompt(entry,promptState=null){
    let resp=await API.saveHistory(entry,false);
    if(resp?.duplicate){
      if(promptState&&promptState.overwrite===undefined){
        promptState.overwrite=window.confirm("La sessione contiene acquisizioni già presenti nello storico.\n\nVuoi sovrascrivere i dati esistenti della sessione?");
      }
      if(promptState&&promptState.overwrite===false){
        UI.setStatus("Salvataggio annullato: sessione già presente");
        return resp;
      }
      const label=entry?.meta?.series_description||entry?.meta?.protocol||"questa acquisizione";
      const ok=promptState?promptState.overwrite:window.confirm(`L'analisi di ${label} per questa data è già presente nello storico.\n\nVuoi sovrascrivere il dato esistente?`);
      if(!ok){
        UI.setStatus("Salvataggio annullato: analisi già presente");
        return resp;
      }
      resp=await API.saveHistory(entry,true);
    }
    return resp;
  }

  function buildSequenceHistoryEntry(seqData,idx,sessionId){
    const info=controlInfoFromForm();
    const base=AppState.dicomMeta||{};
    const seq=seqData.meta||AppState.sequences.find(s=>s.uid===seqData.uid)||{};
    const date=info.data_controllo||studyDateIso(base)||new Date().toISOString().slice(0,10);
    const results={...(seqData.results||{})};
    if(idx===0&&AppState.sessionT2&&!AppState.sessionT2.error) results.t2=AppState.sessionT2;
    return {
      date,
      analysis_date:date,
      study_date:studyDateIso(base),
      session_id:sessionId,
      acquisition_id:[sessionId,seqData.uid,seqData.slice_idx].join("|"),
      saved_at:new Date().toISOString(),
      phantom_type:AppState.phantomType,
      selected_slice_idx:seqData.slice_idx,
      input_dir:AppState.inputDir,
      active_sequence_uid:seqData.uid,
      meta:{...base,series_description:seq.description,protocol:seq.description||base.protocol,tr_ms:seq.tr_ms,te_ms:seq.te_ms,n_slices:seq.n_slices},
      control_info:info,
      results
    };
  }

  async function saveSessionAcquisition(silent=false){
    const items=Object.values(AppState.resultsBySequence||{}).filter(x=>x?.results&&Object.keys(x.results).length);
    if(!items.length) return null;
    const sessionId=[AppState.inputDir||"",controlInfoFromForm().data_controllo||"",new Date().toISOString().slice(0,10)].join("|");
    let last=null;
    const promptState={overwrite:undefined};
    for(let i=0;i<items.length;i++){
      last=await saveHistoryWithDuplicatePrompt(buildSequenceHistoryEntry(items[i],i,sessionId),promptState);
      if(last?.duplicate&&!promptState.overwrite) return last;
    }
    if(!silent&&last?.success!==false) UI.setStatus("Sessione salvata");
    return last;
  }

  function entryDate(e){
    return e?.analysis_date||e?.date||e?.study_date||"";
  }

  function acquisitionDate(e){
    const sd=e?.study_date||e?.meta?.study_date||"";
    if(/^\d{4}-\d{2}-\d{2}$/.test(sd)) return sd;
    if(/^\d{8}$/.test(sd)) return `${sd.substring(0,4)}-${sd.substring(4,6)}-${sd.substring(6,8)}`;
    return entryDate(e);
  }

  function displayDate(date){
    if(/^\d{4}-\d{2}-\d{2}$/.test(date)) return `${date.substring(8,10)}/${date.substring(5,7)}/${date.substring(0,4)}`;
    if(/^\d{8}$/.test(date)) return `${date.substring(6,8)}/${date.substring(4,6)}/${date.substring(0,4)}`;
    return date||"-";
  }

  function sameDayEntries(hist,date){
    return (hist||[]).filter(e=>entryDate(e)===date).sort((a,b)=>{
      const at=a.saved_at||a.acquisition_id||"";
      const bt=b.saved_at||b.acquisition_id||"";
      return at.localeCompare(bt);
    });
  }

  function metricValue(results,mod,key){
    const v=results?.[mod]?.[key];
    return typeof v==="number"?v:null;
  }

  function metricPass(results,mod){
    const r=results?.[mod];
    return r&&typeof r.passed==="boolean"?r.passed:null;
  }

  function resultLabel(e,idx){
    const m=e.meta||{};
    const desc=m.series_description||m.protocol||`Acquisizione ${idx+1}`;
    const te=m.te_ms!=null?` TE ${UI.fmt(m.te_ms,0)} ms`:"";
    return `${idx+1}. ${desc}${te}`;
  }

  function fmtMetric(v,d=2,u=""){
    return v==null?"-":`${UI.fmt(v,d)}${u}`;
  }

  function filenamePart(value,fallback="NA"){
    return String(value||fallback).trim().replace(/[^a-zA-Z0-9]+/g,"_").replace(/^_+|_+$/g,"").substring(0,40)||fallback;
  }

  const aggregateMetrics=[
    {label:"Distorsione %",mod:"geometric",key:"distortion_percent",dec:3,unit:" %",passMod:"geometric",lim:[{value:2,label:"2%",color:"#ef4444"}]},
    {label:"PIU %",mod:"piu",key:"piu_percent",dec:2,unit:" %",passMod:"piu",lim:[{value:87.5,label:"87.5%",color:"#22c55e"}]},
    {label:"PSG %",mod:"psg",key:"psg_percent",dec:4,unit:" %",passMod:"psg",lim:[{value:2.5,label:"2.5%",color:"#ef4444"}]},
    {label:"SNR",mod:"snr",key:"snr",dec:2,unit:"",passMod:null,lim:[]},
    {label:"SNRU %",mod:"snru",key:"snru_percent",dec:2,unit:" %",passMod:"snru",lim:[{value:90,label:"90%",color:"#22c55e"}]},
    {label:"T2 ms",mod:"t2",key:"t2_ms",dec:2,unit:" ms",passMod:null,lim:[]}
  ];

  const recommendedProtocols=[
    {name:"AX T2* GRE",tr:500,te:15,flip:"60",fov:"270",matrix:"256x160",averages:"1",slice:"5",scope:"Geometria, PIU, PSG, SNR, SNRU"},
    {name:"T1 SE",tr:500,te:30,flip:"90",fov:"270",matrix:"256x160",averages:"1",slice:"5",scope:"T2 Spin Echo (TE corto)"},
    {name:"T1 SE",tr:500,te:100,flip:"90",fov:"270",matrix:"256x160",averages:"1",slice:"5",scope:"T2 Spin Echo (TE lungo)"}
  ];

  function recommendedProtocolFor(meta){
    const desc=String(meta?.series_description||meta?.protocol||"").toUpperCase();
    const te=Number(meta?.te_ms);
    if(desc.includes("GRE")||desc.includes("T2*")) return recommendedProtocols[0];
    if(desc.includes("SE")||desc.includes("T1")){
      if(Number.isFinite(te)&&te>60) return recommendedProtocols[2];
      return recommendedProtocols[1];
    }
    if(Number.isFinite(te)){
      if(te<=20) return recommendedProtocols[0];
      if(te>60) return recommendedProtocols[2];
      return recommendedProtocols[1];
    }
    return null;
  }

  function protocolMinute(e,i){
    const m=e.meta||{};
    const rec=recommendedProtocolFor(m);
    const actual=`TR ${m.tr_ms??"-"} ms / TE ${m.te_ms??"-"} ms`;
    const recLine=rec?`${rec.name}: TR ${rec.tr} ms / TE ${rec.te} ms / Flip ${rec.flip} / FOV ${rec.fov} mm / Matrix ${rec.matrix} / NEX ${rec.averages} / Slice ${rec.slice} mm`:"Raccomandazione non trovata";
    return `<div class="report-metric protocol-minute">
      <span class="label">${resultLabel(e,i)}</span>
      <span class="value">${displayDate(acquisitionDate(e))}</span>
      <span class="label">Acquisito: ${actual}</span>
      <span class="label">Guida: ${recLine}</span>
      ${rec?`<span class="label">Scopo: ${rec.scope}</span>`:""}
    </div>`;
  }

  function sequenceKey(e){
    const m=e?.meta||{};
    return e?.active_sequence_uid||[
      m.series_instance_uid||"",
      m.series_description||m.protocol||"",
      m.tr_ms??"",
      m.te_ms??""
    ].join("|");
  }

  function sequenceTitle(e,idx){
    const m=e?.meta||{};
    const desc=m.series_description||m.protocol||`Sequenza ${idx+1}`;
    const tr=m.tr_ms!=null?`TR ${UI.fmt(m.tr_ms,0)} ms`:"";
    const te=m.te_ms!=null?`TE ${UI.fmt(m.te_ms,0)} ms`:"";
    return [desc,tr,te].filter(Boolean).join(" - ");
  }

  function sortedHistory(hist){
    return (hist||[]).slice().sort((a,b)=>{
      const ad=acquisitionDate(a)||entryDate(a)||"";
      const bd=acquisitionDate(b)||entryDate(b)||"";
      if(ad!==bd) return ad.localeCompare(bd);
      return (a.saved_at||"").localeCompare(b.saved_at||"");
    });
  }

  function historyForSequence(hist,seqEntry){
    const key=sequenceKey(seqEntry);
    const byDate=new Map();
    sortedHistory(hist).filter(e=>sequenceKey(e)===key).forEach(e=>{
      const date=acquisitionDate(e)||e.saved_at||"";
      byDate.set(date,e);
    });
    return Array.from(byDate.values());
  }

  function sameHistoryEntry(a,b){
    if(!a||!b) return false;
    if(a.acquisition_id&&b.acquisition_id) return a.acquisition_id===b.acquisition_id;
    if(a.saved_at&&b.saved_at) return a.saved_at===b.saved_at;
    return a===b;
  }

  function previousMetricValue(hist,entry,metric){
    const seqHist=historyForSequence(hist,entry);
    const idx=seqHist.findIndex(e=>sameHistoryEntry(e,entry));
    const end=idx>=0?idx:seqHist.length;
    for(let i=end-1;i>=0;i--){
      const v=metricValue(seqHist[i].results,metric.mod,metric.key);
      if(v!=null) return v;
    }
    return null;
  }

  function t2SessionKey(e){
    return acquisitionDate(e)||entryDate(e)||e?.study_date||e?.analysis_date||e?.date||"";
  }

  function t2TrendEntries(hist){
    const bySession=new Map();
    sortedHistory(hist).forEach(e=>{
      if(metricValue(e.results,"t2","t2_ms")==null) return;
      const key=t2SessionKey(e);
      if(!key) return;
      bySession.set(key,e);
    });
    return Array.from(bySession.values());
  }

  function t2EntryForSession(entries){
    return (entries||[]).slice().reverse().find(e=>metricValue(e.results,"t2","t2_ms")!=null)||null;
  }

  function previousT2Value(hist,entry){
    const t2Hist=t2TrendEntries(hist);
    const idx=t2Hist.findIndex(e=>sameHistoryEntry(e,entry)||t2SessionKey(e)===t2SessionKey(entry));
    const end=idx>=0?idx:t2Hist.length;
    for(let i=end-1;i>=0;i--){
      const v=metricValue(t2Hist[i].results,"t2","t2_ms");
      if(v!=null) return v;
    }
    return null;
  }

  function metricSequencePass(metric,entry,hist){
    if(metric.passMod) return metricPass(entry.results,metric.passMod);
    const value=metricValue(entry.results,metric.mod,metric.key);
    if(value==null) return null;
    if(metric.mod==="t2"){
      const prev=previousT2Value(hist,entry);
      if(prev==null) return null;
      return value>=prev*0.9;
    }
    if(metric.mod==="snr"){
      const prev=previousMetricValue(hist,entry,metric);
      if(prev==null) return null;
      return value>=prev*0.9;
    }
    return null;
  }

  function passText(pass){
    return pass===true?"PASS":pass===false?"FAIL":"-";
  }

  function piuLimitForEntry(entry){
    const explicit=Number(entry?.results?.piu?.limit);
    if(Number.isFinite(explicit)&&explicit>0) return explicit;
    const field=Number(entry?.meta?.magnetic_field_T ?? AppState.dicomMeta?.magnetic_field_T);
    return Number.isFinite(field)&&field>=3 ? 82 : 87.5;
  }

  function criteriaTextForMetric(metric,entry=null,hist=[]){
    if(metric.mod==="geometric") return "PASS se Distorsione <= 2% e Errore massimo <= 2 mm";
    if(metric.mod==="piu") return `PASS se PIU >= ${piuLimitForEntry(entry)}%`;
    if(metric.mod==="psg") return "PASS se PSG <= 2.5%";
    if(metric.mod==="snru") return "PASS se SNRU >= 90%";
    if(metric.mod==="snr"){
      const prev=entry?previousMetricValue(hist,entry,metric):null;
      return prev==null ? "Non valutabile senza misura precedente; parametro monitorato a trend" : `PASS se SNR >= 90% del precedente (${UI.fmt(prev,2)})`;
    }
    if(metric.mod==="t2"){
      const prev=entry?previousT2Value(hist,entry):null;
      return prev==null ? "Non valutabile senza T2 precedente; calcolo solo da due Spin Echo a TE diversi" : `PASS se T2 >= 90% del precedente (${UI.fmt(prev,2)} ms)`;
    }
    return "-";
  }

  function renderPassFailCriteriaCard(entries=[],hist=[]){
    const representative=(entries||[])[0]||null;
    const rows=[
      ["Distorsione Geometrica","Distorsione <= 2% e Errore massimo <= 2 mm","FAIL se una delle due condizioni non e' rispettata"],
      ["PIU",`PIU >= ${piuLimitForEntry(representative)}%`,"Soglia 87.5% sotto 3T; 82% a 3T o superiore"],
      ["PSG","PSG <= 2.5%","Limite ACR usato dal software"],
      ["SNR","SNR >= 90% della misura precedente della stessa sequenza","Se manca uno storico precedente: non valutabile"],
      ["SNRU","SNRU >= 90%","Valutazione su 5 ROI"],
      ["T2","T2 >= 90% del T2 precedente della sessione","Calcolato solo da due sequenze Spin Echo con TE diversi; se manca il precedente: non valutabile"],
    ];
    let html=`<div class="report-card"><h3>Criteri PASS/FAIL applicati</h3><table class="result-table" style="width:100%;font-size:12px"><thead><tr><th>Parametro</th><th>Criterio PASS</th><th>Nota</th></tr></thead><tbody>`;
    rows.forEach(r=>{html+=`<tr><td style="font-weight:700">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`;});
    html+=`</tbody></table></div>`;
    return html;
  }

  function latestDistinctSequences(entries,limit=3){
    const bySeq=new Map();
    (entries||[]).forEach(e=>{
      const key=sequenceKey(e);
      if(bySeq.has(key)) bySeq.delete(key);
      bySeq.set(key,e);
    });
    return Array.from(bySeq.values()).slice(-limit);
  }

  function trendContainerId(prefix,metricIndex,seqIndex){
    return `${prefix}-${metricIndex}-${seqIndex}`;
  }

  function renderSplitTrend(container,hist,sequenceEntries,opts={}){
    if(!container) return;
    const sequences=(sequenceEntries||[]).slice(0,3);
    if(!hist?.length||!sequences.length){
      container.innerHTML=`<div class="report-card"><h3>Trend</h3><p style="font-size:11px;color:var(--text-muted)">Salva almeno una misura per ogni sequenza.</p></div>`;
      return;
    }
    const prefix=opts.prefix||"trend";
    let h=`<div class="report-card"><h3>${opts.title||"Trend per sequenza"}</h3>`;
    aggregateMetrics.forEach((mt,mi)=>{
      if(mt.mod==="t2"){
        const t2Hist=t2TrendEntries(hist);
        if(!t2Hist.length) return;
        h+=`<div class="trend-parameter"><h4>${mt.label}</h4><div class="trend-single-panel"><div id="${trendContainerId(prefix,mi,0)}"></div></div></div>`;
        return;
      }
      const hasData=sequences.some(seq=>historyForSequence(hist,seq).some(e=>metricValue(e.results,mt.mod,mt.key)!=null));
      if(!hasData) return;
      h+=`<div class="trend-parameter"><h4>${mt.label}</h4><div class="trend-sequence-grid">`;
      sequences.forEach((seq,si)=>{
        h+=`<div class="trend-sequence-panel"><div id="${trendContainerId(prefix,mi,si)}"></div></div>`;
      });
      h+=`</div></div>`;
    });
    h+=`</div>`;
    container.innerHTML=h;

    aggregateMetrics.forEach((mt,mi)=>{
      if(mt.mod==="t2"){
        const t2Hist=t2TrendEntries(hist);
        const el=document.getElementById(trendContainerId(prefix,mi,0));
        if(!el||!t2Hist.length) return;
        SvgChart.line(el,{
          labels:t2Hist.map(e=>acquisitionDate(e)||"?"),
          datasets:[{label:mt.label,data:t2Hist.map(e=>metricValue(e.results,mt.mod,mt.key)),color:"#3b82f6"}],
          title:"T2 - combinazione sequenze Spin Echo",
          limits:mt.lim,
          height:210
        });
        return;
      }
      sequences.forEach((seq,si)=>{
        const seqHist=historyForSequence(hist,seq);
        const data=seqHist.map(e=>metricValue(e.results,mt.mod,mt.key));
        if(data.every(v=>v==null)) return;
        const el=document.getElementById(trendContainerId(prefix,mi,si));
        if(!el) return;
        SvgChart.line(el,{
          labels:seqHist.map(e=>acquisitionDate(e)||"?"),
          datasets:[{label:mt.label,data,color:"#3b82f6"}],
          title:sequenceTitle(seq,si),
          limits:mt.lim,
          height:210
        });
      });
    });
  }

  async function setupTotalReport(){
    const c=document.getElementById("report-container");
    const tc=document.getElementById("trend-container");
    const date=document.getElementById("info-date")?.value||new Date().toISOString().slice(0,10);
    try{if(AppState.multiThumbnails?.length)await saveSessionAcquisition(true);else await saveCurrentAcquisition(true);}catch(e){}
    let hist=[];
    let sessions=[];
    try{
      const historyResp=await API.getHistory();
      hist=historyResp.history||[];
      sessions=historyResp.sessions||[];
    }catch(e){}
    const entries=sameDayEntries(hist,date);
    if(entries.length===0){
      c.innerHTML=`<div class="report-card"><h3>Report CQ totale</h3><p style="font-size:14px;color:var(--text-muted)">Nessuna acquisizione salvata per ${date}.</p></div>`;
      await loadTrend();
      return;
    }
    const shown=latestDistinctSequences(entries,3);
    const session=sessions.find(s=>s.date===date);
    const sequenceCount=session?.sequence_count ?? shown.length;
    const first=shown[0]||{};
    const m=first.meta||AppState.dicomMeta||{};
    let h=`<div class="report-card"><h3>Report CQ totale - ${date}</h3><div class="report-grid">
      <div class="report-metric"><span class="label">Sequenze sessione</span><span class="value">${sequenceCount}/3</span></div>
      <div class="report-metric"><span class="label">Sede</span><span class="value">${m.institution||first.control_info?.presidio||"-"}</span></div>
      <div class="report-metric"><span class="label">Scanner</span><span class="value">${((m.manufacturer||"")+" "+(m.model||"")).trim()||"-"}</span></div>
      <div class="report-metric"><span class="label">Campo</span><span class="value">${m.magnetic_field_T||"-"} T</span></div>
    </div>${sequenceCount<3?`<p style="font-size:12px;color:var(--text-muted);margin-top:10px">Attenzione: trovate ${sequenceCount} sequenze salvate per questa data; una sessione CQ completa ne richiede almeno 3.</p>`:""}</div>`;

    h+=renderPassFailCriteriaCard(shown,hist);

    h+=`<div class="report-card"><h3>Riepilogo tre acquisizioni</h3><table class="result-table" style="width:100%;font-size:13px"><thead><tr><th>Parametro</th>`;
    shown.forEach((e,i)=>{h+=`<th>${resultLabel(e,i)}</th>`;});
    h+=`</tr></thead><tbody>`;
    aggregateMetrics.forEach(mt=>{
      if(mt.mod==="t2"){
        const t2Entry=t2EntryForSession(entries);
        const t2Val=metricValue(t2Entry?.results,mt.mod,mt.key);
        const pass=t2Entry?metricSequencePass(mt,t2Entry,hist):null;
        h+=`<tr><td style="padding:8px;font-weight:600">${mt.label}</td><td class="${pass===true?'pass':pass===false?'fail':''}" colspan="${shown.length}" style="padding:8px"><span class="value">${fmtMetric(t2Val,mt.dec,mt.unit)}</span><br><span style="font-size:11px;font-weight:700">Misura unica della sessione - ${passText(pass)}</span></td></tr>`;
        return;
      }
      const vals=shown.map(e=>metricValue(e.results,mt.mod,mt.key));
      const passes=shown.map(e=>metricSequencePass(mt,e,hist));
      h+=`<tr><td style="padding:8px;font-weight:600">${mt.label}</td>`;
      vals.forEach((v,i)=>{
        const pass=passes[i];
        h+=`<td class="${pass===true?'pass':pass===false?'fail':''}" style="padding:8px"><span class="value">${fmtMetric(v,mt.dec,mt.unit)}</span><br><span style="font-size:11px;font-weight:700">${passText(pass)}</span></td>`;
      });
      h+=`</tr>`;
    });
    h+=`</tbody></table></div>`;

    h+=`<div class="report-card"><h3>Minuta protocollo acquisizione</h3><div class="report-grid protocol-grid">`;
    shown.forEach((e,i)=>{h+=protocolMinute(e,i);});
    h+=`</div></div>`;
    c.innerHTML=h;
    renderSplitTrend(tc,hist,shown,{title:"Trend parametri per sequenza",prefix:"total-trend"});
    const site=filenamePart(m.institution||first.control_info?.presidio,"Presidio");
    const machine=filenamePart([m.manufacturer,m.model].filter(Boolean).join("_"),"Macchina");
    document.title=`CQ_totale_${site}_${machine}_${date.replace(/-/g,"")}`;
  }

  async function setupStep5(){
    if(AppState.multiThumbnails?.length){
      await setupTotalReport();
      return;
    }
    const c=document.getElementById("report-container"),R=AppState.results,m=AppState.dicomMeta||{};

    // Load history for SNR/T2 trend comparison
    let prevSnr=null, prevT2=null;
    try{
      const hist=(await API.getHistory()).history||[];
      if(hist.length>0){
        const last=hist[hist.length-1].results||{};
        prevSnr=last.snr?.snr ?? null;
        prevT2=last.t2?.t2_ms ?? null;
      }
    }catch(e){}

    // SNR/T2 pass logic: PASS if >= previous, FAIL if dropped >10%
    function snrPass(r){
      if(!r||r.snr==null) return null;
      if(prevSnr==null) return null; // no history, can't judge
      if(r.snr >= prevSnr) return true;
      if(r.snr < prevSnr*0.9) return false; // >10% drop = FAIL
      return true; // drop < 10% = still OK
    }
    function t2Pass(r){
      if(!r||r.t2_ms==null) return null;
      if(prevT2==null) return null;
      if(r.t2_ms >= prevT2) return true;
      if(r.t2_ms < prevT2*0.9) return false; // >10% drop = FAIL
      return true;
    }

    // Count analyzed modules
    const analyzed=Object.keys(R).filter(k=>R[k]&&!R[k].error);
    if(analyzed.length===0){
      c.innerHTML=`<div class="report-card"><h3>Nessun risultato</h3><p style="font-size:14px;color:var(--text-muted)">Esegui almeno un'analisi nello Step 4 prima di visualizzare il report.</p></div>`;
      return;
    }

    let h=`<div class="report-card"><h3>QC ${AppState.phantomType==="acr"?"ACR":"Sfera"} — ${m.institution||document.getElementById("info-presidio")?.value||""} — ${m.magnetic_field_T||"?"} T — ${(m.manufacturer||"")+" "+(m.model||"")}</h3><div class="report-grid"><div class="report-metric"><span class="label">Data Analisi</span><span class="value">${document.getElementById("info-date")?.value||"—"}</span></div><div class="report-metric"><span class="label">Data Acquisizione</span><span class="value">${m.study_date?m.study_date.substring(6,8)+"/"+m.study_date.substring(4,6)+"/"+m.study_date.substring(0,4):"—"}</span></div><div class="report-metric"><span class="label">Scanner</span><span class="value">${(m.manufacturer||"")+" "+(m.model||"")}</span></div><div class="report-metric"><span class="label">Sede</span><span class="value">${m.institution||document.getElementById("info-presidio")?.value||"—"}</span></div><div class="report-metric"><span class="label">Campo</span><span class="value">${m.magnetic_field_T||"—"} T</span></div><div class="report-metric"><span class="label">Protocollo</span><span class="value">${m.protocol||"—"}</span></div><div class="report-metric"><span class="label">Operatori</span><span class="value">${document.getElementById("info-operatori")?.value||"—"}</span></div></div></div>`;

    h+=renderPassFailCriteriaCard([{results:R,meta:m}],[]);

    // Summary table — ALL parameters
    const P=[
      {l:"Distorsione Geometrica",mod:"geometric",k:"distortion_percent",u:"%",lim:"<= 2% e errore <= 2 mm",gp:r=>r?.passed},
      {l:"Uniformità (PIU)",mod:"piu",k:"piu_percent",u:"%",lim:()=>`>= ${R.piu?.limit||piuLimitForEntry({results:R,meta:m})}%`,gp:r=>r?.passed},
      {l:"Ghosting (PSG)",mod:"psg",k:"psg_percent",u:"%",lim:"<= 2.5%",gp:r=>r?.passed},
      {l:"SNR",mod:"snr",k:"snr",u:"",lim:prevSnr!=null?`prev: ${prevSnr.toFixed(1)}`:"— (trend)",gp:r=>snrPass(r)},
      {l:"Uniformità SNR (SNRU)",mod:"snru",k:"snru_percent",u:"%",lim:">= 90%",gp:r=>r?.passed},
      {l:"T2",mod:"t2",k:"t2_ms",u:"ms",lim:prevT2!=null?`prev: ${prevT2.toFixed(1)}`:"— (trend)",gp:r=>t2Pass(r)},
    ];
    h+=`<div class="report-card"><h3>Riepilogo Risultati</h3>`;
    if(prevSnr!=null||prevT2!=null) h+=`<p style="font-size:11px;color:var(--text-secondary);margin-bottom:8px">SNR e T2 valutati rispetto alla misura precedente: PASS se il valore resta almeno al 90% del precedente.</p>`;
    h+=`<table class="result-table" style="width:100%;font-size:14px"><thead><tr><th style="padding:8px">Parametro</th><th style="padding:8px">Valore</th><th style="padding:8px">Riferimento</th><th style="padding:8px">Esito</th></tr></thead><tbody>`;
    P.forEach(p=>{
      const r=R[p.mod],v=r?r[p.k]:null,pa=p.gp(r);
      const valStr=v!=null?(typeof v==='number'?v.toFixed(2):v)+" "+p.u:"— (non analizzato)";
      const refStr=typeof p.lim==="function"?p.lim(r):p.lim;
      const cls=pa===true?'pass':pa===false?'fail':'';
      const esitoStr=pa===true?"✓ PASS":pa===false?"✗ FAIL":"—";
      h+=`<tr><td style="padding:8px;font-weight:500">${p.l}</td><td class="value" style="padding:8px;font-size:15px">${valStr}</td><td style="padding:8px">${refStr}</td><td class="${cls}" style="padding:8px;font-size:14px;font-weight:700">${esitoStr}</td></tr>`;
    });
    h+=`</tbody></table></div>`;

    // Detail cards for each analyzed module
    if(R.geometric&&!R.geometric.error){const g=R.geometric;
      h+=`<div class="report-card"><h3>Geometria — Dettaglio</h3><div class="report-grid">
        <div class="report-metric"><span class="label">∅ Orizzontale</span><span class="value">${UI.fmt(g.diameter_horizontal_mm)} mm</span></div>
        <div class="report-metric"><span class="label">∅ Verticale</span><span class="value">${UI.fmt(g.diameter_vertical_mm)} mm</span></div>
        <div class="report-metric"><span class="label">∅ 45°</span><span class="value">${UI.fmt(g.diameter_45_mm)} mm</span></div>
        <div class="report-metric"><span class="label">∅ 135°</span><span class="value">${UI.fmt(g.diameter_135_mm)} mm</span></div>
        <div class="report-metric ${g.passed?'pass':'fail'}"><span class="label">Distorsione</span><span class="value">${UI.fmt(g.distortion_percent,3)} %</span></div>
        <div class="report-metric"><span class="label">∅ Medio</span><span class="value">${UI.fmt(g.diameter_mean_mm)} mm</span></div>
      </div></div>`;
    }
    if(R.piu&&!R.piu.error){const p=R.piu;
      h+=`<div class="report-card"><h3>PIU — Dettaglio</h3><div class="report-grid">
        <div class="report-metric ${p.passed?'pass':'fail'}"><span class="label">PIU</span><span class="value">${UI.fmt(p.piu_percent)} %</span></div>
        <div class="report-metric"><span class="label">S_max</span><span class="value">${UI.fmt(p.s_max)}</span></div>
        <div class="report-metric"><span class="label">S_min</span><span class="value">${UI.fmt(p.s_min)}</span></div>
        <div class="report-metric"><span class="label">Limite</span><span class="value">≥ ${p.limit} %</span></div>
      </div></div>`;
    }
    if(R.psg&&!R.psg.error){const p=R.psg;
      h+=`<div class="report-card"><h3>PSG — Dettaglio</h3><div class="report-grid">
        <div class="report-metric ${p.passed?'pass':'fail'}"><span class="label">PSG</span><span class="value">${UI.fmt(p.psg_percent,4)} %</span></div>
        <div class="report-metric"><span class="label">Signal</span><span class="value">${UI.fmt(p.signal_mean)}</span></div>
        <div class="report-metric"><span class="label">Up</span><span class="value">${UI.fmt(p.s_up)}</span></div>
        <div class="report-metric"><span class="label">Down</span><span class="value">${UI.fmt(p.s_down)}</span></div>
        <div class="report-metric"><span class="label">Left</span><span class="value">${UI.fmt(p.s_left)}</span></div>
        <div class="report-metric"><span class="label">Right</span><span class="value">${UI.fmt(p.s_right)}</span></div>
      </div></div>`;
    }
    if(R.snr&&!R.snr.error){const s=R.snr;
      h+=`<div class="report-card"><h3>SNR — Dettaglio</h3><div class="report-grid">
        <div class="report-metric"><span class="label">SNR</span><span class="value">${UI.fmt(s.snr)}</span></div>
        <div class="report-metric"><span class="label">Metodo</span><span class="value">${s.method||"single_lr"}</span></div>
        <div class="report-metric"><span class="label">Signal</span><span class="value">${UI.fmt(s.signal_mean)}</span></div>
        <div class="report-metric"><span class="label">Noise σ</span><span class="value">${UI.fmt(s.noise_std_mean,4)}</span></div>
      </div></div>`;
    }
    if(R.snru&&!R.snru.error){const s=R.snru;
      h+=`<div class="report-card"><h3>SNRU — Dettaglio</h3><div class="report-grid">
        <div class="report-metric ${s.passed?'pass':'fail'}"><span class="label">SNRU</span><span class="value">${UI.fmt(s.snru_percent)} %</span></div>
        <div class="report-metric"><span class="label">SNR max</span><span class="value">${UI.fmt(s.snr_max)}</span></div>
        <div class="report-metric"><span class="label">SNR min</span><span class="value">${UI.fmt(s.snr_min)}</span></div>
      </div></div>`;
    }
    if(R.t2&&!R.t2.error&&R.t2.t2_ms!=null){const t=R.t2;
      h+=`<div class="report-card"><h3>T2 — Dettaglio</h3><div class="report-grid">
        <div class="report-metric"><span class="label">T2</span><span class="value">${t.t2_ms} ms</span></div>
        <div class="report-metric"><span class="label">TE₁</span><span class="value">${t.te1_ms} ms</span></div>
        <div class="report-metric"><span class="label">TE₂</span><span class="value">${t.te2_ms} ms</span></div>
        <div class="report-metric"><span class="label">S₁/S₂</span><span class="value">${UI.fmt(t.ratio_s1_s2,4)}</span></div>
      </div></div>`;
    }

    // Global PASS/FAIL
    const passResults=P.filter(p=>p.gp(R[p.mod])!=null);
    const allPass=passResults.length>0&&passResults.every(p=>p.gp(R[p.mod])===true);
    const anyFail=passResults.some(p=>p.gp(R[p.mod])===false);
    const globalVerdict=anyFail?"FAIL":(allPass?"PASS":"PARZIALE");
    const verdictColor=anyFail?"var(--accent-red)":(allPass?"var(--accent-green)":"#eab308");
    h+=`<div class="report-card" style="border-left:4px solid ${verdictColor}"><h3>Esito Globale</h3>
      <p style="font-size:22px;font-weight:800;color:${verdictColor};margin:8px 0">${globalVerdict}</p>
      <p style="font-size:13px;color:var(--text-secondary)">${allPass?"Tutti i parametri entro i limiti di accettabilità.":anyFail?"Uno o più parametri fuori limite.":"Analisi parziale — non tutti i parametri sono stati valutati."}</p>
    </div>`;

    // Signature section
    const dataAcq=m.study_date?`${m.study_date.substring(6,8)}/${m.study_date.substring(4,6)}/${m.study_date.substring(0,4)}`:(document.getElementById("info-date")?.value||"—");
    h+=`<div class="report-card">
      <h3>Informazioni Acquisizione</h3>
      <div class="report-grid">
        <div class="report-metric"><span class="label">Data acquisizione DICOM</span><span class="value">${dataAcq}</span></div>
        <div class="report-metric"><span class="label">Data analisi</span><span class="value">${document.getElementById("info-date")?.value||"—"}</span></div>
        <div class="report-metric"><span class="label">Tipo controllo</span><span class="value">${document.getElementById("info-type")?.value||"—"}</span></div>
        <div class="report-metric"><span class="label">Note</span><span class="value">${document.getElementById("info-note")?.value||"—"}</span></div>
      </div>
    </div>`;

    h+=`<div class="report-card">
      <h3>Firma</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:12px">
        <div style="border-top:1px solid var(--border);padding-top:10px">
          <p style="font-size:12px;color:var(--text-muted)">TSRM / Operatore</p>
          <p style="font-size:14px;font-weight:600;min-height:30px">${document.getElementById("info-operatori")?.value||"________________"}</p>
          <p style="font-size:11px;color:var(--text-muted)">Data: ${document.getElementById("info-date")?.value||"__/__/____"}</p>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:10px">
          <p style="font-size:12px;color:var(--text-muted)">Esperto Responsabile / Fisico Medico</p>
          <p style="font-size:14px;font-weight:600;min-height:30px">________________</p>
          <p style="font-size:11px;color:var(--text-muted)">Data: __/__/____</p>
        </div>
      </div>
    </div>`;

    c.innerHTML=h;

    // Set page title for PDF naming: "QC_YYYYMMDD_Sito_CampoT_Vendor"
    const site=(m.institution||document.getElementById("info-presidio")?.value||"Site").replace(/[^a-zA-Z0-9]/g,"_").substring(0,20);
    const vendor=(m.manufacturer||"").replace(/[^a-zA-Z0-9]/g,"").substring(0,15);
    const dateStr=(m.study_date||document.getElementById("info-date")?.value?.replace(/-/g,"")||"");
    const fieldStr=(m.magnetic_field_T||"")+"T";
    document.title=`QC_${dateStr}_${site}_${fieldStr}_${vendor}`;

    loadTrend();
  }

  async function loadTrend(){
    const tc=document.getElementById("trend-container");
    try{const resp=await API.getHistory();const hist=resp.history||[];
      if(hist.length<2){tc.innerHTML=`<div class="report-card"><h3>Trend</h3><p style="font-size:11px;color:var(--text-muted)">Salva almeno 2 misure per il trend.</p></div>`;return;}
      const byKey=new Map();
      sortedHistory(hist).forEach(e=>byKey.set(sequenceKey(e),e));
      const sequences=Array.from(byKey.values()).slice(-3);
      renderSplitTrend(tc,hist,sequences,{title:`Trend per sequenza (${hist.length})`,prefix:"trend"});
    }catch(e){tc.innerHTML=`<div class="report-card"><h3>Trend</h3><p style="color:var(--text-muted)">Errore</p></div>`;}
  }

  async function printCompactReport(){
    const report=document.getElementById("report-container");
    if(!report?.innerHTML.trim()){
      if(AppState.multiThumbnails?.length) await setupTotalReport();
      else await setupStep5();
    }
    UI.showStep(5);
    document.body.classList.add("print-compact-report");
    UI.setStatus("Preparazione stampa compatta...");
    const cleanup=()=>{
      document.body.classList.remove("print-compact-report");
      UI.setStatus("Pronto");
      window.removeEventListener("afterprint",cleanup);
    };
    window.addEventListener("afterprint",cleanup);
    setTimeout(()=>{
      window.print();
      setTimeout(cleanup,1200);
    },150);
  }

  document.getElementById("btn-save-history")?.addEventListener("click",async()=>{try{await saveCurrentAcquisition(false);loadTrend();}catch(e){UI.setStatus(`Err: ${e.message}`);}});
  document.getElementById("btn-total-report")?.addEventListener("click",async()=>{await setupTotalReport();UI.showStep(5);});
  document.getElementById("btn-print")?.addEventListener("click",printCompactReport);

})();

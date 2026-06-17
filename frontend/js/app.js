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
    if(document.getElementById("btn-total-report")) return;
    const printBtn=document.getElementById("btn-print");
    if(!printBtn||!printBtn.parentElement) return;
    const btn=document.createElement("button");
    btn.id="btn-total-report";
    btn.className="btn btn-xs btn-secondary";
    btn.textContent="Report CQ totale";
    printBtn.parentElement.insertBefore(btn,printBtn);
  }

  // ─── GRID SIZE ───
  const GRID_SIZES={S:80,M:120,L:180,XL:260};let gridSize="M";
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

  btnLoad.addEventListener("click",async()=>{const dir=inputDir.value.trim();if(!dir)return;localStorage.setItem("sphere_qc_input_dir",dir);UI.show("load-progress");UI.setStatus("Caricamento...");try{const resp=await API.loadDicom(dir);AppState.inputDir=dir;AppState.sequences=resp.sequences||[];AppState.activeSequenceUid=resp.active_sequence_uid||"";AppState.slices=resp.slices||[];UI.hide("load-progress");try{AppState.dicomMeta=await API.getDicomMeta();}catch(e){}if(AppState.sequences.length>1){await showSeriesModal(resp);}else{UI.setStatus(`${resp.n_slices} slice`);setupStep2();UI.showStep(2);}}catch(err){UI.hide("load-progress");UI.setStatus(`Err: ${err.message}`);alert(err.message);}});

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
  async function setupStep2(){
    const si=document.getElementById("series-info"),act=AppState.sequences.find(s=>s.uid===AppState.activeSequenceUid);
    if(act)si.textContent=`${act.description||"Seq"} TR=${act.tr_ms?.toFixed(0)} TE=${act.te_ms?.toFixed(0)}`;
    const wl=+document.getElementById("wl-val").value||null,ww=+document.getElementById("ww-val").value||null;
    try{const r=await API.getThumbnails(wl,ww,GRID_SIZES[gridSize]);AppState.thumbnails=r.thumbnails;renderSliceGrid();UI.setStatus("Seleziona slice");}catch(e){UI.setStatus(`Err: ${e.message}`);}
  }
  function renderSliceGrid(){
    const grid=document.getElementById("slice-grid");grid.style.setProperty("--grid-size",GRID_SIZES[gridSize]+"px");grid.innerHTML="";
    AppState.thumbnails.forEach((t,i)=>{const c=document.createElement("div");c.className="slice-card";if(i===AppState.selectedSliceIdx)c.classList.add("selected");if(i===AppState.selectedT2SliceIdx)c.classList.add("selected-t2");
      c.innerHTML=`<img src="data:image/png;base64,${t.image}"/><div class="slice-info"><span>#${i}</span><span>z=${t.z}</span><span>TE=${t.te_ms||"?"}</span></div>${i===AppState.selectedSliceIdx?'<span class="slice-tag">★</span>':''}${i===AppState.selectedT2SliceIdx?'<span class="slice-tag t2">T2</span>':''}`;
      c.addEventListener("click",e=>{if(e.shiftKey){AppState.selectedT2SliceIdx=i;updateT2Bar();}else{AppState.selectedSliceIdx=i;}document.getElementById("btn-confirm-slice").disabled=AppState.selectedSliceIdx<0;renderSliceGrid();});grid.appendChild(c);});
  }
  function updateT2Bar(){if(AppState.selectedT2SliceIdx>=0){UI.show("t2-selection");const t1=AppState.thumbnails[AppState.selectedSliceIdx],t2=AppState.thumbnails[AppState.selectedT2SliceIdx];document.getElementById("t2-te1-info").textContent=t1?`#${AppState.selectedSliceIdx} TE=${t1.te_ms}ms`:"—";document.getElementById("t2-te2-info").textContent=t2?`#${AppState.selectedT2SliceIdx} TE=${t2.te_ms}ms`:"—";}else UI.hide("t2-selection");}
  document.getElementById("btn-refresh-thumbs")?.addEventListener("click",()=>setupStep2());
  document.getElementById("btn-wl-auto")?.addEventListener("click",()=>{document.getElementById("wl-val").value=0;document.getElementById("ww-val").value=0;setupStep2();});
  document.getElementById("btn-confirm-slice")?.addEventListener("click",()=>{if(AppState.selectedSliceIdx<0)return;setupStep3();UI.showStep(3);});

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

    // SNR method selector for snr tab
    const snrSel=mod==="snr"?`<select id="snr-method" style="font-size:11px;padding:3px 6px;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border);border-radius:3px"><option value="single_lr" ${snrMethod==="single_lr"?"selected":""}>LR (Left+Right)</option><option value="single_4corner" ${snrMethod==="single_4corner"?"selected":""}>4 Angoli</option><option value="single_4bg" ${snrMethod==="single_4bg"?"selected":""}>4 BG (PSG-style)</option></select>`:"";

    content.innerHTML=`<div class="module-layout"><div class="module-image-panel">
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
    document.getElementById("btn-run")?.addEventListener("click",()=>runAnalysis(mod));
    document.getElementById("btn-reset")?.addEventListener("click",()=>runAnalysisReset(mod));
    if(r)setTimeout(()=>drawROIs(mod,r),100);
  }

  async function loadImage(){
    const idx=AppState.selectedSliceIdx;if(idx<0)return;
    try{const r=await API.getSliceImage(idx,curWL||null,curWW||null,0);const img=document.getElementById("dcm-img");if(img){img.src=`data:image/png;base64,${r.image}`;img.onload=syncSvgSize;}}catch(e){}
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
      const resp=await API.analyze(mod,AppState.selectedSliceIdx,kwargs);
      AppState.results[mod]=resp.results;
      renderModule(mod);setupStep4();UI.setStatus(`${AppState.moduleLabels[mod]} OK`);
      saveCurrentAcquisition(true).catch(()=>{});
    }catch(e){UI.setStatus(`Err: ${e.message}`);alert(e.message);}
  }

  // Reset: run analysis without custom kwargs (automatic ROI placement)
  async function runAnalysisReset(mod){
    UI.setStatus(`${mod} reset...`);
    try{
      const kwargs=mod==="snr"?{snr_method:snrMethod}:{};
      const resp=await API.analyze(mod,AppState.selectedSliceIdx,kwargs);
      AppState.results[mod]=resp.results;
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
    const teVals=[...new Set(seqs.map(s=>s.te_ms).filter(v=>v>0))].sort((a,b)=>a-b);
    const canAuto=teVals.length>=2;

    // Show available sequences for manual T2 selection
    let seqList='';
    if(seqs.length>=2){
      seqList=`<div style="margin:8px 0"><p style="font-size:11px;font-weight:600;margin-bottom:4px">Serie disponibili per T2:</p><table class="result-table" style="font-size:11px"><tr><th>Serie</th><th>TE</th><th>TR</th><th>#</th><th></th></tr>`;
      seqs.forEach((s,i)=>{
        const isCur=s.uid===AppState.activeSequenceUid;
        seqList+=`<tr style="${isCur?'background:rgba(59,130,246,0.1)':''}"><td>${s.description||'—'}</td><td><b>${s.te_ms?.toFixed(0)||'?'}</b> ms</td><td>${s.tr_ms?.toFixed(0)||'?'}</td><td>${s.n_slices}</td><td>${isCur?'★ attiva':''}</td></tr>`;
      });
      seqList+=`</table></div>`;
    }

    content.innerHTML=`<div class="module-layout"><div class="module-image-panel">
      <div class="canvas-controls">
        <button class="btn btn-primary btn-xs" id="btn-t2-auto" ${canAuto?"":"disabled"}>▶ T2 Auto</button>
        <button class="btn btn-secondary btn-xs" id="btn-t2-manual" ${AppState.selectedT2SliceIdx>=0?"":"disabled"}>▶ T2 Manuale</button>
      </div>
      ${canAuto?`<p style="font-size:12px;color:var(--accent-green);margin:8px 0">✓ TE rilevati: <b>${teVals.join(", ")}</b> ms — T2 auto disponibile</p>`:`<p style="font-size:12px;color:var(--text-muted);margin:8px 0">Servono 2+ serie con TE diversi per T2 auto.</p>`}
      ${seqList}
      ${AppState.selectedT2SliceIdx>=0?`<p style="font-size:11px;color:var(--accent-purple)">T2 manuale: slice #${AppState.selectedSliceIdx} vs #${AppState.selectedT2SliceIdx}</p>`:`<p style="font-size:11px;color:var(--text-muted)">Per T2 manuale: torna allo Step 2 e Shift+Click su una slice di altra serie.</p>`}
      ${r&&r.series1_description?`<p style="font-size:11px;color:var(--text-secondary);margin-top:6px">Usate: ${r.series1_description} (TE=${r.te1_ms}) vs ${r.series2_description} (TE=${r.te2_ms})</p>`:''}
    </div><div class="module-results-panel">
      ${r?`<div class="result-section"><h4 style="font-size:16px">T2${r.t2_ms!=null?' = <span style="font-size:20px;color:var(--accent-cyan)">'+r.t2_ms+'</span> ms':' — errore'}</h4><table class="result-table" style="font-size:13px">
        <tr><td>TE₁</td><td class="value">${r.te1_ms} ms</td></tr><tr><td>TE₂</td><td class="value">${r.te2_ms} ms</td></tr>
        <tr><td>S₁ (TE₁)</td><td class="value">${UI.fmt(r.s1_mean)}</td></tr><tr><td>S₂ (TE₂)</td><td class="value">${UI.fmt(r.s2_mean)}</td></tr>
        <tr><td>S₁/S₂</td><td class="value">${UI.fmt(r.ratio_s1_s2,4)}</td></tr>
        <tr><td>Formula</td><td style="font-family:var(--font-mono);font-size:10px">T2 = (TE₂−TE₁) / ln(S₁/S₂)</td></tr></table></div>`:'<p style="color:var(--text-muted);font-size:13px">Premi ▶ T2 Auto per calcolare</p>'}
    </div></div>`;
    document.getElementById("btn-t2-auto")?.addEventListener("click",runT2Auto);
    document.getElementById("btn-t2-manual")?.addEventListener("click",runT2Manual);
  }

  async function runT2Auto(){
    UI.setStatus("T2 auto...");
    try{const r=await API.analyzeT2Auto(AppState.selectedSliceIdx);AppState.results["t2"]=r.results;renderModule("t2");setupStep4();UI.setStatus("T2 OK");saveCurrentAcquisition(true).catch(()=>{});}
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
    try{const resp=await API.analyzeAll(AppState.selectedSliceIdx);if(resp.results)for(const[m,r]of Object.entries(resp.results))AppState.results[m]=r;
      try{await runT2Auto();}catch(e){}
      setupStep4();await saveCurrentAcquisition(true);UI.setStatus("Completata e salvata");}catch(e){UI.setStatus(`Err: ${e.message}`);}
  });
  document.getElementById("btn-go-report")?.addEventListener("click",async()=>{try{await saveCurrentAcquisition(true);}catch(e){}await setupStep5();UI.showStep(5);});

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
    return [
      AppState.inputDir||"",
      AppState.activeSequenceUid||"",
      m.study_date||"",
      m.series_description||"",
      m.protocol||"",
      m.te_ms||"",
      m.tr_ms||"",
      AppState.selectedSliceIdx
    ].join("|");
  }

  function buildHistoryEntry(){
    const info=controlInfoFromForm();
    const m=AppState.dicomMeta||{};
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
      active_sequence_uid:AppState.activeSequenceUid,
      meta:m,
      control_info:info,
      results:AppState.results
    };
  }

  async function saveCurrentAcquisition(silent=false){
    const analyzed=Object.keys(AppState.results||{}).filter(k=>AppState.results[k]&&!AppState.results[k].error);
    if(analyzed.length===0) return null;
    const resp=await API.saveHistory(buildHistoryEntry());
    if(!silent) UI.setStatus("Salvato");
    return resp;
  }

  function entryDate(e){
    return e?.analysis_date||e?.date||e?.study_date||"";
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

  async function setupTotalReport(){
    const c=document.getElementById("report-container");
    const tc=document.getElementById("trend-container");
    const date=document.getElementById("info-date")?.value||new Date().toISOString().slice(0,10);
    try{await saveCurrentAcquisition(true);}catch(e){}
    let hist=[];
    try{hist=(await API.getHistory()).history||[];}catch(e){}
    const entries=sameDayEntries(hist,date);
    if(entries.length===0){
      c.innerHTML=`<div class="report-card"><h3>Report CQ totale</h3><p style="font-size:14px;color:var(--text-muted)">Nessuna acquisizione salvata per ${date}.</p></div>`;
      if(tc) tc.innerHTML="";
      return;
    }
    const shown=entries.slice(-3);
    const first=shown[0]||{};
    const m=first.meta||AppState.dicomMeta||{};
    let h=`<div class="report-card"><h3>Report CQ totale - ${date}</h3><div class="report-grid">
      <div class="report-metric"><span class="label">Acquisizioni nel report</span><span class="value">${shown.length}/3</span></div>
      <div class="report-metric"><span class="label">Sede</span><span class="value">${m.institution||first.control_info?.presidio||"-"}</span></div>
      <div class="report-metric"><span class="label">Scanner</span><span class="value">${((m.manufacturer||"")+" "+(m.model||"")).trim()||"-"}</span></div>
      <div class="report-metric"><span class="label">Campo</span><span class="value">${m.magnetic_field_T||"-"} T</span></div>
    </div>${shown.length<3?`<p style="font-size:12px;color:var(--text-muted);margin-top:10px">Attenzione: trovate ${shown.length} acquisizioni salvate per questa data; il CQ totale atteso ne usa 3.</p>`:""}</div>`;

    const metrics=[
      {label:"Distorsione %",mod:"geometric",key:"distortion_percent",dec:3,unit:" %",passMod:"geometric"},
      {label:"PIU %",mod:"piu",key:"piu_percent",dec:2,unit:" %",passMod:"piu"},
      {label:"PSG %",mod:"psg",key:"psg_percent",dec:4,unit:" %",passMod:"psg"},
      {label:"SNR",mod:"snr",key:"snr",dec:2,unit:"",passMod:null},
      {label:"SNRU %",mod:"snru",key:"snru_percent",dec:2,unit:" %",passMod:"snru"},
      {label:"T2 ms",mod:"t2",key:"t2_ms",dec:2,unit:" ms",passMod:null}
    ];
    h+=`<div class="report-card"><h3>Riepilogo tre acquisizioni</h3><table class="result-table" style="width:100%;font-size:13px"><thead><tr><th>Parametro</th>`;
    shown.forEach((e,i)=>{h+=`<th>${resultLabel(e,i)}</th>`;});
    h+=`<th>Media</th><th>Range</th><th>Esito</th></tr></thead><tbody>`;
    metrics.forEach(mt=>{
      const vals=shown.map(e=>metricValue(e.results,mt.mod,mt.key));
      const nums=vals.filter(v=>v!=null);
      const avg=nums.length?nums.reduce((a,b)=>a+b,0)/nums.length:null;
      const range=nums.length?Math.max(...nums)-Math.min(...nums):null;
      const passes=mt.passMod?shown.map(e=>metricPass(e.results,mt.passMod)).filter(v=>v!=null):[];
      const failed=passes.some(v=>v===false);
      const passed=passes.length&&passes.every(v=>v===true);
      h+=`<tr><td style="padding:8px;font-weight:600">${mt.label}</td>`;
      vals.forEach(v=>{h+=`<td class="value" style="padding:8px">${fmtMetric(v,mt.dec,mt.unit)}</td>`;});
      h+=`<td class="value" style="padding:8px">${fmtMetric(avg,mt.dec,mt.unit)}</td><td class="value" style="padding:8px">${fmtMetric(range,mt.dec,mt.unit)}</td>`;
      h+=`<td class="${failed?'fail':passed?'pass':''}" style="padding:8px;font-weight:700">${failed?'FAIL':passed?'PASS':'-'}</td></tr>`;
    });
    h+=`</tbody></table></div>`;

    h+=`<div class="report-card"><h3>Dettaglio acquisizioni salvate</h3><div class="report-grid">`;
    shown.forEach((e,i)=>{
      const em=e.meta||{};
      h+=`<div class="report-metric"><span class="label">${resultLabel(e,i)}</span><span class="value">${em.study_date||e.study_date||"-"}</span><span class="label">${em.series_description||em.protocol||"-"}</span></div>`;
    });
    h+=`</div></div>`;
    c.innerHTML=h;
    if(tc) tc.innerHTML="";
    document.title=`CQ_totale_${date.replace(/-/g,"")}`;
  }

  async function setupStep5(){
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

    // Summary table — ALL parameters
    const P=[
      {l:"Distorsione Geometrica",mod:"geometric",k:"distortion_percent",u:"%",lim:"≤ 2%",gp:r=>r?.passed},
      {l:"Uniformità (PIU)",mod:"piu",k:"piu_percent",u:"%",lim:"≥ 87.5%",gp:r=>r?.passed},
      {l:"Ghosting (PSG)",mod:"psg",k:"psg_percent",u:"%",lim:"≤ 2.5%",gp:r=>r?.passed},
      {l:"SNR",mod:"snr",k:"snr",u:"",lim:prevSnr!=null?`prev: ${prevSnr.toFixed(1)}`:"— (trend)",gp:r=>snrPass(r)},
      {l:"Uniformità SNR (SNRU)",mod:"snru",k:"snru_percent",u:"%",lim:"≥ 90%",gp:r=>r?.passed},
      {l:"T2",mod:"t2",k:"t2_ms",u:"ms",lim:prevT2!=null?`prev: ${prevT2.toFixed(1)}`:"— (trend)",gp:r=>t2Pass(r)},
    ];
    h+=`<div class="report-card"><h3>Riepilogo Risultati</h3>`;
    if(prevSnr!=null||prevT2!=null) h+=`<p style="font-size:11px;color:var(--text-secondary);margin-bottom:8px">SNR e T2 valutati rispetto alla misura precedente (FAIL se calo &gt; 10%)</p>`;
    h+=`<table class="result-table" style="width:100%;font-size:14px"><thead><tr><th style="padding:8px">Parametro</th><th style="padding:8px">Valore</th><th style="padding:8px">Riferimento</th><th style="padding:8px">Esito</th></tr></thead><tbody>`;
    P.forEach(p=>{
      const r=R[p.mod],v=r?r[p.k]:null,pa=p.gp(r);
      const valStr=v!=null?(typeof v==='number'?v.toFixed(2):v)+" "+p.u:"— (non analizzato)";
      const cls=pa===true?'pass':pa===false?'fail':'';
      const esitoStr=pa===true?"✓ PASS":pa===false?"✗ FAIL":"—";
      h+=`<tr><td style="padding:8px;font-weight:500">${p.l}</td><td class="value" style="padding:8px;font-size:15px">${valStr}</td><td style="padding:8px">${p.lim}</td><td class="${cls}" style="padding:8px;font-size:14px;font-weight:700">${esitoStr}</td></tr>`;
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
      const labels=hist.map(e=>e.date||"?");
      const charts=[{t:"Distorsione %",k:r=>r?.geometric?.distortion_percent,lim:[{value:2,label:"2%",color:"#ef4444"}]},{t:"PIU %",k:r=>r?.piu?.piu_percent,lim:[{value:87.5,label:"87.5%",color:"#22c55e"}]},{t:"PSG %",k:r=>r?.psg?.psg_percent,lim:[{value:2.5,label:"2.5%",color:"#ef4444"}]},{t:"SNR",k:r=>r?.snr?.snr,lim:[]},{t:"SNRU %",k:r=>r?.snru?.snru_percent,lim:[{value:90,label:"90%",color:"#22c55e"}]},{t:"T2 ms",k:r=>r?.t2?.t2_ms,lim:[]}];
      let h=`<div class="report-card"><h3>Trend (${hist.length})</h3>`;
      charts.forEach(ch=>{const d=hist.map(e=>ch.k(e.results));if(d.every(v=>v==null))return;h+=`<div id="ch-${ch.t.replace(/\W/g,'')}" style="margin-bottom:10px"></div>`;});
      h+=`</div>`;tc.innerHTML=h;
      charts.forEach(ch=>{const d=hist.map(e=>ch.k(e.results));if(d.every(v=>v==null))return;const el=document.getElementById(`ch-${ch.t.replace(/\W/g,'')}`);if(el)SvgChart.line(el,{labels,datasets:[{label:ch.t,data:d,color:"#3b82f6"}],title:ch.t,limits:ch.lim});});
    }catch(e){tc.innerHTML=`<div class="report-card"><h3>Trend</h3><p style="color:var(--text-muted)">Errore</p></div>`;}
  }

  document.getElementById("btn-save-history")?.addEventListener("click",async()=>{try{await saveCurrentAcquisition(false);loadTrend();}catch(e){UI.setStatus(`Err: ${e.message}`);}});
  document.getElementById("btn-total-report")?.addEventListener("click",async()=>{await setupTotalReport();UI.showStep(5);});
  document.getElementById("btn-print")?.addEventListener("click",()=>window.print());

})();

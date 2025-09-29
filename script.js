// DOM
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const debugEl = document.getElementById('debug');
const roiSizeLabel = document.getElementById('roiSize');
const btnSmall = document.getElementById('smaller');
const btnBig   = document.getElementById('bigger');
const btnToggle= document.getElementById('toggle');

const phBar = document.getElementById('phBar');
const phMarker = document.getElementById('phMarker');

const useDefaultBtn = document.getElementById('useDefault');
const useManualBtn  = document.getElementById('useManual');
const activeModeTag = document.getElementById('activeMode');

const phInput   = document.getElementById('phInput');
const btnCapture= document.getElementById('btnCapture');
const btnReset  = document.getElementById('btnReset');
const btnSave   = document.getElementById('btnSave');
const btnLoad   = document.getElementById('btnLoad');
const btnExport = document.getElementById('btnExport');
const fileImport= document.getElementById('fileImport');
const pointsList= document.getElementById('pointsList');
const wbToggle  = document.getElementById('wbToggle');

// State
let running = true;
let roiSize = 64;                 // small centered scan area
let rafId = null;
let useManual = false;            // toggle between default and manual calibration
let manualCalib = loadManualCalib() || []; // [{hue: deg, pH: number}, ...]

// --- Default universal-indicator mapping (hue° → pH) ---
const DEFAULT_CALIB = [
  { hue:   0, pH: 1 },  // red
  { hue:  20, pH: 4 },  // orange
  { hue:  50, pH: 6 },  // yellow
  { hue: 110, pH: 7 },  // green
  { hue: 170, pH: 9 },  // blue-green
  { hue: 210, pH: 11},  // blue
  { hue: 280, pH: 14}   // violet
];

// ---------- Camera ----------
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: 'environment' } }, audio: false });
    video.srcObject = stream;
    statusEl.textContent = 'Camera OK (environment)';
  } catch (e) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      video.srcObject = stream;
      statusEl.textContent = 'Camera OK (default)';
    } catch (err) {
      statusEl.textContent = 'Camera error: ' + err.message;
      console.error(err);
    }
  }
}

function drawAndProcess() {
  if (!running) return;
  const w = overlay.width  = video.videoWidth  || 640;
  const h = overlay.height = video.videoHeight || 480;

  ctx.clearRect(0,0,w,h);
  ctx.drawImage(video, 0, 0, w, h);

  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  const half = Math.floor(roiSize / 2);
  const x0 = Math.max(0, cx - half), y0 = Math.max(0, cy - half);
  const rw = Math.min(roiSize, w - x0), rh = Math.min(roiSize, h - y0);

  // Draw ROI
  ctx.strokeStyle = 'rgba(0,255,0,0.9)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x0+0.5, y0+0.5, rw-1, rh-1);

  // Read pixels
  const img = ctx.getImageData(x0, y0, rw, rh);
  const { meanHue, count } = getROIHue(img, wbToggle.checked);

  if (!Number.isNaN(meanHue) && count > 20) {
    let ph = hueToPH(meanHue);
    ph = clamp(ph, 1, 14);
    resultEl.textContent = 'pH ≈ ' + ph.toFixed(2);
    debugEl.textContent  = 'Hue: ' + meanHue.toFixed(1) + '°   (' + count + ' px)';
    // Move marker along pH bar
    phMarker.style.left = (ph / 14 * 100) + '%';
  } else {
    resultEl.textContent = 'pH: --';
    debugEl.textContent  = 'Hue: -- (too few pixels)';
  }

  rafId = requestAnimationFrame(drawAndProcess);
}

// ---------- Color utils ----------
function rgbToHsv(r,g,b){
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  const d=max-min;
  let h=0;
  if(d!==0){
    switch(max){
      case r: h=(g-b)/d + (g<b?6:0); break;
      case g: h=(b-r)/d+2; break;
      case b: h=(r-g)/d+4; break;
    }
    h*=60;
  }
  const s=max===0?0:d/max;
  const v=max;
  return [h,s,v];
}

function circularMeanDeg(values, weights) {
  let x=0,y=0;
  if (!weights) {
    for (const v of values) {
      const a = v * Math.PI / 180;
      x += Math.cos(a); y += Math.sin(a);
    }
  } else {
    for (let i=0;i<values.length;i++){
      const a = values[i] * Math.PI / 180;
      const w = weights[i];
      x += w * Math.cos(a); y += w * Math.sin(a);
    }
  }
  if (x === 0 && y === 0) return NaN;
  let ang = Math.atan2(y, x) * 180 / Math.PI;
  if (ang < 0) ang += 360;
  return ang;
}
function hueDistance(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
function normalizeHue(h) {
  h = h % 360;
  return h < 0 ? h + 360 : h;
}
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

// Optional simple gray-world white balance on ROI
function grayWorldWB(pixels) {
  // pixels: Uint8ClampedArray RGBA
  let R=0,G=0,B=0, n=0;
  for (let i=0;i<pixels.length;i+=4){ R+=pixels[i]; G+=pixels[i+1]; B+=pixels[i+2]; n++; }
  if (n===0) return;
  R/=n; G/=n; B/=n;
  const avg = (R+G+B)/3 || 1;
  const kR = avg / (R||1), kG = avg / (G||1), kB = avg / (B||1);
  for (let i=0;i<pixels.length;i+=4){
    pixels[i  ] = clamp(Math.round(pixels[i  ] * kR),0,255);
    pixels[i+1] = clamp(Math.round(pixels[i+1] * kG),0,255);
    pixels[i+2] = clamp(Math.round(pixels[i+2] * kB),0,255);
  }
}

function getROIHue(imageData, useWB=false){
  const data = new Uint8ClampedArray(imageData.data); // copy
  if (useWB) grayWorldWB(data);

  const hues = [];
  const weights = [];
  for (let i=0;i<data.length;i+=4){
    const r=data[i], g=data[i+1], b=data[i+2];
    const a=data[i+3];
    if (a<128) continue;
    const [h,s,v]=rgbToHsv(r,g,b);
    if (s>0.18 && v>0.18) { hues.push(h); weights.push(v); }
  }
  if (hues.length<5) return { meanHue: NaN, count: hues.length };
  const meanHue = circularMeanDeg(hues, weights);
  return { meanHue, count: hues.length };
}

// ---------- Calibration / Mapping ----------
function getActiveCalib(){
  const list = useManual && manualCalib.length>=2 ? manualCalib : DEFAULT_CALIB;
  // Normalize/clone to avoid mutation
  return list.map(p => ({ hue: normalizeHue(p.hue), pH: clamp(p.pH, 1, 14) }));
}

// Interpolate pH from hue using the active calibration along the short arc
function hueToPH(hueDeg){
  hueDeg = normalizeHue(hueDeg);
  const C = getActiveCalib();
  if (C.length === 0) return 7.0;
  if (C.length === 1) return C[0].pH;

  // Find nearest calibration index
  let bestIdx = 0, bestDist = 9999;
  for (let i=0;i<C.length;i++){
    const d = hueDistance(hueDeg, C[i].hue);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  // choose closer neighbor (left or right in circular sense)
  const left = (bestIdx - 1 + C.length) % C.length;
  const right= (bestIdx + 1) % C.length;

  const dLeft  = hueDistance(hueDeg, C[left ].hue);
  const dRight = hueDistance(hueDeg, C[right].hue);
  let i0, i1;
  if (dLeft < dRight) { i0 = left; i1 = bestIdx; }
  else { i0 = bestIdx; i1 = right; }

  const h0 = C[i0].hue, h1 = C[i1].hue;
  const p0 = C[i0].pH , p1 = C[i1].pH;

  // project onto local arc where h0=0
  function arcTo(h, ref){
    let x = normalizeHue(h - ref);
    if (x > 180) x -= 360; // (-180, 180]
    return x;
  }
  const L = Math.abs(arcTo(h1, h0));
  const x = Math.abs(arcTo(hueDeg, h0));
  const t = L < 1e-6 ? 0 : clamp(x / L, 0, 1);

  return p0 + t * (p1 - p0);
}

// ---- Manual calibration helpers ----
function saveManualCalib(){
  localStorage.setItem('ph_manual_calibration_v1', JSON.stringify(manualCalib));
}
function loadManualCalib(){
  try {
    const s = localStorage.getItem('ph_manual_calibration_v1');
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
function refreshPointsList(){
  if (!manualCalib || manualCalib.length === 0){
    pointsList.textContent = 'No manual points yet.';
    return;
  }
  const sorted = [...manualCalib].sort((a,b)=>a.pH-b.pH);
  pointsList.textContent = sorted.map(p => `pH ${p.pH.toFixed(2)}  ←  hue ${p.hue.toFixed(2)}°`).join('\n');
}
function setMode(manual){
  useManual = manual && manualCalib.length >= 2;
  activeModeTag.textContent = 'Active: ' + (useManual ? 'Manual' : 'Default');
}

// ---------- UI bindings ----------
btnSmall.onclick = () => { roiSize = Math.max(24, roiSize - 16); roiSizeLabel.textContent = roiSize + '×' + roiSize; };
btnBig.onclick   = () => { roiSize = Math.min(256, roiSize + 16); roiSizeLabel.textContent = roiSize + '×' + roiSize; };
btnToggle.onclick= () => {
  running = !running;
  if (running) { drawAndProcess(); btnToggle.textContent = 'Pause/Resume'; }
  else { cancelAnimationFrame(rafId); btnToggle.textContent = 'Resume'; }
};

useDefaultBtn.onclick = () => { setMode(false); };
useManualBtn.onclick  = () => { setMode(true); };

btnCapture.onclick = () => {
  // Snapshot current ROI hue and add with given pH
  const w = overlay.width, h = overlay.height;
  if (!w || !h) return;
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  const half = Math.floor(roiSize / 2);
  const x0 = Math.max(0, cx - half), y0 = Math.max(0, cy - half);
  const rw = Math.min(roiSize, w - x0), rh = Math.min(roiSize, h - y0);
  const img = ctx.getImageData(x0, y0, rw, rh);

  const { meanHue, count } = getROIHue(img, wbToggle.checked);
  if (Number.isNaN(meanHue) || count < 20){
    alert('Not enough valid pixels in ROI. Try adjusting ROI or lighting.');
    return;
  }
  const p = parseFloat(phInput.value);
  if (!(p >= 1 && p <= 14)) { alert('Enter pH in [1,14].'); return; }

  manualCalib.push({ hue: normalizeHue(meanHue), pH: clamp(p,1,14) });
  saveManualCalib();
  setMode(true); // switch to manual if possible
  refreshPointsList();
};

btnReset.onclick = () => {
  if (!confirm('Clear all manual calibration points?')) return;
  manualCalib = [];
  saveManualCalib();
  refreshPointsList();
  setMode(false);
};

btnSave.onclick = () => { saveManualCalib(); alert('Saved to localStorage.'); };

btnLoad.onclick = () => {
  const data = loadManualCalib();
  manualCalib = Array.isArray(data) ? data : [];
  refreshPointsList();
  setMode(true);
};

btnExport.onclick = () => {
  const blob = new Blob([JSON.stringify(manualCalib, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'ph_manual_calibration.json';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
};

fileImport.addEventListener('change', (e)=>{
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ()=> {
    try {
      const arr = JSON.parse(reader.result);
      if (!Array.isArray(arr)) throw new Error('Invalid file');
      // Validate entries
      manualCalib = arr
        .filter(o => typeof o==='object' && 'hue' in o && 'pH' in o)
        .map(o => ({ hue: normalizeHue(Number(o.hue)), pH: clamp(Number(o.pH),1,14) }));
      saveManualCalib();
      refreshPointsList();
      setMode(true);
    } catch(err){
      alert('Import failed: ' + err.message);
    }
  };
  reader.readAsText(file);
});

// ---------- Boot ----------
startCamera();
video.addEventListener('loadedmetadata', () => { drawAndProcess(); });
refreshPointsList();
setMode(false); // start with default
roiSizeLabel.textContent = roiSize + '×' + roiSize;

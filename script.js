// Elements
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const debugEl = document.getElementById('debug');
const roiSizeLabel = document.getElementById('roiSize');
const btnSmall = document.getElementById('smaller');
const btnBig = document.getElementById('bigger');
const btnToggle = document.getElementById('toggle');

const phMarker = document.getElementById('phMarker');
const useDefaultBtn = document.getElementById('useDefault');
const useManualBtn = document.getElementById('useManual');
const useCabbageBtn = document.getElementById('useCabbage');
const activeModeTag = document.getElementById('activeMode');

const phInput = document.getElementById('phInput');
const btnCapture = document.getElementById('btnCapture');
const btnReset = document.getElementById('btnReset');
const btnSave = document.getElementById('btnSave');
const btnLoad = document.getElementById('btnLoad');
const btnExport = document.getElementById('btnExport');
const fileImport = document.getElementById('fileImport');
const pointsList = document.getElementById('pointsList');
const wbToggle = document.getElementById('wbToggle');

// State
let running = true;
let roiSize = 64;
let rafId = null;
let mode = "default"; // "default", "manual", "cabbage"
let manualCalib = loadManualCalib() || [];
let defaultCalib = [];
let cabbageCalib = [];

// Load calibration.json for default mode
fetch("calibration.json")
  .then(resp => resp.json())
  .then(data => {
    defaultCalib = data.sort((a, b) => a.hue - b.hue);
    console.log("Default calibration loaded:", defaultCalib);
  })
  .catch(err => {
    console.error("Failed to load calibration.json:", err);
  });

// Load cabbage_calibration.json
fetch("cabbage_calibration.json")
  .then(resp => resp.json())
  .then(data => {
    cabbageCalib = data.sort((a, b) => a.hue - b.hue);
    console.log("Cabbage calibration loaded:", cabbageCalib);
  })
  .catch(err => console.error("Failed to load cabbage calibration:", err));

// ---- Camera ----
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

// ---- Utilities ----
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
  return [h,s,max];
}
function circularMeanDeg(values, weights) {
  let x=0,y=0;
  for (let i=0;i<values.length;i++) {
    const a=values[i]*Math.PI/180;
    const w=weights?weights[i]:1;
    x+=w*Math.cos(a); y+=w*Math.sin(a);
  }
  if(x===0&&y===0) return NaN;
  let ang=Math.atan2(y,x)*180/Math.PI;
  if(ang<0) ang+=360;
  return ang;
}
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function normalizeHue(h){ h=h%360; return h<0?h+360:h; }

// ROI Hue
function getROIHue(imageData){
  const data=imageData.data;
  const hues=[],weights=[];
  for(let i=0;i<data.length;i+=4){
    const [h,s,v]=rgbToHsv(data[i],data[i+1],data[i+2]);
    if(s>0.2 && v>0.2){ hues.push(h); weights.push(v); }
  }
  if(hues.length<5) return {meanHue:NaN,count:hues.length};
  return {meanHue:circularMeanDeg(hues,weights),count:hues.length};
}

// ---- Calibration mapping ----
function getActiveCalib(){
  if (mode === "cabbage" && cabbageCalib.length >= 2) return cabbageCalib;
  if (mode === "manual" && manualCalib.length >= 2) return manualCalib;
  return defaultCalib;
}
function hueToPH(hue){
  const calib=getActiveCalib();
  if(calib.length<2) return 7.0;
  hue=normalizeHue(hue);
  for(let i=1;i<calib.length;i++){
    if(hue<=calib[i].hue){
      const h0=calib[i-1].hue,h1=calib[i].hue;
      const p0=calib[i-1].pH,p1=calib[i].pH;
      const t=(hue-h0)/(h1-h0);
      return p0+t*(p1-p0);
    }
  }
  return calib[calib.length-1].pH;
}

// ---- Draw loop ----
function drawAndProcess(){
  if(!running) return;
  const w=overlay.width=video.videoWidth||640;
  const h=overlay.height=video.videoHeight||480;
  ctx.drawImage(video,0,0,w,h);

  const cx=w/2, cy=h/2, half=roiSize/2;
  const x0=Math.max(0,cx-half), y0=Math.max(0,cy-half);
  const rw=Math.min(roiSize,w-x0), rh=Math.min(roiSize,h-y0);

  const img=ctx.getImageData(x0,y0,rw,rh);
  const {meanHue,count}=getROIHue(img);

  if(!isNaN(meanHue)&&count>20){
    let ph=clamp(hueToPH(meanHue),1,14);
    resultEl.textContent="pH ≈ "+ph.toFixed(2);
    debugEl.textContent="Hue: "+meanHue.toFixed(1)+"° ("+count+" px)";
    phMarker.style.left=(ph/14*100)+"%";
  } else {
    resultEl.textContent="pH: --";
    debugEl.textContent="Hue: --";
  }

  ctx.strokeStyle="lime"; ctx.lineWidth=2;
  ctx.strokeRect(x0+0.5,y0+0.5,rw-1,rh-1);
  rafId=requestAnimationFrame(drawAndProcess);
}

// ---- UI ----
btnSmall.onclick=()=>{roiSize=Math.max(24,roiSize-16);roiSizeLabel.textContent=roiSize+"×"+roiSize;};
btnBig.onclick=()=>{roiSize=Math.min(256,roiSize+16);roiSizeLabel.textContent=roiSize+"×"+roiSize;};
btnToggle.onclick=()=>{running=!running;if(running){drawAndProcess();}else{cancelAnimationFrame(rafId);}};

// Mode buttons
useDefaultBtn.onclick=()=> {
  mode = "default";
  activeModeTag.textContent = "Active: Default";
};
useManualBtn.onclick=()=> {
  if(manualCalib.length<2){
    alert("Need at least 2 manual points.");
    mode = "default";
    activeModeTag.textContent = "Active: Default";
  } else {
    mode = "manual";
    activeModeTag.textContent = "Active: Manual";
  }
};
useCabbageBtn.onclick=()=> {
  if(cabbageCalib.length<2){
    alert("Need at least 2 points in cabbage calibration file.");
    mode = "default";
    activeModeTag.textContent = "Active: Default";
  } else {
    mode = "cabbage";
    activeModeTag.textContent = "Active: Purple Cabbage";
  }
};

// ---- Manual calibration ----
function saveManualCalib(){localStorage.setItem("ph_manual_calibration",JSON.stringify(manualCalib));}
function loadManualCalib(){try{return JSON.parse(localStorage.getItem("ph_manual_calibration"));}catch{return [];}}

btnCapture.onclick=()=>{
  const w=overlay.width,h=overlay.height;
  const cx=w/2,cy=h/2,half=roiSize/2;
  const x0=Math.max(0,cx-half),y0=Math.max(0,cy-half);
  const rw=Math.min(roiSize,w-x0),rh=Math.min(roiSize,h-y0);
  const img=ctx.getImageData(x0,y0,rw,rh);
  const {meanHue,count}=getROIHue(img);
  if(isNaN(meanHue)||count<20){alert("Not enough pixels");return;}
  const p=parseFloat(phInput.value);
  if(!(p>=1&&p<=14)){alert("Enter pH 1-14");return;}
  manualCalib.push({hue:normalizeHue(meanHue),pH:p});
  saveManualCalib();
  mode = "manual";
  activeModeTag.textContent="Active: Manual";
};

btnReset.onclick=()=>{
  manualCalib=[];
  saveManualCalib();
  mode="default";
  activeModeTag.textContent="Active: Default";
};
btnSave.onclick =()=>{saveManualCalib();alert("Saved manual calibration.");};
btnLoad.onclick =()=>{manualCalib=loadManualCalib()||[];alert("Loaded manual calibration.");};
btnExport.onclick=()=>{
  const blob=new Blob([JSON.stringify(manualCalib,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="ph_manual_calibration.json";
  a.click();
};
fileImport.addEventListener("change",e=>{
  const file=e.target.files[0];if(!file)return;
  const r=new FileReader();
  r.onload=()=>{try{manualCalib=JSON.parse(r.result);saveManualCalib();alert("Imported.");}catch{alert("Invalid file.");}};
  r.readAsText(file);
});

// ---- Boot ----
startCamera();
video.addEventListener("loadedmetadata",()=>{drawAndProcess();});
roiSizeLabel.textContent=roiSize+"×"+roiSize;

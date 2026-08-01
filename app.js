"use strict";

/* ═══════════════════════ State ═══════════════════════ */

const P = {
  aspect: 1,
  bg: "#ffffff",
  fg: "#000000",
  swap: false,
  cols: 18,
  pad: 0,
  checker: false,
  shapes: ["triangle"], // selected shapes; >1 = random mix across the grid
  shapeScale: 1,
  speed: 0.25,
  wave: "sine",
  rot: 0.5,          // turns
  scaleAmt: 0,       // 0..1
  quant: 0,          // rotation steps (0 = off)
  delayPattern: "diagonal",
  delayAmt: 1,       // cycles
  mirrorDelay: false,
  showFx: true,
  tintSvg: true,
};

let currentFg = "#000000"; // resolved shape color, used to tint custom SVGs

let effectors = [];
let fxCounter = 0;
let playing = true;
let time = 0;
let lastT = performance.now();

const FX_COLORS = ["#ffd21f", "#7c5cff", "#ff5c8a", "#3ddc97", "#41a9ff", "#ff8c42"];

/* ═══════════════════════ Canvas setup ═══════════════════════ */

const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
const stage = document.getElementById("stage");

function fitCanvas() {
  const availW = stage.clientWidth - 56;
  const availH = stage.clientHeight - 56;
  let w = availW, h = w / P.aspect;
  if (h > availH) { h = availH; w = h * P.aspect; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.width = Math.round(w) + "px";
  cv.style.height = Math.round(h) + "px";
}
window.addEventListener("resize", fitCanvas);

/* ═══════════════════════ Shapes ═══════════════════════ */
/* Each shape is drawn centered at (0,0) inside a box of size s */

const SHAPES = {
  triangle: (c, s) => {
    c.beginPath();
    c.moveTo(-s/2, -s/2); c.lineTo(s/2, s/2); c.lineTo(-s/2, s/2);
    c.closePath(); c.fill();
  },
  quarter: (c, s) => {
    c.beginPath();
    c.moveTo(-s/2, s/2);
    c.arc(-s/2, s/2, s, -Math.PI/2, 0);
    c.closePath(); c.fill();
  },
  half: (c, s) => {
    c.beginPath();
    c.arc(0, 0, s/2, Math.PI/2, -Math.PI/2);
    c.closePath(); c.fill();
  },
  bar: (c, s) => {
    c.fillRect(-s/2, -s/6, s, s/3);
  },
  halfSquare: (c, s) => {
    c.fillRect(-s/2, 0, s, s/2);
  },
  circle: (c, s) => {
    c.beginPath();
    c.arc(0, 0, s/2, 0, Math.PI*2);
    c.fill();
  },
  bowtie: (c, s) => {
    c.beginPath();
    c.moveTo(-s/2, -s/2); c.lineTo(0, 0); c.lineTo(-s/2, s/2); c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(s/2, -s/2); c.lineTo(0, 0); c.lineTo(s/2, s/2); c.closePath(); c.fill();
  },
  hook: (c, s) => {
    c.beginPath();
    c.moveTo(-s/2, -s/2);
    c.lineTo(s/2, -s/2);
    c.lineTo(s/2, s/2);
    c.quadraticCurveTo(-s/2, s/2, -s/2, -s/2);
    c.closePath(); c.fill();
  },
};

/* Mini icons for the shape picker */
const SHAPE_ICONS = {
  triangle:   '<polygon points="2,16 16,16 2,2"/>',
  quarter:    '<path d="M2 16 L2 2 A14 14 0 0 1 16 16 Z"/>',
  half:       '<path d="M9 2 A7 7 0 0 1 9 16 Z"/>',
  bar:        '<rect x="2" y="6.5" width="14" height="5"/>',
  halfSquare: '<rect x="2" y="9" width="14" height="7"/>',
  circle:     '<circle cx="9" cy="9" r="7"/>',
  bowtie:     '<path d="M2 2 L9 9 L2 16 Z M16 2 L9 9 L16 16 Z"/>',
  hook:       '<path d="M2 2 L16 2 L16 16 Q2 16 2 2 Z"/>',
};

/* ═══════════════════════ Delay patterns ═══════════════════════ */

function hash2(i, j) {
  let h = (i * 374761393 + j * 668265263) ^ 0x5bf03635;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function cellDelay(i, j, cols, rows) {
  const u = cols > 1 ? i / (cols - 1) : 0.5;
  const v = rows > 1 ? j / (rows - 1) : 0.5;
  let d;
  switch (P.delayPattern) {
    case "linearX":  d = u; break;
    case "linearY":  d = v; break;
    case "diagonal": d = (u + v) / 2; break;
    case "radial": {
      const dx = u - 0.5, dy = v - 0.5;
      d = Math.hypot(dx, dy) / 0.7071;
      break;
    }
    case "spiral": {
      const dx = u - 0.5, dy = v - 0.5;
      const r = Math.hypot(dx, dy) / 0.7071;
      const a = (Math.atan2(dy, dx) / (Math.PI * 2)) + 0.5;
      d = (r + a) % 1;
      break;
    }
    case "checker": d = ((i + j) % 2) * 0.5; break;
    case "random":  d = hash2(i, j); break;
    default: d = 0;
  }
  if (P.mirrorDelay) d = Math.abs(d - 0.5) * 2;
  return d;
}

/* ═══════════════════════ Wave functions ═══════════════════════ */
/* Map a phase (in cycles) to an oscillation value */

function waveValue(phase) {
  const p = phase - Math.floor(phase); // fractional cycle 0..1
  switch (P.wave) {
    case "spin":     return phase;                              // continuous rotation
    case "sine":     return Math.sin(phase * Math.PI * 2) * 0.5;
    case "pingpong": return (p < 0.5 ? p * 2 : 2 - p * 2) - 0.5;
    case "step":     return Math.floor(phase * 4) / 4;
    case "pulse": {
      const e = Math.exp(-p * 5); // sharp attack, slow decay
      return Math.sin(p * Math.PI * 2) * e;
    }
    default: return 0;
  }
}

/* ═══════════════════════ Effectors ═══════════════════════ */

function makeEffector() {
  const fx = {
    id: ++fxCounter,
    color: FX_COLORS[(fxCounter - 1) % FX_COLORS.length],
    enabled: true,
    path: ["orbit", "lissajous", "sweepX", "sweepY", "figure8"][(fxCounter - 1) % 5],
    pathSize: 0.35,   // travel size, fraction of canvas
    speed: 0.3,
    radius: 0.25,     // influence radius, fraction of min dimension
    strength: 1,
    pulse: 0.5,       // radius pulsation amount 0..1
    pulseSpeed: 1,
    target: "rotation",  // rotation | scale | phase
  };
  effectors.push(fx);
  buildFxUI();
  return fx;
}

function effectorPos(fx, t, w, h) {
  const cx = w / 2, cy = h / 2;
  const R = fx.pathSize * Math.min(w, h);
  const a = t * fx.speed * Math.PI * 2;
  switch (fx.path) {
    case "orbit":     return [cx + Math.cos(a) * R, cy + Math.sin(a) * R];
    case "lissajous": return [cx + Math.sin(a * 3) * R, cy + Math.sin(a * 2) * R];
    case "figure8":   return [cx + Math.sin(a) * R, cy + Math.sin(a * 2) * R * 0.6];
    case "sweepX": {
      const p = (t * fx.speed) % 2;
      const x = (p < 1 ? p : 2 - p) * w;
      return [x, cy];
    }
    case "sweepY": {
      const p = (t * fx.speed) % 2;
      const y = (p < 1 ? p : 2 - p) * h;
      return [cx, y];
    }
    default: return [cx, cy];
  }
}

function effectorRadius(fx, t, w, h) {
  const base = fx.radius * Math.min(w, h);
  const pulse = 1 + Math.sin(t * fx.pulseSpeed * Math.PI * 2) * fx.pulse * 0.5;
  return Math.max(base * pulse, 1);
}

/* ═══════════════════════ Cell math (shared by canvas + SVG export) ═══════════════════════ */

function getFxState(w, h) {
  return effectors
    .filter(fx => fx.enabled)
    .map(fx => {
      const [x, y] = effectorPos(fx, time, w, h);
      return { fx, x, y, r: effectorRadius(fx, time, w, h) };
    });
}

function cellShape(i, j) {
  // Stable random assignment when several shapes are selected
  // (offset seeds so it doesn't correlate with the "random" delay pattern)
  const names = P.shapes;
  if (names.length === 1) return names[0];
  const idx = Math.floor(hash2(i + 101, j + 57) * names.length);
  return names[Math.min(idx, names.length - 1)];
}

function cellState(i, j, cols, rows, cell, cellH, fxState) {
  const cx = (i + 0.5) * cell;
  const cy = (j + 0.5) * cellH;

  let phase = time * P.speed - cellDelay(i, j, cols, rows) * P.delayAmt;
  let extraRot = 0;
  let extraScale = 0;

  for (const s of fxState) {
    const d = Math.hypot(cx - s.x, cy - s.y);
    if (d < s.r) {
      const f = 1 - d / s.r;
      const inf = f * f * s.fx.strength; // squared falloff = soft edge
      switch (s.fx.target) {
        case "rotation": extraRot += inf * Math.PI; break;
        case "scale":    extraScale += inf; break;
        case "phase":    phase += inf; break;
      }
    }
  }

  let rot = waveValue(phase) * Math.PI * 2 * P.rot + extraRot;

  if (P.quant > 0) {
    const step = (Math.PI * 2) / P.quant;
    rot = Math.round(rot / step) * step;
  }

  let scl = P.shapeScale * (1 - P.pad / 100);
  if (P.scaleAmt > 0) {
    scl *= 1 + Math.sin(phase * Math.PI * 2) * P.scaleAmt * 0.5;
  }
  scl *= 1 + extraScale * 0.8;

  const flip = P.checker && ((i + j) % 2 === 1);
  return { cx, cy, rot, scl, flip };
}

/* ═══════════════════════ Render ═══════════════════════ */

function render() {
  const w = cv.width, h = cv.height;
  if (w === 0 || h === 0) return;

  const bg = P.swap ? P.fg : P.bg;
  const fg = P.swap ? P.bg : P.fg;
  currentFg = fg;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const cols = P.cols;
  const cell = w / cols;
  const rows = Math.max(1, Math.round(h / cell));
  const cellH = h / rows;

  const fxState = getFxState(w, h);

  ctx.fillStyle = fg;
  const size = Math.min(cell, cellH);

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const c = cellState(i, j, cols, rows, cell, cellH, fxState);
      if (c.scl <= 0.01) continue;

      ctx.save();
      ctx.translate(c.cx, c.cy);
      ctx.rotate(c.rot);
      if (c.flip) ctx.scale(-1, 1);
      SHAPES[cellShape(i, j)](ctx, size * c.scl);
      ctx.restore();
    }
  }

  // Effector outlines
  if (P.showFx) {
    for (const s of fxState) {
      ctx.save();
      ctx.strokeStyle = s.fx.color;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = s.fx.color;
      ctx.fill();
      ctx.restore();
    }
  }
}

/* ═══════════════════════ Main loop ═══════════════════════ */

let frames = 0, fpsTime = 0;
const fpsEl = document.getElementById("fps");

function loop(now) {
  const dt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;
  if (playing) time += dt;

  render();

  frames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fpsEl.textContent = Math.round(frames / fpsTime) + " fps";
    frames = 0; fpsTime = 0;
  }
  requestAnimationFrame(loop);
}

/* ═══════════════════════ UI wiring ═══════════════════════ */

const $ = id => document.getElementById(id);

function bindRange(id, key, fmt, transform) {
  const el = $(id), lbl = $("v-" + id);
  el.addEventListener("input", () => {
    const raw = parseFloat(el.value);
    P[key] = transform ? transform(raw) : raw;
    if (lbl) lbl.textContent = fmt(raw);
  });
}

bindRange("cols", "cols", v => v);
bindRange("pad", "pad", v => v + "%");
bindRange("shapeScale", "shapeScale", v => v + "%", v => v / 100);
bindRange("speed", "speed", v => v.toFixed(2));
bindRange("rot", "rot", v => v.toFixed(2) + " turn");
bindRange("scaleAmt", "scaleAmt", v => v + "%", v => v / 100);
bindRange("delayAmt", "delayAmt", v => v.toFixed(2) + " cycle");

$("aspect").addEventListener("change", e => { P.aspect = parseFloat(e.target.value); fitCanvas(); });
$("wave").addEventListener("change", e => P.wave = e.target.value);
$("quant").addEventListener("change", e => P.quant = parseInt(e.target.value));
$("delayPattern").addEventListener("change", e => P.delayPattern = e.target.value);
$("bgColor").addEventListener("input", e => P.bg = e.target.value);
$("fgColor").addEventListener("input", e => P.fg = e.target.value);
$("swapColors").addEventListener("change", e => P.swap = e.target.checked);
$("checker").addEventListener("change", e => P.checker = e.target.checked);
$("mirrorDelay").addEventListener("change", e => P.mirrorDelay = e.target.checked);
$("showFx").addEventListener("change", e => P.showFx = e.target.checked);

/* Shape picker */
const shapePicker = $("shapePicker");

function updateShapeButtons() {
  shapePicker.querySelectorAll("button").forEach(x =>
    x.classList.toggle("active", P.shapes.includes(x.dataset.shape)));
}

function selectShape(name, additive) {
  if (additive) {
    const idx = P.shapes.indexOf(name);
    if (idx >= 0) {
      if (P.shapes.length > 1) P.shapes.splice(idx, 1); // keep at least one
    } else {
      P.shapes.push(name);
    }
  } else {
    P.shapes = [name];
  }
  updateShapeButtons();
}

function addShapeButton(name, iconHTML, title) {
  const b = document.createElement("button");
  b.innerHTML = iconHTML;
  b.title = title || name;
  b.dataset.shape = name;
  if (P.shapes.includes(name)) b.classList.add("active");
  b.addEventListener("click", e =>
    selectShape(name, e.ctrlKey || e.metaKey || e.shiftKey));
  shapePicker.appendChild(b);
  return b;
}

for (const name of Object.keys(SHAPES)) {
  addShapeButton(name,
    `<svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">${SHAPE_ICONS[name]}</svg>`);
}

/* ── Custom SVG shapes ── */

let customCounter = 0;
const CUSTOM_SHAPES = {}; // name -> { img, svgText, tinted, tintColor }

function prepareSvg(text) {
  // Parse and make sure the SVG has explicit pixel dimensions,
  // otherwise drawImage renders it at 0×0 in some browsers.
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== "svg") return null;
  if (!svg.getAttribute("width") || !svg.getAttribute("height")) {
    const vb = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
    const w = vb[2] > 0 ? vb[2] : 100;
    const h = vb[3] > 0 ? vb[3] : 100;
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
  }
  return new XMLSerializer().serializeToString(svg);
}

function tintedCanvas(entry, color) {
  // Cache a recolored copy of the SVG (silhouette in the given color)
  if (entry.tinted && entry.tintColor === color) return entry.tinted;
  const iw = entry.img.naturalWidth || 1, ih = entry.img.naturalHeight || 1;
  const scale = 512 / Math.max(iw, ih);
  const oc = document.createElement("canvas");
  oc.width = Math.max(1, Math.round(iw * scale));
  oc.height = Math.max(1, Math.round(ih * scale));
  const octx = oc.getContext("2d");
  octx.drawImage(entry.img, 0, 0, oc.width, oc.height);
  octx.globalCompositeOperation = "source-in";
  octx.fillStyle = color;
  octx.fillRect(0, 0, oc.width, oc.height);
  entry.tinted = oc;
  entry.tintColor = color;
  return oc;
}

function addCustomShape(fileName, svgText) {
  // Resolves with the new shape's name (or null if the file was invalid)
  return new Promise(resolve => {
    const cleaned = prepareSvg(svgText);
    if (!cleaned) {
      alert(`"${fileName}" is not a valid SVG file.`);
      resolve(null);
      return;
    }

    const url = URL.createObjectURL(new Blob([cleaned], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      const name = "custom" + (++customCounter);
      const entry = { img, svgText: cleaned, tinted: null, tintColor: null };
      CUSTOM_SHAPES[name] = entry;

      SHAPES[name] = (c, s) => {
        const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
        const ar = iw / ih;
        let dw = s, dh = s;
        if (ar > 1) dh = s / ar; else dw = s * ar;
        const src = P.tintSvg ? tintedCanvas(entry, currentFg) : img;
        c.drawImage(src, -dw / 2, -dh / 2, dw, dh);
      };

      const b = addShapeButton(name, `<img src="${url}" alt="">`,
        fileName + " — right-click to remove");
      b.addEventListener("contextmenu", e => {
        e.preventDefault();
        delete SHAPES[name];
        delete CUSTOM_SHAPES[name];
        b.remove();
        URL.revokeObjectURL(url);
        P.shapes = P.shapes.filter(s => s !== name);
        if (P.shapes.length === 0) P.shapes = ["triangle"];
        updateShapeButtons();
      });
      resolve(name);
    };
    img.onerror = () => { alert(`Could not load "${fileName}".`); resolve(null); };
    img.src = url;
  });
}

$("uploadSvg").addEventListener("click", () => $("svgFile").click());
$("svgFile").addEventListener("change", async e => {
  const files = [...e.target.files];
  e.target.value = "";
  const names = [];
  for (const file of files) {
    const name = await addCustomShape(file.name, await file.text());
    if (name) names.push(name);
  }
  if (names.length) {
    // Select all shapes uploaded in this batch together
    P.shapes = names;
    updateShapeButtons();
  }
});
$("tintSvg").addEventListener("change", e => P.tintSvg = e.target.checked);

/* Play / pause */
const btnPlay = $("btnPlay");
function togglePlay() {
  playing = !playing;
  btnPlay.textContent = playing ? "⏸ Pause" : "▶ Play";
  btnPlay.classList.toggle("primary", playing);
}
btnPlay.addEventListener("click", togglePlay);

/* Randomize */
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rnd(min, max) { return min + Math.random() * (max - min); }

function randomize() {
  P.shapes = [pick(Object.keys(SHAPES))];
  P.cols = Math.round(rnd(8, 36));
  P.speed = rnd(0.1, 0.6);
  P.wave = pick(["spin", "sine", "pingpong", "step", "pulse"]);
  P.rot = rnd(0.25, 1.5);
  P.delayPattern = pick(["linearX", "linearY", "diagonal", "radial", "spiral", "checker", "random"]);
  P.delayAmt = rnd(0.5, 2.5);
  P.quant = pick([0, 0, 0, 4, 2]);
  P.checker = Math.random() < 0.35;
  P.mirrorDelay = Math.random() < 0.3;
  P.scaleAmt = Math.random() < 0.3 ? rnd(0.1, 0.5) : 0;
  syncUI();
}

function syncUI() {
  $("cols").value = P.cols; $("v-cols").textContent = P.cols;
  $("speed").value = P.speed; $("v-speed").textContent = P.speed.toFixed(2);
  $("rot").value = P.rot; $("v-rot").textContent = P.rot.toFixed(2) + " turn";
  $("scaleAmt").value = P.scaleAmt * 100; $("v-scaleAmt").textContent = Math.round(P.scaleAmt * 100) + "%";
  $("delayAmt").value = P.delayAmt; $("v-delayAmt").textContent = P.delayAmt.toFixed(2) + " cycle";
  $("wave").value = P.wave;
  $("quant").value = P.quant;
  $("delayPattern").value = P.delayPattern;
  $("checker").checked = P.checker;
  $("mirrorDelay").checked = P.mirrorDelay;
  updateShapeButtons();
}
$("btnRandom").addEventListener("click", randomize);

/* Export */
function download(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportPNG() {
  const showFxPrev = P.showFx;
  P.showFx = false;
  render();
  cv.toBlob(blob => {
    download(blob, "graphism-" + Date.now() + ".png");
    P.showFx = showFxPrev;
  }, "image/png");
}
$("btnExportPng").addEventListener("click", exportPNG);

/* Unit-size (1×1, centered) vector versions of the built-in shapes */
const SVG_SHAPE_DEFS = {
  triangle:   '<path d="M-.5-.5 L.5.5 L-.5.5 Z"/>',
  quarter:    '<path d="M-.5.5 L-.5-.5 A1 1 0 0 1 .5.5 Z"/>',
  half:       '<path d="M0 .5 A.5 .5 0 0 1 0 -.5 Z"/>',
  bar:        '<rect x="-.5" y="-.16667" width="1" height=".33333"/>',
  halfSquare: '<rect x="-.5" y="0" width="1" height=".5"/>',
  circle:     '<circle cx="0" cy="0" r=".5"/>',
  bowtie:     '<path d="M-.5-.5 L0 0 L-.5.5 Z M.5-.5 L0 0 L.5.5 Z"/>',
  hook:       '<path d="M-.5-.5 L.5-.5 L.5.5 Q-.5.5 -.5-.5 Z"/>',
};

function exportSVG() {
  const w = cv.width, h = cv.height;
  const bg = P.swap ? P.fg : P.bg;
  const fg = P.swap ? P.bg : P.fg;

  const cols = P.cols;
  const cell = w / cols;
  const rows = Math.max(1, Math.round(h / cell));
  const cellH = h / rows;
  const size = Math.min(cell, cellH);
  const fxState = getFxState(w, h);

  const n = v => +v.toFixed(2); // trim decimals to keep the file small

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
  );

  // One shape definition per selected shape (unit size, referenced by cells)
  parts.push("<defs>");
  const needsTintFilter = P.tintSvg && P.shapes.some(s => CUSTOM_SHAPES[s]);
  if (needsTintFilter) {
    parts.push(
      `<filter id="tint" x="-10%" y="-10%" width="120%" height="120%">` +
      `<feFlood flood-color="${fg}"/>` +
      `<feComposite in2="SourceAlpha" operator="in"/>` +
      `</filter>`
    );
  }
  P.shapes.forEach((shapeName, idx) => {
    const custom = CUSTOM_SHAPES[shapeName];
    if (custom) {
      const iw = custom.img.naturalWidth || 1, ih = custom.img.naturalHeight || 1;
      const ar = iw / ih;
      const dw = ar > 1 ? 1 : ar;
      const dh = ar > 1 ? 1 / ar : 1;
      const uri = "data:image/svg+xml;base64," +
        btoa(unescape(encodeURIComponent(custom.svgText)));
      parts.push(
        `<g id="s${idx}"><image href="${uri}" xlink:href="${uri}" ` +
        `x="${-dw / 2}" y="${-dh / 2}" width="${dw}" height="${dh}" ` +
        `preserveAspectRatio="xMidYMid meet"` +
        (P.tintSvg ? ` filter="url(#tint)"` : ``) + `/></g>`
      );
    } else {
      parts.push(`<g id="s${idx}">${SVG_SHAPE_DEFS[shapeName]}</g>`);
    }
  });
  parts.push("</defs>");

  parts.push(`<rect width="${w}" height="${h}" fill="${bg}"/>`);
  parts.push(`<g fill="${fg}">`);

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const c = cellState(i, j, cols, rows, cell, cellH, fxState);
      if (c.scl <= 0.01) continue;
      const k = size * c.scl;
      const deg = c.rot * 180 / Math.PI;
      const sx = c.flip ? -k : k;
      const sid = "#s" + P.shapes.indexOf(cellShape(i, j));
      parts.push(
        `<use href="${sid}" xlink:href="${sid}" transform="translate(${n(c.cx)} ${n(c.cy)}) ` +
        `rotate(${n(deg)}) scale(${n(sx)} ${n(k)})"/>`
      );
    }
  }

  parts.push("</g></svg>");

  download(
    new Blob([parts.join("\n")], { type: "image/svg+xml" }),
    "graphism-" + Date.now() + ".svg"
  );
}
$("btnExportSvg").addEventListener("click", exportSVG);

/* Keyboard shortcuts */
window.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.code === "Space") { e.preventDefault(); togglePlay(); }
  if (e.key === "r" || e.key === "R") randomize();
  if (e.key === "e" || e.key === "E") exportPNG();
  if (e.key === "s" || e.key === "S") exportSVG();
});

/* ═══════════════════════ Effector UI ═══════════════════════ */

const fxList = $("fxList");

function fxSlider(fx, key, label, min, max, step, fmt) {
  const wrap = document.createElement("div");
  wrap.className = "ctl";
  const lbl = document.createElement("label");
  const valSpan = document.createElement("span");
  valSpan.className = "val";
  valSpan.textContent = fmt(fx[key]);
  lbl.append(label, valSpan);
  const input = document.createElement("input");
  input.type = "range";
  input.min = min; input.max = max; input.step = step;
  input.value = fx[key];
  input.addEventListener("input", () => {
    fx[key] = parseFloat(input.value);
    valSpan.textContent = fmt(fx[key]);
  });
  wrap.append(lbl, input);
  return wrap;
}

function fxSelect(fx, key, label, options) {
  const wrap = document.createElement("div");
  wrap.className = "ctl";
  const lbl = document.createElement("label");
  lbl.textContent = label;
  const sel = document.createElement("select");
  for (const [val, text] of options) {
    const o = document.createElement("option");
    o.value = val; o.textContent = text;
    sel.appendChild(o);
  }
  sel.value = fx[key];
  sel.addEventListener("change", () => fx[key] = sel.value);
  wrap.append(lbl, sel);
  return wrap;
}

function buildFxUI() {
  fxList.innerHTML = "";
  for (const fx of effectors) {
    const card = document.createElement("div");
    card.className = "fx-card";

    const head = document.createElement("div");
    head.className = "fx-head";
    const title = document.createElement("b");
    title.innerHTML = `<span class="dot" style="background:${fx.color}"></span>Effector ${fx.id}`;
    const actions = document.createElement("div");
    actions.className = "fx-actions";

    const btnToggle = document.createElement("button");
    btnToggle.className = "small";
    btnToggle.textContent = fx.enabled ? "On" : "Off";
    btnToggle.addEventListener("click", () => {
      fx.enabled = !fx.enabled;
      btnToggle.textContent = fx.enabled ? "On" : "Off";
    });

    const btnDel = document.createElement("button");
    btnDel.className = "small danger";
    btnDel.textContent = "✕";
    btnDel.addEventListener("click", () => {
      effectors = effectors.filter(f => f !== fx);
      buildFxUI();
    });

    actions.append(btnToggle, btnDel);
    head.append(title, actions);
    card.appendChild(head);

    card.appendChild(fxSelect(fx, "target", "Affects", [
      ["rotation", "Rotation"],
      ["scale", "Scale"],
      ["phase", "Phase / delay"],
    ]));
    card.appendChild(fxSelect(fx, "path", "Path", [
      ["orbit", "Orbit (circle)"],
      ["lissajous", "Lissajous"],
      ["figure8", "Figure 8"],
      ["sweepX", "Sweep ↔ horizontal"],
      ["sweepY", "Sweep ↕ vertical"],
    ]));
    card.appendChild(fxSlider(fx, "speed", "Speed", 0, 1.5, 0.01, v => (+v).toFixed(2)));
    card.appendChild(fxSlider(fx, "pathSize", "Path size", 0.05, 0.6, 0.01, v => Math.round(v * 100) + "%"));
    card.appendChild(fxSlider(fx, "radius", "Influence radius", 0.05, 0.7, 0.01, v => Math.round(v * 100) + "%"));
    card.appendChild(fxSlider(fx, "strength", "Strength", 0, 2, 0.01, v => (+v).toFixed(2)));
    card.appendChild(fxSlider(fx, "pulse", "Pulse amount", 0, 1, 0.01, v => Math.round(v * 100) + "%"));
    card.appendChild(fxSlider(fx, "pulseSpeed", "Pulse speed", 0, 3, 0.01, v => (+v).toFixed(2)));

    fxList.appendChild(card);
  }
}

$("addEffector").addEventListener("click", () => makeEffector());

/* ═══════════════════════ Go ═══════════════════════ */

fitCanvas();
requestAnimationFrame(loop);

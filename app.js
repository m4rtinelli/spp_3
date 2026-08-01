"use strict";

/* ═══════════════════════ Global settings ═══════════════════════ */

const G = {
  aspect: 1,
  bg: "#ffffff",
  cols: 18,
  showFx: true,
  tintSvg: true,
};

/* Shape mask: an uploaded SVG whose silhouette defines WHERE cells exist —
   shapes are only generated in grid cells that fall inside the outline */
const MASK = { img: null, svgText: null, scale: 1, invert: false, enabled: true, version: 0 };

function maskRect(w, h) {
  // Fit the mask inside the canvas (contain, centered), scaled by MASK.scale
  const iw = MASK.img.naturalWidth || 1, ih = MASK.img.naturalHeight || 1;
  const k = Math.min(w / iw, h / ih) * MASK.scale;
  const dw = iw * k, dh = ih * k;
  return { x: (w - dw) / 2, y: (h - dh) / 2, dw, dh };
}

/* Per-cell occupancy map: the SVG is rasterized at one pixel per grid cell,
   so each pixel's alpha ≈ how much of that cell the silhouette covers.
   Cached until the mask, grid or canvas size changes. */
let maskMap = null;
let maskMapKey = "";

function getMaskMap(w, h, cols, rows, cell, cellH) {
  if (!(MASK.enabled && MASK.img)) return null;
  const key = [w, h, cols, rows, MASK.scale, MASK.invert, MASK.version].join("|");
  if (key === maskMapKey && maskMap) return maskMap;

  const oc = document.createElement("canvas");
  oc.width = cols;
  oc.height = rows;
  const octx = oc.getContext("2d", { willReadFrequently: true });
  const r = maskRect(w, h);
  octx.drawImage(MASK.img, r.x / cell, r.y / cellH, r.dw / cell, r.dh / cellH);

  const data = octx.getImageData(0, 0, cols, rows).data;
  maskMap = new Uint8Array(cols * rows);
  for (let k = 0; k < maskMap.length; k++) {
    const inside = data[k * 4 + 3] >= 128; // cell counts if ≥50% covered
    maskMap[k] = inside !== MASK.invert ? 1 : 0;
  }
  maskMapKey = key;
  return maskMap;
}

/* ═══════════════════════ Layers ═══════════════════════ */
/* Each layer has its own shapes, color, motion and delay parameters */

const LAYER_COLORS = ["#000000", "#e8382f", "#2653d9", "#0c9e6e", "#f2a11c", "#9b3fd1"];
let layerCounter = 0;

function makeLayer() {
  return {
    id: ++layerCounter,
    visible: true,
    shapes: ["triangle"], // >1 = random mix across the grid
    fg: LAYER_COLORS[(layerCounter - 1) % LAYER_COLORS.length],
    shapeScale: 1,
    pad: 0,
    checker: false,
    speed: 0.25,
    wave: "sine",
    rot: 0.5,          // turns
    scaleAmt: 0,       // 0..1
    quant: 0,          // rotation steps (0 = off)
    delayPattern: "diagonal",
    delayAmt: 1,       // cycles
    mirrorDelay: false,
  };
}

let layers = [makeLayer()];
let activeLayer = 0;
const activeL = () => layers[activeLayer];

let currentFg = "#000000"; // color of the layer being drawn, used to tint custom SVGs

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
  let w = availW, h = w / G.aspect;
  if (h > availH) { h = availH; w = h * G.aspect; }
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

function cellDelay(ly, i, j, cols, rows) {
  const u = cols > 1 ? i / (cols - 1) : 0.5;
  const v = rows > 1 ? j / (rows - 1) : 0.5;
  let d;
  switch (ly.delayPattern) {
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
  if (ly.mirrorDelay) d = Math.abs(d - 0.5) * 2;
  return d;
}

/* ═══════════════════════ Wave functions ═══════════════════════ */
/* Map a phase (in cycles) to an oscillation value */

function waveValue(ly, phase) {
  const p = phase - Math.floor(phase); // fractional cycle 0..1
  switch (ly.wave) {
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

function cellShape(ly, li, i, j) {
  // Stable random assignment when several shapes are selected.
  // Seeds are offset per layer so layers don't share the same arrangement,
  // and don't correlate with the "random" delay pattern.
  const names = ly.shapes;
  if (names.length === 1) return names[0];
  const idx = Math.floor(hash2(i + 101 + li * 31, j + 57 + li * 17) * names.length);
  return names[Math.min(idx, names.length - 1)];
}

function cellState(ly, i, j, cols, rows, cell, cellH, fxState) {
  const cx = (i + 0.5) * cell;
  const cy = (j + 0.5) * cellH;

  let phase = time * ly.speed - cellDelay(ly, i, j, cols, rows) * ly.delayAmt;
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

  let rot = waveValue(ly, phase) * Math.PI * 2 * ly.rot + extraRot;

  if (ly.quant > 0) {
    const step = (Math.PI * 2) / ly.quant;
    rot = Math.round(rot / step) * step;
  }

  let scl = ly.shapeScale * (1 - ly.pad / 100);
  if (ly.scaleAmt > 0) {
    scl *= 1 + Math.sin(phase * Math.PI * 2) * ly.scaleAmt * 0.5;
  }
  scl *= 1 + extraScale * 0.8;

  const flip = ly.checker && ((i + j) % 2 === 1);
  return { cx, cy, rot, scl, flip };
}

/* ═══════════════════════ Render ═══════════════════════ */

function render() {
  const w = cv.width, h = cv.height;
  if (w === 0 || h === 0) return;

  ctx.fillStyle = G.bg;
  ctx.fillRect(0, 0, w, h);

  const cols = G.cols;
  const cell = w / cols;
  const rows = Math.max(1, Math.round(h / cell));
  const cellH = h / rows;
  const size = Math.min(cell, cellH);

  const fxState = getFxState(w, h);

  // Shape mask: cells outside the SVG silhouette are skipped entirely
  const mm = getMaskMap(w, h, cols, rows, cell, cellH);

  layers.forEach((ly, li) => {
    if (!ly.visible) return;
    currentFg = ly.fg;
    ctx.fillStyle = ly.fg;

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if (mm && !mm[j * cols + i]) continue;
        const c = cellState(ly, i, j, cols, rows, cell, cellH, fxState);
        if (c.scl <= 0.01) continue;

        ctx.save();
        ctx.translate(c.cx, c.cy);
        ctx.rotate(c.rot);
        if (c.flip) ctx.scale(-1, 1);
        SHAPES[cellShape(ly, li, i, j)](ctx, size * c.scl);
        ctx.restore();
      }
    }
  });

  // Effector outlines
  if (G.showFx) {
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

/* Global controls */
$("cols").addEventListener("input", e => {
  G.cols = parseFloat(e.target.value);
  $("v-cols").textContent = G.cols;
});
$("aspect").addEventListener("change", e => { G.aspect = parseFloat(e.target.value); fitCanvas(); });
$("bgColor").addEventListener("input", e => G.bg = e.target.value);
$("showFx").addEventListener("change", e => G.showFx = e.target.checked);
$("tintSvg").addEventListener("change", e => G.tintSvg = e.target.checked);

/* Per-layer controls: every change writes to the active layer */
const LAYER_RANGES = [
  // [element id, layer key, label formatter, value transform]
  ["pad",        "pad",        v => v + "%",              v => v],
  ["shapeScale", "shapeScale", v => v + "%",              v => v / 100],
  ["speed",      "speed",      v => v.toFixed(2),         v => v],
  ["rot",        "rot",        v => v.toFixed(2) + " turn", v => v],
  ["scaleAmt",   "scaleAmt",   v => v + "%",              v => v / 100],
  ["delayAmt",   "delayAmt",   v => v.toFixed(2) + " cycle", v => v],
];

for (const [id, key, fmt, transform] of LAYER_RANGES) {
  $(id).addEventListener("input", e => {
    const raw = parseFloat(e.target.value);
    activeL()[key] = transform(raw);
    $("v-" + id).textContent = fmt(raw);
  });
}

$("wave").addEventListener("change", e => activeL().wave = e.target.value);
$("quant").addEventListener("change", e => activeL().quant = parseInt(e.target.value));
$("delayPattern").addEventListener("change", e => activeL().delayPattern = e.target.value);
$("checker").addEventListener("change", e => activeL().checker = e.target.checked);
$("mirrorDelay").addEventListener("change", e => activeL().mirrorDelay = e.target.checked);
$("fgColor").addEventListener("input", e => {
  activeL().fg = e.target.value;
  buildLayerUI(); // refresh the swatch in the layer list
});

/* Push the active layer's values into all per-layer controls */
function syncLayerUI() {
  const ly = activeL();
  const inv = {
    pad: ly.pad, shapeScale: ly.shapeScale * 100, speed: ly.speed,
    rot: ly.rot, scaleAmt: ly.scaleAmt * 100, delayAmt: ly.delayAmt,
  };
  for (const [id, , fmt] of LAYER_RANGES) {
    $(id).value = inv[id];
    $("v-" + id).textContent = fmt(inv[id]);
  }
  $("wave").value = ly.wave;
  $("quant").value = ly.quant;
  $("delayPattern").value = ly.delayPattern;
  $("checker").checked = ly.checker;
  $("mirrorDelay").checked = ly.mirrorDelay;
  $("fgColor").value = ly.fg;
  updateShapeButtons();
  document.querySelectorAll(".lyr-ind").forEach(el =>
    el.textContent = "L" + (activeLayer + 1));
}

/* ═══════════════════════ Layer list UI ═══════════════════════ */

const layerList = $("layerList");

function buildLayerUI() {
  layerList.innerHTML = "";
  layers.forEach((ly, idx) => {
    const row = document.createElement("div");
    row.className = "layer-row" +
      (idx === activeLayer ? " active" : "") +
      (ly.visible ? "" : " off");

    const sw = document.createElement("span");
    sw.className = "sw";
    sw.style.background = ly.fg;

    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = "Layer " + (idx + 1);

    const btnVis = document.createElement("button");
    btnVis.className = "small";
    btnVis.textContent = ly.visible ? "👁" : "—";
    btnVis.title = ly.visible ? "Hide layer" : "Show layer";
    btnVis.addEventListener("click", e => {
      e.stopPropagation();
      ly.visible = !ly.visible;
      buildLayerUI();
    });

    row.append(sw, name, btnVis);

    if (layers.length > 1) {
      const btnDel = document.createElement("button");
      btnDel.className = "small danger";
      btnDel.textContent = "✕";
      btnDel.title = "Delete layer";
      btnDel.addEventListener("click", e => {
        e.stopPropagation();
        layers.splice(idx, 1);
        if (activeLayer >= layers.length) activeLayer = layers.length - 1;
        buildLayerUI();
        syncLayerUI();
      });
      row.appendChild(btnDel);
    }

    row.addEventListener("click", () => {
      activeLayer = idx;
      buildLayerUI();
      syncLayerUI();
    });

    layerList.appendChild(row);
  });
}

$("addLayer").addEventListener("click", () => {
  layers.push(makeLayer());
  activeLayer = layers.length - 1;
  buildLayerUI();
  syncLayerUI();
});

/* ═══════════════════════ Shape picker ═══════════════════════ */

const shapePicker = $("shapePicker");

function updateShapeButtons() {
  shapePicker.querySelectorAll("button").forEach(x =>
    x.classList.toggle("active", activeL().shapes.includes(x.dataset.shape)));
}

function selectShape(name, additive) {
  const shapes = activeL().shapes;
  if (additive) {
    const idx = shapes.indexOf(name);
    if (idx >= 0) {
      if (shapes.length > 1) shapes.splice(idx, 1); // keep at least one
    } else {
      shapes.push(name);
    }
  } else {
    activeL().shapes = [name];
  }
  updateShapeButtons();
}

function addShapeButton(name, iconHTML, title) {
  const b = document.createElement("button");
  b.innerHTML = iconHTML;
  b.title = title || name;
  b.dataset.shape = name;
  if (activeL().shapes.includes(name)) b.classList.add("active");
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
const CUSTOM_SHAPES = {}; // name -> { img, svgText, tints }

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
  // Cache recolored copies of the SVG, one per layer color
  const cached = entry.tints.get(color);
  if (cached) return cached;
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
  entry.tints.set(color, oc);
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
      const entry = { img, svgText: cleaned, tints: new Map() };
      CUSTOM_SHAPES[name] = entry;

      SHAPES[name] = (c, s) => {
        const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
        const ar = iw / ih;
        let dw = s, dh = s;
        if (ar > 1) dh = s / ar; else dw = s * ar;
        const src = G.tintSvg ? tintedCanvas(entry, currentFg) : img;
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
        for (const ly of layers) {
          ly.shapes = ly.shapes.filter(s => s !== name);
          if (ly.shapes.length === 0) ly.shapes = ["triangle"];
        }
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
    // Select all shapes uploaded in this batch together (on the active layer)
    activeL().shapes = names;
    updateShapeButtons();
  }
});

/* ── Clip mask ── */

let maskUrl = null;

$("uploadMask").addEventListener("click", () => $("maskFile").click());
$("maskFile").addEventListener("change", async e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const cleaned = prepareSvg(await file.text());
  if (!cleaned) { alert(`"${file.name}" is not a valid SVG file.`); return; }
  if (maskUrl) URL.revokeObjectURL(maskUrl);
  maskUrl = URL.createObjectURL(new Blob([cleaned], { type: "image/svg+xml" }));
  const img = new Image();
  img.onload = () => {
    MASK.img = img;
    MASK.svgText = cleaned;
    MASK.version++;
    $("maskName").textContent = file.name;
    $("maskControls").style.display = "block";
  };
  img.onerror = () => alert(`Could not load "${file.name}".`);
  img.src = maskUrl;
});

$("maskScale").addEventListener("input", e => {
  MASK.scale = parseFloat(e.target.value) / 100;
  $("v-maskScale").textContent = e.target.value + "%";
});
$("maskEnabled").addEventListener("change", e => MASK.enabled = e.target.checked);
$("maskInvert").addEventListener("change", e => MASK.invert = e.target.checked);
$("removeMask").addEventListener("click", () => {
  MASK.img = null;
  MASK.svgText = null;
  if (maskUrl) { URL.revokeObjectURL(maskUrl); maskUrl = null; }
  $("maskControls").style.display = "none";
});

/* ═══════════════════════ Play / pause ═══════════════════════ */

const btnPlay = $("btnPlay");
function togglePlay() {
  playing = !playing;
  btnPlay.textContent = playing ? "⏸ Pause" : "▶ Play";
  btnPlay.classList.toggle("primary", playing);
}
btnPlay.addEventListener("click", togglePlay);

/* ═══════════════════════ Randomize ═══════════════════════ */

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rnd(min, max) { return min + Math.random() * (max - min); }

function randomize() {
  G.cols = Math.round(rnd(8, 36));
  $("cols").value = G.cols;
  $("v-cols").textContent = G.cols;

  for (const ly of layers) {
    ly.shapes = [pick(Object.keys(SHAPES))];
    ly.speed = rnd(0.1, 0.6);
    ly.wave = pick(["spin", "sine", "pingpong", "step", "pulse"]);
    ly.rot = rnd(0.25, 1.5);
    ly.delayPattern = pick(["linearX", "linearY", "diagonal", "radial", "spiral", "checker", "random"]);
    ly.delayAmt = rnd(0.5, 2.5);
    ly.quant = pick([0, 0, 0, 4, 2]);
    ly.checker = Math.random() < 0.35;
    ly.mirrorDelay = Math.random() < 0.3;
    ly.scaleAmt = Math.random() < 0.3 ? rnd(0.1, 0.5) : 0;
  }
  syncLayerUI();
}
$("btnRandom").addEventListener("click", randomize);

/* ═══════════════════════ Export ═══════════════════════ */

function download(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportPNG() {
  const showFxPrev = G.showFx;
  G.showFx = false;
  render();
  cv.toBlob(blob => {
    download(blob, "graphism-" + Date.now() + ".png");
    G.showFx = showFxPrev;
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

  const cols = G.cols;
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

  // Shape mask: same per-cell occupancy map as the canvas renderer,
  // so masked-out cells simply don't exist in the exported file
  const mm = getMaskMap(w, h, cols, rows, cell, cellH);

  // One def per shape per layer (ids: s{layer}-{shape index})
  parts.push("<defs>");
  layers.forEach((ly, li) => {
    if (!ly.visible) return;
    if (G.tintSvg && ly.shapes.some(s => CUSTOM_SHAPES[s])) {
      parts.push(
        `<filter id="tint${li}" x="-10%" y="-10%" width="120%" height="120%">` +
        `<feFlood flood-color="${ly.fg}"/>` +
        `<feComposite in2="SourceAlpha" operator="in"/>` +
        `</filter>`
      );
    }
    ly.shapes.forEach((shapeName, idx) => {
      const custom = CUSTOM_SHAPES[shapeName];
      if (custom) {
        const iw = custom.img.naturalWidth || 1, ih = custom.img.naturalHeight || 1;
        const ar = iw / ih;
        const dw = ar > 1 ? 1 : ar;
        const dh = ar > 1 ? 1 / ar : 1;
        const uri = "data:image/svg+xml;base64," +
          btoa(unescape(encodeURIComponent(custom.svgText)));
        parts.push(
          `<g id="s${li}-${idx}"><image href="${uri}" xlink:href="${uri}" ` +
          `x="${-dw / 2}" y="${-dh / 2}" width="${dw}" height="${dh}" ` +
          `preserveAspectRatio="xMidYMid meet"` +
          (G.tintSvg ? ` filter="url(#tint${li})"` : ``) + `/></g>`
        );
      } else {
        parts.push(`<g id="s${li}-${idx}">${SVG_SHAPE_DEFS[shapeName]}</g>`);
      }
    });
  });
  parts.push("</defs>");

  parts.push(`<rect width="${w}" height="${h}" fill="${G.bg}"/>`);

  layers.forEach((ly, li) => {
    if (!ly.visible) return;
    parts.push(`<g fill="${ly.fg}">`);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if (mm && !mm[j * cols + i]) continue;
        const c = cellState(ly, i, j, cols, rows, cell, cellH, fxState);
        if (c.scl <= 0.01) continue;
        const k = size * c.scl;
        const deg = c.rot * 180 / Math.PI;
        const sx = c.flip ? -k : k;
        const sid = `#s${li}-${ly.shapes.indexOf(cellShape(ly, li, i, j))}`;
        parts.push(
          `<use href="${sid}" xlink:href="${sid}" transform="translate(${n(c.cx)} ${n(c.cy)}) ` +
          `rotate(${n(deg)}) scale(${n(sx)} ${n(k)})"/>`
        );
      }
    }
    parts.push("</g>");
  });

  parts.push("</svg>");

  download(
    new Blob([parts.join("\n")], { type: "image/svg+xml" }),
    "graphism-" + Date.now() + ".svg"
  );
}
$("btnExportSvg").addEventListener("click", exportSVG);

/* ═══════════════════════ Video export ═══════════════════════ */

const btnRecord = $("btnRecord");
let recording = false;

function pickVideoMime() {
  // Prefer MP4 (H.264) when the browser can record it, fall back to WebM
  const candidates = [
    'video/mp4;codecs="avc1.640028"',
    "video/mp4",
    'video/webm;codecs="vp9"',
    'video/webm;codecs="vp8"',
    "video/webm",
  ];
  if (typeof MediaRecorder === "undefined") return null;
  return candidates.find(m => MediaRecorder.isTypeSupported(m)) || null;
}

function startRecording() {
  if (recording) return;
  const seconds = parseInt($("recDur").value);
  const mime = pickVideoMime();
  if (!mime) {
    alert("Video recording is not supported in this browser.");
    return;
  }

  const stream = cv.captureStream(60);
  const rec = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: 20_000_000, // high quality
  });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  // Record a clean canvas: hide effector outlines, make sure motion runs
  const prevShowFx = G.showFx;
  const wasPlaying = playing;
  G.showFx = false;
  if (!playing) togglePlay();
  recording = true;
  btnRecord.classList.add("recording");
  btnRecord.disabled = true;

  const t0 = performance.now();
  const timer = setInterval(() => {
    const left = Math.max(0, seconds - (performance.now() - t0) / 1000);
    btnRecord.textContent = "⏺ " + left.toFixed(1) + "s";
  }, 100);

  rec.onstop = () => {
    clearInterval(timer);
    const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
    download(new Blob(chunks, { type: mime }), `graphism-${Date.now()}.${ext}`);
    G.showFx = prevShowFx;
    if (!wasPlaying) togglePlay(); // restore paused state
    recording = false;
    btnRecord.classList.remove("recording");
    btnRecord.disabled = false;
    btnRecord.textContent = "⏺ Record";
  };

  rec.start();
  setTimeout(() => { if (rec.state !== "inactive") rec.stop(); }, seconds * 1000);
}
btnRecord.addEventListener("click", startRecording);

/* ═══════════════════════ Keyboard shortcuts ═══════════════════════ */

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
buildLayerUI();
syncLayerUI();
requestAnimationFrame(loop);

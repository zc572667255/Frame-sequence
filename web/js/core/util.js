// Small shared helpers: ids, clamping, DOM building, canvas plumbing.

export function uid(prefix = "") {
  return prefix + Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 7);
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function clampInt(v, min, max) {
  let n = parseInt(v, 10);
  if (isNaN(n)) n = min;
  return clamp(n, min, max);
}

export function clampNum(v, min, max, fallback) {
  let n = parseFloat(v);
  if (isNaN(n)) n = fallback;
  return clamp(n, min, max);
}

export function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  };
  d.flush = (...args) => { if (t) { clearTimeout(t); t = null; fn(...args); } };
  d.cancel = () => { clearTimeout(t); t = null; };
  return d;
}

export function nextPaint() {
  // two frames: the first lets layout happen, the second guarantees a paint
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

// el("div", { class: "x", onclick: fn, style: {...}, dataset: {...} }, ...children)
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (k in node && typeof v !== "string") node[k] = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

// a worker whose drawing is mostly read back (trails/strokeworker.js) keeps its
// canvases in memory: on the GPU each read there waits on everything drawn so
// far, half a second and more for a glow trail. Effects, read back seldom, are
// faster left on the GPU.
let cpuCanvases = false;
export function workerCanvasesInMemory() { cpuCanvases = true; }

export function createCanvas(w, h) {
  // in a worker (vfx/worker.js) there is no document: an OffscreenCanvas draws the same
  if (typeof document === "undefined") {
    const c = new OffscreenCanvas(Math.max(1, w | 0), Math.max(1, h | 0));
    if (cpuCanvases) {
      const get = c.getContext;
      c.getContext = (type, opts) => get.call(c, type, type === "2d" ? { ...opts, willReadFrequently: true } : opts);
    }
    return c;
  }
  const c = document.createElement("canvas");
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  return c;
}

export function ctx2d(canvas, readFrequently) {
  return canvas.getContext("2d", readFrequently ? { willReadFrequently: true } : undefined);
}

export function imageDataOf(src) {
  const w = src.width, h = src.height;
  const c = createCanvas(w, h);
  const ctx = ctx2d(c, true);
  ctx.drawImage(src, 0, 0);
  return ctx.getImageData(0, 0, w, h);
}

export function canvasFromImageData(id) {
  const c = createCanvas(id.width, id.height);
  c.getContext("2d").putImageData(id, 0, 0);
  return c;
}

export function cloneCanvas(src) {
  const c = createCanvas(src.width, src.height);
  c.getContext("2d").drawImage(src, 0, 0);
  return c;
}

export function canvasToBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("浏览器没能生成图片，可能是尺寸过大"))), type, quality);
  });
}

export function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export async function blobToCanvas(blob) {
  const bmp = await createImageBitmap(blob);
  const c = createCanvas(bmp.width, bmp.height);
  c.getContext("2d").drawImage(bmp, 0, 0);
  bmp.close && bmp.close();
  return c;
}

export function rgbToHex(c) {
  return "#" + [c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function hexToRgb(h) {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

// Map a pointer event to source-pixel coordinates on a canvas shown with
// `object-fit: contain`. getBoundingClientRect already includes the board's CSS
// zoom, so this stays right at any canvas zoom level.
export function canvasPoint(canvas, e) {
  const r = canvas.getBoundingClientRect();
  const s = Math.min(r.width / canvas.width, r.height / canvas.height);
  const ox = (r.width - canvas.width * s) / 2, oy = (r.height - canvas.height * s) / 2;
  return {
    x: Math.floor((e.clientX - r.left - ox) / s),
    y: Math.floor((e.clientY - r.top - oy) / s),
    scale: s,
  };
}

// get/set "a.b.c" style paths into params objects
export function getPath(obj, key) {
  let o = obj;
  for (const k of key.split(".")) { if (o == null) return undefined; o = o[k]; }
  return o;
}
export function setPath(obj, key, value) {
  const ks = key.split(".");
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) {
    if (o[ks[i]] == null || typeof o[ks[i]] !== "object") o[ks[i]] = {};
    o = o[ks[i]];
  }
  o[ks[ks.length - 1]] = value;
}

export function fmtBytes(n) {
  return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB";
}

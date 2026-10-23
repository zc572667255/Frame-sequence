// 特效图层: a layer of an animation that is an effect (vfx/effects.js) placed
// on the canvas — a `vfx` settings object instead of cels. It shows the
// effect's frames one per animation frame from its start frame on: a one-shot
// once, a loop until its length runs out (or to the end). Shared by the pixel
// editor and the animation card (trails/composite.js drawFrameStack).
//
// Where it is — its region, a centre and a width × height — is one of:
//   · fixed: x, y, w, h
//   · keyed per frame (perFrame): keys[frameId] = { x, y, w, h }, frames in
//     between interpolated, before the first / after the last key held
//   · following a layer (follow: layer id): that layer's outline on each
//     frame, grown by pad % — an aura that goes where the character goes
import { createCanvas } from "../core/util.js";
import { renderVfx, VFX_DEFAULTS, VFX_KINDS } from "./effects.js";

export const VFX_LAYER_DEFAULTS = {
  ...VFX_DEFAULTS,
  style: "hd", pxSize: 1, // 高清 by default; as pixels, the pixel editor's own pixels
  w: 64, h: 64,     // the region's size, px
  x: 32, y: 32,     // its centre on the canvas
  start: null,      // the frame id it starts on (null = the first frame)
  length: 0,        // frames it lasts; 0 = its own length (a loop: to the end)
  perFrame: false,  // position and size keyed frame by frame
  keys: null,       // { [frameId]: { x, y, w, h } }
  follow: null,     // a layer id: the region follows that layer's outline
  pad: 45,          // following: how much is added round the outline, % of its longer side
};

export function vfxSettings(l) {
  const v = { ...VFX_LAYER_DEFAULTS, ...((l && l.vfx) || {}) };
  if (l && l.vfx && l.vfx.box && l.vfx.w == null) v.w = v.h = l.vfx.box; // square boxes of the first version
  return v;
}

// the effect frame shown on animation frame fi, or -1
export function vfxFrame(s, frameIds, fi) {
  const st = Math.max(0, frameIds.indexOf(s.start));
  const k = fi - st;
  if (k < 0) return -1;
  const n = Math.max(1, s.frames | 0);
  const len = s.length > 0 ? s.length : s.loop ? frameIds.length - st : n;
  if (k >= len) return -1;
  return s.loop ? k % n : k < n ? k : -1;
}

// the region on frame fi: { x, y, w, h }. ctx.bbox(layerId, fi) gives a
// layer's outline { x0, y0, x1, y1 } (or null) for following.
export function vfxRegion(s, frameIds, fi, ctx) {
  if (s.follow && ctx && ctx.bbox) {
    const b = ctx.bbox(s.follow, fi);
    if (b) {
      // grown by the same amount on every side, measured on the longer side,
      // so a tall thin figure still gets a full aura round it
      const bw = b.x1 - b.x0, bh = b.y1 - b.y0, grow = Math.max(bw, bh) * Math.max(0, s.pad) / 100;
      // sizes in steps of 4 px: a figure that changes a little from frame to
      // frame (or under the brush) reuses the same rendering
      const snap = (v) => Math.ceil(v / 4) * 4;
      const kind = VFX_KINDS.find((k) => k.id === s.kind), fit = kind && kind.fit && kind.fit(Math.max(0.2, Math.min(1, s.size / 100)));
      if (fit) {
        // a kind that wraps a figure (环绕光) draws round it only part of its box —
        // the rest is for its flames above: the box is fitted so that part holds
        // the figure (grown by pad)
        const W = snap((bw + grow) / fit.w), H = snap((bh + grow) / fit.h);
        return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 + (0.5 - fit.y) * H, w: W, h: H, followed: true };
      }
      return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, w: snap(bw + grow), h: snap(bh + grow), followed: true };
    }
  }
  const keyed = s.perFrame && s.keys ? frameIds.map((id, i) => (s.keys[id] ? i : -1)).filter((i) => i >= 0) : [];
  if (!keyed.length) return { x: s.x, y: s.y, w: s.w, h: s.h };
  let a = -1, b = -1;
  for (const i of keyed) { if (i <= fi) a = i; if (i >= fi && b < 0) b = i; }
  if (a < 0) a = b;
  if (b < 0) b = a;
  const p = s.keys[frameIds[a]], q = s.keys[frameIds[b]];
  if (a === b) return { ...p, key: a === fi };
  const t = (fi - a) / (b - a), L = (u, v) => u + (v - u) * t;
  return { x: L(p.x, q.x), y: L(p.y, q.y), w: L(p.w, q.w), h: L(p.h, q.h), key: false };
}

// where a region's canvas goes: whole pixels, so pixel art stays on the grid
export function vfxRect(r) {
  const w = Math.max(4, Math.min(1024, Math.round(r.w))), h = Math.max(4, Math.min(1024, Math.round(r.h)));
  return { x: Math.round(r.x - w / 2), y: Math.round(r.y - h / 2), w, h };
}

// rendered effect frames, by everything that changes the picture (not where it
// sits or when it starts, so dragging it around re-renders nothing). Capped by
// count and by pixels in all: a few big regions would otherwise hold hundreds
// of MB of canvases.
// Entries are canvases (rendered here) or ImageBitmaps (rendered in the
// background, see below).
const cache = new Map();
const CACHE_MAX = 400, CACHE_PIXELS = 16e6; // ~64 MB
let cachePixels = 0;
const lookOf = (s) => { const { x, y, start, length, perFrame, keys, follow, pad, box, ...look } = s; return look; };
const keyOf = (look, i, w, h, draft) => JSON.stringify(look) + "#" + i + "#" + w + "x" + h + (draft ? "#draft" : "");
function remember(key, v) {
  // the same frame again (rendered here while the background had it too)
  const old = cache.get(key);
  if (old) { cachePixels -= old.width * old.height; cache.delete(key); if (old !== v && old.close) old.close(); }
  cache.set(key, v);
  cachePixels += v.width * v.height;
  while (cache.size > 1 && (cache.size > CACHE_MAX || cachePixels > CACHE_PIXELS)) {
    const k = cache.keys().next().value, o = cache.get(k);
    cachePixels -= o.width * o.height;
    cache.delete(k);
    if (o.close) o.close(); // an ImageBitmap's memory goes now, not whenever
  }
}

export function vfxCanvas(s, i, w, h, draft = false) {
  const look = lookOf(s), key = keyOf(look, i, w, h, draft);
  if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
  // a draft (while a slider or a corner moves): half size, smooth, no
  // pixelating — a few times quicker, and good enough to judge as it changes
  const v = draft
    ? renderVfx({ ...look, style: "hd", w: Math.max(8, Math.ceil(w / 2)), h: Math.max(8, Math.ceil(h / 2)) }, i)
    : renderVfx({ ...look, w, h }, i);
  remember(key, v);
  return v;
}

// ---------- in the background ----------
// The frames an effect layer will show are rendered ahead in a worker
// (vfx/worker.js) and land in the cache above, so the editor and the cards
// draw them without waiting. Without workers it all falls back to rendering
// here when a frame is drawn.

let worker = null; // null: not started yet; false: not available
let nextId = 1;
const asked = new Map();   // key -> Promise of the frame
const replies = new Map(); // message id -> { key, resolve }
const readyFns = new Set();

function getWorker() {
  if (worker === null) {
    try {
      worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
      worker.onmessage = (e) => {
        const { id, bmp } = e.data, r = replies.get(id);
        if (!r) return;
        replies.delete(id);
        asked.delete(r.key);
        // rendered here meanwhile (it was needed on screen): keep that one, so
        // nothing on screen changes under the eye (the two can differ by a
        // pixel or two as pixels: an OffscreenCanvas scales down a hair differently)
        if (bmp && cache.has(r.key)) { bmp.close(); r.resolve(cache.get(r.key)); return; }
        if (bmp) { remember(r.key, bmp); for (const fn of readyFns) fn(r.key); }
        r.resolve(bmp || null);
      };
      // a worker that can't start (an old browser): everything renders here
      worker.onerror = () => {
        worker = false;
        for (const r of replies.values()) { asked.delete(r.key); r.resolve(null); }
        replies.clear();
      };
    } catch { worker = false; }
  }
  return worker || null;
}

// call fn whenever a frame comes back from the background
export function onVfxReady(fn) { readyFns.add(fn); return () => readyFns.delete(fn); }

// is this frame of the effect at this size there to draw already?
export function vfxReady(s, i, w, h) {
  return !getWorker() || cache.has(keyOf(lookOf(s), i, w, h, false));
}

// ask for a frame in the background; resolves once it is in the cache (or
// with null when it can't be done there — it renders when drawn then)
export function vfxPrefetch(s, i, w, h) {
  const look = lookOf(s), key = keyOf(look, i, w, h, false);
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (asked.has(key)) return asked.get(key);
  const wk = getWorker();
  if (!wk) return Promise.resolve(null);
  const id = nextId++;
  const pr = new Promise((resolve) => replies.set(id, { key, resolve }));
  asked.set(key, pr);
  wk.postMessage({ id, p: { ...look, w, h }, i });
  return pr;
}

// every frame an effect layer shows, at its size on that frame, asked for in
// the background — from frame `from` on, so what comes next is ready first
export function prefetchVfxLayer(l, frameIds, ctx, from = 0) {
  if (!getWorker()) return Promise.resolve();
  const s = vfxSettings(l), n = frameIds.length, all = [];
  for (let k = 0; k < n; k++) {
    const fi = (from + k) % n, i = vfxFrame(s, frameIds, fi);
    if (i < 0) continue;
    const r = vfxRect(vfxRegion(s, frameIds, fi, ctx));
    all.push(vfxPrefetch(s, i, r.w, r.h));
  }
  return Promise.all(all);
}

// is everything effect layers show on frame fi there to draw already?
export function vfxFrameReady(layers, frameIds, fi, ctx) {
  if (!getWorker()) return true;
  for (const l of layers) {
    if (!l.vfx || l.visible === false) continue;
    const s = vfxSettings(l), i = vfxFrame(s, frameIds, fi);
    if (i < 0) continue;
    const r = vfxRect(vfxRegion(s, frameIds, fi, ctx));
    if (!cache.has(keyOf(lookOf(s), i, r.w, r.h, false))) return false;
  }
  return true;
}

// one frame of an effect as a canvas, rendered in the background when it can
// be (the 特效 card's frames: other cards draw on them, so canvases)
export async function renderVfxAsync(p, i) {
  const look = lookOf(p), w = Math.max(8, Math.min(1024, p.w | 0)), h = Math.max(8, Math.min(1024, p.h | 0));
  const bmp = await vfxPrefetch({ ...look }, i, w, h);
  if (!bmp) return renderVfx({ ...look, w, h }, i);
  const c = createCanvas(w, h);
  c.getContext("2d").drawImage(bmp, 0, 0);
  return c;
}

// draw a 特效 layer's frame fi into g, document pixels mapped by zoom z from (ox, oy)
// ctx.onlyReady: leave the effect out unless it is rendered already (a
// thumbnail or an onion skin that is drawn again when it comes)
export function drawVfxLayer(g, l, frameIds, fi, ox = 0, oy = 0, z = 1, ctx = null) {
  const s = vfxSettings(l);
  const i = vfxFrame(s, frameIds, fi);
  if (i < 0) return;
  const r = vfxRect(vfxRegion(s, frameIds, fi, ctx));
  if (ctx && ctx.onlyReady && !cache.has(keyOf(lookOf(s), i, r.w, r.h, false))) return;
  g.drawImage(vfxCanvas(s, i, r.w, r.h, !!(ctx && ctx.draft)), ox + r.x * z, oy + r.y * z, r.w * z, r.h * z);
}

// A layer's outline on frame j (what drawCel(layer, j, g) paints), as
// { x0, y0, x1, y1 } or null when it is empty. With celKey (what a cel looks
// like) the answer is kept until the cel changes.
const boxes = new Map();
export function layerBBox(layers, id, j, w, h, drawCel, celKey, celImage) {
  const l = layers.find((x) => x.id === id);
  if (!l || l.trail || l.ghost || l.vfx) return null;
  const key = celKey ? id + "|" + celKey(l, j) + "|" + w + "x" + h : null;
  if (key && boxes.has(key)) return boxes.get(key);
  // the cel's pixels as they are (celImage: ImageData of w×h, or null when
  // empty) — reading a drawn canvas back is far slower
  let d;
  const img = celImage ? celImage(l, j) : undefined;
  if (img !== undefined) {
    if (!img || img.width !== w || img.height !== h) { if (key) boxes.set(key, null); return null; }
    d = img.data;
  } else {
    const c = createCanvas(w, h), g = c.getContext("2d", { willReadFrequently: true });
    drawCel(l, j, g);
    d = g.getImageData(0, 0, w, h).data;
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] < 8) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const b = x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
  if (key) {
    boxes.set(key, b);
    if (boxes.size > 512) boxes.delete(boxes.keys().next().value);
  }
  return b;
}

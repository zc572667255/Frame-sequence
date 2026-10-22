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
import { renderVfx, VFX_DEFAULTS } from "./effects.js";

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
const cache = new Map();
const CACHE_MAX = 160, CACHE_PIXELS = 16e6; // ~64 MB
let cachePixels = 0;
export function vfxCanvas(s, i, w, h, draft = false) {
  const { x, y, start, length, perFrame, keys, follow, pad, box, ...look } = s;
  const key = JSON.stringify(look) + "#" + i + "#" + w + "x" + h + (draft ? "#draft" : "");
  if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
  // a draft (while a slider or a corner moves): half size, smooth, no
  // pixelating — a few times quicker, and good enough to judge as it changes
  const v = draft
    ? renderVfx({ ...look, style: "hd", w: Math.max(8, Math.ceil(w / 2)), h: Math.max(8, Math.ceil(h / 2)) }, i)
    : renderVfx({ ...look, w, h }, i);
  cache.set(key, v);
  cachePixels += v.width * v.height;
  while (cache.size > 1 && (cache.size > CACHE_MAX || cachePixels > CACHE_PIXELS)) {
    const k = cache.keys().next().value, o = cache.get(k);
    cachePixels -= o.width * o.height;
    cache.delete(k);
  }
  return v;
}

// draw a 特效 layer's frame fi into g, document pixels mapped by zoom z from (ox, oy)
export function drawVfxLayer(g, l, frameIds, fi, ox = 0, oy = 0, z = 1, ctx = null) {
  const s = vfxSettings(l);
  const i = vfxFrame(s, frameIds, fi);
  if (i < 0) return;
  const r = vfxRect(vfxRegion(s, frameIds, fi, ctx));
  g.drawImage(vfxCanvas(s, i, r.w, r.h, !!(ctx && ctx.draft)), ox + r.x * z, oy + r.y * z, r.w * z, r.h * z);
}

// A layer's outline on frame j (what drawCel(layer, j, g) paints), as
// { x0, y0, x1, y1 } or null when it is empty. With celKey (what a cel looks
// like) the answer is kept until the cel changes.
const boxes = new Map();
export function layerBBox(layers, id, j, w, h, drawCel, celKey) {
  const l = layers.find((x) => x.id === id);
  if (!l || l.trail || l.ghost || l.vfx) return null;
  const key = celKey ? id + "|" + celKey(l, j) + "|" + w + "x" + h : null;
  if (key && boxes.has(key)) return boxes.get(key);
  const c = createCanvas(w, h), g = c.getContext("2d", { willReadFrequently: true });
  drawCel(l, j, g);
  const d = g.getImageData(0, 0, w, h).data;
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

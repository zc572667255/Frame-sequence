// Trails on frames: texture loading and cached rendering, shared by the pixel
// editor (live) and the animation card (its output frames).
//
// Depth: every trail is a layer, drawn at its place in the layer stack. Sticks
// marked "back" (角色后方) instead go under every layer, so one swing can pass
// behind the character part of the way.
import { createCanvas } from "../core/util.js";
import { renderTrail, builtinTexture, builtinBrush, normalizeTrail, trailState } from "./model.js";
import { renderGhost, drawGhostCanvas } from "./ghost.js";
import { drawVfxLayer, layerBBox } from "../vfx/layer.js";
import { drawStrokeLayer, strokeWraps } from "./stroke.js";

const textures = new Map(); // asset id -> canvas (once loaded)

export function textureKey(trail) {
  const t = trail.style && trail.style.texture;
  return t && t.kind === "asset" && t.asset ? t.asset : "builtin";
}

// the texture if it's ready; null means "not loaded yet" for asset textures
export function textureFor(trail) {
  const k = textureKey(trail);
  return k === "builtin" ? builtinTexture() : textures.get(k) || null;
}

// the tail brush: a built-in one by id, or an imported image (an asset)
export function brushKey(trail) {
  const b = trail.style && trail.style.brush;
  return b && b.kind === "asset" && b.asset ? b.asset : "builtin:" + ((b && b.id) || "bristle");
}

export function brushFor(trail) {
  const k = brushKey(trail);
  return k.startsWith("builtin:") ? builtinBrush(k.slice(8)) : textures.get(k) || null;
}

export async function loadTextures(trails, loadAsset) {
  for (const t of trails || []) {
    for (const [k, fallback] of [[textureKey(t), builtinTexture], [brushKey(t), () => builtinBrush("bristle")]]) {
      if (k === "builtin" || k.startsWith("builtin:") || textures.has(k)) continue;
      try { textures.set(k, await loadAsset(k)); } catch { textures.set(k, fallback()); }
    }
  }
}

export function setTexture(assetId, canvas) { textures.set(assetId, canvas); }

// Rendered trails, kept cropped to what they cover: { c, x, y, s } — the canvas
// (null when empty), where it goes, and its scale (2 for a draft). The editor
// re-renders on every pointer move and the trail rarely changes between them.
// An LRU bounded by pixels as well as entries, so a long animation on a big
// canvas doesn't pile up hundreds of megabytes of whole-frame canvases.
const cache = new Map();
let cachePixels = 0;
const MAX_PIXELS = 24e6, MAX_ENTRIES = 256;
const pixels = (v) => (v && v.c ? v.c.width * v.c.height : 0);
function cached(key, make) {
  if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
  const v = make();
  cache.set(key, v);
  cachePixels += pixels(v);
  while ((cachePixels > MAX_PIXELS || cache.size > MAX_ENTRIES) && cache.size > 1) {
    const old = cache.keys().next().value;
    cachePixels -= pixels(cache.get(old));
    cache.delete(old);
  }
  return v;
}

// the part of a rendering that has anything in it, as { c, x, y }
function crop(img) {
  if (img instanceof ImageData) {
    const { width: w, height: h, data: d } = img;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!d[(y * w + x) * 4 + 3]) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return { c: null, x: 0, y: 0 };
    const c = createCanvas(x1 - x0 + 1, y1 - y0 + 1);
    c.getContext("2d").putImageData(img, -x0, -y0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    return { c, x: x0, y: y0 };
  }
  // glow canvases know the box they drew in
  const bb = img.bbox;
  if (!bb) return { c: img, x: 0, y: 0 };
  const x0 = Math.max(0, Math.floor(bb.x0)), y0 = Math.max(0, Math.floor(bb.y0));
  const x1 = Math.min(img.width, Math.ceil(bb.x0 + bb.w)), y1 = Math.min(img.height, Math.ceil(bb.y0 + bb.h));
  if (x1 <= x0 || y1 <= y0) return { c: null, x: 0, y: 0 };
  const c = createCanvas(x1 - x0, y1 - y0);
  c.getContext("2d").drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
  return { c, x: x0, y: y0 };
}

// every stick of a state scaled by k (for a half-size draft)
const scaleState = (st, k) => {
  const sc = (q) => ({ ...q, a: [q.a[0] * k, q.a[1] * k], b: [q.b[0] * k, q.b[1] * k] });
  return { ...st, sticks: st.sticks.map(sc), run: st.run && st.run.map(sc) };
};

// one trail state (trails/model.js trailState) for one depth, as { c, x, y, s }
// or null (nothing yet: textures still loading). draft: a glow trail at half
// size, quick enough to follow the pointer while sticks or sliders move.
export function trailCanvas(trail, state, w, h, z, draft = false) {
  if (!state) return null;
  const tex = textureFor(trail), brush = brushFor(trail);
  if (!tex || !brush) return null;
  const half = draft && trail.style && trail.style.colorMode === "glow";
  const key = JSON.stringify([textureKey(trail), brushKey(trail), state, trail.style, trail.smooth, trail.flip, trail.rotate, trail.turn, trail.bow, trail.plane, trail.squash, trail.tilt, trail.autoDepth, w, h, z, half]);
  return cached(key, () => {
    // a draft also uses half the subdivisions (many costs go with the number of
    // sections rather than with pixels) and leaves out the per-pixel finishing
    // passes — erosion, tearing, cel shading — which read pixels back and are
    // too fine to judge while dragging anyway
    const draftTrail = half ? { ...trail, style: { ...trail.style, fineness: Math.max(4, Math.round((trail.style.fineness || 20) / 2)), erode: 0, tear: 0, cel: 0 } } : trail;
    const img = half
      ? renderTrail(draftTrail, scaleState(state, 0.5), Math.ceil(w / 2), Math.ceil(h / 2), { tex, brush }, z)
      : renderTrail(trail, state, w, h, { tex, brush }, z);
    return img ? { ...crop(img), s: half ? 2 : 1 } : { c: null, x: 0, y: 0, s: 1 };
  });
}

// draw an entry from trailCanvas into g, mapping document pixels by (sx, sy)
// from (ox, oy)
export function drawTrailCanvas(g, e, ox = 0, oy = 0, sx = 1, sy = 1) {
  if (!e || !e.c) return;
  g.drawImage(e.c, ox + e.x * e.s * sx, oy + e.y * e.s * sy, e.c.width * e.s * sx, e.c.height * e.s * sy);
}

// one trail of frame fi at depth z (frameIds: the animation's frame order)
export function drawTrail(g, raw, frameIds, fi, z, w, h) {
  if (!raw) return;
  const t = normalizeTrail(raw);
  drawTrailCanvas(g, trailCanvas(t, trailState(t, frameIds, fi), w, h, z));
}

// A whole frame in stack order: "back" parts of visible trail layers (and of
// 拖尾笔 strokes that go round, 环绕), then each
// layer bottom to top — pixel layers through drawCel(layer, frame, g), trail
// layers as their "front" parts, ghost layers (trails/ghost.js) as earlier
// frames of the layers they copy, effect layers (vfx/layer.js) as their effect. Shared by the editor's thumbnails and the
// card's output. celKey: see renderGhost.
// opts: { celImage, onlyReady } for effect layers (vfx/layer.js drawVfxLayer)
export function drawFrameStack(g, layers, trails, frameIds, fi, w, h, drawCel, celKey, opts = {}) {
  const byId = new Map((trails || []).map((t) => [t.id, t]));
  for (const l of layers) {
    if (l.trail && l.visible !== false) {
      g.globalAlpha = (l.opacity ?? 100) / 100;
      drawTrail(g, byId.get(l.trail), frameIds, fi, "back", w, h);
    } else if (l.stroke && l.visible !== false && strokeWraps(l.stroke)) {
      g.globalAlpha = (l.opacity ?? 100) / 100;
      drawStrokeLayer(g, l, frameIds, fi, w, h, 0, 0, 1, opts.onlyReady ? "ready" : "sync", "back");
    }
  }
  for (const l of layers) {
    if (l.visible === false) continue;
    g.globalAlpha = (l.opacity ?? 100) / 100;
    if (l.trail) drawTrail(g, byId.get(l.trail), frameIds, fi, "front", w, h);
    else if (l.ghost) drawGhostCanvas(g, l, renderGhost(l, layers, frameIds, fi, w, h, drawCel, celKey));
    else if (l.stroke) drawStrokeLayer(g, l, frameIds, fi, w, h, 0, 0, 1, opts.onlyReady ? "ready" : "sync", "front");
    else if (l.vfx) drawVfxLayer(g, l, frameIds, fi, 0, 0, 1, { onlyReady: !!opts.onlyReady, bbox: (id, j) => layerBBox(layers, id, j, w, h, drawCel, celKey, opts.celImage) });
    else drawCel(l, fi, g);
  }
  g.globalAlpha = 1;
}

// Trails on frames: texture loading and cached rendering, shared by the pixel
// editor (live) and the animation card (its output frames).
//
// Depth: every trail is a layer, drawn at its place in the layer stack. Sticks
// marked "back" (角色后方) instead go under every layer, so one swing can pass
// behind the character part of the way.
import { canvasFromImageData } from "../core/util.js";
import { renderTrail, builtinTexture, builtinBrush, normalizeTrail, trailState } from "./model.js";

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

// Small LRU of rendered trails: the editor re-renders on every pointer move, the
// trail rarely changes between them.
const cache = new Map();
function cached(key, make) {
  if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
  const v = make();
  cache.set(key, v);
  if (cache.size > 128) cache.delete(cache.keys().next().value);
  return v;
}

// canvas with one trail state (trails/model.js trailState), for one depth
export function trailCanvas(trail, state, w, h, z) {
  if (!state) return null;
  const tex = textureFor(trail), brush = brushFor(trail);
  if (!tex || !brush) return null;
  const key = JSON.stringify([textureKey(trail), brushKey(trail), state, trail.style, trail.smooth, trail.flip, trail.rotate, trail.turn, trail.bow, trail.plane, trail.squash, trail.tilt, trail.autoDepth, w, h, z]);
  return cached(key, () => {
    const img = renderTrail(trail, state, w, h, { tex, brush }, z);
    return !img ? null : img instanceof ImageData ? canvasFromImageData(img) : img;
  });
}

// one trail of frame fi at depth z (frameIds: the animation's frame order)
export function drawTrail(g, raw, frameIds, fi, z, w, h) {
  if (!raw) return;
  const t = normalizeTrail(raw);
  const c = trailCanvas(t, trailState(t, frameIds, fi), w, h, z);
  if (c) g.drawImage(c, 0, 0);
}

// A whole frame in stack order: "back" parts of visible trail layers, then each
// layer bottom to top — pixel layers through drawCel(layer), trail layers as
// their "front" parts. Shared by the editor's thumbnails and the card's output.
export function drawFrameStack(g, layers, trails, frameIds, fi, w, h, drawCel) {
  const byId = new Map((trails || []).map((t) => [t.id, t]));
  for (const l of layers) {
    if (l.trail && l.visible !== false) {
      g.globalAlpha = (l.opacity ?? 100) / 100;
      drawTrail(g, byId.get(l.trail), frameIds, fi, "back", w, h);
    }
  }
  for (const l of layers) {
    if (l.visible === false) continue;
    g.globalAlpha = (l.opacity ?? 100) / 100;
    if (l.trail) drawTrail(g, byId.get(l.trail), frameIds, fi, "front", w, h);
    else drawCel(l);
  }
  g.globalAlpha = 1;
}

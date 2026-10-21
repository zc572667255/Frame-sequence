// Character model for the tuner: several animations sharing one origin.
//
// World space has the character's origin (usually the feet) at (0, 0). Every frame
// is drawn through three stacked transforms — character · animation · frame —
// each { x, y, scale, rot (degrees), flip }, with the source frame's pivot (default:
// bottom-centre of the source canvas) placed on the origin. Because all
// animations share that origin, exports of different animations line up exactly.
import { createCanvas } from "../core/util.js";

export const IDENTITY = { x: 0, y: 0, scale: 1, rot: 0, flip: false };

export function defaultCharacter() {
  return {
    transform: { ...IDENTITY },
    anims: [],
    export: { margin: 2, roundTo: 1, format: "sheet", perRow: 0 },
  };
}

export function newAnim(id, name, source) {
  return {
    id, name, source, fps: null, loop: true, pivot: null,
    transform: { ...IDENTITY },
    frames: {},        // index -> { x, y, scale, rot, flip, duration, disabled }
    sounds: {},        // index -> [{ asset, name, volume }]
  };
}

export function normalizeCharacter(p) {
  const d = defaultCharacter();
  return {
    transform: { ...d.transform, ...(p.transform || {}) },
    anims: (p.anims || []).map((a) => ({ ...newAnim(a.id, a.name, a.source), ...a, transform: { ...IDENTITY, ...(a.transform || {}) } })),
    export: { ...d.export, ...(p.export || {}) },
  };
}

export function toMatrix(t) {
  const m = new DOMMatrix();
  if (!t) return m;
  m.translateSelf(t.x || 0, t.y || 0);
  if (t.rot) m.rotateSelf(t.rot);
  const s = t.scale ?? 1;
  m.scaleSelf((t.flip ? -1 : 1) * s, s);
  return m;
}

export function frameTransform(anim, i) {
  return { ...IDENTITY, ...((anim.frames && anim.frames[i]) || {}) };
}

// character · animation
export function animMatrix(char, anim) {
  return toMatrix(char.transform).multiplySelf(toMatrix(anim.transform));
}

export function pivotOf(anim, src) {
  if (anim.pivot) return anim.pivot;
  return { x: src.w / 2, y: src.h };
}

// frames that play, in order, with their durations (ms)
export function timeline(anim, src) {
  if (!src) return [];
  const fps = anim.fps || src.fps || 12;
  const out = [];
  src.frames.forEach((f, i) => {
    const ft = anim.frames[i] || {};
    if (ft.disabled) return;
    out.push({ i, duration: ft.duration || f.duration || Math.round(1000 / fps) });
  });
  return out;
}

// sources: Map cardId -> frames value (resolved by the caller from the engine).
// Effects and overlays (trails, glows, shadows) are painted on their own layer in
// the pixel editor, so the animation's frames already contain them.
export function drawAnimFrame(g, char, anim, i, sources) {
  const src = sources.get(anim.source && anim.source.card);
  if (!src || !src.frames[i]) return;
  const base = g.getTransform();
  const p = pivotOf(anim, src);
  g.setTransform(base.multiply(animMatrix(char, anim)).multiply(toMatrix(frameTransform(anim, i))));
  g.drawImage(src.frames[i].canvas, -p.x, -p.y);
  g.setTransform(base);
}

// ---------- bounds ----------
function alphaBox(c) {
  const { width: w, height: h } = c;
  const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// generous world-space box a frame could cover, before measuring pixels
function roughBox(char, anim, i, sources) {
  const src = sources.get(anim.source && anim.source.card);
  if (!src) return null;
  const pts = [];
  const add = (m, w, h, p) => {
    for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) pts.push(m.transformPoint(new DOMPoint(x - p.x, y - p.y)));
  };
  const A = animMatrix(char, anim);
  add(A.multiply(toMatrix(frameTransform(anim, i))), src.w, src.h, pivotOf(anim, src));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x: Math.floor(Math.min(...xs)) - 1, y: Math.floor(Math.min(...ys)) - 1, x1: Math.ceil(Math.max(...xs)) + 1, y1: Math.ceil(Math.max(...ys)) + 1 };
}

// exact world-space box of the painted pixels of one frame
export function frameBounds(char, anim, i, sources) {
  const r = roughBox(char, anim, i, sources);
  if (!r) return null;
  const w = Math.min(4096, r.x1 - r.x), h = Math.min(4096, r.y1 - r.y);
  if (w <= 0 || h <= 0) return null;
  const c = createCanvas(w, h);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  g.setTransform(new DOMMatrix().translateSelf(-r.x, -r.y));
  drawAnimFrame(g, char, anim, i, sources);
  const b = alphaBox(c);
  return b ? { x: b.x + r.x, y: b.y + r.y, w: b.w, h: b.h } : null;
}

export function unionBox(boxes) {
  const list = boxes.filter(Boolean);
  if (!list.length) return null;
  const x0 = Math.min(...list.map((b) => b.x)), y0 = Math.min(...list.map((b) => b.y));
  const x1 = Math.max(...list.map((b) => b.x + b.w)), y1 = Math.max(...list.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Shared export canvas for the whole character: every visible pixel of every
// enabled frame of every animation, plus margin, optionally rounded up.
// Returns { w, h, ox, oy } — the canvas size and where the origin sits on it.
export function exportCanvas(char, sources, anims) {
  const boxes = [];
  for (const a of anims || char.anims) {
    const src = sources.get(a.source && a.source.card);
    for (const e of timeline(a, src)) boxes.push(frameBounds(char, a, e.i, sources));
  }
  const U = unionBox(boxes) || { x: -16, y: -32, w: 32, h: 32 };
  const m = Math.max(0, char.export.margin | 0), n = Math.max(1, char.export.roundTo | 0);
  const w0 = U.w + m * 2, h0 = U.h + m * 2;
  const w = Math.ceil(w0 / n) * n, h = Math.ceil(h0 / n) * n;
  // rounding slack goes left/right evenly and on top, so the feet keep their place
  const ox = -U.x + m + Math.floor((w - w0) / 2), oy = -U.y + m + (h - h0);
  return { w, h, ox, oy, content: U };
}

export function renderExportFrame(char, anim, i, sources, canvas) {
  const c = createCanvas(canvas.w, canvas.h);
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.setTransform(new DOMMatrix().translateSelf(canvas.ox, canvas.oy));
  drawAnimFrame(g, char, anim, i, sources);
  return c;
}

// Auto-calibrate: move each animation (group-level offset) so the bottom-centre
// of its painted footprint sits on the origin. Frame offsets are left alone.
export function calibrate(char, anim, sources) {
  const src = sources.get(anim.source && anim.source.card);
  if (!src) return null;
  const probe = { ...anim, transform: { ...anim.transform, x: 0, y: 0 } };
  const boxes = timeline(probe, src).map((e) => frameBounds(char, probe, e.i, sources));
  const U = unionBox(boxes);
  if (!U) return null;
  return { x: Math.round(-(U.x + U.w / 2)), y: Math.round(-(U.y + U.h)) };
}

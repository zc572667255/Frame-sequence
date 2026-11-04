// Character model for the tuner: several animations sharing one origin.
//
// World space has the character's origin (usually the feet) at (0, 0). Every frame
// is drawn through three stacked transforms — character · animation · frame —
// each { x, y, scale, rot (degrees), flip }, with the source frame's pivot (default:
// bottom-centre of the source canvas) placed on the origin. Because all
// animations share that origin, exports of different animations line up exactly.
import { createCanvas } from "../core/util.js";
import { nodeType } from "../nodes/registry.js";
import { asFrames } from "../nodes/data.js";

export const IDENTITY = { x: 0, y: 0, scale: 1, rot: 0, flip: false };

export function defaultCharacter() {
  return {
    transform: { ...IDENTITY },
    anims: [],
    outputAnim: null,
    export: { canvasMode: "auto", w: 0, h: 0, format: "sheet", perRow: 0 },
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
    outputAnim: p.outputAnim || null,
    anims: (p.anims || []).map((a) => ({ ...newAnim(a.id, a.name, a.source), ...a, transform: { ...IDENTITY, ...(a.transform || {}) } })),
    export: { ...d.export, ...(p.export || {}) },
  };
}

export function currentAnimation(char) {
  return char.anims.find((a) => a.id === char.outputAnim) || char.anims[0] || null;
}

export function resolveSources(app, p) {
  const sources = new Map();
  for (const a of p.anims || []) {
    const id = a.source && a.source.card;
    if (!id || sources.has(id)) continue;
    const card = app.store.cards[id], def = card && nodeType(card.type);
    const result = app.engine.result(id);
    const values = result ? Object.values(result.outputs || {}) : [];
    if (def && !def.evaluate && result) values.push(...Object.values(result.inputs || {}));
    const value = values.find((v) => v && (v.kind === "frames" || v.kind === "image"));
    sources.set(id, value ? asFrames(value) : null);
  }
  return sources;
}

// Uniform scaling around the handle opposite the dragged edge/corner. Work in
// the animation's space so character/group rotation, scale and flips all apply.
export function frameResizeState(anim, i, src, hx, hy, pointer) {
  const frame = frameTransform(anim, i), pivot = pivotOf(anim, src);
  const anchor = { x: (1 - hx) * src.w - pivot.x, y: (1 - hy) * src.h - pivot.y };
  const handle = { x: hx * src.w - pivot.x, y: hy * src.h - pivot.y };
  const m = toMatrix(frame), fixed = m.transformPoint(anchor), moving = m.transformPoint(handle);
  return { frame, anchor, fixed, pointer, vector: { x: moving.x - fixed.x, y: moving.y - fixed.y } };
}

export function resizeFrameTransform(state, pointer) {
  const { frame, anchor, fixed, vector } = state;
  const length2 = vector.x ** 2 + vector.y ** 2;
  if (!length2) return { x: frame.x, y: frame.y, scale: frame.scale };
  const factor = 1 + ((pointer.x - state.pointer.x) * vector.x + (pointer.y - state.pointer.y) * vector.y) / length2;
  const scale = Math.round(Math.min(20, Math.max(0.05, frame.scale * factor)) * 100) / 100;
  const offset = toMatrix({ ...frame, x: 0, y: 0, scale }).transformPoint(anchor);
  return { x: fixed.x - offset.x, y: fixed.y - offset.y, scale };
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

// Bounds of a full frame (including transparent pixels), or a source-space rect.
function transformedFrameBox(char, anim, i, sources, rect) {
  const src = sources.get(anim.source && anim.source.card);
  const frame = src && src.frames[i];
  if (!frame) return null;
  const r = rect || { x: 0, y: 0, w: frame.canvas.width, h: frame.canvas.height };
  const pts = [];
  const m = animMatrix(char, anim).multiply(toMatrix(frameTransform(anim, i))), p = pivotOf(anim, src);
  for (const [x, y] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) {
    pts.push(m.transformPoint(new DOMPoint(x - p.x, y - p.y)));
  }
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  // Ignore floating-point noise from rotations such as 90 degrees.
  const x = Math.floor(Math.min(...xs) + 1e-8), y = Math.floor(Math.min(...ys) + 1e-8);
  return { x, y, w: Math.ceil(Math.max(...xs) - 1e-8) - x, h: Math.ceil(Math.max(...ys) - 1e-8) - y };
}

// World-space painted bounds; very large transforms use a conservative box.
export function frameBounds(char, anim, i, sources) {
  const full = transformedFrameBox(char, anim, i, sources);
  if (!full) return null;
  const r = { x: full.x - 1, y: full.y - 1 };
  const w = full.w + 2, h = full.h + 2;
  if (w <= 0 || h <= 0) return null;
  // Avoid a huge scratch canvas without silently losing pixels beyond 4096.
  if (w > 4096 || h > 4096) {
    const sourceBox = alphaBox(sources.get(anim.source.card).frames[i].canvas);
    return sourceBox ? transformedFrameBox(char, anim, i, sources, sourceBox) : null;
  }
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

// Measure painted pixels AFTER every authored transform. Source frames often
// share a padded canvas, so its original size cannot determine the output size.
// Their union preserves relative offsets, crops transparent overflow and adds
// space only where transformed pixels need it. Export never scales to fit.
export function exportCanvas(char, sources, anims) {
  const boxes = [];
  for (const a of anims || char.anims) {
    const src = sources.get(a.source && a.source.card);
    for (const e of timeline(a, src)) {
      boxes.push(frameBounds(char, a, e.i, sources));
    }
  }
  const content = unionBox(boxes) || { x: 0, y: 0, w: 1, h: 1 };
  let U = content;
  if (char.export?.canvasMode === "manual") {
    const width = Number(char.export.w), height = Number(char.export.h);
    const w = Number.isFinite(width) && width > 0 ? Math.max(1, Math.min(8192, Math.round(width))) : content.w;
    const h = Number.isFinite(height) && height > 0 ? Math.max(1, Math.min(8192, Math.round(height))) : content.h;
    // Manual dimensions add transparent space around the bottom-centred image.
    // Painted overflow still expands the canvas, preserving every tuned pixel.
    const base = { x: content.x - Math.floor((w - content.w) / 2), y: content.y + content.h - h, w, h };
    U = unionBox([content, base]);
  }
  return { w: U.w, h: U.h, ox: -U.x, oy: -U.y, content };
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

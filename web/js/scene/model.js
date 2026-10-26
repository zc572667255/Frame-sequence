// 场景: pictures, animations and effects from cards on the board put together
// on one stage — where each one stands, how big, turned, flipped, how see-
// through, in what order, and when it starts. A scene only refers to its cards
// (by id), so editing a card changes the scene too; the same card can stand in
// it several times.
//
// Every item is placed by its anchor, the middle of the bottom edge of its
// picture (a character's feet; on a whole pixel, rounded down), and is scaled
// and turned about it — the same as the Godot export (godot/scenepack.js and
// the layered export's 底部中心 origin), so both look alike.
//
// Time: the scene runs at its own fps. An item starts on frame `start` of the
// scene and then steps one of its own frames per scene frame, looping or once
// (and then holding the last frame or vanishing).
import { nodeType } from "../nodes/registry.js";
import { createCanvas } from "../core/util.js";

export const SCENE_DEFAULTS = {
  w: 960, h: 540,     // the stage (the camera's view in Godot)
  fps: 12,
  length: 0,          // frames; 0 = as long as its items need
  bg: "#1f2430",      // the stage's colour; "" = see-through
  items: [],          // bottom to top
};

export const ITEM_DEFAULTS = { name: "", x: 0, y: 0, scale: 1, rot: 0, flip: false, opacity: 100, start: 0, loop: true, after: "hold", visible: true };

export function normalizeScene(p) {
  const s = { ...SCENE_DEFAULTS, ...(p || {}) };
  s.items = (Array.isArray(s.items) ? s.items : []).filter((it) => it && it.card).map((it) => ({ ...ITEM_DEFAULTS, ...it }));
  return s;
}

// the cards a scene can hold: anything that puts out a picture or frames
// (animations, 素材图, 特效, processing results), never another scene
export function placeableCards(app) {
  return Object.values(app.store.cards).filter((c) => {
    const def = nodeType(c.type);
    return def && c.type !== "scene" && def.outputs.length > 0;
  });
}

export function cardKind(app, id) {
  const c = app.store.cards[id];
  return c ? c.type : null;
}

// What a card shows now, as frames: { w, h, frames: [{ canvas, duration }],
// still, ver } — a picture is one still frame — or null while it has nothing.
export function sourceOf(app, cardId) {
  const card = app.store.cards[cardId];
  const def = card && nodeType(card.type);
  if (!def) return null;
  for (const o of def.outputs) {
    const v = app.engine.outputOf(cardId, o.name);
    if (!v) continue;
    if (v.kind === "image" && v.canvas) return { w: v.canvas.width, h: v.canvas.height, frames: [{ canvas: v.canvas, duration: 0 }], still: true, ver: v.ver };
    if (v.kind === "frames" && v.frames && v.frames.length) {
      const step = 1000 / (v.fps || (card.params && card.params.fps) || 12);
      return { w: v.w, h: v.h, frames: v.frames.map((f) => ({ canvas: f.canvas, duration: f.duration || step })), still: false, fps: v.fps || (card.params && card.params.fps) || 12, ver: v.ver };
    }
  }
  return null;
}

export function sources(app, scene) {
  const m = new Map();
  for (const it of scene.items) if (!m.has(it.card)) m.set(it.card, sourceOf(app, it.card));
  return m;
}

// In a scene every item steps one of its frames per scene frame: the scene
// frame rate sets the pace for all of them (their own frame rates and held
// frames don't stretch the timeline).

// the item's frame at scene frame fi (its own index), or -1 when it isn't
// there (not started, or gone after playing once)
export function itemFrame(it, src, fi) {
  if (!src || it.visible === false) return -1;
  const k = fi - it.start;
  if (k < 0) return -1;
  if (src.still) return 0;
  const n = src.frames.length;
  if (it.loop) return k % n;
  if (k >= n) return it.after === "hide" ? -1 : n - 1;
  return k;
}

// the scene frame an item is done on (exclusive): a still or a loop never is
// (Infinity); played once, after its frames
export function itemEnd(it, src) {
  if (!src || src.still || it.loop) return Infinity;
  return it.start + src.frames.length;
}

// how many frames the scene runs: its own length, or as many as its longest
// item (from where it starts) — a loop once round
export function sceneLength(scene, srcs) {
  if (scene.length > 0) return scene.length | 0;
  let n = 1;
  for (const it of scene.items) {
    const src = srcs.get(it.card);
    n = Math.max(n, it.start + (src && !src.still ? src.frames.length : 1));
  }
  return Math.max(1, n);
}

// the item's transform: anchor at (x, y), then turned, flipped and scaled
export function itemMatrix(it) {
  const r = (it.rot || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const sx = (it.scale || 1) * (it.flip ? -1 : 1), sy = it.scale || 1;
  return { a: c * sx, b: s * sx, c: -s * sy, d: c * sy, e: it.x, f: it.y };
}

// the anchor in the item's picture
export const anchorOf = (src) => ({ x: Math.floor(src.w / 2), y: src.h });

// a point of the item's picture (pixels, from its top-left) on the stage
export function itemPoint(it, src, px, py) {
  const m = itemMatrix(it), x = px - Math.floor(src.w / 2), y = py - src.h;
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

// a stage point in the item's picture (pixels from its top-left)
export function stageToItem(it, src, X, Y) {
  const m = itemMatrix(it), det = m.a * m.d - m.b * m.c || 1;
  const dx = X - m.e, dy = Y - m.f;
  return { x: (m.d * dx - m.c * dy) / det + Math.floor(src.w / 2), y: (-m.b * dx + m.a * dy) / det + src.h };
}

// the four corners of the item's picture on the stage
export function itemCorners(it, src) {
  return [[0, 0], [src.w, 0], [src.w, src.h], [0, src.h]].map(([x, y]) => itemPoint(it, src, x, y));
}

// is the stage point on the item (inside its picture and not on a clear pixel)?
export function hitItem(it, src, fi, fps, X, Y) {
  if (!src) return false;
  const p = stageToItem(it, src, X, Y);
  if (p.x < 0 || p.y < 0 || p.x >= src.w || p.y >= src.h) return false;
  const i = itemFrame(it, src, fi, fps);
  const c = src.frames[i >= 0 ? i : 0].canvas;
  try {
    const a = c.getContext("2d", { willReadFrequently: true }).getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data[3];
    return a > 20;
  } catch { return true; }
}

// Draw frame fi of the scene into g (stage pixels, already transformed by the
// caller): the stage's colour, then every item bottom to top. opts.zoom: how
// big a stage pixel is drawn — an item shown smaller than its own pixels is
// smoothed (a big painting scaled down), one shown as big or bigger is not
// (pixel art stays crisp).
// opts.prescale: pictures shown smaller made smaller ahead, once (shrunk), and
// drawn about 1:1 — for drawing a scene's every frame (a big painting scaled
// down smoothly on each of them is what takes the time)
export function drawScene(g, scene, srcs, fi, opts = {}) {
  if (scene.bg && !opts.noBg) { g.fillStyle = scene.bg; g.fillRect(0, 0, scene.w, scene.h); }
  for (const it of scene.items) {
    const src = srcs.get(it.card), i = itemFrame(it, src, fi, scene.fps);
    if (i < 0) continue;
    const m = itemMatrix(it), k = Math.abs(it.scale || 1) * (opts.zoom ?? 1);
    g.save();
    g.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    g.globalAlpha *= Math.max(0, Math.min(1, (it.opacity ?? 100) / 100));
    g.imageSmoothingEnabled = k < 1;
    g.imageSmoothingQuality = "high";
    const fr = src.frames[i].canvas;
    if (opts.prescale && k < 1) g.drawImage(shrunk(fr, k), -Math.floor(src.w / 2), -src.h, fr.width, fr.height);
    else g.drawImage(fr, -Math.floor(src.w / 2), -src.h);
    g.restore();
  }
}

// a frame made k times as big (k < 1), smoothly, kept while the frame is
const shrinks = new WeakMap();
function shrunk(canvas, k) {
  let m = shrinks.get(canvas);
  if (!m) shrinks.set(canvas, (m = new Map()));
  const key = Math.round(k * 1000);
  let c = m.get(key);
  if (!c) {
    const w = Math.max(1, Math.round(canvas.width * key / 1000)), h = Math.max(1, Math.round(canvas.height * key / 1000));
    c = createCanvas(w, h);
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(canvas, 0, 0, w, h);
    m.set(key, c);
  }
  return c;
}

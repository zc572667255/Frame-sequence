// 拖尾笔笔触图层: a 拖尾笔 stroke that stays editable. Instead of pixels it is
// a layer with a `stroke`: the brush settings it is drawn with, its colour (for
// the 主色 style), and per frame where it runs — keys[frameId] = { a, b, bend }:
// the tail a and the head b ([x, y], document pixels) and how far its middle
// bows out of the straight line between them (px; + to the left of a → b).
// Draw it on one frame, then on the next lengthen it, shorten it, turn it or
// bend it more. Drawn with the 拖尾笔's own rasteriser (editor/trailbrush.js);
// shared by the editor and the animation card (trails/composite.js).
import { createCanvas } from "../core/util.js";
import { rasterizeTrail, TRAIL_PRESETS } from "../editor/trailbrush.js";
import { GLOW_PRESETS } from "./glow.js";
import { builtinBrush } from "./model.js";

// 拖尾平面 (style.plane): "flat" — the bow lies in the picture; "h" — a slash
// on a level plane seen from the side, its circle squashed top to bottom;
// "v" — a chop on an upright plane, squashed side to side. planeSquash (%):
// how much; planeTilt (°): the squashed circle (an ellipse) turned that far on
// the picture, a slash that slants. In a plane the key's ends stay where they
// are on the picture and bend is the bow measured in the plane, before squashing.
export function strokePlane(style) {
  const p = style && style.plane;
  if (p !== "h" && p !== "v") return null;
  const s = Math.max(0.05, 1 - (style.planeSquash ?? 60) / 100), t = (+style.planeTilt || 0) * Math.PI / 180;
  return { h: p === "h", s, cos: Math.cos(t), sin: Math.sin(t) };
}
// picture → plane (turned back, then stretched) and back
function unsquash(pl, x, y) {
  if (!pl) return [x, y];
  const u = x * pl.cos + y * pl.sin, v = -x * pl.sin + y * pl.cos;
  return pl.h ? [u, v / pl.s] : [u / pl.s, v];
}
function squash(pl, x, y) {
  if (!pl) return { x, y };
  const u = pl.h ? x : x * pl.s, v = pl.h ? y * pl.s : y;
  return { x: u * pl.cos - v * pl.sin, y: u * pl.sin + v * pl.cos };
}

// the chord a → b in the plane: its ends, middle, length and left normal
function chord(k, pl) {
  const [ax, ay] = unsquash(pl, k.a[0], k.a[1]), [bx, by] = unsquash(pl, k.b[0], k.b[1]);
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
  return { ax, ay, bx, by, mx: (ax + bx) / 2, my: (ay + by) / 2, L, nx: -dy / L, ny: dx / L };
}

// how long the stroke is where its bow is measured (the plane's, in a plane)
export function strokeLen(k, pl = null) { return chord(k, pl).L; }

// the stroke's path on one frame: a smooth bow from a to b through the point
// `bend` px off the middle of the straight line — in the picture a quadratic
// curve; in a 拖尾平面 an arc of a circle there (past a half circle when the bow
// is more than half the length), squashed
export function strokePath(k, n = 40, pl = null) {
  const c = chord(k, pl), h = k.bend || 0, pts = [];
  if (!pl) {
    // the control point twice as far out as the curve's own middle
    const cx = c.mx + c.nx * 2 * h, cy = c.my + c.ny * 2 * h;
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      pts.push({ x: u * u * c.ax + 2 * u * t * cx + t * t * c.bx, y: u * u * c.ay + 2 * u * t * cy + t * t * c.by });
    }
    return pts;
  }
  if (Math.abs(h) < 0.01) {
    for (let i = 0; i <= n; i++) pts.push(squash(pl, c.ax + (c.bx - c.ax) * i / n, c.ay + (c.by - c.ay) * i / n));
    return pts;
  }
  // the circle through both ends and the bow's middle
  const R = (c.L * c.L / 4 + h * h) / (2 * Math.abs(h));
  const ox = c.mx + c.nx * (h - Math.sign(h) * R), oy = c.my + c.ny * (h - Math.sign(h) * R);
  const t0 = Math.atan2(c.ay - oy, c.ax - ox), tm = Math.atan2(c.my + c.ny * h - oy, c.mx + c.nx * h - ox);
  let half = tm - t0;
  while (half > Math.PI) half -= 2 * Math.PI;
  while (half < -Math.PI) half += 2 * Math.PI;
  for (let i = 0; i <= n; i++) {
    const t = t0 + 2 * half * i / n;
    pts.push(squash(pl, ox + Math.cos(t) * R, oy + Math.sin(t) * R));
  }
  return pts;
}

// the middle of the curve (the bend handle)
export function strokeMid(k, pl = null) {
  const c = chord(k, pl), b = k.bend || 0;
  return squash(pl, c.mx + c.nx * b, c.my + c.ny * b);
}

// The circle the stroke's bow lies on (in its plane): through both ends and the
// bow's middle — { ox, oy, R } — or null when it is straight.
export function strokeCircle(k, pl = null) {
  const c = chord(k, pl), h = k.bend || 0;
  if (Math.abs(h) < 0.5) return null;
  const R = (c.L * c.L / 4 + h * h) / (2 * Math.abs(h));
  return { ox: c.mx + c.nx * (h - Math.sign(h) * R), oy: c.my + c.ny * (h - Math.sign(h) * R), R };
}

// That circle on the picture — an ellipse in a 拖尾平面: its centre and half
// width and height, or null when straight
export function strokeEllipse(k, pl = null) {
  const C = strokeCircle(k, pl);
  if (!C) return null;
  const c = squash(pl, C.ox, C.oy);
  return { cx: c.x, cy: c.y, R: C.R, ox: C.ox, oy: C.oy };
}

// that ellipse's outline on the picture (n + 1 points round)
export function strokeEllipsePath(k, pl = null, n = 96) {
  const C = strokeCircle(k, pl);
  if (!C) return null;
  return Array.from({ length: n + 1 }, (_, i) => { const t = i / n * Math.PI * 2; return squash(pl, C.ox + Math.cos(t) * C.R, C.oy + Math.sin(t) * C.R); });
}

// its handles: the long axis's end (size and tilt), the short axis's end
// (squash; in a plane only) on the side away from the bow — picture points
export function strokeEllipseHandles(k, pl = null) {
  const C = strokeCircle(k, pl);
  if (!C) return null;
  const c = chord(k, pl), my = c.my + c.ny * k.bend - C.oy, mx = c.mx + c.nx * k.bend - C.ox;
  const long = pl && !pl.h ? [0, -C.R] : [C.R, 0];
  let short = pl && !pl.h ? [C.R, 0] : [0, -C.R];
  if (short[0] * mx + short[1] * my > 0) short = [-short[0], -short[1]];
  return {
    long: squash(pl, C.ox + long[0], C.oy + long[1]),
    short: pl ? squash(pl, C.ox + short[0], C.oy + short[1]) : null,
    centre: squash(pl, C.ox, C.oy),
  };
}

// the key grown or shrunk by f round its circle's centre: ends at the same
// places round it, the bow the same share
export function scaleKey(k, f, pl = null) {
  const E = strokeEllipse(k, pl);
  if (!E) return k;
  const r1 = (v) => Math.round(v * 10) / 10, at = (p) => [r1(E.cx + (p[0] - E.cx) * f), r1(E.cy + (p[1] - E.cy) * f)];
  return { a: at(k.a), b: at(k.b), bend: r1((k.bend || 0) * f) };
}

// the keys of a stroke whose plane is squashed or tilted differently now
// (from → to): each one's ellipse keeps its centre on the picture, its size in
// the plane and its ends their places round it
export function replaneKeys(keys, from, to) {
  const r1 = (v) => Math.round(v * 10) / 10, out = {};
  for (const id in keys) {
    const k = keys[id], C = strokeCircle(k, from);
    if (!C) { out[id] = k; continue; }
    const [ax, ay] = unsquash(from, k.a[0], k.a[1]), [bx, by] = unsquash(from, k.b[0], k.b[1]);
    const s = squash(from, C.ox, C.oy), [ox, oy] = unsquash(to, s.x, s.y);
    const put = (x, y) => { const p = squash(to, ox + x - C.ox, oy + y - C.oy); return [r1(p.x), r1(p.y)]; };
    out[id] = { a: put(ax, ay), b: put(bx, by), bend: k.bend };
  }
  return out;
}

// 固定弧度: the key with its head (end "b") or tail ("a") moved to where q
// falls on that circle — the other end stays, the stroke still goes round the
// same way, as far as it now reaches (all but a whole turn). Straight, the end
// slides along the line.
export function slideOnCircle(k, end, q, pl = null) {
  const r1 = (v) => Math.round(v * 10) / 10;
  const put = (x, y) => { const p = squash(pl, x, y); return [r1(p.x), r1(p.y)]; };
  const [qx, qy] = unsquash(pl, q.x, q.y), c = chord(k, pl), C = strokeCircle(k, pl);
  if (!C) {
    // along the line through both ends, not past the other end
    const ux = (c.bx - c.ax) / c.L, uy = (c.by - c.ay) / c.L;
    if (end === "b") { const d = Math.max(2, (qx - c.ax) * ux + (qy - c.ay) * uy); return { ...k, b: put(c.ax + ux * d, c.ay + uy * d), bend: 0 }; }
    const d = Math.max(2, (c.bx - qx) * ux + (c.by - qy) * uy);
    return { ...k, a: put(c.bx - ux * d, c.by - uy * d), bend: 0 };
  }
  const ang = (x, y) => Math.atan2(y - C.oy, x - C.ox);
  const ta = ang(c.ax, c.ay), tb = ang(c.bx, c.by), tm = ang(c.mx + c.nx * k.bend, c.my + c.ny * k.bend);
  // which way round it goes, tail to head
  let half = tm - ta;
  while (half > Math.PI) half -= 2 * Math.PI;
  while (half < -Math.PI) half += 2 * Math.PI;
  const dir = Math.sign(half) || 1, tq = ang(qx, qy);
  const from = end === "a" ? tq : ta, to = end === "b" ? tq : tb;
  // the sweep that way round, kept short of nothing and of a whole turn
  let sw = (to - from) * dir;
  while (sw < 0) sw += 2 * Math.PI;
  while (sw >= 2 * Math.PI) sw -= 2 * Math.PI;
  // not so short that the bow (in tenths of a pixel) loses the circle
  const least = Math.max(0.08, 2 * Math.acos(Math.max(-1, 1 - 1 / C.R)));
  sw = Math.min(2 * Math.PI - 0.08, Math.max(least, sw));
  const t0 = end === "a" ? to - dir * sw : from, t1 = end === "a" ? to : from + dir * sw;
  const a = end === "a" ? put(C.ox + Math.cos(t0) * C.R, C.oy + Math.sin(t0) * C.R) : k.a;
  const b = end === "b" ? put(C.ox + Math.cos(t1) * C.R, C.oy + Math.sin(t1) * C.R) : k.b;
  // the bow of that arc, on the side it always had
  return { a, b, bend: r1(Math.sign(k.bend) * C.R * (1 - Math.cos(sw / 2))) };
}

// Between two keys on the same circle: the tail turns round it the short way,
// the arc's sweep changes evenly, the way round stays. Null otherwise.
function lerpOnCircle(p, q, t, pl) {
  const A = strokeCircle(p, pl), B = strokeCircle(q, pl);
  if (!A || !B || Math.sign(p.bend) !== Math.sign(q.bend)) return null;
  if (Math.hypot(A.ox - B.ox, A.oy - B.oy) > 1 || Math.abs(A.R - B.R) > Math.max(1, A.R * 0.01)) return null;
  const arc = (k) => {
    const c = chord(k, pl), ang = (x, y) => Math.atan2(y - A.oy, x - A.ox);
    const ta = ang(c.ax, c.ay);
    let half = ang(c.mx + c.nx * k.bend, c.my + c.ny * k.bend) - ta;
    while (half > Math.PI) half -= 2 * Math.PI;
    while (half < -Math.PI) half += 2 * Math.PI;
    return { ta, sw: 2 * half };
  };
  const u = arc(p), v = arc(q);
  if (Math.sign(u.sw) !== Math.sign(v.sw)) return null;
  let dt = v.ta - u.ta;
  while (dt > Math.PI) dt -= 2 * Math.PI;
  while (dt < -Math.PI) dt += 2 * Math.PI;
  const ta = u.ta + dt * t, sw = u.sw + (v.sw - u.sw) * t, R = A.R;
  const a = squash(pl, A.ox + Math.cos(ta) * R, A.oy + Math.sin(ta) * R), b = squash(pl, A.ox + Math.cos(ta + sw) * R, A.oy + Math.sin(ta + sw) * R);
  return { a: [a.x, a.y], b: [b.x, b.y], bend: Math.sign(p.bend) * R * (1 - Math.cos(sw / 2)) };
}

// The key turned round its circle by ang (radians, the way it goes from tail
// to head): the same arc further round. Null when it is straight.
export function orbitKey(k, ang, pl = null) {
  const C = strokeCircle(k, pl);
  if (!C) return null;
  const c = chord(k, pl), at = (x, y) => Math.atan2(y - C.oy, x - C.ox);
  const ta = at(c.ax, c.ay);
  let half = at(c.mx + c.nx * k.bend, c.my + c.ny * k.bend) - ta;
  while (half > Math.PI) half -= 2 * Math.PI;
  while (half < -Math.PI) half += 2 * Math.PI;
  const t0 = ta + Math.sign(half || 1) * ang, P = (t) => { const p = squash(pl, C.ox + Math.cos(t) * C.R, C.oy + Math.sin(t) * C.R); return [p.x, p.y]; };
  return { a: P(t0), b: P(t0 + 2 * half), bend: k.bend };
}

// the bow that puts the bend handle at q (picture coordinates)
export function bendAt(k, q, pl = null) {
  const c = chord(k, pl), [x, y] = unsquash(pl, q.x, q.y);
  return (x - c.mx) * c.nx + (y - c.my) * c.ny;
}

// A drawn stroke (pointer points) as a key: its ends, and the bow of the point
// farthest off the straight line between them (with its side; in a 拖尾平面,
// measured there). Null when too short.
export function fitStroke(pts, pl = null) {
  if (!pts || pts.length < 2) return null;
  const a = pts[0], b = pts[pts.length - 1];
  if (Math.hypot(b.x - a.x, b.y - a.y) < 2) return null;
  const c = chord({ a: [a.x, a.y], b: [b.x, b.y] }, pl);
  let bend = 0;
  for (const p of pts) {
    const [x, y] = unsquash(pl, p.x, p.y), d = (x - c.ax) * c.nx + (y - c.ay) * c.ny;
    if (Math.abs(d) > Math.abs(bend)) bend = d;
  }
  const r = (v) => Math.round(v * 10) / 10;
  return { a: [r(a.x), r(a.y)], b: [r(b.x), r(b.y)], bend: r(bend) };
}

// this frame's key, or null
export const strokeKey = (s, frameIds, fi) => (s && s.keys && s.keys[frameIds[fi]]) || null;

// Between two keys, the way a blade swings: the tail moves straight, the head
// turns round it (angle the short way, and length, in between) and the bow
// keeps its share of the length — a turning stroke doesn't shrink midway. In a
// 拖尾平面 it turns in the plane (its head going round an ellipse on the picture).
export function lerpKey(p, q, t, pl = null) {
  // both on one circle (固定弧度): the ends go round it
  const round = lerpOnCircle(p, q, t, pl);
  if (round) return round;
  if (pl) {
    const to = (k) => ({ a: unsquash(pl, k.a[0], k.a[1]), b: unsquash(pl, k.b[0], k.b[1]), bend: k.bend });
    const m = lerpKey(to(p), to(q), t), a = squash(pl, m.a[0], m.a[1]), b = squash(pl, m.b[0], m.b[1]);
    return { a: [a.x, a.y], b: [b.x, b.y], bend: m.bend };
  }
  const L = (u, v) => u + (v - u) * t;
  const lp = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) || 1, lq = Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]) || 1;
  const ap = Math.atan2(p.b[1] - p.a[1], p.b[0] - p.a[0]), aq = Math.atan2(q.b[1] - q.a[1], q.b[0] - q.a[0]);
  let da = aq - ap;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const a = [L(p.a[0], q.a[0]), L(p.a[1], q.a[1])], len = L(lp, lq), ang = ap + da * t;
  return { a, b: [a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len], bend: L((p.bend || 0) / lp, (q.bend || 0) / lq) * len };
}

// The stroke on frame fi: { key, kind, ... } or null before anything is drawn.
//   key    — its own key (own: true)
//   tween  — between the keys on frames `from` and `to`, worked out
//   fade   — after the last key (`from`), dissolving: fade 0..1 of the way gone
//   gone   — past the dissolve; key is the last one (to carry on from)
//   before — before the first key; key is that one
//   orbit  — 循环旋转 (s.orbit: frames for a whole turn): the nearest key
//            before (or the first one) turned round its circle that far
// s.dissolve: the frames it takes to dissolve after its last key (0: at once).
export function strokeAt(s, frameIds, fi) {
  if (!s || !s.keys) return null;
  const own = strokeKey(s, frameIds, fi);
  if (own) return { key: own, kind: "key", own: true };
  let prev = -1, next = -1;
  for (let i = fi - 1; i >= 0; i--) if (strokeKey(s, frameIds, i)) { prev = i; break; }
  for (let i = fi + 1; i < frameIds.length; i++) if (strokeKey(s, frameIds, i)) { next = i; break; }
  if (prev < 0 && next < 0) return null;
  // 循环旋转: round and round its circle, every frame, from its nearest key
  if ((s.orbit | 0) >= 2) {
    const from = prev >= 0 ? prev : next, k = strokeKey(s, frameIds, from);
    const turned = orbitKey(k, (fi - from) / (s.orbit | 0) * 2 * Math.PI * (s.orbitReverse ? -1 : 1), strokePlane(s.style));
    if (turned) return { key: turned, kind: "orbit", own: false, from };
  }
  if (prev < 0) return { key: strokeKey(s, frameIds, next), kind: "before", own: false, from: next };
  const kp = strokeKey(s, frameIds, prev);
  if (next >= 0) return { key: lerpKey(kp, strokeKey(s, frameIds, next), (fi - prev) / (next - prev), strokePlane(s.style)), kind: "tween", own: false, from: prev, to: next };
  const d = fi - prev, n = Math.max(0, s.dissolve | 0);
  if (d <= n) return { key: kp, kind: "fade", own: false, from: prev, fade: d / (n + 1), step: d, of: n };
  return { key: kp, kind: "gone", own: false, from: prev };
}

// is anything of it shown on this frame?
export const strokeShows = (st) => !!st && (st.kind === "key" || st.kind === "tween" || st.kind === "fade" || st.kind === "orbit");

// the nearest key at or before frame fi (what an edit on a frame without one
// starts from), as { key, fi } or null
export function prevStrokeKey(s, frameIds, fi) {
  for (let i = Math.min(fi, frameIds.length - 1); i >= 0; i--) { const k = strokeKey(s, frameIds, i); if (k) return { key: k, fi: i }; }
  return null;
}

// imported tail brushes (data URLs), loaded once; until then the built-in one
const brushes = new Map();
const brushFns = new Set();
export function onStrokeBrush(fn) { brushFns.add(fn); return () => brushFns.delete(fn); }
function brushOf(style) {
  if (style.brushData && typeof Image !== "undefined") {
    let b = brushes.get(style.brushData);
    if (!b) {
      b = { canvas: null };
      brushes.set(style.brushData, b);
      const im = new Image();
      im.onload = () => {
        const c = createCanvas(im.naturalWidth, im.naturalHeight);
        c.getContext("2d").drawImage(im, 0, 0);
        b.canvas = c;
        for (const fn of brushFns) fn();
      };
      im.src = style.brushData;
    }
    if (b.canvas) return b.canvas;
  }
  return builtinBrush(style.brushId || "bristle");
}

// One frame of a stroke as ImageData (w×h), or null. gone: 0..1 of it already
// dissolved — the tail has caught up that far along the curve toward the
// head, which stays where it stopped. Shared with the worker (strokeworker.js).
export function strokeImage(stroke, key, w, h, gone, brush) {
  const style = stroke.style || {}, color = stroke.color || [255, 255, 255, 255];
  const pl = strokePlane(style);
  let pts = strokePath(key, pl ? 90 : 60, pl);
  if (gone > 0) pts = pts.slice(Math.min(pts.length - 3, Math.round(gone * (pts.length - 1))));
  return rasterizeTrail(pts, style, w, h, color, brush || builtinBrush(style.brushId || "bristle"));
}

// rendered strokes, by everything that changes them: canvases rendered here,
// ImageBitmaps from the background
const cache = new Map();
const CACHE_MAX = 160;
const idOf = (stroke, key, w, h, gone) => {
  const style = stroke.style || {};
  return JSON.stringify([style, stroke.color || [255, 255, 255, 255], key, w, h, gone, !!(style.brushData && brushes.get(style.brushData) && brushes.get(style.brushData).canvas)]);
};
function remember(id, v) {
  const old = cache.get(id);
  if (old && old !== v && old.close) old.close();
  cache.delete(id);
  cache.set(id, v);
  while (cache.size > CACHE_MAX) {
    const k = cache.keys().next().value, o = cache.get(k);
    cache.delete(k);
    if (o && o.close) o.close();
  }
}

export function strokeCanvas(stroke, key, w, h, gone = 0) {
  const id = idOf(stroke, key, w, h, gone);
  if (cache.has(id)) { const v = cache.get(id); cache.delete(id); cache.set(id, v); return v; }
  const img = strokeImage(stroke, key, w, h, gone, brushOf(stroke.style || {}));
  let c = null;
  if (img) { c = createCanvas(w, h); c.getContext("2d").putImageData(img, 0, 0); }
  remember(id, c);
  return c;
}

// ---------- in the background ----------
// A stroke's frames are rendered ahead in a worker (strokeworker.js) — a full
// glow takes a tenth of a second or more, as 两头尖 twice that — so the
// editor never waits on them. Strokes with an imported brush (an image the
// worker can't load) render here as before.

// The jobs wait here and go to the workers one at a time each, so that the
// frame on screen can jump the queue and frames of a shape since changed are
// dropped before they are rendered — after a run of edits the workers would
// otherwise still be busy with every frame of every shape in between. Two
// workers where there are cores enough, as frames don't depend on each other.
let workers = null; // null: not started; false: not available; else [{ w, job }]
let nextId = 1;
const asked = new Map();   // id -> job { id, owner, msg, pr, resolve }
const failed = new Set();  // ids the background could not render: rendered here
const queue = [];          // jobs not sent yet, next first
const readyFns = new Set();
export function onStrokeReady(fn) { readyFns.add(fn); return () => readyFns.delete(fn); }

function pump() {
  if (!workers) return;
  for (const s of workers) {
    if (s.job || !queue.length) continue;
    s.job = queue.shift();
    s.w.postMessage({ id: nextId++, ...s.job.msg });
  }
}

function settle(r, bmp, error) {
  asked.delete(r.id);
  // rendered here meanwhile: keep that one
  if (cache.has(r.id)) { if (bmp) bmp.close(); r.resolve(cache.get(r.id)); return; }
  if (error) failed.add(r.id);
  else remember(r.id, bmp || null);
  for (const fn of readyFns) fn();
  r.resolve(bmp || null);
}

function getWorker() {
  if (workers === null) {
    try {
      const n = typeof navigator !== "undefined" && navigator.hardwareConcurrency >= 4 ? 2 : 1;
      workers = [];
      for (let i = 0; i < n; i++) {
        const s = { w: new Worker(new URL("./strokeworker.js", import.meta.url), { type: "module" }), job: null };
        s.w.onmessage = (e) => {
          const { bmp, error } = e.data, r = s.job;
          s.job = null;
          if (r) settle(r, bmp, error); else if (bmp) bmp.close();
          pump();
        };
        s.w.onerror = () => {
          const all = workers || [];
          workers = false;
          for (const t of all) { t.w.terminate(); if (t.job) queue.push(t.job); }
          for (const r of queue) { asked.delete(r.id); r.resolve(null); }
          queue.length = 0;
        };
        workers.push(s);
      }
    } catch { workers = false; }
  }
  return workers ? workers[0] : null;
}

const inBackground = (stroke) => !(stroke.style && stroke.style.brushData) && !!getWorker();

// ask for a frame in the background (resolves once it is in the cache, or with
// null if it is dropped). owner: the layer it is for; urgent: on screen now.
export function strokePrefetch(stroke, key, w, h, gone = 0, owner = null, urgent = false) {
  const id = idOf(stroke, key, w, h, gone);
  if (cache.has(id)) return Promise.resolve(cache.get(id));
  let job = asked.get(id);
  if (job) {
    const i = queue.indexOf(job);
    if (urgent && i > 0) { queue.splice(i, 1); queue.unshift(job); }
    return job.pr;
  }
  if (!inBackground(stroke) || failed.has(id)) return Promise.resolve(null);
  job = { id, owner, msg: { stroke: { style: stroke.style, color: stroke.color }, key, w, h, gone } };
  job.pr = new Promise((resolve) => (job.resolve = resolve));
  asked.set(id, job);
  if (urgent) queue.unshift(job); else queue.push(job);
  pump();
  return job.pr;
}

// waiting frames of owner that aren't among ids any more: dropped
function dropStale(owner, ids) {
  for (let i = queue.length - 1; i >= 0; i--) {
    const job = queue[i];
    if (job.owner !== owner || ids.has(job.id)) continue;
    queue.splice(i, 1);
    asked.delete(job.id);
    job.resolve(null);
  }
}

// how a frame of the layer is drawn: its key and how far it has dissolved
function frameOf(l, frameIds, fi) {
  const st = strokeAt(l.stroke, frameIds, fi);
  if (!strokeShows(st)) return null;
  const fade = st.kind === "fade" ? st.fade : 0;
  return { key: st.key, fade, gone: fade * 0.85 };
}

// every frame a stroke layer shows, asked for in the background — from frame
// `from` on, so what comes next is ready first
export function prefetchStrokeLayer(l, frameIds, w, h, from = 0) {
  if (!inBackground(l.stroke)) return Promise.resolve();
  const n = frameIds.length, want = [];
  for (let k = 0; k < n; k++) {
    const f = frameOf(l, frameIds, (from + k) % n);
    if (f) want.push(f);
  }
  // what it showed before this edit isn't wanted any more
  dropStale(l.id, new Set(want.map((f) => idOf(l.stroke, f.key, w, h, f.gone))));
  return Promise.all(want.map((f) => strokePrefetch(l.stroke, f.key, w, h, f.gone, l.id)));
}

// is everything stroke layers show on frame fi there to draw already?
export function strokeFrameReady(layers, frameIds, fi, w, h) {
  for (const l of layers) {
    if (!l.stroke || l.visible === false || !inBackground(l.stroke)) continue;
    const f = frameOf(l, frameIds, fi);
    if (!f) continue;
    const id = idOf(l.stroke, f.key, w, h, f.gone);
    if (!cache.has(id) && !failed.has(id)) return false;
  }
  return true;
}

// A quick stand-in for the full render — while it is being dragged about, or
// until its frame comes from the background: the stroke's ribbon (its width
// and taper) filled in its colours, brightening to the head (to both ends'
// middle, 两头尖), with a light line along it. A few drawing calls.
export function drawStrokeDraft(g, stroke, key, ox = 0, oy = 0, z = 1, gone = 0) {
  const style = stroke.style || {}, shape = style.shape || "head";
  let pts = strokePath(key, 40, strokePlane(style));
  if (gone > 0) pts = pts.slice(Math.min(pts.length - 3, Math.round(gone * (pts.length - 1))));
  const n = pts.length - 1, W = Math.max(1, +style.width || 10);
  const prof = (u) => (shape === "even" ? 1 : shape === "crescent" ? Math.max(0.08, Math.pow(Math.sin(Math.PI * u), 0.7)) : 0.12 + 0.88 * u);
  const left = [], right = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, hw = W * prof(i / n) / 2;
    left.push([ox + (p.x - dy / L * hw) * z, oy + (p.y + dx / L * hw) * z]);
    right.push([ox + (p.x + dy / L * hw) * z, oy + (p.y - dx / L * hw) * z]);
  });
  const { body, core } = draftColors(style, stroke.color);
  const t = [ox + pts[0].x * z, oy + pts[0].y * z], hd = [ox + pts[n].x * z, oy + pts[n].y * z];
  const gr = g.createLinearGradient(t[0], t[1], hd[0], hd[1]);
  const fadeTo = (c, a) => "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
  if (shape === "crescent") { gr.addColorStop(0, fadeTo(body, 0)); gr.addColorStop(0.5, fadeTo(core, 0.9)); gr.addColorStop(1, fadeTo(body, 0)); }
  else { gr.addColorStop(0, fadeTo(body, 0)); gr.addColorStop(0.55, fadeTo(body, 0.75)); gr.addColorStop(1, fadeTo(core, 0.95)); }
  const ribbon = () => {
    g.beginPath();
    left.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    for (let i = right.length - 1; i >= 0; i--) g.lineTo(right[i][0], right[i][1]);
    g.closePath();
  };
  g.save();
  // the body with a soft glow round it in its colour
  g.fillStyle = gr;
  g.shadowColor = fadeTo(body, 0.85);
  g.shadowBlur = Math.max(4, W * z * 0.9);
  ribbon(); g.fill();
  g.shadowBlur = 0;
  // a bright core along it, lit toward the head
  g.globalCompositeOperation = "lighter";
  const cg = g.createLinearGradient(t[0], t[1], hd[0], hd[1]);
  if (shape === "crescent") { cg.addColorStop(0, fadeTo(core, 0)); cg.addColorStop(0.5, fadeTo(core, 0.8)); cg.addColorStop(1, fadeTo(core, 0)); }
  else { cg.addColorStop(0, fadeTo(core, 0)); cg.addColorStop(0.7, fadeTo(core, 0.45)); cg.addColorStop(1, fadeTo(core, 0.9)); }
  g.strokeStyle = cg; g.lineWidth = Math.max(1, W * z * 0.22); g.lineCap = "round";
  g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(ox + p.x * z, oy + p.y * z) : g.moveTo(ox + p.x * z, oy + p.y * z))); g.stroke();
  g.restore();
}

// ---------- styled previews while it is being dragged ----------
// A worker of its own (the one rendering frames ahead may be busy) renders the
// stroke as it is right now — only the latest shape: one asked for meanwhile
// replaces the waiting one — at half size on a large canvas (over 300 × 300). What is shown
// while dragging is the newest of these, its colours and glow a moment behind
// the pointer; the plain stand-in only until the first one comes.
let pvWorker = null;
const previews = new Map(); // owner (a layer id, "new") -> { base, bmp }
let pvJob = null, pvNext = null;
function sendPreview() {
  if (pvJob || !pvNext || !pvWorker) return;
  pvJob = pvNext; pvNext = null;
  pvWorker.postMessage({ id: 0, ...pvJob.msg });
}
function getPreviewWorker() {
  if (pvWorker === null) {
    try {
      pvWorker = new Worker(new URL("./strokeworker.js", import.meta.url), { type: "module" });
      pvWorker.onmessage = (e) => {
        const job = pvJob, { bmp } = e.data;
        pvJob = null;
        if (job && bmp) {
          const old = previews.get(job.owner);
          if (old && old.bmp) old.bmp.close();
          previews.set(job.owner, { base: job.base, bmp });
          for (const fn of readyFns) fn();
        } else if (bmp) bmp.close();
        sendPreview();
      };
      pvWorker.onerror = () => { pvWorker = false; pvJob = null; pvNext = null; };
    } catch { pvWorker = false; }
  }
  return pvWorker || null;
}

// start the preview worker ahead of the first drag (loading it takes a moment)
export function warmStrokePreview() { getPreviewWorker(); }

// the newest styled preview for owner (perhaps of a shape a moment ago), asking
// for one of this shape when it isn't that already; null before the first
export function strokePreview(owner, stroke, key, w, h, gone = 0) {
  const base = idOf(stroke, key, w, h, gone), cur = previews.get(owner);
  const asked = (j) => j && j.owner === owner && j.base === base;
  if (!(cur && cur.base === base) && !asked(pvJob) && !(stroke.style && stroke.style.brushData) && getPreviewWorker()) {
    const k = w * h > 300 * 300 ? 0.5 : 1, sc = (q) => [q[0] * k, q[1] * k];
    pvNext = {
      owner, base,
      msg: {
        stroke: { style: { ...stroke.style, width: (+(stroke.style || {}).width || 10) * k }, color: stroke.color },
        key: { a: sc(key.a), b: sc(key.b), bend: (key.bend || 0) * k },
        w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), gone,
      },
    };
    sendPreview();
  }
  return cur ? cur.bmp : null;
}

// a preview of exactly this shape, if there is one (whoever it was made for)
function previewOf(base) {
  for (const v of previews.values()) if (v.base === base) return v.bmp;
  return null;
}

// a stroke's colours for the stand-in: the style's own (a glow preset's, a
// band preset's) or, for 主色, its colour
function draftColors(style, color) {
  const hex = (h) => { const v = parseInt(String(h).slice(1), 16) || 0; return [v >> 16 & 255, v >> 8 & 255, v & 255]; };
  const id = String(style.preset || "");
  if (id.startsWith("glow:")) {
    const p = GLOW_PRESETS.find((x) => "glow:" + x.id === id) || GLOW_PRESETS[0];
    return { body: hex(p.colors[1] || p.rim), core: hex(p.core) };
  }
  const p = TRAIL_PRESETS.find((x) => x.id === id);
  if (p && p.bands) return { body: hex(p.bands[1] ? p.bands[1][0] : p.bands[0][0]), core: hex(p.bands[p.bands.length - 1][0]) };
  const c = color || [255, 255, 255];
  return { body: [c[0], c[1], c[2]], core: [255, 255, 255] };
}

// Draw a stroke layer's frame fi into g, document pixels mapped by zoom z
// from (ox, oy) — its own keys, the frames worked out between them, and the
// dissolve after. mode: "sync" renders what is missing here; "draft" shows the
// stand-in for what is missing (and asks the background for it); "ready" leaves
// out what is missing (a thumbnail or an onion skin, drawn again later).
export function drawStrokeLayer(g, l, frameIds, fi, w, h, ox = 0, oy = 0, z = 1, mode = "sync", part = "all") {
  const f = frameOf(l, frameIds, fi);
  if (!f) return;
  g.save();
  // 环绕: only the half asked for (part)
  if (!clipStrokePart(g, l.stroke, f.key, part, ox, oy, z, w, h)) { g.restore(); return; }
  const a0 = g.globalAlpha;
  // dissolving, it also fades out
  if (f.fade) g.globalAlpha = a0 * Math.pow(1 - f.fade, 0.8);
  const id = idOf(l.stroke, f.key, w, h, f.gone);
  if (mode !== "sync" && !cache.has(id) && !failed.has(id) && inBackground(l.stroke)) {
    // the frame on screen first; a thumbnail's or onion skin's in turn
    strokePrefetch(l.stroke, f.key, w, h, f.gone, l.id, mode === "draft");
    if (mode === "draft") {
      const pv = previewOf(id);
      if (pv) g.drawImage(pv, ox, oy, w * z, h * z);
      else drawStrokeDraft(g, l.stroke, f.key, ox, oy, z, f.gone);
    }
  } else {
    const c = strokeCanvas(l.stroke, f.key, w, h, f.gone);
    if (c) g.drawImage(c, ox, oy, w * z, h * z);
  }
  g.globalAlpha = a0;
  g.restore();
}

// ---------- 环绕 ----------
// In a 拖尾平面 with style.wrap the stroke goes round: the half of its ellipse
// away from the viewer is drawn under every layer (what is in front hides it),
// the near half at the layer's own place. The ellipse is cut along its long
// axis; the far half is the top for 横向 and the left for 纵向 (wrapFlip: the
// other one).
export const strokeWraps = (stroke) => !!(stroke && stroke.style && stroke.style.wrap && strokePlane(stroke.style));

// Clip g to part ("back" / "front" / "all") of the stroke on this key; false
// when that part is empty ("back" of a stroke that doesn't go round).
export function clipStrokePart(g, stroke, key, part, ox, oy, z, w, h) {
  if (part === "all") return true;
  const pl = strokeWraps(stroke) && strokePlane(stroke.style), C = pl && strokeCircle(key, pl);
  if (!C) return part === "front";
  const f = stroke.style.wrapFlip ? -1 : 1, unit = (v) => { const d = Math.hypot(v.x, v.y) || 1; return { x: v.x / d, y: v.y / d }; };
  // directions on the picture: along the long axis, and toward the far side
  const along = unit(pl.h ? squash(pl, 1, 0) : squash(pl, 0, 1));
  const far = unit(pl.h ? squash(pl, 0, -f) : squash(pl, -f, 0)), s = part === "back" ? 1 : -1;
  const c = squash(pl, C.ox, C.oy), B = (w + h) * 4;
  const P = (x, y) => [ox + x * z, oy + y * z];
  const pts = [
    P(c.x + along.x * B, c.y + along.y * B), P(c.x - along.x * B, c.y - along.y * B),
    P(c.x - along.x * B + far.x * s * B, c.y - along.y * B + far.y * s * B), P(c.x + along.x * B + far.x * s * B, c.y + along.y * B + far.y * s * B),
  ];
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.clip();
  return true;
}


// Attack trails (攻击拖尾).
//
// A trail is drawn with one "stick" per frame: a segment from an inner point `a`
// (near the hilt) to an outer point `b` (the blade tip). The stick's length is the
// trail's width there. Move or reshape the stick frame by frame along with the
// weapon, and each frame's trail is the area the stick swept over the last
// `length` frames — a ribbon from the oldest stick (tail) to the current one (head).
//
// The ribbon is texture-mapped (u along the trail tail→head, v across it inner→
// outer) with a greyscale brush texture whose luminance becomes opacity, coloured
// with one colour, a gradient along u, or the texture's own colours.
import { createCanvas, hexToRgb } from "../core/util.js";
import { renderGlow, renderFx, pixelateGlow, celShade, mixStyle, hashSeed } from "./glow.js";
import { texTri, uvMap } from "./uv.js";

export const STYLE_DEFAULTS = {
  texture: { kind: "builtin", id: "luma" },
  shape: "head",                    // head: thin tail -> full head | crescent: pointed both ends | even
  colorMode: "bands",               // bands (色带 styles) | glow (光效, trails/glow.js) | mono | gradient | original
  bands: [["#5a6988", 1], ["#c0cbdc", 0.72], ["#ffffff", 0.4]],   // 白光
  styleId: "white",
  bandBlend: "steps",               // band edges: hard | steps (in-between shades) | dither | smooth
  bandSoft: 0.6,                    // how much of each band the transition takes (0 = hard edges)
  bandShade: 0.4,                   // toward the tail the bands shift outward: the bright core stays near the head
  bandLayout: "center",             // center: brightest along the middle | edge: brightest along the blade-tip edge (弧光)
  edgeFade: 0,                      // the inner part of the width fades out (edge layout: the grip side; center: both edges)
  fadeSteps: false,                 // pixel mode: fade in 4 opacity steps instead of a dither
  streaks: 0,                       // thin speed lines along the trail, showing where the body has faded
  edgeBreak: 0,                     // 破碎: ragged, streaky edges instead of clean curves
  splits: 0,                        // 分条: cut the width into this many + 1 parallel strips, each with its own colours
  pxDust: 0, pxShards: 0, pxSplatter: 0, pxImpact: 0,   // accents (trails/glow.js renderFx), snapped to the band colours
  pixelGlow: false, pxSize: 1, pxAlpha: "steps",        // glow trails as pixel art (像素光效): block size, opacity steps | dither | hard
  mixEdge: 100, mixBody: 100, mixGlow: 100, mixFx: 100, mixBurst: 100,   // the shared glow controls (trails/glow.js mixStyle)
  pxFx: 0,                                               // band trails: one 粒子 slider for dust, shards and splatter
  tailMode: "brush",               // brush (streaks) | dither (dots) | smooth (needs pixel off)
  brush: { kind: "builtin", id: "bristle" },
  color: "#ffffff",
  gradient: [{ p: 0, c: "#ff5a36" }, { p: 1, c: "#fff3b0" }],
  headArc: 0.5,                     // 0 flat head … 1 strongly rounded
  fade: 0.6,                        // tail→head opacity ramp length (0 = no fade)
  taper: 0.25,                      // "head" shape: tail width relative to the head
  opacity: 100,
  fineness: 20,                     // mesh subdivisions between two frames' sticks
  invert: false,
  pixel: true,                      // no partial alpha: dithered, hard-edged pixels
};

export const SHAPES = [["head", "尾细头粗"], ["crescent", "两头尖（月牙）"], ["even", "均匀"]];

export const BUILTIN_PRESETS = [
  { name: "dynamic_trail_luma（灰度纹理）", style: { ...STYLE_DEFAULTS, colorMode: "mono" } },
  { name: "火焰渐变", style: { ...STYLE_DEFAULTS, colorMode: "gradient", gradient: [{ p: 0, c: "#a22633" }, { p: 0.5, c: "#f77622" }, { p: 1, c: "#fee761" }] } },
  { name: "冰霜渐变", style: { ...STYLE_DEFAULTS, colorMode: "gradient", gradient: [{ p: 0, c: "#124e89" }, { p: 0.6, c: "#2ce8f5" }, { p: 1, c: "#ffffff" }] } },
  { name: "暗影月牙", style: { ...STYLE_DEFAULTS, shape: "crescent", colorMode: "gradient", gradient: [{ p: 0, c: "#3e2731" }, { p: 1, c: "#b55088" }], headArc: 0.3 } },
];

export function newTrail(id, name, style) {
  return {
    id, name,
    length: 4,       // frames of sticks one trail spans
    dissolve: 3,     // frames after the last stick in which the trail shrinks and fades away
    rotate: true,    // between two sticks, swing around the inner end (the tip follows an arc)
    turn: "auto",    // which way round: auto (smaller turn) | cw | ccw
    bow: 0,          // -1..1 extra curvature of the whole sweep (a parabola-like bulge)
    plane: "screen", // screen: the swing lies in the picture | flat: a horizontal sweep seen in perspective (an ellipse)
    squash: 0.35,    // flat: how flat the ellipse looks (1 = a circle, seen from straight above)
    tilt: 0,         // flat: the plane's slant in degrees (for a diagonal sweep)
    autoDepth: true, // flat: the far half of the sweep goes behind the character
    smooth: true, flip: false,
    style: JSON.parse(JSON.stringify(style || STYLE_DEFAULTS)), keys: {},
  };
}

export function normalizeTrail(t) {
  return { ...newTrail(t.id, t.name), ...t, style: { ...STYLE_DEFAULTS, ...(t.style || {}) }, keys: t.keys || {} };
}

// What the trail shows on frame `fi` (frameIds: the animation's frame order):
//   { sticks, trim, alpha } or null.
// While the swing is on (this frame has a stick) it is the sticks of up to
// `length` frames, oldest first, stopping at a gap. After the swing peaks — the
// first frames without a stick — the trail lingers for `dissolve` frames: the head
// stays at the last stick while the tail catches up (trim) and it fades (alpha).
export function trailState(trail, frameIds, fi) {
  const keys = trail.keys || {};
  let end = fi, k = 0;
  if (!keys[frameIds[fi]]) {
    const D = Math.max(0, trail.dissolve ?? 3) | 0;
    let j = fi - 1;
    while (j >= 0 && !keys[frameIds[j]] && fi - j <= D) j--;
    if (j < 0 || !keys[frameIds[j]] || fi - j > D) return null;
    end = j; k = fi - j;
  }
  // the whole swing so far: every stick back to the last gap
  let start = end;
  while (start > 0 && keys[frameIds[start - 1]] && end - start < 47) start--;
  const run = [];
  for (let i = start; i <= end; i++) run.push(keys[frameIds[i]]);
  const swing = orientSticks(run);
  const sticks = swing.slice(-(Math.max(1, trail.length | 0) + 1));
  const p = k ? k / ((trail.dissolve | 0) + 1) : 0;
  const st = trail.style || {};
  // ended: this frame has the swing's last stick, or comes after it (the impact)
  const ended = k > 0 || !keys[frameIds[fi + 1]];
  if (st.colorMode !== "glow") return sticks.length < 2 ? null : { sticks, trim: p, alpha: 1 - p, run: swing, age: fi - start, frame: fi, ended, after: k };
  // glow trails also want the whole swing (the flash sits on its first stick,
  // splatter flies off later ones), how long ago it started and the frame (stars
  // twinkle per frame). A lone first stick already shows the flash.
  if (sticks.length < 2 && !(st.flash > 0)) return null;
  return { sticks, trim: p, alpha: 1 - p, run: swing, age: fi - start, frame: fi, ended, after: k };
}

// A stick drawn the wrong way round — its tip end where the grip is — turns the
// ribbon inside out between it and its neighbours: the trail twists into a
// bow-tie. The inner ends of one swing stay around the grip while the tips fly
// wide, so a stick whose "tip" sits much nearer the other sticks' inner ends than
// its own inner end does is taken as reversed. Returns the sticks with those
// turned round (new objects; the stored keys are left alone).
export function orientSticks(S) {
  if (S.length < 2) return S;
  return S.map((k, i) => (stickReversed(k, S.filter((_, j) => j !== i)) ? { ...k, a: k.b, b: k.a } : k));
}

export function stickReversed(k, others) {
  if (!k || !others.length) return false;
  let cx = 0, cy = 0;
  for (const o of others) { cx += o.a[0]; cy += o.a[1]; }
  cx /= others.length; cy /= others.length;
  const da = Math.hypot(k.a[0] - cx, k.a[1] - cy), db = Math.hypot(k.b[0] - cx, k.b[1] - cy);
  return db < da * 0.6;
}

export function sticksAt(trail, frameIds, fi) {
  const st = trailState(trail, frameIds, fi);
  return st ? st.sticks : [];
}

// ---------- textures ----------
// The built-in brush, generated once: brighter toward the outer edge (the blade
// tip sweeps fastest there), with streaks running along the trail.
let builtinLuma = null;
export function builtinTexture() {
  if (builtinLuma) return builtinLuma;
  const W = 256, H = 64;
  const c = createCanvas(W, H);
  const g = c.getContext("2d");
  const id = g.createImageData(W, H);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const streaks = Array.from({ length: 9 }, () => ({ v: 0.25 + rnd() * 0.7, w: 0.02 + rnd() * 0.05, k: 0.25 + rnd() * 0.5, ph: rnd() * 6.28 }));
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      // solid body that brightens toward the outer edge: most of the ribbon reads
      // as a clean slash, only its inner edge and the faded tail break into dither
      let l = 0.62 + 0.3 * Math.pow(v, 1.2);
      l += Math.exp(-Math.pow((v - 0.9) / 0.07, 2)) * 0.3;      // hot outer rim
      for (const s of streaks) {
        const along = 0.6 + 0.4 * Math.sin(u * 18 * s.k + s.ph);
        l += Math.exp(-Math.pow((v - s.v) / s.w, 2)) * s.k * along * 0.25;
      }
      l *= Math.min(1, v * 4);                                  // soft inner edge
      const L = Math.max(0, Math.min(255, Math.round(l * 255)));
      const i = (y * W + x) * 4;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = L;
      id.data[i + 3] = 255;
    }
  }
  g.putImageData(id, 0, 0);
  builtinLuma = c;
  return c;
}

// ---------- geometry ----------
const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}

const cr1 = (p0, p1, p2, p3, t) => cr([p0, 0], [p1, 0], [p2, 0], [p3, 0], t)[0];

// dense cross-sections through the sticks, with u ∈ [0, 1] by arc length of the
// stick midpoints (0 = oldest stick / tail, 1 = current stick / head).
// rotate: interpolate each stick as (inner point, angle, length) — a blade turning
// around the hand — so the tip sweeps an arc instead of cutting the chord.
// turn: which way the blade goes round between two sticks —
//   "auto" the smaller turn, "cw" clockwise on screen, "ccw" counter-clockwise.
// With only a few sticks a big swing is ambiguous (165° one way or 195° the
// other); an overhead chop from upper-left to lower-right is "cw".
function sections(S, smooth, fineness, rotate, turn) {
  const n = Math.max(2, Math.min(64, fineness | 0 || 20));
  const TAU = 2 * Math.PI;
  // stick angles, unwrapped in the chosen direction
  const ang = [], lens = [];
  S.forEach((k, i) => {
    let a = Math.atan2(k.b[1] - k.a[1], k.b[0] - k.a[0]);
    if (i) {
      const p = ang[i - 1];
      if (turn === "cw") { while (a < p) a += TAU; while (a - p >= TAU) a -= TAU; }          // y points down: increasing angle is clockwise
      else if (turn === "ccw") { while (a > p) a -= TAU; while (p - a >= TAU) a += TAU; }
      else { while (a - p > Math.PI) a -= TAU; while (a - p < -Math.PI) a += TAU; }
    }
    ang.push(a);
    lens.push(Math.hypot(k.b[0] - k.a[0], k.b[1] - k.a[1]));
  });
  // The spline wants a neighbour beyond the first and the last stick. Repeating
  // the end stick there straightens the end stretches — the tip cuts the chord
  // instead of following the arc — and leaves a corner where the tail meets the
  // rest. Instead the swing is carried on past its ends as it was going: from
  // the last three sticks (it keeps bending the same way), or two.
  const m = S.length;
  const ext = (get) => (i) => {
    if (i >= 0 && i < m) return get(i);
    const [p, q, r] = i < 0 ? [0, 1, 2] : [m - 1, m - 2, m - 3];
    const A = get(p), B = get(q), C = m >= 3 ? get(r) : null;
    const f = (x, y, z) => (C ? 3 * x - 3 * y + z : 2 * x - y);
    return typeof A === "number" ? f(A, B, C) : [f(A[0], B[0], C && C[0]), f(A[1], B[1], C && C[1])];
  };
  const PA = ext((i) => S[i].a), PB = ext((i) => S[i].b), PT = ext((i) => ang[i]), PL = ext((i) => lens[i]);
  const out = [];
  for (let k = 0; k < S.length - 1; k++) {
    for (let j = 0; j < n; j++) {
      const t = j / n;
      const a = smooth ? cr(PA(k - 1), PA(k), PA(k + 1), PA(k + 2), t) : lerp(S[k].a, S[k + 1].a, t);
      let b;
      if (rotate) {
        const th = smooth ? cr1(PT(k - 1), PT(k), PT(k + 1), PT(k + 2), t) : ang[k] + (ang[k + 1] - ang[k]) * t;
        const L = Math.max(0, smooth ? cr1(PL(k - 1), PL(k), PL(k + 1), PL(k + 2), t) : lens[k] + (lens[k + 1] - lens[k]) * t);
        b = [a[0] + Math.cos(th) * L, a[1] + Math.sin(th) * L];
      } else {
        b = smooth ? cr(PB(k - 1), PB(k), PB(k + 1), PB(k + 2), t) : lerp(S[k].b, S[k + 1].b, t);
      }
      // the back / front choice of a stick covers the sweep leading up to it
      out.push({ a, b, z: (t < 0.5 ? S[k] : S[k + 1]).z || "front" });
    }
  }
  const last = S[S.length - 1];
  out.push({ a: last.a.slice(), b: last.b.slice(), z: last.z || "front" });
  let len = 0;
  out[0].u = 0;
  for (let i = 1; i < out.length; i++) {
    const m0 = lerp(out[i - 1].a, out[i - 1].b, 0.5), m1 = lerp(out[i].a, out[i].b, 0.5);
    len += Math.hypot(m1[0] - m0[0], m1[1] - m0[1]);
    out[i].u = len;
  }
  for (const q of out) q.u = len ? q.u / len : 0;
  return out;
}

// The sweep between the sticks. A flat (横扫) trail is a horizontal swing seen in
// perspective: the sticks are drawn as they look on screen, foreshortened, so
// they are first stretched back onto the swing's plane (undo the tilt, then
// divide the height by `squash`), the blade is turned around the grip there —
// the tip runs on a circle — and the result is squashed back: on screen the tip
// runs on an ellipse. Only the y scale differs between the two spaces, so the
// pivot of the stretch doesn't matter. With autoDepth the part where the blade
// points away from the viewer (up, on the plane) goes behind the character.
function sweptSections(trail, sticks) {
  const smooth = trail.smooth !== false, fineness = trail.style.fineness, turn = trail.turn || "auto";
  if (trail.plane !== "flat") return sections(sticks, smooth, fineness, trail.rotate !== false, turn);
  const k = Math.max(0.05, Math.min(1, +trail.squash || 0.35));
  const th = ((+trail.tilt || 0) * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  const toPlane = (p) => [p[0] * c + p[1] * s, (-p[0] * s + p[1] * c) / k];
  const fromPlane = (p) => { const y = p[1] * k; return [p[0] * c - y * s, p[0] * s + y * c]; };
  const flat = sections(sticks.map((q) => ({ ...q, a: toPlane(q.a), b: toPlane(q.b) })), smooth, fineness, true, turn);
  return flat.map((q) => ({
    ...q,
    a: fromPlane(q.a), b: fromPlane(q.b),
    z: trail.autoDepth !== false ? (q.b[1] - q.a[1] < 0 ? "back" : "front") : q.z,
  }));
}

// Bow the whole sweep sideways by bow * sin(πu): zero at both ends, largest in
// the middle — the parabola-like arc of an overhead chop. Positive bulges toward
// the blade tips (outward), negative toward the hand.
function applyBow(out, bow) {
  if (!bow || out.length < 3) return out;
  const m = (q) => lerp(q.a, q.b, 0.5);
  const p0 = m(out[0]), p1 = m(out[out.length - 1]);
  let dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const chord = Math.hypot(dx, dy);
  let nx, ny;
  if (chord > 1e-6) { nx = -dy / chord; ny = dx / chord; }
  else { nx = 0; ny = -1; }
  // orient the normal toward the side the blades point to
  let ox = 0, oy = 0;
  for (const q of out) { ox += q.b[0] - q.a[0]; oy += q.b[1] - q.a[1]; }
  if (nx * ox + ny * oy < 0) { nx = -nx; ny = -ny; }
  let pathLen = 0;
  for (let i = 1; i < out.length; i++) { const a = m(out[i - 1]), b = m(out[i]); pathLen += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const amp = Math.max(-1, Math.min(1, bow)) * Math.max(chord, pathLen) * 0.35;
  return out.map((q) => {
    const d = Math.sin(Math.PI * q.u) * amp;
    return { ...q, a: [q.a[0] + nx * d, q.a[1] + ny * d], b: [q.b[0] + nx * d, q.b[1] + ny * d] };
  });
}

// keep the part of the sections from u = trim on, re-spread over u ∈ [0, 1] so the
// shrinking trail keeps its tapered shape while it catches up with the head
function trimSections(out, trim) {
  if (!(trim > 0)) return out;
  if (trim >= 0.999) return [];
  const res = [];
  for (let i = 0; i < out.length; i++) {
    const q = out[i];
    if (q.u < trim) {
      const r = out[i + 1];
      if (r && r.u > trim) {
        const t = (trim - q.u) / (r.u - q.u);
        res.push({ a: lerp(q.a, r.a, t), b: lerp(q.b, r.b, t), z: q.z, u: trim });
      }
      continue;
    }
    res.push(q);
  }
  return res.map((q) => ({ ...q, u: (q.u - trim) / (1 - trim) }));
}

function profile(st, u) {
  if (st.shape === "even") return 1;
  if (st.shape === "crescent") return Math.max(0.06, Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.92 + 0.04)), 0.7));
  const taper = Math.max(0, Math.min(1, st.taper ?? 0.25));
  return taper + (1 - taper) * u;
}

// the ribbon's cross-sections: width profile applied about each stick's middle,
// plus a rounded head cap bulging forward along the swing
function ribbonSections(trail, sticks, trim) {
  if (sticks.length < 2) return [];
  const st = trail.style;
  const swept = applyBow(sweptSections(trail, sticks), trail.bow || 0);
  const out = trimSections(swept, trim).map((q) => {
    const w = profile(st, q.u), m = lerp(q.a, q.b, 0.5);
    return { a: lerp(m, q.a, w), b: lerp(m, q.b, w), z: q.z, u: q.u };
  });
  if (out.length < 2) return [];
  const arc = Math.max(0, Math.min(1, st.headArc ?? 0.5));
  const H = out[out.length - 1], P = out[out.length - 2];
  if (arc > 0 && P && st.shape !== "crescent") {
    const m = lerp(H.a, H.b, 0.5), pm = lerp(P.a, P.b, 0.5);
    let dx = m[0] - pm[0], dy = m[1] - pm[1];
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const hv = [(H.b[0] - H.a[0]) / 2, (H.b[1] - H.a[1]) / 2];
    const bulge = arc * Math.hypot(hv[0], hv[1]);
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const th = (i / steps) * Math.PI / 2, c = Math.cos(th), sn = Math.sin(th);
      out.push({
        a: [m[0] - hv[0] * c + dx * bulge * sn, m[1] - hv[1] * c + dy * bulge * sn],
        b: [m[0] + hv[0] * c + dx * bulge * sn, m[1] + hv[1] * c + dy * bulge * sn],
        z: H.z, u: 1,
      });
    }
  }
  return out;
}

function gradientAt(stops, u) {
  const s = [...stops].sort((x, y) => x.p - y.p);
  if (u <= s[0].p) return hexToRgb(s[0].c);
  for (let i = 1; i < s.length; i++) {
    if (u <= s[i].p) {
      const t = (u - s[i - 1].p) / ((s[i].p - s[i - 1].p) || 1);
      const a = hexToRgb(s[i - 1].c), b = hexToRgb(s[i].c);
      return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * t));
    }
  }
  return hexToRgb(s[s.length - 1].c);
}

// pixel mode: gradient colours snap to the nearest node, no blends
function gradientStep(stops, u) {
  let best = stops[0], bd = Infinity;
  for (const s of stops) { const d = Math.abs(s.p - u); if (d < bd) { bd = d; best = s; } }
  return hexToRgb(best.c);
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// ---------- brushes for the tail ----------
// A brush is a greyscale strip: x runs along the trail (tail -> head), y across it
// (inner -> outer). Where it is bright, a streak reaches further into the tail.
// So the tail ends in strokes of different lengths — a dry brush dragged along
// the swing — instead of scattered dither dots.
export const BUILTIN_BRUSHES = [
  { id: "bristle", name: "毛刷（细密刷痕）" },
  { id: "dry", name: "干刷（稀疏断笔）" },
];
const brushCache = new Map();
export function builtinBrush(id) {
  if (brushCache.has(id)) return brushCache.get(id);
  const W = 256, H = 64;
  const c = createCanvas(W, H);
  const g = c.getContext("2d");
  const img = g.createImageData(W, H);
  let seed = id === "dry" ? 91 : 17;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // bristle groups: a smooth random profile across the width plus per-row jitter
  const ctl = Array.from({ length: 13 }, () => rnd());
  const rows = Array.from({ length: H }, (_, y) => {
    const t = y / (H - 1) * (ctl.length - 1), i = Math.floor(t), f = t - i;
    const group = ctl[i] * (1 - f) + ctl[Math.min(ctl.length - 1, i + 1)] * f;
    return id === "dry"
      ? (rnd() < 0.35 ? 0.05 : 0.25 + 0.75 * (0.5 * group + 0.5 * rnd()))
      : 0.2 + 0.8 * (0.55 * group + 0.45 * rnd());
  });
  // dry brush: each row also has a few gaps along the stroke
  const gaps = rows.map(() => (id === "dry" ? Array.from({ length: 3 }, () => [rnd(), 0.02 + rnd() * 0.08]) : []));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      let b = rows[y] + 0.18 * u + 0.06 * Math.sin(u * 23 + y * 1.7);
      for (const [gu, gw] of gaps[y]) if (Math.abs(u - gu) < gw) b *= 0.25;
      const L = Math.max(0, Math.min(255, Math.round(b * 255)));
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = L;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  brushCache.set(id, c);
  return c;
}

const brushData = new WeakMap();
function brushSampler(canvas) {
  let d = brushData.get(canvas);
  if (!d) {
    const x = canvas.getContext("2d", { willReadFrequently: true });
    const id = x.getImageData(0, 0, canvas.width, canvas.height);
    const lum = new Float32Array(canvas.width * canvas.height);
    for (let i = 0; i < lum.length; i++) {
      lum[i] = ((0.299 * id.data[i * 4] + 0.587 * id.data[i * 4 + 1] + 0.114 * id.data[i * 4 + 2]) / 255) * (id.data[i * 4 + 3] / 255);
    }
    d = { w: canvas.width, h: canvas.height, lum };
    brushData.set(canvas, d);
  }
  return (u, v) => {
    const x = Math.max(0, Math.min(d.w - 1, Math.round(u * (d.w - 1))));
    const y = Math.max(0, Math.min(d.h - 1, Math.round(v * (d.h - 1))));
    return d.lum[y * d.w + x];
  };
}

// Where a pixel sits for the tail fades: u from the tail — or, for 两头尖,
// from whichever end is nearer, so the head end thins and breaks up just as
// the tail does (both ends read as tails, sharing the fade length half each)
function endsFn(st) {
  return st.shape === "crescent" ? (u) => 2 * Math.min(u, 1 - u) : (u) => u;
}

// How much of the trail survives at (u, v) in the tail (0 = gone, 1 = solid).
// fade: length of the tail region as a share of the trail; past it, solid.
function tailFn(st, brush) {
  const fade = Math.max(0, Math.min(1, st.fade ?? 0.45));
  const mode = st.tailMode || "brush";
  const sample = mode === "brush" && brush ? brushSampler(brush) : null;
  return (u, v, x, y) => {
    const s = fade > 0 ? Math.min(1, u / fade) : 1;
    if (s >= 1) return 1;
    if (sample) {
      // a streak survives where its bristle is bright enough for how far into
      // the tail we are; the brush is stretched over the tail region only
      const e = s - (1 - sample(Math.min(1, u / Math.max(fade, 1e-3)), v));
      if (st.pixel) return e >= 0 ? 1 : 0;
      return Math.max(0, Math.min(1, 0.5 + e / 0.18));
    }
    if (mode === "smooth" && !st.pixel) return s;
    return s > (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 ? 1 : 0;
  };
}

// 色带 styles (the same presets as the trail brush, editor/trailbrush.js): bands
// of colour across the ribbon's width, outer -> inner, each narrower and brighter.
//
// Every pixel learns where it sits across the ribbon from the uv map — e: 0 on
// the middle line and 1 at the edges (center layout), or 0 at the blade-tip edge
// and 1 at the grip edge (edge layout: a bright leading edge, darker inward,
// like most hand-drawn pixel slashes) — and the band ramp turns that into a colour. Where two
// bands meet, the ramp can blend them — with in-between shades, a dither, or
// smoothly — and toward the tail every pixel is pushed outward (bandShade), so
// the tail is drawn in the darker outer colours. Colours change, alpha never
// does: in pixel mode the result is still hard-edged, solid pixel art.
function bandRamp(bands, st) {
  const n = bands.length, fs = bands.map((b) => b[1]);
  const mode = st.bandBlend || "steps", soft = Math.max(0, Math.min(1, st.bandSoft ?? 0.6));
  // mixing in squared (roughly linear-light) space keeps the in-between shades
  // bright instead of muddy
  const mix = (p, q, t) => [0, 1, 2].map((k) => Math.round(Math.sqrt(p[k] * p[k] * (1 - t) + q[k] * q[k] * t)));
  return (e, x, y) => {
    let k = 0;
    while (k < n - 1 && e <= fs[k + 1]) k++;
    if (mode === "hard" || soft <= 0 || n < 2) return bands[k][0];
    // the boundary next to this pixel: j sits between band j-1 (outer) and j (inner)
    for (const j of [k, k + 1]) {
      if (j < 1 || j > n - 1) continue;
      const hw = soft * 0.5 * Math.min(fs[j - 1] - fs[j], fs[j] - (j + 1 < n ? fs[j + 1] : 0));
      const d = e - fs[j];
      if (hw <= 0 || Math.abs(d) >= hw) continue;
      let tt = (d + hw) / (2 * hw);                       // 0 = inner colour, 1 = outer colour
      if (mode === "dither") return tt > (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 ? bands[j - 1][0] : bands[j][0];
      tt = mode === "steps" ? Math.round(tt * 3) / 3 : tt * tt * (3 - 2 * tt);   // steps: two shades in between
      return mix(bands[j][0], bands[j - 1][0], tt);
    }
    return bands[k][0];
  };
}

function hashStr(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h | 0;
}

const smooth01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// Value noise over the ribbon's own (u, v), stretched along the trail: long thin
// streaks, like the ragged edge of a dry brush stroke. 0..1.
function streakNoise(seed) {
  const hash = (x, y) => {
    let v = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967295;
  };
  const one = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    let tx = x - ix, ty = y - iy;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  return (u, v) => one(u * 7, v * 38) * 0.6 + one(u * 19 + 5.3, v * 90 + 1.7) * 0.4;
}

// Speed lines (速度线): thin lines along the trail at fixed heights across it,
// each running a stretch of the length and thinning out at both ends. Drawn 1px
// wide; returns per-pixel strength (0..255) plus colorAt(i), or null.
function streakMap(st, runs, w, h, f0) {
  const n = Math.round(Math.max(0, Math.min(1, st.streaks || 0)) * 16);
  if (!n || !runs.length) return null;
  const edge = st.bandLayout === "edge";
  const bands = (st.bands && st.bands.length ? st.bands : [[st.color || "#ffffff", 1]]).map(([c, f]) => [hexToRgb(c), f]).sort((p, q) => q[1] - p[1]);
  const ramp = bandRamp(bands, { ...st, bandBlend: "smooth" });
  const C = createCanvas(w, h), g = C.getContext("2d", { willReadFrequently: true });
  const colors = [];
  let seed = 1;
  for (const r of runs) for (const q of r) seed = (seed * 31 + Math.round(q.a[0] * 7 + q.b[1] * 13)) % 2147483647;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  g.lineWidth = 1.1;
  g.lineCap = "butt";
  for (let s = 0; s < n; s++) {
    // edge layout: mostly on the inner (grip) half, where the body fades
    const v = edge ? 0.04 + 0.6 * Math.pow(rnd(), 0.8) : 0.08 + 0.84 * rnd();
    const u0 = rnd() * 0.55, u1 = Math.min(1, u0 + 0.25 + rnd() * 0.6);
    const e = edge ? 1 - v : Math.abs(2 * v - 1);
    colors.push(ramp(Math.max(0, e - 0.25), 0, 0));
    // the colour index rides in the red channel, the strength in alpha
    for (const r of runs) {
      let prev = null;
      for (const q of r) {
        if (q.u < u0 || q.u > u1) { prev = null; continue; }
        const p = [q.a[0] + (q.b[0] - q.a[0]) * v, q.a[1] + (q.b[1] - q.a[1]) * v];
        if (prev) {
          const m = (q.u - u0) / (u1 - u0);
          g.strokeStyle = `rgba(${s + 1},0,0,${(Math.sin(Math.PI * m) * (0.55 + 0.45 * rnd())).toFixed(3)})`;
          g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(p[0], p[1]); g.stroke();
        }
        prev = p;
      }
    }
  }
  const d = g.getImageData(0, 0, w, h).data;
  const out = new Uint8ClampedArray(w * h), idx = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = d[i * 4 + 3];
    if (a < 40) continue;                // anti-aliasing fringe: keep the lines 1px
    out[i] = a; idx[i] = Math.max(1, Math.min(n, d[i * 4]));
  }
  out.colorAt = (i) => colors[idx[i] - 1] || colors[0];
  return out;
}

function renderBands(t, segs, state, w, h, brush) {
  const st = t.style;
  const bands = (st.bands && st.bands.length ? st.bands : [[st.color || "#ffffff", 1]])
    .map(([c, f]) => [hexToRgb(c), f]).sort((p, q) => q[1] - p[1]);
  const f0 = bands[0][1];
  // The silhouette (the outermost band) is filled as ONE outline per unbroken
  // run of sections (down one edge, back up the other). Filling quad by quad
  // leaves anti-aliased seams between neighbours, which show as fine radial lines
  // when pixel mode is off.
  const runs = [];
  for (const [p, q] of segs) {
    const r = runs[runs.length - 1];
    if (r && r[r.length - 1] === p) r.push(q); else runs.push([p, q]);
  }
  const B = createCanvas(w, h), bg = B.getContext("2d", { willReadFrequently: true });
  bg.fillStyle = "#000";
  for (const run of runs) {
    const sc = run.map((s) => { const m = lerp(s.a, s.b, 0.5); return [lerp(m, s.a, f0), lerp(m, s.b, f0)]; });
    bg.beginPath();
    sc.forEach(([a], i) => (i ? bg.lineTo(a[0], a[1]) : bg.moveTo(a[0], a[1])));
    for (let i = sc.length - 1; i >= 0; i--) bg.lineTo(sc[i][1][0], sc[i][1][1]);
    bg.closePath();
    bg.fill();
  }
  const cov = bg.getImageData(0, 0, w, h).data;
  const uv = uvMap(segs, w, h, t.flip);
  const tail = tailFn(st, brush), ends = endsFn(st);
  const ramp = bandRamp(bands, st);
  const shade = Math.max(0, Math.min(1, st.bandShade ?? 0.4));
  const edge = st.bandLayout === "edge";
  const efade = Math.max(0, Math.min(1, st.edgeFade || 0));
  // dissolving (after the swing): rather than fading — a checkerboard of dither
  // in pixel art — the slash thins toward its brightest line and breaks into
  // pieces along its length, the way hand-drawn slashes vanish
  const gone = 1 - Math.max(0, Math.min(1, state.alpha ?? 1));
  const pieces = gone > 0 ? streakNoise(hashStr((t.id || "x") + "#pieces")) : null;
  const op = ((st.opacity ?? 100) / 100) * (st.pixel ? 1 : 1 - 0.5 * gone);
  // pixel mode: partial opacity becomes a dither, or (fadeSteps) 4 opacity steps
  const solid = (a, x, y) => {
    if (a >= 1) return 1;
    if (st.fadeSteps) return Math.round(a * 4) / 4;
    return a > (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 ? 1 : 0;
  };
  const streak = streakMap(st, runs, w, h, f0);
  const brk = Math.max(0, Math.min(1, st.edgeBreak || 0));
  const noise = brk > 0 ? streakNoise(hashStr(t.id || "x")) : null;
  const splits = Math.max(0, Math.min(4, st.splits | 0));
  const out = new ImageData(w, h), od = out.data;
  for (let i = 0; i < w * h; i++) {
    const c = cov[i * 4 + 3];
    if (st.pixel ? c < 128 : !c) continue;
    const x = i % w, y = (i / w) | 0;
    const has = uv[i * 4 + 3];
    const u = has ? uv[i * 4] / 255 : 1, v = has ? uv[i * 4 + 1] / 255 : 0.5;
    // edge pixels the uv map missed take the outer colour (center) / count as
    // the faded grip side (edge)
    const nz = noise ? noise(u, v) - 0.5 : 0;
    // 分条: the width splits into parallel strips, a ragged gap on the inner side
    // of each; every strip is coloured (and faded) as a whole trail of its own,
    // and the ones further in are a little fainter — the rings of a spin attack
    let sv = v, dim = 1;
    if (splits && has) {
      const pos = v * (splits + 1), k = Math.min(splits, Math.floor(pos)), lv = pos - k;
      const gap = Math.max(0.05, 0.3 + nz * brk * 0.5);
      if (lv < gap) continue;
      sv = (lv - gap) / (1 - gap);
      dim = 1 - 0.2 * (splits - k);
    }
    const e0 = has ? (edge ? 1 - sv : Math.abs(2 * sv - 1)) : edge ? 1 : f0;
    let a = tail(ends(u), v, x, y) * op * dim;
    // 破碎: the noise pushes the fading edge and the band edges in and out in
    // streaks, and chips the leading edge along the older part of the trail
    if (efade > 0) a *= 1 - smooth01((e0 + nz * brk * 1.0 - (1 - efade)) / efade);
    if (noise && !edge && e0 > 0.8 && nz < (e0 - 0.8) * 3 * brk - 0.5) a = 0;
    if (noise && e0 < 0.12 && u < 0.75 && nz < -0.5 + brk * 0.45 * (1 - u / 0.75)) a = 0;
    if (pieces) {
      // thinner and thinner (a ragged inner edge), and gaps opening across it
      if (e0 > 1 - gone + nz * 0.2) continue;
      // the cuts run clean across: whole pieces, not holes
      if (pieces(u * 1.2, 0.5) < gone * 0.6) continue;
    }
    // speed lines show through where the body has faded
    const sk = streak ? streak[i] / 255 * op : 0;
    let col;
    if (sk > a) { a = sk; col = streak.colorAt(i); }
    else {
      const e = 1 - (1 - e0) * (1 - shade * (1 - ends(u))) + nz * brk * 0.45;
      col = ramp(Math.max(0, Math.min(1, e)), x, y);
    }
    if (st.pixel) a = solid(a, x, y);
    else a *= c / 255;
    if (a <= 0) continue;
    od[i * 4] = col[0]; od[i * 4 + 1] = col[1]; od[i * 4 + 2] = col[2]; od[i * 4 + 3] = Math.round(a * 255);
  }
  bandFx(t, runs, state, bands, w, h, od);
  return out;
}

// The accents of the glow trails (dust, shards, splatter, the impact burst) for
// a band trail: drawn smooth, then in pixel mode every pixel at least a third
// covered becomes solid and takes the nearest of the trail's own band colours,
// so the accents are clean pixel art in the same palette. They go on top.
function bandFx(t, runs, state, bands, w, h, od) {
  const st = t.style, amt = (k) => Math.max(0, Math.min(1, st[k] || 0));
  const all = amt("pxFx");
  const amounts = { dust: Math.max(amt("pxDust"), all), shards: Math.max(amt("pxShards"), all * 0.6), splatter: Math.max(amt("pxSplatter"), all * 0.6), impact: amt("pxImpact") };
  if (!(amounts.dust || amounts.shards || amounts.splatter || amounts.impact) || !state.run) return;
  const colors = bands.map(([c]) => c);                               // outer (dark) -> inner (bright)
  const op = ((st.opacity ?? 100) / 100);
  const fx = renderFx(runs, state.run, colors, amounts, w, h, {
    seed: hashSeed(t.id || "x"), frame: state.frame || 0, alpha: state.alpha ?? 1, age: state.age || 0, ended: !!state.ended, after: state.after || 0,
  });
  if (!fx) return;
  const d = fx.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  for (let i = 0; i < w * h; i++) {
    const a = d[i * 4 + 3];
    if (!a) continue;
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    if (st.pixel !== false) {
      if (a < 85) continue;
      let best = bands[0][0], bd = Infinity;
      for (const [c] of bands) { const dd = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2; if (dd < bd) { bd = dd; best = c; } }
      od[i * 4] = best[0]; od[i * 4 + 1] = best[1]; od[i * 4 + 2] = best[2]; od[i * 4 + 3] = Math.round(255 * Math.min(1, op));
    } else {
      const fa = (a / 255) * op, pa = od[i * 4 + 3] / 255, na = fa + pa * (1 - fa);
      for (let k = 0; k < 3; k++) od[i * 4 + k] = Math.round((d[i * 4 + k] * fa + od[i * 4 + k] * pa * (1 - fa)) / (na || 1));
      od[i * 4 + 3] = Math.round(na * 255);
    }
  }
}

// Render a trail state (see trailState) into a w×h ImageData in document pixels
// (a canvas for glow trails, which are drawn on the GPU throughout).
// z: "front" | "back" | null (both). assets: { tex, brush } canvases.
export function renderTrail(trail, state, w, h, assets, z) {
  const t = normalizeTrail(trail);
  if (t.style.colorMode === "glow") return renderGlowTrail(t, state, w, h, z);
  const all = ribbonSections(t, state.sticks, state.trim || 0);
  if (all.length < 2) return null;
  const st = t.style;
  const brush = (assets && assets.brush) || builtinBrush("bristle");
  const segs = [];
  for (let i = 0; i < all.length - 1; i++) if (!z || all[i].z === z) segs.push([all[i], all[i + 1]]);
  if (!segs.length) return null;

  if (st.colorMode === "bands") return renderBands(t, segs, state, w, h, brush);

  const texture = (assets && assets.tex) || builtinTexture();
  const TW = texture.width, TH = texture.height;
  const A = createCanvas(w, h), ag = A.getContext("2d", { willReadFrequently: true });
  for (const [p, q] of segs) {
    const v0 = t.flip ? TH : 0, v1 = t.flip ? 0 : TH;
    const su1 = Math.min(TW - 1, q.u * (TW - 1)), su0 = Math.min(Math.min(TW - 1, p.u * (TW - 1)), su1 - 1);   // see uvMap: the head cap
    texTri(ag, texture, [su0, v0], [su0, v1], [su1, v1], p.a, p.b, q.b);
    texTri(ag, texture, [su0, v0], [su1, v1], [su1, v0], p.a, q.b, q.a);
  }
  const ad = ag.getImageData(0, 0, w, h).data;
  const uv = uvMap(segs, w, h, t.flip);
  const tail = tailFn(st, brush), ends = endsFn(st);
  const out = new ImageData(w, h), od = out.data;
  const op = ((st.opacity ?? 100) / 100) * (state.alpha ?? 1);
  const mono = hexToRgb(st.color || "#ffffff");
  const stops = st.gradient && st.gradient.length ? st.gradient : STYLE_DEFAULTS.gradient;
  for (let i = 0; i < w * h; i++) {
    const ta = ad[i * 4 + 3];
    if (!ta || !uv[i * 4 + 3]) continue;
    const x = i % w, y = (i / w) | 0;
    const u = uv[i * 4] / 255, v = uv[i * 4 + 1] / 255;
    const keep = tail(ends(u), v, x, y);
    if (!keep) continue;
    let r, g, b, a;
    if (st.colorMode === "original") {
      r = ad[i * 4]; g = ad[i * 4 + 1]; b = ad[i * 4 + 2];
      a = (ta / 255) * keep * op;
    } else {
      let l = (0.299 * ad[i * 4] + 0.587 * ad[i * 4 + 1] + 0.114 * ad[i * 4 + 2]) / 255;
      if (st.invert) l = 1 - l;
      a = l * (ta / 255) * keep * op;
      [r, g, b] = st.colorMode === "gradient" ? (st.pixel ? gradientStep(stops, u) : gradientAt(stops, u)) : mono;
    }
    if (st.pixel) {
      if (a <= (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16) continue;
      a = 1;
    }
    od[i * 4] = r; od[i * 4 + 1] = g; od[i * 4 + 2] = b; od[i * 4 + 3] = Math.round(a * 255);
  }
  return out;
}

// 光效 (trails/glow.js): smooth light, ignores the texture, brush and pixel mode.
// The sections of the wanted depth are split into unbroken runs; stars, flash and
// splatter go with the front pass.
function renderGlowTrail(t, state, w, h, z) {
  const all = state.sticks.length >= 2 ? ribbonSections(t, state.sticks, state.trim || 0) : [];
  const runs = [];
  let cur = null;
  for (let i = 0; i < all.length; i++) {
    if (!z || all[i].z === z) { if (!cur) runs.push(cur = []); cur.push(all[i]); }
    else cur = null;
  }
  // pixel art and cel shading keep the glow tight: a wide soft halo would turn
  // into a flat plate of the faintest opacity step around the trail
  const base = mixStyle(t.style);                              // the shared 强度 / 光晕 / 粒子 / 爆发 controls
  const flat = base.pixelGlow || base.cel > 0;
  let st = flat ? { ...base, glow: (base.glow || 0) * 0.5, haze: (base.haze || 0) * 0.6 } : base;
  // pixel art wants a clean slash: the fine detail of the smooth glow — hair-
  // thin strands, dust, twinkles, lens flares — only turns into stray pixels
  // once snapped to blocks, so there is much less of it
  if (base.pixelGlow) {
    const less = { strands: 0.5, haze: 0.4, sparkles: 0.3, dust: 0.25, splatter: 0.5, shards: 0.5, flash: 0.35, impact: 0.4, snow: 0.5, embers: 0.6 };
    st = { ...st };
    for (const [k, m] of Object.entries(less)) st[k] = (+base[k] || 0) * m;
  }
  // 两头尖: the head end is drawn as a tail too (see mirrorTails), the two
  // tails sharing the fade length half each
  const two = t.style.shape === "crescent";
  const ctx = {
    seed: hashSeed(t.id), frame: state.frame || 0, alpha: state.alpha ?? 1, fade: (t.style.fade ?? 0.6) * (two ? 0.5 : 1),
    fx: z !== "back", run: state.run || [], age: state.age || 0, ended: !!state.ended, after: state.after || 0,
  };
  let c = renderGlow(runs, st, w, h, ctx);
  if (two && runs.length) {
    const back = runs.map((r) => r.slice().reverse().map((q) => ({ ...q, u: 1 - q.u }))).reverse();
    c = mirrorTails(c, renderGlow(back, st, w, h, { ...ctx, fx: false, ended: false }), all);
  }
  // 像素光效: the same glow, turned into pixel art
  if (t.style.pixelGlow) return pixelateGlow(c, t.style, { size: t.style.pxSize, alpha: t.style.pxAlpha });
  // 色阶: flat cel-shaded tones (and an outline), the 2D anime look
  return t.style.cel > 0 ? celShade(c, t.style, t.style.cel / 100, (t.style.celOutline || 0) / 100) : c;
}

// 两头尖 for glow trails: both ends should read as tails, and a glow's tail is
// more than a fade — strands only start there, the core draws in, the flow
// and colour change along it — spread over all its layers. So the trail is
// also drawn reversed (head and tail swapped, no accents: the burst at the
// tip has no place on a tail), and the two are joined in the middle: the
// first half from the forward drawing, the second from the reversed one, with
// a soft hand-over. Each pixel's place along the trail is that of the nearest
// point on its middle line — continuous round a bend, and for light off to
// the side the part of the trail it comes from.
function mirrorTails(fwd, rev, all) {
  if (!fwd || !rev || all.length < 2) return fwd || rev;
  const w = fwd.width, h = fwd.height;
  const box = (c) => c.bbox || { x0: 0, y0: 0, w, h };
  const A = box(fwd), B = box(rev);
  const x0 = Math.max(0, Math.floor(Math.min(A.x0, B.x0))), y0 = Math.max(0, Math.floor(Math.min(A.y0, B.y0)));
  const x1 = Math.min(w, Math.ceil(Math.max(A.x0 + A.w, B.x0 + B.w))), y1 = Math.min(h, Math.ceil(Math.max(A.y0 + A.h, B.y0 + B.h)));
  if (x1 <= x0 || y1 <= y0) return fwd;
  // the middle line, thinned to at most ~48 points: the search runs per pixel
  const step = Math.max(1, Math.ceil(all.length / 48));
  const pick = all.filter((_, i) => i % step === 0 || i === all.length - 1);
  const mid = pick.map((q) => lerp(q.a, q.b, 0.5)), us = pick.map((q) => q.u);
  const bw = x1 - x0, bh = y1 - y0, img = new ImageData(bw, bh), d8 = img.data;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const px = x0 + x + 0.5, py = y0 + y + 0.5;
    let best = Infinity, u = 0;
    for (let i = 1; i < mid.length; i++) {
      const [ax, ay] = mid[i - 1], dx = mid[i][0] - ax, dy = mid[i][1] - ay, l2 = dx * dx + dy * dy;
      const s = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
      const ex = ax + dx * s - px, ey = ay + dy * s - py, d2 = ex * ex + ey * ey;
      if (d2 < best) { best = d2; u = us[i - 1] + (us[i] - us[i - 1]) * s; }
    }
    // how much of this pixel comes from the forward drawing
    d8[(y * bw + x) * 4 + 3] = Math.round(255 * (1 - smooth01((u - 0.42) / 0.16)));
  }
  const W = createCanvas(w, h);
  W.getContext("2d").putImageData(img, x0, y0);
  const fg = fwd.getContext("2d"), rg = rev.getContext("2d");
  fg.globalCompositeOperation = "destination-in"; fg.drawImage(W, 0, 0); fg.globalCompositeOperation = "source-over";
  rg.globalCompositeOperation = "destination-out"; rg.drawImage(W, 0, 0);
  // the two shares of each pixel add back up to one
  rg.globalCompositeOperation = "lighter"; rg.drawImage(fwd, 0, 0); rg.globalCompositeOperation = "source-over";
  rev.bbox = { x0, y0, w: bw, h: bh };
  return rev;
}

// The same bands + tail rendering for any ribbon given as cross-sections
// [{ a, b, u }] (u: 0 tail .. 1 head) — used by the freehand trail brush.
// style: { bands, fade, tailMode, pixel, opacity }; brush: brush canvas or null.
export function renderStroke(sections, style, w, h, brush) {
  const segs = [];
  for (let i = 0; i < sections.length - 1; i++) segs.push([sections[i], sections[i + 1]]);
  if (!segs.length) return null;
  const t = { style: { ...STYLE_DEFAULTS, ...style, colorMode: "bands" }, flip: false };
  return renderBands(t, segs, { alpha: 1 }, w, h, brush || builtinBrush("bristle"));
}

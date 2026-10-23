// Shared helpers for the glow renderer: maths, colour, noise and the trail's
// own coordinates.
import { createCanvas } from "../../core/util.js";
import { uvMap } from "../uv.js";

export const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

export const clamp01 = (x) => Math.max(0, Math.min(1, x));

export const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0 || 1e-6)); return t * t * (3 - 2 * t); };

export const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

export function rng(seed) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

export function hashSeed(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 2147483646 + 1;
}

export function colorAcross(cols, v) {
  const t = clamp01(v) * (cols.length - 1);
  const i = Math.min(cols.length - 2, Math.floor(t)), f = t - i;
  const a = cols[i], b = cols[i + 1];
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f));
}

export const widthOf = (q) => Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]);

// a point on the last run at (u, v), interpolated between sections, with the
// section's across vector (inner -> outer)
export function onRun(r, u, v) {
  let i = 1;
  while (i < r.length - 1 && r[i].u < u) i++;
  const p = r[i - 1], q = r[i], t = clamp01((u - p.u) / ((q.u - p.u) || 1));
  const a = lerp(p.a, p.b, v), b = lerp(q.a, q.b, v);
  const ax = q.b[0] - q.a[0], ay = q.b[1] - q.a[1], al = Math.hypot(ax, ay) || 1;
  return { pt: lerp(a, b, t), across: [ax / al, ay / al] };
}

// draw the canvases blurred by rad px. Wide blurs are done on a smaller copy and
// scaled back up — the same picture at a fraction of the cost.
export function drawBlurred(g, srcs, rad) {
  const w = g.canvas.width, h = g.canvas.height;
  const k = Math.max(1, Math.min(4, Math.floor(rad / 5)));
  if (k === 1) {
    g.filter = `blur(${rad}px)`;
    for (const s of srcs) g.drawImage(s, 0, 0);
    g.filter = "none";
    return;
  }
  const sw = Math.ceil(w / k), sh = Math.ceil(h / k);
  const small = createCanvas(sw, sh), sg = small.getContext("2d");
  for (const s of srcs) sg.drawImage(s, 0, 0, sw, sh);
  const out = createCanvas(sw, sh), tg = out.getContext("2d");
  tg.filter = `blur(${rad / k}px)`;
  tg.drawImage(small, 0, 0);
  g.drawImage(out, 0, 0, w, h);
}

// smooth value noise in [0, 1] for a w×h box at (ox, oy) in document pixels, two
// octaves, fixed per seed. The lattice is hashed once and interpolated per pixel.
export function noiseGrid(seed, w, h, ox, oy, cell) {
  const hash = (x, y, o) => {
    let v = Math.imul(x + o * 7919, 374761393) ^ Math.imul(y - o * 104729, 668265263) ^ seed;
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967295;
  };
  const out = new Float32Array(w * h);
  for (const [c, o, wt] of [[cell, 0, 0.65], [cell / 2.7, 1, 0.35]]) {
    const gx0 = Math.floor(ox / c), gy0 = Math.floor(oy / c);
    const GW = Math.ceil((ox + w) / c) - gx0 + 2, GH = Math.ceil((oy + h) / c) - gy0 + 2;
    const lat = new Float32Array(GW * GH);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) lat[j * GW + i] = hash(gx0 + i, gy0 + j, o);
    const ix = new Int32Array(w), tx = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      const f = (x + ox) / c - gx0;
      ix[x] = Math.floor(f);
      const t = f - ix[x];
      tx[x] = t * t * (3 - 2 * t);
    }
    for (let y = 0; y < h; y++) {
      const f = (y + oy) / c - gy0, iy = Math.floor(f);
      let ty = f - iy;
      ty = ty * ty * (3 - 2 * ty);
      const r0 = iy * GW, r1 = r0 + GW, row = y * w;
      for (let x = 0; x < w; x++) {
        const i = ix[x], t = tx[x];
        const top = lat[r0 + i] + (lat[r0 + i + 1] - lat[r0 + i]) * t;
        const bot = lat[r1 + i] + (lat[r1 + i + 1] - lat[r1 + i]) * t;
        out[row + x] += (top + (bot - top) * ty) * wt;
      }
    }
  }
  return out;
}

// The lattice of a noise seed: the hashed value of every whole point from −128
// to 127 each way, in a 256 × 256 table. The per-pixel effects sample noise
// several times a pixel; looking the corners up instead of hashing them each
// time is most of their cost saved. Kept for the last few seeds (an effect
// uses the same seeds on every frame).
const lattices = new Map();
const latticeHash = (x, y, seed) => {
  let v = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  return ((v ^ (v >>> 16)) >>> 0) / 4294967295;
};
function lattice(seed) {
  let L = lattices.get(seed);
  if (L) return L;
  L = new Float64Array(65536);
  for (let y = -128; y < 128; y++) for (let x = -128; x < 128; x++) L[((y + 128) << 8) | (x + 128)] = latticeHash(x, y, seed);
  lattices.set(seed, L);
  if (lattices.size > 32) lattices.delete(lattices.keys().next().value);
  return L;
}

// smooth fractal value noise, 3 octaves, 0..1
export function fbmNoise(seed) {
  const L = lattice(seed);
  const one = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    let tx = x - ix, ty = y - iy;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    let a, b, c, d;
    // inside the table its corners are looked up, outside hashed — the same values
    if (ix >= -128 && ix < 127 && iy >= -128 && iy < 127) {
      const i = ((iy + 128) << 8) | (ix + 128);
      a = L[i]; b = L[i + 1]; c = L[i + 256]; d = L[i + 257];
    } else {
      a = latticeHash(ix, iy, seed); b = latticeHash(ix + 1, iy, seed); c = latticeHash(ix, iy + 1, seed); d = latticeHash(ix + 1, iy + 1, seed);
    }
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  return (x, y) => one(x, y) * 0.55 + one(x * 2.1 + 17.3, y * 2.1 + 3.1) * 0.3 + one(x * 4.3 + 7.7, y * 4.3 + 29.5) * 0.15;
}

// Cellular noise: scattered points, one per unit cell, jittered; returns the
// distance to the nearest (f1) and second nearest (f2) point and a random value
// for the nearest one's cell (h)
export function worley(x, y, seed) {
  const hash = (a, b, o) => {
    let v = Math.imul(a + o * 131, 374761393) ^ Math.imul(b - o * 977, 668265263) ^ seed;
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967295;
  };
  const ix = Math.floor(x), iy = Math.floor(y);
  let f1 = 9, f2 = 9, h = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j;
    const px = cx + hash(cx, cy, 1), py = cy + hash(cx, cy, 2);
    const dd = Math.hypot(px - x, py - y);
    if (dd < f1) { f2 = f1; f1 = dd; h = hash(cx, cy, 3); } else if (dd < f2) f2 = dd;
  }
  return { f1, f2, h };
}

// the uv map at half size: { k, mw, mh, d } (d: RGBA, r = u, g = v, a = covered)
export function halfUV(runs, w, h) {
  const k = 2, mw = Math.ceil(w / k), mh = Math.ceil(h / k);
  const sc = (q) => ({ a: [q.a[0] / k, q.a[1] / k], b: [q.b[0] / k, q.b[1] / k], u: q.u });
  const segs = [];
  for (const r of runs) for (let i = 1; i < r.length; i++) segs.push([sc(r[i - 1]), sc(r[i])]);
  return { k, mw, mh, d: uvMap(segs, mw, mh, false) };
}

export const toHex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");

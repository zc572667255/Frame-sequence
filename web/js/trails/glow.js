// Glow trails (光效): the smooth, luminous look of slash / magic VFX, as opposed
// to the hard-edged pixel bands.
//
// Built from the same cross-sections as every trail ({ a, b, u }: inner end, outer
// end, position along the trail tail -> head), in one or more runs. Layers, back
// to front:
//   haze    — a wide, heavily blurred wash of colour left behind by the swing
//   strands — many thin lines of light at different heights across the trail,
//             each starting somewhere in the tail and growing toward the head,
//             added up (additive light)
//   core    — a sharp, white-hot crescent along the outer side with a coloured rim
//   bloom   — a blurred copy of strands + core added on top
//   erosion — noise eats the thin parts first, more as the trail dissolves
//   fx      — twinkling four-point stars, a starburst flash where the swing
//             starts, and ink-like splatter flying off the blade
// Colours run across the width (inner -> outer); `core` / `rim` / `splat` are the
// colours of the hot crescent, its edge and the splatter.
import { createCanvas, hexToRgb } from "../core/util.js";

export const GLOW_PRESETS = [
  { id: "dream", name: "梦幻", colors: ["#2f5bff", "#2fd8ff", "#e8fbff", "#ff6ad5"], core: "#ffffff", rim: "#7fe9ff", splat: "#9fd8ff",
    look: { strands: 70, core: 25, haze: 35, glow: 75, sparkles: 16, sparkleSize: 7, flash: 0, splatter: 0, erode: 25 } },
  { id: "blaze", name: "烈焰斩", colors: ["#ff5a4a", "#ff7a2a", "#ffad3b", "#ffd27a"], core: "#fffaf0", rim: "#ff9a1a", splat: "#e08a2e",
    look: { strands: 14, core: 90, haze: 65, glow: 50, sparkles: 0, sparkleSize: 6, flash: 80, splatter: 70, erode: 35 } },
  { id: "frost", name: "冰晶", colors: ["#1b4dff", "#38c7ff", "#c4f4ff", "#ffffff"], core: "#ffffff", rim: "#5fd6ff", splat: "#a6e8ff",
    look: { strands: 45, core: 60, haze: 40, glow: 65, sparkles: 12, sparkleSize: 6, flash: 40, splatter: 0, erode: 35 } },
  { id: "spark", name: "雷光", colors: ["#5b3bff", "#6fb0ff", "#ffffff", "#b6a4ff"], core: "#ffffff", rim: "#8fb8ff", splat: "#c8d6ff",
    look: { strands: 30, core: 70, haze: 25, glow: 80, sparkles: 20, sparkleSize: 5, flash: 100, splatter: 0, erode: 35 } },
  { id: "radiant", name: "圣光", colors: ["#ff9f2e", "#ffdc7a", "#fff8de", "#ffffff"], core: "#ffffff", rim: "#ffd25c", splat: "#ffe08a",
    look: { strands: 40, core: 60, haze: 45, glow: 70, sparkles: 14, sparkleSize: 8, flash: 60, splatter: 0, erode: 35 } },
  { id: "umbra", name: "暗影", colors: ["#3a0b57", "#8a22c2", "#e07bff", "#ffd2ff"], core: "#ffe6ff", rim: "#b04de0", splat: "#6a2a8a",
    look: { strands: 50, core: 55, haze: 60, glow: 55, sparkles: 6, sparkleSize: 5, flash: 0, splatter: 40, erode: 35 } },
  { id: "venom", name: "毒雾", colors: ["#0b7a34", "#35d65a", "#b9ff8c", "#f2ffdc"], core: "#f4ffe8", rim: "#4be06a", splat: "#4caf3c",
    look: { strands: 35, core: 50, haze: 70, glow: 55, sparkles: 4, sparkleSize: 5, flash: 0, splatter: 80, erode: 35 } },
  { id: "crimson", name: "血刃", colors: ["#6b0014", "#d0162a", "#ff6a6f", "#ffe0e0"], core: "#fff0f0", rim: "#e8283c", splat: "#a0101e",
    look: { strands: 16, core: 85, haze: 55, glow: 45, sparkles: 0, sparkleSize: 6, flash: 50, splatter: 90, erode: 35 } },
];

// the style fields a glow preset sets (trail.style / the 拖尾笔's options)
export function glowStyle(p) {
  return { glowId: p.id, glowColors: p.colors.slice(), glowCore: p.core, glowRim: p.rim, glowSplat: p.splat, ...p.look };
}
export const GLOW_DEFAULTS = glowStyle(GLOW_PRESETS[0]);

export function glowSwatch(p) {
  return "linear-gradient(90deg, " + p.colors.map((c, i) => c + " " + Math.round(i / (p.colors.length - 1) * 100) + "%").join(", ") + ")";
}

const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0 || 1e-6)); return t * t * (3 - 2 * t); };
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

export function rng(seed) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
export function hashSeed(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 2147483646 + 1;
}

function colorAcross(cols, v) {
  const t = clamp01(v) * (cols.length - 1);
  const i = Math.min(cols.length - 2, Math.floor(t)), f = t - i;
  const a = cols[i], b = cols[i + 1];
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f));
}

const widthOf = (q) => Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]);

// runs: [[{ a, b, u }, ...], ...] tail -> head.
// ctx: { seed, frame, alpha, fade, fx, run, age }
//   frame — the frame index (stars twinkle and the flash flickers per frame)
//   alpha — overall opacity (the trail's dissolve)
//   fade  — 0..1, how much of the trail (from the tail) ramps up
//   fx    — false to leave out stars / flash / splatter (the "back" pass)
//   run, age — every stick of the swing so far and frames since its first stick;
//             the flash sits at the first stick, splatter flies off later ones
// Returns a fullW×fullH canvas, or null when there is nothing to draw.
export function renderGlow(runs, style, fullW, fullH, ctx = {}) {
  runs = (runs || []).filter((r) => r.length >= 2);
  const st = { ...GLOW_DEFAULTS, ...style };
  let run = ctx.run || [];
  const doFx = ctx.fx !== false;
  if (!runs.length && !(doFx && run.length && (st.flash > 0 || st.splatter > 0))) return null;

  const cols = (st.glowColors && st.glowColors.length >= 2 ? st.glowColors : GLOW_DEFAULTS.glowColors).map(hexToRgb);
  const coreC = hexToRgb(st.glowCore || "#ffffff"), rimC = hexToRgb(st.glowRim || st.glowColors[st.glowColors.length - 1]);
  const splatC = hexToRgb(st.glowSplat || st.glowRim || "#ffffff");
  const seed = ctx.seed || 1, frame = ctx.frame || 0;
  const alpha = clamp01(ctx.alpha ?? 1) * clamp01((st.opacity ?? 100) / 100);
  const tail = Math.max(0.05, Math.min(1, ctx.fade ?? 0.6));
  const pct = (k) => clamp01((+st[k] || 0) / 100);

  // size of everything: the widest cross-section (or the longest stick)
  let maxW = 1;
  for (const r of runs) for (const q of r) maxW = Math.max(maxW, widthOf(q));
  for (const s of run) maxW = Math.max(maxW, widthOf(s));
  const at = (q, v) => lerp(q.a, q.b, v);

  // work in the trail's bounding box only (plus room for bloom, flash and
  // splatter): blurs and the erosion pass cost per pixel
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); };
  for (const r of runs) for (const q of r) { grow(q.a); grow(q.b); }
  for (const s of run) { grow(s.a); grow(s.b); }
  const pad = maxW * (doFx && st.flash > 0 && (ctx.age ?? 0) < 4 ? 2.8 : 1.4) + 4;
  x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
  x1 = Math.min(fullW, Math.ceil(x1 + pad)); y1 = Math.min(fullH, Math.ceil(y1 + pad));
  if (!(x1 > x0 && y1 > y0)) return null;
  const w = x1 - x0, h = y1 - y0;
  const shift = (q) => ({ ...q, a: [q.a[0] - x0, q.a[1] - y0], b: [q.b[0] - x0, q.b[1] - y0] });
  runs = runs.map((r) => r.map(shift));
  run = run.map(shift);

  const out = createCanvas(w, h);
  const og = out.getContext("2d");
  const strokeSeg = (g, p, q, col, a, lw) => {
    if (a <= 0.002) return;
    g.strokeStyle = rgba(col, a);
    g.lineWidth = Math.max(0.35, lw);
    g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
  };

  if (runs.length) {
    // ---- haze: wide lanes of colour, blurred hard
    const haze = pct("haze");
    if (haze > 0) {
      const H = createCanvas(w, h), hg = H.getContext("2d");
      hg.lineCap = "round"; hg.lineJoin = "round";
      const lanes = 6;
      for (const r of runs) for (let l = 0; l < lanes; l++) {
        const v = (l + 0.5) / lanes, col = colorAcross(cols, v);
        for (let i = 1; i < r.length; i++) {
          const p = r[i - 1], q = r[i];
          const a = haze * 0.38 * smooth(0, tail, q.u) * (0.5 + 0.5 * Math.sin(Math.PI * v)) * alpha;
          strokeSeg(hg, at(p, v), at(q, v), col, a, (widthOf(q) / lanes) * 1.7);
        }
      }
      drawBlurred(og, [H], Math.max(1.5, maxW / 6));
    }

    // ---- strands (additive light): thin pointed filaments, each one polygon so
    // nothing overlaps itself. Their layout is fixed per trail so they don't
    // crawl; only their brightness shimmers a little from frame to frame
    const L = createCanvas(w, h), lg = L.getContext("2d");
    lg.globalCompositeOperation = "lighter";
    const N = Math.max(0, Math.min(160, st.strands | 0));
    const R = rng(seed), shimmer = rng(seed * 31 + frame * 977);
    const dim = Math.min(1, Math.sqrt(24 / Math.max(1, N)));     // many strands: each one fainter, so they don't add up to plain white
    for (let s = 0; s < N; s++) {
      const v = 0.03 + 0.94 * R();
      const reach = Math.sin(Math.PI * v);                       // middle strands reach furthest back
      const u0 = Math.max(0, (1 - reach) * tail * 0.9 + R() * tail * 0.7 - 0.05);
      const bright = Math.pow(R(), 1.6) * (0.85 + 0.3 * shimmer()); // a few bright, many faint
      const thick = (0.3 + 0.9 * R()) * Math.max(0.7, maxW / 28);
      const col = colorAcross(cols, v + (R() - 0.5) * 0.1);
      const drift = (R() - 0.5) * 0.06, phase = R() * 6.28;
      lg.fillStyle = rgba(col, (0.25 + 0.75 * bright) * dim * alpha);
      for (const r of runs) filament(lg, r, u0, (u) => v + drift * Math.sin(phase + u * 5), thick);
    }
    // the leading edge: one long, thin, bright line along the outer side
    if (N) {
      lg.fillStyle = rgba(rimC, 0.9 * alpha);
      for (const r of runs) filament(lg, r, 0, () => 0.975, Math.max(0.8, maxW / 40));
    }
    // fade toward the tail: a soft mask of the ribbon, brighter toward the head
    if (N) {
      const M = createCanvas(w, h), mg = M.getContext("2d");
      for (const r of runs) for (let i = 1; i < r.length; i++) {
        const p = r[i - 1], q = r[i];
        mg.fillStyle = `rgba(0,0,0,${(smooth(0, tail, q.u) * (0.45 + 0.55 * q.u)).toFixed(3)})`;
        mg.beginPath();
        for (const [x, y] of [at(p, -0.15), at(p, 1.15), at(q, 1.15), at(q, -0.15)]) mg.lineTo(x, y);
        mg.fill();
      }
      lg.globalCompositeOperation = "destination-in";
      lg.filter = "blur(1.5px)";                                // melts the seams between the quads
      lg.drawImage(M, 0, 0);
      lg.filter = "none";
      lg.globalCompositeOperation = "lighter";
    }


    // ---- core: a sharp crescent along the outer side, rim colour around a hot centre
    const core = pct("core");
    const C = createCanvas(w, h), cg = C.getContext("2d");
    if (core > 0) {
      const ca = alpha * alpha;                                  // the core goes before the haze when dissolving
      const u0 = Math.max(0, 1 - (0.35 + 0.6 * core));             // how far back the core reaches
      const band = (q, vc, half) => [at(q, vc - half), at(q, vc + half)];
      const poly = (r, k) => {
        const lo = [], hi = [];
        for (const q of r) {
          if (q.u < u0) continue;
          const t = (q.u - u0) / Math.max(1e-3, 1 - u0);
          const half = (0.04 + 0.26 * core) * Math.pow(t, 1.2) * k;
          const [p0, p1] = band(q, 0.74 + 0.04 * (1 - k), half);
          lo.push(p0); hi.push(p1);
        }
        if (lo.length < 2) return;
        cg.beginPath();
        cg.moveTo(lo[0][0], lo[0][1]);
        for (const p of lo) cg.lineTo(p[0], p[1]);
        for (let i = hi.length - 1; i >= 0; i--) cg.lineTo(hi[i][0], hi[i][1]);
        cg.closePath();
        cg.fill();
      };
      cg.fillStyle = rgba(rimC, ca);
      for (const r of runs) poly(r, 1);
      // the hot centre, blurred a touch so it melts into the rim
      const W2 = createCanvas(w, h), wg = W2.getContext("2d");
      const keep = cg;
      wg.fillStyle = rgba(coreC, ca);
      for (const r of runs) {
        const lo = [], hi = [];
        for (const q of r) {
          if (q.u < u0) continue;
          const t = (q.u - u0) / Math.max(1e-3, 1 - u0);
          const half = (0.04 + 0.26 * core) * Math.pow(t, 1.5) * 0.6;
          lo.push(at(q, 0.76 - half)); hi.push(at(q, 0.76 + half));
        }
        if (lo.length < 2) continue;
        wg.beginPath();
        wg.moveTo(lo[0][0], lo[0][1]);
        for (const p of lo) wg.lineTo(p[0], p[1]);
        for (let i = hi.length - 1; i >= 0; i--) wg.lineTo(hi[i][0], hi[i][1]);
        wg.closePath();
        wg.fill();
      }
      keep.filter = `blur(${Math.max(0.5, maxW / 60)}px)`;
      keep.drawImage(W2, 0, 0);
      keep.filter = "none";
    }

    // hot head: a soft glow where the blade is now — only in the pass that has
    // the real head (a front / back split also ends runs mid-trail)
    const Hd = runs[runs.length - 1][runs[runs.length - 1].length - 1];
    if (Hd.u > 0.999) {
      const c = at(Hd, 0.7), r = widthOf(Hd) * 0.6 + 1;
      const gr = lg.createRadialGradient(c[0], c[1], 0, c[0], c[1], r);
      gr.addColorStop(0, rgba(coreC, 0.45 * alpha * alpha));
      gr.addColorStop(0.45, rgba(rimC, 0.22 * alpha));
      gr.addColorStop(1, rgba(rimC, 0));
      lg.fillStyle = gr;
      lg.beginPath(); lg.arc(c[0], c[1], r, 0, Math.PI * 2); lg.fill();
    }

    og.globalCompositeOperation = "lighter";
    og.drawImage(L, 0, 0);
    og.globalCompositeOperation = "source-over";
    og.drawImage(C, 0, 0);
    // bloom: blurred copies of the light and the core, added on top
    const bloom = pct("glow");
    if (bloom > 0) {
      og.globalCompositeOperation = "lighter";
      for (const [rad, k] of [[maxW / 9, 0.45], [maxW / 3.5, 0.35]]) {
        og.globalAlpha = bloom * k;
        drawBlurred(og, [L, C], Math.max(1, rad));
      }
      og.globalAlpha = 1;
      og.globalCompositeOperation = "source-over";
    }
  }

  // erosion: as the trail dissolves, noise eats it from the thin parts inward
  // (the usual alpha-erosion of slash VFX) instead of it just turning see-through
  if (runs.length) erode(og, w, h, x0, y0, seed, pct("erode"), ctx.alpha ?? 1, maxW);

  if (doFx) {
    if (runs.length) sparkles(og, runs, st, cols, seed, frame, alpha, maxW, at);
    if (run.length) {
      flash(og, run, st, coreC, rimC, seed, frame, ctx.age ?? 0, alpha, pct("flash"));
      splatter(og, run, w, h, st, splatC, seed, ctx.age ?? 0, alpha, pct("splatter"));
    }
  }
  // a canvas, not ImageData: everything above stays on the GPU, reading pixels
  // back would cost more than all the drawing
  const full = createCanvas(fullW, fullH);
  full.getContext("2d").drawImage(out, x0, y0);
  return full;
}

// draw the canvases blurred by rad px. Wide blurs are done on a smaller copy and
// scaled back up — the same picture at a fraction of the cost.
function drawBlurred(g, srcs, rad) {
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
function noiseGrid(seed, w, h, ox, oy, cell) {
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

function erode(og, w, h, ox, oy, seed, amount, life, maxW) {
  const t = amount * (0.08 + 0.92 * (1 - clamp01(life)));       // a little always, more while dissolving
  if (t <= 0.02) return;
  // the mask is worked out at half size and laid over with destination-in
  const k = 2, mw = Math.ceil(w / k), mh = Math.ceil(h / k);
  const noise = noiseGrid(seed, mw, mh, ox / k, oy / k, Math.max(2, maxW / 4 / k));
  const img = new ImageData(mw, mh), d = img.data;
  const lo = t - 0.12, span = 0.24;
  for (let p = 0, i = 3; p < mw * mh; p++, i += 4) {
    let m = (noise[p] - lo) / span;
    m = m <= 0 ? 0 : m >= 1 ? 1 : m * m * (3 - 2 * m);
    d[i] = Math.round(m * 255);
  }
  const M = createCanvas(mw, mh);
  M.getContext("2d").putImageData(img, 0, 0);
  og.save();
  og.globalCompositeOperation = "destination-in";
  og.drawImage(M, 0, 0, mw * k, mh * k);
  og.restore();
}

// a pointed filament along a run of sections: zero width where it starts (u0),
// full width at the head; vAt(u) says where across the trail it runs
function filament(g, r, u0, vAt, width) {
  const lo = [], hi = [];
  for (const q of r) {
    if (q.u < u0) continue;
    const t = (q.u - u0) / Math.max(1e-3, 1 - u0);
    const v = vAt(q.u);
    const c = [q.a[0] + (q.b[0] - q.a[0]) * v, q.a[1] + (q.b[1] - q.a[1]) * v];
    let nx = q.b[0] - q.a[0], ny = q.b[1] - q.a[1];
    const nl = Math.hypot(nx, ny) || 1;
    const half = (width / 2) * Math.pow(t, 0.8);
    nx = nx / nl * half; ny = ny / nl * half;
    lo.push([c[0] - nx, c[1] - ny]); hi.push([c[0] + nx, c[1] + ny]);
  }
  if (lo.length < 2) return;
  g.beginPath();
  for (const p of lo) g.lineTo(p[0], p[1]);
  for (let i = hi.length - 1; i >= 0; i--) g.lineTo(hi[i][0], hi[i][1]);
  g.closePath();
  g.fill();
}

// four-point stars around the front half of the trail, a new set every frame
function sparkles(og, runs, st, cols, seed, frame, alpha, maxW, at) {
  const K = Math.max(0, Math.min(80, st.sparkles | 0));
  if (!K) return;
  const r = runs[runs.length - 1];
  og.globalCompositeOperation = "lighter";
  const P = rng(seed * 7 + frame * 131);
  const size = Math.max(1, +st.sparkleSize || 6) * Math.max(0.6, maxW / 40);
  for (let k = 0; k < K; k++) {
    const u = 0.35 + 0.65 * Math.pow(P(), 0.7);
    let i = 1;
    while (i < r.length - 1 && r[i].u < u) i++;
    const v = -0.3 + 1.6 * P();
    const p = at(r[i], v);
    const tw = Math.pow(P(), 1.4) * alpha;
    const s = size * (0.4 + 0.9 * P()) * (0.6 + 0.6 * tw);
    if (tw < 0.08) continue;
    star(og, p, s, colorAcross(cols, clamp01(v)), tw, P() * 0.4);
  }
  og.globalCompositeOperation = "source-over";
}

function star(og, p, s, c, a, tilt) {
  const halo = og.createRadialGradient(p[0], p[1], 0, p[0], p[1], s);
  halo.addColorStop(0, `rgba(255,255,255,${(0.9 * a).toFixed(3)})`);
  halo.addColorStop(0.3, rgba(c, 0.4 * a));
  halo.addColorStop(1, rgba(c, 0));
  og.fillStyle = halo;
  og.beginPath(); og.arc(p[0], p[1], s, 0, Math.PI * 2); og.fill();
  const ca = Math.cos(tilt), sa = Math.sin(tilt);
  for (const [dx, dy, len] of [[ca, sa, s * 1.8], [-sa, ca, s * 1.2]]) {
    const x0 = p[0] - dx * len, y0 = p[1] - dy * len, x1 = p[0] + dx * len, y1 = p[1] + dy * len;
    const ray = og.createLinearGradient(x0, y0, x1, y1);
    ray.addColorStop(0, "rgba(255,255,255,0)");
    ray.addColorStop(0.5, `rgba(255,255,255,${(0.95 * a).toFixed(3)})`);
    ray.addColorStop(1, "rgba(255,255,255,0)");
    og.strokeStyle = ray;
    og.lineWidth = Math.max(0.6, s / 6);
    og.beginPath(); og.moveTo(x0, y0); og.lineTo(x1, y1); og.stroke();
  }
}

// a starburst where the swing starts: rays, a bright dot and an expanding ring,
// strongest on the first frame and gone after a few
function flash(og, run, st, coreC, rimC, seed, frame, age, alpha, amount) {
  const f = amount * clamp01(1 - age / 4) * alpha;
  if (f <= 0.01) return;
  const s0 = run[0], L = Math.max(4, widthOf(s0));
  const c = lerp(s0.a, s0.b, 0.8);
  const R = L * (0.7 + 0.15 * age);
  const P = rng(seed * 13 + 5), F = rng(seed * 17 + frame * 59);
  og.globalCompositeOperation = "lighter";
  const gl = og.createRadialGradient(c[0], c[1], 0, c[0], c[1], R * 0.9);
  gl.addColorStop(0, rgba(coreC, 0.9 * f));
  gl.addColorStop(0.15, rgba(rimC, 0.45 * f));
  gl.addColorStop(1, rgba(rimC, 0));
  og.fillStyle = gl;
  og.beginPath(); og.arc(c[0], c[1], R * 0.9, 0, Math.PI * 2); og.fill();
  // rays: a few long bright ones on a diagonal, many short soft ones around
  og.lineCap = "round";
  const main = P() * Math.PI;
  const rays = [];
  for (let k = 0; k < 2; k++) rays.push([main + k * Math.PI + (P() - 0.5) * 0.15, R * (1.0 + 0.4 * P()), 1]);
  for (let k = 0; k < 12; k++) rays.push([P() * Math.PI * 2, R * (0.35 + 0.6 * P()), 0.35 + 0.3 * F()]);
  for (const [th, len, b] of rays) {
    const x1 = c[0] + Math.cos(th) * len, y1 = c[1] + Math.sin(th) * len;
    const g = og.createLinearGradient(c[0], c[1], x1, y1);
    g.addColorStop(0, rgba(coreC, f * b));
    g.addColorStop(0.35, rgba(rimC, 0.7 * f * b));
    g.addColorStop(1, rgba(rimC, 0));
    og.strokeStyle = g;
    og.lineWidth = Math.max(0.8, L / (b === 1 ? 22 : 40));
    og.beginPath(); og.moveTo(c[0], c[1]); og.lineTo(x1, y1); og.stroke();
  }
  // the ring grows as it fades
  og.globalCompositeOperation = "source-over";
  og.strokeStyle = rgba(rimC, 0.7 * f);
  og.lineWidth = Math.max(0.8, L / 50);
  og.beginPath(); og.arc(c[0], c[1], R * (0.25 + 0.12 * age), 0, Math.PI * 2); og.stroke();
  og.fillStyle = `rgba(255,255,255,${f.toFixed(3)})`;
  og.beginPath(); og.arc(c[0], c[1], Math.max(1, L * 0.05), 0, Math.PI * 2); og.fill();
}

// ink-like splatter thrown off the blade: each splat is born on one stick of the
// swing, flies a little way outward and stays there until the trail dissolves
function splatter(og, run, w, h, st, col, seed, age, alpha, amount) {
  const K = Math.round(amount * 14);
  if (!K || alpha <= 0.01) return;
  const S = createCanvas(w, h), sg = S.getContext("2d");
  const first = age - (run.length - 1);                 // frame (relative to the swing) of run[0]
  let any = false, size = 1;
  for (const s of run) size = Math.max(size, widthOf(s));
  for (let k = 0; k < K; k++) {
    const R = rng(seed * 101 + k * 7919);
    const bi = 1 + Math.floor(R() * Math.max(1, Math.min(run.length, 8) - 1) * 1.6);
    const since = age - (first + bi);
    if (since < 0 || bi >= run.length) continue;
    const s = run[bi];
    const base = lerp(s.a, s.b, 0.6 + 0.6 * R());
    let dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const turn = (R() - 0.5) * 2.2;
    const ux = dx * Math.cos(turn) - dy * Math.sin(turn), uy = dx * Math.sin(turn) + dy * Math.cos(turn);
    const travel = size * (0.05 + 0.3 * R()) * (1 - Math.exp(-(since + 1) / 1.6));
    const p = [base[0] + ux * travel, base[1] + uy * travel];
    const grow = Math.min(1, (since + 1) / 2);
    const r = size * (0.03 + 0.05 * R()) * grow;
    const a = alpha * 0.9;
    sg.fillStyle = rgba(col, a);
    // the blob: a few overlapping circles
    const n = 3 + Math.floor(R() * 4);
    for (let i = 0; i < n; i++) {
      const o = r * 0.7 * R(), th = R() * Math.PI * 2;
      sg.beginPath(); sg.arc(p[0] + Math.cos(th) * o, p[1] + Math.sin(th) * o, r * (0.4 + 0.5 * R()), 0, Math.PI * 2); sg.fill();
    }
    // droplets flung further along its direction, getting smaller
    const m = 2 + Math.floor(R() * 5);
    for (let i = 0; i < m; i++) {
      const sp = (R() - 0.5) * 1.2, d = r * (1.4 + 2.6 * R()) * (0.6 + 0.4 * grow);
      const ex = ux * Math.cos(sp) - uy * Math.sin(sp), ey = ux * Math.sin(sp) + uy * Math.cos(sp);
      sg.beginPath(); sg.arc(p[0] + ex * d, p[1] + ey * d, Math.max(0.5, r * (0.1 + 0.25 * R())), 0, Math.PI * 2); sg.fill();
    }
    any = true;
  }
  if (!any) return;
  og.globalAlpha = 0.55;
  og.filter = `blur(${Math.max(1, size / 30)}px)`;
  og.drawImage(S, 0, 0);
  og.filter = "none";
  og.globalAlpha = 1;
  og.drawImage(S, 0, 0);
}

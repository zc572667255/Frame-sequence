// Stand-alone effects (特效): hit sparks, explosions, shockwaves, dust, a
// charging orb, a magic circle, a healing aura, an aura round a character,
// fire — generated as a sequence of
// frames from a handful of settings, in the colours of the glow presets
// (trails/glow.js), smooth (高清) or pixelated (像素, trails/glow/finish.js).
//
// Every effect is a function of time t (0 → 1 over the sequence) with its
// particles fixed per seed, so neighbouring frames belong together and a loop
// closes on itself. Fire, smoke and dust are a noisy density field coloured per
// pixel (volume); the rest are drawn with canvas strokes and gradients, then
// given a bloom.
import { createCanvas, hexToRgb } from "../core/util.js";
import { GLOW_PRESETS } from "../trails/glow.js";
import { rng, rgba, clamp01, smooth, colorAcross, drawBlurred, noiseGrid, fbmNoise, toHex } from "../trails/glow/util.js";
import { star } from "../trails/glow/shapes.js";
import { pixelateGlow } from "../trails/glow/finish.js";

const TAU = Math.PI * 2;
const easeOut = (t, p = 2) => 1 - Math.pow(1 - clamp01(t), p);
const easeIn = (t, p = 2) => Math.pow(clamp01(t), p);
const frac = (x) => x - Math.floor(x);
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// kinds: name, what it is for, and the settings it starts with
export const VFX_KINDS = [
  { id: "hit", name: "命中火花", help: "打中的一瞬间：白热闪光、尖刺和飞溅的火花", defaults: { palette: "radiant", frames: 7, loop: false, size: 80 } },
  { id: "explosion", name: "爆炸", help: "火球膨胀、冷却成烟往上飘，带飞散的火星", defaults: { palette: "inferno", frames: 12, loop: false, size: 80 } },
  { id: "shock", name: "冲击波", help: "向外扩散的环，可以压扁成地面上的冲击波", defaults: { palette: "frost", frames: 8, loop: false, size: 80 } },
  { id: "dust", name: "烟尘", help: "落地、急停、冲刺扬起的烟尘，向两侧散开", defaults: { palette: "quake", frames: 10, loop: false, size: 80 } },
  { id: "charge", name: "蓄力", help: "能量向中心汇聚成发光的球；不循环时最后爆开", defaults: { palette: "spark", frames: 12, loop: true, size: 80 } },
  { id: "circle", name: "魔法阵", help: "旋转的法阵：圆环、符文、星形，向上飘的光点", defaults: { palette: "crescent", frames: 16, loop: true, size: 80 } },
  { id: "heal", name: "治疗光圈", help: "脚下的光圈和升起的光柱、十字光点", defaults: { palette: "venom", frames: 12, loop: true, size: 80 } },
  { id: "aura", name: "环绕光", help: "超级赛亚人那样包住角色的斗气：向上舔动的光焰、中间透明、上升的光束和火花，可加闪电", defaults: { palette: "radiant", frames: 8, loop: true, size: 95 }, around: true },
  { id: "burn", name: "燃烧", help: "从区域底部烧起来的火焰，火舌摇动，火星上飘", defaults: { palette: "inferno", frames: 8, loop: true, size: 95 } },
];

export const VFX_DEFAULTS = {
  kind: "hit", palette: "radiant", w: 128, h: 128, frames: 7, fps: 12, loop: false,
  size: 80,      // % of the canvas the effect reaches
  amount: 100,   // particles, %
  glow: 60,      // bloom, %
  tilt: 60,      // 冲击波 / 魔法阵 / 治疗 / 烟尘: how flat the ground is seen, degrees (0 = from above)
  pattern: "hex", // 魔法阵: "hex" 六芒星 | "penta" 五芒星 | "square" 双方形
  bolts: false,  // 环绕光: lightning crawling over it
  seed: 1,
  style: "hd",   // "hd" | "pixel"
  pxSize: 2, pxAlpha: "steps",
};

export const VFX_PALETTES = GLOW_PRESETS.map((p) => [p.id, p.name]);

// the colours of a preset as rgb: cols (dark → bright), core, rim, splat
function paletteOf(id) {
  const p = GLOW_PRESETS.find((x) => x.id === id) || GLOW_PRESETS[0];
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const cols = p.colors.map(hexToRgb).sort((a, b) => lum(a) - lum(b));
  const core = hexToRgb(p.core), rim = hexToRgb(p.rim), splat = hexToRgb(p.splat || p.rim);
  // smoke: the darkest colour drained towards grey
  const smoke = mixRgb(cols[0], [58, 56, 60], 0.75);
  return { preset: p, cols, core, rim, splat, smoke, dark: lum(core) < 60 };
}

// ---------- shared drawing ----------

// a soft round glow
function blob(g, x, y, r, stops) {
  if (r <= 0.3) return;
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, c, a] of stops) gr.addColorStop(o, rgba(c, a));
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
}

// a soft ring of radius r and half-width wd, squashed vertically by k
function ring(g, x, y, r, wd, k, c, a) {
  if (r <= 0 || a <= 0.005) return;
  const R = r + wd;
  g.save();
  g.translate(x, y); g.scale(1, k);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, R);
  gr.addColorStop(clamp01((r - wd) / R), rgba(c, 0));
  gr.addColorStop(clamp01(r / R), rgba(c, a));
  gr.addColorStop(1, rgba(c, 0));
  g.fillStyle = gr;
  g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
  g.restore();
}

// a streak from p to q fading from transparent (p) to colour (q)
function streak(g, p, q, c0, c1, a, lw) {
  const gr = g.createLinearGradient(p[0], p[1], q[0], q[1]);
  gr.addColorStop(0, rgba(c0, 0));
  gr.addColorStop(0.6, rgba(c0, 0.7 * a));
  gr.addColorStop(1, rgba(c1, a));
  g.strokeStyle = gr;
  g.lineWidth = lw;
  g.lineCap = "round";
  g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
}

// a pointed spike from the centre: a thin kite, bright at the root
function spike(g, cx, cy, th, len, wid, core, rim, a) {
  if (len <= 0.5 || a <= 0.005) return;
  const dx = Math.cos(th), dy = Math.sin(th), nx = -dy * wid, ny = dx * wid;
  const ex = cx + dx * len, ey = cy + dy * len, bx = cx - dx * wid * 1.5, by = cy - dy * wid * 1.5;
  const gr = g.createLinearGradient(cx, cy, ex, ey);
  gr.addColorStop(0, rgba(core, a));
  gr.addColorStop(0.4, rgba(rim, 0.75 * a));
  gr.addColorStop(1, rgba(rim, 0));
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(bx, by); g.lineTo(cx + nx, cy + ny); g.lineTo(ex, ey); g.lineTo(cx - nx, cy - ny); g.closePath(); g.fill();
}

// sparks flung out from (x, y): streaks that slow down, fall a little and burn out
function sparks(g, c, x, y, n, reach, t0, seedK, gravity = 0.3) {
  const P = rng(c.seed * 41 + seedK);
  for (let k = 0; k < n; k++) {
    const th = P() * TAU, sp = 0.45 + 0.75 * P(), life = 0.45 + 0.5 * P(), wid = 0.6 + 0.8 * P();
    const lt = (c.t - t0) / life;
    if (lt <= 0 || lt >= 1) continue;
    const d = reach * (0.12 + sp * easeOut(lt, 2.4));
    const fall = reach * gravity * lt * lt;
    const tail = reach * 0.22 * sp * (1 - lt);
    const q = [x + Math.cos(th) * d, y + Math.sin(th) * d + fall];
    const p = [x + Math.cos(th) * Math.max(0, d - tail), y + Math.sin(th) * Math.max(0, d - tail) + fall * 0.8];
    streak(g, p, q, c.pal.rim, c.pal.core, 1 - lt * lt, Math.max(1, c.R * 0.03 * wid * (1 - lt * 0.6)));
  }
}

// A noisy density field coloured per pixel: blobs [{ x, y, r, heat }] summed
// into a density, roughened by noise, cut at a threshold that rises as the
// effect thins out, and faded by o.fade. color(heat, light, n) -> [rgb,
// alphaScale], light: 1 on top of a puff, 0 underneath. Returns the body and
// its glowing part (for the bloom) as canvases.
function volume(c, blobs, o) {
  const { w, h } = c;
  const body = new ImageData(w, h), hot = new ImageData(w, h);
  if (!blobs.length) return { body: null, hot: null };
  // the box the blobs cover, so empty canvas costs nothing
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (const b of blobs) { x0 = Math.min(x0, b.x - b.r); y0 = Math.min(y0, b.y - b.r); x1 = Math.max(x1, b.x + b.r); y1 = Math.max(y1, b.y + b.r); }
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(w, Math.ceil(x1)); y1 = Math.min(h, Math.ceil(y1));
  const bw = x1 - x0, bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return { body: null, hot: null };
  const noise = noiseGrid(c.seed * 7 + 3, bw, bh, x0 + o.drift[0], y0 + o.drift[1], o.cell);
  const B = blobs.map((b) => ({ ...b, ir2: 1 / (b.r * b.r) }));
  const bd = body.data, hd = hot.data;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const px = x0 + x + 0.5, py = y0 + y + 0.5;
    let D = 0, H = 0, L = 0.5, best = 0;
    for (const b of B) {
      const dx = px - b.x, dy = py - b.y, q = (dx * dx + dy * dy) * b.ir2;
      if (q >= 1) continue;
      const f = (1 - q) * (1 - q);
      D += f;
      if (f * b.heat > H) H = f * b.heat;
      if (f > best) { best = f; L = 0.5 - dy / (b.r * 2); }
    }
    if (!D) continue;
    const n = noise[y * bw + x];
    // overlapping puffs saturate instead of piling up, so the threshold can
    // eat through the middle too as the cloud thins out
    const v = (1 - Math.exp(-D * 1.8)) + (n - 0.5) * o.rough - o.thr;
    if (v <= 0) continue;
    const a = smooth(0, o.soft, v) * o.fade;
    const [col, as] = o.color(clamp01(H * (0.75 + 0.5 * n) * o.heat), clamp01(L + (n - 0.5) * 0.35), n);
    const i = ((y0 + y) * w + x0 + x) * 4;
    bd[i] = col[0]; bd[i + 1] = col[1]; bd[i + 2] = col[2]; bd[i + 3] = Math.round(255 * a * as);
    if (o.glowAt != null) {
      const e = smooth(o.glowAt, o.glowAt + 0.25, H * o.heat);
      if (e > 0) { hd[i] = col[0]; hd[i + 1] = col[1]; hd[i + 2] = col[2]; hd[i + 3] = Math.round(255 * a * e); }
    }
  }
  const toCanvas = (img) => { const k = createCanvas(w, h); k.getContext("2d").putImageData(img, 0, 0); return k; };
  return { body: toCanvas(body), hot: o.glowAt != null ? toCanvas(hot) : null };
}

// fire colours by heat: smoke (lit from above) → darkest → … → brightest →
// white-hot core
function fireColor(pal) {
  const stops = [pal.smoke, ...pal.cols, pal.core];
  const smokeHi = mixRgb(pal.smoke, [168, 162, 158], 0.55);
  return (heat, light) => {
    if (heat < 0.12) return [mixRgb(pal.smoke, smokeHi, light * light), 0.85];
    return [colorAcross(stops, (heat - 0.12) / 0.88 * 0.999), 1];
  };
}

// ---------- the effects ----------

const EFFECTS = {
  // 命中火花: a white-hot flash, a cross of long spikes with shorter ones
  // between, sparks flung out and a thin ring
  hit(g, c) {
    const { t, R, cx, cy, pal } = c;
    const P = rng(c.seed * 13 + 1);
    g.globalCompositeOperation = "lighter";
    const fl = 1 - smooth(0, 0.4, t);
    blob(g, cx, cy, R * 0.75 * (0.7 + 0.5 * easeOut(t * 3)), [[0, pal.core, fl], [0.25, pal.core, 0.8 * fl], [0.5, pal.rim, 0.55 * fl], [1, pal.rim, 0]]);
    const tilt = P() * Math.PI, grow = easeOut(t / 0.15), thin = 1 - smooth(0.1, 0.7, t);
    for (let k = 0; k < 4; k++) {
      const th = tilt + k * Math.PI / 2 + (P() - 0.5) * 0.25;
      spike(g, cx, cy, th, R * (k % 2 ? 0.75 : 1.1) * grow * (1 + 0.2 * t), R * 0.12 * thin, pal.core, pal.rim, thin);
    }
    const minor = Math.round(8 * c.amount);
    for (let k = 0; k < minor; k++) {
      const th = P() * TAU, len = R * (0.35 + 0.4 * P());
      spike(g, cx, cy, th, len * grow, R * 0.06 * thin, pal.core, pal.rim, 0.85 * thin);
    }
    sparks(g, c, cx, cy, Math.round(18 * c.amount), R * 1.05, 0.0, 3, 0.25);
    ring(g, cx, cy, R * (0.25 + 0.75 * easeOut(t, 3)), R * 0.07 * (1 - t) + 0.8, 1, pal.rim, 0.8 * (1 - smooth(0, 0.6, t)));
    // a few solid chips
    g.globalCompositeOperation = "source-over";
    const D = rng(c.seed * 17 + 5);
    for (let k = 0; k < Math.round(8 * c.amount); k++) {
      const th = D() * TAU, d = R * (0.25 + 0.75 * D()) * easeOut(t, 2), r = R * (0.015 + 0.025 * D());
      const a = 1 - smooth(0.4, 0.9, t);
      if (a <= 0) continue;
      g.fillStyle = rgba(pal.splat, a);
      g.beginPath(); g.arc(cx + Math.cos(th) * d, cy + Math.sin(th) * d + R * 0.2 * t * t, Math.max(0.7, r), 0, TAU); g.fill();
    }
  },

  // 爆炸: a fireball of noisy puffs that swells, cools from white through the
  // palette to smoke and drifts up, with a flash, a shock ring and sparks
  explosion(g, c) {
    const { t, R, cx, cy, pal } = c;
    const P = rng(c.seed * 19 + 2);
    const K = Math.round(10 + 6 * c.amount);
    const e = easeOut(t / 0.55, 2.5), rise = R * 0.4 * easeIn(t, 1.6);
    const blobs = [];
    for (let k = 0; k < K; k++) {
      const th = P() * TAU, d0 = Math.pow(P(), 0.7), s = 0.32 + 0.3 * P(), late = P();
      blobs.push({
        x: cx + Math.cos(th) * R * 0.55 * d0 * e,
        y: cy + Math.sin(th) * R * 0.42 * d0 * e - rise * (0.6 + 0.8 * late),
        r: R * s * (0.3 + 0.7 * e) * (1 + 0.3 * t),
        heat: (1.05 - d0 * 0.45) * Math.pow(1 - smooth(0, 0.8, t), 0.9) + (t < 0.12 ? 0.4 : 0),
      });
    }
    const v = volume(c, blobs, {
      cell: Math.max(4, R * 0.16), drift: [0, t * R * 0.6], rough: 0.8, soft: 0.3, heat: 1.35,
      thr: 0.3 + 0.75 * smooth(0.35, 1, t), fade: 1 - 0.85 * smooth(0.6, 1, t), color: fireColor(pal), glowAt: 0.45,
    });
    // a dark preset (黑炎) is its own glow-less ink
    if (v.hot && !pal.dark) { g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.8 * c.glow; drawBlurred(g, [v.hot], Math.max(2, R * 0.12)); g.globalAlpha = 1; }
    g.globalCompositeOperation = "source-over";
    if (v.body) g.drawImage(v.body, 0, 0);
    g.globalCompositeOperation = "lighter";
    const fl = 1 - smooth(0, 0.18, t);
    blob(g, cx, cy, R * 0.6, [[0, pal.core, fl], [0.4, pal.rim, 0.6 * fl], [1, pal.rim, 0]]);
    ring(g, cx, cy, R * (0.3 + 0.9 * easeOut(t / 0.4, 2)), R * 0.04 + 0.6, 1, pal.rim, 0.35 * (1 - smooth(0, 0.4, t)));
    sparks(g, c, cx, cy, Math.round(18 * c.amount), R * 1.1, 0.03, 7, 0.45);
  },

  // 冲击波: two soft rings racing out (flattened onto the ground when tilted),
  // speed lines at the front and bits of dust kicked up along it
  shock(g, c) {
    const { t, R, pal } = c;
    const k = c.squash, cx = c.cx, cy = k < 0.98 ? c.gy : c.cy;
    g.globalCompositeOperation = "lighter";
    const fl = 1 - smooth(0, 0.3, t);
    g.save(); g.translate(cx, cy); g.scale(1, k);
    blob(g, 0, 0, R * 0.45, [[0, pal.core, 0.9 * fl], [0.5, pal.rim, 0.4 * fl], [1, pal.rim, 0]]);
    g.restore();
    const r1 = R * easeOut(t, 2.6), r2 = R * 0.8 * easeOut((t - 0.12) / 0.88, 2.6);
    ring(g, cx, cy, r1, R * 0.11 * (1 - t) + 0.8, k, pal.core, 0.95 * (1 - easeIn(t, 1.4)));
    ring(g, cx, cy, r1, R * 0.2 * (1 - t) + 1, k, pal.rim, 0.5 * (1 - t));
    if (t > 0.12) ring(g, cx, cy, r2, R * 0.05 * (1 - t) + 0.6, k, pal.rim, 0.7 * (1 - t));
    const P = rng(c.seed * 23 + 4), N = Math.round(18 * c.amount);
    for (let i = 0; i < N; i++) {
      const th = P() * TAU, l = 0.1 + 0.15 * P(), a = (1 - t) * (0.5 + 0.5 * P());
      const p = [cx + Math.cos(th) * r1 * (1 - l), cy + Math.sin(th) * r1 * (1 - l) * k];
      const q = [cx + Math.cos(th) * r1 * 1.04, cy + Math.sin(th) * r1 * 1.04 * k];
      streak(g, p, q, pal.rim, pal.core, a, Math.max(0.8, R * 0.02));
    }
    if (k < 0.98) {
      g.globalCompositeOperation = "source-over";
      for (let i = 0; i < Math.round(14 * c.amount); i++) {
        const th = P() * TAU, up = R * (0.05 + 0.2 * P()) * Math.sin(Math.PI * clamp01(t * 1.3)), a = 1 - smooth(0.5, 1, t);
        if (a <= 0) continue;
        g.fillStyle = rgba(pal.splat, 0.85 * a);
        g.beginPath(); g.arc(cx + Math.cos(th) * r1 * 0.95, cy + Math.sin(th) * r1 * 0.95 * k - up, Math.max(0.7, R * 0.02 * (0.6 + P())), 0, TAU); g.fill();
      }
    }
  },

  // 烟尘: puffs rolling out to both sides along the ground, lit from above,
  // growing and thinning out, with a few pebbles
  dust(g, c) {
    const { t, R, cx, pal } = c;
    const gy = c.gy;
    const P = rng(c.seed * 29 + 6);
    const K = Math.round(8 + 8 * c.amount);
    const blobs = [];
    for (let k = 0; k < K; k++) {
      const side = k % 2 ? 1 : -1, reach = 0.2 + 0.75 * P(), s = 0.16 + 0.16 * P(), up = P();
      const e = easeOut(t / (0.55 + 0.4 * P()), 2.2);
      const r = R * s * (0.5 + 1.0 * e);
      blobs.push({ x: cx + side * R * reach * e, y: gy - r * 0.5 - R * 0.35 * up * e * (0.3 + c.squash), r, heat: 0 });
    }
    // light (top) to shadow (bottom) across the palette, soft edges, thinning out
    const cols = pal.cols;
    const v = volume(c, blobs, {
      cell: Math.max(3, R * 0.12), drift: [t * R * 0.15, t * R * 0.25], rough: 0.6, soft: 0.55, heat: 0,
      thr: 0.25 + 0.7 * smooth(0.25, 1, t), fade: 0.9 * (1 - 0.8 * smooth(0.5, 1, t)),
      color: (_h, light) => [colorAcross(cols, 0.3 + 0.7 * light), 1],
    });
    g.globalCompositeOperation = "source-over";
    // pebbles kicked out ahead of the cloud (drawn first: the dust rolls over them)
    for (let k = 0; k < Math.round(8 * c.amount); k++) {
      const side = P() < 0.5 ? -1 : 1, sp = 0.6 + 0.5 * P(), lt = clamp01(t / (0.45 + 0.3 * P()));
      if (lt >= 1) continue;
      const x = cx + side * R * 1.05 * sp * lt, y = gy - R * 0.45 * sp * Math.sin(Math.PI * lt) * (0.4 + c.squash);
      const sz = Math.max(1, Math.round(R * 0.035));
      g.fillStyle = rgba(cols[1], 1 - lt * 0.4);
      g.fillRect(Math.round(x), Math.round(y), sz, sz);
    }
    if (v.body) g.drawImage(v.body, 0, 0);
  },

  // 蓄力: sparks spiralling in to a pulsing orb wrapped in spinning arcs; as a
  // one-shot the orb grows and bursts at the end
  charge(g, c) {
    const { t, R, cx, cy, pal } = c;
    const P = rng(c.seed * 31 + 8);
    const power = c.loop ? 1 : 0.25 + 0.75 * easeIn(t / 0.82, 1.4);
    const burst = c.loop ? 0 : smooth(0.8, 0.9, t);
    const gone = c.loop ? 1 : 1 - smooth(0.88, 1, t);
    g.globalCompositeOperation = "lighter";
    const N = Math.round(26 * c.amount);
    for (let k = 0; k < N; k++) {
      const th0 = P() * TAU, ph = P(), sp = 1 + Math.floor(P() * 2), r0 = R * (0.7 + 0.45 * P()), wid = 0.6 + 0.8 * P();
      const p = frac(ph + t * sp);
      const d = R * 0.14 + (r0 - R * 0.14) * (1 - easeIn(p, 1.7));
      const th = th0 + p * 0.9;
      const a = smooth(0, 0.2, p) * (1 - smooth(0.85, 1, p)) * (1 - burst);
      if (a <= 0.01) continue;
      const q = [cx + Math.cos(th) * d, cy + Math.sin(th) * d];
      const back = d + R * 0.16 * (0.4 + p);
      streak(g, [cx + Math.cos(th - 0.15) * back, cy + Math.sin(th - 0.15) * back], q, pal.rim, pal.core, a, Math.max(1, R * 0.025 * wid));
    }
    const pulse = 1 + 0.1 * Math.sin(TAU * t * 2);
    const rr = R * 0.24 * pulse * power * gone;
    blob(g, cx, cy, rr * 2.4, [[0, pal.rim, 0.45 * gone], [1, pal.rim, 0]]);
    blob(g, cx, cy, rr, [[0, pal.core, 1], [0.45, pal.core, 0.95], [0.75, pal.rim, 0.8], [1, pal.cols[2], 0]]);
    // arcs spinning round the orb, like the edges of a shell of energy
    g.lineCap = "round";
    for (let k = 0; k < 3; k++) {
      const a0 = TAU * t * (k % 2 ? -1 : 1) + k * TAU / 3, rx = rr * (1.35 + 0.2 * k), ry = rx * (0.45 + 0.2 * k);
      g.save(); g.translate(cx, cy); g.rotate(k * 1.05);
      g.strokeStyle = rgba(pal.core, 0.8 * gone);
      g.lineWidth = Math.max(1, R * 0.02);
      g.beginPath(); g.ellipse(0, 0, rx, ry, 0, a0, a0 + 1.6); g.stroke();
      g.restore();
    }
    for (let k = 0; k < Math.round(4 * c.amount); k++) {
      const th = P() * TAU, d = rr * (1.3 + 0.8 * P()), tw = 0.5 + 0.5 * Math.sin(TAU * (t * 2 + P()));
      star(g, [cx + Math.cos(th) * d, cy + Math.sin(th) * d], Math.max(2, R * 0.06 * tw), pal.rim, 0.9 * tw * gone, 0);
    }
    if (burst > 0) {
      const bt = clamp01((t - 0.8) / 0.2);
      blob(g, cx, cy, R * (0.4 + 0.6 * easeOut(bt)), [[0, pal.core, 1 - bt], [0.4, pal.rim, 0.7 * (1 - bt)], [1, pal.rim, 0]]);
      ring(g, cx, cy, R * (0.3 + 0.8 * easeOut(bt, 2)), R * 0.06 + 0.6, 1, pal.rim, 0.9 * (1 - bt));
    }
  },

  // 魔法阵: drawn flat, then laid on the ground — rings, a band of runes,
  // ticks, a star; the outer parts turn one way, the star the other. A loop
  // turns exactly one symmetry step, so it closes; a one-shot draws itself on
  // and fades away.
  circle(g, c) {
    const { t, R, pal } = c;
    const S = Math.ceil(R * 2 + 8), m = S / 2;
    const flat = createCanvas(S, S), f = flat.getContext("2d");
    const reveal = c.loop ? 1 : easeOut(t / 0.35, 2);
    const env = c.loop ? 1 : 1 - smooth(0.78, 1, t);
    const lw = Math.max(1, R * 0.03);
    // the main rings in the bright core colour, the finer work in the rim colour
    f.strokeStyle = rgba(pal.core, 1);
    f.fillStyle = rgba(pal.rim, 1);
    f.lineWidth = lw;
    f.lineCap = "round";
    const arc = (r, a0 = -Math.PI / 2) => { f.beginPath(); f.arc(m, m, r, a0, a0 + TAU * reveal); f.stroke(); };
    // a loop turns each part by exactly one of its symmetry steps, so the last
    // frame leads back into the first: the runes alternate two glyphs (a step
    // of two runes), the star by its own symmetry
    const sym = c.pattern === "penta" ? 5 : c.pattern === "square" ? 8 : 6;
    const rotOut = TAU / 6 * t * (c.loop ? 1 : 0.75), rotIn = -TAU / sym * t * (c.loop ? 1 : 1.5);
    arc(R * 0.98); arc(R * 0.9);
    f.strokeStyle = rgba(pal.rim, 1);
    // runes: 12 glyphs between the outer rings, each a few seeded strokes
    const P = rng(c.seed * 37 + 9);
    const glyphs = Array.from({ length: 12 }, () => Array.from({ length: 2 + Math.floor(P() * 3) }, () => [P(), P(), P(), P()]));
    f.save(); f.translate(m, m); f.rotate(rotOut);
    const band = R * 0.075, shown = Math.floor(12 * reveal + 1e-6);
    for (let k = 0; k < shown; k++) {
      f.save(); f.rotate(k * TAU / 12); f.translate(0, -R * 0.82);
      f.lineWidth = Math.max(1, lw * 0.8);
      f.beginPath();
      for (const [a, b, cc, d] of glyphs[c.loop ? k % 2 : k]) { f.moveTo((a - 0.5) * band * 1.6, (b - 0.5) * band * 1.6); f.lineTo((cc - 0.5) * band * 1.6, (d - 0.5) * band * 1.6); }
      f.stroke();
      f.restore();
    }
    // ticks
    for (let k = 0; k < 48 * reveal; k++) {
      f.save(); f.rotate(k * TAU / 48);
      f.beginPath(); f.moveTo(0, -R * 0.72); f.lineTo(0, -R * (k % 4 ? 0.69 : 0.66)); f.stroke();
      f.restore();
    }
    f.restore();
    arc(R * 0.72);
    // the star
    f.save(); f.translate(m, m); f.rotate(rotIn);
    const r = R * 0.68;
    const poly = (n, step, off) => {
      f.beginPath();
      for (let k = 0; k <= n; k++) { const a = off + (k * step % n) * TAU / n - Math.PI / 2; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (k) f.lineTo(x, y); else f.moveTo(x, y); }
      f.stroke();
    };
    f.globalAlpha = smooth(0.2, 0.9, reveal);
    if (c.pattern === "penta") poly(5, 2, 0);
    else if (c.pattern === "square") { poly(4, 1, 0); poly(4, 1, Math.PI / 4); }
    else { poly(3, 1, 0); poly(3, 1, Math.PI / 3); }
    f.globalAlpha = 1;
    f.restore();
    arc(R * 0.34);
    f.strokeStyle = rgba(pal.core, 1);
    arc(R * 0.12);
    // lay it on the ground, glow it
    const k = c.squash, dw = S, dh = S * k, x0 = c.cx - S / 2, y0 = c.gy - dh / 2;
    g.globalCompositeOperation = "lighter";
    // a faint light pooled on the ground under it (高清 only: in pixels it
    // would fill the circle with a solid plate)
    if (!c.pixel) {
      g.save(); g.translate(c.cx, c.gy); g.scale(1, k);
      blob(g, 0, 0, R, [[0, pal.rim, 0.1 * env * reveal], [0.85, pal.rim, 0.06 * env * reveal], [1, pal.rim, 0]]);
      g.restore();
    }
    const lay = createCanvas(c.w, c.h), lg = lay.getContext("2d");
    lg.drawImage(flat, x0, y0, dw, dh);
    g.globalAlpha = Math.min(1, env * (c.pixel ? 0.35 : 0.8) * c.glow);
    drawBlurred(g, [lay], Math.max(2, R * 0.06));
    g.globalAlpha = env;
    g.drawImage(lay, 0, 0);
    g.globalAlpha = 1;
    // motes rising off it (whole cycles per loop, so the loop closes)
    const M = Math.round(14 * c.amount);
    for (let i = 0; i < M; i++) {
      const th = P() * TAU, rr = Math.sqrt(P()) * R * 0.9, ph = P(), sp = 1 + Math.floor(P() * 2);
      const p = frac(ph + t * sp), a = Math.sin(Math.PI * p) * env * reveal;
      const x = c.cx + Math.cos(th) * rr, y = c.gy + Math.sin(th) * rr * k - R * 0.9 * p;
      blob(g, x, y, Math.max(1.2, R * 0.035), [[0, pal.core, a], [0.5, pal.rim, 0.5 * a], [1, pal.rim, 0]]);
    }
  },

  // 治疗光圈: a ring of light on the ground, a soft column rising from it, and
  // plus signs and motes floating up
  heal(g, c) {
    const { t, R, pal } = c;
    const k = c.squash, cx = c.cx, gy = c.gy;
    const env = c.loop ? 1 : smooth(0, 0.15, t) * (1 - smooth(0.75, 1, t));
    const pulse = 0.85 + 0.15 * Math.sin(TAU * t * 2);
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = env;
    const H = R * 1.7;
    // a soft column of light (高清 only: in pixels a faint wash only turns into
    // a muddy block)
    if (!c.pixel) {
      const col = createCanvas(c.w, c.h), cg = col.getContext("2d");
      const vg = cg.createLinearGradient(0, gy, 0, gy - H);
      vg.addColorStop(0, rgba(pal.rim, 0.4 * pulse));
      vg.addColorStop(0.5, rgba(pal.cols[2], 0.14 * pulse));
      vg.addColorStop(1, rgba(pal.cols[2], 0));
      cg.fillStyle = vg;
      cg.fillRect(cx - R, gy - H, R * 2, H);
      cg.globalCompositeOperation = "destination-in";
      const hg = cg.createLinearGradient(cx - R, 0, cx + R, 0);
      hg.addColorStop(0, "rgba(0,0,0,0)"); hg.addColorStop(0.25, "rgba(0,0,0,0.7)"); hg.addColorStop(0.5, "rgba(0,0,0,1)");
      hg.addColorStop(0.75, "rgba(0,0,0,0.7)"); hg.addColorStop(1, "rgba(0,0,0,0)");
      cg.fillStyle = hg;
      cg.fillRect(cx - R, gy - H, R * 2, H + 1);
      g.drawImage(col, 0, 0);
    }
    // rays rising from the ring, each brightening and fading on its own beat
    const Q = rng(c.seed * 47 + 12), rays = Math.round(9 * Math.max(0.4, c.amount));
    for (let i = 0; i < rays; i++) {
      const u = (i + 0.5) / rays * 2 - 1 + (Q() - 0.5) * 0.15, ph = Q(), len = H * (0.45 + 0.5 * Q());
      const x = cx + u * R * 0.85, y = gy + Math.sqrt(Math.max(0, 1 - u * u)) * R * k * 0.6 * (Q() * 2 - 1);
      const a = 0.25 + 0.6 * Math.pow(Math.sin(Math.PI * frac(ph + t * (1 + (i % 2)))), 2);
      const wd = Math.max(1, R * (0.03 + 0.04 * Q()) * (1 - Math.abs(u) * 0.5));
      const vg = g.createLinearGradient(0, y, 0, y - len);
      vg.addColorStop(0, rgba(pal.core, a));
      vg.addColorStop(0.35, rgba(pal.rim, 0.6 * a));
      vg.addColorStop(1, rgba(pal.rim, 0));
      g.fillStyle = vg;
      g.fillRect(x - wd / 2, y - len, wd, len);
    }
    // the ground: a glowing disc and a bright ring with a second ring breathing out
    g.save(); g.translate(cx, gy); g.scale(1, k);
    blob(g, 0, 0, R, [[0, pal.rim, (c.pixel ? 0.5 : 0.35) * pulse], [0.8, pal.rim, c.pixel ? 0.3 : 0.2], [1, pal.rim, 0]]);
    g.restore();
    ring(g, cx, gy, R * 0.95, R * 0.05 + 0.7, k, pal.core, 0.95);
    ring(g, cx, gy, R * 0.95, R * 0.14, k, pal.rim, 0.5);
    ring(g, cx, gy, R * (0.4 + 0.55 * frac(t * (c.loop ? 1 : 1.5))), R * 0.03 + 0.5, k, pal.core, 0.6 * (1 - frac(t * (c.loop ? 1 : 1.5))));
    // floating plus signs and motes
    const P = rng(c.seed * 43 + 10), N = Math.round(14 * c.amount);
    for (let i = 0; i < N; i++) {
      const x = cx + (P() * 2 - 1) * R * 0.85, y0 = gy + (P() * 2 - 1) * R * k * 0.6, ph = P(), sp = 1 + Math.floor(P() * 2), plus = P() < 0.45;
      const p = frac(ph + t * sp), a = Math.sin(Math.PI * p);
      const y = y0 - R * 1.5 * p, s = R * (plus ? 0.07 : 0.035) * (0.7 + 0.3 * a);
      if (plus) {
        const th = Math.max(1, s * 0.38);
        g.fillStyle = rgba(pal.core, a);
        g.fillRect(x - s, y - th / 2, s * 2, th); g.fillRect(x - th / 2, y - s, th, s * 2);
        blob(g, x, y, s * 2, [[0, pal.rim, 0.5 * a], [1, pal.rim, 0]]);
      } else blob(g, x, y, Math.max(1.2, s * 1.6), [[0, pal.core, a], [0.5, pal.rim, 0.5 * a], [1, pal.rim, 0]]);
    }
    g.globalAlpha = 1;
  },

  // 环绕光 (斗气): flame tongues licking up round the area's ellipse, pointed
  // on top, hollow inside so what stands in it shows through; streaks of light
  // rising through it, sparks, and lightning if asked for
  aura(g, c) {
    const { w, h, t, pal } = c;
    const rx = c.rx * 0.92, ry = c.ry * 0.9, cx = c.cx, cy = c.cy + c.ry * 0.06;
    const flow = loopNoise(c, 53, 4.5 / Math.max(6, rx), 0.3, 3);
    // the inside in the saturated colours, the licking edge white-hot
    const stops = [pal.cols[0], pal.cols[1], pal.rim, pal.rim, pal.core];
    const img = new ImageData(w, h), d = img.data;
    const x0 = Math.max(0, Math.floor(cx - rx * 1.3)), x1 = Math.min(w, Math.ceil(cx + rx * 1.3));
    const y0 = Math.max(0, Math.floor(cy - ry * 1.6)), y1 = Math.min(h, Math.ceil(cy + ry * 1.2));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry, top = Math.max(0, -v);
      const dd = Math.sqrt(u * u * (1 + top * 1.3) + v * v * (v > 0 ? 1.2 : 0.85));
      const n = flow(x, y);
      // the tongues: the edge pushed out and in by the noise, more so on top
      const e = 1 - dd + (n - 0.5) * (0.3 + 1.4 * top);
      if (e <= 0) continue;
      const shell = smooth(0, 0.1, e), hollow = smooth(0.1, 0.42, e);
      const a = shell * (1 - 0.9 * hollow) * clamp01(0.7 + 0.6 * n);
      if (a <= 0.02) continue;
      const col = colorAcross(stops, clamp01(0.15 + 0.85 * (1 - hollow) * (0.45 + 0.65 * n)) * 0.999);
      const i = (y * w + x) * 4;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = Math.round(255 * a);
    }
    const body = createCanvas(w, h);
    body.getContext("2d").putImageData(img, 0, 0);
    g.globalCompositeOperation = "lighter";
    g.drawImage(body, 0, 0);
    // streaks of light shooting up through it (whole cycles per loop)
    const P = rng(c.seed * 59 + 2), S = Math.round(10 * c.amount);
    for (let k = 0; k < S; k++) {
      const ux = P() * 2 - 1, ph = P(), sp = 1 + Math.floor(P() * 2), len = ry * (0.25 + 0.35 * P());
      const p = c.loop ? frac(ph + t * sp) : frac(ph + t * sp * 1.5);
      const x = cx + ux * rx * 0.8 * Math.sqrt(1 - p * 0.5), yb = cy + ry * (0.9 - 2.3 * p);
      const a = Math.sin(Math.PI * p) * 0.9;
      streak(g, [x, yb + len], [x, yb], pal.rim, pal.core, a, Math.max(1, rx * 0.025));
    }
    // sparks drifting up off the top
    for (let k = 0; k < Math.round(8 * c.amount); k++) {
      const ux = P() * 2 - 1, ph = P(), sp = 1 + Math.floor(P() * 2);
      const p = frac(ph + t * sp), x = cx + ux * rx * 0.9, y = cy - ry * (0.3 + 1.1 * p);
      blob(g, x, y, Math.max(1.2, rx * 0.05), [[0, pal.core, Math.sin(Math.PI * p)], [0.5, pal.rim, 0.5 * Math.sin(Math.PI * p)], [1, pal.rim, 0]]);
    }
    // lightning crawling over it, new every frame (超级赛亚人 2)
    if (c.bolts) {
      const B = rng(c.seed * 61 + c.i * 7919);
      g.lineJoin = "round"; g.lineCap = "round";
      for (let k = 0; k < 2; k++) {
        if (B() < 0.25) continue;
        let th = B() * TAU, r = 0.75 + 0.2 * B();
        const pts = [];
        for (let j = 0; j < 7; j++) { pts.push([cx + Math.cos(th) * rx * r, cy + Math.sin(th) * ry * r]); th += 0.18 + 0.12 * B(); r = Math.max(0.5, Math.min(1.05, r + (B() - 0.5) * 0.35)); }
        for (const [lw, col, a] of [[Math.max(2, rx * 0.06), pal.rim, 0.5], [Math.max(1, rx * 0.022), pal.core, 1]]) {
          g.strokeStyle = rgba(col, a); g.lineWidth = lw;
          g.beginPath(); pts.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
        }
      }
    }
  },

  // 燃烧: fire standing on the bottom of the area — narrowing, flickering
  // tongues, white-hot at the root, smoky at the tips — and embers rising
  burn(g, c) {
    const { w, h, t, pal } = c;
    const rx = c.rx * 0.9, ry = c.ry * 0.95, cx = c.cx, by = c.cy + ry;
    const flow = loopNoise(c, 67, 5 / Math.max(6, rx), 0.5, 4);
    const fire = fireColor(pal);
    const img = new ImageData(w, h), d = img.data;
    const x0 = Math.max(0, Math.floor(cx - rx * 1.2)), x1 = Math.min(w, Math.ceil(cx + rx * 1.2));
    const y0 = Math.max(0, Math.floor(by - ry * 2.1)), y1 = Math.min(h, Math.ceil(by + 1));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const hgt = (by - y - 0.5) / (2 * ry), u = (x + 0.5 - cx) / rx;
      if (hgt < -0.02) continue;
      const n = flow(x, y);
      // narrowing upwards, split into tongues by the noise
      const f = (1 - hgt) * 1.05 - Math.pow(Math.abs(u), 1.4) * (0.9 + 1.4 * hgt) + (n - 0.5) * (0.7 + 1.0 * hgt) - 0.18;
      if (f <= 0) continue;
      const [col, as] = fire(clamp01(f * 1.1 + (1 - hgt) * 0.1), 0.5 + 0.5 * (1 - hgt));
      const a = smooth(0, 0.12, f) * as;
      const i = (y * w + x) * 4;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = Math.round(255 * a);
    }
    const body = createCanvas(w, h);
    body.getContext("2d").putImageData(img, 0, 0);
    g.globalCompositeOperation = pal.dark ? "source-over" : "lighter";
    g.drawImage(body, 0, 0);
    // embers: rise, sway, burn out (whole cycles per loop)
    const P = rng(c.seed * 71 + 3);
    g.globalCompositeOperation = "lighter";
    for (let k = 0; k < Math.round(10 * c.amount); k++) {
      const ux = (P() * 2 - 1) * 0.7, ph = P(), sp = 1 + Math.floor(P() * 2), sw = P() * TAU;
      const p = frac(ph + t * sp), x = cx + ux * rx + Math.sin(sw + p * TAU) * rx * 0.12, y = by - ry * (0.4 + 1.9 * p);
      const a = Math.sin(Math.PI * p) * (1 - p * 0.4);
      blob(g, x, y, Math.max(1, rx * 0.04), [[0, pal.core, a], [0.5, pal.rim, 0.6 * a], [1, pal.rim, 0]]);
    }
  },
};

// smooth noise that drifts upwards over the sequence: (x, y) in canvas pixels →
// 0..1. k: noise cells per pixel across, ky: how much taller the cells are
// (tongues), L: noise rows scrolled over the sequence. A loop cross-fades two
// copies one scroll apart, so the last frame leads back into the first.
function loopNoise(c, salt, k, ky, L) {
  const N = fbmNoise(c.seed * salt + 1), t = c.t;
  return (x, y) => {
    const a = N(x * k, y * k * ky + t * L);
    if (!c.loop) return a;
    const b = N(x * k, y * k * ky + (t - 1) * L);
    return a + (b - a) * t;
  };
}

// how much bloom each kind gets on top of what it draws itself
const BLOOM = { hit: 1, shock: 0.8, charge: 1, heal: 0.7, circle: 0, explosion: 0, dust: 0, aura: 0.9, burn: 0.6 };

// one frame: a w×h canvas
export function renderVfx(p, i) {
  const s = { ...VFX_DEFAULTS, ...p };
  const w = Math.max(8, Math.min(1024, s.w | 0)), h = Math.max(8, Math.min(1024, s.h | 0));
  const n = Math.max(1, Math.min(64, s.frames | 0));
  // a loop runs 0 → (n − 1) / n so the last frame leads into the first; a
  // one-shot samples the middle of each frame's slot, so it starts just after
  // the hit and ends just before it is gone
  const t = s.loop ? i / n : (i + 0.5) / n;
  const pal = paletteOf(s.palette);
  const R = Math.min(w, h) / 2 * clamp01(s.size / 100);
  const ground = s.kind === "dust" || s.kind === "heal" || s.kind === "circle" || (s.kind === "shock" && s.tilt > 2);
  const squash = Math.max(0.15, Math.cos(Math.max(0, Math.min(80, s.tilt)) * Math.PI / 180));
  const c = {
    w, h, t, i, n, seed: s.seed | 0 || 1, pal, R, cx: w / 2, cy: h / 2,
    // what wraps or fills the area (环绕光, 燃烧) uses its width and height
    rx: w / 2 * clamp01(s.size / 100), ry: h / 2 * clamp01(s.size / 100),
    // the ground line: low enough for what rises off it to fit
    gy: s.kind === "dust" ? h * 0.85 : ground ? h / 2 + R * squash * 0.5 : h / 2,
    squash: s.kind === "shock" && s.tilt <= 2 ? 1 : squash,
    amount: Math.max(0, s.amount / 100), glow: Math.max(0, s.glow / 100), loop: !!s.loop, pattern: s.pattern,
    pixel: s.style === "pixel", bolts: !!s.bolts,
  };
  // what stands on the ground sits low, its ring just inside the bottom edge
  if (s.kind === "circle" || s.kind === "heal") c.gy = Math.max(h / 2, h - R * squash - 4);
  const draw = EFFECTS[s.kind] || EFFECTS.hit;
  const base = createCanvas(w, h), bg = base.getContext("2d");
  draw(bg, c);
  bg.globalCompositeOperation = "source-over";
  bg.globalAlpha = 1;
  const out = createCanvas(w, h), og = out.getContext("2d");
  // pixels keep a tighter glow: a wide faint halo snaps to solid blocks
  const bloom = (BLOOM[s.kind] ?? 1) * c.glow * (c.pixel ? 0.5 : 1);
  if (bloom > 0 && !pal.dark) {
    og.globalCompositeOperation = "lighter";
    og.globalAlpha = Math.min(1, 0.7 * bloom);
    drawBlurred(og, [base], Math.max(2, R * 0.1));
    og.globalAlpha = 1;
    og.globalCompositeOperation = "source-over";
  }
  og.drawImage(base, 0, 0);
  if (s.style !== "pixel") return out;
  // pixel art: blocks on the preset's palette (smoke and dust shades added)
  const st = { glowColors: pal.preset.colors, glowCore: pal.preset.core, glowRim: pal.preset.rim, glowSplat: pal.preset.splat, tailTint: 1, glowTail: toHex(pal.smoke) };
  return pixelateGlow(out, st, { size: s.pxSize, alpha: s.pxAlpha });
}

export function renderVfxFrames(p) {
  const n = Math.max(1, Math.min(64, (p.frames ?? VFX_DEFAULTS.frames) | 0));
  return Array.from({ length: n }, (_, i) => renderVfx(p, i));
}

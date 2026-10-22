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
const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

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
  { id: "burn", name: "燃烧", help: "从区域底部烧起来的火焰，火舌摇动，火星上飘", defaults: { palette: "blaze", frames: 8, loop: true, size: 95 } },
  { id: "ribbon", name: "流光", help: "柔和流动的光带：几束细丝交织起伏、扭转，带闪烁的光尘", defaults: { palette: "dream", frames: 16, loop: true, size: 95 } },
  { id: "wings", name: "翅膀", help: "光做的翅膀，重神不重形：一扇从肩部放出的发光笔触、淡淡的光幕，光沿笔触流向翼尖，翼尖飘落光点；循环时扇动一次，不循环时展开后散成光点。正面是一对，侧面是向后展开的近翼和后面的远翼", defaults: { palette: "radiant", frames: 16, loop: true, size: 95 } },
];

export const VFX_DEFAULTS = {
  kind: "hit", palette: "radiant", w: 128, h: 128, frames: 7, fps: 12, loop: false,
  size: 80,      // % of the canvas the effect reaches
  amount: 100,   // particles, %
  glow: 60,      // bloom, %
  tilt: 60,      // 冲击波 / 魔法阵 / 治疗 / 烟尘: how flat the ground is seen, degrees (0 = from above)
  pattern: "hex", // 魔法阵: "hex" 六芒星 | "penta" 五芒星 | "square" 双方形
  bolts: false,  // 环绕光: lightning crawling over it
  view: "front", // "front" 正面 | "side" 侧面: wings draw their side view; the rest is foreshortened sideways
  rotate: 0,     // degrees, the whole effect turned about its centre
  seed: 1,
  style: "hd",   // "hd" | "pixel"
  pxSize: 2, pxAlpha: "steps",
};

export const VFX_PALETTES = GLOW_PRESETS.map((p) => [p.id, p.name]);

// the colours of a preset as rgb: cols (dark → bright), core, rim, splat.
// Kept per preset (read only), with the colour ramps the per-pixel effects use.
const palettes = new Map();
function paletteOf(id) {
  const p = GLOW_PRESETS.find((x) => x.id === id) || GLOW_PRESETS[0];
  if (palettes.has(p.id)) return palettes.get(p.id);
  const cols = p.colors.map(hexToRgb).sort((a, b) => lum(a) - lum(b));
  const core = hexToRgb(p.core), rim = hexToRgb(p.rim), splat = hexToRgb(p.splat || p.rim);
  // smoke: the darkest colour drained towards grey
  const smoke = mixRgb(cols[0], [58, 56, 60], 0.75);
  const pal = { preset: p, cols, core, rim, splat, smoke, dark: lum(core) < 60 };
  pal.fire = fireColor(pal);
  // glowing fire (no smoke): the darkest colour at the faint tips → white-hot
  const flame = [cols[0], ...cols, core];
  pal.flame = ramp((v) => colorAcross(flame, v * 0.999));
  // 烟尘: lit (1) to shadowed (0) across the upper part of the palette
  pal.dust = ramp((v) => [colorAcross(cols, 0.3 + 0.7 * v), 1]);
  // 环绕光: the inside in the saturated colours, the licking edge white-hot
  const aura = [cols[0], cols[1], rim, rim, core];
  pal.aura = ramp((v) => colorAcross(aura, v * 0.999));
  palettes.set(p.id, pal);
  return pal;
}

// a colour ramp looked up instead of worked out per pixel: lut[Math.round(v *
// RAMP)] is f(v) for v in 0..1, so the pixel loops make no arrays
const RAMP = 1023;
const ramp = (f) => Array.from({ length: RAMP + 1 }, (_, i) => f(i / RAMP));
const at = (lut, v) => lut[Math.round(clamp01(v) * RAMP)];

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
    const th = P() * TAU, sp = 0.45 + 0.75 * P(), life = 0.6 + 0.45 * P(), wid = 0.6 + 0.8 * P();
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

// a shaft of light from yb up to yt: faded out at both ends, a thin bright
// core inside layers of wider, fainter glow, so its sides are soft
function beam(g, pal, x, yb, yt, wd, a) {
  if (a <= 0.01 || yb - yt < 1) return;
  g.lineCap = "round";
  for (const [ww, col, k] of [[wd * 5, pal.rim, 0.1], [wd * 2.6, pal.rim, 0.22], [wd, pal.core, 0.9]]) {
    const gr = g.createLinearGradient(0, yb, 0, yt);
    gr.addColorStop(0, rgba(col, 0));
    gr.addColorStop(0.2, rgba(col, a * k));
    gr.addColorStop(0.55, rgba(col, 0.7 * a * k));
    gr.addColorStop(1, rgba(col, 0));
    g.strokeStyle = gr;
    g.lineWidth = ww;
    g.beginPath(); g.moveTo(x, yb); g.lineTo(x, yt); g.stroke();
  }
}

// a ribbon of light winding round (x, y) on an ellipse rx × ry: about two thirds
// of a turn from angle a0, tapered at both ends, brighter and wider on the
// front half than on the far side
function swirl(g, pal, x, y, rx, ry, a0, a, wd) {
  if (a <= 0.01) return;
  const N = 40, span = TAU * 0.68;
  g.lineCap = "round";
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const s0 = i / N, s1 = (i + 1) / N, th0 = a0 + span * s0, th1 = a0 + span * s1;
      const front = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin((th0 + th1) / 2));
      const k = Math.sin(Math.PI * (s0 + s1) / 2) * front * a;
      g.strokeStyle = rgba(pass ? pal.core : pal.rim, pass ? k : 0.35 * k);
      g.lineWidth = (pass ? 1 : 3.5) * wd * (0.5 + 0.5 * front);
      g.beginPath();
      g.moveTo(x + Math.cos(th0) * rx, y + Math.sin(th0) * ry);
      g.lineTo(x + Math.cos(th1) * rx, y + Math.sin(th1) * ry);
      g.stroke();
    }
  }
}

// a polyline broken into finer zigzags: every segment split in four, the
// joints pushed sideways by up to amp
function jag(pts, rnd, amp) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], l = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / l, ny = (bx - ax) / l;
    for (let j = 1; j <= 4; j++) {
      const s = j / 4, o = j < 4 ? (rnd() - 0.5) * 2 * amp : 0;
      out.push([ax + (bx - ax) * s + nx * o, ay + (by - ay) * s + ny * o]);
    }
  }
  return out;
}

// a lightning stroke along pts: wide faint glow, then a white-hot thread
function bolt(g, pal, pts, wd, a) {
  g.lineJoin = "round"; g.lineCap = "round";
  for (const [lw, col, k] of [[wd * 6, pal.rim, 0.12], [wd * 2.8, pal.rim, 0.4], [wd, pal.core, 1]]) {
    g.strokeStyle = rgba(col, a * k); g.lineWidth = lw;
    g.beginPath(); pts.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  }
}

// A glowing stroke along pts that tapers: from a hair at the start to full
// width and white-hot at the end (head, with a bright point there), or
// swelling in the middle and fading out at both ends. Each layer — a wide
// faint glow, then a thin bright thread — is one smooth filled outline with
// its colour running from end to end, so there are no seams or beads.
function trail(g, pal, pts, wd, a, head = true) {
  const n = pts.length - 1;
  if (a <= 0.01 || n < 1) return;
  const [x0, y0] = pts[0], [x1, y1] = pts[n];
  if (Math.hypot(x1 - x0, y1 - y0) < 0.5) return;
  for (const [kw, col, ka] of [[3.2, pal.rim, 0.25], [1, pal.core, 1]]) {
    const L = [], Rt = [];
    for (let i = 0; i <= n; i++) {
      const s = i / n, f = head ? Math.pow(s, 1.5) : Math.sin(Math.PI * s), hw = wd * kw * (0.12 + 0.88 * f) / 2;
      const p = pts[Math.max(0, i - 1)], q = pts[Math.min(n, i + 1)], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const nx = -(q[1] - p[1]) / l * hw, ny = (q[0] - p[0]) / l * hw;
      L.push([pts[i][0] + nx, pts[i][1] + ny]); Rt.push([pts[i][0] - nx, pts[i][1] - ny]);
    }
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, rgba(pal.rim, 0));
    if (head) { gr.addColorStop(0.55, rgba(pal.rim, 0.45 * a * ka)); gr.addColorStop(1, rgba(col, a * ka)); }
    else { gr.addColorStop(0.5, rgba(col, a * ka)); gr.addColorStop(1, rgba(pal.rim, 0)); }
    g.fillStyle = gr;
    g.beginPath();
    L.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    for (let i = n; i >= 0; i--) g.lineTo(Rt[i][0], Rt[i][1]);
    g.closePath(); g.fill();
  }
  if (head) blob(g, x1, y1, wd * 2, [[0, pal.core, a], [0.4, pal.rim, 0.5 * a], [1, pal.rim, 0]]);
}

// an ember or a mote of light moving along (dx, dy): a bright point with a soft
// halo and a short tail behind it
function ember(g, pal, x, y, dx, dy, r, a) {
  if (a <= 0.01 || r <= 0) return;
  const l = Math.hypot(dx, dy) || 1, tx = -dx / l * r * 5, ty = -dy / l * r * 5;
  streak(g, [x + tx, y + ty], [x, y], pal.rim, pal.core, 0.6 * a, r * 1.2);
  blob(g, x, y, r * 3, [[0, pal.core, a], [0.3, pal.rim, 0.55 * a], [1, pal.rim, 0]]);
}

// A noisy density field coloured per pixel: blobs [{ x, y, r, heat }] summed
// into a density, roughened by noise, cut at a threshold that rises as the
// effect thins out, and faded by o.fade. color(heat, light, n) -> [rgb,
// alphaScale], light: 1 on top of a puff, 0 underneath. Returns the body and
// its glowing part (for the bloom) as canvases.
function volume(c, blobs, o) {
  const { w, h } = c;
  if (!blobs.length) return { body: null, hot: null };
  // the box the blobs cover, so empty canvas costs nothing
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (const b of blobs) { x0 = Math.min(x0, b.x - b.r); y0 = Math.min(y0, b.y - b.r); x1 = Math.max(x1, b.x + b.r); y1 = Math.max(y1, b.y + b.r); }
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(w, Math.ceil(x1)); y1 = Math.min(h, Math.ceil(y1));
  const bw = x1 - x0, bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return { body: null, hot: null };
  const noise = noiseGrid(c.seed * 7 + 3, bw, bh, x0 + o.drift[0], y0 + o.drift[1], o.cell);
  const B = blobs.map((b) => ({ ...b, ir2: 1 / (b.r * b.r) }));
  const glows = o.glowAt != null;
  const body = new ImageData(bw, bh), hot = glows ? new ImageData(bw, bh) : null;
  const bd = body.data, hd = glows ? hot.data : null;
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
    const i = (y * bw + x) * 4;
    bd[i] = col[0]; bd[i + 1] = col[1]; bd[i + 2] = col[2]; bd[i + 3] = Math.round(255 * a * as);
    if (glows) {
      const e = smooth(o.glowAt, o.glowAt + 0.25, H * o.heat);
      if (e > 0) { hd[i] = col[0]; hd[i + 1] = col[1]; hd[i + 2] = col[2]; hd[i + 3] = Math.round(255 * a * e); }
    }
  }
  return { body: placed(c, body, x0, y0), hot: glows ? placed(c, hot, x0, y0) : null };
}

// a smoke or fire body drawn a touch soft in 高清, so per-pixel noise reads as
// smooth billows rather than grain (pixels are snapped to blocks anyway)
function drawSoft(g, c, src) {
  if (!c.pixel) g.filter = `blur(${Math.max(0.5, c.R * 0.012).toFixed(2)}px)`;
  g.drawImage(src, 0, 0);
  g.filter = "none";
}

// Paint a per-pixel effect over the box (x0, y0)–(x1, y1) of the frame:
// shade(x, y, px) fills px with [r, g, b, a] (a 0..1), or returns false where
// there is nothing. Worked out at scale sc (< 1: fewer pixels) and drawn back
// up smoothly — a fraction of the cost, and it only softens what is soft anyway.
function field(g, x0, y0, x1, y1, sc, shade) {
  const bw = x1 - x0, bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return;
  const sw = Math.max(1, Math.round(bw * sc)), sh = Math.max(1, Math.round(bh * sc));
  const img = new ImageData(sw, sh), d = img.data, px = [0, 0, 0, 0];
  for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
    if (shade(x0 + (i + 0.5) * bw / sw - 0.5, y0 + (j + 0.5) * bh / sh - 0.5, px) === false) continue;
    const k = (j * sw + i) * 4;
    d[k] = px[0]; d[k + 1] = px[1]; d[k + 2] = px[2]; d[k + 3] = Math.round(255 * clamp01(px[3]));
  }
  const k = createCanvas(sw, sh);
  k.getContext("2d").putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(k, 0, 0, sw, sh, x0, y0, bw, bh);
}

// the scale a field effect of half-width rx is worked out at: full size up to
// about 90 px across the half, then the same number of samples per flame
// however big it gets (pixels keep every pixel: they are snapped to blocks)
const fieldScale = (c, rx) => (c.pixel ? 1 : Math.max(0.34, Math.min(1, 90 / Math.max(1, rx))));

// pixels worked out for a box at (x0, y0) as a canvas of the whole frame
function placed(c, img, x0, y0) {
  const k = createCanvas(c.w, c.h);
  k.getContext("2d").putImageData(img, x0, y0);
  return k;
}

// fire colours by heat: smoke (lit from above) → darkest → … → brightest →
// white-hot core. color(heat, light) -> [rgb, alphaScale], from ramps
function fireColor(pal) {
  const stops = [pal.smoke, ...pal.cols, pal.core];
  const smokeHi = mixRgb(pal.smoke, [168, 162, 158], 0.55);
  const smoke = ramp((light) => [mixRgb(pal.smoke, smokeHi, light * light), 0.85]);
  const flame = ramp((v) => [colorAcross(stops, v * 0.999), 1]);
  return (heat, light) => (heat < 0.12 ? at(smoke, light) : at(flame, (heat - 0.12) / 0.88));
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
    ring(g, cx, cy, R * (0.25 + 0.75 * easeOut(t, 3)), R * 0.07 * (1 - t) + 0.8, 1, pal.rim, 0.8 * (1 - smooth(0, 0.75, t)));
    // a few solid chips
    g.globalCompositeOperation = "source-over";
    const D = rng(c.seed * 17 + 5);
    for (let k = 0; k < Math.round(8 * c.amount); k++) {
      const th = D() * TAU, d = R * (0.25 + 0.75 * D()) * easeOut(t, 2), r = R * (0.015 + 0.025 * D());
      const a = 1 - smooth(0.45, 1.05, t);
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
      cell: Math.max(4, R * 0.16), drift: [0, t * R * 0.6], rough: c.pixel ? 0.8 : 0.65, soft: c.pixel ? 0.3 : 0.42, heat: 1.35,
      thr: 0.3 + 0.5 * smooth(0.35, 1, t), fade: 1 - 0.85 * smooth(0.45, 1.05, t), color: pal.fire, glowAt: 0.45,
    });
    // a dark preset (黑炎) is its own glow-less ink
    if (v.hot && !pal.dark) { g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.8 * c.glow; drawBlurred(g, [v.hot], Math.max(2, R * 0.12)); g.globalAlpha = 1; }
    g.globalCompositeOperation = "source-over";
    if (v.body) drawSoft(g, c, v.body);
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
    // the rings hold their brightness, then fade out by the last frame
    const r1 = R * easeOut(t, 2.6), r2 = R * 0.8 * easeOut((t - 0.12) / 0.88, 2.6), left = 1 - easeIn(t, 2);
    ring(g, cx, cy, r1, R * 0.11 * (1 - t) + 0.8, k, pal.core, 0.95 * (1 - easeIn(t, 2.2)));
    ring(g, cx, cy, r1, R * 0.2 * (1 - t) + 1, k, pal.rim, 0.5 * left);
    if (t > 0.12) ring(g, cx, cy, r2, R * 0.05 * (1 - t) + 0.6, k, pal.rim, 0.7 * left);
    const P = rng(c.seed * 23 + 4), N = Math.round(18 * c.amount);
    for (let i = 0; i < N; i++) {
      const th = P() * TAU, l = 0.1 + 0.15 * P(), a = left * (0.5 + 0.5 * P());
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
      cell: Math.max(3, R * 0.12), drift: [t * R * 0.15, t * R * 0.25], rough: c.pixel ? 0.6 : 0.5, soft: c.pixel ? 0.55 : 0.75, heat: 0,
      thr: 0.25 + 0.4 * smooth(0.25, 1, t), fade: 0.9 * (1 - 0.8 * smooth(0.4, 1.05, t)),
      color: (_h, light) => at(pal.dust, light),
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
    if (v.body) drawSoft(g, c, v.body);
  },

  // 蓄力: sparks spiralling in along curved comet tails to a pulsing orb
  // wrapped in glowing arcs that spin round it; as a one-shot the orb grows
  // and bursts at the end
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
      const a = smooth(0, 0.2, p) * (1 - smooth(0.85, 1, p)) * (1 - burst);
      if (a <= 0.01) continue;
      // a point on its spiral at progress q: closing in faster and faster
      const on = (q) => {
        const d = R * 0.14 + (r0 - R * 0.14) * (1 - easeIn(q, 1.7)), th = th0 + q * 2.2;
        return [cx + Math.cos(th) * d, cy + Math.sin(th) * d];
      };
      const pts = [];
      for (let i = 0; i <= 10; i++) pts.push(on(Math.max(0, p - 0.22 * (1 - i / 10))));
      trail(g, pal, pts, Math.max(0.7, R * 0.022 * wid), a, true);
    }
    const pulse = 1 + 0.1 * Math.sin(TAU * t * 2);
    const rr = R * 0.24 * pulse * power * gone;
    blob(g, cx, cy, rr * 2.4, [[0, pal.rim, 0.45 * gone], [1, pal.rim, 0]]);
    blob(g, cx, cy, rr, [[0, pal.core, 1], [0.45, pal.core, 0.95], [0.75, pal.rim, 0.8], [1, pal.cols[2], 0]]);
    // arcs spinning round the orb, like the edges of a shell of energy: each
    // fading in and out along its length
    for (let k = 0; k < 3; k++) {
      const a0 = TAU * t * (k % 2 ? -1 : 1) + k * TAU / 3, rx = rr * (1.35 + 0.2 * k), ry = rx * (0.45 + 0.2 * k);
      const tilt = k * 1.05, ct = Math.cos(tilt), st = Math.sin(tilt), pts = [];
      for (let i = 0; i <= 24; i++) {
        const th = a0 + 1.9 * i / 24, x = Math.cos(th) * rx, y = Math.sin(th) * ry;
        pts.push([cx + x * ct - y * st, cy + x * st + y * ct]);
      }
      trail(g, pal, pts, Math.max(0.8, R * 0.022), 0.9 * gone, false);
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

  // 魔法阵: rings, a band of runes, ticks and a star, drawn straight onto the
  // ground in perspective (paths laid down first, then stroked, so lines keep
  // their width and stay smooth however flat it lies), every line a bright
  // thread over a soft glow; highlights race round the rings. The outer parts
  // turn one way, the star the other. A loop turns exactly one symmetry step,
  // so it closes; a one-shot draws itself on and fades away.
  circle(g, c) {
    const { t, R, pal } = c;
    const reveal = c.loop ? 1 : easeOut(t / 0.35, 2);
    const env = c.loop ? 1 : 1 - smooth(0.78, 1, t);
    const lw = Math.max(0.8, R * 0.022);
    const k = c.squash, ox = c.cx, oy = c.gy;
    // a loop turns each part by exactly one of its symmetry steps, so the last
    // frame leads back into the first: the runes alternate two glyphs (a step
    // of two runes), the star by its own symmetry
    const sym = c.pattern === "penta" ? 5 : c.pattern === "square" ? 8 : 6;
    const rotOut = TAU / 6 * t * (c.loop ? 1 : 0.75), rotIn = -TAU / sym * t * (c.loop ? 1 : 1.5);
    const lay = createCanvas(c.w, c.h), L = lay.getContext("2d");
    L.lineCap = "round"; L.lineJoin = "round";
    // a point drawn flat at (x, y), turned by rot, laid on the ground
    const to = (x, y, rot = 0) => {
      const cs = Math.cos(rot), sn = Math.sin(rot);
      return [ox + x * cs - y * sn, oy + (x * sn + y * cs) * k];
    };
    const poly = (pts, rot) => pts.forEach(([x, y], i) => { const [X, Y] = to(x, y, rot); if (i) L.lineTo(X, Y); else L.moveTo(X, Y); });
    const circ = (r) => {
      const n = Math.max(8, Math.ceil(120 * reveal));
      poly(Array.from({ length: n + 1 }, (_, i) => { const a = -Math.PI / 2 + TAU * reveal * i / n; return [Math.cos(a) * r, Math.sin(a) * r]; }));
    };
    // one group of lines: a soft glow under a bright thread
    const ink = (build, col, wd, a = 1) => {
      L.beginPath(); build();
      L.strokeStyle = rgba(pal.rim, 0.22 * a); L.lineWidth = wd * 3.4; L.stroke();
      L.strokeStyle = rgba(col, a); L.lineWidth = wd; L.stroke();
    };
    // the main rings in the bright core colour, the finer work in the rim colour
    ink(() => { circ(R * 0.98); circ(R * 0.9); }, pal.core, lw);
    // runes: 12 glyphs between the outer rings, each a few seeded strokes
    const P = rng(c.seed * 37 + 9);
    const glyphs = Array.from({ length: 12 }, () => Array.from({ length: 2 + Math.floor(P() * 3) }, () => [P(), P(), P(), P()]));
    const band = R * 0.075 * 1.6, shown = Math.floor(12 * reveal + 1e-6);
    ink(() => {
      for (let n = 0; n < shown; n++) {
        for (const [a, b, cc, d] of glyphs[c.loop ? n % 2 : n]) poly([[(a - 0.5) * band, (b - 0.5) * band - R * 0.82], [(cc - 0.5) * band, (d - 0.5) * band - R * 0.82]], rotOut + n * TAU / 12);
      }
    }, pal.rim, lw * 0.8);
    // ticks
    ink(() => {
      for (let n = 0; n < 48 * reveal; n++) poly([[0, -R * 0.72], [0, -R * (n % 4 ? 0.69 : 0.66)]], rotOut + n * TAU / 48);
    }, pal.rim, lw * 0.7);
    ink(() => { circ(R * 0.72); circ(R * 0.34); }, pal.rim, lw);
    // the star
    const r = R * 0.68;
    const figure = (n, step, off) => poly(Array.from({ length: n + 1 }, (_, i) => { const a = off + (i * step % n) * TAU / n - Math.PI / 2; return [Math.cos(a) * r, Math.sin(a) * r]; }), rotIn);
    ink(() => {
      if (c.pattern === "penta") figure(5, 2, 0);
      else if (c.pattern === "square") { figure(4, 1, 0); figure(4, 1, Math.PI / 4); }
      else { figure(3, 1, 0); figure(3, 1, Math.PI / 3); }
    }, pal.rim, lw, smooth(0.2, 0.9, reveal));
    ink(() => circ(R * 0.12), pal.core, lw);
    // lay it on the ground, glow it
    g.globalCompositeOperation = "lighter";
    // a faint light pooled on the ground under it, and in the band of runes
    // (高清 only: in pixels it would fill the circle with a solid plate)
    if (!c.pixel) {
      g.save(); g.translate(ox, oy); g.scale(1, k);
      blob(g, 0, 0, R, [[0, pal.rim, 0.12 * env * reveal], [0.85, pal.rim, 0.07 * env * reveal], [1, pal.rim, 0]]);
      g.restore();
      ring(g, ox, oy, R * 0.94, R * 0.05, k, pal.rim, 0.18 * env * reveal);
    }
    g.globalAlpha = Math.min(1, env * (c.pixel ? 0.35 : 0.9) * c.glow);
    drawBlurred(g, [lay], Math.max(2, R * 0.06));
    g.globalAlpha = env;
    g.drawImage(lay, 0, 0);
    g.globalAlpha = 1;
    // highlights racing round the rings (whole turns per loop)
    const lit = env * smooth(0.6, 1, reveal);
    for (const [rad, dir, turns] of [[R * 0.94, 1, 1], [R * 0.72, -1, 1], [R * 0.34, 1, 2]]) {
      for (let j = 0; j < 2; j++) {
        const head = -Math.PI / 2 + dir * (TAU * turns * t + j * Math.PI), pts = [];
        for (let i = 0; i <= 24; i++) { const a = head - dir * 1.3 * (1 - i / 24); pts.push(to(Math.cos(a) * rad, Math.sin(a) * rad)); }
        trail(g, pal, pts, lw * 1.3, lit, true);
      }
    }
    // motes rising off it (whole cycles per loop, so the loop closes)
    const M = Math.round(14 * c.amount);
    for (let i = 0; i < M; i++) {
      const th = P() * TAU, rr = Math.sqrt(P()) * R * 0.9, ph = P(), sp = 1 + Math.floor(P() * 2);
      const p = frac(ph + t * sp), a = Math.sin(Math.PI * p) * env * reveal;
      const x = ox + Math.cos(th) * rr, y = oy + Math.sin(th) * rr * k - R * 0.9 * p;
      if (c.pixel) blob(g, x, y, Math.max(1.2, R * 0.035), [[0, pal.core, a], [0.5, pal.rim, 0.5 * a], [1, pal.rim, 0]]);
      else ember(g, pal, x, y, 0, -1, Math.max(0.6, R * 0.012), a);
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
      // it starts below the ground line, fading in, so no edge crosses the ring
      const col = createCanvas(c.w, c.h), cg = col.getContext("2d");
      const foot = R * k * 0.7, vg = cg.createLinearGradient(0, gy + foot, 0, gy - H);
      vg.addColorStop(0, rgba(pal.rim, 0));
      vg.addColorStop(foot / (H + foot), rgba(pal.rim, 0.4 * pulse));
      vg.addColorStop(0.55, rgba(pal.cols[2], 0.14 * pulse));
      vg.addColorStop(1, rgba(pal.cols[2], 0));
      cg.fillStyle = vg;
      cg.fillRect(cx - R, gy - H, R * 2, H + foot);
      cg.globalCompositeOperation = "destination-in";
      const hg = cg.createLinearGradient(cx - R, 0, cx + R, 0);
      hg.addColorStop(0, "rgba(0,0,0,0)"); hg.addColorStop(0.25, "rgba(0,0,0,0.7)"); hg.addColorStop(0.5, "rgba(0,0,0,1)");
      hg.addColorStop(0.75, "rgba(0,0,0,0.7)"); hg.addColorStop(1, "rgba(0,0,0,0)");
      cg.fillStyle = hg;
      cg.fillRect(cx - R, gy - H, R * 2, H + foot + 1);
      g.drawImage(col, 0, 0);
    }
    // the ground: a soft pool of light (a solid plate in pixels, where a faint
    // one would vanish) and a bright ring, a second ring breathing out
    g.save(); g.translate(cx, gy); g.scale(1, k);
    if (c.pixel) blob(g, 0, 0, R, [[0, pal.rim, 0.5 * pulse], [0.8, pal.rim, 0.3], [1, pal.rim, 0]]);
    else blob(g, 0, 0, R * 1.05, [[0, pal.core, 0.22 * pulse], [0.5, pal.rim, 0.14 * pulse], [0.85, pal.rim, 0.2], [1, pal.rim, 0]]);
    g.restore();
    ring(g, cx, gy, R * 0.95, R * 0.2, k, pal.rim, 0.35);
    ring(g, cx, gy, R * 0.95, R * 0.07, k, pal.rim, 0.7);
    ring(g, cx, gy, R * 0.95, R * 0.025 + 0.6, k, pal.core, 1);
    const br = frac(t * (c.loop ? 1 : 1.5));
    ring(g, cx, gy, R * (0.35 + 0.6 * br), R * 0.03 + 0.5, k, pal.core, 0.6 * (1 - br));
    // shafts rising from the ring, each brightening and fading on its own beat;
    // the ones behind the middle start up on the far side of the ring
    const Q = rng(c.seed * 47 + 12), rays = Math.round(16 * Math.max(0.4, c.amount));
    const beams = [];
    for (let i = 0; i < rays; i++) {
      const u = (i + 0.5) / rays * 2 - 1 + (Q() - 0.5) * 0.12, ph = Q(), len = H * (0.35 + 0.6 * Q()), side = Q() * 2 - 1;
      const x = cx + u * R * 0.9, y = gy + Math.sqrt(Math.max(0, 1 - u * u)) * R * k * 0.9 * side;
      const a = (0.2 + 0.7 * Math.pow(Math.sin(Math.PI * frac(ph + t * (1 + (i % 2)))), 2)) * (0.75 + 0.25 * (1 - Math.abs(u)));
      beams.push([x, y, len, Math.max(0.7, R * (0.012 + 0.022 * Q())), a]);
    }
    for (const [x, y, len, wd, a] of beams) beam(g, pal, x, y + wd, y - len, wd, a);
    // ribbons of light winding up round the column (whole turns per loop)
    const turns = Math.max(1, Math.round(2 * c.amount));
    for (let j = 0; j < turns; j++) {
      const p = frac(t * (c.loop ? 1 : 1.2) + j / turns), rr = R * (0.95 - 0.3 * p), yy = gy - H * 0.5 * easeIn(p, 1.3);
      swirl(g, pal, cx, yy, rr, rr * k, TAU * (p * 1.5 + j * 0.37), 0.9 * Math.sin(Math.PI * p), Math.max(0.8, R * 0.025));
    }
    // floating plus signs and twinkling motes
    const P = rng(c.seed * 43 + 10), N = Math.round(14 * c.amount);
    for (let i = 0; i < N; i++) {
      const x = cx + (P() * 2 - 1) * R * 0.85, y0 = gy + (P() * 2 - 1) * R * k * 0.6, ph = P(), sp = 1 + Math.floor(P() * 2), plus = P() < 0.45;
      const p = frac(ph + t * sp), a = Math.sin(Math.PI * p);
      const y = y0 - R * 1.5 * p, s = R * (plus ? 0.07 : 0.035) * (0.7 + 0.3 * a);
      if (plus) {
        const th = Math.max(1, s * 0.38);
        blob(g, x, y, s * 2.4, [[0, pal.rim, 0.5 * a], [1, pal.rim, 0]]);
        g.fillStyle = rgba(pal.core, a);
        g.fillRect(x - s, y - th / 2, s * 2, th); g.fillRect(x - th / 2, y - s, th, s * 2);
      } else if (c.pixel) blob(g, x, y, Math.max(1.2, s * 1.6), [[0, pal.core, a], [0.5, pal.rim, 0.5 * a], [1, pal.rim, 0]]);
      else star(g, [x, y], Math.max(2, s * 2.2), pal.rim, a, 0);
    }
    g.globalAlpha = 1;
  },

  // 环绕光 (斗气): flame tongues licking up round the area's ellipse, pointed
  // on top, hollow inside so what stands in it shows through; streaks of light
  // rising through it, sparks, and lightning if asked for
  aura(g, c) {
    const { w, h, t, pal } = c;
    const rx = c.rx * 0.92, ry = c.ry * 0.9, cx = c.cx, cy = c.cy + c.ry * 0.06;
    const k = 4.5 / Math.max(6, rx);
    const bend = loopNoise(c, 57, k * 0.3, 0.4, 1.5);
    const flow = loopNoise(c, 53, k, 0.3, 3);
    const fine = loopNoise(c, 83, k * 2.2, 0.13, 5);
    const x0 = Math.max(0, Math.floor(cx - rx * 1.4)), x1 = Math.min(w, Math.ceil(cx + rx * 1.4));
    const y0 = Math.max(0, Math.floor(cy - ry * 1.75)), y1 = Math.min(h, Math.ceil(cy + ry * 1.2));
    g.globalCompositeOperation = "lighter";
    field(g, x0, y0, x1, y1, fieldScale(c, rx), (x, y, px) => {
      const v = (y + 0.5 - cy) / ry, top = Math.max(0, -v);
      // swaying, more so higher up
      const xs = x + (bend(x, y) - 0.5) * rx * (0.05 + 0.4 * top);
      const u = (xs + 0.5 - cx) / rx;
      const dd = Math.sqrt(u * u * (1 + top * 1.3) + v * v * (v > 0 ? 1.2 : 0.85));
      const n = flow(xs, y);
      // the tongues: the edge pushed out and in by the noise, more so on top
      const e = 1 - dd + (n - 0.5) * (0.3 + 1.4 * top);
      if (e <= -0.16) return false;
      const s = strand(fine(xs + (n - 0.5) * rx * 0.3, y), 4);
      const shell = smooth(-0.02, 0.13, e), hollow = smooth(0.08, 0.4, e);
      // strands carry on past the edge as wisps, mostly off the top
      const wisp = s * smooth(-0.16, 0.02, e) * (1 - shell) * (0.25 + top);
      const a = shell * (1 - 0.96 * hollow) * (0.85 + 0.35 * s) + wisp;
      if (a <= 0.004) return false;
      const col = at(pal.aura, 0.2 + 0.8 * (1 - hollow) * (0.45 + 0.35 * n + 0.35 * s));
      px[0] = col[0]; px[1] = col[1]; px[2] = col[2]; px[3] = a;
    });
    // shafts of light shooting up through it (whole cycles per loop)
    const P = rng(c.seed * 59 + 2), S = Math.round(10 * c.amount);
    for (let k = 0; k < S; k++) {
      const ux = P() * 2 - 1, ph = P(), sp = 1 + Math.floor(P() * 2), len = ry * (0.3 + 0.4 * P());
      const p = c.loop ? frac(ph + t * sp) : frac(ph + t * sp * 1.5);
      const x = cx + ux * rx * 0.8 * Math.sqrt(1 - p * 0.5), yb = cy + ry * (0.9 - 2.3 * p);
      beam(g, pal, x, yb + len, yb, Math.max(0.8, rx * 0.018), Math.sin(Math.PI * p) * 0.9);
    }
    // sparks drifting up off the top
    for (let k = 0; k < Math.round(10 * c.amount); k++) {
      const ux = P() * 2 - 1, ph = P(), sp = 1 + Math.floor(P() * 2), big = P();
      const p = frac(ph + t * sp), x = cx + ux * rx * 0.9, y = cy - ry * (0.3 + 1.2 * p);
      ember(g, pal, x, y, ux * 0.3, -1, Math.max(0.7, rx * (0.012 + 0.02 * big)), Math.sin(Math.PI * p));
    }
    // lightning crawling over it, new every frame (超级赛亚人 2)
    if (c.bolts) {
      const B = rng(c.seed * 61 + c.i * 7919);
      for (let k = 0; k < 2; k++) {
        if (B() < 0.25) continue;
        let th = B() * TAU, r = 0.75 + 0.2 * B();
        const pts = [];
        for (let j = 0; j < 7; j++) { pts.push([cx + Math.cos(th) * rx * r, cy + Math.sin(th) * ry * r]); th += 0.18 + 0.12 * B(); r = Math.max(0.5, Math.min(1.05, r + (B() - 0.5) * 0.35)); }
        const main = jag(pts, B, rx * 0.05);
        bolt(g, pal, main, Math.max(0.8, rx * 0.018), 1);
        // a fork or two splitting off
        for (let f = 0; f < 2; f++) {
          if (B() < 0.4) continue;
          const at0 = main[Math.floor(B() * (main.length - 2))], ang = B() * TAU, len = rx * (0.15 + 0.2 * B());
          bolt(g, pal, jag([at0, [at0[0] + Math.cos(ang) * len, at0[1] + Math.sin(ang) * len]], B, rx * 0.04), Math.max(0.6, rx * 0.01), 0.7);
        }
      }
    }
  },

  // 流光: ribbons of light drifting across the area — each a bundle of fine
  // strands that twists (the strands cross where it turns edge-on), brighter
  // along its edges and faded out at both ends — with glittering dust. A loop
  // moves every wave a whole number of cycles, so it closes; a one-shot sweeps
  // in from the left and fades away.
  ribbon(g, c) {
    const { t, pal } = c;
    const rx = c.rx, ry = c.ry, cx = c.cx, cy = c.cy;
    const P = rng(c.seed * 89 + 5);
    const env = c.loop ? 1 : smooth(0, 0.2, t) * (1 - smooth(0.65, 1.05, t));
    const xa = cx - rx, xb = xa + 2 * rx * (c.loop ? 1 : easeOut(t / 0.55, 2));
    const nR = Math.max(1, Math.round(3 * Math.max(0.34, c.amount)));
    // in pixels a few solid strands: faint ones would vanish
    const strands = c.pixel ? 4 : 12, M = 72, lw = Math.max(0.6, c.R * 0.007);
    // the saturated colours only: white comes from where ribbons overlap
    const tones = [...pal.cols, pal.rim, pal.splat].filter((q) => lum(q) > 40 && lum(q) < 215);
    if (!tones.length) tones.push(pal.rim);
    const bands = [];
    g.globalCompositeOperation = "lighter";
    g.lineCap = "round"; g.lineJoin = "round";
    for (let r = 0; r < nR; r++) {
      const f1 = (0.7 + 0.7 * P()) * Math.PI / rx, f2 = (1.6 + 1.4 * P()) * Math.PI / rx, ft = (0.6 + 0.8 * P()) * Math.PI / rx;
      const p1 = P() * TAU, p2 = P() * TAU, pt = P() * TAU, d1 = P() < 0.5 ? -1 : 1, d2 = 1 + Math.floor(P() * 2);
      const A1 = ry * (0.22 + 0.3 * P()), A2 = ry * (0.06 + 0.1 * P()), W = ry * (0.1 + 0.16 * P()), off = (P() - 0.5) * ry * 0.5;
      const ca = tones[Math.floor(P() * tones.length)], cb = tones[Math.floor(P() * tones.length)];
      const mid = (x) => cy + off + A1 * Math.sin(x * f1 + p1 + d1 * TAU * t) + A2 * Math.sin(x * f2 + p2 - d2 * TAU * t);
      const wide = (x) => W * Math.sin(x * ft + pt + TAU * t);
      bands.push([mid, wide]);
      const paint = (col0, col1, a) => {
        const gr = g.createLinearGradient(cx - rx, 0, cx + rx, 0);
        gr.addColorStop(0, rgba(col0, 0));
        gr.addColorStop(0.2, rgba(col0, a));
        gr.addColorStop(0.5, rgba(mixRgb(col0, col1, 0.5), a));
        gr.addColorStop(0.8, rgba(col1, a));
        gr.addColorStop(1, rgba(col1, 0));
        return gr;
      };
      const path = (v) => {
        g.beginPath();
        for (let i = 0; i <= M; i++) { const x = xa + (xb - xa) * i / M, y = mid(x) + wide(x) * v; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      };
      // a soft sheet of light under the strands
      if (!c.pixel) for (const [k, a] of [[2.6, 0.035], [1.4, 0.06]]) { g.strokeStyle = paint(ca, cb, a * env); g.lineWidth = W * k; path(0); g.stroke(); }
      // the strands, unevenly spaced so they read as silk, not a grid; the
      // outer ones bright (the ribbon's edges catch the light)
      for (let j = 0; j < strands; j++) {
        const v = strands > 1 ? Math.max(-1, Math.min(1, (j / (strands - 1) * 2 - 1) + (P() - 0.5) * 0.12)) : 0, e = Math.pow(Math.abs(v), 4);
        g.strokeStyle = paint(ca, cb, (c.pixel ? 0.9 : 0.1 + 0.65 * e) * env);
        g.lineWidth = lw * (0.6 + 0.8 * e);
        path(v); g.stroke();
      }
    }
    // glittering dust along the ribbons, twinkling (whole cycles per loop)
    const N = Math.round(36 * c.amount);
    for (let i = 0; i < N; i++) {
      const [mid, wide] = bands[Math.floor(P() * bands.length)];
      const x = xa + (xb - xa) * P(), y = mid(x) + wide(x) * (P() * 2 - 1) * 1.5 + (P() - 0.5) * ry * 0.25;
      const ph = P(), sp = 1 + Math.floor(P() * 3), big = P();
      const a = Math.pow(Math.sin(Math.PI * frac(ph + t * sp)), 2) * env * smooth(0, 0.15, (x - (cx - rx)) / (2 * rx)) * smooth(0, 0.15, (cx + rx - x) / (2 * rx));
      if (big > 0.9 && !c.pixel) star(g, [x, y], Math.max(2, c.R * 0.05), pal.rim, a, 0);
      else blob(g, x, y, Math.max(1, c.R * (0.01 + 0.015 * big)), [[0, pal.core, a], [0.5, pal.rim, 0.5 * a], [1, pal.rim, 0]]);
    }
  },

  // 翅膀: wings of light, the spirit rather than the form. Each wing has the
  // build of a real one — a bright arm bowing up and out from the root to the
  // wrist, and feathers growing all along it: hanging down and out by the
  // root, longer and turning outward toward the tip, where they end in a high
  // point — but every feather is drawn as a wisp of glowing strands, bright
  // where it leaves the arm and thinning to a flame-like tip, so the lower
  // edge is a ragged fringe of light. The roots meet in a bright glow, a faint
  // veil fills the wing, sparks hang about it. 正面: a spread pair; 侧面: the
  // near wing swept back with the far one smaller and dimmer behind it.
  wings(g, c) {
    const { t, R, cx, cy, pal } = c;
    const side = c.view === "side";
    const n = Math.max(18, Math.min(110, Math.round(60 * Math.sqrt(Math.max(0.2, c.amount)))));
    const open = c.loop ? 1 : easeOut(t / 0.35, 2);
    const gone = c.loop ? 0 : smooth(0.62, 1, t);
    // the wingbeat, as birds and butterflies do it: a quick, strong downstroke
    // and a slower recovery. u: +1 wings up, −1 wings down; vel: −1 sweeping
    // down … +1 rising. A loop is one whole beat (it starts and ends up top);
    // a one-shot beats once, gently, while it is held open.
    const cyc = c.loop ? t : clamp01(t / 0.62), down = 0.42, amp = c.loop ? 1 : 0.6;
    const u = amp * (cyc < down ? 1 - 2 * smooth(0, down, cyc) : -1 + 2 * smooth(down, 1, cyc));
    const vel = amp * (cyc < down ? -Math.sin(Math.PI * cyc / down) : Math.sin(Math.PI * (cyc - down) / (1 - down)));
    const P = rng(c.seed * 97 + 11);
    const strands = Array.from({ length: n }, () => [P(), P(), P(), P(), P()]);
    const M = 18, lw = Math.max(0.6, R * 0.012) * (c.pixel ? 1.8 : 1);
    const lower = pal.cols[Math.min(2, pal.cols.length - 1)];
    g.globalCompositeOperation = "lighter";
    // one wing: dir 1 spreads to the right, -1 to the left; at: the root;
    // k: its size; a: its strength
    const wing = (dir, at, k, a) => {
      // its size, as big as the area allows; on the way up it folds in a
      // little at the wrist, the downstroke has it fully spread
      const S = (side ? Math.min(c.rx * 0.55, c.ry * 0.58) : Math.min(c.rx * 0.48, c.ry * 0.72)) * k
        * (0.35 + 0.65 * open) * (1 - (side ? 0.25 : 0.12) * Math.max(0, vel));
      // the stroke turns the wing about its root — far, seen from the side;
      // from the front it also turns back over the body on the way up, so it
      // looks narrower then (a butterfly closing). Drawn in the wing's own
      // frame (x out from the root, y down), then placed:
      const psi = side ? -0.15 - 0.85 * u : -0.5 * u, fx = side ? 1 : 1 - 0.42 * Math.max(0, u);
      const cs = Math.cos(psi), sn = Math.sin(psi);
      const at2 = (x, y) => [at[0] + dir * fx * (x * cs - y * sn), at[1] + x * sn + y * cs];
      // the arm: from the root up and out in a bow to the wrist
      const T = [S * 0.95, -S * 0.38], C = [S * 0.38, -S * 0.55];
      const arm = (s) => { const r = 1 - s; return [2 * r * s * C[0] + s * s * T[0], 2 * r * s * C[1] + s * s * T[1]]; };
      // a feather from arm position s: down and out by the root, out and a
      // little up at the tip, longer outward, curving down along its length.
      // The strands trail the stroke, tips and inner feathers most.
      const feather = (s, j1, j2, ph, sp) => {
        const [x0, y0] = arm(s), phi = 0.95 + (-0.25 - 0.95) * Math.pow(s, 0.9) + (j1 - 0.5) * 0.14;
        const len = S * (0.5 + 0.55 * Math.pow(s, 0.7)) * (0.75 + 0.5 * j2), bend = 0.1 + 0.25 * (1 - s);
        const pts = [];
        let x = x0, y = y0;
        for (let i = 0; i <= M; i++) {
          const e = i / M;
          const wave = S * 0.02 * Math.sin(TAU * t * sp + ph + e * 4) * e;
          const lag = S * (side ? 0.2 : 0.15) * vel * e * e * (0.3 + (1 - s));
          pts.push(at2(x, y + wave + lag));
          const ang = phi + bend * e;
          x += Math.cos(ang) * len / M; y += Math.sin(ang) * len / M;
        }
        return pts;
      };
      const bone = Array.from({ length: M + 1 }, (_, i) => at2(...arm(i / M)));
      // the veil: soft light over the whole wing, the arm down to the tips
      if (!c.pixel) {
        const V = createCanvas(c.w, c.h), vg = V.getContext("2d");
        const [rx0, ry0] = at2(S * 0.3, 0), gr = vg.createRadialGradient(rx0, ry0, 0, rx0, ry0, S * 1.3);
        gr.addColorStop(0, rgba(pal.core, 0.26 * a));
        gr.addColorStop(0.4, rgba(pal.rim, 0.14 * a));
        gr.addColorStop(1, rgba(lower, 0));
        vg.fillStyle = gr;
        vg.beginPath();
        bone.forEach(([x, y], i) => (i ? vg.lineTo(x, y) : vg.moveTo(x, y)));
        for (let i = 12; i >= 0; i--) { const p = feather(i / 12, 0.5, 0.5, 0, 0); vg.lineTo(p[M - 3][0], p[M - 3][1]); }
        vg.closePath(); vg.fill();
        g.globalAlpha = 1 - gone;
        drawBlurred(g, [V], Math.max(2, R * 0.06));
        g.globalAlpha = 1;
      }
      // the feathers: wisps full along their length, thinning out at the tips; they
      // come apart from the arm outward as it fades
      const from = Math.floor(gone * (M - 2)), tips = [];
      for (const [r0, r1, r2, r3, r4] of strands) {
        const s = Math.pow(r0, 0.85), pts = feather(s, r1, r2, r4 * TAU, 1 + Math.floor(r3 * 2));
        tips.push([pts[M], s]);
        const col = { rim: mixRgb(pal.rim, lower, Math.min(1, (1 - s) * 0.8)), core: pal.core };
        trail(g, col, pts.slice(from), lw * (0.9 + 0.7 * s) * (0.7 + 0.6 * r2), a * (0.42 + 0.3 * s) * (1 - 0.7 * gone), false);
      }
      // the arm: the leading edge, brightest
      trail(g, pal, bone.slice(from), lw * 2.4, a * (1 - 0.6 * gone), false);
      // sparks hanging about the wing and drifting off its edge
      for (let m = 0; m < Math.round(26 * c.amount * (1 + 2 * gone)); m++) {
        const [tip, s] = tips[Math.floor(P() * tips.length)], back = P();
        const ph = P(), sp = 1 + Math.floor(P() * 2), p = frac(ph + t * sp), tw = Math.sin(Math.PI * p);
        const x = tip[0] + dir * R * 0.2 * (p * (0.4 + P()) - back * 0.6), y = tip[1] + R * (0.25 * p * (1.3 - s) - 0.15 * back * P());
        if (P() < 0.25 && !c.pixel) star(g, [x, y], Math.max(1.5, R * 0.03), pal.rim, a * tw, 0);
        else blob(g, x, y, Math.max(0.8, R * (0.008 + 0.012 * P())) * 2, [[0, pal.core, a * tw], [0.4, pal.rim, 0.5 * a * tw], [1, pal.rim, 0]]);
      }
      return at2(0, 0);
    };
    if (side) {
      // facing right: both wings swept back to the left, the far one behind
      wing(-1, [cx + R * 0.45, cy - R * 0.02], 0.8, 0.45);
      const root = wing(-1, [cx + R * 0.38, cy + R * 0.08], 1.05, 1);
      blob(g, root[0], root[1], R * 0.26, [[0, pal.core, 0.6 * (1 - gone)], [0.35, pal.rim, 0.3 * (1 - gone)], [1, pal.rim, 0]]);
    } else {
      wing(1, [cx + R * 0.03, cy + R * 0.1], 1, 1);
      wing(-1, [cx - R * 0.03, cy + R * 0.1], 1, 1);
      // where the roots meet: the brightest light
      blob(g, cx, cy + R * 0.1, R * 0.32, [[0, pal.core, 0.75 * (1 - gone)], [0.3, pal.rim, 0.35 * (1 - gone)], [1, pal.rim, 0]]);
    }
  },

  // 燃烧: fire standing on the bottom of the area — tongues bent by a slow
  // sway and stretched upwards, fine bright strands running through them and
  // trailing off past the edge as wisps, white-hot at the root — and embers
  burn(g, c) {
    const { w, h, t, pal } = c;
    const rx = c.rx * 0.9, ry = c.ry * 0.95, cx = c.cx, by = c.cy + ry;
    const k = 4.5 / Math.max(6, rx);
    // a slow sway (gentle enough never to fold the picture over), the tongues,
    // and long strands that follow them
    const bend = loopNoise(c, 73, k * 0.3, 0.4, 1.5);
    const flow = loopNoise(c, 67, k, 0.42, 4);
    const fine = loopNoise(c, 79, k * 2.2, 0.13, 6);
    const x0 = Math.max(0, Math.floor(cx - rx * 1.5)), x1 = Math.min(w, Math.ceil(cx + rx * 1.5));
    const y0 = Math.max(0, Math.floor(by - ry * 2.3)), y1 = Math.min(h, Math.ceil(by + 1));
    g.globalCompositeOperation = pal.dark ? "source-over" : "lighter";
    field(g, x0, y0, x1, y1, fieldScale(c, rx), (x, y, px) => {
      const hgt = (by - y - 0.5) / (2 * ry);
      if (hgt < -0.02) return false;
      // the whole fire bends sideways, more the higher up
      const xs = x + (bend(x, y) - 0.5) * rx * (0.1 + 0.6 * hgt);
      const u = (xs + 0.5 - cx) / rx, n = flow(xs, y);
      // narrowing upwards, split into tongues by the noise
      const f = (1 - hgt) * 1.05 - Math.pow(Math.abs(u), 1.4) * (0.9 + 1.4 * hgt) + (n - 0.5) * (0.8 + 1.1 * hgt) - 0.18;
      if (f <= -0.14) return false;
      const s = strand(fine(xs + (n - 0.5) * rx * 0.35, y), 4);
      const body = smooth(-0.03, 0.22, f) * smooth(-0.02, 0.05, hgt), wisp = s * smooth(-0.14, 0.02, f) * (1 - body) * (0.4 + hgt);
      const heat = clamp01(f * 0.9 + (1 - hgt) * 0.08 + s * 0.3 * body);
      let col, a;
      if (pal.dark) { const [fc, as] = pal.fire(heat, 0.5 + 0.5 * (1 - hgt)); col = fc; a = (body + wisp) * as; }
      else { col = at(pal.flame, heat); a = body * (0.3 + 0.7 * smooth(0, 0.5, heat)) * (0.75 + 0.25 * s) + wisp * 0.8; }
      if (a <= 0.004) return false;
      px[0] = col[0]; px[1] = col[1]; px[2] = col[2]; px[3] = a;
    });
    // embers: rise, sway, burn out (whole cycles per loop)
    const P = rng(c.seed * 71 + 3);
    g.globalCompositeOperation = "lighter";
    for (let k = 0; k < Math.round(18 * c.amount); k++) {
      const ux = (P() * 2 - 1) * 0.9, ph = P(), sp = 1 + Math.floor(P() * 2), sw = P() * TAU, big = P();
      const p = frac(ph + t * sp), x = cx + ux * rx * (1 + 0.4 * p) + Math.sin(sw + p * TAU) * rx * 0.12, y = by - ry * (0.3 + 2 * p);
      ember(g, pal, x, y, Math.cos(sw + p * TAU) * 0.6, -1, Math.max(0.8, rx * (0.015 + 0.025 * big)), Math.sin(Math.PI * p) * (1 - p * 0.4));
    }
  },
};

// smooth noise that drifts upwards over the sequence: (x, y) in canvas pixels →
// 0..1. k: noise cells per pixel across, ky: how much taller the cells are
// (tongues), L: noise rows scrolled over the sequence. A loop cross-fades two
// copies one scroll apart, so the last frame leads back into the first; the mix
// is rescaled so it stays as contrasty mid-loop as at the ends.
function loopNoise(c, salt, k, ky, L) {
  const N = fbmNoise(c.seed * salt + 1), t = c.t;
  const keep = 1 / Math.hypot(1 - t, t);
  return (x, y) => {
    const a = N(x * k, y * k * ky + t * L);
    if (!c.loop) return a;
    const b = N(x * k, y * k * ky + (t - 1) * L);
    return clamp01(0.5 + ((a - 0.5) * (1 - t) + (b - 0.5) * t) * keep);
  };
}

// thin bright lines where noise crosses its middle: the strands in fire and aura
const strand = (n, p) => Math.pow(1 - Math.abs(2 * n - 1), p);

// how much bloom each kind gets on top of what it draws itself
const BLOOM = { hit: 1, shock: 0.8, charge: 1, heal: 0.7, circle: 0, explosion: 0, dust: 0, aura: 0.9, burn: 0.9, ribbon: 1, wings: 1 };

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
    pixel: s.style === "pixel", bolts: !!s.bolts, view: s.view,
  };
  // what stands on the ground sits low, its ring just inside the bottom edge
  if (s.kind === "circle" || s.kind === "heal") c.gy = Math.max(h / 2, h - R * squash - 4);
  const draw = EFFECTS[s.kind] || EFFECTS.hit;
  let base = createCanvas(w, h);
  const bg = base.getContext("2d");
  draw(bg, c);
  bg.globalCompositeOperation = "source-over";
  bg.globalAlpha = 1;
  // 视角 and 旋转, for every kind: seen from the side the effect is narrowed
  // sideways (wings draw their own side view), then the whole picture turns
  // about its centre — before the bloom and the pixels, so both follow it
  const rot = ((+s.rotate || 0) % 360) * Math.PI / 180, narrow = s.view === "side" && s.kind !== "wings" ? 0.45 : 1;
  if (rot || narrow !== 1) {
    const turned = createCanvas(w, h), tg = turned.getContext("2d");
    tg.imageSmoothingEnabled = true;
    tg.imageSmoothingQuality = "high";
    tg.translate(w / 2, h / 2); tg.rotate(rot); tg.scale(narrow, 1);
    tg.drawImage(base, -w / 2, -h / 2);
    base = turned;
  }
  // pixels keep a tighter glow: a wide faint halo snaps to solid blocks
  const bloom = (BLOOM[s.kind] ?? 1) * c.glow * (c.pixel ? 0.5 : 1);
  let out = base;
  if (bloom > 0 && !pal.dark) {
    out = createCanvas(w, h);
    const og = out.getContext("2d");
    og.globalCompositeOperation = "lighter";
    og.globalAlpha = Math.min(1, 0.7 * bloom);
    drawBlurred(og, [base], Math.max(2, R * 0.1));
    og.globalAlpha = 1;
    og.globalCompositeOperation = "source-over";
    og.drawImage(base, 0, 0);
  }
  if (s.style !== "pixel") return out;
  // pixel art: blocks on the preset's palette (smoke and dust shades added)
  const st = { glowColors: pal.preset.colors, glowCore: pal.preset.core, glowRim: pal.preset.rim, glowSplat: pal.preset.splat, tailTint: 1, glowTail: toHex(pal.smoke) };
  return pixelateGlow(out, st, { size: s.pxSize, alpha: s.pxAlpha });
}

export function renderVfxFrames(p) {
  const n = Math.max(1, Math.min(64, (p.frames ?? VFX_DEFAULTS.frames) | 0));
  return Array.from({ length: n }, (_, i) => renderVfx(p, i));
}

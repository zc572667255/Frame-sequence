// What the effects (vfx/kinds/*) share: easing, the presets' colours as
// rgb with their ramps, glows, rings, streaks and sparks, lightning, comet
// trails, the per-pixel density field of fire, smoke and dust, and noise that
// drifts upwards and closes a loop.
import { createCanvas, hexToRgb } from "../core/util.js";
import { GLOW_PRESETS } from "../trails/glow.js";
import { rng, rgba, clamp01, smooth, colorAcross, noiseGrid, fbmNoise } from "../trails/glow/util.js";

export const TAU = Math.PI * 2;
export const easeOut = (t, p = 2) => 1 - Math.pow(1 - clamp01(t), p);
export const easeIn = (t, p = 2) => Math.pow(clamp01(t), p);
export const frac = (x) => x - Math.floor(x);
export const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
export const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

// the colours of a preset as rgb: cols (dark → bright), core, rim, splat.
// Kept per preset (read only), with the colour ramps the per-pixel effects use.
export const palettes = new Map();
export function paletteOf(id) {
  const p = GLOW_PRESETS.find((x) => x.id === id) || GLOW_PRESETS[0];
  if (palettes.has(p.id)) return palettes.get(p.id);
  const cols = p.colors.map(hexToRgb).sort((a, b) => lum(a) - lum(b));
  const core = hexToRgb(p.core), rim = hexToRgb(p.rim), splat = hexToRgb(p.splat || p.rim);
  // smoke: the darkest colour drained towards grey
  const smoke = mixRgb(cols[0], [58, 56, 60], 0.75);
  const pal = { preset: p, cols, core, rim, splat, smoke, dark: lum(core) < 60 };
  pal.fire = fireColor(pal);
  // the element its glow style carries (fire, rock, wind, water, lightning), if any
  const lk = p.look || {}, has = (...ks) => ks.some((q) => +lk[q] > 0);
  pal.element = has("flames") ? "fire" : has("rocks") ? "earth" : has("curls") ? "wind" : has("caustic", "tear", "drops") ? "water" : has("bolts") ? "bolt" : null;
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
export const RAMP = 1023;
export const ramp = (f) => Array.from({ length: RAMP + 1 }, (_, i) => f(i / RAMP));
export const at = (lut, v) => lut[Math.round(clamp01(v) * RAMP)];

// ---------- shared drawing ----------

// a soft round glow
export function blob(g, x, y, r, stops) {
  if (r <= 0.3) return;
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, c, a] of stops) gr.addColorStop(o, rgba(c, a));
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
}

// a soft ring of radius r and half-width wd, squashed vertically by k (and
// sideways by kx: a ring seen edge-on)
export function ring(g, x, y, r, wd, k, c, a, kx = 1) {
  if (r <= 0 || a <= 0.005) return;
  const R = r + wd;
  g.save();
  g.translate(x, y); g.scale(kx, k);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, R);
  gr.addColorStop(clamp01((r - wd) / R), rgba(c, 0));
  gr.addColorStop(clamp01(r / R), rgba(c, a));
  gr.addColorStop(1, rgba(c, 0));
  g.fillStyle = gr;
  g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
  g.restore();
}

// a streak from p to q fading from transparent (p) to colour (q)
export function streak(g, p, q, c0, c1, a, lw) {
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
export function spike(g, cx, cy, th, len, wid, core, rim, a) {
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

// sparks flung out from (x, y): comets that slow down, curve over as they fall
// and burn out, their tails bending along the arc
export function sparks(g, c, x, y, n, reach, t0, seedK, gravity = 0.3) {
  const P = rng(c.seed * 41 + seedK);
  for (let k = 0; k < n; k++) {
    const th = P() * TAU, sp = 0.45 + 0.75 * P(), life = 0.6 + 0.45 * P(), wid = 0.6 + 0.8 * P();
    const lt = (c.t - t0) / life;
    if (lt <= 0 || lt >= 1) continue;
    const at = (q) => {
      const d = reach * (0.12 + sp * easeOut(q, 2.4)), fall = reach * gravity * q * q;
      return [x + Math.cos(th) * d, y + Math.sin(th) * d + fall];
    };
    comet(g, c.pal, at, lt, 0.12 + 0.1 * sp, Math.max(0.8, c.R * 0.026 * wid * (1 - lt * 0.6)), 1 - lt * lt);
  }
}

// a shaft of light from yb up to yt: faded out at both ends, a thin bright
// core inside layers of wider, fainter glow, so its sides are soft
export function beam(g, pal, x, yb, yt, wd, a) {
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
export function swirl(g, pal, x, y, rx, ry, a0, a, wd) {
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
export function jag(pts, rnd, amp) {
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
export function bolt(g, pal, pts, wd, a) {
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
export function trail(g, pal, pts, wd, a, head = true) {
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

// A particle with a tail: path(q) is where it is at progress q along its own
// flight; it is drawn at q with a glowing head and a tail through where it was
// a moment ago (back: how far back), so the tail bends with the path — an arc
// for a falling spark, a wave for a swaying mote — thinning and fading behind
export function comet(g, pal, path, q, back, wd, a) {
  if (a <= 0.01 || wd <= 0) return;
  const pts = [];
  for (let i = 8; i >= 0; i--) pts.push(path(Math.max(0, q - back * i / 8)));
  trail(g, pal, pts, wd, a, true);
}

// A noisy density field coloured per pixel: blobs [{ x, y, r, heat }] summed
// into a density, roughened by noise, cut at a threshold that rises as the
// effect thins out, and faded by o.fade. color(heat, light, n) -> [rgb,
// alphaScale], light: 1 on top of a puff, 0 underneath. Returns the body and
// its glowing part (for the bloom) as canvases.
export function volume(c, blobs, o) {
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
export function drawSoft(g, c, src) {
  if (!c.pixel) g.filter = `blur(${Math.max(0.5, c.R * 0.012).toFixed(2)}px)`;
  g.drawImage(src, 0, 0);
  g.filter = "none";
}

// Paint a per-pixel effect over the box (x0, y0)–(x1, y1) of the frame:
// shade(x, y, px) fills px with [r, g, b, a] (a 0..1), or returns false where
// there is nothing. Worked out at scale sc (< 1: fewer pixels) and drawn back
// up smoothly — a fraction of the cost, and it only softens what is soft anyway.
export function field(g, x0, y0, x1, y1, sc, shade) {
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
// (as pixels, at the size of the blocks it is turned into: finer would be lost)
export const fieldScale = (c, rx) => (c.pixel ? 1 / Math.max(1, c.px || 1) : Math.max(0.34, Math.min(1, 90 / Math.max(1, rx))));

// pixels worked out for a box at (x0, y0) as a canvas of the whole frame
export function placed(c, img, x0, y0) {
  const k = createCanvas(c.w, c.h);
  k.getContext("2d").putImageData(img, x0, y0);
  return k;
}

// fire colours by heat: smoke (lit from above) → darkest → … → brightest →
// white-hot core. color(heat, light) -> [rgb, alphaScale], from ramps
export function fireColor(pal) {
  const stops = [pal.smoke, ...pal.cols, pal.core];
  const smokeHi = mixRgb(pal.smoke, [168, 162, 158], 0.55);
  const smoke = ramp((light) => [mixRgb(pal.smoke, smokeHi, light * light), 0.85]);
  const flame = ramp((v) => [colorAcross(stops, v * 0.999), 1]);
  return (heat, light) => (heat < 0.12 ? at(smoke, light) : at(flame, (heat - 0.12) / 0.88));
}

// smooth noise that drifts upwards over the sequence: (x, y) in canvas pixels →
// 0..1. k: noise cells per pixel across, ky: how much taller the cells are
// (tongues), L: noise rows scrolled over the sequence. A loop cross-fades two
// copies one scroll apart, so the last frame leads back into the first; the mix
// is rescaled so it stays as contrasty mid-loop as at the ends.
export function loopNoise(c, salt, k, ky, L) {
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
export const strand = (n, p) => Math.pow(1 - Math.abs(2 * n - 1), p);

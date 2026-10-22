// Finishing steps that turn a rendered glow into pixel art (pixelateGlow) or
// flat cel-shaded colour (celShade), both on the preset's own palette.
import { createCanvas, hexToRgb } from "../../core/util.js";
import { rgba, toHex } from "./util.js";

// ---------- 像素光效 ----------
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// The palette a pixelated glow snaps to: the preset's own colours sorted dark to
// bright, with an in-between shade added between every two neighbours
export const palettes = new Map();

// colours to fall back on when a style has none (the 梦幻 preset's)
export const FALLBACK_COLORS = ["#2f5bff", "#2fd8ff", "#e8fbff", "#ff6ad5"];

export function glowPalette(st, mids = true) {
  const tc = st.tailTint > 0 && st.glowTail ? hexToRgb(st.glowTail) : null;
  const tails = tc ? [st.glowTail, toHex(tc.map((v) => Math.round(v * 0.55))), toHex(tc.map((v) => Math.round(v + (255 - v) * 0.5)))] : [];
  const src = [...(st.glowColors || FALLBACK_COLORS), st.glowRim, st.glowCore, st.glowSplat, ...tails].filter(Boolean);
  const key = src.join(",") + (mids ? "" : ":flat");
  if (palettes.has(key)) return palettes.get(key);
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const base = [];
  for (const c of src.map(hexToRgb)) if (!base.some((b) => Math.abs(b[0] - c[0]) + Math.abs(b[1] - c[1]) + Math.abs(b[2] - c[2]) < 24)) base.push(c);
  base.sort((p, q) => lum(p) - lum(q));
  const pal = [];
  base.forEach((c, i) => {
    if (i && mids) { const p = base[i - 1]; pal.push([0, 1, 2].map((j) => Math.round(Math.sqrt((p[j] * p[j] + c[j] * c[j]) / 2)))); }
    pal.push(c);
  });
  palettes.set(key, pal);
  return pal;
}

const SAT = 1.45;

// A glow trail as pixel art: the canvas renderGlow made is shrunk to blocks of
// size × size (averaging), every block snaps to the palette above, its opacity
// to 4 steps (or a dither / a hard edge), and it is blown back up with hard
// edges. The blocks sit on the document's grid, so they don't crawl as the
// trail moves. opts: { size: 1..8, alpha: "steps" | "dither" | "hard" }
export function pixelateGlow(src, st, opts = {}) {
  if (!src) return src;
  const k = Math.max(1, Math.min(8, opts.size | 0 || 1));
  const W = src.width, H = src.height;
  const bb = src.bbox || { x0: 0, y0: 0, w: W, h: H };
  const bx0 = Math.floor(bb.x0 / k) * k, by0 = Math.floor(bb.y0 / k) * k;
  const bw = Math.ceil((bb.x0 + bb.w - bx0) / k), bh = Math.ceil((bb.y0 + bb.h - by0) / k);
  if (bw <= 0 || bh <= 0) return src;
  const small = createCanvas(bw, bh), sg = small.getContext("2d", { willReadFrequently: true });
  sg.imageSmoothingEnabled = true;
  sg.imageSmoothingQuality = "high";
  sg.drawImage(src, bx0, by0, bw * k, bh * k, 0, 0, bw, bh);
  const img = sg.getImageData(0, 0, bw, bh), d = img.data;
  const pal = glowPalette(st);
  const mode = opts.alpha || "steps";
  const gx = bx0 / k, gy = by0 / k;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = (y * bw + x) * 4;
    const a = d[i + 3] / 255;
    if (a < 0.08) { d[i + 3] = 0; continue; }
    let al;
    if (mode === "hard") al = a >= 0.4 ? 1 : 0;
    else if (mode === "dither") al = a > (BAYER[((y + gy) & 3) * 4 + ((x + gx) & 3)] + 0.5) / 16 ? 1 : 0;
    else al = a < 0.2 ? 0 : Math.max(0.25, Math.round(a * 4) / 4);   // too faint to be worth a step: gone
    if (!al) { d[i + 3] = 0; continue; }
    // averaging added-up light into blocks washes it toward white: pull the
    // colour away from grey first, so it snaps to the preset's saturated
    // colours rather than its pale ones (white-hot stays white)
    const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const r = L + (d[i] - L) * SAT, g = L + (d[i + 1] - L) * SAT, b = L + (d[i + 2] - L) * SAT;
    let best = pal[0], bd = Infinity;
    for (const c of pal) {
      const dr = c[0] - r, dg = c[1] - g, db = c[2] - b;
      const dd = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (dd < bd) { bd = dd; best = c; }
    }
    d[i] = best[0]; d[i + 1] = best[1]; d[i + 2] = best[2]; d[i + 3] = Math.round(al * 255);
  }
  tidy(d, bw, bh);
  sg.putImageData(img, 0, 0);
  const out = createCanvas(W, H), og = out.getContext("2d");
  og.imageSmoothingEnabled = false;
  og.drawImage(small, 0, 0, bw, bh, bx0, by0, bw * k, bh * k);
  out.bbox = { x0: bx0, y0: by0, w: bw * k, h: bh * k };
  return out;
}

// The clean-up a pixel artist does by hand, on blocks already snapped to the
// palette (RGBA d, w×h): a faint block with nothing round it goes (a bright
// lone one stays: a glint), and a block whose colour none of its four
// neighbours share, while three or four of them agree, takes theirs — flat
// bands of colour instead of speckle.
function tidy(d, w, h) {
  const src = new Uint8ClampedArray(d);
  const col = (i) => (src[i] << 16) | (src[i + 1] << 8) | src[i + 2];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (!src[i + 3]) continue;
    let near = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h && src[((y + dy) * w + x + dx) * 4 + 3]) near++;
    }
    if (!near) { if (src[i + 3] < 190) d[i + 3] = 0; continue; }
    const own = col(i), seen = [];
    let same = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= h) continue;
      const j = ((y + dy) * w + x + dx) * 4;
      if (!src[j + 3]) continue;
      const c = col(j);
      if (c === own) { same = true; break; }
      seen.push(c);
    }
    if (same || seen.length < 3) continue;
    for (const c of seen) {
      if (seen.filter((o) => o === c).length >= 3) { d[i] = c >> 16; d[i + 1] = (c >> 8) & 255; d[i + 2] = c & 255; break; }
    }
  }
}

// 色阶: a glow trail as flat, cel-shaded 2D effect art — the same recipe as the
// pixel glows (pixelateGlow) but at full resolution with smooth edges. Every
// pixel snaps to the preset's palette (its colours plus in-between shades, and
// the tail colour's when it shifts) and its opacity to a few flat steps, so soft
// glow stays a see-through layer instead of becoming a solid lump. amount 0..1:
// how hard — 6 opacity steps at the soft end, solid-or-nothing at the hard end. outline 0..1:
// an optional dark outline around the whole shape.
export function celShade(src, st, amount, outline) {
  if (!src) return src;
  const W = src.width, H = src.height;
  const bb = src.bbox || { x0: 0, y0: 0, w: W, h: H };
  const { x0, y0, w, h } = bb;
  if (w <= 0 || h <= 0) return src;
  const c = createCanvas(w, h), g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(src, x0, y0, w, h, 0, 0, w, h);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  const steps = amount >= 0.75 ? 2 : amount >= 0.35 ? 4 : 6;
  // the hard end keeps to the preset's own colours: flat, clean layers, no muddy
  // blends between them
  const pal = glowPalette(st, steps > 2);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (a < 0.2) { d[i + 3] = 0; continue; }
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    let best = pal[0], bd = Infinity;
    for (const t of pal) {
      const dr = t[0] - r, dg = t[1] - gg, db = t[2] - b;
      const dd = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (dd < bd) { bd = dd; best = t; }
    }
    d[i] = best[0]; d[i + 1] = best[1]; d[i + 2] = best[2];
    // the hard end is solid or nothing: a half-see-through bright colour over a
    // dark background reads as a muddy brown
    if (steps <= 2 && a < 0.45) { d[i + 3] = 0; continue; }
    d[i + 3] = steps <= 2 ? 255 : Math.round(255 * Math.max(1 / steps, Math.round(a * steps) / steps));
  }
  g.putImageData(img, 0, 0);
  const out = createCanvas(W, H), og = out.getContext("2d");
  const ow = outline > 0 ? Math.max(1, Math.round(outline * Math.max(2, Math.max(w, h) / 140))) : 0;
  if (ow) {
    // the outline follows only the solid part of the shape, not the see-through glow
    const S = createCanvas(w, h), sg = S.getContext("2d");
    const solid = new ImageData(new Uint8ClampedArray(d), w, h);
    for (let i = 3; i < solid.data.length; i += 4) solid.data[i] = solid.data[i] >= 190 ? 255 : 0;
    sg.putImageData(solid, 0, 0);
    sg.globalCompositeOperation = "source-in";
    sg.fillStyle = rgba(pal[0], 1);
    sg.fillRect(0, 0, w, h);
    og.globalAlpha = 0.8;
    for (let k = 0; k < 8; k++) {
      const th = (k * Math.PI) / 4;
      og.drawImage(S, x0 + Math.cos(th) * ow, y0 + Math.sin(th) * ow);
    }
    og.globalAlpha = 1;
  }
  og.filter = "blur(0.35px)";
  og.drawImage(c, x0, y0);
  og.filter = "none";
  out.bbox = { x0: Math.max(0, x0 - ow), y0: Math.max(0, y0 - ow), w: w + ow * 2, h: h + ow * 2 };
  return out;
}

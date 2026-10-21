// High-resolution image -> pixel art at a chosen size.
//
// Unlike depixel.js there is no hidden grid to recover: the image is re-drawn on a
// new, coarse grid. Each output pixel takes ONE representative colour from the
// source cell it covers (the dominant shade by default: a plain average is what
// makes downscaled art look muddy), then the whole set of images is snapped to one
// shared palette, so every frame of an animation uses exactly the same colours.
import { PALETTES, medianCut, nearestIndexIn, rgb2hsl, hsl2rgb, colorCounts, unpackRGB } from "./color.js";
import { despeckle } from "./depixel.js";

// src ImageData -> w×h ImageData. sample: "dominant" | "average".
// alphaThr: 0..255 — a cell needs this much opacity to become an opaque pixel;
// pixel art has no partial transparency, so the result is strictly on/off.
export function downscale(src, w, h, sample, alphaThr) {
  const W = src.width, H = src.height, d = src.data;
  const out = new ImageData(w, h);
  const od = out.data;
  const buckets = new Map();
  for (let oy = 0; oy < h; oy++) {
    const y0 = Math.floor(oy * H / h), y1 = Math.max(y0 + 1, Math.floor((oy + 1) * H / h));
    for (let ox = 0; ox < w; ox++) {
      const x0 = Math.floor(ox * W / w), x1 = Math.max(x0 + 1, Math.floor((ox + 1) * W / w));
      const n = (y1 - y0) * (x1 - x0);
      const oi = (oy * w + ox) * 4;
      if (sample === "average") {
        let r = 0, g = 0, b = 0, a = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * W + x) * 4, al = d[i + 3];
            r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al;
          }
        }
        if (a / n < alphaThr || a === 0) continue;
        od[oi] = Math.round(r / a); od[oi + 1] = Math.round(g / a); od[oi + 2] = Math.round(b / a); od[oi + 3] = 255;
        continue;
      }
      // dominant: 4 bits per channel groups near-identical shades, so a textured
      // or noisy region still votes as one colour
      buckets.clear();
      let opaque = 0, best = null;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4;
          if (d[i + 3] < 128) continue;
          opaque++;
          const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
          let e = buckets.get(key);
          if (e) { e[0]++; e[1] += d[i]; e[2] += d[i + 1]; e[3] += d[i + 2]; }
          else { e = [1, d[i], d[i + 1], d[i + 2]]; buckets.set(key, e); }
          if (!best || e[0] > best[0]) best = e;
        }
      }
      if (!best || opaque * 255 < alphaThr * n) continue;
      od[oi] = Math.round(best[1] / best[0]); od[oi + 1] = Math.round(best[2] / best[0]); od[oi + 2] = Math.round(best[3] / best[0]); od[oi + 3] = 255;
    }
  }
  return out;
}

// pixel art reads flatter and more saturated than the render it came from
export function adjust(im, sat, contrast) {
  if (sat === 100 && contrast === 100) return;
  const d = im.data;
  const cache = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let c = cache.get(key);
    if (!c) {
      const hsl = rgb2hsl([d[i], d[i + 1], d[i + 2]]);
      const s = Math.min(1, hsl.s * sat / 100);
      const l = Math.min(1, Math.max(0, 0.5 + (hsl.l - 0.5) * contrast / 100));
      c = hsl2rgb(hsl.h, s, l);
      cache.set(key, c);
    }
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
  }
}

export function buildPalette(images, palette, colors) {
  if (palette && palette !== "adaptive" && PALETTES[palette]) return PALETTES[palette].colors;
  const counts = colorCounts(images);
  const entries = [...counts.entries()];
  const k = colors > 0 ? colors : 256;
  return medianCut(entries.map(([key]) => unpackRGB(key)), entries.map(([, n]) => n), k);
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function quantize(im, pal, dither) {
  const { width: w, height: h, data: d } = im;
  if (dither === "fs") {
    // Floyd–Steinberg error diffusion; transparent pixels neither take nor pass error
    const buf = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) { buf[i * 3] = d[i * 4]; buf[i * 3 + 1] = d[i * 4 + 1]; buf[i * 3 + 2] = d[i * 4 + 2]; }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!d[i * 4 + 3]) continue;
        const c = [buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]].map((v) => Math.max(0, Math.min(255, v)));
        const p = pal[nearestIndexIn(c, pal)];
        d[i * 4] = p[0]; d[i * 4 + 1] = p[1]; d[i * 4 + 2] = p[2];
        const er = [c[0] - p[0], c[1] - p[1], c[2] - p[2]];
        const spread = (dx, dy, f) => {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny >= h) return;
          const j = ny * w + nx;
          if (!d[j * 4 + 3]) return;
          buf[j * 3] += er[0] * f; buf[j * 3 + 1] += er[1] * f; buf[j * 3 + 2] += er[2] * f;
        };
        spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
      }
    }
    return;
  }
  const cache = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!d[i + 3]) continue;
      let c = [d[i], d[i + 1], d[i + 2]];
      if (dither === "bayer") {
        // ordered dither: a fixed 4×4 threshold pattern, the classic pixel-art look
        const off = (BAYER4[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 40;
        c = c.map((v) => Math.max(0, Math.min(255, v + off)));
        const p = pal[nearestIndexIn(c, pal)];
        d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2];
        continue;
      }
      const key = (c[0] << 16) | (c[1] << 8) | c[2];
      let p = cache.get(key);
      if (!p) { p = pal[nearestIndexIn(c, pal)]; cache.set(key, p); }
      d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2];
    }
  }
}

// 1px outline in the transparent pixels touching the subject (4-neighbourhood)
export function addOutline(im, color) {
  const { width: w, height: h, data: d } = im;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = d[i * 4 + 3] ? 1 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (alpha[i]) continue;
      if ((x > 0 && alpha[i - 1]) || (x < w - 1 && alpha[i + 1]) || (y > 0 && alpha[i - w]) || (y < h - 1 && alpha[i + w])) {
        d[i * 4] = color[0]; d[i * 4 + 1] = color[1]; d[i * 4 + 2] = color[2]; d[i * 4 + 3] = 255;
      }
    }
  }
}

export function outputSize(srcW, srcH, opts) {
  const w = Math.max(1, Math.min(1024, Math.round(opts.width) || 64));
  const h = opts.height > 0 ? Math.max(1, Math.min(1024, Math.round(opts.height))) : Math.max(1, Math.round(srcH * w / srcW));
  return { w, h };
}

// images: ImageData[] (all the same size) -> { outs: ImageData[], info }
// opts: { width, height (0 = keep aspect), sample, sat, contrast, alpha, palette,
//         colors, dither, despeckle, outline: "none" | "dark" | "black" }
export function pixelizeAll(images, opts) {
  const { w, h } = outputSize(images[0].width, images[0].height, opts);
  const outs = images.map((im) => {
    const o = downscale(im, w, h, opts.sample || "dominant", opts.alpha ?? 128);
    adjust(o, opts.sat ?? 100, opts.contrast ?? 100);
    return o;
  });
  const pal = buildPalette(outs, opts.palette, Number(opts.colors) || 0);
  let specks = 0;
  for (const o of outs) {
    quantize(o, pal, opts.dither || "none");
    specks += despeckle(o, Number(opts.despeckle) || 0);
  }
  if (opts.outline && opts.outline !== "none") {
    let dark = [0, 0, 0];
    if (opts.outline === "dark") {
      // the palette's darkest colour keeps the outline inside the palette
      let best = Infinity;
      for (const c of pal) { const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; if (l < best) { best = l; dark = c; } }
    }
    for (const o of outs) addOutline(o, dark);
  }
  return {
    outs,
    info: { w, h, srcW: images[0].width, srcH: images[0].height, colors: colorCounts(outs).size, palette: pal.length, specks },
  };
}

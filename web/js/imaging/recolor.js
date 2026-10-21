// Recolouring a whole sequence.
//
// Layer 1 maps every colour onto a 64-colour target (fixed Resurrect 64, or an
// adaptive palette of the sequence itself). Layer 2 shifts hue / saturation /
// lightness / contrast inside a selection.
//
// The selection is FRAME-LOCAL: one w×h mask painted once and applied at the same
// position in every frame, so painting a sleeve on frame 1 recolours that sleeve
// across the whole animation. Each mask cell is tri-state — 0 untouched, 1 painted
// in, 2 erased out — so the magic wand (which selects by colour across all frames)
// and the eraser can be combined: an erased cell stays out even if its colour is
// wand-selected.
import { rgb2hsl, hsl2rgb, packRGB, unpackRGB, colorCounts, medianCut, nearestIn, RESURRECT_64 } from "./color.js";
import { hexToRgb } from "../core/util.js";

export function transformColor(c, meanL, s) {
  const hsl = rgb2hsl(c);
  const sat2 = Math.min(1, Math.max(0, hsl.s * (s.sat / 100)));
  const l2 = Math.min(1, Math.max(0, meanL + (hsl.l - meanL) * (s.contrast / 100) + s.lit / 100));
  return hsl2rgb(hsl.h + s.hue, sat2, l2);
}

export const isIdentityAdjust = (s) => !s.hue && s.sat === 100 && !s.lit && s.contrast === 100;

// run-length encoding for masks stored in the document: [w, h, value, count, ...]
export function encodeMask(mask, w, h) {
  const out = [w, h];
  let v = mask[0], n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === v) { n++; continue; }
    out.push(v, n);
    v = mask[i]; n = 1;
  }
  out.push(v, n);
  return out;
}

export function decodeMask(enc) {
  if (!Array.isArray(enc) || enc.length < 4) return null;
  const w = enc[0], h = enc[1];
  const mask = new Uint8Array(w * h);
  let p = 0;
  for (let i = 2; i + 1 < enc.length; i += 2) {
    const v = enc[i], n = enc[i + 1];
    if (v) mask.fill(v, p, Math.min(mask.length, p + n));
    p += n;
  }
  return { w, h, mask };
}

export function maskIsEmpty(m) {
  return !m || !m.mask.some((v) => v === 1);
}

// Build the layer-1 colour map for a list of ImageData
export function buildConvertMap(images, mode) {
  if (mode !== "resurrect" && mode !== "adaptive") return null;
  const counts = colorCounts(images);
  if (mode === "adaptive" && counts.size <= 64) return null;
  const entries = [...counts.entries()];
  const colors = entries.map(([k]) => unpackRGB(k));
  const target = mode === "resurrect" ? RESURRECT_64 : medianCut(colors, entries.map(([, n]) => n), 64);
  const map = new Map();
  for (let i = 0; i < entries.length; i++) map.set(entries[i][0], nearestIn(colors[i], target));
  return map;
}

// images: ImageData[] (modified in place). srcImages: the pre-convert colours the
// wand matches against (same dimensions). params: { mask, wand, hue, sat, lit, contrast }
// returns { selected } — pixels inside the selection in the first frame
export function applyRecolor(images, srcImages, convertMap, params) {
  if (convertMap) {
    for (const im of images) {
      const d = im.data, n = im.width * im.height;
      for (let i = 0; i < n; i++) {
        if (d[i * 4 + 3] < 8) continue;
        const m = convertMap.get(packRGB(d, i * 4));
        if (m) { d[i * 4] = m[0]; d[i * 4 + 1] = m[1]; d[i * 4 + 2] = m[2]; }
      }
    }
  }

  const s = { hue: params.hue || 0, sat: params.sat ?? 100, lit: params.lit || 0, contrast: params.contrast ?? 100 };
  const w = images[0].width, h = images[0].height;
  const m = decodeMask(params.mask);
  const mask = m && m.w === w && m.h === h ? m.mask : null;
  const wand = new Set((params.wand || []).map((hx) => {
    const c = hexToRgb(hx);
    return ((c[0] << 16) | (c[1] << 8) | c[2]) >>> 0;
  }));
  if (!mask && !wand.size) return { selected: 0, maskMismatch: !!m };

  const inSel = (fi, i) => {
    const mv = mask ? mask[i] : 0;
    if (mv === 1) return true;
    if (mv === 2 || !wand.size) return false;
    return wand.has(packRGB(srcImages[fi].data, i * 4));
  };

  // the selection per frame, computed once: used for both the mean and the apply
  const sel = images.map((im, fi) => {
    const out = new Uint8Array(w * h);
    const d = im.data;
    for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] >= 8 && inSel(fi, i)) out[i] = 1;
    return out;
  });
  let selected = 0;
  for (let i = 0; i < w * h; i++) selected += sel[0][i];
  const selections = sel;

  if (!isIdentityAdjust(s)) {
    // contrast spreads around the selection's mean lightness across ALL frames, so
    // every frame of the animation gets the same adjustment
    let sumL = 0, cnt = 0;
    images.forEach((im, fi) => {
      const d = im.data;
      for (let i = 0; i < w * h; i++) {
        if (!sel[fi][i]) continue;
        sumL += rgb2hsl([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]).l; cnt++;
      }
    });
    const meanL = cnt ? sumL / cnt : 0.5;
    images.forEach((im, fi) => {
      const d = im.data;
      for (let i = 0; i < w * h; i++) {
        if (!sel[fi][i]) continue;
        const nc = transformColor([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]], meanL, s);
        d[i * 4] = nc[0]; d[i * 4 + 1] = nc[1]; d[i * 4 + 2] = nc[2];
      }
    });
  }
  return { selected, selections };
}

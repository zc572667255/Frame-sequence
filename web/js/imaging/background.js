// Background removal by sampled colours.
import { colorDist } from "./color.js";

// colorDist is redmean-weighted and squared; /10 puts it back on a roughly 0-255
// scale so the tolerance slider reads like an ordinary colour difference
export function bgDist(a, b) { return Math.sqrt(colorDist(a, b) / 10); }

// Which pixels count as background. Decisions are cached per distinct colour —
// a 1000x1000 sheet holds far fewer distinct colours than pixels, so this turns
// millions of distance tests into a few thousand.
export function buildBgMask(data, w, h, samples, tol, connectedOnly) {
  const n = w * h;
  const match = new Uint8Array(n);
  const cache = new Map();
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 8) continue; // already transparent
    const k = ((data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2]) >>> 0;
    let v = cache.get(k);
    if (v === undefined) {
      const c = [(k >> 16) & 255, (k >> 8) & 255, k & 255];
      v = 0;
      for (const s of samples) if (bgDist(c, s) <= tol) { v = 1; break; }
      cache.set(k, v);
    }
    match[i] = v;
  }
  if (!connectedOnly) return match;

  // keep only what the background can actually reach from the border, so a
  // same-coloured patch enclosed by the character isn't punched out
  const keep = new Uint8Array(n);
  const stack = new Int32Array(n); // each pixel is pushed at most once
  let sp = 0;
  const push = (i) => { if (match[i] && !keep[i]) { keep[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  return keep;
}

// returns a new ImageData with matched pixels cleared, plus counts for the readout
export function removeBackground(src, samples, tol, connectedOnly) {
  const w = src.width, h = src.height;
  const out = new ImageData(new Uint8ClampedArray(src.data), w, h);
  const mask = buildBgMask(out.data, w, h, samples, tol, connectedOnly);
  let cleared = 0, opaque = 0;
  for (let i = 0, n = w * h; i < n; i++) {
    if (mask[i]) { out.data[i * 4 + 3] = 0; cleared++; }
    else if (out.data[i * 4 + 3] >= 8) opaque++;
  }
  return { out, cleared, opaque };
}

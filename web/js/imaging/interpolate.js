// Frame interpolation (补帧) by motion estimation.
//
// Between two frames A and B, every small block of A is searched for in B
// (and every block of B in A) to estimate how the picture moves. The search runs
// coarse to fine on a pyramid of shrunken copies, so big moves are found on the
// small images and refined on the larger ones; alpha counts as much as colour,
// which suits sprites on transparency. Blocks with nothing in them take their
// motion from their neighbours and a median filter throws out stray vectors.
//
// An in-between frame at time t (0 = A, 1 = B) is then made pixel by pixel: where
// that pixel came from in A (going back t of the way along the motion) and in B
// (going forward the rest), both sampled and mixed by how close t is to each.
// Motion is estimated on frames scaled to at most WORK pixels across, and the
// in-betweens are made at full size.
import { createCanvas } from "../core/util.js";

const WORK = 256;          // flow is estimated on frames scaled down to at most this size
// block size, at every pyramid level: 4 for small sprites (limbs and weapons
// only a few pixels wide), 8 otherwise. Set by preparePair for the pair it works on.
let BS = 8;

// premultiplied RGBA (alpha weighted up: the silhouette matters most) of a
// canvas drawn at w×h
function workImage(canvas, w, h) {
  const c = createCanvas(w, h), g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(canvas, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, out = new Float32Array(w * h * 4);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    out[i] = d[i] * a; out[i + 1] = d[i + 1] * a; out[i + 2] = d[i + 2] * a; out[i + 3] = d[i + 3] * 1.5;
  }
  return { d: out, w, h };
}

// half size, 2×2 averages
function down(img) {
  const w = Math.max(1, img.w >> 1), h = Math.max(1, img.h >> 1), d = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    for (let k = 0; k < 4; k++) {
      const at = (xx, yy) => img.d[(Math.min(img.h - 1, yy) * img.w + Math.min(img.w - 1, xx)) * 4 + k];
      d[(y * w + x) * 4 + k] = (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) / 4;
    }
  }
  return { d, w, h };
}

// block flow from A to B on one level. pred(bx, by) -> [dx, dy] guess from the
// coarser level; R: search radius around it
function blockFlow(A, B, pred, R) {
  const bw = Math.ceil(A.w / BS), bh = Math.ceil(A.h / BS);
  const fx = new Float32Array(bw * bh), fy = new Float32Array(bw * bh), ok = new Uint8Array(bw * bh);
  const { w, h } = A;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const x0 = bx * BS, y0 = by * BS, x1 = Math.min(w, x0 + BS), y1 = Math.min(h, y0 + BS);
    let mass = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mass += A.d[(y * w + x) * 4 + 3];
    const [px, py] = pred(bx, by);
    const b = by * bw + bx;
    if (mass < 40 * (x1 - x0) * (y1 - y0) / 64) { fx[b] = px; fy[b] = py; continue; }     // nothing to follow
    let best = Infinity, bdx = px, bdy = py;
    for (let dy = Math.round(py) - R; dy <= Math.round(py) + R; dy++) for (let dx = Math.round(px) - R; dx <= Math.round(px) + R; dx++) {
      let cost = Math.hypot(dx, dy) * 6 * (x1 - x0) * (y1 - y0) / 64;   // a nudge toward small moves
      for (let y = y0; y < y1 && cost < best; y++) {
        const yy = y + dy;
        for (let x = x0; x < x1; x++) {
          const xx = x + dx, i = (y * w + x) * 4;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) { cost += A.d[i + 3] + 255; continue; }
          const j = (yy * w + xx) * 4;
          cost += Math.abs(A.d[i] - B.d[j]) + Math.abs(A.d[i + 1] - B.d[j + 1]) + Math.abs(A.d[i + 2] - B.d[j + 2]) + Math.abs(A.d[i + 3] - B.d[j + 3]);
        }
      }
      if (cost < best) { best = cost; bdx = dx; bdy = dy; }
    }
    fx[b] = bdx; fy[b] = bdy; ok[b] = 1;
  }
  return { fx, fy, ok, bw, bh };
}

// empty blocks take the average of found neighbours (spreading outward), then a
// 3×3 median on each component throws out stray vectors
function tidy(F) {
  const { bw, bh } = F;
  const ok = F.ok.slice();
  for (let pass = 0; pass < bw + bh; pass++) {
    let changed = false;
    const nok = ok.slice();
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const b = y * bw + x;
      if (ok[b]) continue;
      let sx = 0, sy = 0, n = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const xx = x + i, yy = y + j;
        if (xx < 0 || yy < 0 || xx >= bw || yy >= bh || !ok[yy * bw + xx]) continue;
        sx += F.fx[yy * bw + xx]; sy += F.fy[yy * bw + xx]; n++;
      }
      if (n) { F.fx[b] = sx / n; F.fy[b] = sy / n; nok[b] = 1; changed = true; }
    }
    ok.set(nok);
    if (!changed) break;
  }
  for (const key of ["fx", "fy"]) {
    const src = F[key], out = new Float32Array(src.length);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const v = [];
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const xx = Math.max(0, Math.min(bw - 1, x + i)), yy = Math.max(0, Math.min(bh - 1, y + j));
        v.push(src[yy * bw + xx]);
      }
      v.sort((a, b) => a - b);
      out[y * bw + x] = v[4];
    }
    F[key] = out;
  }
  return F;
}

// flow from A to B over a pyramid; reach: how far things may move, as a share
// of the frame's larger side — the search radius on the smallest level is set
// so that it covers that much
function pyramidFlow(A, B, reach) {
  const pa = [A], pb = [B];
  while (pa.length < 6 && Math.min(pa[pa.length - 1].w, pa[pa.length - 1].h) >= 24) { pa.push(down(pa[pa.length - 1])); pb.push(down(pb[pb.length - 1])); }
  const R0 = Math.max(2, Math.ceil((reach * Math.max(A.w, A.h)) / (1 << (pa.length - 1))));
  let F = null;
  for (let l = pa.length - 1; l >= 0; l--) {
    const prev = F;
    const pred = prev
      ? (bx, by) => { const x = Math.min(prev.bw - 1, bx >> 1), y = Math.min(prev.bh - 1, by >> 1); return [prev.fx[y * prev.bw + x] * 2, prev.fy[y * prev.bw + x] * 2]; }
      : () => [0, 0];
    F = tidy(blockFlow(pa[l], pb[l], pred, prev ? 2 : R0));
  }
  return F;
}

// the flow at a point (work pixels), bilinear between block centres
function flowAt(F, x, y) {
  const gx = Math.max(0, Math.min(F.bw - 1, x / BS - 0.5)), gy = Math.max(0, Math.min(F.bh - 1, y / BS - 0.5));
  const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(F.bw - 1, x0 + 1), y1 = Math.min(F.bh - 1, y0 + 1);
  const tx = gx - x0, ty = gy - y0;
  const v = (a) => {
    const p = a[y0 * F.bw + x0], q = a[y0 * F.bw + x1], r = a[y1 * F.bw + x0], s = a[y1 * F.bw + x1];
    return (p * (1 - tx) + q * tx) * (1 - ty) + (r * (1 - tx) + s * tx) * ty;
  };
  return [v(F.fx), v(F.fy)];
}

// bilinear sample of premultiplied RGBA (full size, Uint8 data) at a float spot;
// outside the frame is transparent
function sample(d, w, h, x, y, out) {
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  out[0] = out[1] = out[2] = out[3] = 0;
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const xx = x0 + i, yy = y0 + j;
    if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
    const wgt = (i ? tx : 1 - tx) * (j ? ty : 1 - ty), k = (yy * w + xx) * 4, a = d[k + 3] / 255;
    out[0] += d[k] * a * wgt; out[1] += d[k + 1] * a * wgt; out[2] += d[k + 2] * a * wgt; out[3] += d[k + 3] * wgt;
  }
}

// Get everything needed to make in-betweens of frames a and b (canvases of the
// same size w×h). range: "small" | "medium" | "large" — how far things may move.
export function preparePair(a, b, w, h, range = "medium") {
  BS = Math.max(w, h) <= 128 ? 4 : 8;
  const k = Math.min(1, WORK / Math.max(w, h));
  const ww = Math.max(8, Math.round(w * k)), wh = Math.max(8, Math.round(h * k));
  const A = workImage(a, ww, wh), B = workImage(b, ww, wh);
  const reach = range === "small" ? 0.1 : range === "large" ? 0.45 : 0.25;
  const da = a.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const db = b.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  // the flows for every pixel at full size, so making an in-between is lookups
  const dense = (F) => {
    const x = new Float32Array(w * h), y = new Float32Array(w * h);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const f = flowAt(F, xx * k, yy * k);
      x[yy * w + xx] = f[0] / k; y[yy * w + xx] = f[1] / k;
    }
    return { x, y };
  };
  // only the part that has anything in either frame can get anything
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (const d of [da, db]) for (let i = 3; i < d.length; i += 4) {
    if (!d[i]) continue;
    const p = (i - 3) >> 2, x = p % w, y = (p / w) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { w, h, da, db, AB: dense(pyramidFlow(A, B, reach)), BA: dense(pyramidFlow(B, A, reach)), box: x1 < 0 ? null : [x0, y0, x1, y1] };
}

// colours the two frames use, for snapping pixel art back to them
function paletteOf(da, db) {
  const count = new Map();
  for (const d of [da, db]) for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    count.set(key, (count.get(key) || 0) + 1);
  }
  return [...count.entries()].sort((p, q) => q[1] - p[1]).slice(0, 96).map(([c]) => [c >> 16, (c >> 8) & 255, c & 255]);
}

// One in-between frame at time t (0..1) of a prepared pair. keepPixel: pixel
// art — no partial alpha, colours snapped to the ones the two frames use.
export function inbetween(P, t, keepPixel = false) {
  const { w, h, da, db, AB, BA, box } = P;
  const out = new ImageData(w, h), o = out.data;
  const c = createCanvas(w, h);
  if (!box) return c;
  const sa = [0, 0, 0, 0], sb = [0, 0, 0, 0];
  const pal = keepPixel ? paletteOf(da, db) : null;
  const at = (F, x, y) => { const xi = Math.max(0, Math.min(w - 1, Math.round(x))), yi = Math.max(0, Math.min(h - 1, Math.round(y))); return yi * w + xi; };
  for (let y = box[1]; y <= box[3]; y++) for (let x = box[0]; x <= box[2]; x++) {
    // where this pixel was in A: step back t of the way along A->B's motion,
    // a few times, since the motion is known at the source and not here
    let qx = x, qy = y, rx = x, ry = y;
    for (let it = 0; it < 3; it++) {
      const ia = at(AB, qx, qy);
      qx = x - t * AB.x[ia]; qy = y - t * AB.y[ia];
      const ib = at(BA, rx, ry);
      rx = x - (1 - t) * BA.x[ib]; ry = y - (1 - t) * BA.y[ib];
    }
    sample(da, w, h, qx, qy, sa);
    sample(db, w, h, rx, ry, sb);
    let wa = 1 - t, wb = t;
    // something only one side has (it is coming into or going out of view):
    // lean on that side rather than leaving a half-faded ghost
    if (sa[3] > 8 && sb[3] < 8) { wa = 1; wb = 0; } else if (sb[3] > 8 && sa[3] < 8) { wa = 0; wb = 1; }
    const A = wa * sa[3] + wb * sb[3];
    const i = (y * w + x) * 4;
    if (A < 1) continue;
    let r = (wa * sa[0] + wb * sb[0]) * 255 / A, g = (wa * sa[1] + wb * sb[1]) * 255 / A, b = (wa * sa[2] + wb * sb[2]) * 255 / A;
    let a = A;
    if (pal) {
      if (a < 128) continue;
      a = 255;
      let best = pal[0], bd = Infinity;
      for (const c of pal) { const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2; if (d < bd) { bd = d; best = c; } }
      [r, g, b] = best;
    }
    o[i] = r; o[i + 1] = g; o[i + 2] = b; o[i + 3] = a;
  }
  c.getContext("2d").putImageData(out, 0, 0);
  return c;
}

// the plain cross-fade, for comparison or for effects that barely move
export function crossfade(a, b, w, h, t) {
  const c = createCanvas(w, h), g = c.getContext("2d");
  g.globalAlpha = 1 - t;
  g.drawImage(a, 0, 0);
  g.globalAlpha = t;
  g.drawImage(b, 0, 0);
  return c;
}

// Perfect pixel: de-pixelate an AI "pixel art" render back to a clean grid.
//
// An AI-generated pixel-art image isn't on a grid: one logical pixel covers some
// non-integer number of real pixels, the first grid line starts at an arbitrary
// offset, and every block edge is anti-aliased. Two steps recover the true grid:
//
//   detectPeriod() — the column/row "change energy" profile of such an image is a
//     comb whose teeth sit on block boundaries. An FFT finds candidate periods;
//     a few direct DFT samples refine their frequency and phase.
//   resample()     — each cell collapses to the MODE of its interior colours, with
//     the cell edges inset to throw away the anti-aliased rim. Taking the mean
//     instead is what makes naive downscalers produce mud.
import { countColors, reduceColors, snapToPalette, RESURRECT_64 } from "./color.js";

// mean absolute channel change between neighbouring columns (axis 0) / rows (axis 1)
export function edgeProfile(data, w, h, axis) {
  const n = axis === 0 ? w : h;
  const prof = new Float64Array(n);
  if (axis === 0) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 1; x < w; x++) {
        const i = (row + x) * 4, j = i - 4;
        prof[x] += Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1])
                 + Math.abs(data[i + 2] - data[j + 2]) + Math.abs(data[i + 3] - data[j + 3]);
      }
    }
    for (let x = 0; x < n; x++) prof[x] /= h;
  } else {
    for (let y = 1; y < h; y++) {
      const row = y * w, prev = row - w;
      let s = 0;
      for (let x = 0; x < w; x++) {
        const i = (row + x) * 4, j = (prev + x) * 4;
        s += Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1])
           + Math.abs(data[i + 2] - data[j + 2]) + Math.abs(data[i + 3] - data[j + 3]);
      }
      prof[y] = s / w;
    }
  }
  return prof;
}

// profile with its DC level removed — without this the DFT leaks the (large,
// strictly positive) mean into long-period bins and every big period scores high
export function centerProfile(prof) {
  let sum = 0;
  for (let i = 0; i < prof.length; i++) sum += prof[i];
  if (sum <= 1e-9) return null;
  const mean = sum / prof.length;
  const out = new Float64Array(prof.length);
  for (let i = 0; i < prof.length; i++) out[i] = prof[i] - mean;
  return { arr: out, total: sum, raw: prof };
}

// How comb-like the profile really is at period p: fold every column into one
// cell and compare the brightest band against the rest. ~1 means the colour
// changes ignore this period; 5+ means they sit squarely on its grid lines.
//
// This is what the DFT magnitude alone can't tell us. Slow variation in how busy
// the artwork is leaks real energy into long periods, so the DFT's global peak is
// often nowhere near the true block size — but those long periods score ~1 here.
// It also cleanly rejects MULTIPLES of the true period (2p folds the real grid
// lines into two bands, one of which pollutes the background), while SUBmultiples
// (p/2, p/3) keep scoring high — which is exactly why the caller, having filtered
// on this score, then takes the LARGEST surviving period.
export function combScore(raw, p) {
  const n = raw.length;
  // Never use more bins than the period is wide. Columns are integers, so a
  // 2px period with 4 bins leaves half of them permanently empty — those zeros
  // drag the background down and inflate the score of exactly the submultiples
  // this function exists to reject.
  const B = Math.max(2, Math.min(48, Math.floor(p)));
  // Below four bins there is one background bin to compare against and the integer
  // columns fold into it very unevenly, so the ratio is noise — and it reads HIGH,
  // which would let a submultiple outrank the true period. Report "can't tell"
  // and let the DFT magnitude decide these on its own.
  if (B < 4) return 1;
  const sum = new Float64Array(B), cnt = new Float64Array(B);
  for (let x = 0; x < n; x++) {
    let j = Math.floor((x % p) / p * B);
    if (j < 0) j = 0; else if (j >= B) j = B - 1;
    sum[j] += raw[x]; cnt[j]++;
  }
  const avg = new Float64Array(B);
  for (let j = 0; j < B; j++) avg[j] = cnt[j] ? sum[j] / cnt[j] : -1;
  let jb = 0;
  for (let j = 1; j < B; j++) if (avg[j] > avg[jb]) jb = j;
  if (avg[jb] <= 0) return 1;
  // the anti-aliased rim spills into a neighbour, so on anything but a very
  // narrow fold the band is two bins wide
  let jn = -1;
  if (B > 6) {
    const jl = (jb + B - 1) % B, jr = (jb + 1) % B;
    jn = avg[jl] >= avg[jr] ? jl : jr;
  }
  let on = avg[jb], onN = 1, off = 0, offN = 0;
  if (jn >= 0 && avg[jn] >= 0) { on += avg[jn]; onN++; }
  for (let j = 0; j < B; j++) {
    if (j === jb || j === jn || avg[j] < 0) continue;
    off += avg[j]; offN++;
  }
  if (!offN || off <= 1e-9) return 1;
  return (on / onN) / (off / offN);
}

// single DFT bin at period p. Uses an incremental rotor rather than two trig calls
// per sample; double precision drift over a few thousand steps is ~1e-13.
export function dftBin(ctr, p) {
  const arr = ctr.arr, n = arr.length;
  const t = -2 * Math.PI / p;
  const cs = Math.cos(t), sn = Math.sin(t);
  let cr = 1, ci = 0, re = 0, im = 0;
  for (let x = 0; x < n; x++) {
    const v = arr[x];
    re += v * cr; im += v * ci;
    const nr = cr * cs - ci * sn;
    ci = cr * sn + ci * cs;
    cr = nr;
  }
  // teeth at x = phase + k*p give arg(X) = -2*pi*phase/p, hence the negated im
  let phase = p * Math.atan2(-im, re) / (2 * Math.PI);
  phase = ((phase % p) + p) % p;
  return { p, r: Math.hypot(re, im) / ctr.total, phase };
}

// Radix-2 FFT of a zero-padded edge profile. Padding to at least twice its
// length samples each spectral peak at half-bin spacing; the much smaller
// direct-DFT refinement below handles the remaining sub-bin precision.
function fftProfile(ctr) {
  const n = ctr.arr.length;
  let size = 1;
  while (size < n * 2) size *= 2;
  const re = new Float64Array(size), im = new Float64Array(size);
  re.set(ctr.arr);

  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      const tmp = re[i]; re[i] = re[j]; re[j] = tmp;
    }
  }
  for (let len = 2; len <= size; len *= 2) {
    const half = len >> 1, angle = -2 * Math.PI / len;
    const stepR = Math.cos(angle), stepI = Math.sin(angle);
    for (let start = 0; start < size; start += len) {
      let wr = 1, wi = 0;
      for (let j = 0; j < half; j++) {
        const a = start + j, b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nextR = wr * stepR - wi * stepI;
        wi = wr * stepI + wi * stepR;
        wr = nextR;
      }
    }
  }
  return { re, im, size };
}

export const DP_MIN_PERIOD = 1.8;

// sharpen a candidate period until the accumulated drift across the whole image
// is well under one cell — a period that is 1% off smears the grid by dozens of
// pixels over a few hundred cells, which is the difference between crisp and mush
function refinePeriod(ctr, p0, half) {
  let pick = dftBin(ctr, p0);
  for (let pass = 0; pass < 3; pass++) {
    const sub = half / 8;
    let best = pick;
    for (let p = pick.p - half; p <= pick.p + half + 1e-12; p += sub) {
      if (p < DP_MIN_PERIOD) continue;
      const c = dftBin(ctr, p);
      if (c.r > best.r) best = c;
    }
    pick = best;
    half = sub;
  }
  return pick;
}

export function detectPeriod(ctr, maxPeriod) {
  const n = ctr.arr.length;
  const pMax = Math.min(maxPeriod, n / 6);
  if (pMax <= DP_MIN_PERIOD) return null;

  // The FFT replaces the former O(n * candidates) direct-DFT sweep. Its bins
  // are uniformly spaced in frequency, so narrow peaks remain visible even
  // for large block periods.
  const { re, im, size } = fftProfile(ctr);
  const cands = [];
  const kLo = Math.ceil(size / pMax), kHi = Math.floor(size / DP_MIN_PERIOD);
  for (let k = kLo; k <= kHi; k++) {
    const p = size / k;
    let phase = p * Math.atan2(-im[k], re[k]) / (2 * Math.PI);
    phase = ((phase % p) + p) % p;
    cands.push({ p, r: Math.hypot(re[k], im[k]) / ctr.total, phase });
  }
  if (cands.length < 3) return null;

  let best = cands[0];
  for (const c of cands) if (c.r > best.r) best = c;

  const peaks = [];
  for (let i = 1; i < cands.length - 1; i++) {
    const c = cands[i];
    if (c.r >= best.r * 0.25 && c.r >= cands[i - 1].r && c.r >= cands[i + 1].r) peaks.push(c);
  }
  if (!peaks.length) peaks.push(best);
  peaks.sort((a, b) => b.r - a.r);

  const tries = peaks.slice(0, 20).map((c) => c.p);
  // for a razor-sharp comb every harmonic has equal magnitude, so the fundamental
  // may not be a peak the sweep ranked highly — probe the multiples explicitly
  for (const c of peaks.slice(0, 6)) for (const k of [2, 3]) {
    if (c.p * k <= pMax) tries.push(c.p * k);
  }

  let bestScored = null;
  const scored = [];
  for (const p0 of tries) {
    const ref = refinePeriod(ctr, p0, p0 * p0 / size * 1.5);
    ref.score = combScore(ctr.raw, ref.p);
    scored.push(ref);
    if (!bestScored || ref.score > bestScored.score) bestScored = ref;
  }
  if (!bestScored) return null;

  // Every valid grid for this image is the true period divided by some integer, so
  // the answer is the LONGEST period that is still valid. Validity takes two
  // different measurements because neither one alone is sufficient:
  //
  //  1. comb score rejects unrelated periods. The artwork's own busyness varies
  //     slowly across the image, which leaks real energy into long periods and is
  //     what makes the raw DFT peak land nowhere near the block size. Those score
  //     ~1 here, because the colour changes don't sit on their grid lines.
  //  2. DFT magnitude rejects MULTIPLES of the true period, collapsing by one to
  //     two orders of magnitude at 2p and 3p (half their grid lines fall mid-cell,
  //     where nothing changes). The comb score cannot see this — on a large sharp
  //     block it puts 2p within half a percent of p.
  //
  // What survives both is the true period together with its submultiples, which
  // stay strong on both measures since folding at p/2 keeps every real grid line
  // aligned. The longest of those is the fundamental.
  let bestScore = 0;
  for (const c of scored) if (c.score > bestScore) bestScore = c.score;
  let valid = scored.filter((c) => c.score >= Math.max(bestScore * 0.8, 1.12));
  if (!valid.length) valid = scored;

  let bestR = 0;
  for (const c of valid) if (c.r > bestR) bestR = c.r;
  let pick = null;
  for (const c of valid) {
    if (c.r >= bestR * 0.6 && (!pick || c.p > pick.p)) pick = c;
  }
  return pick || bestScored;
}

// grid lines at phase + k*p, clipped to [0, len]; a leading/trailing sliver
// becomes its own pixel only if it covers more than half a cell; otherwise it is
// absorbed by its neighbour rather than turning into a smeared extra row or column
export function cellEdges(len, p, phase) {
  let first = phase % p;
  if (first < 0) first += p;
  const list = [];
  for (let e = first; e < len - 1e-6; e += p) list.push(e);
  if (!list.length) return [0, len];
  if (list[0] > 0.5 * p) list.unshift(0); else list[0] = 0;
  if (len - list[list.length - 1] > 0.5 * p) list.push(len);
  else list[list.length - 1] = len;
  return list.length >= 2 ? list : [0, len];
}

// whole source pixels strictly inside the cell, minus an anti-aliasing margin
function insetRange(a, b, len) {
  const inset = Math.min((b - a) * 0.28, 1.25);
  let s = Math.ceil(a + inset - 1e-6);
  let e = Math.floor(b - inset + 1e-6);
  if (e <= s) { s = Math.floor((a + b) / 2); e = s + 1; } // cell too thin to inset
  s = Math.max(0, Math.min(len - 1, s));
  e = Math.max(s + 1, Math.min(len, e));
  return [s, e];
}

export function resample(srcData, w, h, ex, ey) {
  const outW = ex.length - 1, outH = ey.length - 1;
  const out = new ImageData(outW, outH);
  const od = out.data;
  const buckets = new Map();
  const xr = [];
  for (let cx = 0; cx < outW; cx++) xr.push(insetRange(ex[cx], ex[cx + 1], w));
  for (let cy = 0; cy < outH; cy++) {
    const [y0, y1] = insetRange(ey[cy], ey[cy + 1], h);
    for (let cx = 0; cx < outW; cx++) {
      const x0 = xr[cx][0], x1 = xr[cx][1];
      buckets.clear();
      let total = 0, opaque = 0, bestN = 0, bestBucket = null;
      for (let y = y0; y < y1; y++) {
        const row = y * w;
        for (let x = x0; x < x1; x++) {
          const i = (row + x) * 4;
          total++;
          if (srcData[i + 3] < 128) continue;
          opaque++;
          const r = srcData[i], g = srcData[i + 1], b = srcData[i + 2];
          // 5 bits per channel: near-identical shades from the render's gradients
          // land in one bucket, genuinely different colours stay apart
          const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
          let e = buckets.get(key);
          if (e) { e[0]++; e[1] += r; e[2] += g; e[3] += b; }
          else { e = [1, r, g, b]; buckets.set(key, e); }
          if (e[0] > bestN) { bestN = e[0]; bestBucket = e; }
        }
      }
      const oi = (cy * outW + cx) * 4;
      if (!bestBucket || opaque * 2 < total) { od[oi + 3] = 0; continue; }
      od[oi] = Math.round(bestBucket[1] / bestBucket[0]);
      od[oi + 1] = Math.round(bestBucket[2] / bestBucket[0]);
      od[oi + 2] = Math.round(bestBucket[3] / bestBucket[0]);
      od[oi + 3] = 255;
    }
  }
  return out;
}

// Speckle removal, run AFTER quantization so "same colour" is an exact test.
// A pixel whose colour almost nothing around it shares is noise from the render,
// not art, so it takes the most common colour among its neighbours. Reads from a
// snapshot so one replacement can't cascade into the next.
// strength 1 clears only fully isolated pixels; 2 also clears pairs, which bites
// into genuine 1px detail like outlines and dithering — hence the choice.
export function despeckle(imageData, strength) {
  if (!strength) return 0;
  const w = imageData.width, h = imageData.height, d = imageData.data;
  const src = new Uint8ClampedArray(d);
  const minKeep = strength >= 2 ? 2 : 1;
  const key = (i) => src[i * 4 + 3] < 8 ? -1
    : ((src[i * 4] << 16) | (src[i * 4 + 1] << 8) | src[i * 4 + 2]) >>> 0;
  let changed = 0;
  const tally = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const me = key(i);
      if (me < 0) continue; // transparent pixels are shape, not noise
      tally.clear();
      let same = 0, bestK = -1, bestN = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = key(ny * w + nx);
          if (k < 0) continue;
          if (k === me) { same++; continue; }
          const n = (tally.get(k) || 0) + 1;
          tally.set(k, n);
          if (n > bestN) { bestN = n; bestK = k; }
        }
      }
      if (same >= minKeep || bestK < 0 || bestN < 2) continue;
      d[i * 4] = (bestK >> 16) & 255;
      d[i * 4 + 1] = (bestK >> 8) & 255;
      d[i * 4 + 2] = bestK & 255;
      changed++;
    }
  }
  return changed;
}

// integer, gap-free source spans for the cell edges: every source pixel belongs to
// exactly one cell, which is what makes the repainted blocks hard-edged
function edgeToInt(edges, len) {
  const b = new Int32Array(edges.length);
  for (let i = 0; i < edges.length; i++) b[i] = Math.round(edges[i]);
  b[0] = 0;
  b[b.length - 1] = len;
  for (let i = 1; i < b.length; i++) if (b[i] < b[i - 1]) b[i] = b[i - 1];
  return b;
}

// Paint each cell's single colour back over the exact source pixels it came from.
// The sheet keeps its original dimensions — so frame size, slice grid and every
// downstream setting stay valid — while each block becomes one flat colour with a
// hard edge, i.e. a genuine pixel point that merely happens to be drawn large.
export function expandCells(cells, ex, ey, w, h) {
  const bx = edgeToInt(ex, w), by = edgeToInt(ey, h);
  const out = new ImageData(w, h);
  const od = out.data, cd = cells.data, cw = cells.width;
  for (let cy = 0; cy < cells.height; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const s = (cy * cw + cx) * 4;
      const r = cd[s], g = cd[s + 1], b = cd[s + 2], a = cd[s + 3];
      for (let y = by[cy]; y < by[cy + 1]; y++) {
        let d = (y * w + bx[cx]) * 4;
        for (let x = bx[cx]; x < bx[cx + 1]; x++) {
          od[d] = r; od[d + 1] = g; od[d + 2] = b; od[d + 3] = a;
          d += 4;
        }
      }
    }
  }
  return out;
}

function applyPalette(im, opts) {
  const limit = Number(opts.colors) || 0;
  if (opts.palette === "resurrect") {
    snapToPalette(im, RESURRECT_64);
    if (limit && limit < 64) reduceColors(im, limit);
  } else if (limit > 0) {
    reduceColors(im, limit);
  }
}

// opts: { mode: "color" | "same" | "down", colors, palette: "adaptive" | "resurrect",
//         despeckle: 0|1|2, blockW, blockH, phaseX, phaseY }   (0 / null = auto)
// returns { out: ImageData, info } — info carries the readout and detected grid
export function depixel(src, opts) {
  const sw = src.width, sh = src.height;
  const before = countColors(src);

  if (opts.mode === "color") {
    // "only clean up the colours": no grid, no geometry, not a single pixel moves —
    // just collapse the render's thousands of near-identical shades onto one small
    // palette, which is what removes the speckle and gradient noise
    const out = new ImageData(new Uint8ClampedArray(src.data), sw, sh);
    applyPalette(out, opts);
    const specks = despeckle(out, Number(opts.despeckle) || 0);
    return {
      out,
      info: { mode: "color", w: sw, h: sh, before, after: countColors(out), specks },
    };
  }

  const ctrX = centerProfile(edgeProfile(src.data, sw, sh, 0));
  const ctrY = centerProfile(edgeProfile(src.data, sw, sh, 1));
  if (!ctrX || !ctrY) throw new Error("整张图没有任何颜色变化，无法检测网格。");

  const maxP = Math.max(DP_MIN_PERIOD, Math.min(96, Math.min(sw, sh) / 6));
  const manW = Number(opts.blockW) || 0;
  const manH = Number(opts.blockH) || 0;
  const fixed = (ctr, p) => { const c = dftBin(ctr, p); c.score = combScore(ctr.raw, p); return c; };
  let dx = manW >= DP_MIN_PERIOD ? fixed(ctrX, manW) : detectPeriod(ctrX, maxP);
  let dy = manH >= DP_MIN_PERIOD ? fixed(ctrY, manH) : detectPeriod(ctrY, maxP);
  if (!dx || !dy) throw new Error("图片太小或没有可辨认的网格，请在进阶设置里手动指定块宽 / 块高。");

  // square-lock: near-equal axes almost always mean square pixels, and averaging
  // the two estimates (weighted by how periodic each axis really is) beats
  // trusting either one alone
  if (!manW && !manH && Math.abs(dx.p - dy.p) <= 0.06 * Math.max(dx.p, dy.p)) {
    const p = (dx.p * dx.r + dy.p * dy.r) / (dx.r + dy.r);
    dx = fixed(ctrX, p);
    dy = fixed(ctrY, p);
  }

  const phaseX = opts.phaseX == null || opts.phaseX === "" ? dx.phase : Number(opts.phaseX);
  const phaseY = opts.phaseY == null || opts.phaseY === "" ? dy.phase : Number(opts.phaseY);
  if (!isFinite(phaseX) || !isFinite(phaseY)) throw new Error("相位必须是数字，留空表示自动。");

  const ex = cellEdges(sw, dx.p, phaseX);
  const ey = cellEdges(sh, dy.p, phaseY);
  const outW = ex.length - 1, outH = ey.length - 1;
  if (outW < 1 || outH < 1 || outW > sw || outH > sh) {
    throw new Error("推算出的输出尺寸不合理（" + outW + " × " + outH + "），请检查块大小。");
  }

  const score = Math.min(dx.score, dy.score);
  // both measures have to hold up: a weak comb means the changes don't sit on the
  // grid, a weak magnitude means the grid isn't actually periodic
  const weak = score < 1.35 || Math.min(dx.r, dy.r) < 0.10;

  // one pixel per cell first — colour reduction works on the real palette, not on
  // the same colour repeated across every pixel of a block
  const cells = resample(src.data, sw, sh, ex, ey);
  applyPalette(cells, opts);
  const specks = despeckle(cells, Number(opts.despeckle) || 0);
  const keepSize = opts.mode !== "down";
  const out = keepSize ? expandCells(cells, ex, ey, sw, sh) : cells;

  return {
    out,
    info: {
      mode: opts.mode, w: out.width, h: out.height, before, after: countColors(cells), specks,
      blockW: dx.p, blockH: dy.p, phaseX, phaseY, gridW: outW, gridH: outH,
      // comb score 1 = the colour changes ignore this grid entirely, so map it onto a
      // 0–100% readout where 4x background reads as 75%
      confidence: Math.max(0, Math.round((1 - 1 / Math.max(score, 1)) * 100)),
      weak,
    },
  };
}

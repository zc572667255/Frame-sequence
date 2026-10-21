// Cutting a sprite sheet into frames.
import { createCanvas } from "../core/util.js";

export const MAX_FRAMES = 2048; // cap per-frame work on accidental 1px grids

export function computeGrid(imgW, imgH, g) {
  const fw = Math.max(1, Math.min(g.fw | 0 || imgW, imgW));
  const fh = Math.max(1, Math.min(g.fh | 0 || imgH, imgH));
  const mx = Math.max(0, Math.min(g.mx | 0, imgW - fw));
  const my = Math.max(0, Math.min(g.my | 0, imgH - fh));
  const sx = Math.max(0, g.sx | 0), sy = Math.max(0, g.sy | 0);
  const cols = Math.floor((imgW - mx - fw) / (fw + sx)) + 1;
  const rows = Math.floor((imgH - my - fh) / (fh + sy)) + 1;
  const total = cols * rows;
  const cells = [];
  if (total <= MAX_FRAMES) {
    let index = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells.push({ x: mx + c * (fw + sx), y: my + r * (fh + sy), index: index++ });
      }
    }
  }
  return { fw, fh, mx, my, sx, sy, cols, rows, total, cells, tooMany: total > MAX_FRAMES };
}

export function cutFrames(sheet, cells, fw, fh) {
  return cells.map((cell) => {
    const c = createCanvas(fw, fh);
    c.getContext("2d").drawImage(sheet, cell.x, cell.y, fw, fh, 0, 0, fw, fh);
    return c;
  });
}

// Best-effort frame size for a freshly connected sheet.
//
// With transparency: the true frame count n is the LARGEST n (dividing the width
// exactly) whose every cell boundary falls on an empty column. Doubling n puts
// boundaries through the middle of each subject, which is almost never empty, so
// multiples of the true count fail on their own. Without transparency there is
// nothing to measure, so fall back to "frames are squares laid out in a strip".
export function guessFrameSize(imageData) {
  const { width: w, height: h, data } = imageData;
  const colEmpty = new Uint8Array(w).fill(1);
  const rowEmpty = new Uint8Array(h).fill(1);
  let transparent = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 16) { colEmpty[x] = 0; rowEmpty[y] = 0; }
      else transparent++;
    }
  }
  const hasAlpha = transparent > w * h * 0.05;

  const bestCount = (len, empty) => {
    if (!hasAlpha) return 1;
    let best = 1;
    for (let n = 2; n <= Math.min(128, len / 4); n++) {
      if (len % n) continue;
      const step = len / n;
      let ok = true;
      for (let k = 1; k < n && ok; k++) {
        const b = k * step;
        // the boundary sits between columns b-1 and b; either one empty will do
        if (!empty[b] && !empty[b - 1]) ok = false;
      }
      if (ok) best = n;
    }
    return best;
  };

  let cols = bestCount(w, colEmpty);
  let rows = bestCount(h, rowEmpty);
  if (cols === 1 && rows === 1) {
    if (w > h && w % h === 0) cols = w / h;
    else if (h > w && h % w === 0) rows = h / w;
  }
  return { fw: Math.round(w / cols), fh: Math.round(h / rows), mx: 0, my: 0, sx: 0, sy: 0, cols, rows };
}

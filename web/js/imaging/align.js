// Subject (footprint) alignment: remove jitter by moving every frame so its
// subject's bottom and horizontal anchor land on the sequence's median.
import { median, createCanvas, ctx2d } from "../core/util.js";

// frames: canvases of equal size w×h
// opts: { thr, xMode: "centroid" | "bbox" | "bottom", axis: "both" | "x" | "y" }
// returns { offsets: [{dx, dy}], outW, outH } with offsets already including padding
export function computeAlignment(frames, w, h, opts) {
  const scratch = createCanvas(w, h);
  const actx = ctx2d(scratch, true);
  const thr = opts.thr;

  const anchors = frames.map((f) => {
    actx.clearRect(0, 0, w, h);
    actx.drawImage(f, 0, 0);
    const data = actx.getImageData(0, 0, w, h).data;
    let minX = w, maxX = -1, maxY = -1, sumX = 0, cnt = 0;
    for (let y = 0; y < h; y++) {
      const rowBase = y * w;
      for (let x = 0; x < w; x++) {
        if (data[(rowBase + x) * 4 + 3] > thr) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          sumX += x; cnt++;
        }
      }
    }
    if (maxX < 0) return null;
    // "footprint": centroid of the subject's bottom 3 rows of opaque pixels
    let sumBX = 0, cntB = 0;
    for (let y = Math.max(0, maxY - 2); y <= maxY; y++) {
      const rowBase = y * w;
      for (let x = 0; x < w; x++) {
        if (data[(rowBase + x) * 4 + 3] > thr) { sumBX += x; cntB++; }
      }
    }
    const cx = opts.xMode === "bbox" ? (minX + maxX) / 2
             : opts.xMode === "bottom" ? (cntB ? sumBX / cntB : sumX / cnt)
             : sumX / cnt;
    return { cx, bottomY: maxY };
  });

  const valid = anchors.filter(Boolean);
  if (!valid.length) return { offsets: frames.map(() => ({ dx: 0, dy: 0 })), outW: w, outH: h, empty: true };

  // median target: a single exaggerated frame won't drag the whole sequence
  const targetX = median(valid.map((a) => a.cx));
  const targetY = median(valid.map((a) => a.bottomY));

  const raw = anchors.map((a) => a ? {
    dx: opts.axis === "y" ? 0 : Math.round(targetX - a.cx),
    dy: opts.axis === "x" ? 0 : Math.round(targetY - a.bottomY),
  } : { dx: 0, dy: 0 });

  let minDx = 0, maxDx = 0, minDy = 0, maxDy = 0;
  for (const o of raw) {
    minDx = Math.min(minDx, o.dx); maxDx = Math.max(maxDx, o.dx);
    minDy = Math.min(minDy, o.dy); maxDy = Math.max(maxDy, o.dy);
  }
  // the canvas grows just enough that no frame gets cropped by its shift
  const padLeft = Math.max(0, -minDx), padTop = Math.max(0, -minDy);
  const outW = w + padLeft + Math.max(0, maxDx);
  const outH = h + padTop + Math.max(0, maxDy);
  return {
    offsets: raw.map((o) => ({ dx: o.dx + padLeft, dy: o.dy + padTop })),
    outW, outH, targetY: targetY + padTop,
  };
}

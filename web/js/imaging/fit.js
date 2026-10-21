// Per-frame fit: pull a subject that overflows its cell back inside it.
import { createCanvas } from "../core/util.js";

// Label every connected blob of opaque pixels across the whole sheet at once,
// recording bounds, area and centroid for each.
export function labelComponents(data, w, h, thr) {
  const n = w * h;
  const label = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n); // each pixel is claimed at most once
  const comps = [];
  for (let s = 0; s < n; s++) {
    if (label[s] !== -1 || data[s * 4 + 3] <= thr) continue;
    const id = comps.length;
    let sp = 0;
    label[s] = id;
    stack[sp++] = s;
    let minX = w, minY = h, maxX = -1, maxY = -1, cnt = 0, sumX = 0, sumY = 0;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w, y = (i / w) | 0;
      cnt++; sumX += x; sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (label[j] !== -1 || data[j * 4 + 3] <= thr) continue;
          label[j] = id;
          stack[sp++] = j;
        }
      }
    }
    comps.push({ minX, minY, maxX, maxY, cnt, cx: sumX / cnt, cy: sumY / cnt });
  }
  return comps;
}

// gap between two bounding boxes; 0 when they touch or overlap
function bboxGap(a, b) {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
  return Math.hypot(dx, dy);
}

// A blob belongs to whichever cell holds its CENTROID, not to every cell it
// happens to touch. This is the rule that makes overhang work: a subject spilling
// out of cell B into cell A still belongs to B, so A doesn't swallow it and B
// measures it whole. Blobs landing in a margin or gap go to the nearest cell.
function assignComponents(comps, cells, fw, fh, minArea) {
  const kept = comps.filter((c) => c.cnt >= minArea); // drop background-removal dust
  const owned = new Map(); // cell index -> merged bounds

  const cellOf = (cx, cy) => {
    for (const f of cells) {
      if (cx >= f.x && cx < f.x + fw && cy >= f.y && cy < f.y + fh) return f;
    }
    let best = null, bd = Infinity;
    for (const f of cells) {
      const dx = cx - (f.x + fw / 2), dy = cy - (f.y + fh / 2);
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  };

  // The largest blob whose centroid lands in a cell is that frame's actual subject.
  const anchors = new Map();
  for (const c of kept) {
    const f = cellOf(c.cx, c.cy);
    if (!f) continue;
    const prev = anchors.get(f.index);
    if (!prev || c.cnt > prev.cnt) anchors.set(f.index, c);
  }
  const anchorList = [...anchors.entries()].map(([idx, c]) => ({ idx, c }));

  for (const c of kept) {
    const f = cellOf(c.cx, c.cy);
    let target = f ? f.index : null;
    // Everything that ISN'T a frame's subject — a sword trail, loose feathers, a
    // detached wing tip — is a fragment, and a fragment has to follow the subject
    // it belongs to instead of being judged on its own centroid. Judging fragments
    // independently is exactly what strands a trail in the previous frame when its
    // midpoint happens to land there. Distance is measured between bounding boxes,
    // so a long thin trail attaches to whatever it actually reaches.
    if (anchorList.length && !(f && anchors.get(f.index) === c)) {
      let bestGap = Infinity, bestMid = Infinity;
      for (const a of anchorList) {
        const g = bboxGap(c, a.c);
        const mid = Math.hypot(c.cx - a.c.cx, c.cy - a.c.cy);
        if (g < bestGap - 1e-9 || (Math.abs(g - bestGap) < 1e-9 && mid < bestMid)) {
          bestGap = g; bestMid = mid; target = a.idx;
        }
      }
    }
    if (target == null) continue;
    const prev = owned.get(target);
    owned.set(target, prev ? {
      minX: Math.min(prev.minX, c.minX), minY: Math.min(prev.minY, c.minY),
      maxX: Math.max(prev.maxX, c.maxX), maxY: Math.max(prev.maxY, c.maxY),
    } : { minX: c.minX, minY: c.minY, maxX: c.maxX, maxY: c.maxY });
  }
  return owned;
}

// Work out, per cell, where its subject should end up. Translation is preferred
// and only ever moves as far as it must; scaling is the fallback for a subject
// genuinely wider than its cell.
// opts: { thr, minArea, margin }
export function planFrameFit(sheetData, cells, fw, fh, opts) {
  const imgW = sheetData.width, imgH = sheetData.height;
  const comps = labelComponents(sheetData.data, imgW, imgH, opts.thr);

  // A sheet whose background is still opaque is ONE blob spanning everything: only
  // the frame holding its centroid gets anything, every other frame reads as empty,
  // and that one frame is squashed to fit the entire sheet. Detect it up front —
  // silently flattening the user's sheet is far worse than refusing.
  let biggest = 0;
  for (const c of comps) if (c.cnt > biggest) biggest = c.cnt;
  const bgLeft = biggest > imgW * imgH * 0.5;

  const owned = assignComponents(comps, cells, fw, fh, opts.minArea);
  const margin = Math.max(0, Math.min(opts.margin | 0, Math.floor(Math.min(fw, fh) / 2)));

  const plans = [];
  let moved = 0, squashed = 0, tall = 0, worst = 1, widest = 0;
  for (const f of cells) {
    const o = owned.get(f.index);
    if (!o) { plans.push({ f, empty: true }); continue; }
    const bb = { x: o.minX, y: o.minY, w: o.maxX - o.minX + 1, h: o.maxY - o.minY + 1 };

    const tx = f.x + margin, ty = f.y + margin;
    const tw = Math.max(1, fw - margin * 2), th = Math.max(1, fh - margin * 2);

    // height is never scaled — overflow there is cropped and reported instead
    const scaleX = bb.w > tw ? tw / bb.w : 1;
    const drawW = Math.max(1, Math.round(bb.w * scaleX));
    const drawH = bb.h;

    // squashed subjects sit centred so the trimmed margin is equal on both sides;
    // untouched ones move the minimum distance needed to get back inside
    const dx = scaleX < 1
      ? tx + Math.round((tw - drawW) / 2)
      : Math.max(tx, Math.min(bb.x, tx + tw - drawW));
    const loY = ty, hiY = ty + th - drawH;
    const dy = hiY < loY ? loY : Math.max(loY, Math.min(bb.y, hiY));

    const didMove = dx !== bb.x || dy !== bb.y;
    if (scaleX < 1) { squashed++; worst = Math.min(worst, scaleX); }
    else if (didMove) moved++;
    if (drawH > th) tall++;
    if (bb.w > widest) widest = bb.w;

    plans.push({ f, bb, dx, dy, drawW, drawH, scaleX, didMove });
  }
  return { plans, moved, squashed, tall, worst, widest, bgLeft, total: cells.length, frameW: fw };
}

// the two ways this feature silently does nothing useful, both worth naming
export function fitBlocker(r, imgW, imgH) {
  if (r.bgLeft) {
    return "背景还没去除：整张图连成了一个主体，只有一帧会被判定为「有内容」，其余帧会被清空。"
      + "请先在上游接一个「去背景」节点，再开启归位。";
  }
  if (r.total < 2) {
    const guess = imgH > 0 ? Math.round(imgW / imgH) : 0;
    return "当前整张图只有 1 帧（单帧宽度 = " + r.frameW + "），没有「超出帧范围」可言。请先设好单帧尺寸"
      + (guess > 1 && imgW % imgH === 0 ? "——这张图看起来是 " + guess + " 帧并排，单帧宽度应为 " + imgH + "。" : "。");
  }
  return null;
}

export function applyFrameFit(srcCanvas, plan, fw, fh, smooth) {
  const out = createCanvas(srcCanvas.width, srcCanvas.height);
  const octx = out.getContext("2d");
  octx.imageSmoothingEnabled = !!smooth;
  if (smooth) octx.imageSmoothingQuality = "high";
  for (const p of plan.plans) {
    if (p.empty) continue;
    octx.save();
    // clip to the cell so a subject taller than its frame can't bleed into the
    // neighbouring one after being repositioned
    octx.beginPath();
    octx.rect(p.f.x, p.f.y, fw, fh);
    octx.clip();
    octx.drawImage(srcCanvas, p.bb.x, p.bb.y, p.bb.w, p.bb.h, p.dx, p.dy, p.drawW, p.drawH);
    octx.restore();
  }
  return out;
}

// Reframing: change a PNG's canvas size and where its subject sits inside it.
//
// For an animation the subject box is the UNION over all frames by default, and
// every frame moves by the same amount — so the motion inside the sequence (a jump,
// a sword swing) is kept exactly. "perFrame" instead places each frame's own box,
// which recentres every pose (closer to what the align node does).
import { createCanvas } from "../core/util.js";

export function bboxOf(im, thr) {
  const { width: w, height: h, data: d } = im;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > thr) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function union(boxes) {
  const list = boxes.filter(Boolean);
  if (!list.length) return null;
  const x0 = Math.min(...list.map((b) => b.x)), y0 = Math.min(...list.map((b) => b.y));
  const x1 = Math.max(...list.map((b) => b.x + b.w)), y1 = Math.max(...list.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// position of a box of length `len` inside `size` for anchor a (0 start, 1 centre, 2 end)
function place(size, len, a, margin) {
  if (a === 0) return margin;
  if (a === 2) return size - len - margin;
  return Math.round((size - len) / 2);
}

// sw, sh: source size; boxes: per-frame bbox (null = empty frame)
// opts: { size: "keep" | "custom" | "fit", w, h, pad, place: "subject" | "canvas",
//         anchor: "ax,ay", margin, offX, offY, shrink, perFrame, roundTo }
// roundTo (fit mode): grow the frame to a multiple of n; the extra space goes
// where the anchor says (bottom-centre anchor = extra on top, split left/right)
export function planReframe(sw, sh, boxes, opts) {
  const U = union(boxes) || { x: 0, y: 0, w: sw, h: sh };
  const [ax, ay] = String(opts.anchor || "1,1").split(",").map(Number);
  const m = Math.max(0, opts.margin | 0);
  const pad = Math.max(0, opts.pad | 0);
  const offX = opts.offX | 0, offY = opts.offY | 0;

  let W, H, extraX = 0, extraY = 0;
  if (opts.size === "custom") { W = Math.max(1, opts.w | 0); H = Math.max(1, opts.h | 0); }
  else if (opts.size === "fit") {
    const n = Math.max(1, opts.roundTo | 0);
    const w0 = U.w + pad * 2, h0 = U.h + pad * 2;
    W = Math.ceil(w0 / n) * n; H = Math.ceil(h0 / n) * n;
    extraX = W - w0; extraY = H - h0;
  }
  else { W = sw; H = sh; }
  W = Math.min(W, 8192); H = Math.min(H, 8192);

  // shrink only ever scales DOWN, uniformly, and only when the subject can't fit
  let s = 1;
  if (opts.shrink && opts.size !== "fit") {
    const availW = W - (ax === 1 ? 0 : m), availH = H - (ay === 1 ? 0 : m);
    const bw = opts.place === "canvas" ? sw : U.w, bh = opts.place === "canvas" ? sh : U.h;
    s = Math.min(1, availW / bw, availH / bh);
    if (!(s > 0)) s = 1;
  }

  const plans = boxes.map((b) => {
    let dx, dy;
    if (opts.size === "fit") {
      dx = pad - U.x + place(extraX, 0, ax, 0);
      dy = pad - U.y + place(extraY, 0, ay, 0);
    } else if (opts.place === "canvas") {
      dx = place(W, Math.round(sw * s), ax, 0);
      dy = place(H, Math.round(sh * s), ay, 0);
    } else {
      const box = opts.perFrame && b ? b : U;
      dx = place(W, Math.round(box.w * s), ax, m) - Math.round(box.x * s);
      dy = place(H, Math.round(box.h * s), ay, m) - Math.round(box.y * s);
    }
    return { dx: dx + offX, dy: dy + offY };
  });

  // where the (union) subject ends up, for the readout and the overlay
  const p0 = plans[0] || { dx: 0, dy: 0 };
  const placed = { x: Math.round(U.x * s) + p0.dx, y: Math.round(U.y * s) + p0.dy, w: Math.round(U.w * s), h: Math.round(U.h * s) };
  let overflow = false;
  boxes.forEach((b, i) => {
    if (!b) return;
    const x = Math.round(b.x * s) + plans[i].dx, y = Math.round(b.y * s) + plans[i].dy;
    if (x < 0 || y < 0 || x + Math.round(b.w * s) > W || y + Math.round(b.h * s) > H) overflow = true;
  });
  // blank margins around the content in the SOURCE frames, for the readout
  const blank = { left: U.x, top: U.y, right: sw - U.x - U.w, bottom: sh - U.y - U.h };
  return { W, H, s, plans, union: U, placed, overflow, blank, empty: !boxes.some(Boolean) };
}

export function renderReframe(src, plan, i) {
  const c = createCanvas(plan.W, plan.H);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const p = plan.plans[i];
  ctx.drawImage(src, p.dx, p.dy, Math.round(src.width * plan.s), Math.round(src.height * plan.s));
  return c;
}

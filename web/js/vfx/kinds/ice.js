import { rgba, rng } from "../../trails/glow/util.js";
import { TAU, mixRgb, lum } from "../common.js";

// 冰矛, an ice lance in flat cel shading: a long faceted crystal, its top
// face lit and its underside in shadow, a white sliver of highlight along the
// top, a thin dark outline. Behind it only a few white speed lines that
// follow the path (arcs on a turn); chips flake off it on the way and fall
// (remotetrail.js). No
// glow: the ice is solid colour, three tones and a highlight, so it reads on
// light backgrounds too and stays crisp as pixels. godot/ice.js draws
// exactly the same.

// The tones all come from the palette (配色): highlight near the core colour,
// the lit face, the mid tone and the shadow between the palette's second
// colour and its core or darkest, a little greyed (cel shadows are not
// saturated), and the outline darker still.
const grey = (c, k) => { const l = lum(c); return c.map((v) => Math.round(v + (l - v) * k)); };
export function iceTones(pal) {
  const blue = pal.cols[1] || pal.rim, dark = pal.cols[0];
  return {
    hi: mixRgb(pal.core, mixRgb(blue, pal.core, 0.85), 0.5),
    light: grey(mixRgb(blue, pal.core, 0.72), 0.25),
    mid: grey(mixRgb(blue, dark, 0.15), 0.3),
    shade: grey(mixRgb(blue, dark, 0.6), 0.35),
    deep: mixRgb(grey(dark, 0.3), [16, 20, 34], 0.5),
  };
}

// whole turns per loop: about one every 8 frames
export const iceCycles = (n) => Math.max(1, Math.round((n || 8) / 8));

// a path from its oldest point to the head, measured back from the head:
// at(d) → [x, y, nx, ny] (nx, ny: the normal); d < 0 runs on ahead of the
// head, d > len on behind the oldest point, both straight on
export function alongPath(pts) {
  const rev = [...pts].reverse(), ds = [0];
  for (let i = 1; i < rev.length; i++) ds.push(ds[i - 1] + Math.hypot(rev[i][0] - rev[i - 1][0], rev[i][1] - rev[i - 1][1]));
  const len = ds[ds.length - 1];
  const at = (d) => {
    const ahead = Math.min(0, d) + Math.max(0, d - len);
    d = Math.max(0, Math.min(len, d));
    let i = 1;
    while (i < rev.length - 1 && ds[i] < d) i++;
    const a = rev[i - 1], b = rev[i], s = ds[i] - ds[i - 1], k = s > 1e-9 ? (d - ds[i - 1]) / s : 0;
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [a[0] + dx * k + dx / l * ahead, a[1] + dy * k + dy / l * ahead, -dy / l, dx / l];
  };
  return { len, at };
}

// a diamond of ice from `at` (its back point), pointing along angle:
// [back, side, front, other side]
export function chipPoints(at, angle, len, width) {
  const c = Math.cos(angle), s = Math.sin(angle), pt = (x, y) => [at[0] + x * c - y * s, at[1] + x * s + y * c];
  return [pt(0, 0), pt(len * 0.35, -width), pt(len, 0), pt(len * 0.35, width)];
}

const lerp2 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

// a diamond (chipPoints, in screen space) as a crystal: split along its
// length, the half facing up lit, the other in shadow, a highlight sliver
// on the lit half towards the point. → { faces: [[pts, tone]], outline, alpha }
export function crystal(d, alpha) {
  const [back, s1, front, s2] = d, ax = [front[0] - back[0], front[1] - back[1]];
  let n = [ax[1], -ax[0]];
  if (n[1] > 0) n = [-n[0], -n[1]];
  const up1 = (s1[0] - back[0]) * n[0] + (s1[1] - back[1]) * n[1] >= 0, lit = up1 ? s1 : s2, dim = up1 ? s2 : s1;
  return {
    faces: [
      [[back, lit, front], "light"],
      [[back, front, dim], "shade"],
      [[lerp2(lit, front, 0.2), front, lerp2(lerp2(back, front, 0.6), lit, 0.45)], "hi"],
    ],
    outline: d, alpha,
  };
}

// a four-pointed sparkle at (x, y): 8 points, long rays on the axes
export function sparklePoints(x, y, size) {
  const pts = [];
  for (let k = 0; k < 8; k++) {
    const th = k * Math.PI / 4, l = k % 2 ? size * 0.22 : size;
    pts.push([x + Math.cos(th) * l, y + Math.sin(th) * l]);
  }
  return pts;
}

function poly(g, pts) { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); }

// pieces of ice ({ faces, outline, alpha }), solid colour on top of what is there
export function drawPieces(g, pieces, T, lw) {
  g.globalCompositeOperation = "source-over"; g.lineJoin = "round";
  for (const p of pieces) {
    if (p.alpha <= 0.005) continue;
    for (const [pts, tone] of p.faces) { g.fillStyle = rgba(T[tone], p.alpha); poly(g, pts); g.fill(); }
    if (p.outline) { g.strokeStyle = rgba(T.deep, 0.85 * p.alpha); g.lineWidth = lw; poly(g, p.outline); g.stroke(); }
  }
}

// the lance, in its own frame (x forward, tip at 2.6 r, back at -5.4 r), lit
// from local -y: a base in the mid tone, the top face lit, a band of shadow
// along the underside, two facets cut into the top face, a highlight sliver
// along the top towards the tip; the edges a little uneven, like ice
export function iceLance(r, seed) {
  const P = rng(seed * 97 + 5), j = (x, y) => [x * r, y * r * (0.88 + 0.24 * P())];
  const U = [[1.3, -0.34], [0.1, -0.5], [-1.3, -0.42], [-1.7, -0.27], [-2.0, -0.42], [-3.3, -0.29], [-4.6, -0.11]].map(([x, y]) => j(x, y));
  const L = [[-4.4, 0.14], [-3.0, 0.34], [-1.6, 0.46], [-0.9, 0.32], [-0.4, 0.47], [1.1, 0.37]].map(([x, y]) => j(x, y));
  const G = [[1.3, -0.07], [0.1, -0.1], [-1.3, -0.08], [-3.3, -0.06], [-4.6, -0.01]].map(([x, y]) => j(x, y));
  const tip = [2.6 * r, 0], back = [-5.4 * r, 0.02 * r];
  const outline = [tip, ...U, back, ...L];
  const inner = [...L].reverse().map(([x, y]) => [x + 0.15 * r, y * 0.5]);
  const faces = [
    [outline, "mid"],
    [[tip, ...U, back, ...[...G].reverse()], "light"],
    [[lerp2(U[1], U[2], 0.5), G[2], G[1]], "mid"],
    [[U[5], G[4], G[3]], "mid"],
    [[back, ...L, tip, ...inner], "shade"],
    [[tip, [U[0][0], U[0][1] * 0.72], [U[1][0], U[1][1] * 0.72], [U[2][0] + 0.3 * r, U[2][1] * 0.6], [U[1][0], U[1][1] * 0.45], [U[0][0], U[0][1] * 0.4]], "hi"],
  ];
  return { faces, outline, tip, back };
}

// the speed lines behind the lance for a path of length len, measured
// back along it: { d, off, len, width, alpha }, each a thin white sliver
// sliding back from the lance over the length of the trail and fading in and
// out on the way; spread across 拖尾宽度 (width). Any frame can be sought
// and they close the loop.
export const ICE_LINES = 4;
export function iceLines(len, r, t, n, seed, width = 1) {
  const P = rng(seed * 173 + 41), cyc = iceCycles(n), lines = [], reach = Math.max(r * 2.5, Math.min(len, r * 12));
  for (let k = 0; k < ICE_LINES; k++) {
    const ph = (t * cyc + P()) % 1, off = ((k + 0.5) / ICE_LINES - 0.5) * r * 1.1 * width + (P() - 0.5) * r * 0.12;
    lines.push({ d: r * 3 + ph * (reach + r * 3), off, len: r * (2 + 2 * P()), width: r * 0.06, alpha: 0.75 * Math.sin(Math.PI * ph) });
  }
  return lines;
}

// a speed line as a sliver along the path: thick at its front, tapering to
// a point behind, sampled along it so that on a turn it bends into an arc
export const ICE_LINE_STEPS = 10;
export function linePoints(l, place) {
  const a = [], b = [];
  for (let k = 0; k <= ICE_LINE_STEPS; k++) {
    const u = k / ICE_LINE_STEPS, d = l.d + l.len * u, w = l.width * (1 - u);
    a.push(place(d, l.off - w)); b.push(place(d, l.off + w));
  }
  return [...a, ...b.reverse()];
}

// the path made smooth: each segment cut into `k` along a Catmull-Rom curve
// through the points, so a speed line on a sharp turn is a round arc rather
// than a few straight pieces with corners
export function smoothLine(pts, k = 4) {
  const n = pts.length, out = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    for (let s = 0; s < k; s++) {
      const u = s / k, u2 = u * u, u3 = u2 * u;
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (p2[j] - p0[j]) * u + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * u2 + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * u3)));
    }
  }
  out.push(pts[n - 1]);
  return out;
}

// what follows the flight: only the speed lines (the chips it sheds are
// drawn with the other shed motes, remotetrail.js)
export function drawIceTail(g, c, pts, r, strength = 1, width = 1) {
  const path = alongPath(smoothLine(pts)), T = iceTones(c.pal);
  const place = (d, off) => { const [x, y, nx, ny] = path.at(d); return [x + nx * off, y + ny * off]; };
  g.globalCompositeOperation = "source-over";
  for (const l of iceLines(path.len, r, c.t, c.n, c.seed, width)) {
    if (l.alpha * strength <= 0.01) continue;
    g.fillStyle = rgba(T.hi, l.alpha * strength); poly(g, linePoints(l, place)); g.fill();
  }
}

// the lance at (0, 0), flying along +x; lit from above on screen, so when it
// flies leftwards (turned upside down) it is mirrored
export function drawIceHead(g, c, r) {
  const T = iceTones(c.pal), L = iceLance(r, c.seed), flip = g.getTransform().d < 0;
  g.save(); if (flip) g.scale(1, -1);
  drawPieces(g, [{ faces: L.faces, outline: L.outline, alpha: 1 }], T, Math.max(0.6, r * 0.05));
  g.restore();
  // the sparkle at the tip stands upright on screen, whichever way the lance flies
  const m = g.getTransform(), tw = 0.75 + 0.25 * Math.cos(c.t * TAU * iceCycles(c.n) * 2);
  g.save(); g.translate(L.tip[0], 0); g.rotate(-Math.atan2(m.b, m.a));
  g.fillStyle = rgba(T.hi, 0.95); poly(g, sparklePoints(0, 0, r * 0.55 * tw)); g.fill();
  g.restore();
}

export function drawIceBolt(g, c, r, still) {
  // standing still (原地循环): a straight flight behind it carries the speed lines
  if (still) drawIceTail(g, c, Array.from({ length: 9 }, (_, i) => [-r * 12 * (1 - i / 8), 0]), r);
  drawIceHead(g, c, r);
}

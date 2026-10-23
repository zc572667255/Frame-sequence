import { rng, rgba, smooth } from "../../trails/glow/util.js";
import { star } from "../../trails/glow/shapes.js";
import { TAU, easeOut, frac, mixRgb, lum, at, blob, sparks, comet } from "../common.js";

// 流光: ribbons of light drifting across the area — each a bundle of fine
// strands that twists (the strands cross where it turns edge-on), brighter
// along its edges and faded out at both ends — with glittering dust. A loop
// moves every wave a whole number of cycles, so it closes; a one-shot sweeps
// in from the left and fades away.
export function ribbon(g, c) {
  const { t, pal } = c;
  const rx = c.rx, ry = c.ry, cx = c.cx, cy = c.cy;
  const P = rng(c.seed * 89 + 5);
  const env = c.loop ? 1 : smooth(0, 0.2, t) * (1 - smooth(0.65, 1.05, t));
  const xa = cx - rx, xb = xa + 2 * rx * (c.loop ? 1 : easeOut(t / 0.55, 2));
  const nR = Math.max(1, Math.round(3 * Math.max(0.34, c.amount)));
  // in pixels a few solid strands: faint ones would vanish
  const strands = c.pixel ? 4 : 12, M = 72, lw = Math.max(0.6, c.R * 0.007);
  // the saturated colours only: white comes from where ribbons overlap
  const tones = [...pal.cols, pal.rim, pal.splat].filter((q) => lum(q) > 40 && lum(q) < 215);
  if (!tones.length) tones.push(pal.rim);
  const bands = [];
  g.globalCompositeOperation = "lighter";
  g.lineCap = "round"; g.lineJoin = "round";
  for (let r = 0; r < nR; r++) {
    const f1 = (0.7 + 0.7 * P()) * Math.PI / rx, f2 = (1.6 + 1.4 * P()) * Math.PI / rx, ft = (0.6 + 0.8 * P()) * Math.PI / rx;
    const p1 = P() * TAU, p2 = P() * TAU, pt = P() * TAU, d1 = P() < 0.5 ? -1 : 1, d2 = 1 + Math.floor(P() * 2);
    const A1 = ry * (0.22 + 0.3 * P()), A2 = ry * (0.06 + 0.1 * P()), W = ry * (0.1 + 0.16 * P()), off = (P() - 0.5) * ry * 0.5;
    const ca = tones[Math.floor(P() * tones.length)], cb = tones[Math.floor(P() * tones.length)];
    const mid = (x) => cy + off + A1 * Math.sin(x * f1 + p1 + d1 * TAU * t) + A2 * Math.sin(x * f2 + p2 - d2 * TAU * t);
    const wide = (x) => W * Math.sin(x * ft + pt + TAU * t);
    bands.push([mid, wide]);
    const paint = (col0, col1, a) => {
      const gr = g.createLinearGradient(cx - rx, 0, cx + rx, 0);
      gr.addColorStop(0, rgba(col0, 0));
      gr.addColorStop(0.2, rgba(col0, a));
      gr.addColorStop(0.5, rgba(mixRgb(col0, col1, 0.5), a));
      gr.addColorStop(0.8, rgba(col1, a));
      gr.addColorStop(1, rgba(col1, 0));
      return gr;
    };
    const path = (v) => {
      g.beginPath();
      for (let i = 0; i <= M; i++) { const x = xa + (xb - xa) * i / M, y = mid(x) + wide(x) * v; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    };
    // a soft sheet of light under the strands
    if (!c.pixel) for (const [k, a] of [[2.6, 0.035], [1.4, 0.06]]) { g.strokeStyle = paint(ca, cb, a * env); g.lineWidth = W * k; path(0); g.stroke(); }
    // the strands, unevenly spaced so they read as silk, not a grid; the
    // outer ones bright (the ribbon's edges catch the light)
    for (let j = 0; j < strands; j++) {
      const v = strands > 1 ? Math.max(-1, Math.min(1, (j / (strands - 1) * 2 - 1) + (P() - 0.5) * 0.12)) : 0, e = Math.pow(Math.abs(v), 4);
      g.strokeStyle = paint(ca, cb, (c.pixel ? 0.9 : 0.1 + 0.65 * e) * env);
      g.lineWidth = lw * (0.6 + 0.8 * e);
      path(v); g.stroke();
    }
  }
  // glittering dust along the ribbons, twinkling (whole cycles per loop)
  const N = Math.round(36 * c.amount);
  const edges = (x) => smooth(0, 0.15, (x - (cx - rx)) / (2 * rx)) * smooth(0, 0.15, (cx + rx - x) / (2 * rx));
  for (let i = 0; i < N; i++) {
    const [mid, wide] = bands[Math.floor(P() * bands.length)];
    const x = xa + (xb - xa) * P(), y = mid(x) + wide(x) * (P() * 2 - 1) * 1.5 + (P() - 0.5) * ry * 0.25;
    const ph = P(), sp = 1 + Math.floor(P() * 3), big = P();
    const a = Math.pow(Math.sin(Math.PI * frac(ph + t * sp)), 2) * env * edges(x);
    if (big > 0.9 && !c.pixel) star(g, [x, y], Math.max(2, c.R * 0.05), pal.rim, a, 0);
    else blob(g, x, y, Math.max(1, c.R * (0.01 + 0.015 * big)), [[0, pal.core, a], [0.5, pal.rim, 0.5 * a], [1, pal.rim, 0]]);
  }
  // sparks riding the ribbons from one end to the other, trailing light
  // along the curve (whole cycles per loop)
  for (let i = 0; i < Math.round(8 * c.amount); i++) {
    const [mid, wide] = bands[Math.floor(P() * bands.length)], v = P() * 2 - 1, ph = P(), sp = 1 + Math.floor(P() * 2);
    const at = (q) => { const x = cx - rx + 2 * rx * q; return [x, mid(x) + wide(x) * v]; };
    const p = frac(ph + t * sp), [hx] = at(p);
    if (hx > xb) continue;
    comet(g, pal, at, p, 0.12, Math.max(0.7, c.R * 0.016) * (c.pixel ? 1.6 : 1), env * edges(hx));
  }
}

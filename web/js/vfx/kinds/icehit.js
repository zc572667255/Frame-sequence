import { rng, rgba, smooth } from "../../trails/glow/util.js";
import { TAU, mixRgb, blob, ring, easeOut } from "../common.js";
import { iceColors, chipPoints, star } from "./ice.js";

// The ice lance striking: a white flash, the lance bursting into ice chips
// flung mostly onward, its two ribbons (in the palette's colours, as in
// flight) whipping out into curls round the point, a haze, a faint ring and
// star glints. All a function of t (0..1 over the hit), so any frame can be sought;
// all is gone by t = 1. godot/icehit.js draws exactly the same.
//
// R: the hit's radius; angle: the direction the lance flew.
export function iceBurst(R, amount, seed, t, angle = 0) {
  const P = rng(seed * 227 + 61), q = Math.max(0.25, Math.min(2, amount)), e = easeOut(t);
  const haze = [], chips = [], glints = [], curls = [];
  for (let j = 0; j < 5; j++) {
    const a = j * TAU / 5 + P() * 0.8, reach = R * (0.2 + 0.3 * P()), r0 = R * (0.3 + 0.4 * e) * (0.8 + 0.4 * P());
    haze.push({ at: [Math.cos(a) * reach * e, Math.sin(a) * reach * e], r: r0, alpha: Math.pow(1 - t, 1.5) * 0.2 * smooth(0, 0.06, t) });
  }
  for (let j = 0, n = Math.round(18 * q); j < n; j++) {
    const a = angle + (P() - 0.5) * (P() < 0.7 ? 2.2 : TAU), len = R * (0.12 + 0.2 * P()), speed = R * (0.8 + 1.2 * P()), rot = P() * TAU, spin = (P() - 0.5) * 10, life = 0.45 + 0.4 * P();
    const d = speed * t * (1 - 0.45 * t);
    chips.push({ at: [Math.cos(a) * d, Math.sin(a) * d + R * 0.4 * t * t], angle: rot + spin * t, len: len * (1 - 0.3 * t), width: len * 0.22, alpha: 1 - smooth(life * 0.5, life, t) });
  }
  // each ribbon curls out from the point and unwinds as it fades
  for (let j = 0; j < 2; j++) {
    const a0 = angle + Math.PI + (j ? 0.6 : -0.6), pts = [];
    for (let k = 0; k <= 24; k++) {
      const u = k / 24, th = a0 + (j ? 1 : -1) * u * 3.4 * (0.6 + 0.4 * e), rad = R * (0.15 + 0.75 * e) * (0.3 + 0.7 * u);
      pts.push([Math.cos(th) * rad, Math.sin(th) * rad]);
    }
    curls.push({ pts, alpha: smooth(0, 0.08, t) * (1 - smooth(0.25, 0.75, t)), width: R * 0.07 * (1 - 0.5 * t) });
  }
  for (let j = 0, n = Math.round(10 * q); j < n; j++) {
    const a = P() * TAU, reach = R * (0.3 + 0.8 * P()), born = 0.04 + 0.35 * P(), size = R * (0.05 + 0.05 * P()), k = Math.max(0, Math.min(1, (t - born) / 0.45));
    glints.push({ at: [Math.cos(a) * reach * e, Math.sin(a) * reach * e], size, alpha: t < born || k >= 1 ? 0 : Math.sin(Math.PI * k) });
  }
  return { flash: 1 - smooth(0, 0.16, t), haze, chips, curls, glints, ring: { radius: R * (0.2 + 0.8 * e), alpha: 0.3 * (1 - smooth(0.1, 0.55, t)) } };
}

export function drawIceImpact(g, c, radius, angle = 0) {
  const { t, pal } = c, hit = iceBurst(radius, c.amount, c.seed, t, angle), col = iceColors(pal), light = pal.dark ? "source-over" : "lighter";
  g.save(); g.translate(c.cx, c.cy);
  g.globalCompositeOperation = light;
  for (const m of hit.haze) blob(g, m.at[0], m.at[1], m.r, [[0, col.haze, m.alpha], [1, col.haze, 0]]);
  ring(g, 0, 0, hit.ring.radius, Math.max(0.6, radius * 0.035), 1, col.rim, hit.ring.alpha);
  g.lineCap = "round"; g.lineJoin = "round";
  hit.curls.forEach((cu, j) => {
    if (cu.alpha <= 0.01) return;
    const tone = j ? col.ribbonB : col.ribbonA;
    for (const [w, a, tint] of [[cu.width, 0.85, 0], [cu.width * 0.35, 0.6, 0.6]]) {
      g.strokeStyle = rgba(mixRgb(tone, col.core, tint), a * cu.alpha); g.lineWidth = Math.max(0.5, w);
      g.beginPath(); cu.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    }
  });
  for (const k of hit.chips) {
    if (k.alpha <= 0.005) continue;
    const pts = chipPoints(k.at, k.angle, k.len, k.width);
    g.fillStyle = rgba(col.pale, 0.6 * k.alpha); g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
    g.strokeStyle = rgba(col.core, 0.7 * k.alpha); g.lineWidth = Math.max(0.4, radius * 0.012); g.stroke();
  }
  for (const k of hit.glints) star(g, k.at[0], k.at[1], k.size, pal, k.alpha);
  blob(g, 0, 0, radius * 0.9, [[0, col.blue, 0.45 * hit.flash], [1, col.blue, 0]]);
  blob(g, 0, 0, radius * 0.5, [[0, col.core, 0.95 * hit.flash], [0.4, col.core, 0.5 * hit.flash], [1, col.pale, 0]]);
  g.globalCompositeOperation = "source-over";
  g.restore();
}

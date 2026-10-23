import { createCanvas } from "../../core/util.js";
import { rng, rgba, smooth } from "../../trails/glow/util.js";
import { TAU, easeIn, frac, at, blob, ring, beam, swirl, comet } from "../common.js";

// 治疗光圈: a ring of light on the ground, a soft column rising from it, and
// plus signs and motes floating up
export function heal(g, c) {
  const { t, R, pal } = c;
  const k = c.squash, cx = c.cx, gy = c.gy;
  const env = c.loop ? 1 : smooth(0, 0.15, t) * (1 - smooth(0.75, 1, t));
  const pulse = 0.85 + 0.15 * Math.sin(TAU * t * 2);
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = env;
  const H = R * 1.7;
  // a soft column of light (高清 only: in pixels a faint wash only turns into
  // a muddy block)
  if (!c.pixel) {
    // it starts below the ground line, fading in, so no edge crosses the ring
    const col = createCanvas(c.w, c.h), cg = col.getContext("2d");
    const foot = R * k * 0.7, vg = cg.createLinearGradient(0, gy + foot, 0, gy - H);
    vg.addColorStop(0, rgba(pal.rim, 0));
    vg.addColorStop(foot / (H + foot), rgba(pal.rim, 0.4 * pulse));
    vg.addColorStop(0.55, rgba(pal.cols[2], 0.14 * pulse));
    vg.addColorStop(1, rgba(pal.cols[2], 0));
    cg.fillStyle = vg;
    cg.fillRect(cx - R, gy - H, R * 2, H + foot);
    cg.globalCompositeOperation = "destination-in";
    const hg = cg.createLinearGradient(cx - R, 0, cx + R, 0);
    hg.addColorStop(0, "rgba(0,0,0,0)"); hg.addColorStop(0.25, "rgba(0,0,0,0.7)"); hg.addColorStop(0.5, "rgba(0,0,0,1)");
    hg.addColorStop(0.75, "rgba(0,0,0,0.7)"); hg.addColorStop(1, "rgba(0,0,0,0)");
    cg.fillStyle = hg;
    cg.fillRect(cx - R, gy - H, R * 2, H + foot + 1);
    g.drawImage(col, 0, 0);
  }
  // the ground: a soft pool of light (a solid plate in pixels, where a faint
  // one would vanish) and a bright ring, a second ring breathing out
  g.save(); g.translate(cx, gy); g.scale(1, k);
  if (c.pixel) blob(g, 0, 0, R, [[0, pal.rim, 0.5 * pulse], [0.8, pal.rim, 0.3], [1, pal.rim, 0]]);
  else blob(g, 0, 0, R * 1.05, [[0, pal.core, 0.22 * pulse], [0.5, pal.rim, 0.14 * pulse], [0.85, pal.rim, 0.2], [1, pal.rim, 0]]);
  g.restore();
  ring(g, cx, gy, R * 0.95, R * 0.2, k, pal.rim, 0.35);
  ring(g, cx, gy, R * 0.95, R * 0.07, k, pal.rim, 0.7);
  ring(g, cx, gy, R * 0.95, R * 0.025 + 0.6, k, pal.core, 1);
  const br = frac(t * (c.loop ? 1 : 1.5));
  ring(g, cx, gy, R * (0.35 + 0.6 * br), R * 0.03 + 0.5, k, pal.core, 0.6 * (1 - br));
  // shafts rising from the ring, each brightening and fading on its own beat;
  // the ones behind the middle start up on the far side of the ring
  const Q = rng(c.seed * 47 + 12), rays = Math.round(16 * Math.max(0.4, c.amount));
  const beams = [];
  for (let i = 0; i < rays; i++) {
    const u = (i + 0.5) / rays * 2 - 1 + (Q() - 0.5) * 0.12, ph = Q(), len = H * (0.35 + 0.6 * Q()), side = Q() * 2 - 1;
    const x = cx + u * R * 0.9, y = gy + Math.sqrt(Math.max(0, 1 - u * u)) * R * k * 0.9 * side;
    const a = (0.2 + 0.7 * Math.pow(Math.sin(Math.PI * frac(ph + t * (1 + (i % 2)))), 2)) * (0.75 + 0.25 * (1 - Math.abs(u)));
    beams.push([x, y, len, Math.max(0.7, R * (0.012 + 0.022 * Q())), a]);
  }
  for (const [x, y, len, wd, a] of beams) beam(g, pal, x, y + wd, y - len, wd, a);
  // ribbons of light winding up round the column (whole turns per loop)
  const turns = Math.max(1, Math.round(2 * c.amount));
  for (let j = 0; j < turns; j++) {
    const p = frac(t * (c.loop ? 1 : 1.2) + j / turns), rr = R * (0.95 - 0.3 * p), yy = gy - H * 0.5 * easeIn(p, 1.3);
    swirl(g, pal, cx, yy, rr, rr * k, TAU * (p * 1.5 + j * 0.37), 0.9 * Math.sin(Math.PI * p), Math.max(0.8, R * 0.025));
  }
  // floating plus signs, and motes rising in a sway with trails of light
  const P = rng(c.seed * 43 + 10), N = Math.round(14 * c.amount);
  for (let i = 0; i < N; i++) {
    const x = cx + (P() * 2 - 1) * R * 0.85, y0 = gy + (P() * 2 - 1) * R * k * 0.6, ph = P(), sp = 1 + Math.floor(P() * 2), plus = P() < 0.45;
    const p = frac(ph + t * sp), a = Math.sin(Math.PI * p), sw = ph * TAU;
    const at = (q) => [x + R * 0.07 * Math.sin(TAU * q * 1.2 + sw), y0 - R * 1.5 * q];
    const [px, py] = at(p), s = R * (plus ? 0.07 : 0.035) * (0.7 + 0.3 * a);
    if (plus) {
      const th = Math.max(1, s * 0.38);
      blob(g, px, py, s * 2.4, [[0, pal.rim, 0.5 * a], [1, pal.rim, 0]]);
      g.fillStyle = rgba(pal.core, a);
      g.fillRect(px - s, py - th / 2, s * 2, th); g.fillRect(px - th / 2, py - s, th, s * 2);
    } else comet(g, pal, at, p, 0.25, Math.max(0.7, s * 0.55) * (c.pixel ? 1.8 : 1), a);
  }
  g.globalAlpha = 1;
}

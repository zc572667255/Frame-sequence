import { rng, clamp01, smooth } from "../../trails/glow/util.js";
import { star } from "../../trails/glow/shapes.js";
import { TAU, easeOut, easeIn, frac, at, blob, ring, sparks, trail, comet } from "../common.js";

// 蓄力: sparks spiralling in along curved comet tails to a pulsing orb
// wrapped in glowing arcs that spin round it; as a one-shot the orb grows
// and bursts at the end
export function charge(g, c) {
  const { t, R, cx, cy, pal } = c;
  const P = rng(c.seed * 31 + 8);
  const power = c.loop ? 1 : 0.25 + 0.75 * easeIn(t / 0.82, 1.4);
  const burst = c.loop ? 0 : smooth(0.8, 0.9, t);
  const gone = c.loop ? 1 : 1 - smooth(0.88, 1, t);
  g.globalCompositeOperation = "lighter";
  const N = Math.round(26 * c.amount);
  for (let k = 0; k < N; k++) {
    const th0 = P() * TAU, ph = P(), sp = 1 + Math.floor(P() * 2), r0 = R * (0.7 + 0.45 * P()), wid = 0.6 + 0.8 * P();
    const p = frac(ph + t * sp);
    const a = smooth(0, 0.2, p) * (1 - smooth(0.85, 1, p)) * (1 - burst);
    if (a <= 0.01) continue;
    // a point on its spiral at progress q: closing in faster and faster
    const on = (q) => {
      const d = R * 0.14 + (r0 - R * 0.14) * (1 - easeIn(q, 1.7)), th = th0 + q * 2.2;
      return [cx + Math.cos(th) * d, cy + Math.sin(th) * d];
    };
    const pts = [];
    for (let i = 0; i <= 10; i++) pts.push(on(Math.max(0, p - 0.22 * (1 - i / 10))));
    trail(g, pal, pts, Math.max(0.7, R * 0.022 * wid), a, true);
  }
  const pulse = 1 + 0.1 * Math.sin(TAU * t * 2);
  const rr = R * 0.24 * pulse * power * gone;
  blob(g, cx, cy, rr * 2.4, [[0, pal.rim, 0.45 * gone], [1, pal.rim, 0]]);
  blob(g, cx, cy, rr, [[0, pal.core, 1], [0.45, pal.core, 0.95], [0.75, pal.rim, 0.8], [1, pal.cols[2], 0]]);
  // arcs spinning round the orb, like the edges of a shell of energy: each
  // fading in and out along its length
  for (let k = 0; k < 3; k++) {
    const a0 = TAU * t * (k % 2 ? -1 : 1) + k * TAU / 3, rx = rr * (1.35 + 0.2 * k), ry = rx * (0.45 + 0.2 * k);
    const tilt = k * 1.05, ct = Math.cos(tilt), st = Math.sin(tilt), pts = [];
    for (let i = 0; i <= 24; i++) {
      const th = a0 + 1.9 * i / 24, x = Math.cos(th) * rx, y = Math.sin(th) * ry;
      pts.push([cx + x * ct - y * st, cy + x * st + y * ct]);
    }
    trail(g, pal, pts, Math.max(0.8, R * 0.022), 0.9 * gone, false);
  }
  for (let k = 0; k < Math.round(4 * c.amount); k++) {
    const th = P() * TAU, d = rr * (1.3 + 0.8 * P()), tw = 0.5 + 0.5 * Math.sin(TAU * (t * 2 + P()));
    star(g, [cx + Math.cos(th) * d, cy + Math.sin(th) * d], Math.max(2, R * 0.06 * tw), pal.rim, 0.9 * tw * gone, 0);
  }
  if (burst > 0) {
    const bt = clamp01((t - 0.8) / 0.2);
    blob(g, cx, cy, R * (0.4 + 0.6 * easeOut(bt)), [[0, pal.core, 1 - bt], [0.4, pal.rim, 0.7 * (1 - bt)], [1, pal.rim, 0]]);
    ring(g, cx, cy, R * (0.3 + 0.8 * easeOut(bt, 2)), R * 0.06 + 0.6, 1, pal.rim, 0.9 * (1 - bt));
  }
}

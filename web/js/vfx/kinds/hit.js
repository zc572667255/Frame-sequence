import { rng, rgba, smooth } from "../../trails/glow/util.js";
import { TAU, easeOut, blob, ring, spike, sparks } from "../common.js";

// 命中火花: a white-hot flash, a cross of long spikes with shorter ones
// between, sparks flung out and a thin ring
export function hit(g, c) {
  const { t, R, cx, cy, pal } = c;
  const P = rng(c.seed * 13 + 1);
  g.globalCompositeOperation = "lighter";
  const fl = 1 - smooth(0, 0.4, t);
  blob(g, cx, cy, R * 0.75 * (0.7 + 0.5 * easeOut(t * 3)), [[0, pal.core, fl], [0.25, pal.core, 0.8 * fl], [0.5, pal.rim, 0.55 * fl], [1, pal.rim, 0]]);
  const tilt = P() * Math.PI, grow = easeOut(t / 0.15), thin = 1 - smooth(0.1, 0.7, t);
  for (let k = 0; k < 4; k++) {
    const th = tilt + k * Math.PI / 2 + (P() - 0.5) * 0.25;
    spike(g, cx, cy, th, R * (k % 2 ? 0.75 : 1.1) * grow * (1 + 0.2 * t), R * 0.12 * thin, pal.core, pal.rim, thin);
  }
  const minor = Math.round(8 * c.amount);
  for (let k = 0; k < minor; k++) {
    const th = P() * TAU, len = R * (0.35 + 0.4 * P());
    spike(g, cx, cy, th, len * grow, R * 0.06 * thin, pal.core, pal.rim, 0.85 * thin);
  }
  sparks(g, c, cx, cy, Math.round(18 * c.amount), R * 1.05, 0.0, 3, 0.25);
  ring(g, cx, cy, R * (0.25 + 0.75 * easeOut(t, 3)), R * 0.07 * (1 - t) + 0.8, 1, pal.rim, 0.8 * (1 - smooth(0, 0.75, t)));
  // a few solid chips
  g.globalCompositeOperation = "source-over";
  const D = rng(c.seed * 17 + 5);
  for (let k = 0; k < Math.round(8 * c.amount); k++) {
    const th = D() * TAU, d = R * (0.25 + 0.75 * D()) * easeOut(t, 2), r = R * (0.015 + 0.025 * D());
    const a = 1 - smooth(0.45, 1.05, t);
    if (a <= 0) continue;
    g.fillStyle = rgba(pal.splat, a);
    g.beginPath(); g.arc(cx + Math.cos(th) * d, cy + Math.sin(th) * d + R * 0.2 * t * t, Math.max(0.7, r), 0, TAU); g.fill();
  }
}

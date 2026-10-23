import { rng, clamp01, smooth } from "../../trails/glow/util.js";
import { TAU, easeOut, easeIn, at, blob, ring, streak, comet } from "../common.js";

// 冲击波: two soft rings racing out (flattened onto the ground when tilted),
// speed lines at the front and bits of dust kicked up along it
export function shock(g, c) {
  const { t, R, pal } = c;
  // 侧面: the ring stands upright, turned away by 地面倾斜 — narrowed sideways
  // (its glow and the flash stay round)
  const side = c.view === "side", kx = side ? c.squash : 1;
  const k = side ? 1 : c.squash, cx = c.cx, cy = k < 0.98 ? c.gy : c.cy;
  g.globalCompositeOperation = "lighter";
  const fl = 1 - smooth(0, 0.3, t);
  g.save(); g.translate(cx, cy); g.scale(1, k);
  blob(g, 0, 0, R * 0.45, [[0, pal.core, 0.9 * fl], [0.5, pal.rim, 0.4 * fl], [1, pal.rim, 0]]);
  g.restore();
  // the rings hold their brightness, then fade out by the last frame
  const r1 = R * easeOut(t, 2.6), r2 = R * 0.8 * easeOut((t - 0.12) / 0.88, 2.6), left = 1 - easeIn(t, 2);
  // the wave itself: a broad soft band of light pushed out ahead of the
  // middle, brightest just behind the front
  ring(g, cx, cy, r1 * 0.8, r1 * 0.32 + 1, k, pal.rim, 0.22 * left, kx);
  ring(g, cx, cy, r1 * 0.93, r1 * 0.12 + 1, k, pal.cols[pal.cols.length - 1], 0.25 * left, kx);
  ring(g, cx, cy, r1, R * 0.11 * (1 - t) + 0.8, k, pal.core, 0.95 * (1 - easeIn(t, 2.2)), kx);
  ring(g, cx, cy, r1, R * 0.2 * (1 - t) + 1, k, pal.rim, 0.5 * left, kx);
  if (t > 0.12) ring(g, cx, cy, r2, R * 0.05 * (1 - t) + 0.6, k, pal.rim, 0.7 * left, kx);
  const P = rng(c.seed * 23 + 4), N = Math.round(18 * c.amount);
  for (let i = 0; i < N; i++) {
    const th = P() * TAU, l = 0.1 + 0.15 * P(), a = left * (0.5 + 0.5 * P());
    const p = [cx + Math.cos(th) * r1 * (1 - l) * kx, cy + Math.sin(th) * r1 * (1 - l) * k];
    const q = [cx + Math.cos(th) * r1 * 1.04 * kx, cy + Math.sin(th) * r1 * 1.04 * k];
    streak(g, p, q, pal.rim, pal.core, a, Math.max(0.8, R * 0.02));
  }
  if (k < 0.98) {
    g.globalCompositeOperation = "source-over";
    // bits kicked up by the front, arcing up and back down with trails
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < Math.round(14 * c.amount); i++) {
      const th = P() * TAU, hgt = R * (0.05 + 0.2 * P()), sz = R * 0.02 * (0.6 + P()), a = 1 - smooth(0.5, 1, t);
      if (a <= 0) continue;
      const at = (q) => { const rr = R * easeOut(q / 1.3, 2.6) * 0.95; return [cx + Math.cos(th) * rr * kx, cy + Math.sin(th) * rr * k - hgt * Math.sin(Math.PI * q)]; };
      comet(g, { rim: pal.splat, core: pal.core }, at, clamp01(t * 1.3), 0.2, Math.max(0.7, sz), 0.85 * a);
    }
  }
}

import { rng, smooth } from "../../trails/glow/util.js";
import { TAU, blob, ring, easeOut } from "../common.js";
import { iceColors, iceLump, drawLump, twinkle } from "./ice.js";

// The ice meteor smashing: a flash, a puff of freezing mist, a faint frost
// ring, big chunks of ice flung up and out, tumbling and falling, fast small
// chips and a few glints. Everything is a function of t (0..1 over the hit),
// so any frame can be sought; all is gone by t = 1. godot/icehit.js draws
// exactly the same.
//
// R: the hit's radius.
export function iceBurst(R, amount, seed, t) {
  const P = rng(seed * 227 + 61), q = Math.max(0.25, Math.min(2, amount)), e = easeOut(t);
  const mist = [], pieces = [], sparkles = [];
  for (let j = 0; j < 6; j++) {
    const a = j * TAU / 6 + P() * 0.8, reach = R * (0.25 + 0.3 * P()), r0 = R * (0.25 + 0.45 * e) * (0.8 + 0.4 * P());
    mist.push({ at: [Math.cos(a) * reach * e, Math.sin(a) * reach * e], r: r0, alpha: Math.pow(1 - t, 1.5) * 0.22 * smooth(0, 0.06, t) });
  }
  // chunks (big, slower, thrown up) then chips (small, fast)
  for (const [count, s0, s1, v0, v1, l0, l1, sides] of [[9, 0.11, 0.1, 0.8, 1.0, 0.55, 0.35, 5], [14, 0.035, 0.04, 1.4, 1.6, 0.35, 0.3, 3]]) {
    for (let j = 0, n = Math.round(count * q); j < n; j++) {
      const a = j * TAU / n + (P() - 0.5) * 0.7, speed = R * (v0 + v1 * P()), size = R * (s0 + s1 * P()), spin = (P() - 0.5) * 12, rot = P() * TAU, life = l0 + l1 * P();
      const at = [Math.cos(a) * speed * t * (1 - 0.4 * t), Math.sin(a) * speed * t * (1 - 0.4 * t) - R * 0.5 * t + R * 1.6 * t * t];
      pieces.push({ at, size, rot: rot + spin * t, sides, key: seed * 13 + pieces.length * 71 + 7, alpha: 1 - smooth(life * 0.6, life, t) });
    }
  }
  for (let j = 0, n = Math.round(6 * q); j < n; j++) {
    const a = P() * TAU, reach = R * (0.3 + 0.7 * P()), born = 0.03 + 0.3 * P(), size = R * (0.05 + 0.04 * P()), k = Math.max(0, Math.min(1, (t - born) / 0.4));
    sparkles.push({ at: [Math.cos(a) * reach * e, Math.sin(a) * reach * e * 0.8], size, alpha: t < born || k >= 1 ? 0 : Math.sin(Math.PI * k) });
  }
  return { flash: 1 - smooth(0, 0.15, t), mist, pieces, sparkles, ring: { radius: R * (0.2 + 0.8 * e), alpha: 0.3 * (1 - smooth(0.05, 0.45, t)) } };
}

export function drawIceImpact(g, c, radius) {
  const { t, pal } = c, hit = iceBurst(radius, c.amount, c.seed, t), col = iceColors(pal), light = pal.dark ? "source-over" : "lighter";
  g.save(); g.translate(c.cx, c.cy);
  g.globalCompositeOperation = light;
  for (const m of hit.mist) blob(g, m.at[0], m.at[1], m.r, [[0, col.vapor, m.alpha], [1, col.vapor, 0]]);
  ring(g, 0, 0, hit.ring.radius, Math.max(0.6, radius * 0.04), 0.6, col.rim, hit.ring.alpha);
  for (const p of hit.pieces) drawLump(g, iceLump(rng(p.key), p.at, p.size, p.rot, p.sides), col, p.alpha, Math.max(0.5, p.size * 0.18), pal.dark);
  g.globalCompositeOperation = light;
  for (const k of hit.sparkles) twinkle(g, k.at[0], k.at[1], k.size, pal, k.alpha);
  blob(g, 0, 0, radius * 0.8, [[0, col.rim, 0.35 * hit.flash], [1, col.rim, 0]]);
  blob(g, 0, 0, radius * 0.45, [[0, col.core, 0.9 * hit.flash], [0.4, col.core, 0.45 * hit.flash], [1, col.rim, 0]]);
  g.restore();
}

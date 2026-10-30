import { rng, smooth } from "../../trails/glow/util.js";
import { TAU, frac, at, blob, streak } from "../common.js";

// Grains attached to the projectile, not its path history. Each grain streams
// away from the bright tip and fades before recycling, with varied reach and
// spread so the short body never has a straight, solid rear edge.
export function sandGrains(r, amount, seed, t) {
  const P = rng(seed * 131 + 17), grains = [];
  for (let i = 0, count = Math.round(48 * Math.max(0.25, Math.min(2, amount))); i < count; i++) {
    const phase = P(), side = P() + P() - 1, reach = 1.2 + P() * 1.1;
    const cycles = 3 + Math.floor(P() * 3), width = Math.max(0.45, r * (0.018 + P() * 0.027));
    const strength = 0.45 + P() * 0.5, flicker = P() * TAU, age = frac(phase + t * cycles);
    const x = -r * (0.06 + reach * age), y = r * (side * (0.07 + age * 0.35) + Math.sin(age * 2 + flicker) * 0.035 * age);
    const alpha = smooth(0, 0.08, age) * (1 - smooth(0.22, 1, age)) * strength * (0.7 + Math.sin(t * TAU * cycles * 2 + flicker) * 0.3);
    grains.push({ at: [x, y], back: [x + width * (1.2 + age * 0.8), y], width, alpha, heat: 0.5 + (1 - age) * 0.35 });
  }
  return grains;
}

export function drawSandBody(g, c, r) {
  const { pal } = c;
  g.globalCompositeOperation = pal.dark ? "source-over" : "lighter";
  blob(g, 0, 0, r * 0.8, [[0, pal.core, 0.95], [0.15, pal.rim, 0.7], [1, pal.rim, 0]]);
  for (const grain of sandGrains(r, c.amount, c.seed, c.t)) {
    if (grain.alpha < 0.005) continue;
    streak(g, grain.back, grain.at, pal.rim, at(pal.flame, grain.heat), grain.alpha, grain.width);
  }
}
